import { Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { CloudWatchClient, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createMetric } from './helpers/cloudwatch';

type Task = { title: string; description: string };

const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

if (GITHUB_REPOSITORY === undefined) {
  throw new Error('GITHUB_REPOSITORY environment variable is required');
}

const client = new CloudWatchClient({ region: process.env.AWS_REGION });

const logger = new Logger({ serviceName: 'createTasks' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const { workItemId, changedBy, tasks } = body;

  logger.debug(`Parsed work item ${workItemId}`, {
    work_item_id: workItemId,
    work_item_changed_by: changedBy,
    work_item_tasks: tasks,
  });

  await createTasks(workItemId, tasks);

  // Add TasksGenerated metric
  const tasksGeneratedMetric = {
    MetricName: 'TasksGenerated',
    Dimensions: [
      {
        Name: 'Tasks',
        Value: 'Tasks',
      },
    ],
    Unit: StandardUnit.Count,
    Value: tasks.length,
  };
  await createMetric(client, logger, tasksGeneratedMetric);

  // Add UserStoriesUpdated metric
  const userStoriesUpdatedMetric = {
    MetricName: 'UserStoriesUpdated',
    Dimensions: [
      {
        Name: 'User Story',
        Value: 'User Stories',
      },
    ],
    Unit: StandardUnit.Count,
    Value: 1,
  };
  await createMetric(client, logger, userStoriesUpdatedMetric);

  return {
    statusCode: 200,
    body: JSON.stringify({
      workItemId,
      changedBy,
      response: `Work item successfully updated with ${tasks.length} tasks`,
    }),
  };
};

const getParameter = async (name: string): Promise<string> => {
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const response = await ssmClient.send(command);
  return response.Parameter?.Value || '';
};

const getHeaders = async (): Promise<HeadersInit> => {
  const base64EncodedPAT = await getParameter(process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME || '');

  return {
    'Content-Type': 'application/json-patch+json',
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

const createTasks = async (workItemId: string, tasks: Task[]) => {
  logger.debug(`Creating ${tasks.length} tasks`, { tasks: tasks });

  const headers = await getHeaders();

  for (const task of tasks) {
    await createTask(headers, workItemId, task);
  }

  logger.info(`All ${tasks.length} tasks created`);
};

const createTask = async (header: HeadersInit, workItemId: string, task: Task) => {
  const taskFields = [
    {
      op: 'add',
      path: '/fields/System.Title',
      value: task.title,
    },
    {
      op: 'add',
      path: '/fields/System.Description',
      value: task.description,
    },
    {
      op: 'add',
      path: '/fields/System.WorkItemType',
      value: 'Task',
    },
  ];

  const body = JSON.stringify(taskFields);

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${GITHUB_REPOSITORY}/_apis/wit/workitems/$task?api-version=7.1`;

    logger.debug('Creating task', { task: task });

    const response = await fetch(url, {
      method: 'POST',
      headers: header,
      body: body,
    });

    logger.debug('Create task response', { response: JSON.stringify(response) });

    if (response.ok) {
      const data = await response.json();
      logger.info(`Created task Id ${data.id}`);

      await linkTask(header, workItemId, data.id);
    } else {
      throw new Error('Failed to create task');
    }
  } catch (error) {
    logger.error('Error creating task', { error: error });
  }
};

const linkTask = async (headers: HeadersInit, workItemId: string, taskId: string) => {
  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${GITHUB_REPOSITORY}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

    const body = `[
      {
        "op": "add",
        "path": "/relations/-",
        "value": {
          "rel": "System.LinkTypes.Hierarchy-Forward",
          "url": "https://amaabca.visualstudio.com/eric-test/_apis/wit/workItems/${taskId}",
          "attributes": {
            "comment": "Linking dependency"
          }
        }
      }
    ]`;

    logger.debug(`Linking task ${taskId} to work item ${workItemId}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: body,
    });

    logger.debug('Link task repsonse', { response: JSON.stringify(response) });

    if (response.ok) {
      const data = await response.json();
      logger.info(`Linked task Id ${data.id}`);

      return response;
    }

    throw new Error('Failed to link task');
  } catch (error) {
    logger.error('Error linking task', { error: error });
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
