import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

export interface WorkItem {
  workItemId: number;
  changedBy: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface Task {
  title: string;
  description: string;
}

export interface Comment {
  text: string;
}

const logger = new Logger({ serviceName: 'sendResponse' });

const lambdaHandler = async (event: any, context: Context) => {
  let body: any = {};

  try {
    // Validate event body
    body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, comment } = parseWorkItemAndTasksAndCommentAndError(body);

    return {
      statusCode: event.statusCode,
      body: {
        isValidWorkItem: event.statusCode === 200,
        isModified: workItem.workItemId > 0,
        workItem,
        tasks,
        comment,
      },
    };
  } catch (error: any) {
    logger.error('An unexpected error occurred', { error: error });

    return {
      statusCode: 500,
      error: event.error ?? error.message,
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
    changedBy: body.workItem.changeBy,
    title: body.workItem.title,
    description: body.workItem.description,
    acceptanceCriteria: body.workItem.acceptanceCriteria,
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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
