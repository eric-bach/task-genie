import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem, Task } from '../../../types/azureDevOps';
import { BedrockWorkItemEvaluationResponse } from '../../../types/bedrock';

const logger = new Logger({ serviceName: 'sendResponse' });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true, // Automatically remove undefined values
  },
});

const lambdaHandler = async (event: any, context: Context) => {
  try {
    // Validate event
    event = validateEvent(event);

    // Parse work item
    const { executionId: executionId, workItem, tasks, workItemStatus } = parseEvent(event);

    // Save response to DynamoDB
    await saveResponseToDynamoDB(executionId, workItem, tasks, workItemStatus);

    logger.info(`✅ Completed execution workflow for work item ${workItem.workItemId}`);

    return {
      statusCode: event.statusCode,
      body: {
        isValidWorkItem: event.statusCode === 200 || event.statusCode === 204,
        isModified: workItem.workItemId > 0 && event.statusCode !== 204,
        workItem,
        tasks,
        workItemStatus,
      },
    };
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: event.error, reason: event.message });

    throw new Error(
      `Could not complete execution: ${JSON.stringify({
        statusCode: 500,
        error: event.error,
        message: event.message,
      })}`
    );
  }
};

const validateEvent = (event: any) => {
  if (!event.executionArn) {
    throw Error('Invalid event payload: the execution ARN is missing or undefined.');
  }

  if (!event.body) {
    throw Error('Invalid event payload: the request body is missing or undefined.');
  }

  return event;
};

const parseEvent = (
  event: any
): { executionId: string; workItem: WorkItem; tasks: Task[]; workItemStatus: BedrockWorkItemEvaluationResponse } => {
  const { workItem, tasks, workItemStatus } = event.body;

  // Use executionId as the executionId for storage
  const executionArn = event.executionArn.split(':');
  const executionId = executionArn.slice(7).join(':') || '';

  logger.info(`▶️ Received work item ${workItem.workItemId}`, {
    executionArn,
    executionId,
    workItem,
    tasks,
    workItemStatus,
  });

  return { executionId, workItem, tasks, workItemStatus };
};

const saveResponseToDynamoDB = async (
  executionId: string,
  workItem: WorkItem,
  tasks: Task[],
  workItemStatus: BedrockWorkItemEvaluationResponse
) => {
  const tableName = process.env.TABLE_NAME;

  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }

  // Denormalize for reporting
  const item = {
    executionId,
    executionResult: workItemStatus.pass ? 'SUCCEEDED' : 'FAILED',
    timestamp: new Date().toISOString(),
    // ADO - only include if defined
    ...(workItem.areaPath && { areaPath: workItem.areaPath }),
    ...(workItem.iterationPath && { iterationPath: workItem.iterationPath }),
    ...(workItem.businessUnit && { businessUnit: workItem.businessUnit }),
    ...(workItem.system && { system: workItem.system }),
    // Work Item
    workItemId: workItem.workItemId,
    workItemStatus: workItemStatus.pass,
    workItemComment: workItemStatus.comment || '', // Provide default for undefined
    workItem: {
      id: workItem.workItemId,
      title: workItem.title || '', // Provide default for undefined
      description: workItem.description || '', // Provide default for undefined
      acceptanceCriteria: workItem.acceptanceCriteria || '', // Provide default for undefined
    },
    tasksCount: tasks?.length || 0,
    taskIds: tasks?.map((task) => task.taskId) || [],
    tasks:
      tasks?.map((task) => ({
        ...(task.taskId && { id: task.taskId }), // Only include if defined
        title: task.title || '', // Provide default for undefined
        description: task.description || '', // Provide default for undefined
      })) || [],
    changedBy: workItem.changedBy || '', // Provide default for undefined
  };

  const command = new PutCommand({
    TableName: tableName,
    Item: item,
  });

  logger.debug('Saving result to DynamoDB', { tableName, item });

  try {
    await docClient.send(command);

    logger.info('💾 Saved result to DynamoDB', { workItemId: workItem.workItemId });
  } catch (error) {
    logger.error('🛑 Failed to save to DynamoDB', { error, workItemId: workItem.workItemId });
    throw error;
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
