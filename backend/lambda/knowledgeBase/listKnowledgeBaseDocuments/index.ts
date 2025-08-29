import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { S3Client, GetObjectCommand, HeadObjectCommand, GetObjectTaggingCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, ListKnowledgeBaseDocumentsCommand } from '@aws-sdk/client-bedrock-agent';
import middy from '@middy/core';

// Configure logging
const logger = new Logger({ serviceName: 'listKnowledgeBaseDocuments' });

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const bedrockAgentClient = new BedrockAgentClient({ region: process.env.AWS_REGION });

interface KnowledgeDocument {
  key: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  lastModified: string;
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: 'OK' }),
    };
  }

  try {
    // Parse pagination parameters from query string
    const queryParams = event.queryStringParameters || {};
    const pageSize = parseInt(queryParams.pageSize || '10', 10);
    const pageNumber = parseInt(queryParams.pageNumber || '1', 10);

    // Normalize negative values to 1
    const normalizedPageSize = pageSize < 1 ? 1 : pageSize;
    const normalizedPageNumber = pageNumber < 1 ? 1 : pageNumber;

    // Enforce upper bound for page size; lower bound is normalized to 1
    if (normalizedPageSize > 100) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'Invalid pageSize. Must be between 1 and 100.',
        }),
      };
    }

    logger.info('Listing knowledge base documents', {
      pageSize: normalizedPageSize,
      pageNumber: normalizedPageNumber,
      nextToken: queryParams.nextToken,
    });

    const bucketName = process.env.S3_BUCKET_NAME;
    const knowledgeBaseId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
    const knowledgeBaseDataSourceId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID;

    if (!bucketName) {
      logger.error('S3_BUCKET_NAME environment variable not set');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
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
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'Bedrock Knowledge Base configuration error',
        }),
      };
    }

    // Get documents from Bedrock Knowledge Base
    let documents: KnowledgeDocument[] = [];
    let nextToken: string | undefined = undefined;

    try {
      // Get the documents for the current page using cursor-based pagination
      const listDocumentsCommand = new ListKnowledgeBaseDocumentsCommand({
        knowledgeBaseId,
        dataSourceId: knowledgeBaseDataSourceId,
        maxResults: normalizedPageSize, // Use dynamic page size from query parameters
        nextToken: queryParams.nextToken || undefined, // Support nextToken for cursor-based pagination
      });

      const documentsResponse = await bedrockAgentClient.send(listDocumentsCommand);
      const documentDetails = documentsResponse.documentDetails || [];
      nextToken = documentsResponse.nextToken; // Store nextToken for pagination

      logger.info(`Found ${documentDetails.length} indexed documents for current page`, { documents: documentDetails });

      // Process each document from the knowledge base
      for (const docDetail of documentDetails) {
        try {
          const identifier = docDetail.identifier as any; // Type assertion to access unknown properties

          // Try to get the S3 URI from various possible locations
          let s3Uri = identifier?.sourceUri || identifier?.source?.uri || identifier?.uri || identifier?.s3?.uri;

          if (!s3Uri) {
            logger.warn('Document missing source URI', { docDetail, identifierKeys: Object.keys(identifier || {}) });
            continue;
          }

          const key = s3Uri.replace(/^s3:\/\/[^\/]+\//, '');
          const fileName = key.split('/').pop() || key;

          // Retrieve file size and metadata attributes from S3
          let areaPath: string | undefined;
          let businessUnit: string | undefined;
          let system: string | undefined;
          let username: string | undefined;

          // Get file size and last modified from S3 HeadObject
          const { fileSize, lastModified } = await getFileInfo(bucketName, key);
          logger.debug(`Read file info for ${key}`, { fileSize, lastModified });

          // First, try to read attributes from S3 object tags; if missing, fallback to metadata.json; then path parsing
          try {
            const tagAttrs = await getTagAttributes(bucketName, key);
            areaPath = tagAttrs.areaPath;
            businessUnit = tagAttrs.businessUnit;
            system = tagAttrs.system;
            username = tagAttrs.username;

            // If any are missing, try metadata.json as a secondary source
            if (!areaPath || !businessUnit || !system) {
              const metaAttrs = await getMetadataAttributes(bucketName, key);
              areaPath = areaPath || metaAttrs.areaPath;
              businessUnit = businessUnit || metaAttrs.businessUnit;
              system = system || metaAttrs.system;
              username = username || metaAttrs.username;
            }

            logger.debug(`Extracted metadata attributes for ${key}`, {
              attributes: { areaPath, businessUnit, system, username },
            });
          } catch (metadataError) {
            logger.warn(`Failed to get metadata attributes for ${key}`, { error: metadataError });
            const pathParts = key.split('/');
            if (pathParts.length > 1) {
              areaPath = pathParts[0];
              if (pathParts.length > 2) {
                businessUnit = pathParts[1];
              }
              if (pathParts.length > 3) {
                system = pathParts[2];
              }
            }
          }

          const document: KnowledgeDocument = {
            key,
            fileName,
            size: fileSize, // Actual file size from S3
            sizeFormatted: formatFileSize(fileSize), // Human-readable file size
            lastModified: lastModified || docDetail.updatedAt?.toISOString() || '', // Use S3 LastModified, fallback to Bedrock updatedAt
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

      // Fallback: if Knowledge Base API fails, return error
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'Failed to retrieve documents from Knowledge Base',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
      };
    }

    // Calculate total size of all documents
    const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
    const totalSizeFormatted = formatFileSize(totalSize);

    // Calculate pagination metadata (cursor-based only)
    const hasNextPage = Boolean(nextToken);
    const hasPreviousPage = normalizedPageNumber > 1;

    logger.info(`✅ Found ${documents.length} documents with total size: ${totalSizeFormatted}`, {
      pageNumber,
      hasNextPage,
      hasPreviousPage,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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
          nextToken: nextToken, // Token for next page
        },
      }),
    };
  } catch (error) {
    logger.error('💣 Error listing knowledge documents', { error });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        error: 'Failed to list knowledge documents',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

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
async function getFileInfo(bucketName: string, key: string): Promise<{ fileSize: number; lastModified: string }> {
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
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
}> {
  try {
    const taggingResponse = await s3Client.send(new GetObjectTaggingCommand({ Bucket: bucketName, Key: key }));
    const tagSet = taggingResponse.TagSet || [];
    const tagMap: Record<string, string> = {};
    for (const tag of tagSet) {
      if (tag.Key && typeof tag.Value === 'string') {
        // Values were URL-encoded at upload time; decode here
        tagMap[tag.Key] = decodeURIComponent(tag.Value);
      }
    }

    return {
      areaPath: tagMap['areaPath'],
      businessUnit: tagMap['businessUnit'],
      system: tagMap['system'],
      username: tagMap['username'],
    };
  } catch (e) {
    logger.debug(`No tags found or failed to read tags for ${key}`, { error: e });
    return {};
  }
}

// Helper function to test metadata parsing
function parseMetadata(metadata: any): {
  areaPath?: string;
  businessUnit?: string;
  system?: string;
  username?: string;
} {
  let areaPath: string | undefined;
  let businessUnit: string | undefined;
  let system: string | undefined;
  let username: string | undefined;

  if (metadata.metadataAttributes) {
    areaPath = metadata.metadataAttributes.areaPath?.value?.stringValue;
    businessUnit = metadata.metadataAttributes.businessUnit?.value?.stringValue;
    system = metadata.metadataAttributes.system?.value?.stringValue;
    username = metadata.metadataAttributes.username?.value?.stringValue;
  } else {
    // Fallback to direct properties for backward compatibility
    areaPath = metadata.areaPath;
    businessUnit = metadata.businessUnit;
    system = metadata.system;
    username = metadata.username;
  }

  return { areaPath, businessUnit, system, username };
}

// Helper function to format file size in human-readable format
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger));
