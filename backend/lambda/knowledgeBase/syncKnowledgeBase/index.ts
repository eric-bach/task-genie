import { S3Event, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { BedrockAgentClient, StartIngestionJobCommand, GetIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import middy from '@middy/core';

// Configure logging
const logger = new Logger({ serviceName: 'syncKnowledgeBase' });

interface LambdaResponse {
  statusCode: number;
  body: string;
}

export const lambdaHandler = async (event: S3Event, context: Context): Promise<LambdaResponse> => {
  // Get the S3 event details
  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info('▶️ Syncing Knowledge Base', { filePath: `${bucketName}/${key}`, eventName: record.eventName });

    // Only process supported document files. For delete events, Key may still be present; use suffix check regardless.
    const lowerKey = key.toLowerCase();
    const isSupported = ['.pdf', '.doc', '.docx', '.md', '.txt'].some((ext) => lowerKey.endsWith(ext));
    if (!isSupported) {
      logger.info('Skipping non-supported file', { filePath: key });
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
        region: process.env.AWS_REGION || 'us-west-2',
      });

      logger.info('Syncing file with Knowledge Base', { filePath: key, knowledgeBaseId });

      // Start a data source sync request (works for both creates and deletes)
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

        logger.info('Started ingestion job', { ingestionJobId, filePath: key });

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

          logger.debug('Ingestion job status', { ingestionJobId, status });

          if (['COMPLETE', 'FAILED'].includes(status)) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
          waitTime += 10000;
        }

        if (status === 'COMPLETE') {
          logger.info('✅ Successfully synced file with Knowledge Base', { filePath: key });
          return {
            statusCode: 200,
            body: JSON.stringify(`Successfully synced ${key} with Knowledge Base`),
          };
        } else {
          logger.error('🛑 Failed to sync file with Knowledge Base', { filePath: key, status });
          return {
            statusCode: 500,
            body: JSON.stringify(`Failed to sync file with Knowledge Base: ${status}`),
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('💣 Error syncing with Knowledge Base', { error: errorMessage });
        return {
          statusCode: 500,
          body: JSON.stringify(`Error syncing with Knowledge Base: ${errorMessage}`),
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('💣 Error processing file', { filePath: key, error: errorMessage });
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

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
