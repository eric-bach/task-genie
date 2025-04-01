import { Context } from 'aws-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createTaskGeneratedMetric, createUserStoriesUpdatedMetric } from './helpers/cloudwatch';
import { createTasks } from './helpers/azureDevOps';
import { WorkItem, Task, Comment } from '../../shared/types';

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
if (GITHUB_REPOSITORY === undefined) {
  throw new Error('GITHUB_REPOSITORY environment variable is required');
}

export const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-west-2' });
export const logger = new Logger({ serviceName: 'createTasks' });

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks } = parseWorkItemAndTasks(body);

    // Create tasks
    await createTasks(workItem.workItemId, tasks);

    // Add CloudWatch metrics
    await createTaskGeneratedMetric(tasks.length);
    await createUserStoriesUpdatedMetric();

    const comment: Comment = { text: `Work item successfully updated with ${tasks.length} tasks` };

    logger.info(`✅ Created ${tasks.length} tasks for work item ${workItem.workItemId}`);

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks,
        comment,
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

const parseWorkItemAndTasks = (body: any): { workItem: WorkItem; tasks: Task[] } => {
  const workItem = {
    workItemId: body.workItem.workItemId,
    changedBy: body.workItem.changeBy,
    title: body.workItem.title,
    description: body.workItem.description,
    acceptanceCriteria: body.workItem.acceptanceCriteria,
  };
  const tasks = body.tasks;

  logger.info(`Received work item ${workItem.workItemId} and ${tasks.length} tasks`, {
    workItem,
    tasks,
  });

  return { workItem, tasks };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
