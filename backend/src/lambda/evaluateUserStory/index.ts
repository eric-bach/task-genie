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

const lambdaHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Validate required fields in the work item
    validateWorkItem(body.resource);

    // Parse and sanitize fields
    const { workItem, params } = parseEventBody(body);

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
    }

    logger.info(`✅ Work item ${workItem.workItemId} meets requirements`, { work_item_id: workItem.workItemId });

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

  if (!resource || resource.workItemId < 0 || !resource.revision || !resource.revision.fields) {
    throw new InvalidWorkItemError('Bad request', 'Work item resource or revision fields are missing.', 400);
  }

  for (const field of requiredFields) {
    if (!resource.revision.fields[field]) {
      logger.error('Work item is missing a required field', { field: field });
      throw new InvalidWorkItemError('Bad request', `Work item is missing required field: ${field}.`, 400);
    }
  }
};

const parseEventBody = (body: any): WorkItemRequest => {
  const { params, resource } = body;
  const { workItemId, revision } = resource;
  const fields = revision.fields;

  const tagsString = sanitizeField(fields['System.Tags'] ?? '');
  const tags = tagsString ? tagsString.split(';').map((tag: string) => tag.trim()) : [];

  const workItem = {
    workItemId,
    changedBy: sanitizeField(fields['System.ChangedBy']),
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
  const prompt = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
    You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
    A second optional JSON attribute key will be called comment, that is returned in a single line and where you are providing guidance and provide an example of how the work item would meet the pass requirements.
    Focus on whether a developer would understand without being pedantic.
    Ensure there is a clear title, user story and acceptance criteria.
    The task title to review is: ${workItem.title} along with the description: ${workItem.description} and the acceptance criteria: ${workItem.acceptanceCriteria}.
    Only return JSON, no text. JSON should be a single line.`;

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

    const bedrockResponse = JSON.parse(content[0].text);

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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
