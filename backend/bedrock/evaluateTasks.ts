import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';

const USER_STORIES = [
  {
    title: 'A title',
    description: 'stuff',
    acceptanceCriteria: 'blah',
  },
  {
    title: 'Bad User Story',
    description: 'Test Test',
    acceptanceCriteria: 'blaha',
  },
  {
    title:
      'As a frequent traveler, I want to receive notifications about gate changes so that I can avoid missing my flight.',
    description:
      "Frequent travelers often face the challenge of keeping track of gate changes, which can occur unexpectedly and cause confusion and inconvenience. Missing a flight due to last-minute gate changes can be stressful and disruptive. By providing timely notifications about gate changes directly to travelers' mobile devices, we help ensure they are informed in real-time and can make their way to the new gate without delay.",
    acceptanceCriteria:
      'GIVEN a frequent traveler has a booked flight, WHEN a gate change occurs, THEN the traveler receives a notification with the updated gate information.',
  },
];
const AWS_BEDROCK_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';
const AWS_PROFILE = 'observability2';

async function evaluateTasks(title: string, description: string, acceptanceCriteria: string) {
  const PROMPT = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
    You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
    A second optional JSON attribute key will be called comment where you are providing guidance and provide an example of how the work item would meet the pass requirements.
    Focus on whether a developer would understand without being pedantic.
    Ensure there is a clear title, user story and acceptance criteria.
    The task title to review is: ${title} along with the description: ${description} and the acceptance criteria: ${acceptanceCriteria}.
    Only return JSON, no text. JSON should be a single line.`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: PROMPT }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  };

  try {
    const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2', profile: AWS_PROFILE });

    const command = new ConverseCommand(input);
    const response = await bedrockClient.send(command);

    const content = response.output?.message?.content;

    if (!content || !content[0].text) {
      console.error('No content found in response', { response: response });
      throw new Error('No content found in response');
    }

    const jsonResponse = JSON.parse(content[0].text);
    if (jsonResponse.pass === true) {
      console.log(`✔  Work item meets requirements`);
    } else {
      console.log(`❌ Work item does not meet requirements\n${jsonResponse.comment}`);
    }
  } catch (error) {
    console.error(`💣 An error has occurred: ${error}`);
  }
}

async function main() {
  let i = 0;

  for (const { title, description, acceptanceCriteria } of USER_STORIES) {
    console.log(`🚀 Evaluating user story ${++i}:\n`);

    await evaluateTasks(title, description, acceptanceCriteria);

    console.log('\n');
  }
}

main();
