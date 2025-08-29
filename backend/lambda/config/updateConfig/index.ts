import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const logger = new Logger({ serviceName: 'UpsertConfig' });
const ddb = new DynamoDBClient({});

interface UpsertRequestBody {
  areaPath: string;
  businessUnit: string;
  system: string;
  prompt: string;
  username: string; // user's email
}

export const lambdaHandler = async (event: any) => {
  logger.info('Received request', { event });

  try {
    const tableName = process.env.CONFIG_TABLE_NAME;
    if (!tableName) {
      logger.error('TABLE_NAME environment variable is not set');
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Server misconfiguration' }),
      };
    }

    const method = event.httpMethod || event.requestContext?.http?.method || 'PUT';
    if (method !== 'PUT' && method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Method Not Allowed' }),
      };
    }

    const body: UpsertRequestBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    if (!body || !body.areaPath || !body.businessUnit || !body.system || !body.prompt || !body.username) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Missing required fields: areaPath, businessUnit, system, prompt, username',
        }),
      };
    }

    const adoKey = `${body.areaPath}#${body.businessUnit}#${body.system}`;

    const nowIso = new Date().toISOString();

    const cmd = new UpdateItemCommand({
      TableName: tableName,
      Key: {
        adoKey: { S: adoKey },
      },
      UpdateExpression:
        'SET #prompt = :prompt, #areaPath = :areaPath, #businessUnit = :businessUnit, #system = :system, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #createdAt = if_not_exists(#createdAt, :createdAt), #createdBy = if_not_exists(#createdBy, :createdBy)',
      ExpressionAttributeNames: {
        '#prompt': 'prompt',
        '#areaPath': 'areaPath',
        '#businessUnit': 'businessUnit',
        '#system': 'system',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
        '#createdAt': 'createdAt',
        '#createdBy': 'createdBy',
      },
      ExpressionAttributeValues: {
        ':prompt': { S: body.prompt },
        ':areaPath': { S: body.areaPath },
        ':businessUnit': { S: body.businessUnit },
        ':system': { S: body.system },
        ':updatedAt': { S: nowIso },
        ':updatedBy': { S: body.username },
        ':createdAt': { S: nowIso },
        ':createdBy': { S: body.username },
      },
      ReturnValues: 'ALL_NEW',
    });

    const result = await ddb.send(cmd);

    const responseBody = {
      adoKey,
      areaPath: body.areaPath,
      businessUnit: body.businessUnit,
      system: body.system,
      prompt: body.prompt,
      createdAt: (result.Attributes?.createdAt as any)?.S,
      createdBy: (result.Attributes?.createdBy as any)?.S,
      updatedAt: nowIso,
      updatedBy: body.username,
      attributes: result.Attributes,
    };

    logger.info(`✅ Updated config for work item ${adoKey}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    logger.error('💣 Failed to upsert config', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Failed to upsert config' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
