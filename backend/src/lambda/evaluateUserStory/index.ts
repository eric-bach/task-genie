import { Context } from 'aws-lambda';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createIncompleteUserStoriesMetric } from './helpers/cloudwatch';
import { WorkItem, BedrockResponse, WorkItemRequest } from '../../shared/types';
import { InvalidWorkItemError } from '../../shared/errors';

const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
if (AWS_ACCOUNT_ID === undefined) {
  throw new Error('AWS_ACCOUNT_ID environment variable is required');
}
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
if (AWS_BEDROCK_KNOWLEDGE_BASE_ID === undefined) {
  throw new Error('AWS_BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
}

const bedrockClient = new BedrockAgentRuntimeClient({
  endpoint: `https://bedrock-agent-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: process.env.AWS_REGION || 'us-west-2',
});
export const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-west-2' });
export const logger = new Logger({ serviceName: 'evaluateUserStory' });

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // The event now contains the raw Azure DevOps webhook payload
    logger.debug('Received event from Step Functions', { event });

    // Validate required fields in the work item
    validateWorkItem(event.resource);

    // Parse and sanitize fields
    const { workItem, params } = parseEvent(event);

    // Log the work item details for idempotency debugging
    logger.info('Processing work item', {
      workItemId: workItem.workItemId,
      resourceId: event.resource?.id,
      resourceWorkItemId: event.resource?.workItemId,
      revision: event.resource?.rev,
      changedDate:
        event.resource?.revision?.fields?.['System.ChangedDate'] || event.resource?.fields?.['System.ChangedDate'],
      eventType: event.eventType,
    });

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

const validateWorkItem = (resource: any) => {
  const requiredFields = [
    'System.IterationPath',
    'System.ChangedBy',
    'System.Title',
    'System.Description',
    'System.AreaPath',
    'Microsoft.VSTS.Common.AcceptanceCriteria',
    // TODO Change this to Custom.BusinessUnit when moving to AMA-Ent
    'Custom.BusinessUnit2',
    // TODO Change this to Custom.System when moving to AMA-Ent
    'Custom.System2',
  ];

  if (!resource) {
    throw new InvalidWorkItemError('Bad request', 'Work item resource is undefined or missing.', 400);
  }

  // Handle different payload structures for created vs updated work items
  // For updates: fields are in resource.revision.fields
  // For creates: fields are directly in resource.fields
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

const parseEvent = (event: any): WorkItemRequest => {
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
    area: sanitizeField(fields['System.AreaPath']),
    // TODO Change this to Custom.BusinessUnit when moving to AMA-Ent
    businessUnit: sanitizeField(fields['Custom.BusinessUnit2']),
    // TODO Change this to Custom.System when moving to AMA-Ent
    system: sanitizeField(fields['Custom.System2']),
    tags,
  };

  logger.info('Received work item', { workItem });

  return { params: params ?? {}, workItem };
};

const evaluateBedrock = async (workItem: WorkItem): Promise<BedrockResponse> => {
  const query = `
      Given the following work item, find any relevant information such as business or domain context, and technical
      details that can help you evaluate the user story:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
  `;

  const prompt = `
    You are an expert Agile software development assistant that reviews Azure DevOps work items. 
    You evaluate work items to ensure they are complete, clear, and ready for a developer to work on.
    Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    This is for educational and quality improvement purposes in a software development process.

    Evaluate the user story based on the following criteria:
      - Check if it clearly states the user, need, and business value.
      - Ensure acceptance criteria are present and specific.
      - Confirm the story is INVEST-aligned (Independent, Negotiable, Valuable, Estimable, Small, Testable).

    Return your assessment as a valid JSON object with the following structure:
      - "pass": boolean (true if the work item meets the quality bar, false otherwise)
      - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide
      a concrete example of a high-quality story that would pass. If you have multiple feedback points, use
      line breaks and indentations with HTML tags.
 
    Only output the JSON object, no additional text.
        
    The work item to review is: 
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
      
    Here may be some additional business or domain context that may help you:
      $search_results$`;

  const input: RetrieveAndGenerateCommandInput = {
    input: {
      text: query,
    },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
        modelArn: `arn:aws:bedrock:${AWS_REGION}:${AWS_ACCOUNT_ID}:inference-profile/${AWS_BEDROCK_MODEL_ID}`,
        generationConfiguration: {
          promptTemplate: {
            textPromptTemplate: prompt,
          },
          inferenceConfig: {
            textInferenceConfig: {
              maxTokens: 2048,
              temperature: 0.5,
              topP: 0.9,
            },
          },
        },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 5,
            filter: {
              equals: {
                key: 'area',
                value: 'agile-process',
              },
            },
          },
        },
      },
    },
  };

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  try {
    const command = new RetrieveAndGenerateCommand(input);
    const response = await bedrockClient.send(command);

    logger.debug('Bedrock model invoked', { response: response.output });
    const content = response.output?.text;

    if (!content) {
      logger.error('No content found in response', { response: response });
      throw new Error('No text content found in Bedrock response');
    }

    const bedrockResponse = safeJsonParse(content);

    if (!bedrockResponse) {
      logger.error('Failed to parse JSON response', { content });
      throw new Error('Invalid JSON response from Bedrock model');
    }

    logger.info('Bedrock invocation response', { response: bedrockResponse });

    return bedrockResponse;
  } catch (error: any) {
    logger.error('Bedrock model evaluation failed', {
      error: error.message,
      errorName: error.name,
      errorCode: error.$metadata?.httpStatusCode || error.statusCode,
      requestId: error.$metadata?.requestId,
      errorType: error.__type || error.code,
      modelId: AWS_BEDROCK_MODEL_ID,
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      region: AWS_REGION,
      modelArn: `arn:aws:bedrock:${AWS_REGION}:${AWS_ACCOUNT_ID}:foundation-model/${AWS_BEDROCK_MODEL_ID}`,
    });
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
