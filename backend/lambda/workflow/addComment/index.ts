import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task } from '../../../types/azureDevOps';
import { AzureService } from '../../../services/AzureService';
import { BedrockKnowledgeDocument, BedrockWorkItemEvaluationResponse } from '../../../types/bedrock';

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'addComment' });

// Cache for dependencies
let azureService: AzureService | null = null;
let personalAccessToken: string | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event
    validateEvent(event);

    // Parse event
    const { workItem, tasks, documents, workItemStatus } = parseEvent(event);

    // Generate comment
    const comment = workItemStatus.pass ? generateComment(workItem, tasks, documents) : workItemStatus.comment;

    // Add comment
    const azureService = getAzureService();
    await azureService.addComment(GITHUB_ORGANIZATION, workItem, comment);

    // Add tag
    if (workItemStatus.pass) {
      await azureService.addTag(GITHUB_ORGANIZATION, workItem, 'Task Genie');
    }

    logger.info(`✅ Added comment to work item ${workItem.workItemId}`);

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
    azureService = new AzureService(personalAccessToken);
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
  tasks: Task[];
  documents: BedrockKnowledgeDocument[];
  workItemStatus: BedrockWorkItemEvaluationResponse;
} => {
  const body = event.body;

  let { workItem, tasks, documents, workItemStatus } = body;
  tasks = tasks ?? [];

  logger.info(`Received work item ${workItem.workItemId} and ${tasks.length} tasks`, {
    workItem,
    tasks,
    documents,
    workItemStatus,
  });

  return { workItem, tasks, documents, workItemStatus };
};

const generateComment = (workItem: WorkItem, tasks: Task[], documents: BedrockKnowledgeDocument[]): string => {
  const comment = `Generated ${tasks.length} tasks for work item ${workItem.workItemId}`;

  if (documents.length > 1) {
    const sources = documents
      .map((doc) => {
        const fileName = doc.source.split('/').pop();
        return fileName || doc.source;
      })
      .join('<br />');
    return `${comment} from ${documents.length} knowledge base documents.<br /><br />Sources:<br />${sources}`;
  }

  return comment;
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
