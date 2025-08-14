import { Context } from 'aws-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createTaskGeneratedMetric, createUserStoriesUpdatedMetric } from './helpers/cloudwatch';
import { createTasks } from './helpers/azureDevOps';
import { WorkItem, Task, BedrockResponse } from '../../shared/types';

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-west-2' });
export const logger = new Logger({ serviceName: 'createTasks' });

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, workItemStatus } = parseEventBody(body);

    // Create tasks
    await createTasks(workItem, tasks);

    // Add CloudWatch metrics
    await createTaskGeneratedMetric(tasks.length);
    await createUserStoriesUpdatedMetric();

    logger.info(`✅ Created ${tasks.length} tasks for work item ${workItem.workItemId}`);

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
  if (!body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseEventBody = (body: any): { workItem: WorkItem; tasks: Task[]; workItemStatus: BedrockResponse } => {
  const { workItem, tasks, workItemStatus } = body;

  logger.info(`Received work item ${workItem.workItemId} and ${tasks.length} tasks`, {
    workItem,
    tasks,
    workItemStatus,
  });

  return { workItem, tasks, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
