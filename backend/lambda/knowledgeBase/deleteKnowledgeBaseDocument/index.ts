// @ts-nocheck
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import middy from '@middy/core';

const logger = new Logger({ serviceName: 'deleteKnowledgeBaseDocument' });

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: 'OK' }),
    };
  }

  try {
    if (event.httpMethod !== 'DELETE') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }

    const bucketName = process.env.S3_BUCKET_NAME;

    if (!bucketName) {
      logger.error('S3_BUCKET_NAME environment variable not set');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'S3 bucket not configured' }),
      };
    }

    // Bedrock config not required here; sync is handled by S3 event notifications

    // Parse key from query string or request body
    const keyFromQuery = event.queryStringParameters?.key;
    let key = keyFromQuery;
    if (!key && event.body) {
      try {
        const body = JSON.parse(event.body);
        key = body.key;
      } catch (e) {
        // ignore
      }
    }

    if (!key) {
      logger.error('Missing required parameter: key');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required parameter: key' }),
      };
    }

    logger.info('Deleting knowledge base document', { bucketName, key });

    // Attempt to delete the primary object
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    // Attempt to delete companion metadata file if it exists
    const metadataKey = `${key}.metadata.json`;
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: metadataKey }));
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: metadataKey }));

      logger.info('Deleted companion metadata file', { metadataKey });
    } catch (e) {
      logger.warn('Metadata file not found or already deleted', { metadataKey });
    }

    logger.info('✅ Deleted knowledge base document', { bucketName, key });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Document (and metadata if present) deleted. Sync will be handled by S3 event.',
      }),
    };
  } catch (error: any) {
    logger.error('💣 Error deleting knowledge document', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to delete document', details: error?.message || 'Unknown error' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
