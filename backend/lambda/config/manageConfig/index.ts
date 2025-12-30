import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const logger = new Logger({ serviceName: 'ManageConfig' });
const ddb = new DynamoDBClient({});

interface UpsertRequestBody {
  areaPath: string;
  businessUnit: string;
  system: string;
  workItemType: string;
  prompt: string;
  username: string;
}

const listConfig = async (
  event: APIGatewayProxyEvent,
  tableName: string
): Promise<APIGatewayProxyResult> => {
  const limit = Math.min(
    Number(event.queryStringParameters?.pageSize || 50),
    100
  );
  const exclusiveStartKey = event.queryStringParameters?.nextToken
    ? JSON.parse(
        Buffer.from(event.queryStringParameters.nextToken, 'base64').toString(
          'utf-8'
        )
      )
    : undefined;

  logger.info(`▶️ Listing configurations for ${tableName}`, {
    limit,
    exclusiveStartKey,
  });

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
    workItemType: it.workItemType?.S,
    prompt: it.prompt?.S,
    createdAt: it.createdAt?.S,
    createdBy: it.createdBy?.S,
    updatedAt: it.updatedAt?.S,
    updatedBy: it.updatedBy?.S,
  }));

  const nextToken = resp.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(resp.LastEvaluatedKey), 'utf-8').toString(
        'base64'
      )
    : undefined;

  logger.info(`✅ Found ${items.length} configuration items`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ items, nextToken, count: items.length }),
  };
};

const deleteConfig = async (
  event: APIGatewayProxyEvent,
  tableName: string
): Promise<APIGatewayProxyResult> => {
  const adoKey = event.queryStringParameters?.adoKey;
  if (!adoKey) {
    logger.info(`🛑 Missing adoKey`);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Missing adoKey' }),
    };
  }

  logger.info(`▶️ Deleting config for work item ${adoKey}`, {
    table: tableName,
  });

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
};

const updateConfig = async (
  event: APIGatewayProxyEvent,
  tableName: string
): Promise<APIGatewayProxyResult> => {
  const body: UpsertRequestBody =
    typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body;

  logger.info('▶️ Updating config item', { item: body });

  if (
    !body ||
    !body.workItemType ||
    !body.areaPath ||
    !body.businessUnit ||
    !body.system ||
    !body.prompt ||
    !body.username
  ) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:
          'Missing required fields: workItemType, areaPath, businessUnit, system, prompt, username',
      }),
    };
  }

  const adoKey = `${body.workItemType}#${body.areaPath}#${body.businessUnit}#${body.system}`;
  const nowIso = new Date().toISOString();

  const cmd = new UpdateItemCommand({
    TableName: tableName,
    Key: {
      adoKey: { S: adoKey },
    },
    UpdateExpression:
      'SET #prompt = :prompt, #workItemType = :workItemType, #areaPath = :areaPath, #businessUnit = :businessUnit, #system = :system, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #createdAt = if_not_exists(#createdAt, :createdAt), #createdBy = if_not_exists(#createdBy, :createdBy)',
    ExpressionAttributeNames: {
      '#prompt': 'prompt',
      '#workItemType': 'workItemType',
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
      ':workItemType': { S: body.workItemType },
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
    workItemType: body.workItemType,
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
};

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.CONFIG_TABLE_NAME;
    if (!tableName) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Server misconfiguration' }),
      };
    }

    const method = event.httpMethod;

    if (method === 'GET') {
      return await listConfig(event, tableName);
    } else if (method === 'PUT' || method === 'POST') {
      return await updateConfig(event, tableName);
    } else if (method === 'DELETE') {
      return await deleteConfig(event, tableName);
    } else {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Method Not Allowed' }),
      };
    }
  } catch (error) {
    logger.error('💣 Failed to manage config', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(
  injectLambdaContext(logger, { logEvent: true })
);
