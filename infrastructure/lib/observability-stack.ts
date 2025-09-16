import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Dashboard,
  GaugeWidget,
  GraphWidget,
  GraphWidgetView,
  LogQueryWidget,
  Metric,
  SingleValueWidget,
} from 'aws-cdk-lib/aws-cloudwatch';
import { ObservabilityStackProps } from '../bin/task-genie';
import { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import * as dotenv from 'dotenv';
import { Function } from 'aws-cdk-lib/aws-lambda';
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
    const stateMachine = StateMachine.fromStateMachineArn(this, 'StateMachine', props.params.stateMachineArn);
    const evaluateUserStoryFunction = Function.fromFunctionArn(
      this,
      'EvaluateUserStory',
      props.params.evaluateUserStoryFunctionArn
    );
    const defineTasksFunction = Function.fromFunctionArn(this, 'DefineTasks', props.params.defineTasksFunctionArn);
    const createTasksFunction = Function.fromFunctionArn(this, 'CreateTasks', props.params.createTasksFunctionArn);
    const addCommentFunction = Function.fromFunctionArn(this, 'AddComment', props.params.addCommentFunctionArn);
    const sendResponseFunction = Function.fromFunctionArn(this, 'SendResponse', props.params.sendResponseFunctionArn);
    const apiGwAccessLogGroup = LogGroup.fromLogGroupArn(
      this,
      'ApiGwAccessLogGroup',
      props.params.apiGwAccessLogGroupArn
    );

    /*
     * Amazon CloudWatch
     */

    // Dashboard
    const dashboard = new Dashboard(this, 'MyDashboard', {
      dashboardName: `${props.appName}-dashboard-${props.envName}`,
    });

    // Widgets
    const userStoriesEvaluatedWidged = new GaugeWidget({
      title: 'User Stories Evaluated',
      metrics: [
        new Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionsSucceeded',
          dimensionsMap: {
            StateMachineArn: stateMachine.stateMachineArn,
          },
          statistic: 'Sum',
          period: Duration.minutes(5),
          region: this.region,
        }),
      ],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

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

    const lambdaFunctionsDurationWidget = new SingleValueWidget({
      title: 'Lambda Functions Response Times (p99)',
      metrics: [
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          statistic: 'p99',
          dimensionsMap: { FunctionName: evaluateUserStoryFunction.functionName },
        }),
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          statistic: 'p99',
          dimensionsMap: { FunctionName: defineTasksFunction.functionName },
        }),
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          statistic: 'p99',
          dimensionsMap: { FunctionName: createTasksFunction.functionName },
        }),
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          statistic: 'p99',
          dimensionsMap: { FunctionName: addCommentFunction.functionName },
        }),
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          statistic: 'p99',
          dimensionsMap: { FunctionName: sendResponseFunction.functionName },
        }),
      ],
      sparkline: false,
      period: Duration.minutes(5),
      setPeriodToTimeRange: true,
      width: 12,
      height: 5,
    });

    const setFunctionDurationWidget = new SingleValueWidget({
      title: 'Step Function Response Times (p99)',
      metrics: [
        new Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionTime',
          statistic: 'p99',
          dimensionsMap: {
            StateMachineArn: stateMachine.stateMachineArn,
          },
        }),
        new Metric({
          namespace: 'AWS/States',
          metricName: 'ExpressExecutionMemory',
          statistic: 'p99',
          dimensionsMap: {
            StateMachineArn: stateMachine.stateMachineArn,
          },
        }),
      ],
      sparkline: false,
      period: Duration.minutes(5),
      width: 12,
      height: 5,
    });

    const stepFunctionExecutionTimeHistogram = new GraphWidget({
      title: 'Step Function Execution Time',
      stacked: false,
      left: [
        new Metric({
          namespace: 'AWS/States',
          metricName: 'ExpressExecutionBilledDuration',
          dimensionsMap: {
            StateMachineArn: stateMachine.stateMachineArn,
          },
          statistic: 'Average',
          period: Duration.minutes(5),
        }),
      ],
      view: GraphWidgetView.TIME_SERIES,
      width: 12,
      height: 6,
    });

    const stepFunctionExecutionsHistogram = new GraphWidget({
      title: 'Step Function Execution Counts',
      stacked: false,
      left: [
        new Metric({
          namespace: 'AWS/States',
          metricName: 'ExecutionsStarted',
          dimensionsMap: {
            StateMachineArn: stateMachine.stateMachineArn,
          },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
      ],
      view: GraphWidgetView.TIME_SERIES,
      width: 12,
      height: 6,
    });

    const failedStepFunctionExecutions = new LogQueryWidget({
      title: 'Failed Executions',
      logGroupNames: [`/aws/stepfunctions/${props.appName}-state-machine-${props.envName}`],
      queryString: `fields @timestamp, @message 
| filter @message like /(Failed|Timed out)/  
| parse @message /execution_arn":"[^:]+:[^:]+:[^:]+:[^:]+:[^:]+:[^:]+:[^:]+:(?<executionId>[^:]+):/ 
| parse executionId /(ado|workitem)-(?<workItemId>[0-9]+)-rev-(?<rev>[0-9]+)/ 
| filter executionId not like /ado-0-rev-1/ 
| display workItemId, rev, details.error, @timestamp
| sort @timestamp desc
| limit 1000`,
      width: 12,
      height: 6,
    });

    const unhandledErrorLogs = new LogQueryWidget({
      title: 'Unhandled Error Logs',
      logGroupNames: [
        `/aws/lambda/${evaluateUserStoryFunction.functionName}`,
        `/aws/lambda/${defineTasksFunction.functionName}`,
        `/aws/lambda/${createTasksFunction.functionName}`,
        `/aws/lambda/${addCommentFunction.functionName}`,
        `/aws/lambda/${sendResponseFunction.functionName}`,
      ],
      queryString: `SOURCE '/aws/lambda/${evaluateUserStoryFunction.functionName}' | SOURCE '/aws/lambda/${defineTasksFunction.functionName}' | SOURCE '/aws/lambda/${createTasksFunction.functionName}' | SOURCE '/aws/lambda/${addCommentFunction.functionName}' | SOURCE '/aws/lambda/${sendResponseFunction.functionName}'
| fields @timestamp, @message, @logStream 
| filter level like /ERROR/
| filter @message not like /Work item \\d+ does not meet requirements/
| display function_name, message, @message, @timestamp
| sort @timestamp desc 
| limit 1000`,
      width: 12,
      height: 6,
    });

    const incompleteUserStories = new LogQueryWidget({
      title: 'Incomplete User Stories',
      logGroupNames: [`/aws/lambda/${evaluateUserStoryFunction.functionName}`],
      queryString: `SOURCE '/aws/lambda/${evaluateUserStoryFunction.functionName}'
| fields @timestamp, @message, @logStream 
| filter @message like /Work item \\d+ does not meet requirements/ and @message not like /Work item 0\\s+does not meet requirements/
| parse @message /Work item (?<workItemId>[0-9]+) does not meet requirements/
| display workItemId, message, reason, @timestamp
| sort @timestamp desc 
| limit 1000`,
      width: 12,
      height: 6,
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
      userStoriesEvaluatedWidged,
      tasksGeneratedWidget,
      userStoriesUpdatedWidget,
      incompleteUserStoriesWidget,
      setFunctionDurationWidget,
      lambdaFunctionsDurationWidget,
      stepFunctionExecutionTimeHistogram,
      stepFunctionExecutionsHistogram,
      failedStepFunctionExecutions,
      unhandledErrorLogs,
      incompleteUserStories,
      apiGatewayAccessLogs,
      apiGatewayRequestsWidget,
      apiGatewayLatencyWidget
    );
  }
}
