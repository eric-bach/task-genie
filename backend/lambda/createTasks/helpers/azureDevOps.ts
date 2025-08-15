import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { GITHUB_ORGANIZATION, logger } from '../index';
import { Task, WorkItem } from '../../../shared/types';

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

export const createTasks = async (workItem: WorkItem, tasks: Task[]) => {
  logger.info(`Creating ${tasks.length} total tasks`, { tasks: tasks });

  const headers = await getHeaders();

  let taskId = 0;
  let i = 0;
  for (const task of tasks) {
    taskId = await createTask(headers, workItem, task, ++i);

    // Set task Id
    task.taskId = taskId;
  }

  logger.info(`All ${tasks.length} tasks created`);
};

const createTask = async (header: HeadersInit, workItem: WorkItem, task: Task, i: number): Promise<number> => {
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
      path: '/fields/System.IterationPath',
      value: workItem.areaPath,
    },
    {
      op: 'add',
      path: '/fields/System.WorkItemType',
      value: 'Task',
    },
  ];

  const body = JSON.stringify(taskFields);

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitems/$task?api-version=7.1`;

    logger.debug(`Creating task (${i})`, { task: task });

    const response = await fetch(url, {
      method: 'POST',
      headers: header,
      body: body,
    });

    // logger.debug('Create task response', { response: JSON.stringify(response) });

    if (!response.ok) {
      throw new Error('Failed to create task');
    }

    const data = await response.json();
    logger.info(`Created task ${data.id}`);

    await linkTask(header, workItem.teamProject, workItem.workItemId, data.id);

    return data.id;
  } catch (error) {
    logger.error('Error creating task', { error: error });
    throw new Error('Error creating task');
  }
};

const linkTask = async (
  headers: HeadersInit,
  teamProject: string,
  workItemId: number,
  taskId: string
): Promise<void> => {
  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${teamProject}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

    const body = `[
        {
          "op": "add",
          "path": "/relations/-",
          "value": {
            "rel": "System.LinkTypes.Hierarchy-Forward",
            "url": "https://${GITHUB_ORGANIZATION}.visualstudio.com/${teamProject}/_apis/wit/workItems/${taskId}",
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

    // logger.debug('Link task repsonse', { response: JSON.stringify(response) });

    if (response.ok) {
      const data = await response.json();
      logger.info(`Linked task ${data.id}`);

      return;
    }

    throw new Error('Failed to link task');
  } catch (error) {
    logger.error('Error linking task', { error: error });
  }
};
