import { Context } from 'aws-lambda';
import { BedrockRuntimeClient, ConverseCommand, ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createMetric } from './helpers/cloudwatch';
import { json } from 'stream/consumers';

const bedrockUrl = `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`;
const bedrockClient = new BedrockRuntimeClient({ endpoint: bedrockUrl });
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;

const client = new CloudWatchClient({ region: process.env.AWS_REGION });

const logger = new Logger({ serviceName: 'evaluateTasks' });

if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const lambdaHandler = async (event: any, context: Context) => {
  const { workItemId, title, description, acceptanceCriteria, changedBy } = event;

  logger.debug(`Parsed work item ${workItemId}`, {
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

  logger.info(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`);

  const command = new ConverseCommand(input);
  const response = await bedrockClient.send(command);

  logger.info('Bedrock model invoked', { response: response.output });

  const content = response.output?.message?.content;

  if (content && content[0].text) {
    const jsonResponse = JSON.parse(content[0].text);

    if (jsonResponse.pass === true) {
      logger.info('Work Item meets quality bar');

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

    // TODO Creat a CloudWatch Metrics VPC endpoint for this to work
    // Add TasksGenerated metric
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

    logger.error('Work Item does not meet quality bar', { reason: jsonResponse.comment });

    return {
      statusCode: 400,
      body: JSON.stringify({
        workItemId,
        changedBy,
        response: `Work Item does not have sufficient details<br />${jsonResponse.comment}`,
      }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
