import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { logger, GITHUB_ORGANIZATION } from '../index';
import { WorkItem } from '../../../shared/types';

export const getParameter = async (name: string): Promise<string> => {
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const response = await ssmClient.send(command);
  return response.Parameter?.Value || '';
};

const getHeaders = async (contentType: string): Promise<HeadersInit> => {
  const base64EncodedPAT = await getParameter(process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME || '');

  return {
    'Content-Type': contentType,
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

export const addComment = async (workItem: WorkItem, comment: string) => {
  logger.info(`Adding comment to work item ${workItem.workItemId}`, { workItem, comment });

  const headers = await getHeaders('application/json');

  const body = JSON.stringify({
    text: `<div><a href="#" data-vss-mention="version:2.0,{user id}">@${workItem.changedBy}</a> ${comment}</div>`,
  });

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}/comments?api-version=7.1-preview.4`;

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body,
    });

    logger.debug('Add comment response', { response: JSON.stringify(response) });

    if (response.ok) {
      const data = await response.json();
      logger.info(`Added comment to work item ${data.id}`);

      return body;
    } else {
      throw new Error('Failed to add comment');
    }
  } catch (error: any) {
    logger.error('An error occurred', { error: error });

    return error.message;
  }
};

export const addTag = async (workItem: WorkItem, tag: string): Promise<string> => {
  logger.info(`Adding tag to work item ${workItem.workItemId}`, { workItem, tag });

  const headers = await getHeaders('application/json-patch+json');

  const fields = [
    {
      op: 'add',
      path: '/fields/System.Tags',
      value: tag,
    },
  ];
  const body = JSON.stringify(fields);

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${workItem.teamProject}/_apis/wit/workItems/${workItem.workItemId}?api-version=7.1`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: body,
    });

    logger.debug('Add tag response', { response: JSON.stringify(response) });

    if (response.ok) {
      const data = await response.json();
      logger.info(`Added tag to work item ${data.id}`);

      return body;
    } else {
      throw new Error('Failed to add tag');
    }
  } catch (error: any) {
    logger.error('An error occurred', { error: error });

    return error.message;
  }
};
