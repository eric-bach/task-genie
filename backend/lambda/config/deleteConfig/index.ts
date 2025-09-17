import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

const logger = new Logger({ serviceName: 'DeleteConfig' });
const ddb = new DynamoDBClient({});

export const lambdaHandler = async (event: any) => {
  try {
    const tableName = process.env.CONFIG_TABLE_NAME;
    if (!tableName) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfiguration' }) };
    }

    const adoKey = event.queryStringParameters?.adoKey;
    if (!adoKey) {
      logger.info(`🛑 Missing adoKey`);

      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Missing adoKey' }),
      };
    }

    logger.info(`▶️ Deleting config for work item ${adoKey}`, { table: tableName });

    await ddb.send(
      new DeleteItemCommand({
        TableName: tableName,
        Key: { adoKey: { S: adoKey } },
      })
    );

    logger.info(`✅ Deleted config for work item ${adoKey}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Deleted' }),
    };
  } catch (error) {
    logger.error('💣 Failed to delete config', { error: error instanceof Error ? error.message : 'Unknown error' });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Failed to delete config' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
