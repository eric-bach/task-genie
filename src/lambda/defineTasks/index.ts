import { Context } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  ConversationRole,
  ConverseCommand,
  ConverseCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

type Task = { title: string; description: string };

const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;

const bedrockUrl = `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`;
const bedrockClient = new BedrockRuntimeClient({ endpoint: bedrockUrl });

if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const logger = new Logger({ serviceName: 'defineTasks' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const { workItemId, title, description, acceptanceCriteria, changedBy } = body;

  logger.info(`Received work item ${workItemId}`, {
    work_item_id: workItemId,
    work_item_changed_by: changedBy,
    work_item_title: title,
    work_item_description: description,
    work_item_acceptance_criteria: acceptanceCriteria,
  });

  const userMessage = `You are a technical project manager for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
    You will return a result in a JSON format with one attribute key being tasks. This is a list. If no tasks are needed this will be empty.
    Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
    The parent task description to review is: ${description} along with the acceptance criteria: ${acceptanceCriteria}.
    Only generate tasks where it is completely neccessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
    Investigation and analysis should not have separate tasks.
    Not tasks for analyzing, no tasks for regression testing.
    Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
    Add a prefix to each task title to denote it's order in the sequence of tasks to be completed. For example, if there are 3 tasks, the first task would have a title of "1. Task Title".
    Only return JSON, no text. JSON should be a single line`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: userMessage }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5, topP: 0.9 },
  };

  try {
    logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { messages: JSON.stringify(conversation) });

    const command = new ConverseCommand(input);
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response.output });

    // Get tasks
    const text: string = response.output?.message?.content
      ? response.output?.message?.content[0].text || '{tasks:[{}]}'
      : '{tasks:[{}]}';
    const tasks: Task[] = JSON.parse(text).tasks;

    logger.info(`Identified ${tasks.length} tasks`, { tasks: JSON.stringify(tasks) });

    return {
      statusCode: 200,
      body: JSON.stringify({
        workItemId,
        changedBy,
        tasks,
      }),
    };
  } catch (error) {
    logger.error('Error occurred', { error: error });
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal server error',
      }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
