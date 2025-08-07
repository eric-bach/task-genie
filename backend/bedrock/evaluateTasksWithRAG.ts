import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { WorkItem, BedrockResponse } from '../src/shared/types';

const AWS_REGION = 'us-west-2';
const AWS_BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = '2K9MIVRD0N';

const bedrockClient = new BedrockAgentRuntimeClient({
  endpoint: `https://bedrock-agent-runtime.${AWS_REGION}.amazonaws.com`,
  region: AWS_REGION,
});

const evaluateBedrock = async (workItem: WorkItem): Promise<BedrockResponse> => {
  const query = `
      Given the following work item, find any relevant information such as business or domain context, and technical
      details that can help you evaluate the user story:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
  `;

  const prompt = `
    You are an expert Agile software development assistant that reviews Azure DevOps work items. 
    You evaluate work items to ensure they are complete, clear, and ready for a developer to work on.
    Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    This is for educational and quality improvement purposes in a software development process.

    Evaluate the user story based on the following criteria:
      - Check if it clearly states the user, need, and business value.
      - Ensure acceptance criteria are present and specific.
      - Confirm the story is INVEST-aligned (Independent, Negotiable, Valuable, Estimable, Small, Testable).

    Return your assessment as a valid JSON object with the following structure:
      - "pass": boolean (true if the work item meets the quality bar, false otherwise)
      - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide
      a concrete example of a high-quality story that would pass. If you have multiple feedback points, use
      line breaks and indentations with HTML tags.
 
    Only output the JSON object, no additional text.
        
    The work item to review is: 
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
      
    Here may be some additional business or domain context that may help you:
      $search_results$`;

  const input: RetrieveAndGenerateCommandInput = {
    input: {
      text: query,
    },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
        //modelArn: `arn:aws:bedrock:${AWS_REGION}:${AWS_ACCOUNT}:foundation-model/${modelId}`,
        modelArn: 'arn:aws:bedrock:us-west-2:761018860881:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0',
        generationConfiguration: {
          promptTemplate: {
            textPromptTemplate: prompt,
          },
          inferenceConfig: {
            textInferenceConfig: {
              maxTokens: 2048,
              temperature: 0.5,
              topP: 0.9,
            },
          },
        },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 5,
          },
        },
      },
    },
  };

  console.log(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  try {
    const command = new RetrieveAndGenerateCommand(input);
    const response = await bedrockClient.send(command);

    console.log('Bedrock model invoked', { response: response.output });
    const content = response.output?.text;

    if (!content) {
      console.log('No content found in response', { response: response });
      throw new Error('No content found in response from Bedrock model.');
    }

    const bedrockResponse = safeJsonParse(content);

    if (!bedrockResponse) {
      console.log('Failed to parse JSON response', { content });
      throw new Error('Invalid JSON response from Bedrock model.');
    }

    console.log('Bedrock invocation response', { response: bedrockResponse });

    return bedrockResponse;
  } catch (error: any) {
    console.log('Bedrock model evaluation failed', {
      error: error.message,
      errorName: error.name,
      errorCode: error.$metadata?.httpStatusCode || error.statusCode,
      requestId: error.$metadata?.requestId,
      errorType: error.__type || error.code,
      modelId: AWS_BEDROCK_MODEL_ID,
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      region: AWS_REGION,
      modelArn: `arn:aws:bedrock:${AWS_REGION}::foundation-model/${AWS_BEDROCK_MODEL_ID}`,
    });
    console.error(
      `Bedrock model evaluation failed: ${error.name || 'Unknown'} - ${error.message || 'No error message available'}`
    );
    throw new Error(`Bedrock model evaluation failed: ${error.message || 'Unknown error'}`);
  }
};

// Sometimes the AI model returns invalid JSON with extra characters before and after the JSON string, so we need to extract the first valid JSON object from the string
function safeJsonParse<T = any>(input: string): T | undefined {
  // Find the first '{' and the last '}'
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return undefined; // No valid JSON found
  }

  const jsonSubstring = input.slice(start, end + 1);

  try {
    return JSON.parse(jsonSubstring);
  } catch {
    return undefined; // Invalid JSON
  }
}

evaluateBedrock({
  workItemId: 25800,
  changedBy: 'Eric Bach',
  title:
    'As a frequent traveler, I want to receive push notifications about gate changes so that I can navigate to the correct gate',
  description:
    'When gate changes occur within 2 hours of departure, send push notifications to users who have opted in and have the mobile app installed.',
  acceptanceCriteria:
    'GIVEN a traveler has opted in for notifications AND has the app installedWHEN their flight gate changes within 2 hours of departureTHEN they receive a push notification within 1 minute containing flight number, old gate, new gate, and departure timeGIVEN a traveler receives a gate change notificationWHEN they tap the notificationTHEN the app opens to the flight details screenGIVEN the notification service is unavailableWHEN a gate change occursTHEN the system logs the failure and retries every 30 seconds for up to 5 minutes',
  // BAD AC to make the evaluation fail
  //acceptanceCriteria: 'backend/bedrock/retrieveGenerate.ts',
  iterationPath: 'eric-test',
  tags: [],
});
