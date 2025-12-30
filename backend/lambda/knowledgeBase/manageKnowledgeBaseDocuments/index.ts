import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  GetObjectTaggingCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  BedrockAgentClient,
  ListKnowledgeBaseDocumentsCommand,
} from '@aws-sdk/client-bedrock-agent';
import middy from '@middy/core';

// Configure logging
const logger = new Logger({ serviceName: 'manageKnowledgeBaseDocuments' });

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const bedrockAgentClient = new BedrockAgentClient({
  region: process.env.AWS_REGION,
});

interface KnowledgeDocument {
  key: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  lastModified: string;
  workItemType?: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}

// Helper to convert Node.js stream to string
async function streamToString(stream: any): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// Helper to get file size and last modified from S3
async function getFileInfo(
  bucketName: string,
  key: string
): Promise<{ fileSize: number; lastModified: string }> {
  try {
    const headObjectCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const fileResponse = await s3Client.send(headObjectCommand);
    const fileSize = fileResponse.ContentLength || 0;
    const lastModified = fileResponse.LastModified?.toISOString() || '';

    return { fileSize, lastModified };
  } catch (sizeError: any) {
    return { fileSize: 0, lastModified: '' };
  }
}

// Helper to read and parse metadata attributes from `${key}.metadata.json`
async function getMetadataAttributes(
  bucketName: string,
  key: string
): Promise<{
  workItemType?: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}> {
  const metadataKey = `${key}.metadata.json`;
  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: metadataKey,
  });

  const metadataResponse = await s3Client.send(getObjectCommand);
  const metadataJsonString = await streamToString(metadataResponse.Body);
  const metadata = JSON.parse(metadataJsonString);

  return parseMetadata(metadata);
}

// Helper to read attributes from S3 object tags
async function getTagAttributes(
  bucketName: string,
  key: string
): Promise<{
  workItemType?: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}> {
  try {
    const taggingResponse = await s3Client.send(
      new GetObjectTaggingCommand({ Bucket: bucketName, Key: key })
    );
    const tagSet = taggingResponse.TagSet || [];
    const tagMap: Record<string, string> = {};
    for (const tag of tagSet) {
      if (tag.Key && typeof tag.Value === 'string') {
        // Values were URL-encoded at upload time; decode here
        tagMap[tag.Key] = decodeURIComponent(tag.Value);
      }
    }

    return {
      workItemType: tagMap['workItemType'],
      areaPath: tagMap['areaPath'],
      businessUnit: tagMap['businessUnit'],
      system: tagMap['system'],
      username: tagMap['username'],
    };
  } catch (e) {
    logger.debug(`No tags found or failed to read tags for ${key}`, {
      error: e,
    });
    return {};
  }
}

// Helper function to test metadata parsing
function parseMetadata(metadata: any): {
  workItemType?: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
} {
  let workItemType: string | undefined;
  let areaPath: string | undefined;
  let businessUnit: string | undefined;
  let system: string | undefined;
  let username: string | undefined;

  if (metadata.metadataAttributes) {
    workItemType = metadata.metadataAttributes.workItemType?.value?.stringValue;
    areaPath = metadata.metadataAttributes.areaPath?.value?.stringValue;
    businessUnit = metadata.metadataAttributes.businessUnit?.value?.stringValue;
    system = metadata.metadataAttributes.system?.value?.stringValue;
    username = metadata.metadataAttributes.username?.value?.stringValue;
  } else {
    // Fallback to direct properties for backward compatibility
    workItemType = metadata.workItemType;
    areaPath = metadata.areaPath;
    businessUnit = metadata.businessUnit;
    system = metadata.system;
    username = metadata.username;
  }

  return { workItemType, areaPath, businessUnit, system, username };
}

// Helper function to format file size in human-readable format
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const listDocuments = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const queryParams = event.queryStringParameters || {};
  const pageSize = parseInt(queryParams.pageSize || '10', 10);
  const pageNumber = parseInt(queryParams.pageNumber || '1', 10);

  // Normalize negative values to 1
  const normalizedPageSize = pageSize < 1 ? 1 : pageSize;
  const normalizedPageNumber = pageNumber < 1 ? 1 : pageNumber;

  if (normalizedPageSize > 100) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Invalid pageSize. Must be between 1 and 100.',
      }),
    };
  }

  const bucketName = process.env.S3_BUCKET_NAME;
  const knowledgeBaseId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
  const knowledgeBaseDataSourceId =
    process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID;

  if (!bucketName) {
    logger.error('S3_BUCKET_NAME environment variable not set');
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Server configuration error',
      }),
    };
  }

  if (!knowledgeBaseId || !knowledgeBaseDataSourceId) {
    logger.error(
      'AWS_BEDROCK_KNOWLEDGE_BASE_ID or AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID environment variable not set'
    );
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Bedrock Knowledge Base configuration error',
      }),
    };
  }

  logger.info('▶️ Listing knowledge base documents', {
    bucketName,
    knowledgeBaseId,
    knowledgeBaseDataSourceId,
    pageSize: normalizedPageSize,
    pageNumber: normalizedPageNumber,
    nextToken: queryParams.nextToken,
  });

  let documents: KnowledgeDocument[] = [];
  let nextToken: string | undefined = undefined;

  try {
    const listDocumentsCommand = new ListKnowledgeBaseDocumentsCommand({
      knowledgeBaseId,
      dataSourceId: knowledgeBaseDataSourceId,
      maxResults: normalizedPageSize,
      nextToken: queryParams.nextToken || undefined,
    });

    const documentsResponse = await bedrockAgentClient.send(
      listDocumentsCommand
    );
    const documentDetails = documentsResponse.documentDetails || [];
    nextToken = documentsResponse.nextToken;

    logger.info(
      `Found ${documentDetails.length} indexed documents for current page`,
      { documents: documentDetails }
    );

    for (const docDetail of documentDetails) {
      try {
        const identifier = docDetail.identifier as any;
        let s3Uri =
          identifier?.sourceUri ||
          identifier?.source?.uri ||
          identifier?.uri ||
          identifier?.s3?.uri;

        if (!s3Uri) {
          logger.warn('Document missing source URI', {
            docDetail,
            identifierKeys: Object.keys(identifier || {}),
          });
          continue;
        }

        const key = s3Uri.replace(/^s3:\/\/[^\/]+\//, '');
        const fileName = key.split('/').pop() || key;

        let workItemType: string | undefined;
        let areaPath: string | undefined;
        let businessUnit: string | undefined;
        let system: string | undefined;
        let username: string | undefined;

        const { fileSize, lastModified } = await getFileInfo(bucketName, key);

        try {
          const tagAttrs = await getTagAttributes(bucketName, key);
          workItemType = tagAttrs.workItemType;
          areaPath = tagAttrs.areaPath;
          businessUnit = tagAttrs.businessUnit;
          system = tagAttrs.system;
          username = tagAttrs.username;

          if (!areaPath || !businessUnit || !system) {
            const metaAttrs = await getMetadataAttributes(bucketName, key);
            workItemType = workItemType || metaAttrs.workItemType;
            areaPath = areaPath || metaAttrs.areaPath;
            businessUnit = businessUnit || metaAttrs.businessUnit;
            system = system || metaAttrs.system;
            username = username || metaAttrs.username;
          }
        } catch (metadataError) {
          logger.warn(`Failed to get metadata attributes for ${key}`, {
            error: metadataError,
          });
          const pathParts = key.split('/');
          if (pathParts.length > 0) workItemType = pathParts[0];
          if (pathParts.length > 1) areaPath = pathParts[1];
          if (pathParts.length > 2) businessUnit = pathParts[2];
          if (pathParts.length > 3) system = pathParts[3];
        }

        const document: KnowledgeDocument = {
          key,
          fileName,
          size: fileSize,
          sizeFormatted: formatFileSize(fileSize),
          lastModified:
            lastModified || docDetail.updatedAt?.toISOString() || '',
          workItemType,
          areaPath,
          businessUnit,
          system,
          username: username || 'unknown',
        };

        documents.push(document);
      } catch (error) {
        logger.warn(`Failed to process document`, { error, docDetail });
      }
    }
  } catch (error) {
    logger.error('🛑 Failed to list documents from Knowledge Base', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to retrieve documents from Knowledge Base',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }

  const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
  const totalSizeFormatted = formatFileSize(totalSize);
  const hasNextPage = Boolean(nextToken);
  const hasPreviousPage = normalizedPageNumber > 1;

  logger.info(
    `✅ Found ${documents.length} documents with total size: ${totalSizeFormatted}`,
    {
      pageNumber,
      hasNextPage,
      hasPreviousPage,
    }
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      documents,
      count: documents.length,
      totalSize,
      totalSizeFormatted,
      pagination: {
        currentPage: normalizedPageNumber,
        pageSize: normalizedPageSize,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
        nextToken: nextToken,
      },
    }),
  };
};

const deleteDocument = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
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

  logger.info('▶️ Deleting knowledge base document', { bucketName, key });

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    const metadataKey = `${key}.metadata.json`;
    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: bucketName, Key: metadataKey })
      );
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucketName, Key: metadataKey })
      );
      logger.info('Deleted companion metadata file', { metadataKey });
    } catch (e) {
      logger.warn('Metadata file not found or already deleted', {
        metadataKey,
      });
    }

    logger.info('✅ Deleted knowledge base document', { bucketName, key });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message:
          'Document (and metadata if present) deleted. Sync will be handled by S3 event.',
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
      body: JSON.stringify({
        error: 'Failed to delete document',
        details: error?.message || 'Unknown error',
      }),
    };
  }
};

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: 'OK' }),
    };
  }

  const method = event.httpMethod;

  if (method === 'GET') {
    return await listDocuments(event);
  } else if (method === 'DELETE') {
    return await deleteDocument(event);
  } else {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }
};

export const handler = middy(lambdaHandler).use(
  injectLambdaContext(logger, { logEvent: true })
);
