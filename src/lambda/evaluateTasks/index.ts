import { Context } from 'aws-lambda';
import * as bedrock from '@aws-sdk/client-bedrock-runtime';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const bedrockUrl = `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`;
const bedrockClient = new bedrock.BedrockRuntimeClient({ endpoint: bedrockUrl });
const bedrockModelId = process.env.AWS_BEDROCK_MODEL_ID;

const logger = new Logger({ serviceName: 'evaluateTasks' });

if (bedrockModelId === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const lambdaHandler = async (event: any, context: Context) => {
  const description = event.description;
  const acceptanceCriteria = event.acceptanceCriteria;

  logger.debug('Description: ', description);
  logger.debug('Acceptance Criteria: ', acceptanceCriteria);

  const userMessage = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
    You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
    A second optional JSON attribute key will be called comment where you are providing guidance and provide an example of how the work item would meet the pass requirements.
    Focus on whether a developer would understand without being pedantic.
    Ensure there is a user story and acceptance criteria.
    The task description to review is: ${description} along with the acceptance criteria: ${acceptanceCriteria}.
    Only return JSON, no text. JSON should be a single line.`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: userMessage }],
    },
  ];

  const input: bedrock.ConverseCommandInput = {
    modelId: bedrockModelId,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  };

  logger.info('Executing bedrock model: ', bedrockModelId);

  const command = new bedrock.ConverseCommand(input);
  const response = await bedrockClient.send(command);

  logger.info('Result: ', JSON.stringify(response.output));

  const content = response.output?.message?.content;

  if (content && content[0].text) {
    const jsonResponse = JSON.parse(content[0].text);

    if (jsonResponse.pass === true) {
      logger.info('Work Item meets quality bar');

      return {
        statusCode: 200,
        body: JSON.stringify({ workItemId: event.workItemId, description, acceptanceCriteria }),
      };
    }

    // TODO Add comment to work item

    logger.error('Work Item does not meet quality bar: ', jsonResponse.comment);

    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Work Item does not meet quality bar',
        comment: jsonResponse.comment,
      }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
