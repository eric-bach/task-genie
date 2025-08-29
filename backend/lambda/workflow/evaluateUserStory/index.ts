import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItemRequest, WorkItemImage } from '../../../types/azureDevOps';
import { CloudWatchService } from '../../../services/CloudWatchService';
import { InvalidWorkItemError } from '../../../types/errors';
import { BedrockService, BedrockServiceConfig } from '../../../services/BedrockService';

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
 */
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
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

export const logger = new Logger({ serviceName: 'evaluateUserStory' });

// Cache for dependencies
let bedrockService: BedrockService | null = null;

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
          workItemStatus: {
            pass: false,
            comment:
              'Work Item has already been previously evaluated by Task Genie. Please remove the `Task Genie` tag to re-evaluate this work item.',
          },
        },
      };
    }

    let statusCode = 200;

    // Evaluate work item
    const bedrock = getBedrockService();
    const bedrockResponse = await bedrock.evaluateWorkItem(workItem);

    if (bedrockResponse.pass !== true) {
      logger.error(`🛑 Work item ${workItem.workItemId} does not meet requirements`, {
        reason: bedrockResponse.comment,
      });

      // Create CloudWatch metric
      const cloudWatchClient = new CloudWatchService();
      await cloudWatchClient.createIncompleteUserStoriesMetric();

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

      throw new Error(
        `Could not evaluate work item: ${JSON.stringify({
          statusCode: error.code,
          error: error.error,
          message: error.message,
        })}`
      );
    }

    logger.error('💣 An unknown error occurred', { error: error });

    throw new Error(
      `Could not evaluate work item: ${JSON.stringify({
        statusCode: 500,
        error: error,
      })}`
    );
  }
};

/**
 * Initialize Bedrock service (singleton pattern for Lambda container reuse)
 */
const getBedrockService = (): BedrockService => {
  if (!bedrockService) {
    const config: BedrockServiceConfig = {
      region: AWS_REGION,
      modelId: AWS_BEDROCK_MODEL_ID,
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      maxKnowledgeDocuments: 3,
      maxImageSize: 5, // 5MB
      maxImages: 3,
    };

    bedrockService = new BedrockService(config);
  }
  return bedrockService;
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
 * @param context The context in which the HTML content is used (e.g., 'Description', 'AcceptanceCriteria')
 * @returns Array of WorkItemImage objects with URLs and alt text found in the content
 */
const extractImageUrls = (htmlContent: string, context: string): WorkItemImage[] => {
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

  logger.debug(`Extracted ${images.length} images from ${context}`, { images });
  return images;
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
  const descriptionImages = extractImageUrls(rawDescription, 'Description');
  const acceptanceCriteriaImages = extractImageUrls(rawAcceptanceCriteria, 'AcceptanceCriteria');
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

const sanitizeField = (fieldValue: any): string => {
  if (typeof fieldValue !== 'string') {
    throw new Error('Invalid field value: expected a string.');
  }
  return fieldValue.replace(/<[^>]*>/g, '').trim();
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
