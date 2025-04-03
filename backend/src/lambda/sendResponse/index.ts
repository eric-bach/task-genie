import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task, Comment } from '../../shared/types';

const logger = new Logger({ serviceName: 'sendResponse' });

const lambdaHandler = async (event: any, context: Context) => {
  let body: any = {};

  try {
    console.log('Error', event.error);

    // Validate event body
    body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, comment } = parseWorkItemAndTasksAndCommentAndError(body);

    logger.info('✅ Final response is valid');

    return {
      statusCode: event.statusCode,
      body: {
        isValidWorkItem: event.statusCode === 200 || event.statusCode === 204,
        isModified: workItem.workItemId > 0 && event.statusCode !== 204,
        workItem,
        tasks,
        comment,
      },
      // headers: {
      //   'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
      //   'Access-Control-Allow-Origin': '*',
      //   'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
      //   'Access-Control-Allow-Credentials': true,
      // },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error, reason: event.error });

    return {
      statusCode: 500,
      error: event.error, //?? error.message,
      // headers: {
      //   'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
      //   'Access-Control-Allow-Origin': '*',
      //   'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
      //   'Access-Control-Allow-Credentials': true,
      // },
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseWorkItemAndTasksAndCommentAndError = (
  body: any
): { workItem: WorkItem; tasks: Task[]; comment: Comment } => {
  const workItem = {
    workItemId: body.workItem.workItemId,
    iterationPath: body.workItem.iterationPath,
    changedBy: body.workItem.changedBy,
    title: body.workItem.title,
    description: body.workItem.description,
    acceptanceCriteria: body.workItem.acceptanceCriteria,
    tags: body.workItem.tags,
  };
  const tasks = body.tasks ?? [];
  const comment = body.comment;

  logger.info('Parsed work item', {
    workItem,
    tasks,
    comment,
  });

  return { workItem, tasks, comment };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
