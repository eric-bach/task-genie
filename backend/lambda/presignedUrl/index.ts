import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import middy from '@middy/core';
import * as fs from 'fs';
import * as path from 'path';

// Configure logging
const logger = new Logger({ serviceName: 'presignedUrl' });

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2',
});

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  try {
    // Extract query parameters
    const areaPath = event.queryStringParameters?.area_path;
    const businessUnit = event.queryStringParameters?.business_unit;
    const system = event.queryStringParameters?.system;
    const fileName = event.queryStringParameters?.file_name;

    if (!areaPath) {
      logger.error('area_path parameter is required');

      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'area_path parameter is required',
        }),
      };
    }

    if (!fileName) {
      logger.error('file_name parameter is required');

      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'file_name parameter is required',
        }),
      };
    }

    // Get bucket name from environment
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      logger.error('S3_BUCKET_NAME environment variable not set');

      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          error: 'S3 bucket not configured',
        }),
      };
    }

    // Create the S3 key with metadata-specific path
    // Build path components, filtering out null/undefined values
    const pathComponents = [areaPath, businessUnit, system].filter(Boolean);
    const key = `${pathComponents.join('/')}/${fileName}`;

    logger.info('Generating presigned URL', { bucketName: bucketName, key: key });

    // Generate metadata file for Bedrock Knowledge Base
    const metadataFileName = `${fileName}.metadata.json`;
    const metadataKey = `${pathComponents.join('/')}/${metadataFileName}`;

    // Create metadata content based on query parameters
    const metadata = {
      metadataAttributes: {
        areaPath: {
          value: {
            type: 'STRING',
            stringValue: areaPath,
          },
          includeForEmbedding: true,
        },
        ...(businessUnit && {
          business_unit: {
            value: {
              type: 'STRING',
              stringValue: businessUnit,
            },
            includeForEmbedding: true,
          },
        }),
        ...(system && {
          system: {
            value: {
              type: 'STRING',
              stringValue: system,
            },
            includeForEmbedding: true,
          },
        }),
      },
    };

    let metadataUploaded = false;
    let tmpMetadataPath: string | null = null;

    try {
      // Write metadata file to Lambda tmp directory
      tmpMetadataPath = path.join('/tmp', metadataFileName);
      fs.writeFileSync(tmpMetadataPath, JSON.stringify(metadata, null, 2));

      // Upload metadata file to S3 first
      const metadataBuffer = fs.readFileSync(tmpMetadataPath);
      const metadataUploadCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: metadataKey,
        Body: metadataBuffer,
        ContentType: 'application/json',
      });

      await s3Client.send(metadataUploadCommand);
      metadataUploaded = true;

      logger.info('Uploaded metadata file to S3', { metadataKey });

      // Generate presigned URL for main file only after metadata is uploaded
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: 'application/octet-stream', // Generic content type, will be overridden by the client
      });

      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 900, // 15 minutes
      });

      logger.info('Uploaded source file to S3', { key });

      logger.info('✅ Uploaded files to bucket', { bucketName });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          presignedurl: presignedUrl,
          key: key,
          bucket: bucketName,
          expiresIn: 900,
          metadataFile: {
            key: metadataKey,
            fileName: metadataFileName,
            uploaded: true,
          },
        }),
      };
    } catch (uploadError: any) {
      logger.error('🛑 Error during upload process:', uploadError);

      // If metadata was uploaded but presigned URL generation failed, clean up metadata
      if (metadataUploaded) {
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: metadataKey,
          });
          await s3Client.send(deleteCommand);
          logger.info(`Cleaned up metadata file: ${metadataKey}`);
        } catch (cleanupError: any) {
          logger.error('Failed to cleanup metadata file:', cleanupError);
        }
      }

      throw uploadError;
    } finally {
      // Clean up tmp file
      if (tmpMetadataPath && fs.existsSync(tmpMetadataPath)) {
        fs.unlinkSync(tmpMetadataPath);
      }
    }
  } catch (error: any) {
    logger.error('🛑 Error generating presigned URL:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        error: ' 💣Failed to generate presigned URL',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
