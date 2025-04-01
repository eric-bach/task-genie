import { Context } from 'aws-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createTaskGeneratedMetric, createUserStoriesUpdatedMetric } from './helpers/cloudwatch';
import { createTasks } from './helpers/azureDevOps';

interface WorkItem {
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

interface Comment {
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        workItem,
        comment,
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

const parseWorkItemAndTasks = (body: any): { workItem: WorkItem; tasks: Task[] } => {
  const workItem = {
    workItemId: body.workItemId,
    changedBy: body.changeBy,
    title: body.title,
    description: body.description,
    acceptanceCriteria: body.acceptanceCriteria,
  };
  const tasks = body.tasks;

  logger.info(`Received work item ${body.workItemId} and ${body.tasks.length} tasks`, {
    workItem,
    tasks,
  });

  return { workItem, tasks };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
