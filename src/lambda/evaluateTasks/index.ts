import { Context } from 'aws-lambda';
import * as bedrock from '@aws-sdk/client-bedrock-runtime';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';

export const handler = async (event: any, context: Context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const description = event.description;
  console.log('Description: ', description);
  const acceptanceCriteria = event.acceptanceCriteria;
  console.log('Acceptance Criteria: ', acceptanceCriteria);

  const bedrockClient = new bedrock.BedrockRuntimeClient({ region: process.env.AWS_REGION });

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
    modelId: process.env.AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  };

  const command = new bedrock.ConverseCommand(input);
  const response = await bedrockClient.send(command);

  const content = response.output?.message?.content;

  if (content && content[0].text) {
    const jsonResponse = JSON.parse(content[0].text);

    if (jsonResponse.pass === true) {
      return {
        statusCode: 200,
        body: JSON.stringify({ workItemId: event.workItemId, description, acceptanceCriteria }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Work Item does not meet quality bar',
        comment: jsonResponse.comment,
      }),
    };
  }
};
