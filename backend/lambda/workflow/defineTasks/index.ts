import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

import { WorkItem } from '../../../types/azureDevOps';
import { BedrockInferenceParams, BedrockWorkItemEvaluationResponse } from '../../../types/bedrock';
import { BedrockService, BedrockServiceConfig } from '../../../services/BedrockService';

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

// Clients and services
const logger = new Logger({ serviceName: 'defineTasks' });

// Cache for dependencies
let bedrockService: BedrockService | null = null;

const lambdaHandler = async (event: Record<string, any>, context: Context) => {
  try {
    // Parse event body
    const { workItem, params, workItemStatus } = parseEventBody(event.body);

    // Generate tasks
    const bedrock = getBedrockService();
    const bedrockResponse = await bedrock.generateTasks(workItem, params);

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
    businessUnit: workItem.businessUnit,
    system: workItem.system,
    hasImages: !!(workItem.images && workItem.images.length > 0),
    imagesCount: workItem.images?.length || 0,
  });

  return { params, workItem, workItemStatus };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
