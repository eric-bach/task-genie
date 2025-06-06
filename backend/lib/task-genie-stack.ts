import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Architecture, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Choice, Condition, LogLevel, StateMachine, StateMachineType } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IpAddresses, Port, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Dashboard,
  GaugeWidget,
  GraphWidget,
  GraphWidgetView,
  LogQueryWidget,
  Metric,
  SingleValueWidget,
} from 'aws-cdk-lib/aws-cloudwatch';
import { AccountRecovery, UserPool, UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import {
  ApiKey,
  ApiKeySourceType,
  Cors,
  EndpointType,
  RestApi,
  StepFunctionsIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const APP_NAME = 'task-genie';

export class TaskGenieStack extends Stack {
  /**
   * Constructs a new instance of the TaskGenieStack.
   *
   * This stack sets up the infrastructure for the Task Genie application, including:
   * - Cognito User Pool for user authentication and management.
   * - VPC for networking.
   * - Lambda functions for task evaluation, definition, creation, and commenting.
   * - Step Functions for orchestrating task workflows.
   * - API Gateway for handling Azure DevOps webhooks.
   * - CloudWatch Dashboard for monitoring metrics.
   *
   * @param scope - The scope in which this stack is defined.
   * @param id - The scoped ID of the stack.
   * @param props - Stack properties.
   */
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /*
     * ### Amazon Cognito
     */

    const userPool = new UserPool(this, 'TaskGenieUserPool', {
      userPoolName: 'task_genie_user_pool',
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      autoVerify: {
        email: true,
      },
      signInAliases: {
        username: false,
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new UserPoolDomain(this, 'TaskGenieUserPoolDomain', {
      userPool: userPool,
      cognitoDomain: {
        domainPrefix: 'taskgenie',
      },
    });

    const userPoolClient = new UserPoolClient(this, 'TaskGenieUserClient', {
      userPoolClientName: 'task_genie_user_client',
      accessTokenValidity: Duration.hours(8),
      idTokenValidity: Duration.hours(8),
      userPool,
    });

    /*
     * ### AWS VPC
     */

    const vpc = new Vpc(this, 'VPC', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `Private Subnet - ${APP_NAME}`,
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
      ],
      restrictDefaultSecurityGroup: true,
    });

    /*
     * ### Tokens
     */

    const azureDevOpsPat = new StringParameter(this, 'AzureDevOpsPAT', {
      parameterName: `/${APP_NAME}/azure-devops-pat`,
      stringValue: process.env.AZURE_DEVOPS_PAT || '',
      description: 'Azure DevOps Personal Access Token',
    });

    /*
     * ### AWS Lambda
     */

    const powertoolsLayer = LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${Stack.of(this).region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:20`
    );

    const evaluateUserStoryFunction = new NodejsFunction(this, 'EvaluateUserStory', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-evaluate-user-story`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/EvaluateUserStory/index.ts'),
      layers: [powertoolsLayer],
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      vpc,
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    evaluateUserStoryFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );
    evaluateUserStoryFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${process.env.AWS_BEDROCK_MODEL_ID}`],
      })
    );

    const defineTasksFunction = new NodejsFunction(this, 'DefineTasks', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-define-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/defineTasks/index.ts'),
      layers: [powertoolsLayer],
      architecture: Architecture.X86_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      vpc,
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    defineTasksFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${process.env.AWS_BEDROCK_MODEL_ID}`],
      })
    );

    const createTasksFunction = new NodejsFunction(this, 'CreateTasks', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-create-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/createTasks/index.ts'),
      layers: [powertoolsLayer],
      architecture: Architecture.X86_64,
      memorySize: 1024,
      timeout: Duration.seconds(10),
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azureDevOpsPat.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    azureDevOpsPat.grantRead(createTasksFunction);
    createTasksFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    const addCommentFunction = new NodejsFunction(this, 'AddComment', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-add-comment`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/addComment/index.ts'),
      layers: [powertoolsLayer],
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(10),
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azureDevOpsPat.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    azureDevOpsPat.grantRead(addCommentFunction);

    const sendResponseFunction = new NodejsFunction(this, 'SendResponse', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-send-response`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/sendResponse/index.ts'),
      layers: [powertoolsLayer],
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(3),
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });

    /*
     * ### AWS Step Functions
     */

    // Tasks
    const evaluateUserStoryTask = new LambdaInvoke(this, 'EvaluateUserStoryTask', {
      lambdaFunction: evaluateUserStoryFunction,
      outputPath: '$.Payload',
    });

    const defineTasksTask = new LambdaInvoke(this, 'DefineTasksTask', {
      lambdaFunction: defineTasksFunction,
      outputPath: '$.Payload',
    });

    const createTasksTask = new LambdaInvoke(this, 'CreateTasksTask', {
      lambdaFunction: createTasksFunction,
      outputPath: '$.Payload',
    });

    const addCommentTask = new LambdaInvoke(this, 'AddCommentTask', {
      lambdaFunction: addCommentFunction,
      outputPath: '$.Payload',
    });

    const sendResponseTask = new LambdaInvoke(this, 'SendResponseTask', {
      lambdaFunction: sendResponseFunction,
      outputPath: '$.Payload',
    });

    // State Machine Definition
    const definition = evaluateUserStoryTask.next(
      new Choice(this, 'User story is defined?')
        .when(
          Condition.or(
            Condition.numberEquals('$.statusCode', 204),
            Condition.numberEquals('$.statusCode', 400),
            Condition.numberEquals('$.statusCode', 500)
          ),
          sendResponseTask
        )
        .when(
          Condition.numberEquals('$.statusCode', 412),
          new Choice(this, 'Add comment?')
            .when(Condition.numberGreaterThan('$.body.workItem.workItemId', 0), addCommentTask.next(sendResponseTask))
            .otherwise(sendResponseTask)
        )
        .otherwise(
          defineTasksTask.next(
            new Choice(this, 'Create task?')
              .when(Condition.numberEquals('$.statusCode', 500), sendResponseTask)
              .when(Condition.numberGreaterThan('$.body.workItem.workItemId', 0), createTasksTask.next(addCommentTask))
              .otherwise(sendResponseTask)
          )
        )
    );

    // Step Function
    const stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: `${APP_NAME}-state-machine`,
      definition,
      stateMachineType: StateMachineType.EXPRESS,
      timeout: Duration.minutes(5),
      tracingEnabled: true,
      logs: {
        destination: new LogGroup(this, 'StateMachineLogGroup', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    /*
     * ### Amazon API Gateway
     */

    const api = new RestApi(this, 'TaskGenieAPI', {
      restApiName: 'TaskGenieAPI',
      description: 'API Gateway to handle for Task Genie',
      endpointTypes: [EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Amz-User-Agent'],
        allowCredentials: true,
      },
      apiKeySourceType: ApiKeySourceType.HEADER,
    });

    // Step Function Integration
    const stepFunctionsIntegration = StepFunctionsIntegration.startExecution(stateMachine, {
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST'",
            'method.response.header.Access-Control-Allow-Headers':
              "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
          },
          responseTemplates: {
            'application/json': `
              #set($parsedPayload = $util.parseJson($input.path('$.output')))
              #if($parsedPayload.statusCode)
                #set($context.responseOverride.status = $parsedPayload.statusCode)
              #end
              $input.path('$.output')
            `,
          },
        },
        {
          statusCode: '204',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST'",
            'method.response.header.Access-Control-Allow-Headers':
              "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
          },
          responseTemplates: {
            'application/json': `
              #set($parsedPayload = $util.parseJson($input.path('$.output')))
              #if($parsedPayload.statusCode)
                #set($context.responseOverride.status = $parsedPayload.statusCode)
              #end
              $input.path('$.output')
            `,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST'",
            'method.response.header.Access-Control-Allow-Headers':
              "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
          },
          responseTemplates: {
            'application/json': `
              #set($parsedPayload = $util.parseJson($input.path('$.output')))
              #if($parsedPayload.statusCode)
                #set($context.responseOverride.status = $parsedPayload.statusCode)
              #end
              $input.path('$.output')
            `,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
          },
          responseTemplates: {
            'application/json': `
              #set($parsedPayload = $util.parseJson($input.path('$.output')))
              #if($parsedPayload.statusCode)
                #set($context.responseOverride.status = $parsedPayload.statusCode)
              #end
              $input.path('$.output')
            `,
          },
        },
      ],
    });

    // Add Method
    api.root.addMethod('POST', stepFunctionsIntegration, {
      apiKeyRequired: true,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
        {
          statusCode: '204',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
      ],
    });

    // Add API key
    const apiKey = new ApiKey(this, 'TaskGenieApiKey', {
      apiKeyName: 'TaskGenieWebApiKey',
    });
    const usagePlan = api.addUsagePlan('TaskGenieUsagePlan', {
      name: 'TaskGenieUsagePlan',
      throttle: {
        rateLimit: 10,
        burstLimit: 2,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    /*
     * ### Amazon VPC Endpoints
     */

    // Interface VPC endpoint for CloudWatch Metrics
    const cloudwatchEndpoint = vpc.addInterfaceEndpoint('CloudWatchEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.monitoring`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    });
    cloudwatchEndpoint.connections.allowFrom(evaluateUserStoryFunction, Port.tcp(443));

    // Interface VPC endpoint for Bedrock
    const bedrockEndpoint = vpc.addInterfaceEndpoint('BedrockEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.bedrock-runtime`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    });
    bedrockEndpoint.connections.allowFrom(evaluateUserStoryFunction, Port.tcp(443));
    bedrockEndpoint.connections.allowFrom(defineTasksFunction, Port.tcp(443));

    /*
     * ### Amazon CloudWatch
     */

    // Dashboard
    const dashboard = new Dashboard(this, 'MyDashboard', {
      dashboardName: 'task-genie-dashboard',
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

    const errorLogs = new LogQueryWidget({
      title: 'Error Logs',
      logGroupNames: [
        `/aws/lambda/${evaluateUserStoryFunction.functionName}`,
        `/aws/lambda/${defineTasksFunction.functionName}`,
        `/aws/lambda/${createTasksFunction.functionName}`,
        `/aws/lambda/${addCommentFunction.functionName}`,
        `/aws/lambda/${sendResponseFunction.functionName}`,
      ],
      queryString: `SOURCE '/aws/lambda/${evaluateUserStoryFunction.functionName}' | SOURCE '/aws/lambda/${defineTasksFunction.functionName}' | SOURCE '/aws/lambda/${createTasksFunction.functionName}' | SOURCE '/aws/lambda/${addCommentFunction.functionName}' | SOURCE '/aws/lambda/${sendResponseFunction.functionName}' 
        | fields @timestamp, @message, @logStream 
        | filter @message like /Work item \\d+\\s+does not meet requirements/ and @message not like /Work item 0\\s+does not meet requirements/ 
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
       | filter @message like /ERROR/ and @message not like /Work item \\d+\\s+does not meet requirements/
       | sort @timestamp desc 
       | limit 10000`,
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
      errorLogs,
      unhandledErrorLogs
    );

    /*
     * ### Outputs
     */

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
    });
  }
}
