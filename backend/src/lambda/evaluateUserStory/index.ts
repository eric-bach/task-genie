import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createIncompleteUserStoriesMetric } from './helpers/cloudwatch';
import { WorkItem, BedrockResponse, WorkItemRequest } from '../../shared/types';
import { InvalidWorkItemError } from '../../shared/errors';

const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const bedrockClient = new BedrockRuntimeClient({
  endpoint: `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: process.env.AWS_REGION || 'us-west-2',
});
export const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-west-2' });
export const logger = new Logger({ serviceName: 'evaluateUserStory' });

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // Validate required fields in the work item
    validateWorkItem(event.resource);

    // Parse and sanitize fields
    const { workItem, params } = parseEventBody(event);

    // Check if work item has been updated already
    if (workItem.tags.includes('Task Genie')) {
      return {
        statusCode: 204,
        body: {
          params,
          workItem,
        },
      };
    }

    // Invoke Bedrock
    let statusCode = 200;
    const bedrockResponse = await evaluateBedrock(workItem);

    if (bedrockResponse.pass !== true) {
      logger.error(`❌ Work item ${workItem.workItemId} does not meet requirements`, {
        reason: bedrockResponse.comment,
      });

      // Create CloudWatch metric
      await createIncompleteUserStoriesMetric();

      // throw new InvalidWorkItemError('Invalid work item', bedrockResponse.comment, 412);
      statusCode = 412;
    } else {
      logger.info(`✅ Work item ${workItem.workItemId} meets requirements`, { work_item_id: workItem.workItemId });
    }

    return {
      statusCode,
      body: {
        params,
        workItem,
        workItemStatus: bedrockResponse,
      },
    };
  } catch (error) {
    if (error instanceof InvalidWorkItemError) {
      logger.error(`💣 ${error.error}`, { error: error.message });

      return {
        statusCode: error.code,
        error: error.error,
        message: error.message,
      };
    }

    logger.error('💣 An unknown error occurred', { error: error });

    return {
      statusCode: 500,
      error: error,
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body) {
    throw new InvalidWorkItemError('Bad request', 'Request body is missing or undefined.', 400);
  }

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (error) {
      throw new Error('Invalid JSON format in request body.');
    }
  }

  return body;
};

const validateWorkItem = (resource: any) => {
  const requiredFields = [
    'System.IterationPath',
    'System.ChangedBy',
    'System.Title',
    'System.Description',
    'Microsoft.VSTS.Common.AcceptanceCriteria',
  ];

  if (!resource) {
    throw new InvalidWorkItemError('Bad request', 'Work item resource is undefined or missing.', 400);
  }

  const fields = resource.revision?.fields || resource.fields;
  if (!fields) {
    throw new InvalidWorkItemError('Bad request', 'Work item fields are undefined or missing.', 400);
  }

  for (const field of requiredFields) {
    if (!fields[field]) {
      logger.error('Work item is missing a required field', { field: field });
      throw new InvalidWorkItemError('Bad request', `Work item is missing required field: ${field}.`, 400);
    }
  }
};

const parseEventBody = (event: any): WorkItemRequest => {
  const { params, resource } = event;
  const workItemId = resource.workItemId || resource.id;
  const fields = resource.revision?.fields || resource.fields;

  const tagsString = sanitizeField(fields['System.Tags'] ?? '');
  const tags = tagsString ? tagsString.split(';').map((tag: string) => tag.trim()) : [];

  const workItem = {
    workItemId: workItemId ?? 0,
    changedBy: sanitizeField(fields['System.ChangedBy']).replace(/<.*?>/, '').trim(),
    title: sanitizeField(fields['System.Title']),
    description: sanitizeField(fields['System.Description']),
    acceptanceCriteria: sanitizeField(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
    iterationPath: sanitizeField(fields['System.IterationPath']),
    tags,
  };

  logger.info('Received work item', { workItem });

  return { params: params ?? {}, workItem };
};

const evaluateBedrock = async (workItem: WorkItem): Promise<BedrockResponse> => {
  const prompt = `
    You are an expert Agile software development assistant that reviews Azure DevOps work items.
    You evaluate work items to ensure they are complete, clear, and ready for a developer to work on.
    Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    Evaluate the user story based on the following criteria:
      - Check if it clearly states the user, need, and business value.
      - Ensure acceptance criteria are present and specific.
      - Confirm the story is INVEST-aligned (Independent, Negotiable, Valuable, Estimable, Small, Testable).

    Only return your assessment as a JSON object with the following structure:
      - "pass": boolean (true if the work item meets the quality bar, false otherwise)
      - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide a concrete example of a high-quality story that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.

    Do not output any text outside of the JSON object.

    The work item to review is:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: prompt }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.5,
      topP: 0.9,
    },
  };

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  const command = new ConverseCommand(input);

  try {
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response.output });

    const content = response.output?.message?.content;

    logger.debug('Bedrock response content', { content: content });

    if (!content || !content[0].text) {
      logger.error('No content found in response', { response: response });
      throw new Error('No content found in response');
    }

    const bedrockResponse = safeJsonParse(content[0].text);

    logger.info('Bedrock invocation response', { response: bedrockResponse });

    return bedrockResponse;
  } catch (error: any) {
    throw new Error(`Bedrock model evaluation failed\n${error.message}`);
  }
};

const sanitizeField = (fieldValue: any): string => {
  if (typeof fieldValue !== 'string') {
    throw new Error('Invalid field value: expected a string.');
  }
  return fieldValue.replace(/<[^>]*>/g, '').trim();
};

// Sometimes the AI model returns invalid JSON with extra characters before and after the JSON string, so we need to extract the first valid JSON object from the string
function safeJsonParse<T = any>(input: string): T | undefined {
  // Find the first '{' and the last '}'
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return undefined; // No valid JSON found
  }

  const jsonSubstring = input.slice(start, end + 1);

  try {
    return JSON.parse(jsonSubstring);
  } catch {
    return undefined; // Invalid JSON
  }
}

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
