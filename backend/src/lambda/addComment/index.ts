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
    const { workItem, comment } = parseWorkItemAndComment(body);

    // Add comment
    const result = await addComment(workItem, comment);

    return {
      statusCode: 200,
      body: JSON.stringify({
        response: result,
      }),
    };
  } catch (error: any) {
    logger.error('An unexpected error occurred', { error: error });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error.message,
      }),
    };
  }
};

const validateEventBody = (bodyString: string | undefined) => {
  if (!bodyString) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  try {
    return JSON.parse(bodyString);
  } catch (error) {
    throw new Error('Invalid event payload: unable to parse request body.');
  }
};

const parseWorkItemAndComment = (body: any): { workItem: WorkItem; comment: Comment } => {
  const workItem = {
    workItemId: body.workItemId,
    changedBy: body.changeBy,
    title: body.title,
    description: body.description,
    acceptanceCriteria: body.acceptanceCriteria,
  };
  const comment = body.comment;

  logger.info(`Received work item ${body.workItemId} and comment`, {
    workItem,
    comment,
  });

  return { workItem, comment };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
