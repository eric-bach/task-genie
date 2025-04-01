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
import { WorkItem, Comment, BedrockResponse } from '../../shared/types';

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
    const requiredFields = [
      'System.ChangedBy',
      'System.Title',
      'System.Description',
      'Microsoft.VSTS.Common.AcceptanceCriteria',
    ];
    validateWorkItemFields(body.resource, requiredFields);

    // Parse and sanitize fields
    const workItem = parseWorkItemFields(body);

    // Invoke Bedrock
    const result = await evaluateBedrock(workItem);

    if (result.pass !== true) {
      const comment: Comment = { text: result.comment };
      logger.error(`❌ Work item ${workItem.workItemId} does not meet requirements`, { comment: comment });

      // Create CloudWatch metric
      await createIncompleteUserStoriesMetric();

      return {
        statusCode: 400,
        body: {
          workItem,
          comment,
        },
      };
    }

    logger.info(`✅ Work item ${workItem.workItemId} meets requirements`, { work_item_id: workItem.workItemId });

    return {
      statusCode: 200,
      body: { workItem },
    };
  } catch (error: any) {
    logger.error('💣 Error processing work item', { error: error });

    return {
      statusCode: 500,
      error: error.message,
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
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

const validateWorkItemFields = (resource: any, requiredFields: string[]) => {
  if (!resource || resource.workItemId < 0 || !resource.revision || !resource.revision.fields) {
    throw new Error('Work item resource or revision fields are missing.');
  }

  for (const field of requiredFields) {
    if (!resource.revision.fields[field]) {
      logger.error('Work item is missing a required field', { field: field });
      throw new Error(`Work item is missing required field: ${field}`);
    }
  }
};

const parseWorkItemFields = (body: any): WorkItem => {
  const workItemId = body.resource.workItemId;
  const changedBy = sanitizeField(body.resource.revision.fields['System.ChangedBy']);
  const title = sanitizeField(body.resource.revision.fields['System.Title']);
  const description = sanitizeField(body.resource.revision.fields['System.Description']);
  const acceptanceCriteria = sanitizeField(body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']);

  logger.info('Received work item', {
    work_item_id: workItemId,
    work_item_changed_by: changedBy,
    work_item_title: title,
    work_item_description: description,
    work_item_acceptance_criteria: acceptanceCriteria,
  });

  return { workItemId, changedBy, title, description, acceptanceCriteria };
};

const evaluateBedrock = async (workItem: WorkItem): Promise<BedrockResponse> => {
  const userMessage = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
  You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
  A second optional JSON attribute key will be called comment where you are providing guidance and provide an example of how the work item would meet the pass requirements.
  Focus on whether a developer would understand without being pedantic.
  Ensure there is a clear title, user story and acceptance criteria.
  The task title to review is: ${workItem.title} along with the description: ${workItem.description} and the acceptance criteria: ${workItem.acceptanceCriteria}.
  Only return JSON, no text. JSON should be a single line.`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: userMessage }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  };

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { messages: JSON.stringify(conversation) });

  const command = new ConverseCommand(input);

  try {
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response.output });

    const content = response.output?.message?.content;

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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
