import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task, BedrockResponse } from '../../shared/types';

const logger = new Logger({ serviceName: 'sendResponse' });

const lambdaHandler = async (event: any, context: Context) => {
  let body: any = {};

  try {
    console.log('Error', event.error);

    // Validate event body
    body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, workItemStatus } = parseEventBody(body);

    logger.info('✅ Final response is valid');

    return {
      statusCode: event.statusCode,
      body: {
        isValidWorkItem: event.statusCode === 200 || event.statusCode === 204,
        isModified: workItem.workItemId > 0 && event.statusCode !== 204,
        workItem,
        tasks,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: event.error, reason: event.message });

    return {
      statusCode: 500,
      error: event.error,
      message: event.message,
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseEventBody = (body: any): { workItem: WorkItem; tasks: Task[]; workItemStatus: BedrockResponse } => {
  const { workItem, tasks, workItemStatus } = body;

  logger.info('Parsed work item', {
    workItem,
    tasks,
    workItemStatus,
  });

  return { workItem, tasks, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
