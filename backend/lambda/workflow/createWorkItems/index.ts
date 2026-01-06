import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, getExpectedChildWorkItemType } from '../../../types/azureDevOps';
import { BedrockKnowledgeDocument, BedrockResponse } from '../../../types/bedrock';
import { AzureService } from '../../../services/AzureService';
import { CloudWatchService } from '../../../services/CloudWatchService';

export const AZURE_DEVOPS_ORGANIZATION = process.env.AZURE_DEVOPS_ORGANIZATION;
if (AZURE_DEVOPS_ORGANIZATION === undefined) {
  throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'createWorkItems' });

// Cache for dependencies
let azureService: AzureService | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse work item
    const { workItem, workItems, documents, workItemStatus } = parseEventBody(body);

    // Create child work items
    const azureService = getAzureService();
    await azureService.createChildWorkItems(workItem, workItems);

    const childWorkItemType = getExpectedChildWorkItemType(workItem, false) || 'Work Item';
    const childWorkItemTypePlural = getExpectedChildWorkItemType(workItem, true) || 'Work Items';

    // Add CloudWatch metrics
    const cloudWatchService = new CloudWatchService();
    await cloudWatchService.createWorkItemGeneratedMetric(workItems.length, childWorkItemType);
    await cloudWatchService.createWorkItemUpdatedMetric(workItem.workItemType);

    logger.info(
      `✅ Created ${workItems.length} ${childWorkItemTypePlural} for ${workItem.workItemType} ${workItem.workItemId}`
    );

    return {
      statusCode: 200,
      body: {
        workItem,
        workItems,
        documents,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error });

    throw new Error(
      `Could not create work items: ${JSON.stringify({
        statusCode: 500,
        error: error.message,
      })}`
    );
  }
};

/**
 * Initialize Azure service (singleton pattern for Lambda container reuse)
 */
const getAzureService = (): AzureService => {
  if (!azureService) {
    azureService = new AzureService();
  }

  return azureService;
};

const validateEventBody = (body: any) => {
  if (!body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return body;
};

const parseEventBody = (
  body: any
): {
  workItem: WorkItem;
  documents: BedrockKnowledgeDocument[];
  workItems: WorkItem[];
  workItemStatus: BedrockResponse;
} => {
  const { workItem, workItems, documents, workItemStatus } = body;

  logger.info(
    `▶️ Creating ${workItems.length} ${getExpectedChildWorkItemType(workItem, true) || 'Work Items'} for ${
      workItem.workItemType
    } ${workItem.workItemId}`,
    {
      workItem,
      workItems,
      documents,
      workItemStatus,
    }
  );

  return { workItem, workItems, documents, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
