import { Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

if (GITHUB_REPOSITORY === undefined) {
  throw new Error('GITHUB_REPOSITORY environment variable is required');
}

const logger = new Logger({ serviceName: 'addComment' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const statusCode = event.statusCode;
  const { workItemId, changedBy, comment } = body;

  logger.info(`Received work item ${workItemId}`, {
    work_item_id: workItemId,
    work_item_changed_by: changedBy,
    status_code: statusCode,
    comment: comment,
  });

  const addCommentResponse = await addComment(workItemId, changedBy, statusCode, comment);

  return {
    statusCode: 200,
    body: JSON.stringify({
      response: addCommentResponse,
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
    'Content-Type': 'application/json',
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

const addComment = async (
  workItemId: string,
  changedBy: string,
  statusCode: number,
  comment: string
): Promise<string> => {
  logger.info('Adding comment to work item', { work_item_id: workItemId, status_code: statusCode });

  const headers = await getHeaders();

  const body = JSON.stringify({
    text: `<div><a href="#" data-vss-mention="version:2.0,{user id}">@${changedBy}</a> ${comment}</div>`,
  });

  try {
    const url = `https://${GITHUB_ORGANIZATION}.visualstudio.com/${GITHUB_REPOSITORY}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`;

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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
