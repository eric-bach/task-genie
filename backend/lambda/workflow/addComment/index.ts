import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { getExpectedChildWorkItemType, WorkItem } from '../../../types/azureDevOps';
import { AzureService } from '../../../services/AzureService';
import { BedrockKnowledgeDocument, BedrockWorkItemEvaluationResponse } from '../../../types/bedrock';

export const AZURE_DEVOPS_ORGANIZATION = process.env.AZURE_DEVOPS_ORGANIZATION;
if (AZURE_DEVOPS_ORGANIZATION === undefined) {
  throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'addComment' });

// Cache for dependencies
let azureService: AzureService | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event
    validateEvent(event);

    // Parse event
    const { workItem, workItems, documents, workItemStatus } = parseEvent(event);

    // Generate comment
    const comment = workItemStatus.pass ? generateComment(workItem, workItems, documents) : workItemStatus.comment;

    // Add comment
    const azureService = getAzureService();
    await azureService.addComment(workItem, comment);

    // Add tag
    if (workItemStatus.pass) {
      await azureService.addTag(workItem.teamProject, workItem.workItemId, 'Task Genie');
    }

    logger.info(`✅ Added comment to ${workItem.workItemType} ${workItem.workItemId}`);

    return {
      statusCode: 200,
      body: {
        workItem,
        workItems,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error });

    throw new Error(
      `Could not add comment: ${JSON.stringify({
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

const validateEvent = (event: Record<string, any>) => {
  if (!event.body && !event.body.workItem) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }
};

const parseEvent = (
  event: Record<string, any>
): {
  workItem: WorkItem;
  workItems: WorkItem[];
  documents: BedrockKnowledgeDocument[];
  workItemStatus: BedrockWorkItemEvaluationResponse;
} => {
  const body = event.body;

  let { workItem, workItems, documents, workItemStatus } = body;
  workItems = workItems ?? [];

  logger.info(
    `▶️ Received ${workItem.workItemType} ${workItem.workItemId} with ${
      workItems.length
    } ${getExpectedChildWorkItemType(workItem, true)}`,
    {
      workItem,
      workItems,
      documents,
      workItemStatus,
    }
  );

  return { workItem, workItems, documents, workItemStatus };
};

const generateComment = (workItem: WorkItem, workItems: WorkItem[], documents: BedrockKnowledgeDocument[]): string => {
  const comment = `<br />✅ Successfully generated ${workItems.length} ${getExpectedChildWorkItemType(
    workItem,
    true
  )} for ${workItem.workItemType} ${workItem.workItemId}`;
  if (documents.length > 0) {
    const sources = documents
      .map((doc) => {
        const fileName = doc.source.split('/').pop();
        return fileName || doc.source;
      })
      .join('<br />');

    return `${comment} from ${documents.length} knowledge base documents.<br /><br />
<b>Sources:</b><br />
${sources}<br /><br />
<i>This is an automated message from Task Genie.</i>`;
  }

  return `${comment}.<br /><br />
<i>This is an automated message from Task Genie.</i>`;
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
