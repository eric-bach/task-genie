import { Context } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task, WorkItemRequest, BedrockConfig, BedrockResponse } from '../../shared/types';

const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (AWS_BEDROCK_MODEL_ID === undefined) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}

const bedrockClient = new BedrockRuntimeClient({
  endpoint: `https://bedrock-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: process.env.AWS_REGION || 'us-west-2',
});
const logger = new Logger({ serviceName: 'defineTasks' });

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
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
  const prompt =
    params.prompt ||
    `You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing work items into actionable tasks.

    Your task is to break down the provided work item into a sequence of tasks that are clear and actionable for developers to work on. Each task should be independent and deployable separately.

    Ensure each task has a title and a comprehensive description that guides the developer (why, what, how, technical details, references to relevant systems/APIs). Do NOT create any tasks for analyzing, investigating, analyzing, testing, or deployment.

    When providing technical details, align them with the current architecture and technologies used:
      - Serverless, microservices, and event-driven architectures
      - Infrastructure: AWS services (Lambda, DynamoDB, EventBridge, etc.)
      - Language: Python
      - Frontend framework: React
      - Mobile framework: Flutter

    If you are unsure about the technology, do not make assumptions.`;

  const fullPrompt = `${prompt}
    Only return your assessment as a JSON object with the following structure: 
      - "tasks": array of task objects, each with: 
        - "title": string (task title, prefixed with its order in the sequence, e.g., "1. Task Title")
        - "description": string (detailed task description). Please use HTML tags for formatting, such as <br> for line breaks, to make it easier to read.

    Do not output any text outside of the JSON object.

    The work item to decompose is:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
  `;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: params.maxTokens ?? 4096,
    temperature: params.temperature ?? 0.5,
    top_p: params.topP ?? 0.9,
    messages: [
      {
        role: 'user',
        content: fullPrompt,
      },
    ],
  });

  const input: InvokeModelCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    body: body,
    contentType: 'application/json',
    accept: 'application/json',
  };

  logger.debug(`Invoking Bedrock model ${AWS_BEDROCK_MODEL_ID}`, { input: JSON.stringify(input) });

  const command = new InvokeModelCommand(input);

  try {
    const response = await bedrockClient.send(command);

    logger.info('Bedrock model invoked', { response: response });

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    logger.debug('Bedrock response content', { content: responseBody });

    // Get tasks
    const text: string =
      responseBody.content && responseBody.content[0] && responseBody.content[0].text
        ? responseBody.content[0].text
        : '{tasks:[{}]}';

    const tasks: Task[] = safeJsonParse(text)?.tasks;

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
