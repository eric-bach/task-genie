import { Context } from 'aws-lambda';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task, BedrockConfig, BedrockResponse, WorkItemImage } from '../../shared/types';

/**
 * Lambda function to define tasks for Azure DevOps work items using AWS Bedrock
 *
 * Features:
 * - Breaks down work items into actionable tasks
 * - Includes images as context to Bedrock's multi-modal Claude models for task definition
 * - Retrieves relevant context from knowledge base
 * - Generates detailed task descriptions with technical guidance
 *
 * Environment Variables:
 * - AWS_BEDROCK_MODEL_ID: The Bedrock model ID to use for task generation
 * - AWS_BEDROCK_KNOWLEDGE_BASE_ID: Knowledge base ID for retrieving context
 * - AZURE_DEVOPS_PAT_PARAMETER_NAME: Parameter Store parameter name containing Azure DevOps PAT
 */ const AWS_REGION = process.env.AWS_REGION;
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

const ssmClient = new SSMClient({ region: AWS_REGION || 'us-west-2' });

const logger = new Logger({ serviceName: 'defineTasks' });

// Cache for the Azure DevOps PAT to avoid repeated Parameter Store calls
let cachedAdoPat: string | null = null;

/**
 * Retrieves the Azure DevOps PAT from AWS Systems Manager Parameter Store
 * @returns The PAT string or null if not configured or failed to retrieve
 */
const getAzureDevOpsPat = async (): Promise<string | null> => {
  if (cachedAdoPat !== null) {
    return cachedAdoPat;
  }

  const parameterName = process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME;
  if (!parameterName) {
    logger.debug('Azure DevOps PAT parameter name not configured');
    return null;
  }

  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    });
    const response = await ssmClient.send(command);
    cachedAdoPat = response.Parameter?.Value || null;
    logger.debug('Successfully retrieved Azure DevOps PAT from Parameter Store');
    return cachedAdoPat;
  } catch (error) {
    logger.warn('Failed to retrieve Azure DevOps PAT from Parameter Store', {
      error: error instanceof Error ? error.message : 'Unknown error',
      parameterName,
    });
    return null;
  }
};

/**
 * Fetches an image from a URL and converts it to base64
 * @param imageUrl The URL of the image to fetch
 * @returns Object with base64 string and raw data, or null if failed
 */
const fetchImageAsBase64 = async (imageUrl: string): Promise<string | null> => {
  try {
    // For Azure DevOps attachment URLs, add required query parameters and auth
    if (imageUrl.includes('visualstudio.com')) {
      const finalUrl = `${imageUrl}&download=true&api-version=7.1`;

      const adoPat = await getAzureDevOpsPat();
      if (!adoPat) {
        logger.warn('No Azure DevOps PAT available for image download');
        return null;
      }

      logger.debug(`Fetching image from Azure DevOps`, {
        originalUrl: imageUrl,
        finalUrl,
      });

      const response = await fetch(finalUrl, {
        headers: { Authorization: `Basic ${adoPat}` },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch image: ${response.status} ${response.statusText}`, {
          url: finalUrl,
        });
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      logger.debug(`Successfully fetched image`, {
        url: finalUrl,
        sizeBytes: arrayBuffer.byteLength,
      });

      return base64;
    }

    // For non-Azure DevOps images, use simple fetch
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'TaskGenie/1.0' },
    });

    if (!response.ok) {
      logger.warn(`Failed to fetch image: ${response.status} ${response.statusText}`, {
        url: imageUrl,
      });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    logger.debug(`Successfully fetched image`, {
      url: imageUrl,
      sizeBytes: arrayBuffer.byteLength,
    });

    return base64;
  } catch (error) {
    logger.warn(`Error fetching image`, {
      url: imageUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
};

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
  const imagesInfo =
    workItem.images && workItem.images.length > 0
      ? `\n    - Images: ${workItem.images.length} image(s) referenced with descriptions`
      : '';

  const query = `
    Given the following work item, find any relevant information such as business or domain context, and 
    technical details that can help you evaluate the user story:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}${imagesInfo}
  `;

  const input: RetrieveCommandInput = {
    knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: query,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 5,
        ...(workItem.areaPath || workItem.businessUnit || workItem.system
          ? {
              filter: {
                andAll: [
                  ...(workItem.areaPath
                    ? [
                        {
                          equals: {
                            key: 'area_path',
                            value: workItem.areaPath,
                          },
                        },
                      ]
                    : []),
                  ...(workItem.businessUnit
                    ? [
                        {
                          equals: {
                            key: 'business_unit',
                            value: workItem.businessUnit,
                          },
                        },
                      ]
                    : []),
                  ...(workItem.system
                    ? [
                        {
                          equals: {
                            key: 'system',
                            value: workItem.system,
                          },
                        },
                      ]
                    : []),
                ],
              },
            }
          : {}),
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

  // Prepare images information for the prompt
  const imagesInfo =
    workItem.images && workItem.images.length > 0
      ? `\n\nImages referenced in the work item:\n${workItem.images
          .map((image, index) => {
            const altText = image.alt ? ` (Alt: "${image.alt}")` : '';
            return `${index + 1}. ${image.url}${altText}`;
          })
          .join('\n')}`
      : '';

  const textPrompt = `${basePrompt}
    
    Only return your assessment as a JSON object with the following structure:
    - "tasks": array of task objects, each with:
      - "title": string (task title, prefixed with its order in the sequence, e.g., "1. Task Title")
      - "description": string (detailed task description). Please use HTML tags for formatting, such as <br> for
      line breaks, to make it easier to read.
    
    If images are provided, consider them as visual requirements, UI mockups, or design specifications when 
    creating tasks. Reference specific visual elements in the task descriptions when relevant.
    
    DO NOT output any text outside of the JSON object.

    The work item to decompose is:
      - Title: ${workItem.title} 
      - Description: ${workItem.description} 
      - Acceptance Criteria: ${workItem.acceptanceCriteria}${imagesInfo}

    Additional business, domain context, and technical details from knowledge base:
    ${context}`;

  // Prepare content array for multi-modal input
  const contentArray: any[] = [{ type: 'text', text: textPrompt }];

  // Add images to content if available
  if (workItem.images && workItem.images.length > 0) {
    const maxImages = 5; // Limit to 5 images to avoid request size limits
    const imagesToProcess = workItem.images.slice(0, maxImages);

    for (const image of imagesToProcess) {
      try {
        // Fetch image data from URL
        const imageData = await fetchImageAsBase64(image.url);
        if (imageData) {
          // Check image size (Bedrock has limits)
          const sizeInBytes = (imageData.length * 3) / 4; // Approximate size after base64 encoding
          const sizeInMB = sizeInBytes / (1024 * 1024);
          const maxSizeInMB = 5; // 5MB limit per image

          if (sizeInBytes > maxSizeInMB * 1024 * 1024) {
            logger.warn(`Image too large, skipping`, {
              url: image.url,
              sizeInMB: Math.round(sizeInMB * 100) / 100, // Round to 2 decimal places
            });
            continue;
          }

          contentArray.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageData,
            },
          });
          logger.debug(`Added image to content array`, {
            url: image.url,
            alt: image.alt,
            sizeInMB: Math.round(sizeInMB * 100) / 100, // Round to 2 decimal places
          });
        }
      } catch (error) {
        logger.warn(`Failed to fetch image for LLM context`, {
          url: image.url,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other images even if one fails
      }
    }

    if (workItem.images.length > maxImages) {
      logger.info(`Limited images sent to LLM`, {
        totalImages: workItem.images.length,
        sentImages: maxImages,
      });
    }
  }

  // Create the payload for Claude models
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    temperature: 0.5,
    top_p: 0.9,
    messages: [
      {
        role: 'user',
        content: contentArray,
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
    contentItems: contentArray.length,
    contextLength: context.length,
    imagesCount: workItem.images?.length || 0,
    hasImages: (workItem.images?.length || 0) > 0,
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
