import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

import { WorkItem } from '../../../types/azureDevOps';
import { BedrockInferenceParams, BedrockWorkItemEvaluationResponse } from '../../../types/bedrock';
import { BedrockService, BedrockServiceConfig } from '../../../services/BedrockService';
import { AzureService } from '../../../services/AzureService';

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
 * - FEEDBACK_FEATURE_ENABLED: Feature flag to enable/disable feedback learning (true/false)
 * - AZURE_DEVOPS_PAT_PARAMETER_NAME: Parameter Store parameter name containing Azure DevOps PAT
 */

// Environment variables
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
if (!AWS_ACCOUNT_ID) {
  throw new Error('AWS_ACCOUNT_ID environment variable is required');
}
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (!AWS_BEDROCK_MODEL_ID) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
if (!AWS_BEDROCK_KNOWLEDGE_BASE_ID) {
  throw new Error('AWS_BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
}
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME;
if (!CONFIG_TABLE_NAME) {
  throw new Error('CONFIG_TABLE_NAME environment variable is required');
}
export const AZURE_DEVOPS_ORGANIZATION = process.env.AZURE_DEVOPS_ORGANIZATION;
if (AZURE_DEVOPS_ORGANIZATION === undefined) {
  throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
}
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME;
if (!FEEDBACK_TABLE_NAME) {
  throw new Error('FEEDBACK_TABLE_NAME environment variable is required');
}
const FEEDBACK_FEATURE_ENABLED = process.env.FEEDBACK_FEATURE_ENABLED === 'true';

// Clients and services
const logger = new Logger({ serviceName: 'defineTasks' });

// Cache for dependencies
let azureService: AzureService | null = null;
let bedrockService: BedrockService | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Parse event body
    const { workItem, params, workItemStatus } = parseEventBody(event.body);

    const azureService = getAzureService();
    const existingTasks = await azureService.getTasksForWorkItem(workItem);

    // Generate tasks
    const bedrock = getBedrockService();
    const bedrockResponse = await bedrock.generateTasks(workItem, existingTasks, params);

    logger.info(`✅ Generated ${bedrockResponse.tasks.length} tasks for work item ${workItem.workItemId}`);

    return {
      statusCode: 200,
      body: {
        workItem,
        tasks: bedrockResponse.tasks,
        documents: bedrockResponse.documents,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 Task generation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    throw new Error(
      `Task generation failed: ${JSON.stringify({
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
      configTableName: CONFIG_TABLE_NAME,
      feedbackTableName: FEEDBACK_TABLE_NAME,
      feedbackFeatureEnabled: FEEDBACK_FEATURE_ENABLED,
    };

    bedrockService = new BedrockService(config);
  }
  return bedrockService;
};

/**
 * Parse and validate the event body
 */
const parseEventBody = (
  body: any
): { workItem: WorkItem; params: BedrockInferenceParams; workItemStatus: BedrockWorkItemEvaluationResponse } => {
  if (!body || !body.workItem) {
    throw new Error('Invalid event payload: missing workItem in request body');
  }

  const { params = {}, workItem, workItemStatus } = body;

  logger.info(`▶️ Starting processing of work item ${workItem.workItemId}`, {
    title: workItem.title,
    areaPath: workItem.areaPath,
    iterationPath: workItem.iterationPath,
    businessUnit: workItem.businessUnit,
    system: workItem.system,
    hasImages: !!(workItem.images && workItem.images.length > 0),
    imagesCount: workItem.images?.length || 0,
    feedbackFeatureEnabled: FEEDBACK_FEATURE_ENABLED,
  });

  return { params, workItem, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
