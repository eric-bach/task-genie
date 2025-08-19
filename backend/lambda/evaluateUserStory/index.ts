import { Context } from 'aws-lambda';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { createIncompleteUserStoriesMetric } from './helpers/cloudwatch';
import { WorkItem, BedrockResponse, WorkItemRequest, WorkItemImage } from '../../shared/types';
import { InvalidWorkItemError } from '../../shared/errors';

/**
 * Lambda function to evaluate Azure DevOps work items using AWS Bedrock
 *
 * Features:
 * - Extracts and parses work item fields including title, description, and acceptance criteria
 * - Extracts images from HTML content in description and acceptance criteria
 * - Sends images as context to Bedrock's multi-modal Claude models for evaluation
 * - Retrieves relevant context from knowledge base
 * - Evaluates work item quality based on INVEST principles
 *
 * Environment Variables:
 * - AWS_BEDROCK_MODEL_ID: The Bedrock model ID to use for evaluation
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
  endpoint: `https://bedrock-agent-runtime.${process.env.AWS_REGION}.amazonaws.com`,
  region: AWS_REGION || 'us-west-2',
});

const bedrockRuntimeClient = new BedrockRuntimeClient({
  endpoint: `https://bedrock-runtime.${AWS_REGION}.amazonaws.com`,
  region: AWS_REGION || 'us-west-2',
});

const ssmClient = new SSMClient({ region: AWS_REGION || 'us-west-2' });

export const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-west-2' });
export const logger = new Logger({ serviceName: 'evaluateUserStory' });

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

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // Validate required fields in the work item
    validateWorkItem(event.resource);

    // Parse and sanitize fields
    const { workItem, params } = parseEvent(event);

    // Check if work item has been updated already
    if (workItem.tags.includes('Task Genie')) {
      logger.info(`Work item ${workItem.workItemId} has already been evaluated by Task Genie`);
      return {
        statusCode: 204,
        body: {
          params,
          workItem,
        },
      };
    }

    // Invoke Bedrock
    let statusCode = 200;
    const bedrockResponse = await evaluateBedrock(workItem);

    if (bedrockResponse.pass !== true) {
      logger.error(`❌ Work item ${workItem.workItemId} does not meet requirements`, {
        reason: bedrockResponse.comment,
      });

      // Create CloudWatch metric
      await createIncompleteUserStoriesMetric();

      // throw new InvalidWorkItemError('Invalid work item', bedrockResponse.comment, 412);
      statusCode = 412;
    } else {
      logger.info(`✅ Work item ${workItem.workItemId} meets requirements`, { work_item_id: workItem.workItemId });
    }

    return {
      statusCode,
      body: {
        params,
        workItem,
        workItemStatus: bedrockResponse,
      },
    };
  } catch (error) {
    if (error instanceof InvalidWorkItemError) {
      logger.error(`💣 ${error.error}`, { error: error.message });

      return {
        statusCode: error.code,
        error: error.error,
        message: error.message,
      };
    }

    logger.error('💣 An unknown error occurred', { error: error });

    return {
      statusCode: 500,
      error: error,
    };
  }
};

const validateWorkItem = (resource: any) => {
  const requiredFields = [
    'System.TeamProject',
    'System.AreaPath',
    'System.ChangedBy',
    'System.Title',
    'System.Description',
    'Microsoft.VSTS.Common.AcceptanceCriteria',
  ];

  if (!resource) {
    throw new InvalidWorkItemError('Bad request', 'Work item resource is undefined or missing.', 400);
  }

  // Handle different payload structures for created vs updated work items
  // For updates: fields are in resource.revision.fields
  // For creates: fields are directly in resource.fields
  const fields = resource.revision?.fields || resource.fields;
  if (!fields) {
    throw new InvalidWorkItemError('Bad request', 'Work item fields are undefined or missing.', 400);
  }

  for (const field of requiredFields) {
    if (!fields[field]) {
      logger.error('Work item is missing a required field', { field: field });
      throw new InvalidWorkItemError('Bad request', `Work item is missing required field: ${field}.`, 400);
    }
  }
};

/**
 * Extracts image URLs and alt text from HTML content containing <img> tags
 * @param htmlContent The HTML content to parse
 * @returns Array of WorkItemImage objects with URLs and alt text found in the content
 */
const extractImageUrls = (htmlContent: string): WorkItemImage[] => {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return [];
  }

  // Regular expression to match <img> tags
  const imgRegex = /<img[^>]*>/gi;
  const images: WorkItemImage[] = [];
  let match;

  while ((match = imgRegex.exec(htmlContent)) !== null) {
    const imgTag = match[0];

    // Extract src attribute
    const srcMatch = imgTag.match(/\ssrc\s*=\s*["']?([^"'\s>]+)["']?/i);
    // Extract alt attribute
    const altMatch = imgTag.match(/\salt\s*=\s*["']?([^"'>]*)["']?/i);

    if (srcMatch && srcMatch[1] && srcMatch[1].trim()) {
      images.push({
        url: srcMatch[1].trim(),
        alt: altMatch && altMatch[1] && altMatch[1].trim() ? altMatch[1].trim() : undefined,
      });
    }
  }

  logger.debug(`Extracted ${images.length} images from HTML content`, { images });
  return images;
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

const parseEvent = (event: any): WorkItemRequest => {
  const { params, resource } = event;
  const workItemId = resource.workItemId || resource.id;
  const fields = resource.revision?.fields || resource.fields;

  const tagsString = sanitizeField(fields['System.Tags'] ?? '');
  const tags = tagsString ? tagsString.split(';').map((tag: string) => tag.trim()) : [];

  // Extract raw HTML content before sanitization
  const rawDescription = fields['System.Description'] || '';
  const rawAcceptanceCriteria = fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '';

  // Extract image URLs from both description and acceptance criteria
  const descriptionImages = extractImageUrls(rawDescription);
  const acceptanceCriteriaImages = extractImageUrls(rawAcceptanceCriteria);
  const allImages = [...descriptionImages, ...acceptanceCriteriaImages];

  // Remove duplicates based on URL
  const uniqueImages = allImages.filter(
    (image, index, self) => index === self.findIndex((img) => img.url === image.url)
  );

  const workItem = {
    workItemId: workItemId ?? 0,
    teamProject: sanitizeField(fields['System.TeamProject']),
    areaPath: sanitizeField(fields['System.AreaPath']),
    // TODO Change this to Custom.BusinessUnit when moving to AMA-Ent
    businessUnit: fields['Custom.BusinessUnit2'] ? sanitizeField(fields['Custom.BusinessUnit2']) : '',
    // TODO Change this to Custom.System when moving to AMA-Ent
    system: fields['Custom.System2'] ? sanitizeField(fields['Custom.System2']) : '',
    changedBy: sanitizeField(fields['System.ChangedBy']).replace(/<.*?>/, '').trim(),
    title: sanitizeField(fields['System.Title']),
    description: sanitizeField(rawDescription),
    acceptanceCriteria: sanitizeField(rawAcceptanceCriteria),
    tags,
    images: uniqueImages.length > 0 ? uniqueImages : undefined,
  };

  logger.info('Parsed work item', { workItem });

  return { params: params ?? {}, workItem };
};

const evaluateBedrock = async (workItem: WorkItem): Promise<BedrockResponse> => {
  // Step 1: Try to retrieve relevant documents from Knowledge Base
  const retrievalContext = await retrieveFromKnowledgeBase(workItem);

  // Step 2: Use direct model inference with any retrieved context
  return await invokeModelWithContext(workItem, retrievalContext);
};

const retrieveFromKnowledgeBase = async (workItem: WorkItem): Promise<string> => {
  const query = `
    Given the following work item, find any relevant information such as business or domain context, and technical
    details that can help you evaluate the user story:
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
          equals: {
            key: 'area_path',
            value: 'agile-process',
          },
        },
      },
    },
  };

  logger.debug(`Retrieving from Knowledge Base`, {
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

const invokeModelWithContext = async (workItem: WorkItem, context: string): Promise<BedrockResponse> => {
  const textPrompt = `
    You are an expert Agile software development assistant that reviews Azure DevOps work items. 
    You evaluate work items to ensure they are complete, clear, and ready for a developer to work on.
    Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    This is for educational and quality improvement purposes in a software development process.

    Evaluate the user story based on the following criteria:
      - Check if it clearly states the user, need, and business value.
      - Ensure acceptance criteria are present and specific.
      - Confirm the story is INVEST-aligned (Independent, Negotiable, Valuable, Estimable, Small, Testable).
      - If images are provided, consider them as additional context and visual requirements for the story.

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
      
    Additional business or domain context from knowledge base:
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
              media_type: 'image/jpeg', // Use JPEG for all images like the working example
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
    max_tokens: 2048,
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
      logger.error('No content found in model response', { response: responseBody });
      throw new Error('No text content found in Bedrock model response');
    }

    const bedrockResponse = safeJsonParse(content);

    if (!bedrockResponse) {
      logger.error('Failed to parse JSON response from model', { content });
      throw new Error('Invalid JSON response from Bedrock model');
    }

    logger.info('Bedrock model invocation response', { response: bedrockResponse });

    return bedrockResponse;
  } catch (error: any) {
    logger.error('Bedrock model evaluation failed', {
      error: error.message,
      errorName: error.name,
      errorCode: error.$metadata?.httpStatusCode || error.statusCode,
      requestId: error.$metadata?.requestId,
      errorType: error.__type || error.code,
      modelId: AWS_BEDROCK_MODEL_ID,
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      region: AWS_REGION,
    });
    throw new Error(`Bedrock model evaluation failed\n${error.message}`);
  }
};

const sanitizeField = (fieldValue: any): string => {
  if (typeof fieldValue !== 'string') {
    throw new Error('Invalid field value: expected a string.');
  }
  return fieldValue.replace(/<[^>]*>/g, '').trim();
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
