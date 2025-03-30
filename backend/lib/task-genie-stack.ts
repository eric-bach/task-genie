import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Choice, Condition, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Port, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Dashboard, GaugeWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { AccountRecovery, UserPool, UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import { ApiKey, ApiKeySourceType, Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
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
      cidr: '10.0.0.0/16',
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

    const evaluateTasksFunction = new NodejsFunction(this, 'EvaluateTasks', {
      runtime: Runtime.NODEJS_22_X,
      functionName: `${APP_NAME}-evaluate-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/evaluateTasks/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 768,
      timeout: Duration.seconds(60),
      vpc,
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    evaluateTasksFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );
    evaluateTasksFunction.addToRolePolicy(
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
      memorySize: 768,
      timeout: Duration.seconds(60),
      vpc,
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
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
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azureDevOpsPat.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
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
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azureDevOpsPat.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });
    azureDevOpsPat.grantRead(addCommentFunction);

    /*
     * ### AWS Step Functions
     */

    // Tasks
    const evaluateTasksTask = new LambdaInvoke(this, 'EvaluateTasksTask', {
      lambdaFunction: evaluateTasksFunction,
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

    // Choice state
    const choice = new Choice(this, 'User story is complete?')
      .when(Condition.numberEquals('$.statusCode', 400), addCommentTask)
      .otherwise(defineTasksTask.next(createTasksTask.next(addCommentTask)));
    const definition = evaluateTasksTask.next(choice);

    // Step Function
    const stateMachine = new StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(5),
    });

    /*
     * ### AWS Lambda
     */

    const parseUserStory = new NodejsFunction(this, 'ParseUserStory', {
      runtime: Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-parse-user-story`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/parseUserStory/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 384,
      timeout: Duration.seconds(10),
      vpc,
      environment: {
        POWERTOOLS_LOGGER_LOG_EVENT: 'true',
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        AWS_VPC_ID: vpc.vpcId,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      bundling: {
        externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
      },
    });

    // const parseUserStoryFunctionUrl = parseUserStory.addFunctionUrl({
    //   authType: lambda.FunctionUrlAuthType.NONE,
    // });

    // Grant the parseUserStory function permissions to start the Step Function execution
    stateMachine.grantStartExecution(parseUserStory);

    /*
     * ### Amazon API Gateway
     */

    const api = new RestApi(this, 'WebhookApi', {
      restApiName: 'AzureDevOpsWebhookAPI',
      description: 'API Gateway to handle Azure DevOps Service Hooks.',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      apiKeySourceType: ApiKeySourceType.HEADER,
    });
    const webhookIntegration = new LambdaIntegration(parseUserStory);

    // Add method with API key authentication
    const webhookResource = api.root.addResource('webhook');
    webhookResource.addMethod('POST', webhookIntegration, {
      apiKeyRequired: true, // Enable API Key Authentication
    });

    // Add API key
    const apiKey = new ApiKey(this, 'WebhookApiKey', {
      apiKeyName: 'WebhookApiKey',
    });
    const usagePlan = api.addUsagePlan('WebhookUsagePlan', {
      name: 'WebhookUsagePlan',
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
    cloudwatchEndpoint.connections.allowFrom(evaluateTasksFunction, Port.tcp(443));

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
    bedrockEndpoint.connections.allowFrom(evaluateTasksFunction, Port.tcp(443));
    bedrockEndpoint.connections.allowFrom(defineTasksFunction, Port.tcp(443));

    // Interface VPC endpoint for Step Functions
    const stepFunctionsEndpoint = vpc.addInterfaceEndpoint('StepFunctionsEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.states`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    });
    stepFunctionsEndpoint.connections.allowFrom(parseUserStory, Port.tcp(443));

    /*
     * ### Amazon CloudWatch
     */

    // Dashboard
    const dashboard = new Dashboard(this, 'MyDashboard', {
      dashboardName: 'task-genie-dashboard',
    });

    // Metrics
    const tasksGeneratedMetric = new Metric({
      namespace: 'Azure DevOps',
      metricName: 'TasksGenerated',
      dimensionsMap: { Tasks: 'Tasks' },
    });

    const userStoriesUpdatedMetric = new Metric({
      namespace: 'Azure DevOps',
      metricName: 'UserStoriesUpdated',
      dimensionsMap: { 'User Story': 'User Stories' },
    });

    const incompleteUserStoriesMetric = new Metric({
      namespace: 'Azure DevOps',
      metricName: 'IncompleteUserStories',
      dimensionsMap: { 'User Story': 'User Stories' },
    });

    // Widgets
    const tasksGeneratedWidget = new GaugeWidget({
      title: 'Tasks Generated',
      metrics: [tasksGeneratedMetric],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    const userStoriesUpdatedWidget = new GaugeWidget({
      title: 'User Stories Updated',
      metrics: [userStoriesUpdatedMetric],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    const incompleteUserStoriesWidget = new GaugeWidget({
      title: 'Incomplete User Stories',
      metrics: [incompleteUserStoriesMetric],
      width: 6,
      leftYAxis: { min: 0, max: 100 },
    });

    dashboard.addWidgets(tasksGeneratedWidget, userStoriesUpdatedWidget, incompleteUserStoriesWidget);

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
