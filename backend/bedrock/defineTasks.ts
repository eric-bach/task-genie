import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';

const USER_STORIES = [
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

async function defineTasks(title: string, description: string, acceptanceCriteria: string) {
  const PROMPT = `You are a technical product owner for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
    You will return a result in a JSON format with one attribute key being tasks. This is a list. If no tasks are needed this will be empty.
    Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
    The parent task title to review is: ${title} along with the description: ${description} and along with the acceptance criteria: ${acceptanceCriteria}.
    Only generate tasks where it is completely neccessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
    Investigation and analysis should not have separate tasks.
    Not tasks for analyzing, no tasks for regression testing.
    Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
    Add a prefix to each task title to denote it's order in the sequence of tasks to be completed. For example, if there are 3 tasks, the first task would have a title of "1. Task Title".
    Only return JSON, no text. JSON should be a single line`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: PROMPT }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5, topP: 0.9 },
  };

  try {
    const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2', profile: AWS_PROFILE });

    const command = new ConverseCommand(input);
    const response = await bedrockClient.send(command);

    // Get tasks
    const text: string = response.output?.message?.content
      ? response.output?.message?.content[0].text || '{tasks:[{}]}'
      : '{tasks:[{}]}';
    const tasks = JSON.parse(text).tasks;

    console.log(`✔ Identified ${tasks.length} tasks:`);
    console.log(JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error(`💣 An error has occurred: ${error}`);
  }
}

async function main() {
  let i = 0;

  for (const { title, description, acceptanceCriteria } of USER_STORIES) {
    console.log(`🚀 Evaluating user story ${++i}:\n`);

    await defineTasks(title, description, acceptanceCriteria);

    console.log('\n');
  }
}

main();
