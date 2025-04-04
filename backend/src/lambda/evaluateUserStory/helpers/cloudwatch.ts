import { PutMetricDataCommand, PutMetricDataCommandInput, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { cloudWatchClient, logger } from '../index';

export async function createIncompleteUserStoriesMetric() {
  const metric = {
    MetricName: 'IncompleteUserStories',
    Dimensions: [
      {
        Name: 'User Story',
        Value: 'User Stories',
      },
    ],
    Unit: StandardUnit.Count,
    Value: 1,
  };

  const params: PutMetricDataCommandInput = {
    MetricData: [metric],
    Namespace: 'Azure DevOps',
  };

  const command = new PutMetricDataCommand(params);

  try {
    const result = await cloudWatchClient.send(command);
    logger.info('IncompleteUserStories metric created', { response: JSON.stringify(result) });
  } catch (error) {
    logger.error('Error creating custom metric', { error: error });
  }
}
