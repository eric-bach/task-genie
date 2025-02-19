import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const sfnUrl = `https://states.${process.env.AWS_REGION}.amazonaws.com`;
const sfnClient = new SFNClient({ region: process.env.AWS_REGION, endpoint: sfnUrl });
const stateMachineArn = process.env.STATE_MACHINE_ARN;

const logger = new Logger({ serviceName: 'parseUserStory' });

if (stateMachineArn === undefined) {
  throw new Error('STATE_MACHINE_ARN environment variable is required');
}

const lambdaHandler = async (event: APIGatewayProxyEventV2, context: Context) => {
  try {
    const body = JSON.parse(event.body || '{}');

    // Validate required fields
    if (
      !body.resource ||
      !body.resource.workItemId ||
      !body.resource.revision ||
      !body.resource.revision.fields ||
      !body.resource.revision.fields['System.Description'] ||
      !body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']
    ) {
      logger.info('Skipping: missing required fields in the request body');

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Missing required fields in the request body',
        }),
      };
    }

    const workItemId = body.resource.workItemId;
    logger.debug('Work Item ID: ', workItemId);

    const description = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Description'])));
    logger.debug('Description: ', description);

    const acceptanceCriteria = removeHtmlTags(
      JSON.parse(JSON.stringify(body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']))
    );
    logger.debug('Acceptance Criteria: ', acceptanceCriteria);

    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify({
        workItemId: workItemId,
        description: description,
        acceptanceCriteria: acceptanceCriteria,
      }),
    });

    logger.info('Executing state machine: ', stateMachineArn);

    const executionResult = await sfnClient.send(startExecutionCommand);

    logger.info('Result: ', JSON.stringify(executionResult));

    const response = {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Step Function execution started successfully!',
        executionArn: executionResult.executionArn,
        input: description,
      }),
    };
    return response;
  } catch (error: any) {
    logger.error('An error occurred', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error.message,
      }),
    };
  }
};

const removeHtmlTags = (input: string) => {
  const htmlRegex = /<[^>]*>/g;

  return input.replace(htmlRegex, '');
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
