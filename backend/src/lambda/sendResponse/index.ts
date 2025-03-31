import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const logger = new Logger({ serviceName: 'sendResponse' });

const lambdaHandler = async (event: any, context: Context) => {
  const body = JSON.parse(event.body || '{}');

  return {
    statusCode: 200,
    body: JSON.stringify({
      response: 'Hello World',
    }),
  };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
