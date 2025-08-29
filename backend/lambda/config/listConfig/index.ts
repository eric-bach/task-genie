import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const logger = new Logger({ serviceName: 'ListConfig' });
const ddb = new DynamoDBClient({});

export const lambdaHandler = async (event: any) => {
  try {
    const tableName = process.env.CONFIG_TABLE_NAME;
    if (!tableName) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfiguration' }) };
    }

    const limit = Math.min(Number(event.queryStringParameters?.pageSize || 50), 100);
    const exclusiveStartKey = event.queryStringParameters?.nextToken
      ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString('utf-8'))
      : undefined;

    const resp = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const items = (resp.Items || []).map((it) => ({
      adoKey: it.adoKey?.S,
      areaPath: it.areaPath?.S,
      businessUnit: it.businessUnit?.S,
      system: it.system?.S,
      prompt: it.prompt?.S,
      createdAt: it.createdAt?.S,
      createdBy: it.createdBy?.S,
      updatedAt: it.updatedAt?.S,
      updatedBy: it.updatedBy?.S,
    }));

    const nextToken = resp.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(resp.LastEvaluatedKey), 'utf-8').toString('base64')
      : undefined;

    logger.info(`✅ Found ${items.length} config items`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ items, nextToken, count: items.length }),
    };
  } catch (error) {
    logger.error('💣 Failed to list config', { error: error instanceof Error ? error.message : 'Unknown error' });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Failed to list config' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
