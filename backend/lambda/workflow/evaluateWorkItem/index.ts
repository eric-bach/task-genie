import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import {
  WorkItemRequest,
  WorkItemImage,
  WorkItem,
  UserStory,
  Epic,
  Feature,
  isUserStory,
  isEpic,
  isFeature,
} from '../../../types/azureDevOps';
import { CloudWatchService } from '../../../services/CloudWatchService';
import { InvalidWorkItemError } from '../../../types/errors';
import { BedrockService, BedrockServiceConfig } from '../../../services/BedrockService';

/**
 * Lambda function to evaluate Azure DevOps work items (User Story, Epic, Feature) using AWS Bedrock
 *
 * Features:
 * - Supports User Story, Epic, and Feature work item types
 * - Extracts type-specific fields (acceptance criteria, success criteria, objectives, etc.)
 * - Extracts images from HTML content in description and type-specific criteria fields
 * - Sends images as context to Bedrock's multi-modal Claude models for evaluation
 * - Retrieves relevant context from knowledge base
 * - Evaluates work item quality based on type-specific criteria
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

export const logger = new Logger({ serviceName: 'evaluateWorkItem' });

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
      logger.info(
        `⏩ ${workItem.workItemType} ${workItem.workItemId} has already been evaluated by Task Genie. Skipping re-evaluation.`
      );

      return {
        statusCode: 204,
        body: {
          params,
          workItem,
          workItemStatus: {
            pass: false,
            comment: `<br />⚠️ ${workItem.workItemType} has already been previously evaluated by Task Genie. Please remove the \`Task Genie\` tag to re-evaluate this ${workItem.workItemType}.`,
          },
        },
      };
    }

    let statusCode = 200;

    // Evaluate work item
    const bedrock = getBedrockService();
    const bedrockResponse = await bedrock.evaluateWorkItem(workItem);

    if (bedrockResponse.pass !== true) {
      logger.error(`🛑 ${workItem.workItemType} ${workItem.workItemId} does not meet requirements`, {
        reason: bedrockResponse.comment,
      });

      // Create CloudWatch metric
      const cloudWatchService = new CloudWatchService();
      await cloudWatchService.createIncompleteWorkItemMetric(workItem.workItemType);

      statusCode = 412;
    } else {
      logger.info(`✅ ${workItem.workItemType} ${workItem.workItemId} meets requirements`, {
        work_item_id: workItem.workItemId,
      });
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
  const commonRequiredFields = [
    'System.TeamProject',
    'System.AreaPath',
    'System.IterationPath',
    'System.ChangedBy',
    'System.Title',
    'System.Description',
    'System.WorkItemType',
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

  // Validate common required fields
  for (const field of commonRequiredFields) {
    if (!fields[field]) {
      logger.error('Work item is missing a required field', { field: field });
      throw new InvalidWorkItemError('Bad request', `Work item is missing required field: ${field}.`, 400);
    }
  }

  // Validate work item type is supported
  const workItemType = fields['System.WorkItemType'];
  const supportedTypes = ['User Story', 'Epic', 'Feature'];
  if (!supportedTypes.includes(workItemType)) {
    throw new InvalidWorkItemError(
      'Unsupported work item type',
      `Work item type '${workItemType}' is not supported. Supported types: ${supportedTypes.join(', ')}.`,
      400
    );
  }

  // Type-specific validation
  if (workItemType === 'User Story') {
    // User Story should have acceptance criteria (but make it optional to be lenient)
    if (!fields['Microsoft.VSTS.Common.AcceptanceCriteria']) {
      logger.warn('User Story is missing acceptance criteria', { workItemId: resource.workItemId || resource.id });
    }
  }
  if (workItemType === 'Epic' || workItemType === 'Feature') {
    // Epic and Feature should have success criteria (but make it optional to be lenient)
    if (!fields['Custom.SuccessCriteria']) {
      logger.warn(`${workItemType} is missing success criteria`, { workItemId: resource.workItemId || resource.id });
    }
  }
};

/**
 * Extracts image URLs and alt text from HTML and Markdown content
 * @param htmlContent The HTML content to parse
 * @param context The context in which the HTML content is used (e.g., 'Description', 'AcceptanceCriteria')
 * @returns Array of WorkItemImage objects with URLs and alt text found in the content
 */
const extractImageUrls = (htmlContent: string, context: string): WorkItemImage[] => {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return [];
  }

  const images: WorkItemImage[] = [];

  // Extract images from HTML tags: <img>
  const imgRegex = /<img[^>]*>/gi;
  let htmlMatch;

  while ((htmlMatch = imgRegex.exec(htmlContent)) !== null) {
    const imgTag = htmlMatch[0];

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

  // Extract images from Markdown image syntax: ![alt](url)
  const markdownImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let markdownMatch;

  while ((markdownMatch = markdownImgRegex.exec(htmlContent)) !== null) {
    const alt = markdownMatch[1].trim();
    const url = markdownMatch[2].trim();

    if (url) {
      images.push({
        url: url,
        alt: alt || undefined,
      });
    }
  }

  return images;
};

const parseEvent = (event: any): WorkItemRequest => {
  const { params, resource } = event;
  const workItemId = resource.workItemId || resource.id;
  const fields = resource.revision?.fields || resource.fields;
  const workItemType = fields['System.WorkItemType'] as 'User Story' | 'Epic' | 'Feature';

  const tagsString = sanitizeField(fields['System.Tags'] ?? '');
  const tags = tagsString ? tagsString.split(';').map((tag: string) => tag.trim()) : [];

  // Extract raw HTML content before sanitization for type-specific fields
  const rawDescription = fields['System.Description'] || '';

  // Get type-specific criteria field content
  let rawCriteriaContent = '';
  const allImages: WorkItemImage[] = [];

  if (workItemType === 'User Story') {
    rawCriteriaContent = fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '';
  } else if (workItemType === 'Epic' || workItemType === 'Feature') {
    rawCriteriaContent = fields['Custom.SuccessCriteria'] || '';
  }

  // Extract image URLs from description and criteria content
  const descriptionImages = extractImageUrls(rawDescription, 'Description');
  const criteriaImages = extractImageUrls(
    rawCriteriaContent,
    workItemType === 'User Story' ? 'AcceptanceCriteria' : 'SuccessCriteria'
  );
  allImages.push(...descriptionImages, ...criteriaImages);

  // Remove duplicates based on URL
  const uniqueImages = allImages.filter(
    (image, index, self) => index === self.findIndex((img) => img.url === image.url)
  );

  // Create base work item with common fields
  const baseWorkItem = {
    workItemId: workItemId ?? 0,
    workItemType,
    teamProject: sanitizeField(fields['System.TeamProject']),
    areaPath: sanitizeField(fields['System.AreaPath']),
    iterationPath: sanitizeField(fields['System.IterationPath']),
    businessUnit: sanitizeField(fields['Custom.BusinessUnit']), // Custom Field
    system: sanitizeField(fields['Custom.System']), // Custom Field
    changedBy: sanitizeField(fields['System.ChangedBy']).replace(/<.*?>/, '').trim(),
    title: sanitizeField(fields['System.Title']),
    description: sanitizeField(rawDescription),
    tags,
    images: uniqueImages.length > 0 ? uniqueImages : undefined,
  };

  // Create type-specific work item
  let workItem: WorkItem;
  if (workItemType === 'User Story') {
    workItem = {
      ...baseWorkItem,
      workItemType: 'User Story',
      acceptanceCriteria: sanitizeField(rawCriteriaContent),
      importance: fields['Custom.Importance'] ? sanitizeField(fields['Custom.Importance']) : undefined,
    } as UserStory;
  } else if (workItemType === 'Epic') {
    workItem = {
      ...baseWorkItem,
      workItemType: 'Epic',
      successCriteria: sanitizeField(rawCriteriaContent),
      objective: fields['Custom.Objective'] ? sanitizeField(fields['Custom.Objective']) : undefined,
      addressedRisks: fields['Custom.AddressedRisks'] ? sanitizeField(fields['Custom.AddressedRisks']) : undefined,
      pursueRisk: fields['Custom.PursueRisk'] ? sanitizeField(fields['Custom.PursueRisk']) : undefined,
      mostRecentUpdate: fields['Custom.MostRecentUpdate']
        ? sanitizeField(fields['Custom.MostRecentUpdate'])
        : undefined,
      outstandingActionItems: fields['Custom.OutstandingActionItems']
        ? sanitizeField(fields['Custom.OutstandingActionItems'])
        : undefined,
    } as Epic;
  } else if (workItemType === 'Feature') {
    workItem = {
      ...baseWorkItem,
      workItemType: 'Feature',
      successCriteria: sanitizeField(rawCriteriaContent),
      businessDeliverable: fields['Custom.BusinessDeliverable']
        ? sanitizeField(fields['Custom.BusinessDeliverable'])
        : undefined,
    } as Feature;
  } else {
    throw new Error(`Unsupported work item type: ${workItemType}`);
  }

  logger.info(`▶️ Starting evaluation of ${workItem.workItemType} ${workItem.workItemId}`, {
    workItemType: workItem.workItemType,
    title: workItem.title,
    areaPath: workItem.areaPath,
    businessUnit: workItem.businessUnit,
    system: workItem.system,
    iterationPath: workItem.iterationPath,
    hasImages: !!(workItem.images && workItem.images.length > 0),
    imagesCount: workItem.images?.length || 0,
  });

  return { params: params ?? {}, workItem };
};

const sanitizeField = (fieldValue: any): string => {
  if (typeof fieldValue !== 'string') {
    throw new Error('Invalid field value: expected a string.');
  }
  return fieldValue.replace(/<[^>]*>/g, '').trim();
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
