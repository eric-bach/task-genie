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
      !body.resource.revision.fields['System.ChangedBy'] ||
      !body.resource.revision.fields['System.Title'] ||
      !body.resource.revision.fields['System.Description'] ||
      !body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']
    ) {
      logger.info('Work item is missing one or more required fields', {
        work_item_id: body.resource.workItemId ?? 0,
        work_item_changed_by: body.resource.revision.fields['System.ChangedBy'] ?? '',
        work_item_title: body.resource.revision.fields['System.Title'] ?? '',
        work_item_description: body.resource.revision.fields['System.Description'] ?? '',
        work_item_acceptance_criteria: body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '',
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Work item is missing one or more required fields',
        }),
      };
    }

    const workItemId = body.resource.workItemId;
    const changedBy = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.ChangedBy'])));
    const title = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Title'])));
    const description = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Description'])));
    const acceptanceCriteria = removeHtmlTags(
      JSON.parse(JSON.stringify(body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']))
    );
    logger.info('Received work item', {
      work_item_id: workItemId,
      work_item_changed_by: changedBy,
      work_item_title: title,
      work_item_description: description,
      work_item_acceptance_criteria: acceptanceCriteria,
    });

    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify({
        workItemId,
        changedBy,
        title,
        description,
        acceptanceCriteria,
      }),
    });

    logger.info('Executing state machine', { state_maching_arn: stateMachineArn });

    const executionResult = await sfnClient.send(startExecutionCommand);

    logger.info('State machine executed', { result: JSON.stringify(executionResult) });

    const response = {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Step Function execution started successfully',
        executionArn: executionResult.executionArn,
      }),
    };
    return response;
  } catch (error: any) {
    logger.error('An error occurred', { error: error });

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

  return input.replace(htmlRegex, '').trim();
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
