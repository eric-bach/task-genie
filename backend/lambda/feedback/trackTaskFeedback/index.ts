import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand as DocQueryCommand,
  ScanCommand as DocScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { FeedbackService } from '../../../services/FeedbackService';
import { FeedbackAction, RecordFeedbackRequest } from '../../../types/feedback';
import {
  AzureDevOpsEvent,
  FieldChange,
  Fields,
  Resource,
  WorkItem,
  WorkItemRelation,
  StoredWorkItemContext,
} from '../../../types/azureDevOps';

/**
 * Lambda function to track user feedback on AI-generated tasks from Azure DevOps webhooks
 *
 * This function processes Azure DevOps task change events and records them as feedback
 * for AI learning. It identifies different types of user actions:
 * - Task deletions (user didn't find the task useful)
 * - Task modifications (user improved the task)
 * - Task state changes (accepted, completed)
 *
 * Special handling for deleted tasks:
 * - Azure DevOps delete events don't include parent work item relationships
 * - For deleted tasks without determinable parent, uses UNKNOWN_PARENT_WORK_ITEM_ID (-1)
 * - This allows feedback collection while marking the missing relationship for analysis
 *
 * The feedback data is used to improve future task generation by learning from user behavior.
 *
 * Environment Variables:
 * - FEEDBACK_TABLE_NAME: DynamoDB table name for storing feedback
 * - RESULTS_TABLE_NAME: DynamoDB table name for querying task results
 * - FEEDBACK_FEATURE_ENABLED: Feature flag to enable/disable feedback tracking (true/false)
 * - AWS_REGION: AWS region for DynamoDB operations
 */

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME;
const RESULTS_TABLE_NAME = process.env.RESULTS_TABLE_NAME;
const FEEDBACK_FEATURE_ENABLED = process.env.FEEDBACK_FEATURE_ENABLED === 'true';

if (!FEEDBACK_TABLE_NAME) {
  throw new Error('FEEDBACK_TABLE_NAME environment variable is required');
}
if (!RESULTS_TABLE_NAME) {
  throw new Error('RESULTS_TABLE_NAME environment variable is required');
}

export const logger = new Logger({ serviceName: 'trackTaskFeedback' });

// Cache for dependencies
let feedbackService: FeedbackService | null = null;
let dynamoDocClient: DynamoDBDocumentClient | null = null;
let dynamoClient: DynamoDBClient | null = null;

const lambdaHandler = async (event: AzureDevOpsEvent, context: Context) => {
  try {
    // Check if feedback feature is enabled
    if (!FEEDBACK_FEATURE_ENABLED) {
      logger.info('Feedback feature is disabled, skipping processing', {
        feedbackFeatureEnabled: FEEDBACK_FEATURE_ENABLED,
      });
      return { message: 'Feedback feature is disabled' };
    }

    const eventFields = getEventFields(event);
    logger.info(`▶️ Processing Task Genie feedback for ${event.resource?.revision?.id || event.resource?.id}`, {
      taskId: event.resource?.workItemId,
      eventType: event.eventType,
      resourceVersion: event.resourceVersion,
      resourceType: eventFields['System.WorkItemType'],
      feedbackFeatureEnabled: FEEDBACK_FEATURE_ENABLED,
    });

    // Validate this is a user task-related event
    if (!isUserTaskEvent(event)) {
      logger.info('Skipping. Not a user created Task event', {
        eventType: event.eventType,
        resourceType: eventFields['System.WorkItemType'],
        resourceVersion: event.resourceVersion,
      });

      return { message: 'Skipped. Not a user created Task event' };
    }

    // Parse the Azure DevOps event to extract feedback information
    const feedbackData = await parseAzureDevOpsTaskEvent(event);

    if (!feedbackData) {
      logger.error('💣 No feedback data extracted from event');
      return { message: 'No actionable feedback data' };
    }

    // Record the feedback
    const feedbackService = getFeedbackService();
    const feedbackId = await feedbackService.recordFeedback(feedbackData);

    logger.info('✅ Successfully recorded task feedback', {
      feedbackId,
      feedback: feedbackData,
      workItemId: feedbackData.workItemId,
      taskId: feedbackData.taskId,
      action: feedbackData.action,
    });

    return {
      message: 'Feedback recorded successfully',
      action: feedbackData.action,
      taskId: feedbackData.taskId,
    };
  } catch (error) {
    logger.error('🛑 Error processing task feedback', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      event: event, // Log the full event for debugging async failures
    });

    // For async invocation, we don't return error status codes since the caller already got 202
    // The error is logged and can be monitored via CloudWatch
    throw error; // This will trigger Lambda error handling/retries if configured
  }
};

/**
 * Get fields from Azure DevOps event, handling both created and updated task structures
 *
 * Azure DevOps sends different event structures:
 * - For created tasks (workitem.created): fields are in event.resource.fields
 * - For updated tasks (workitem.updated): fields are in event.resource.revision.fields
 * - For deleted tasks (workitem.deleted): fields are in event.resource.revision.fields
 *
 * This helper function abstracts away the structural differences and provides
 * a consistent way to access work item fields regardless of the event type.
 */
function getEventFields(event: AzureDevOpsEvent): Fields {
  return (event.resource?.revision?.fields || event.resource?.fields || {}) as Fields;
}

/**
 * Safely extract field value from Azure DevOps field structure
 * Handles both simple values and oldValue/newValue change objects
 */
function getFieldValue(
  field: string | number | boolean | FieldChange | undefined | null,
  useOldValue: boolean = false
): string {
  if (field === undefined || field === null) {
    return '';
  }

  // If it's a simple string/number/boolean value
  if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean') {
    return String(field);
  }

  // If it's a change object with oldValue/newValue
  if (field && typeof field === 'object' && ('oldValue' in field || 'newValue' in field)) {
    if (useOldValue && field.oldValue !== undefined) {
      return String(field.oldValue);
    }
    if (field.newValue !== undefined) {
      return String(field.newValue);
    }
    if (field.oldValue !== undefined) {
      return String(field.oldValue);
    }
  }

  // Fallback to string representation
  return String(field);
}

/**
 * Check if the Azure DevOps event is related to a task created by a user
 */
function isUserTaskEvent(event: AzureDevOpsEvent): boolean {
  const fields = getEventFields(event);
  // Note: These fields are used for validation only and should always be simple values
  // The WorkItemType and ChangedBy fields are not typically complex field change objects
  const workItemType = getFieldValue(fields['System.WorkItemType']);
  const changedBy = getFieldValue(fields['System.ChangedBy']);

  return (
    workItemType === 'Task' &&
    ((event.eventType === 'workitem.created' && !changedBy?.includes('Task Genie')) || // not created by Task Genie
      event.eventType === 'workitem.updated' ||
      event.eventType === 'workitem.deleted')
  );
}

function getTaskId(resource: Resource): number | null {
  return resource?.revision?.id || resource?.id || null;
}

/**
 * Parse Azure DevOps task event to extract feedback information
 */
async function parseAzureDevOpsTaskEvent(event: AzureDevOpsEvent): Promise<RecordFeedbackRequest | null> {
  try {
    const resource = event.resource;
    if (!resource) {
      logger.warn('No resource found in Azure DevOps event');
      return null;
    }

    if (!isUserTaskEvent(event)) {
      logger.info('Skipping. Not a Task Genie Task modified by a user', {
        eventType: event.eventType,
      });
      return null;
    }

    // The task ID is in revision.id (for updates/deletes) and in resource.id (for creates)
    const taskId = getTaskId(resource);
    if (!taskId) {
      logger.warn('Could not determine task ID from event');
      return null;
    }

    const fields = getEventFields(event);
    const workItem = await getParentWorkItem(taskId, resource, fields);

    // Determine the feedback action based on the event
    const action = determineFeedbackAction(event);
    if (!action) {
      return null;
    }

    // Extract original task details using helper function to handle both field structures
    let originalTask: { title: string; description: string } = { title: '', description: '' };
    if (
      (action === FeedbackAction.MODIFIED && event.eventType === 'workitem.updated') ||
      action === FeedbackAction.ACCEPTED ||
      action === FeedbackAction.COMPLETED
    ) {
      // For updated events, get old values from revision fields
      originalTask = {
        title: getFieldValue(fields['System.Title'], true),
        description: getFieldValue(fields['System.Description'], true),
      };
    } else if (action === FeedbackAction.DELETED) {
      // For deleted events, get current values from fields
      originalTask = {
        title: getFieldValue(fields['System.Title']),
        description: getFieldValue(fields['System.Description']),
      };
    } else {
      originalTask = {
        title: '',
        description: '',
      };
    }

    let modifiedTask: { title: string; description: string };
    if (action === FeedbackAction.DELETED) {
      modifiedTask = { title: '', description: '' };
    } else {
      modifiedTask = {
        title: getFieldValue(fields['System.Title']),
        description: getFieldValue(fields['System.Description']),
      };
    }

    return {
      workItemId: workItem.workItemId,
      taskId,
      action,
      userId: getFieldValue(fields['System.ChangedBy']) || 'unknown',
      originalTask,
      modifiedTask,
      workItemContext: workItem,
      userComment: extractUserComment(event),
    };
  } catch (error) {
    logger.error('🛑 Error parsing Azure DevOps task event', { error });
    return null;
  }
}

async function getParentWorkItem(taskId: number, resource: Resource, fields: Fields): Promise<WorkItem> {
  try {
    const workItemId = await getParentWorkItemId(taskId, resource);

    logger.debug(`Retrieved parent work item Id for ${taskId}`, {
      workItemId,
    });

    const workItem = await getParentWorkItemContext(workItemId, taskId, fields);

    if (!workItem) {
      throw Error(`No parent work item found for task ${taskId}`);
    }

    return workItem;
  } catch (error) {
    logger.error('🛑 Error fetching parent work item', { error });
    throw error;
  }
}

/**
 * Get the parent work item ID by first parsing it from the task relations object.  If not found,
 * fall back to querying the results table in DynamoDB.
 * @params taskId The Azure DevOps task ID
 * @params resource The Azure DevOps resource object from the event
 */
async function getParentWorkItemId(taskId: number, resource: Resource): Promise<number> {
  try {
    logger.debug(`⚙️ Looking up parent work item id for ${taskId}`, { taskId });

    // Strategy 1: Extract from task relations
    const workItemIdFromRelations = extractWorkItemIdFromRelations(resource);
    if (workItemIdFromRelations) {
      logger.debug('Found parent work item id in task relations', { taskId, workItemId: workItemIdFromRelations });
      return workItemIdFromRelations;
    }

    // Strategy 2: Extract from task fields
    const workItemIdFromFields = extractWorkItemIdFromFields(resource);
    if (workItemIdFromFields) {
      logger.debug('Found parent work item id in task fields', { taskId, workItemId: workItemIdFromFields });
      return workItemIdFromFields;
    }

    // Strategy 3: Query DynamoDB tables
    const workItemIdFromDatabase = await findWorkItemIdInDatabase(taskId);
    if (workItemIdFromDatabase) {
      logger.debug('Found parent work item id in database', { taskId, workItemId: workItemIdFromDatabase });
      return workItemIdFromDatabase;
    }

    logger.warn('Parent work item id not found in any source', { taskId });
    throw new Error('Parent work item id not found');
  } catch (error) {
    logger.error('🛑 Error getting parent work item id', { taskId, error });
    throw error;
  }
}

/**
 * Extract work item ID from Azure DevOps task relations
 */
function extractWorkItemIdFromRelations(resource: Resource): number | null {
  const relations = resource.revision?.relations || resource.relations;

  if (!relations) {
    return null;
  }

  let relationsArray: WorkItemRelation[] = [];

  // Handle different relation structures
  if (Array.isArray(relations)) {
    // Direct array format: relations: [...]
    relationsArray = relations;
  } else if (typeof relations === 'object') {
    // Object with arrays format: relations: { "removed": [...], "added": [...] }
    // Check all possible arrays (added, removed, etc.)
    const allRelations: WorkItemRelation[] = [];

    Object.values(relations).forEach((relationGroup: WorkItemRelation[] | undefined) => {
      if (Array.isArray(relationGroup)) {
        allRelations.push(...relationGroup);
      }
    });

    relationsArray = allRelations;
  } else {
    return null;
  }

  // Find the parent relation
  const parentRelation = relationsArray.find(
    (rel: WorkItemRelation) => rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
  );
  if (!parentRelation?.url) return null;

  // Extract work item ID from URL like: https://dev.azure.com/.../workItems/123
  const match = parentRelation.url.match(/workItems\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract work item ID from Azure DevOps task fields
 */
function extractWorkItemIdFromFields(resource: Resource): number | null {
  const fields = resource.revision?.fields || resource.fields;
  if (!fields?.['System.Parent']) return null;

  const parentValue = getFieldValue(fields['System.Parent']);
  return parentValue ? parseInt(parentValue, 10) : null;
}

/**
 * Find work item ID by searching DynamoDB tables
 */
async function findWorkItemIdInDatabase(taskId: number): Promise<number | null> {
  // First try results table (more likely to have the data)
  const workItemIdFromResults = await queryResultsTableForWorkItemId(taskId);
  if (workItemIdFromResults) {
    return workItemIdFromResults;
  }

  // Fallback to feedback table
  const workItemIdFromFeedback = await queryFeedbackTableForWorkItemId(taskId);
  if (workItemIdFromFeedback) {
    return workItemIdFromFeedback;
  }

  return null;
}

// Type for DynamoDB results table items
interface ResultsTableItem {
  workItemId: number;
  taskIds: number[];
  [key: string]: unknown;
}

/**
 * Query results table to find work item ID by task ID
 */
async function queryResultsTableForWorkItemId(taskId: number): Promise<number | null> {
  try {
    const docClient = getDynamoDocClient();

    const response = await docClient.send(
      new DocScanCommand({
        TableName: RESULTS_TABLE_NAME,
        FilterExpression: 'contains(taskIds, :taskId)',
        ExpressionAttributeValues: {
          ':taskId': taskId,
        },
        Limit: 1,
      })
    );

    if (response.Items && response.Items.length > 0) {
      const item = response.Items[0] as ResultsTableItem;
      return item.workItemId || null;
    }

    return null;
  } catch (error) {
    logger.warn('Error querying results table for work item ID', { taskId, error });
    return null;
  }
}

// Type for DynamoDB feedback table items
interface FeedbackTableItem {
  workItemId: number;
  taskId: number;
  [key: string]: unknown;
}

/**
 * Query feedback table to find work item ID by task ID
 */
async function queryFeedbackTableForWorkItemId(taskId: number): Promise<number | null> {
  try {
    const docClient = getDynamoDocClient();

    const response = await docClient.send(
      new DocQueryCommand({
        TableName: FEEDBACK_TABLE_NAME,
        IndexName: 'taskId-timestamp-index',
        KeyConditionExpression: 'taskId = :taskId',
        ExpressionAttributeValues: {
          ':taskId': taskId,
        },
        ScanIndexForward: false,
        Limit: 1,
      })
    );

    if (response.Items && response.Items.length > 0) {
      const item = response.Items[0] as FeedbackTableItem;
      return item.workItemId || null;
    }

    return null;
  } catch (error) {
    logger.warn('Error querying feedback table for work item ID', { taskId, error });
    return null;
  }
}

/**
 * Determine the feedback action based on the Azure DevOps event
 */
function determineFeedbackAction(event: AzureDevOpsEvent): FeedbackAction | null {
  const eventType = event.eventType;
  const fields = getEventFields(event);

  switch (eventType) {
    case 'workitem.deleted':
      return FeedbackAction.DELETED;

    case 'workitem.updated':
      const newState = getFieldValue(fields['System.State']);
      const oldState = getFieldValue(event.resource?.revision?.fields?.['System.State'], true);

      // Check if state changed to active/in-progress (accepted)
      if (oldState === 'New' && (newState === 'Active' || newState === 'In Progress')) {
        return FeedbackAction.ACCEPTED;
      }

      // Check if state changed to completed/done
      if (newState === 'Closed' || newState === 'Done' || newState === 'Completed') {
        return FeedbackAction.COMPLETED;
      }

      // Check if state changed to "Removed" (indicates task wasn't useful)
      // Treat "Removed" status the same as deletion since it indicates the task was not useful
      if (newState === 'Removed') {
        return FeedbackAction.DELETED;
      }

      return FeedbackAction.MODIFIED;

    case 'workitem.created':
      // Check if this is a user-created task (not AI-generated)
      // AI-generated tasks have the "Task Genie" tag
      const tags = getFieldValue(fields['System.Tags']) || '';
      if (!tags.includes('Task Genie')) {
        // This is a user-created task, indicating AI might have missed something
        return FeedbackAction.MISSED_TASK;
      }

      // AI-generated tasks are not considered feedback
      return null;
  }

  return null;
}

/**
 * Extract user comment from the event if available
 */
function extractUserComment(event: AzureDevOpsEvent): string | undefined {
  try {
    // Check if there's a comment in the event
    const fields = getEventFields(event);
    const historyValue = getFieldValue(fields['System.History']);
    if (historyValue) {
      return historyValue;
    }
    return undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Get parent work item context from DynamoDB results table
 * This avoids calling Azure DevOps API by using cached results from task generation
 */
async function getParentWorkItemContext(workItemId: number, taskId: number, taskFields: Fields): Promise<WorkItem> {
  try {
    const docClient = getDynamoDocClient();

    // Query by workItemId using DocumentClient for simpler marshalling
    const response = await docClient.send(
      new DocQueryCommand({
        TableName: RESULTS_TABLE_NAME,
        IndexName: 'workItemId-timestamp-index',
        KeyConditionExpression: 'workItemId = :workItemId',
        ExpressionAttributeValues: {
          ':workItemId': workItemId,
        },
        ScanIndexForward: false,
        Limit: 1,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      logger.warn('Could not find parent work item for task. Defaulting to task-level context', { taskId, workItemId });
      return getFallbackContext(workItemId, taskFields);
    }

    const workItem = response.Items[0] as StoredWorkItemContext;

    const workItemContext: WorkItem = {
      workItemId: workItem.workItemId,
      workItemType: 'User Story',
      title: workItem?.title || getFieldValue(taskFields['System.Title']) || '',
      description: workItem?.description || getFieldValue(taskFields['System.Description']) || '',
      acceptanceCriteria: workItem?.acceptanceCriteria || '',
      areaPath: workItem?.areaPath || getFieldValue(taskFields['System.AreaPath']) || '',
      iterationPath: workItem?.iterationPath || getFieldValue(taskFields['System.IterationPath']) || '',
      businessUnit: workItem?.businessUnit || '',
      system: workItem?.system || '',
      teamProject: workItem?.teamProject || getFieldValue(taskFields['System.TeamProject']) || '',
      changedBy: workItem?.changedBy || getFieldValue(taskFields['System.ChangedBy']) || '',
      tags: workItem?.tags || [],
    };

    logger.debug('Retrieved parent work item context from results table', {
      workItemId,
      taskId,
      workItemContext,
    });

    return workItemContext;
  } catch (error) {
    logger.error('🛑 Failed to fetch parent work item context from results table. Defaulting to task-level context', {
      workItemId,
      taskId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return getFallbackContext(workItemId, taskFields);
  }
}

/**
 * Get fallback context from task fields when parent context is not available
 */
function getFallbackContext(workItemId: number, taskFields: Fields): WorkItem {
  return {
    workItemId,
    workItemType: 'User Story',
    title: getFieldValue(taskFields['System.Title']) || '',
    description: getFieldValue(taskFields['System.Description']) || '',
    acceptanceCriteria: '',
    changedBy: getFieldValue(taskFields['System.ChangedBy']) || '',
    tags: [],
    iterationPath: getFieldValue(taskFields['System.IterationPath']) || '',
    areaPath: getFieldValue(taskFields['System.AreaPath']) || '',
    businessUnit: '', // Not available at task level
    system: '', // Not available at task level
    teamProject: getFieldValue(taskFields['System.TeamProject']) || '',
  };
}

/**
 * Get or create DynamoDB Client instance (singleton for Lambda container reuse)
 */
function getDynamoClient(): DynamoDBClient {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({ region: AWS_REGION });
  }
  return dynamoClient;
}

/**
 * Get or create DynamoDB DocumentClient instance (singleton for Lambda container reuse)
 */
function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!dynamoDocClient) {
    const client = getDynamoClient();
    dynamoDocClient = DynamoDBDocumentClient.from(client);
  }
  return dynamoDocClient;
}

/**
 * Get or create FeedbackService instance (singleton for Lambda container reuse)
 */
function getFeedbackService(): FeedbackService {
  if (!feedbackService) {
    feedbackService = new FeedbackService({
      region: AWS_REGION,
      tableName: FEEDBACK_TABLE_NAME!,
    });
  }
  return feedbackService;
}

// Export the Lambda handler with middleware
export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
