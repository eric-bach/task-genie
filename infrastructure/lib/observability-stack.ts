import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Dashboard,
  GaugeWidget,
  GraphWidget,
  GraphWidgetView,
  LogQueryWidget,
  Metric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { ObservabilityStackProps } from '../bin/task-genie';
import * as dotenv from 'dotenv';
import { LogGroup } from 'aws-cdk-lib/aws-logs';

dotenv.config();

export class ObservabilityStack extends Stack {
  /**
   * Constructs a new instance of the AppStack.
   *
   * This stack sets up the observability resources for the Task Genie application, including:
   * - CloudWatch dashboards and widgets.
   *
   * @param scope - The scope in which this stack is defined.
   * @param id - The scoped ID of the stack.
   * @param props - Stack properties.
   */
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    /*
     * Lookup properties
     */
    const apiGwAccessLogGroup = LogGroup.fromLogGroupArn(
      this,
      'ApiGwAccessLogGroup',
      props.params.apiGwAccessLogGroupArn,
    );

    /*
     * Amazon CloudWatch
     */

    // Dashboard
    const dashboard = new Dashboard(this, 'MyDashboard', {
      dashboardName: `${props.appName}-dashboard-${props.envName}`,
    });

    // Widgets
    const tasksGeneratedWidget = new GaugeWidget({
      title: 'Tasks Generated',
      metrics: [
        new Metric({
          namespace: 'Azure DevOps',
          metricName: 'TasksGenerated',
          dimensionsMap: { Tasks: 'Tasks' },
          statistic: 'Sum',
          period: Duration.minutes(5),
          region: this.region,
        }),
      ],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    const userStoriesUpdatedWidget = new GaugeWidget({
      title: 'User Stories Updated',
      metrics: [
        new Metric({
          namespace: 'Azure DevOps',
          metricName: 'UserStoriesUpdated',
          dimensionsMap: { 'User Story': 'User Stories' },
          statistic: 'Sum',
          period: Duration.minutes(5),
          region: this.region,
        }),
      ],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    const incompleteUserStoriesWidget = new GaugeWidget({
      title: 'Incomplete User Stories',
      metrics: [
        new Metric({
          namespace: 'Azure DevOps',
          metricName: 'IncompleteUserStories',
          dimensionsMap: { 'User Story': 'User Stories' },
          statistic: 'Sum',
          period: Duration.minutes(5),
          region: this.region,
        }),
      ],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    const apiGatewayAccessLogs = new LogQueryWidget({
      title: 'API Gateway Access Logs',
      logGroupNames: [apiGwAccessLogGroup.logGroupName],
      queryString: `fields httpMethod, resourcePath, status, ip, responseLength, requestTime
        | sort @timestamp desc 
        | limit 100`,
      width: 12,
      height: 6,
    });

    const apiGatewayRequestsWidget = new GraphWidget({
      title: 'API Gateway Requests',
      stacked: false,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: {
            ApiName: props.params.apiName,
          },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
      ],
      view: GraphWidgetView.TIME_SERIES,
      width: 12,
      height: 6,
    });

    const apiGatewayLatencyWidget = new GraphWidget({
      title: 'API Gateway Latency',
      stacked: false,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: {
            ApiName: props.params.apiName,
          },
          statistic: 'Average',
          period: Duration.minutes(5),
        }),
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'IntegrationLatency',
          dimensionsMap: {
            ApiName: props.params.apiName,
          },
          statistic: 'Average',
          period: Duration.minutes(5),
        }),
      ],
      view: GraphWidgetView.TIME_SERIES,
      width: 12,
      height: 6,
    });

    dashboard.addWidgets(
      tasksGeneratedWidget,
      userStoriesUpdatedWidget,
      incompleteUserStoriesWidget,
      apiGatewayAccessLogs,
      apiGatewayRequestsWidget,
      apiGatewayLatencyWidget,
    );
  }
}
