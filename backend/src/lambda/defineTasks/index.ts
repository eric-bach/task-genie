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
import { WorkItem, Task, WorkItemRequest, BedrockConfig, BedrockResponse } from '../../shared/types';

const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const bedrockClient = new BedrockRuntimeClient({
  endpoint: `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: process.env.AWS_REGION || 'us-west-2',
});
const logger = new Logger({ serviceName: 'defineTasks' });

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse event body
    const { workItem, params, workItemStatus } = parseEventBody(body);

    // Invoke Bedrock
    const tasks = await evaluateBedrock(workItem, params);
    logger.info(`✅ Identified ${tasks.length} tasks`, { tasks: JSON.stringify(tasks) });

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error });

    return {
      statusCode: 500,
      error: error.message,
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body || !body.workItem) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseEventBody = (body: any): { workItem: WorkItem; params: BedrockConfig; workItemStatus: BedrockResponse } => {
  const { params, workItem, workItemStatus } = body;

  if (params) {
    logger.info(`Received work item ${workItem.workItemId}`, {
      workItem,
      params,
      workItemStatus,
    });
  } else {
    logger.info(`Received work item ${workItem.workItemId}`, {
      workItem: workItem,
      workItemStatus,
    });
  }

  return { params: params ?? {}, workItem, workItemStatus };
};

const evaluateBedrock = async (workItem: WorkItem, params: BedrockConfig): Promise<Task[]> => {
  // const prompt = `You are a technical product owner for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
  // You will return a result in a JSON format with one attribute key being tasks. This is a list. If no tasks are needed this will be empty.
  // Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
  // The parent task title to review is: ${workItem.title} along with the description: ${workItem.description} and along with the acceptance criteria: ${workItem.acceptanceCriteria}.
  // Only generate tasks where it is completely neccessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
  // Investigation and analysis should not have separate tasks.
  // Not tasks for analyzing, no tasks for regression testing.
  // Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
  // Add a prefix to each task title to denote it's order in the sequence of tasks to be completed. For example, if there are 3 tasks, the first task would have a title of "1. Task Title".
  // Only return JSON, no text. JSON should be a single line`;

  const prompt =
    params.prompt ||
    `You are a technical product owner for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
  You will return a result in a JSON format with one attribute key named "tasks". This is a list. If no tasks are needed this will be empty.
  Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
  Only generate tasks where it is completely necessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
  Investigation and analysis should not have separate tasks.
  Not tasks for analyzing, no tasks for regression testing.
  Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
  Add a prefix to each task title to denote it's order in the sequence of tasks to be completed. For example, if there are 3 tasks, the first task would have a title of "1. Task Title".
  Only return JSON, no text. JSON should be a single line`;
  const fullPrompt = `${prompt}. Only return JSON, no text, with one attribute key named "tasks". Each would be an object in the list with a key of title and a key of description. JSON should be a single line. The parent task title to review is: ${workItem.title} along with the description: ${workItem.description} and along with the acceptance criteria: ${workItem.acceptanceCriteria}.`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: fullPrompt }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: {
      maxTokens: params.maxTokens ?? 2048,
      temperature: params.temperature ?? 0.5,
      topP: params.topP ?? 0.9,
    },
  };

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  const command = new ConverseCommand(input);

  try {
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response.output });

    // Get tasks
    const text: string = response.output?.message?.content
      ? response.output?.message?.content[0].text || '{tasks:[{}]}'
      : '{tasks:[{}]}';
    const tasks: Task[] = JSON.parse(text).tasks;

    return tasks;
  } catch (error: any) {
    throw new Error(`Bedrock model evaluation failed\n${error.message}`);
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
