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
import { LogGroup, CfnResourcePolicy } from 'aws-cdk-lib/aws-logs';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

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

    /*
     * Custom Resources
     */

    // Allow X-Ray to write to CloudWatch Logs (aws/spans)
    const xRayLogGroupPolicy = new CfnResourcePolicy(this, 'XRayLogGroupPolicy', {
      policyName: 'XRayToCloudWatchLogsPolicy',
      policyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowXRayToWriteLogs',
            Effect: 'Allow',
            Principal: {
              Service: 'xray.amazonaws.com',
            },
            Action: ['logs:PutLogEvents', 'logs:CreateLogStream', 'logs:CreateLogGroup'],
            Resource: '*',
          },
        ],
      }),
    });

    // Enable CloudWatch Logs as the destination for OTLP traces
    const updateTraceSegmentDestination = new AwsCustomResource(this, 'UpdateTraceSegmentDestination', {
      onCreate: {
        service: 'XRay',
        action: 'updateTraceSegmentDestination',
        parameters: {
          Destination: 'CloudWatchLogs',
        },
        physicalResourceId: PhysicalResourceId.of('UpdateTraceSegmentDestination'),
      },
      // Since this is a global setting for the account/region, we usually only need to run it once.
      // However, onUpdate ensures it stays configured if it drifted.
      onUpdate: {
        service: 'XRay',
        action: 'updateTraceSegmentDestination',
        parameters: {
          Destination: 'CloudWatchLogs',
        },
        physicalResourceId: PhysicalResourceId.of('UpdateTraceSegmentDestination'),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          actions: [
            'xray:UpdateTraceSegmentDestination',
            'application-signals:StartDiscovery',
            'iam:CreateServiceLinkedRole',
            'cloudtrail:CreateServiceLinkedChannel',
          ],
          resources: ['*'],
        }),
        new PolicyStatement({
          actions: ['logs:PutRetentionPolicy', 'logs:CreateLogGroup', 'logs:DescribeLogGroups'],
          resources: ['arn:aws:logs:*:*:log-group:aws/spans*'],
        }),
      ]),
    });
    updateTraceSegmentDestination.node.addDependency(xRayLogGroupPolicy);
  }
}
