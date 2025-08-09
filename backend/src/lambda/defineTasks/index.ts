import { Context } from 'aws-lambda';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task, BedrockConfig, BedrockResponse } from '../../shared/types';

const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
if (AWS_ACCOUNT_ID === undefined) {
  throw new Error('AWS_ACCOUNT_ID environment variable is required');
}
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
if (AWS_BEDROCK_KNOWLEDGE_BASE_ID === undefined) {
  throw new Error('AWS_BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
}

const bedrockClient = new BedrockAgentRuntimeClient({
  endpoint: `https://bedrock-agent-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: process.env.AWS_REGION || 'us-west-2',
});
const logger = new Logger({ serviceName: 'defineTasks' });

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
    logger.debug('Received event from Step Functions', { event });
    const body = validateEventBody(event.body);

    // Parse event body
    const { workItem, params, workItemStatus } = parseEventBody(body);

    // Invoke Bedrock
    const tasks = await evaluateBedrock(workItem, params);
    logger.info(`✅ Identified ${tasks.length} tasks`, { tasks: JSON.stringify(tasks) });

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error });

    return {
      statusCode: 500,
      error: error.message,
    };
  }
};

const validateEventBody = (body: any) => {
  if (!body || !body.workItem) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseEventBody = (body: any): { workItem: WorkItem; params: BedrockConfig; workItemStatus: BedrockResponse } => {
  const { params, workItem, workItemStatus } = body;

  if (params) {
    logger.info(`Received work item ${workItem.workItemId}`, {
      workItem,
      params,
      workItemStatus,
    });
  } else {
    logger.info(`Received work item ${workItem.workItemId}`, {
      workItem: workItem,
      workItemStatus,
    });
  }

  return { params: params ?? {}, workItem, workItemStatus };
};

const evaluateBedrock = async (workItem: WorkItem, params: BedrockConfig): Promise<Task[]> => {
  const query = `
      Given the following work item, find any relevant information such as business or domain context, and 
      technical details that can help you evaluate the user story:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
  `;
  const prompt =
    params.prompt ||
    `You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing 
    work items into actionable tasks.

    Your task is to break down the provided work item into a sequence of tasks that are clear and actionable
    for developers to work on. Each task should be independent and deployable separately.

    Ensure each task has a title and a comprehensive description that guides the developer (why, what, how,
    technical details, references to relevant systems/APIs). Do NOT create any tasks for analyzing,
    investigating, analyzing, testing, or deployment.
  `;
  const fullPrompt = `${prompt}. 
      Only return your assessment as a JSON object with the following structure:
      - "tasks": array of task objects, each with:
        - "title": string (task title, prefixed with its order in the sequence, e.g., "1. Task Title")
        - "description": string (detailed task description). Please use HTML tags for formatting, such as <br> for
        line breaks, to make it easier to read.
      
      DO NOT output any text outside of the JSON object.

      The work item to decompose is:
        - Title: ${workItem.title} 
        - Description: ${workItem.description} 
        - Acceptance Criteria: ${workItem.acceptanceCriteria}

      Here may be some additional business, domain context, and technical details that may help you:
        $search_results$`;

  const input: RetrieveAndGenerateCommandInput = {
    input: {
      text: query,
    },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
        modelArn: `arn:aws:bedrock:${AWS_REGION}:${AWS_ACCOUNT_ID}:inference-profile/${AWS_BEDROCK_MODEL_ID}`,
        generationConfiguration: {
          promptTemplate: {
            textPromptTemplate: fullPrompt,
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

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  try {
    const command = new RetrieveAndGenerateCommand(input);
    const response = await bedrockClient.send(command);

    console.debug('Bedrock model invoked', { response: response.output });
    const content = response.output?.text;

    if (!content) {
      logger.info('No content found in response', { response: response });
      throw new Error('No text content found in Bedrock response');
    }

    const bedrockResponse = safeJsonParse(content);

    if (!bedrockResponse) {
      logger.error('Failed to parse JSON response', { content });
      throw new Error('Invalid JSON response from Bedrock model');
    }

    logger.info('Bedrock invocation response', { response: bedrockResponse });

    // Get tasks
    const tasks: Task[] = bedrockResponse?.tasks ?? [];
    logger.info('Tasks generated by Bedrock model:', { tasks });

    return tasks;
  } catch (error: any) {
    throw new Error(`Bedrock model evaluation failed\n${error.message}`);
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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
