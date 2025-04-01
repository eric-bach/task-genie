import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { WorkItem, Comment, logger, GITHUB_ORGANIZATION, GITHUB_REPOSITORY } from '../index';

export const getParameter = async (name: string): Promise<string> => {
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const response = await ssmClient.send(command);
  return response.Parameter?.Value || '';
};

const getHeaders = async (): Promise<HeadersInit> => {
  const base64EncodedPAT = await getParameter(process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME || '');

  return {
    'Content-Type': 'application/json',
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

export const addComment = async (workItem: WorkItem, comment: Comment): Promise<string> => {
  logger.info(`Adding comment to work item ${workItem.workItemId}`, { workItem, comment });

  const headers = await getHeaders();

  const body = JSON.stringify({
    text: `<div><a href="#" data-vss-mention="version:2.0,{user id}">@${workItem.changedBy}</a> ${comment.text}</div>`,
  });

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${GITHUB_REPOSITORY}/_apis/wit/workItems/${workItem.workItemId}/comments?api-version=7.1-preview.4`;

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
