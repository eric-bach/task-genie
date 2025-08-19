import { MetricDatum, PutMetricDataCommand, PutMetricDataCommandInput, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { cloudWatchClient, logger } from '..';

async function createMetric(metric: MetricDatum) {
  const params: PutMetricDataCommandInput = {
    MetricData: [metric],
    Namespace: 'Azure DevOps',
  };

  const command = new PutMetricDataCommand(params);

  try {
    const response = await cloudWatchClient.send(command);
    logger.info(`${metric.MetricName} metric created`, { response: JSON.stringify(response) });
  } catch (error) {
    logger.error('Error creating custom metric', { error: error });
  }
}

export async function createTaskGeneratedMetric(value: number) {
  // Add TasksGenerated metric
  const tasksGeneratedMetric = {
    MetricName: 'TasksGenerated',
    Dimensions: [
      {
        Name: 'Tasks',
        Value: 'Tasks',
      },
    ],
    Unit: StandardUnit.Count,
    Value: value,
  };

  await createMetric(tasksGeneratedMetric);
}

export async function createUserStoriesUpdatedMetric() {
  // Add UserStoriesUpdated metric
  const userStoriesUpdatedMetric = {
    MetricName: 'UserStoriesUpdated',
    Dimensions: [
      {
        Name: 'User Story',
        Value: 'User Stories',
      },
    ],
    Unit: StandardUnit.Count,
    Value: 1,
  };

  await createMetric(userStoriesUpdatedMetric);
}
