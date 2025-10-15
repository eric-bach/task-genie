import { Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { WorkItem } from '../../../types/azureDevOps';
import { AzureService } from '../../../services/AzureService';

export const AZURE_DEVOPS_ORGANIZATION = process.env.AZURE_DEVOPS_ORGANIZATION;
if (AZURE_DEVOPS_ORGANIZATION === undefined) {
  throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
}

export const logger = new Logger({ serviceName: 'handleError' });

// Cache for dependencies
let azureService: AzureService | null = null;

interface ErrorEvent {
  body?: {
    workItem?: WorkItem;
  };
  resource?: {
    workItemId?: number;
    rev?: number;
    revision?: {
      fields?: {
        'System.TeamProject'?: string;
        'System.ChangedBy'?: string;
        'System.Title'?: string;
        'System.Description'?: string;
        [key: string]: any;
      };
    };
  };
  Error?: string;
  Cause?: string;
  statusCode?: number;
  errorStep?: string;
}

const lambdaHandler = async (event: ErrorEvent, context: Context) => {
  try {
    logger.info('🚨 Handling error event', { event });

    // Parse the error information
    const { workItem, errorMessage, errorStep } = parseErrorEvent(event);

    if (workItem && workItem.workItemId > 0) {
      // Generate error comment
      const comment = generateErrorComment(errorMessage, errorStep);

      // Add error comment to work item
      const azureService = getAzureService();
      await azureService.addComment(workItem, comment);

      logger.info(`✅ Added error comment to work item ${workItem.workItemId}`);
    } else {
      logger.warn('No valid work item found to add error comment to');
    }

    return {
      statusCode: 500,
      body: {
        workItem,
        error: errorMessage,
        errorStep,
        errorHandled: true,
      },
    };
  } catch (error: any) {
    logger.error('💣 Failed to handle error', { error: error.message });

    return {
      statusCode: 500,
      body: {
        error: error.message,
        errorHandled: false,
      },
    };
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
 * Parse the error event to extract relevant information
 */
const parseErrorEvent = (
  event: ErrorEvent
): {
  workItem?: WorkItem;
  errorMessage: string;
  errorStep: string;
} => {
  let workItem: WorkItem | undefined;
  let errorMessage: string;
  let errorStep: string;

  // Try to extract work item from event body first
  if (event.body?.workItem) {
    workItem = event.body.workItem;
  }
  // If no body, try to construct workItem from resource (evaluateUserStory error case)
  else if (event.resource && event.resource.workItemId) {
    const fields = event.resource.revision?.fields;
    workItem = {
      workItemId: event.resource.workItemId,
      teamProject: fields?.['System.TeamProject'] || 'Unknown',
      areaPath: fields?.['System.AreaPath'] || '',
      iterationPath: fields?.['System.IterationPath'] || '',
      businessUnit: fields?.['Custom.BusinessUnit'],
      system: fields?.['Custom.System'],
      changedBy: extractUserFromChangedBy(fields?.['System.ChangedBy'] || 'Unknown'),
      title: fields?.['System.Title'] || 'Unknown',
      description: fields?.['System.Description'] || '',
      acceptanceCriteria: fields?.['Microsoft.VSTS.Common.AcceptanceCriteria'] || '',
      tags: [], // Default empty array
      images: [], // Default empty array
    };
  }

  // Parse error information
  if (event.Error) {
    errorMessage = event.Error;
  } else if (event.Cause) {
    try {
      const cause = JSON.parse(event.Cause);
      errorMessage = cause.errorMessage || cause.Error || 'Unknown error occurred';
    } catch {
      errorMessage = event.Cause;
    }
  } else {
    errorMessage = 'Unknown error occurred during workflow execution';
  }

  // Determine which step failed
  errorStep = event.errorStep || 'Unknown step';

  return { workItem, errorMessage, errorStep };
};

/**
 * Extract user name from "User Name <guid>" format
 */
const extractUserFromChangedBy = (changedBy: string): string => {
  const match = changedBy.match(/^([^<]+)/);
  return match ? match[1].trim() : changedBy;
};

/**
 * Generate a user-friendly error comment for Azure DevOps
 */
const generateErrorComment = (errorMessage: string, errorStep: string): string => {
  return `<br />⚠️ Task Genie Error<br /><br />
Unfortunately, an error occurred while processing your request:<br /><br />
<b>Step:</b> ${errorStep}<br />
<b>Error:</b> ${errorMessage}<br /><br />
Please check the error details and try again. If the problem persists, contact your administrator.<br /><br />
<i>This is an automated message from Task Genie.</i>
  `.trim();
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
