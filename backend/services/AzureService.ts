import { Logger } from '@aws-lambda-powertools/logger';
import {
  Task,
  WorkItem,
  UserStory,
  Epic,
  Feature,
  BaseWorkItem,
  getExpectedChildWorkItemType,
  ProductBacklogItem,
} from '../types/azureDevOps';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsManagerClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

interface AzureDevOpsCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export class AzureService {
  private readonly azureDevOpsOrganization: string;
  private readonly logger: Logger;
  private azureDevOpsCredentials: AzureDevOpsCredentials | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.logger = new Logger({ serviceName: 'AzureService' });

    if (!process.env.AZURE_DEVOPS_ORGANIZATION) {
      this.logger.warn('AZURE_DEVOPS_ORGANIZATION');
      throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
    }

    this.azureDevOpsOrganization = process.env.AZURE_DEVOPS_ORGANIZATION;
  }

  /**
   * Retrieves Azure DevOps credentials from AWS Secrets Manager
   * @returns The Azure DevOps credentials including tenant ID, client ID, client secret, and scope
   */
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

  /**
   * Retrieves and caches an Azure AD access token for API authentication
   * @returns A valid access token for Azure DevOps API calls
   */
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

    this.logger.debug('Refreshing new Azure AD token', {
      accessToken: this.accessToken.substring(0, 4) + '...' + this.accessToken.slice(-4),
      expiresIn: tokenResponse.expires_in,
    });

    return this.accessToken;
  }

  /**
   * Fetches an image from a URL and converts it to base64
   * @param imageUrl The URL of the image to fetch
   * @returns Object with base64 string and raw data, or null if failed
   */
  public async fetchImage(imageUrl: string): Promise<string | null> {
    try {
      // For Azure DevOps attachment URLs, add required query parameters and auth
      if (imageUrl.includes('visualstudio.com') || imageUrl.includes('azure.com')) {
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

        this.logger.debug('Successfully fetched image', {
          url: url,
          sizeKB: Math.round((base64.length * 3) / 4 / 1024),
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

      this.logger.debug('Successfully fetched image', {
        url: imageUrl,
        sizeKB: Math.round((base64.length * 3) / 4 / 1024),
      });

      return base64;
    } catch (error) {
      this.logger.warn(`Error fetching image`, {
        url: imageUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Adds a comment to an Azure DevOps work item
   * @param workItem The work item to add the comment to
   * @param comment The comment text to add
   * @returns The response body or error message
   */
  public async addComment(workItem: WorkItem, comment: string): Promise<string> {
    this.logger.info(`⚙️ Adding comment to work item ${workItem.workItemId}`, { workItem, comment });

    try {
      const url = `https://${this.azureDevOpsOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}/comments?api-version=7.1-preview.4`;

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

  /**
   * Adds a tag to an Azure DevOps work item
   * @param teamProject The team project name
   * @param workItemId The ID of the work item
   * @param tag The tag to add
   * @returns The response body or error message
   */
  public async addTag(teamProject: string, workItemId: number, tag: string): Promise<string> {
    this.logger.info(`⚙️ Adding tag to work item ${workItemId}`, { teamProject, workItemId, tag });

    const fields = [
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: tag,
      },
    ];

    try {
      const url = `https://${this.azureDevOpsOrganization}.visualstudio.com/${teamProject}/_apis/wit/workItems/${workItemId}?api-version=7.1`;

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
  }

  /**
   * Retrieves work item details by ID
   * @param workItemId The ID of the work item to fetch
   * @param teamProject The team project name
   * @returns The work item details including all fields
   */
  public async getWorkItem(workItemId: number, teamProject?: string): Promise<any> {
    this.logger.info(`⚙️ Fetching work item ${workItemId}`);

    try {
      const url = `https://${this.azureDevOpsOrganization}.visualstudio.com/${teamProject}/_apis/wit/workItems/${workItemId}?api-version=7.1`;

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        this.logger.error('Failed to fetch work item', {
          workItemId,
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to fetch work item ${workItemId}: ${response.statusText}`);
      }

      const workItemData = await response.json();

      this.logger.debug('Successfully fetched work item', {
        workItemId,
        hasFields: !!workItemData.fields,
        fieldsCount: workItemData.fields ? Object.keys(workItemData.fields).length : 0,
      });

      return workItemData;
    } catch (error) {
      this.logger.error('Error fetching work item', {
        workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Retrieves child work items associated with a specific work item based on Azure DevOps hierarchy
   * - Epic -> Features
   * - Feature -> User Stories
   * - User Story -> Tasks
   * @param workItem The parent work item to fetch children for
   * @returns Array of child work items with their complete type-specific information
   */
  public async getChildWorkItems(workItem: WorkItem): Promise<WorkItem[]> {
    this.logger.info(
      `⚙️ Fetching child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${workItem.workItemType} ${
        workItem.workItemId
      }`,
      {
        workItemId: workItem.workItemId,
        workItemType: workItem.workItemType,
        teamProject: workItem.teamProject,
        azureDevOpsOrganization: this.azureDevOpsOrganization,
      }
    );

    try {
      const childItems: WorkItem[] = [];

      if (workItem.workItemId <= 0) {
        this.logger.info(
          `No existing child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${workItem.workItemType} ${
            workItem.workItemId
          }`
        );
        return childItems;
      }

      // Get work item details including relations
      const workItemUrl = `https://${this.azureDevOpsOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}?$expand=relations&api-version=7.1`;

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const response = await fetch(workItemUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to get work item details', {
          status: response.status,
          statusText: response.statusText,
          errorResponse: errorText,
          workItemUrl: workItemUrl,
          workItemId: workItem.workItemId,
          teamProject: workItem.teamProject,
          organization: this.azureDevOpsOrganization,
        });
        throw new Error(`Failed to get work item details: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      // Extract child work item IDs from hierarchy relations
      const childIds: number[] = [];
      if (data.relations && Array.isArray(data.relations)) {
        for (const relation of data.relations) {
          if (relation.rel === 'System.LinkTypes.Hierarchy-Forward' && relation.url) {
            // Extract work item ID from the URL
            const childId = relation.url.split('/').pop();
            childIds.push(parseInt(childId, 10));
          }
        }
      }

      // If there are no child IDs, return empty array early
      if (childIds.length === 0) {
        this.logger.info(
          `No existing child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${workItem.workItemType} ${
            workItem.workItemId
          }`
        );
        return childItems;
      }

      const childItemsUrl = `https://${this.azureDevOpsOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitemsbatch?api-version=7.1`;

      const body = JSON.stringify({
        ids: childIds,
        fields: [
          'System.Id',
          'System.Title',
          'System.Description',
          'System.WorkItemType',
          'System.State',
          // User Story specific fields
          'Microsoft.VSTS.Common.AcceptanceCriteria',
          'Custom.Importance',
          // Epic specific fields
          'Custom.SuccessCriteria',
          'Custom.Objective',
          'Custom.AddressedRisks',
          'Custom.PursueRisk',
          'Custom.MostRecentUpdate',
          'Custom.OutstandingActionItems',
          // Feature specific fields
          'Custom.BusinessDeliverable',
          // Common custom fields
          'Custom.BusinessUnit',
          'Custom.System',
          'Custom.ReleaseNotes',
          'Custom.QANotes',
        ],
      });

      const childItemsResponse = await fetch(childItemsUrl, {
        method: 'POST',
        headers,
        body,
      });

      if (!childItemsResponse.ok) {
        throw new Error(
          `Failed to get child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${
            workItem.teamProject
          } ${workItem.workItemId}`
        );
      }

      const childItemsData = await childItemsResponse.json();

      // Determine expected child work item type
      const expectedChildType = getExpectedChildWorkItemType(workItem.workItemType);

      if (childItemsData.value && Array.isArray(childItemsData.value)) {
        for (const childItem of childItemsData.value) {
          const childWorkItemType = childItem.fields['System.WorkItemType'];

          // Filter by expected child type (but be flexible to handle different configurations)
          if (expectedChildType && childWorkItemType !== expectedChildType) {
            this.logger.warn(
              `Unexpected child work item type: expected ${expectedChildType}, found ${childWorkItemType}`,
              {
                parentType: workItem.workItemType,
                parentId: workItem.workItemId,
                childId: childItem.id,
                childType: childWorkItemType,
              }
            );
            // Continue processing rather than skipping, in case of custom configurations
          }

          // Ignore work items that are closed/resolved/removed
          if (
            childItem.fields['System.State'] === 'Removed' ||
            childItem.fields['System.State'] === 'Closed' ||
            childItem.fields['System.State'] === 'Resolved'
          ) {
            continue;
          }

          // Create the appropriate WorkItem type based on the work item type
          const workItemType = childItem.fields['System.WorkItemType'];
          const baseWorkItem: BaseWorkItem = {
            workItemId: childItem.id,
            title: childItem.fields['System.Title'],
            description: childItem.fields['System.Description'],
            state: childItem.fields['System.State'],
            tags: childItem.fields['System.Tags'] || '',
            areaPath: childItem.fields['System.AreaPath'] || '',
            iterationPath: childItem.fields['System.IterationPath'] || '',
            businessUnit: childItem.fields['Custom.BusinessUnit'] || '', // Required but may not be set in existing data
            system: childItem.fields['Custom.System'] || '', // Required but may not be set in existing data
            teamProject: workItem.teamProject,
            changedBy: childItem.fields['System.ChangedBy']?.displayName || '',
          };

          let childWorkItem: WorkItem;

          switch (workItemType) {
            case 'Epic':
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'Epic',
                successCriteria: childItem.fields['Custom.SuccessCriteria'],
                objective: childItem.fields['Custom.Objective'],
                addressedRisks: childItem.fields['Custom.AddressedRisks'],
                pursueRisk: childItem.fields['Custom.PursueRisk'],
                mostRecentUpdate: childItem.fields['Custom.MostRecentUpdate'],
                outstandingActionItems: childItem.fields['Custom.OutstandingActionItems'],
              } as Epic;
              break;

            case 'Feature':
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'Feature',
                successCriteria: childItem.fields['Custom.SuccessCriteria'],
                businessDeliverable: childItem.fields['Custom.BusinessDeliverable'],
              } as Feature;
              break;

             case 'Product Backlog Item':
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'Product Backlog Item',
                acceptanceCriteria: childItem.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '',
                releaseNotes: childItem.fields['Custom.ReleaseNotes'] || '',
                qaNotes: childItem.fields['Custom.QANotes'] || '',
              } as ProductBacklogItem;
              break;


            case 'User Story':
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'User Story',
                acceptanceCriteria: childItem.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '',
                importance: childItem.fields['Custom.Importance'],
              } as UserStory;
              break;

            case 'Task':
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'Task',
              } as Task;
              break;

            default:
              // Fall back to creating a basic Task for unknown types
              childWorkItem = {
                ...baseWorkItem,
                workItemType: 'Task',
              } as Task;
              break;
          }

          childItems.push(childWorkItem);
        }
      }

      this.logger.info(
        `📋 Found ${childItems.length} child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${
          workItem.workItemType
        } ${workItem.workItemId}`,
        {
          expectedChildType,
          actualChildren: childItems.map((item) => ({ id: item.workItemId, title: item.title })),
        }
      );

      return childItems;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch child ${getExpectedChildWorkItemType(workItem.workItemType, true)} in ${
          workItem.workItemType
        } ${workItem.workItemId}`,
        {
          workItemType: workItem.workItemType,
          workItemId: workItem.workItemId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Creates multiple child work items for a work item in Azure DevOps
   * The type of child work items created depends on the parent type:
   * - Epic -> Features
   * - Feature -> User Stories
   * - User Story -> Tasks
   * @param workItem The parent work item to create children for
   * @param childWorkItems Array of child work items to create
   */
  public async createChildWorkItems(workItem: WorkItem, childWorkItems: WorkItem[]): Promise<void> {
    const childWorkItemType = getExpectedChildWorkItemType(workItem.workItemType) || 'Task';
    const childTypePlural = getExpectedChildWorkItemType(workItem.workItemType, true);

    this.logger.info(
      `⚙️ Creating ${childWorkItems.length} ${childTypePlural} for ${workItem.workItemType} ${workItem.workItemId}`,
      {
        parentType: workItem.workItemType,
        parentId: workItem.workItemId,
        childType: childWorkItemType,
        count: childWorkItems.length,
        tasks: childWorkItems.map((t) => ({ title: t.title })),
      }
    );

    let id = 0;
    let i = 0;
    for (const c of childWorkItems) {
      this.logger.debug(`Creating ${childWorkItemType} (${++i}/${childWorkItems.length})`, { task: c });

      id = await this.createChildWorkItem(workItem, c as Feature | UserStory | Task, i);

      // Set task Id
      c.workItemId = id;
    }

    this.logger.info(
      `✅ All ${childWorkItems.length} ${childTypePlural} successfully created for ${workItem.workItemType} ${workItem.workItemId}`,
      {
        parentType: workItem.workItemType,
        parentId: workItem.workItemId,
        childType: childWorkItemType,
        createdIds: childWorkItems.map((t) => t.workItemId),
      }
    );
  }

  /**
   * Creates a single child work item in Azure DevOps and links it to the parent work item
   * The type of child work item created depends on the parent type:
   * - Epic -> Feature
   * - Feature -> User Story
   * - User Story -> Task
   * @param workItem The parent work item
   * @param task The child work item to create
   * @param i The task index (for logging purposes)
   * @returns The ID of the created child work item
   */
  public async createChildWorkItem(
    workItem: WorkItem,
    childWorkItem: Feature | UserStory | Task,
    i: number
  ): Promise<number> {
    // Determine the appropriate child work item type
    const childWorkItemType = getExpectedChildWorkItemType(workItem.workItemType) || 'Task';

    const childWorkItemFields = [
      {
        op: 'add',
        path: '/fields/System.Title',
        value: childWorkItem.title,
      },
      {
        op: 'add',
        path: '/fields/System.Description',
        value: childWorkItem.description,
      },
      {
        op: 'add',
        path: '/fields/System.AreaPath',
        value: workItem.areaPath,
      },
      {
        op: 'add',
        path: '/fields/System.IterationPath',
        value: workItem.iterationPath,
      },
      {
        op: 'add',
        path: '/fields/System.WorkItemType',
        value: childWorkItemType,
      },
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: 'Task Genie',
      },
    ];

    if (childWorkItemType === 'User Story') {
      const c = childWorkItem as UserStory;

      // Add User Story specific fields
      childWorkItemFields.push(
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
          value: c.acceptanceCriteria || '',
        },
        {
          op: 'add',
          path: '/fields/Custom.Importance',
          value: c.importance || '',
        }
      );
    } else if (childWorkItemType === 'Feature') {
      const c = childWorkItem as Feature;
      childWorkItemFields.push(
        {
          op: 'add',
          path: '/fields/Custom.SuccessCriteria',
          value: c.successCriteria || '',
        },
        {
          op: 'add',
          path: '/fields/Custom.BusinessDeliverable',
          value: c.businessDeliverable || '',
        }
      );
    }

    try {
      // Use the appropriate endpoint template based on child work item type
      const workItemTypeTemplate = childWorkItemType.replace(' ', '%20'); // URL encode spaces
      const url = `https://${this.azureDevOpsOrganization}.visualstudio.com/${workItem.teamProject}/_apis/wit/workitems/$${workItemTypeTemplate}?api-version=7.1`;

      const body = JSON.stringify(childWorkItemFields);

      const headers = {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Failed to create ${childWorkItemType}`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          parentType: workItem.workItemType,
          parentId: workItem.workItemId,
        });
        throw new Error(`Failed to create ${childWorkItemType}: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      this.logger.info(`Created ${childWorkItemType} ${data.id} for ${workItem.workItemType} ${workItem.workItemId}`, {
        childType: childWorkItemType,
        childId: data.id,
        parentType: workItem.workItemType,
        parentId: workItem.workItemId,
        title: childWorkItem.title,
      });

      await this.linkTask(workItem.teamProject, workItem.workItemId, data.id);

      return data.id;
    } catch (error) {
      this.logger.error(`Error creating ${childWorkItemType}`, {
        error: error,
        parentType: workItem.workItemType,
        parentId: workItem.workItemId,
        childType: childWorkItemType,
      });
      throw new Error(
        `Error creating ${childWorkItemType}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Links a task to its parent work item in Azure DevOps
   * @param teamProject The team project name
   * @param workItemId The ID of the parent work item
   * @param taskId The ID of the task to link
   */
  public async linkTask(teamProject: string, workItemId: number, taskId: string): Promise<void> {
    try {
      const url = `https://${this.azureDevOpsOrganization}.visualstudio.com/${teamProject}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

      const body = `[
        {
          "op": "add",
          "path": "/relations/-",
          "value": {
            "rel": "System.LinkTypes.Hierarchy-Forward",
            "url": "https://${this.azureDevOpsOrganization}.visualstudio.com/${teamProject}/_apis/wit/workItems/${taskId}",
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
  }
}
