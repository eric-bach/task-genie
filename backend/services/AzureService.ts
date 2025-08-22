import { Logger } from '@aws-lambda-powertools/logger';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Task, WorkItem } from '../types/azureDevOps';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

export class AzureService {
  private readonly logger: Logger;
  private personalAccessToken: string | null;

  constructor(personalAccessToken: string | null) {
    this.personalAccessToken = personalAccessToken;
    this.logger = new Logger({ serviceName: 'AzureService' });
  }

  /**
   * Retrieve Azure DevOps PAT from Parameter Store
   */
  getPersonalAccessToken = async (): Promise<string | null> => {
    if (this.personalAccessToken !== null) {
      return this.personalAccessToken;
    }

    const parameterName = process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME;
    if (!parameterName) {
      this.logger.debug('Azure DevOps PAT parameter name not configured');
      return null;
    }

    try {
      const command = new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      });
      const response = await ssmClient.send(command);

      this.personalAccessToken = response.Parameter?.Value || null;
      return this.personalAccessToken;
    } catch (error) {
      this.logger.warn('Failed to retrieve Azure DevOps PAT from Parameter Store', {
        error: error instanceof Error ? error.message : 'Unknown error',
        parameterName,
      });
      return null;
    }
  };

  /**
   * Fetches an image from a URL and converts it to base64
   * @param imageUrl The URL of the image to fetch
   * @param logger Logger instance for debugging
   * @returns Object with base64 string and raw data, or null if failed
   */
  fetchImage = async (imageUrl: string): Promise<string | null> => {
    try {
      // For Azure DevOps attachment URLs, add required query parameters and auth
      if (imageUrl.includes('visualstudio.com')) {
        const finalUrl = `${imageUrl}&download=true&api-version=7.1`;

        const adoPat = await this.getPersonalAccessToken();
        if (!adoPat) {
          this.logger.warn('No Azure DevOps PAT available for image download');
          return null;
        }

        this.logger.debug(`Fetching image from Azure DevOps`, {
          url: imageUrl,
        });

        const response = await fetch(finalUrl, {
          headers: { Authorization: `Basic ${adoPat}` },
        });

        if (!response.ok) {
          this.logger.warn(`Failed to fetch image: ${response.status} ${response.statusText}`, {
            url: finalUrl,
          });
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        this.logger.debug(`Successfully fetched image`, {
          url: finalUrl,
          sizeKB: Math.round((arrayBuffer.byteLength * 3) / 4 / 1024),
        });

        return base64;
      }

      // For non-Azure DevOps images, use simple fetch
      const response = await fetch(imageUrl, {
        headers: { 'User-Agent': 'TaskGenie/1.0' },
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch image: ${response.status} ${response.statusText}`, {
          url: imageUrl,
        });
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      this.logger.debug(`Successfully fetched image`, {
        url: imageUrl,
        sizeKB: Math.round((arrayBuffer.byteLength * 3) / 4 / 1024),
      });

      return base64;
    } catch (error) {
      this.logger.warn(`Error fetching image`, {
        url: imageUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  };

  async getHeaders(contentType: string): Promise<HeadersInit> {
    const personalAccessToken = await this.getPersonalAccessToken();

    return {
      'Content-Type': contentType,
      Authorization: `Basic ${personalAccessToken}`,
    };
  }

  async addComment(githubOrganization: string, workItem: WorkItem, comment: string) {
    this.logger.info(`Adding comment to work item ${workItem.workItemId}`, { workItem, comment });

    const headers = await this.getHeaders('application/json');

    const body = JSON.stringify({
      text: `<div><a href="#" data-vss-mention="version:2.0,{user id}">@${workItem.changedBy}</a> ${comment}</div>`,
    });

    try {
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}/comments?api-version=7.1-preview.4`;

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
      });

      this.logger.debug('Add comment response', { response: JSON.stringify(response) });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Added comment to work item ${data.id}`);

        return body;
      } else {
        throw new Error('Failed to add comment');
      }
    } catch (error: any) {
      this.logger.error('An error occurred', { error: error });

      return error.message;
    }
  }

  addTag = async (githubOrganization: string, workItem: WorkItem, tag: string): Promise<string> => {
    this.logger.info(`Adding tag to work item ${workItem.workItemId}`, { workItem, tag });

    const headers = await this.getHeaders('application/json-patch+json');

    const fields = [
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: tag,
      },
    ];
    const body = JSON.stringify(fields);

    try {
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}?api-version=7.1`;

      const response = await fetch(url, {
        method: 'PATCH',
        headers: headers,
        body: body,
      });

      this.logger.debug('Add tag response', { response: JSON.stringify(response) });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Added tag to work item ${data.id}`);

        return body;
      } else {
        throw new Error('Failed to add tag');
      }
    } catch (error: any) {
      this.logger.error('An error occurred', { error: error });

      return error.message;
    }
  };

  async createTasks(githubOrganization: string, workItem: WorkItem, tasks: Task[]) {
    this.logger.info(`Creating ${tasks.length} total tasks`, { tasks: tasks });

    const headers = await this.getHeaders('application/json-patch+json');

    let taskId = 0;
    let i = 0;
    for (const task of tasks) {
      taskId = await this.createTask(githubOrganization, headers, workItem, task, ++i);

      // Set task Id
      task.taskId = taskId;
    }

    this.logger.info(`All ${tasks.length} tasks created`);
  }

  createTask = async (
    githubOrganization: string,
    header: HeadersInit,
    workItem: WorkItem,
    task: Task,
    i: number
  ): Promise<number> => {
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
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitems/$task?api-version=7.1`;

      this.logger.debug(`Creating task (${i})`, { task: task });

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
      this.logger.info(`Created task ${data.id}`);

      await this.linkTask(githubOrganization, header, workItem.teamProject, workItem.workItemId, data.id);

      return data.id;
    } catch (error) {
      this.logger.error('Error creating task', { error: error });
      throw new Error('Error creating task');
    }
  };

  linkTask = async (
    githubOrganization: string,
    headers: HeadersInit,
    teamProject: string,
    workItemId: number,
    taskId: string
  ): Promise<void> => {
    try {
      const url = `https://${githubOrganization}.visualstudio.com/${teamProject}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

      const body = `[
        {
          "op": "add",
          "path": "/relations/-",
          "value": {
            "rel": "System.LinkTypes.Hierarchy-Forward",
            "url": "https://${githubOrganization}.visualstudio.com/${teamProject}/_apis/wit/workItems/${taskId}",
            "attributes": {
              "comment": "Linking dependency"
            }
          }
        }
      ]`;

      this.logger.debug(`Linking task ${taskId} to work item ${workItemId}`);

      const response = await fetch(url, {
        method: 'PATCH',
        headers: headers,
        body: body,
      });

      // logger.debug('Link task repsonse', { response: JSON.stringify(response) });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Linked task ${data.id}`);

        return;
      }

      throw new Error('Failed to link task');
    } catch (error) {
      this.logger.error('Error linking task', { error: error });
    }
  };
}
