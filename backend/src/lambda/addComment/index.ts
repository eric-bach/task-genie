import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { addComment } from './helpers/azureDevOps';

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

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
if (GITHUB_REPOSITORY === undefined) {
  throw new Error('GITHUB_REPOSITORY environment variable is required');
}

export const logger = new Logger({ serviceName: 'addComment' });

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, comment } = parseWorkItemAndTasksAndComment(body);

    // Add comment
    const result = await addComment(workItem, comment);

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks,
        comment,
      },
    };
  } catch (error: any) {
    logger.error('An unexpected error occurred', { error: error });

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

  return body;
};

const parseWorkItemAndTasksAndComment = (body: any): { workItem: WorkItem; tasks: Task[]; comment: Comment } => {
  const workItem = {
    workItemId: body.workItem.workItemId,
    changedBy: body.workItem.changeBy,
    title: body.workItem.title,
    description: body.workItem.description,
    acceptanceCriteria: body.workItem.acceptanceCriteria,
  };
  const tasks = body.tasks ?? [];
  const comment = body.comment;

  logger.info(`Received work item ${workItem.workItemId}, ${tasks.length} tasks, and a comment`, {
    workItem,
    tasks,
    comment,
  });

  return { workItem, tasks, comment };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
