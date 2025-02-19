import { Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { CloudWatchClient, PutMetricDataCommand, PutMetricDataCommandInput } from '@aws-sdk/client-cloudwatch';

type Task = { title: string; description: string };

const ORGANIZATION = 'amaabca';
const PROJECT = 'eric-test';

const client = new CloudWatchClient({ region: process.env.AWS_REGION });

const logger = new Logger({ serviceName: 'createTasks' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const workItemId = body.workItemId;
  const tasks = body.tasks;

  logger.debug('WorkItemId: ', workItemId);
  logger.debug('Tasks: ', tasks);

  await createTasks(workItemId, tasks);

  // TODO Clean up adding metrics
  const params: PutMetricDataCommandInput = {
    MetricData: [
      {
        MetricName: 'TasksGenerated',
        Dimensions: [
          {
            Name: 'Tasks',
            Value: 'Tasks',
          },
        ],
        Unit: 'None',
        Value: tasks.length,
      },
    ],
    Namespace: 'Azure DevOps',
  };
  const command = new PutMetricDataCommand(params);
  try {
    const response = await client.send(command);
    logger.info(`Custom metric published successfully: ${JSON.stringify(response)}`);
  } catch (error) {
    logger.error(`Error publishing custom metric: ${error}`);
  }
  // Metrics2
  const params2: PutMetricDataCommandInput = {
    MetricData: [
      {
        MetricName: 'UserStoriesUpdated',
        Dimensions: [
          {
            Name: 'User Story',
            Value: 'User Stories',
          },
        ],
        Unit: 'None',
        Value: 1,
      },
    ],
    Namespace: 'Azure DevOps',
  };
  const command2 = new PutMetricDataCommand(params2);
  try {
    const response = await client.send(command2);
    logger.info(`Custom metric published successfully: ${JSON.stringify(response)}`);
  } catch (error) {
    logger.error(`Error publishing custom metric: ${error}`);
  }

  logger.debug('All tasks created');

  return {
    statusCode: 200,
    body: JSON.stringify({
      // TODO Return proper work item and tasks
      input: { workItemId: event.workItemId },
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
  logger.info(`Creating ${tasks.length} tasks`);

  const headers = await getHeaders();

  for (const task of tasks) {
    logger.debug('Creating task', task);

    const taskResponse = await createTask(headers, workItemId, task);

    logger.debug('Task created', JSON.stringify(taskResponse));
  }

  logger.info('All tasks created');
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
    const url = `https://${ORGANIZATION}.visualstudio.com/${PROJECT}/_apis/wit/workitems/$task?api-version=7.1`;

    const response = await fetch(url, {
      method: 'POST',
      headers: header,
      body: body,
    });

    logger.debug('ADO response', JSON.stringify(response));

    if (response.ok) {
      const data = await response.json();
      logger.info(`Created task Id ${data.id}`);

      await linkTask(header, workItemId, data.id);
    } else {
      throw new Error('Failed to create task');
    }
  } catch (error) {
    logger.error(`Error creating task ${error}`);
  }
};

const linkTask = async (headers: HeadersInit, workItemId: string, taskId: string) => {
  try {
    const url = `https://${ORGANIZATION}.visualstudio.com/${PROJECT}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

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

    const response = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: body,
    });

    logger.debug('ADO repsonse', JSON.stringify(response));

    if (response.ok) {
      const data = await response.json();
      logger.info('Linked Task ID', data.id);

      return response;
    }

    throw new Error('Failed to link task');
  } catch (error) {
    logger.error(`Error linking task ${error}`);
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
