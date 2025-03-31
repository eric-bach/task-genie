import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createMetric } from './helpers/cloudwatch';

const bedrockUrl = `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`;
const bedrockClient = new BedrockRuntimeClient({ endpoint: bedrockUrl });
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;

const client = new CloudWatchClient({ region: process.env.AWS_REGION });

const logger = new Logger({ serviceName: 'evaluateTasks' });

if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const lambdaHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  try {
    const body = JSON.parse(event.body || '{}');

    // Validate required fields
    if (
      !body.resource ||
      !body.resource.workItemId ||
      !body.resource.revision ||
      !body.resource.revision.fields ||
      !body.resource.revision.fields['System.ChangedBy'] ||
      !body.resource.revision.fields['System.Title'] ||
      !body.resource.revision.fields['System.Description'] ||
      !body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']
    ) {
      logger.info('Work item is missing one or more required fields', {
        work_item_id: body.resource.workItemId ?? 0,
        work_item_changed_by: body.resource.revision.fields['System.ChangedBy'] ?? '',
        work_item_title: body.resource.revision.fields['System.Title'] ?? '',
        work_item_description: body.resource.revision.fields['System.Description'] ?? '',
        work_item_acceptance_criteria: body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '',
      });

      return {
        statusCode: 200, // Must return 200 to be able to test Azure DevOps Service Hooks in the console
        body: JSON.stringify({
          message: 'Work item is missing one or more required fields',
        }),
      };
    }

    const workItemId = body.resource.workItemId;
    const changedBy = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.ChangedBy'])));
    const title = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Title'])));
    const description = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Description'])));
    const acceptanceCriteria = removeHtmlTags(
      JSON.parse(JSON.stringify(body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']))
    );
    logger.info('Received work item', {
      work_item_id: workItemId,
      work_item_changed_by: changedBy,
      work_item_title: title,
      work_item_description: description,
      work_item_acceptance_criteria: acceptanceCriteria,
    });

    const userMessage = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
    You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
    A second optional JSON attribute key will be called comment where you are providing guidance and provide an example of how the work item would meet the pass requirements.
    Focus on whether a developer would understand without being pedantic.
    Ensure there is a clear title, user story and acceptance criteria.
    The task title to review is: ${title} along with the description: ${description} and the acceptance criteria: ${acceptanceCriteria}.
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
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response.output });

    const content = response.output?.message?.content;

    if (!content || !content[0].text) {
      logger.error('No content found in response', { response: response });
      throw new Error('No content found in response');
    }

    const jsonResponse = JSON.parse(content[0].text);
    if (jsonResponse.pass === true) {
      logger.info(`Work item ${workItemId} meets requirements`, { work_item_id: workItemId });

      return {
        statusCode: 200,
        body: JSON.stringify({
          workItemId,
          changedBy,
          title,
          description,
          acceptanceCriteria,
        }),
      };
    }

    logger.error(`Work item ${workItemId} does not meet requirements`, { reason: jsonResponse.comment });

    // Add IncompleteUserStories metric
    const tasksGeneratedMetric = {
      MetricName: 'IncompleteUserStories',
      Dimensions: [
        {
          Name: 'User Story',
          Value: 'User Stories',
        },
      ],
      Unit: StandardUnit.Count,
      Value: 1,
    };
    await createMetric(client, logger, tasksGeneratedMetric);

    return {
      statusCode: 400,
      body: JSON.stringify({
        workItemId,
        changedBy,
        comment: jsonResponse.comment,
      }),
    };
  } catch (error: any) {
    logger.error('An error occurred', { error: error });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error.message,
      }),
    };
  }
};

const removeHtmlTags = (input: string) => {
  const htmlRegex = /<[^>]*>/g;

  return input.replace(htmlRegex, '').trim();
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
