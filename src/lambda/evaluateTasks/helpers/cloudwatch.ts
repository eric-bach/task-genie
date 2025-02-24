import {
  CloudWatchClient,
  MetricDatum,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';

export async function createMetric(client: CloudWatchClient, logger: Logger, metric: MetricDatum) {
  const params: PutMetricDataCommandInput = {
    MetricData: [metric],
    Namespace: 'Azure DevOps',
  };

  const command = new PutMetricDataCommand(params);

  try {
    const response = await client.send(command);
    logger.info(`Custom metric published successfully: ${JSON.stringify(response)}`);
  } catch (error) {
    logger.error(`Error publishing custom metric: ${error}`);
  }
}
