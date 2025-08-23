import {
  CloudWatchClient,
  MetricDatum,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';

export class CloudWatchService {
  private readonly logger: Logger;
  private readonly cloudWatchClient: CloudWatchClient;

  constructor() {
    this.logger = new Logger({ serviceName: 'CloudWatchService' });
    this.cloudWatchClient = new CloudWatchClient();
  }

  async createMetric(metric: MetricDatum) {
    const params: PutMetricDataCommandInput = {
      MetricData: [metric],
      Namespace: 'Azure DevOps',
    };

    const command = new PutMetricDataCommand(params);

    try {
      const response = await this.cloudWatchClient.send(command);
      this.logger.info(`${metric.MetricName} metric created`, { response: JSON.stringify(response) });
    } catch (error) {
      this.logger.error('Error creating custom metric', { error: error });
    }
  }

  async createIncompleteUserStoriesMetric() {
    // Add IncompleteUserStoriesMetric metric
    const incompleteUserStoriesMetric = {
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

    await this.createMetric(incompleteUserStoriesMetric);
  }

  async createTaskGeneratedMetric(value: number) {
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

    await this.createMetric(tasksGeneratedMetric);
  }

  async createUserStoriesUpdatedMetric() {
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

    await this.createMetric(userStoriesUpdatedMetric);
  }
}
