import { Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const ORGANIZATION = 'amaabca';
const PROJECT = 'eric-test';

const logger = new Logger({ serviceName: 'addComment' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  const workItemId = body.workItemId;

  logger.debug('WorkItemId: ', workItemId);

  await addComment(workItemId);

  logger.debug('Work item updated');

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
    'Content-Type': 'application/json',
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

const addComment = async (workItemId: string) => {
  logger.info('Updating work item');

  const headers = await getHeaders();

  await createTask(headers, workItemId);

  logger.info('Work item updated');
};

const createTask = async (header: HeadersInit, workItemId: string) => {
  const body = JSON.stringify({ text: 'User story does not have sufficient details. Please provide more details.' });

  try {
    const url = `https://${ORGANIZATION}.visualstudio.com/${PROJECT}/_apis/wit/workitems/${workItemId}/comments?api-version=7.1-preview.4`;

    const response = await fetch(url, {
      method: 'POST',
      headers: header,
      body: body,
    });

    logger.debug('ADO response', JSON.stringify(response));

    if (response.ok) {
      const data = await response.json();
      logger.info(`Added comment to work item ${data.id}`);
    } else {
      throw new Error('Failed to add comment');
    }
  } catch (error) {
    logger.error(JSON.stringify(error));
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
