import { Context } from 'aws-lambda';
import * as bedrock from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

type Task = { title: string; description: string };

const bedrockUrl = `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`;
const bedrockClient = new bedrock.BedrockRuntimeClient({ endpoint: bedrockUrl });

const logger = new Logger({ serviceName: 'defineTasks' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const workItemId = body.workItemId;
  const description = body.description;
  const acceptanceCriteria = body.acceptanceCriteria;

  logger.debug('WorkItemId: ', workItemId);
  logger.debug('Description: ', description);
  logger.debug('Acceptance Criteria: ', acceptanceCriteria);

  const userMessage = `You are a technical project manager for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
    You will return a result in a JSON format with one attribute key being tasks. This is a list. If no tasks are needed this will be empty.
    Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
    The parent task description to review is: ${description} along with the acceptance criteria: ${acceptanceCriteria}.
    Only generate tasks where it is completely neccessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
    Investigation and analysis should not have separate tasks.
    Not tasks for analyzing, no tasks for regression testing.
    Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
    Only return JSON, no text. JSON should be a single line`;

  const conversation = [
    {
      role: bedrock.ConversationRole.USER,
      content: [{ text: userMessage }],
    },
  ];

  const input: bedrock.ConverseCommandInput = {
    modelId: process.env.AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5, topP: 0.9 },
  };

  logger.info('Sending input to Bedrock:', JSON.stringify(input, null, 2));

  const command = new bedrock.ConverseCommand(input);
  const response = await bedrockClient.send(command);

  logger.info('Response:', JSON.stringify(response, null, 2));

  // Get tasks
  const text: string = response.output?.message?.content
    ? response.output?.message?.content[0].text || '{tasks:[{}]}'
    : '{tasks:[{}]}';
  const tasks: Task[] = JSON.parse(text).tasks;

  logger.debug('Identified Tasks:', JSON.stringify(tasks));

  return {
    statusCode: 200,
    body: JSON.stringify({
      workItemId: workItemId,
      tasks,
    }),
  };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
