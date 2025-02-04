import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });
const stateMachineArn = process.env.STATE_MACHINE_ARN;

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const body = JSON.parse(event.body || '{}');

  const workItemId = body.resource.workItemId;
  console.log('Work Item ID: ', workItemId);

  // const description = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.fields['System.Description'])).newValue);
  const description = removeHtmlTags(JSON.parse(JSON.stringify(body.resource.revision.fields['System.Description'])));
  console.log(description);
  const acceptanceCriteria = removeHtmlTags(
    JSON.parse(JSON.stringify(body.resource.revision.fields['Microsoft.VSTS.Common.AcceptanceCriteria']))
  );
  console.log(acceptanceCriteria);

  try {
    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify({
        workItemId: workItemId,
        description: description,
        acceptanceCriteria: acceptanceCriteria,
      }),
    });

    const executionResult = await sfnClient.send(startExecutionCommand);

    console.log('Result: ', executionResult);

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
