import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task } from '../../types/azureDevOps';
import { BedrockKnowledgeDocument, BedrockResponse } from '../../types/bedrock';
import { AzureService } from '../../services/AzureService';
import { CloudWatchService } from '../../services/CloudWatchService';

export const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION;
if (GITHUB_ORGANIZATION === undefined) {
  throw new Error('GITHUB_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'createTasks' });

// Cache for dependencies
let azureService: AzureService | null = null;
let personalAccessToken: string | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Validate event body
    const body = validateEventBody(event.body);

    // Parse work item
    const { workItem, tasks, documents, workItemStatus } = parseEventBody(body);

    // Create tasks
    const azureService = getAzureService();
    await azureService.createTasks(GITHUB_ORGANIZATION, workItem, tasks);

    // Add CloudWatch metrics
    const cloudWatchService = new CloudWatchService();
    await cloudWatchService.createTaskGeneratedMetric(tasks.length);
    await cloudWatchService.createUserStoriesUpdatedMetric();

    logger.info(`✅ Created ${tasks.length} tasks for work item ${workItem.workItemId}`);

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks,
        documents,
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

/**
 * Initialize Azure service (singleton pattern for Lambda container reuse)
 */
const getAzureService = (): AzureService => {
  if (!azureService) {
    azureService = new AzureService(personalAccessToken);
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
): { workItem: WorkItem; documents: BedrockKnowledgeDocument[]; tasks: Task[]; workItemStatus: BedrockResponse } => {
  const { workItem, tasks, documents, workItemStatus } = body;

  logger.info(`Received work item ${workItem.workItemId} and ${tasks.length} tasks`, {
    workItem,
    tasks,
    documents,
    workItemStatus,
  });

  return { workItem, tasks, documents, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
