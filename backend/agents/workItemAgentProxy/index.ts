import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore'; // ES Modules import
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import {
  WorkItemRequest,
  WorkItemImage,
  WorkItem,
  ProductBacklogItem,
  UserStory,
  Epic,
  Feature,
  isProductBacklogItem,
  isUserStory,
  isEpic,
  isFeature,
} from '../../types/azureDevOps';
import { WorkItemGenerationMode } from '../../types/bedrock';
import { InvalidWorkItemError } from '../../types/errors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const logger = new Logger({ serviceName: 'workItemAgentProxy' });

const agentRuntimeArn = process.env.BEDROCK_AGENTCORE_RUNTIME_ARN;
if (!agentRuntimeArn) {
  throw new Error('Server configuration error: Missing BEDROCK_AGENTCORE_RUNTIME_ARN');
}

function generateSessionId(workItem: WorkItem): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const prefix = `ado-${workItem.workItemId}-rev-${workItem.rev}-`;
  const length = 33 - prefix.length;

  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return prefix + result;
}

// CORS headers for cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,x-api-key,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  try {
    const client = new BedrockAgentCoreClient();

    // Validate required fields in the work item
    validateWorkItem(event.resource);
    logger.info('Validated request body resource', { resource: event.resource });

    // Parse and sanitize fields
    const { workItem, params } = parseEvent(event);

    // Validate parameters
    validateParams(params);

    const input = {
      runtimeSessionId: generateSessionId(workItem),
      agentRuntimeArn,
      qualifier: 'DEFAULT', // This is Optional. When the field is not provided, Runtime will use DEFAULT endpoint
      payload: new TextEncoder().encode(JSON.stringify({ workItem, params })),
    };

    logger.info('⚙️ Invoking Bedrock Agent Runtime', {
      agentRuntimeArn,
      qualifier: input.qualifier,
      runtimeSessionId: input.runtimeSessionId,
    });

    const command = new InvokeAgentRuntimeCommand(input);
    const response = await client.send(command);
    const textResponse = await response.response?.transformToString();

    logger.info('✅ Bedrock Agent Runtime completed', JSON.stringify(textResponse, null, 2));

    return {
      statusCode: 202,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Work item submitted for processing',
        sessionId: input.runtimeSessionId,
      }),
    };
  } catch (error) {
    logger.error(`🛑 Error invoking agent runtime: ${error}`);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: '🛑 Internal Server Error' }),
    };
  }
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
  const supportedTypes = ['Product Backlog Item', 'User Story', 'Epic', 'Feature'];
  if (!supportedTypes.includes(workItemType)) {
    throw new InvalidWorkItemError(
      'Unsupported work item type',
      `Work item type '${workItemType}' is not supported. Supported types: ${supportedTypes.join(', ')}.`,
      400,
    );
  }

  // Type-specific validation
  if (isProductBacklogItem(workItemType)) {
    // Product Backlog Item should have acceptance criteria (but make it optional to be lenient)
    if (!fields['Microsoft.VSTS.Common.AcceptanceCriteria']) {
      logger.warn('Product Backlog Item is missing acceptance criteria', {
        workItemId: resource.workItemId || resource.id,
      });
    }
  }
  if (isUserStory(workItemType)) {
    // User Story should have acceptance criteria (but make it optional to be lenient)
    if (!fields['Microsoft.VSTS.Common.AcceptanceCriteria']) {
      logger.warn('User Story is missing acceptance criteria', {
        workItemId: resource.workItemId || resource.id,
      });
    }
  }
  if (isEpic(workItemType) || isFeature(workItemType)) {
    // Epic and Feature should have success criteria (but make it optional to be lenient)
    if (!fields['Custom.SuccessCriteria']) {
      logger.warn(`${workItemType} is missing success criteria`, {
        workItemId: resource.workItemId || resource.id,
      });
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
  const rev = resource.rev;
  const fields = resource.revision?.fields || resource.fields;
  const workItemType = fields['System.WorkItemType'] as 'Product Backlog Item' | 'User Story' | 'Epic' | 'Feature';

  const tagsString = sanitizeField(fields['System.Tags'] ?? '');
  const tags = tagsString ? tagsString.split(';').map((tag: string) => tag.trim()) : [];

  // Extract raw HTML content before sanitization for type-specific fields
  const rawDescription = fields['System.Description'] || '';

  // Get type-specific criteria field content
  let rawCriteriaContent = '';
  const allImages: WorkItemImage[] = [];

  if (workItemType === 'Product Backlog Item' || workItemType === 'User Story') {
    rawCriteriaContent = fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '';
  } else if (workItemType === 'Epic' || workItemType === 'Feature') {
    rawCriteriaContent = fields['Custom.SuccessCriteria'] || '';
  }

  // Extract image URLs from description and criteria content
  const descriptionImages = extractImageUrls(rawDescription, 'Description');
  const criteriaImages = extractImageUrls(
    rawCriteriaContent,
    workItemType === 'Product Backlog Item' || workItemType === 'User Story' ? 'AcceptanceCriteria' : 'SuccessCriteria',
  );
  allImages.push(...descriptionImages, ...criteriaImages);

  // Remove duplicates based on URL
  const uniqueImages = allImages.filter(
    (image, index, self) => index === self.findIndex((img) => img.url === image.url),
  );

  // Create base work item with common fields
  const changedByValue = sanitizeField(fields['System.ChangedBy']).replace(/<.*?>/, '').trim();
  const baseWorkItem = {
    workItemId: workItemId ?? 0,
    rev: rev ?? 0,
    workItemType,
    teamProject: sanitizeField(fields['System.TeamProject']),
    areaPath: sanitizeField(fields['System.AreaPath']),
    iterationPath: sanitizeField(fields['System.IterationPath']),
    businessUnit: fields['Custom.BusinessUnit'] ? sanitizeField(fields['Custom.BusinessUnit']) : undefined, // Custom Field
    system: fields['Custom.System'] ? sanitizeField(fields['Custom.System']) : undefined, // Custom Field
    releaseNotes: fields['Custom.ReleaseNotes'] ? sanitizeField(fields['Custom.ReleaseNotes']) : undefined, // Custom Field
    qaNotes: fields['Custom.QANotes'] ? sanitizeField(fields['Custom.QANotes']) : undefined, // Custom Field
    changedBy: changedByValue,
    originalChangedBy: changedByValue, // Preserve the original submitter for @mentions in comments
    title: sanitizeField(fields['System.Title']),
    description: sanitizeField(rawDescription),
    tags,
    images: uniqueImages.length > 0 ? uniqueImages : undefined,
  };

  // Create type-specific work item
  let workItem: WorkItem;
  if (workItemType === 'Product Backlog Item') {
    workItem = {
      ...baseWorkItem,
      workItemType: 'Product Backlog Item',
      acceptanceCriteria: sanitizeField(rawCriteriaContent),
      importance: fields['Custom.Importance'] ? sanitizeField(fields['Custom.Importance']) : undefined,
    } as ProductBacklogItem;
  } else if (workItemType === 'User Story') {
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

  logger.info(`▶️ Starting evaluation of ${workItem.workItemType} ${workItem.workItemId}-rev${workItem.rev}`, {
    workItemType: workItem.workItemType,
    title: workItem.title,
    areaPath: workItem.areaPath,
    businessUnit: workItem.businessUnit,
    system: workItem.system,
    releaseNotes: workItem.releaseNotes,
    qaNotes: workItem.qaNotes,
    iterationPath: workItem.iterationPath,
    hasImages: !!(workItem.images && workItem.images.length > 0),
    imagesCount: workItem.images?.length || 0,
  });

  return { params: params ?? {}, workItem };
};

const sanitizeField = (fieldValue: any, fieldName?: string): string => {
  if (typeof fieldValue !== 'string') {
    const fieldContext = fieldName ? ` for field '${fieldName}'` : '';
    throw new Error(`Invalid field value${fieldContext}: expected a string, got ${typeof fieldValue} (${fieldValue}).`);
  }
  return fieldValue.replace(/<[^>]*>/g, '').trim();
};

const validateParams = (params: any) => {
  if (!params) return;

  const { mode, generatedWorkItems } = params;

  if (mode) {
    const validModes = Object.values(WorkItemGenerationMode);
    if (!validModes.includes(mode as WorkItemGenerationMode)) {
      throw new InvalidWorkItemError(
        'Invalid mode',
        `Mode '${mode}' is not supported. Supported modes: ${validModes.join(', ')}.`,
        400,
      );
    }

    if (mode === WorkItemGenerationMode.Create && (!generatedWorkItems || generatedWorkItems.length === 0)) {
      throw new InvalidWorkItemError(
        'Missing generatedWorkItems',
        'Mode "create" requires "generatedWorkItems" to be present and non-empty.',
        400,
      );
    }
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
