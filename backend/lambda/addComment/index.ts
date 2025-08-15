import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { addComment, addTag } from './helpers/azureDevOps';
import { WorkItem, Task, BedrockResponse } from '../../shared/types';

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'addComment' });

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event
    validateEvent(event);

    // Parse event
    const { workItem, tasks, workItemStatus } = parseEvent(event);

    // Generate comment
    const comment = workItemStatus.pass
      ? `Generated ${tasks.length} tasks for work item ${workItem.workItemId}`
      : workItemStatus.comment;

    // Add comment
    await addComment(workItem, comment);

    // Add tag
    if (workItemStatus.pass) {
      await addTag(workItem, 'Task Genie');
    }

    logger.info(`✅ Added comment to work item ${workItem.workItemId}`);

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

const validateEvent = (event: Record<string, any>) => {
  if (!event.body && !event.body.workItem) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }
};

const parseEvent = (
  event: Record<string, any>
): { workItem: WorkItem; tasks: Task[]; workItemStatus: BedrockResponse } => {
  const body = event.body;

  let { workItem, tasks, workItemStatus } = body;
  tasks = tasks ?? [];

  logger.info(`Received work item ${workItem.workItemId} and ${tasks.length} tasks`, {
    workItem,
    tasks,
    workItemStatus,
  });

  return { workItem, tasks, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
