import { S3Event, S3EventRecord, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Configure logging
const logger = new Logger({ serviceName: 'syncKnowledgeBase' });

interface LambdaResponse {
  statusCode: number;
  body: string;
}

export const handler = async (event: S3Event, context: Context): Promise<LambdaResponse> => {
  /**
   * Lambda function to sync uploaded document files with Bedrock Knowledge Base
   */
  logger.info(`Event: ${JSON.stringify(event)}`);

  // Get the S3 event details
  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info(`Processing file: ${bucketName}/${key}`);

    // Only process document files
    if (
      !key.toLowerCase().endsWith('.pdf') &&
      !key.toLowerCase().endsWith('.doc') &&
      !key.toLowerCase().endsWith('.docx') &&
      !key.toLowerCase().endsWith('.md') &&
      !key.toLowerCase().endsWith('.txt')
    ) {
      logger.info(`Skipping non-supported file: ${key}`);
      continue;
    }

    try {
      // Get the Knowledge Base ID from environment
      const knowledgeBaseId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
      const knowledgeBaseDataSourceId = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID;

      if (!knowledgeBaseId || !knowledgeBaseDataSourceId) {
        logger.error(
          'ERROR: AWS_BEDROCK_KNOWLEDGE_BASE_ID or AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID environment variable not set'
        );
        return {
          statusCode: 500,
          body: JSON.stringify('Knowledge Base ID or Data Source ID not configured'),
        };
      }

      // Initialize Bedrock client
      const bedrock = new BedrockAgentClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });

      // Get the S3 object details
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
      });

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const s3Object = await s3Client.send(getObjectCommand);

      logger.info(`Syncing file ${key} with Knowledge Base ${knowledgeBaseId}`);

      // Create a data source sync request
      // This is the actual sync operation with Bedrock Knowledge Base
      try {
        // Start an ingestion job to sync the new file
        const startIngestionCommand = new StartIngestionJobCommand({
          knowledgeBaseId: knowledgeBaseId,
          dataSourceId: knowledgeBaseDataSourceId,
          description: `Sync uploaded file: ${key}`,
        });

        const response = await bedrock.send(startIngestionCommand);

        const ingestionJobId = response.ingestionJob?.ingestionJobId;
        if (!ingestionJobId) {
          throw new Error('Failed to get ingestion job ID');
        }

        logger.info(`Started ingestion job ${ingestionJobId} for file ${key}`);

        // Wait for the ingestion job to complete
        const maxWaitTime = 300000; // 5 minutes in milliseconds
        let waitTime = 0;
        let status: string = 'IN_PROGRESS';

        while (waitTime < maxWaitTime) {
          const getJobCommand = new GetIngestionJobCommand({
            knowledgeBaseId: knowledgeBaseId,
            dataSourceId: knowledgeBaseDataSourceId,
            ingestionJobId: ingestionJobId,
          });

          const jobStatus = await bedrock.send(getJobCommand);
          status = jobStatus.ingestionJob?.status || 'UNKNOWN';

          logger.info(`Ingestion job ${ingestionJobId} status: ${status}`);

          if (['COMPLETE', 'FAILED'].includes(status)) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
          waitTime += 10000;
        }

        if (status === 'COMPLETE') {
          logger.info(`Successfully synced file ${key} with Knowledge Base`);
          return {
            statusCode: 200,
            body: JSON.stringify(`Successfully synced ${key} with Knowledge Base`),
          };
        } else {
          logger.error(`Failed to sync file ${key}: ${status}`);
          return {
            statusCode: 500,
            body: JSON.stringify(`Failed to sync file ${key}: ${status}`),
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error syncing with Knowledge Base: ${errorMessage}`);
        return {
          statusCode: 500,
          body: JSON.stringify(`Error syncing with Knowledge Base: ${errorMessage}`),
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error processing file ${key}: ${errorMessage}`);
      return {
        statusCode: 500,
        body: JSON.stringify(`Error processing file: ${errorMessage}`),
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify('Successfully processed all files'),
  };
};
