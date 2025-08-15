import { Context } from 'aws-lambda';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
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

const bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
  endpoint: `https://bedrock-agent-runtime.${AWS_REGION}.amazonaws.com`,
  region: AWS_REGION || 'us-west-2',
});

const bedrockRuntimeClient = new BedrockRuntimeClient({
  endpoint: `https://bedrock-runtime.${AWS_REGION}.amazonaws.com`,
  region: AWS_REGION || 'us-west-2',
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
    logger.info(`✅ Identified ${tasks.length} tasks`);

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

  logger.info(`Parsed work item ${workItem.workItemId}`, {
    workItem,
    workItemStatus,
    ...(params && { params }),
  });

  return { params: params ?? {}, workItem, workItemStatus };
};

const evaluateBedrock = async (workItem: WorkItem, params: BedrockConfig): Promise<Task[]> => {
  // Step 1: Try to retrieve relevant documents from Knowledge Base
  const retrievalContext = await retrieveFromKnowledgeBase(workItem);

  // Step 2: Use direct model inference with any retrieved context
  return await invokeModelWithContext(workItem, params, retrievalContext);
};

const retrieveFromKnowledgeBase = async (workItem: WorkItem): Promise<string> => {
  const query = `
    Given the following work item, find any relevant information such as business or domain context, and 
    technical details that can help you evaluate the user story:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}
  `;

  const input: RetrieveCommandInput = {
    knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: query,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 5,
        filter: {
          andAll: [
            {
              equals: {
                key: 'area_path',
                value: workItem.areaPath,
              },
            },
            {
              equals: {
                key: 'business_unit',
                value: workItem.businessUnit,
              },
            },
            {
              equals: {
                key: 'system',
                value: workItem.system,
              },
            },
          ],
        },
      },
    },
  };

  logger.debug('Retrieving from Knowledge Base', {
    knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
    input: JSON.stringify(input),
  });

  try {
    const command = new RetrieveCommand(input);
    const response = await bedrockAgentRuntimeClient.send(command);

    const results = response.retrievalResults || [];
    logger.info(`Retrieved ${results.length} documents from Knowledge Base`);

    if (results.length === 0) {
      return 'No additional context available from knowledge base.';
    }

    // Combine all retrieved content into context
    const contextParts = results.map((result, index) => {
      const content = result.content?.text || '';
      const source = result.location?.s3Location?.uri || `Document ${index + 1}`;
      return `--- Source: ${source} ---\n${content}`;
    });

    const combinedContext = contextParts.join('\n\n');
    return combinedContext;
  } catch (error: any) {
    logger.warn('Failed to retrieve from Knowledge Base, proceeding without context', {
      error: error.message,
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
    });
    return 'No additional context available from knowledge base.';
  }
};

const invokeModelWithContext = async (workItem: WorkItem, params: BedrockConfig, context: string): Promise<Task[]> => {
  const basePrompt =
    params.prompt ||
    `You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing 
    work items into actionable tasks.

    Your task is to break down the provided work item into a sequence of tasks that are clear and actionable
    for developers to work on. Each task should be independent and deployable separately.

    Ensure each task has a title and a comprehensive description that guides the developer (why, what, how,
    technical details, references to relevant systems/APIs). Do NOT create any tasks for analyzing,
    investigating, analyzing, testing, or deployment.`;

  const fullPrompt = `${basePrompt}
    
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

    Additional business, domain context, and technical details from knowledge base:
    ${context}`;

  // Create the payload for Claude models
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    temperature: 0.5,
    top_p: 0.9,
    messages: [
      {
        role: 'user',
        content: fullPrompt,
      },
    ],
  };

  const input: InvokeModelCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    body: JSON.stringify(body),
    contentType: 'application/json',
    accept: 'application/json',
  };

  logger.debug('Invoking Bedrock model', {
    modelId: AWS_BEDROCK_MODEL_ID,
    contextLength: context.length,
  });

  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrockRuntimeClient.send(command);

    // Parse the response body
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text;

    if (!content) {
      logger.info('No content found in model response', { response: responseBody });
      throw new Error('No text content found in Bedrock model response');
    }

    const bedrockResponse = safeJsonParse(content);

    if (!bedrockResponse) {
      logger.error('Failed to parse JSON response from model', { content });
      throw new Error('Invalid JSON response from Bedrock model');
    }

    logger.info('Bedrock model invocation response', { response: bedrockResponse });

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
