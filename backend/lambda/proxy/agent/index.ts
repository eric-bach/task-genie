import {
  Context,
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore'; // ES Modules import
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const agentRuntimeArn = process.env.BEDROCK_AGENTCORE_RUNTIME_ARN;

if (!agentRuntimeArn) {
  throw new Error(
    'Server configuration error: Missing BEDROCK_AGENTCORE_RUNTIME_ARN'
  );
}

function generateSessionId(length: number): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const client = new BedrockAgentCoreClient();

  const input = {
    runtimeSessionId: generateSessionId(33), // Must be 33+ char. Every new SessionId will create a new MicroVM
    agentRuntimeArn,
    qualifier: 'DEFAULT', // This is Optional. When the field is not provided, Runtime will use DEFAULT endpoint
    payload: new TextEncoder().encode(JSON.stringify(event)),
  };

  const command = new InvokeAgentRuntimeCommand(input);
  const response = await client.send(command);
  const textResponse = await response.response?.transformToString();

  return {
    statusCode: 200,
    body: JSON.stringify({ textResponse }),
  };
};
