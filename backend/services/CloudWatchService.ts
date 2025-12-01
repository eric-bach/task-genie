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
      this.logger.info(`📈 ${metric.MetricName} metric created`, { response: JSON.stringify(response) });
    } catch (error) {
      this.logger.error('Error creating custom metric', { error: error });
    }
  }

  async createIncompleteWorkItemMetric(workItemType: 'User Story' | 'Epic' | 'Feature' | 'Task') {
    // Add IncompleteWorkItems metric with work item type dimension
    const incompleteWorkItemMetric = {
      MetricName: 'IncompleteWorkItems',
      Dimensions: [
        {
          Name: 'WorkItemType',
          Value: workItemType,
        },
      ],
      Unit: StandardUnit.Count,
      Value: 1,
    };

    await this.createMetric(incompleteWorkItemMetric);
  }

  async createWorkItemGeneratedMetric(value: number, workItemType: 'User Story' | 'Epic' | 'Feature' | 'Task') {
    const workItemGeneratedMetric = {
      MetricName: `${workItemType.replace(' ', '')}Generated`,
      Dimensions: [
        {
          Name: 'WorkItemType',
          Value: workItemType,
        },
      ],
      Unit: StandardUnit.Count,
      Value: value,
    };

    await this.createMetric(workItemGeneratedMetric);
  }

  async createWorkItemUpdatedMetric(workItemType: 'User Story' | 'Epic' | 'Feature' | 'Task') {
    const workItemUpdatedMetric = {
      MetricName: `${workItemType.replace(' ', '')}Updated`,
      Dimensions: [
        {
          Name: 'WorkItemType',
          Value: workItemType,
        },
      ],
      Unit: StandardUnit.Count,
      Value: 1,
    };

    await this.createMetric(workItemUpdatedMetric);
  }
}
