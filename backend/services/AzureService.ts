import { Logger } from '@aws-lambda-powertools/logger';
import { Task, WorkItem } from '../types/azureDevOps';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsManagerClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

interface AzureDevOpsCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export class AzureService {
  private readonly logger: Logger;
  private azureDevOpsCredentials: AzureDevOpsCredentials | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.logger = new Logger({ serviceName: 'AzureService' });
  }

  private async getAzureDevOpsCredentials(): Promise<AzureDevOpsCredentials> {
    const azureDevOpsSecretName = process.env.AZURE_DEVOPS_CREDENTIALS_SECRET_NAME;
    if (!azureDevOpsSecretName) {
      this.logger.debug('Azure DevOps secret name not configured');
      throw new Error('Azure DevOps secret name not configured');
    }

    if (this.azureDevOpsCredentials) {
      return this.azureDevOpsCredentials;
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: azureDevOpsSecretName,
      });
      const response = await secretsManagerClient.send(command);

      if (!response.SecretString) {
        this.logger.error('Azure DevOps secret is empty', {
          secretName: azureDevOpsSecretName,
        });
        throw new Error('Azure DevOps secret is empty');
      }

      this.azureDevOpsCredentials = JSON.parse(response.SecretString) as AzureDevOpsCredentials;

      return this.azureDevOpsCredentials;
    } catch (error) {
      this.logger.warn('Failed to retrieve Azure DevOps credentials from Secrets Manager', {
        error: error instanceof Error ? error.message : 'Unknown error',
        secretName: azureDevOpsSecretName,
      });
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiresAt - 60000) {
      // Use cached token if not expired (minus 60s buffer)
      return this.accessToken;
    }

    // get values from secret manager
    const { tenantId, clientId, clientSecret, scope } = await this.getAzureDevOpsCredentials();

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope,
    });

    // this.logger.debug('Fetching Azure AD token', { url, body: body.toString() });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Failed to acquire Azure AD token: ${response.status} ${response.statusText} - ${errText}`);
      throw new Error(`Failed to acquire access token: ${response.statusText}`);
    }

    const tokenResponse = await response.json();

    this.accessToken = tokenResponse.access_token;
    this.tokenExpiresAt = now + tokenResponse.expires_in * 1000;

    if (!this.accessToken) {
      this.logger.error('Failed to parse token response', { response: JSON.stringify(response) });
      throw new Error('Failed to parse token response');
    }

    // this.logger.debug('Received Azure AD token');

    return this.accessToken;
  }

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
        const url = `${imageUrl}&download=true&api-version=7.1`;

        const headers = { Authorization: `Bearer ${await this.getAccessToken()}` };

        const response = await fetch(url, {
          headers,
        });

        if (!response.ok) {
          this.logger.warn(`Failed to fetch image: ${response.status} ${response.statusText}`, {
            url: url,
          });
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        this.logger.debug(`Successfully fetched image`, {
          url: url,
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

  async addComment(githubOrganization: string, workItem: WorkItem, comment: string) {
    this.logger.info(`⚙️ Adding comment to work item ${workItem.workItemId}`, { workItem, comment });

    try {
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}/comments?api-version=7.1-preview.4`;

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const body = JSON.stringify({
        text: `<div><a href="#" data-vss-mention="version:2.0,{user id}">@${workItem.changedBy}</a> ${comment}</div>`,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Added comment to work item ${data.id}`, { response: JSON.stringify(response) });

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
    this.logger.info(`⚙️ Adding tag to work item ${workItem.workItemId}`, { workItem, tag });

    const fields = [
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: tag,
      },
    ];

    try {
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}?api-version=7.1`;

      const headers = {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const body = JSON.stringify(fields);

      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body,
      });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Added tag to work item ${data.id}`, { response: JSON.stringify(response) });

        return body;
      } else {
        throw new Error('Failed to add tag');
      }
    } catch (error: any) {
      this.logger.error('An error occurred', { error: error });

      return error.message;
    }
  };

  async getTasksForWorkItem(githubOrganization: string, workItem: WorkItem): Promise<Task[]> {
    this.logger.info(`⚙️ Fetching tasks for work item ${workItem.workItemId}`);

    try {
      // Get tasks
      const tasks: Task[] = [];

      if (workItem.workItemId <= 0) {
        this.logger.info(`No existing tasks for work item ${workItem.workItemId}`);
        return tasks;
      }

      // Get work item details including relations
      const workItemUrl = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}?$expand=relations&api-version=7.1`;

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const response = await fetch(workItemUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to get work item details');
      }

      const data = await response.json();

      // Extract tasks ids from relations
      const taskIds: number[] = [];
      if (data.relations && Array.isArray(data.relations)) {
        for (const relation of data.relations) {
          if (relation.rel === 'System.LinkTypes.Hierarchy-Forward' && relation.url) {
            // Extract task ID from the URL
            const taskId = relation.url.split('/').pop();
            taskIds.push(taskId);
          }
        }
      }

      // If there are no task IDs, return empty array early
      if (taskIds.length === 0) {
        this.logger.info(`No existing tasks for work item ${workItem.workItemId}`);
        return tasks;
      }

      const tasksUrl = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitemsbatch?api-version=7.1`;

      const body = JSON.stringify({
        ids: taskIds,
        fields: ['System.Id', 'System.Title', 'System.Description', 'System.WorkItemType', 'System.State'],
      });

      const tasksResponse = await fetch(tasksUrl, {
        method: 'POST',
        headers,
        body,
      });

      if (!tasksResponse.ok) {
        throw new Error('Failed to get tasks');
      }

      const tasksData = await tasksResponse.json();

      if (tasksData.value && Array.isArray(tasksData.value)) {
        for (const taskItem of tasksData.value) {
          tasks.push({
            taskId: taskItem.id,
            title: taskItem.fields['System.Title'],
            description: taskItem.fields['System.Description'],
          });
        }
      }

      this.logger.info(`📋 Found ${tasks.length} existing tasks for work item ${workItem.workItemId}`);

      return tasks;
    } catch (error: any) {
      this.logger.error('Failed to fetch tasks for work item', {
        workItemId: workItem.workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async createTasks(githubOrganization: string, workItem: WorkItem, tasks: Task[]) {
    this.logger.info(`⚙️ Creating ${tasks.length} total tasks`, { tasks: tasks });

    let taskId = 0;
    let i = 0;
    for (const task of tasks) {
      this.logger.debug(`Creating task (${i}/${tasks.length})`, { task: task });

      taskId = await this.createTask(githubOrganization, workItem, task, ++i);

      // Set task Id
      task.taskId = taskId;
    }

    this.logger.info(`All ${tasks.length} tasks successfully created`);
  }

  async createTask(githubOrganization: string, workItem: WorkItem, task: Task, i: number): Promise<number> {
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

    try {
      const url = `https://${githubOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitems/$task?api-version=7.1`;

      const body = JSON.stringify(taskFields);

      const headers = {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      // logger.debug('Create task response', { response: JSON.stringify(response) });

      if (!response.ok) {
        throw new Error('Failed to create task');
      }

      const data = await response.json();

      this.logger.info(`Created task ${data.id}`);

      await this.linkTask(githubOrganization, workItem.teamProject, workItem.workItemId, data.id);

      return data.id;
    } catch (error) {
      this.logger.error('Error creating task', { error: error });
      throw new Error('Error creating task');
    }
  }

  linkTask = async (
    githubOrganization: string,
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

      const headers = {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      // this.logger.debug(`Linking task ${taskId} to work item ${workItemId}`);

      const response = await fetch(url, {
        method: 'PATCH',
        headers: headers,
        body: body,
      });

      // logger.debug('Link task repsonse', { response: JSON.stringify(response) });

      if (response.ok) {
        const data = await response.json();
        this.logger.info(`Linked task ${data.id} to work item ${workItemId}`);

        return;
      }

      throw new Error('Failed to link task');
    } catch (error) {
      this.logger.error('Error linking task', { error: error });
    }
  };
}
