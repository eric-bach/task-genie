import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';

const logger = new Logger({ serviceName: 'pollExecution' });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  try {
    // Extract execution id from path parameters and decode it
    const rawExecutionId = event.pathParameters?.executionId;
    const executionId = rawExecutionId ? decodeURIComponent(rawExecutionId) : undefined;

    if (!executionId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Missing executionId parameter',
          message: 'executionId is required in the path parameters',
        }),
      };
    }

    // Query DynamoDB for the execution result
    const result = await pollExecutionResult(executionId);

    if (result) {
      logger.info('✅ Execution result found', { executionId, result });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          status: 'completed',
          executionId,
          result,
        }),
      };
    } else {
      logger.info('Execution result not found - still running', { executionId });

      return {
        statusCode: 202,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          status: 'running',
          executionId,
          message: 'Step function execution is still in progress',
        }),
      };
    }
  } catch (error: any) {
    logger.error('💣 An unexpected error occurred', { error: error.message });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
};

const pollExecutionResult = async (executionId: string) => {
  const tableName = process.env.TABLE_NAME;

  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }

  logger.info('Querying DynamoDB for execution result', { executionId, tableName });

  const command = new GetCommand({
    TableName: tableName,
    Key: {
      executionId: executionId,
    },
    ProjectionExpression: 'executionId, executionResult, workItemId, workItem, tasksCount, tasks, workItemComment',
  });

  try {
    const response = await docClient.send(command);

    if (response.Item) {
      logger.info('Found execution result in DynamoDB', {
        executionId,
        executionResult: response.Item.executionResult,
        workItemId: response.Item.workItemId,
        workItemComment: response.Item.workItemComment,
        tasksCount: response.Item.tasksCount,
      });
      return response.Item;
    } else {
      logger.info('No execution result found in DynamoDB', { executionId });
      return null;
    }
  } catch (error) {
    logger.error('Failed to query DynamoDB', { error, executionId });
    throw error;
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
