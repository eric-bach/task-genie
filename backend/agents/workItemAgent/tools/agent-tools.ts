import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { WorkItemSchema } from './schemas.js';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const logger = {
  info(message: string, extra?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'INFO', message, ...extra }));
  },
  error(message: string, extra?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'ERROR', message, ...extra }));
  },
};

/**
 * Extracts type-specific fields from a work item for DynamoDB storage
 */
const extractWorkItemFields = (workItem: z.infer<typeof WorkItemSchema>) => {
  return {
    id: workItem.workItemId,
    title: workItem.title || '',
    description: workItem.description || '',
    workItemType: workItem.workItemType,
    acceptanceCriteria: workItem.acceptanceCriteria || '',
  };
};

/**
 * Saves the execution result to DynamoDB
 */
const saveResponseToDynamoDB = async (
  workItem: z.infer<typeof WorkItemSchema>,
  childWorkItems: z.infer<typeof WorkItemSchema>[],
  outcome: string,
  comment: string
) => {
  const tableName = process.env.RESULTS_TABLE_NAME;

  if (!tableName) {
    logger.error('RESULTS_TABLE_NAME environment variable is not set');
    return;
  }

  const executionId = uuidv4();
  const passed = outcome === 'decomposed';

  const item = {
    executionId,
    executionResult: passed ? 'SUCCEEDED' : 'FAILED',
    timestamp: new Date().toISOString(),
    // ADO fields
    ...(workItem.areaPath && { areaPath: workItem.areaPath }),
    ...(workItem.iterationPath && { iterationPath: workItem.iterationPath }),
    ...(workItem.businessUnit && { businessUnit: workItem.businessUnit }),
    ...(workItem.system && { system: workItem.system }),
    // Work Item
    workItemId: workItem.workItemId,
    workItemStatus: passed,
    workItemComment: comment,
    workItem: extractWorkItemFields(workItem),
    workItemsCount: childWorkItems?.length || 0,
    workItemIds: childWorkItems?.map((wi) => wi.workItemId) || [],
    workItems: childWorkItems?.map((w) => extractWorkItemFields(w)) || [],
    changedBy: workItem.changedBy || '',
  };

  const command = new PutCommand({
    TableName: tableName,
    Item: item,
  });

  try {
    await docClient.send(command);
    logger.info('💾 Saved result to DynamoDB', { workItemId: workItem.workItemId, executionId });
  } catch (error) {
    logger.error('🛑 Failed to save to DynamoDB', { error: String(error), workItemId: workItem.workItemId });
  }
};

// Define the finalize response tool
export const finalize_response = tool({
  name: 'finalize_response',
  description: 'Finalize the response after processing a work item. Provide a summary of what was accomplished.',
  inputSchema: z.object({
    workItem: WorkItemSchema.describe('The parent work item that was processed'),
    childWorkItems: z.array(WorkItemSchema).optional().describe('The child work items that were created'),
    outcome: z
      .enum(['decomposed', 'feedback_provided', 'skipped', 'error'])
      .describe('The outcome of processing the work item'),
    summary: z.string().describe('A brief summary of what was done'),
  }),
  callback: async (input) => {
    const { workItem, childWorkItems, outcome, summary } = input;
    const { workItemId, title: workItemTitle, workItemType } = workItem;
    const childItemsCreated = childWorkItems?.length || 0;

    let response = '';
    switch (outcome) {
      case 'decomposed':
        response = `✅ Successfully decomposed ${workItemType} #${workItemId} "${workItemTitle}" into ${childItemsCreated} child Tasks. ${summary}`;
        break;
      case 'feedback_provided':
        response = `📝 Provided feedback on ${workItemType} #${workItemId} "${workItemTitle}". ${summary}`;
        break;
      case 'skipped':
        response = `⏭️ Skipped ${workItemType} #${workItemId} "${workItemTitle}". ${summary}`;
        break;
      case 'error':
        response = `❌ Error processing ${workItemType} #${workItemId} "${workItemTitle}". ${summary}`;
        break;
    }

    // Save to DynamoDB
    await saveResponseToDynamoDB(workItem, childWorkItems || [], outcome, response);

    return { workItemId, outcome, response };
  },
});
