import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Choice, Condition, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dotenv from 'dotenv';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Port, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Dashboard, GaugeWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { AccountRecovery, UserPool, UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

dotenv.config();

const APP_NAME = 'task-genie';

export class TaskGenieStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito user pool
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Cognito user pool domain
    new UserPoolDomain(this, 'TaskGenieUserPoolDomain', {
      userPool: userPool,
      cognitoDomain: {
        domainPrefix: 'taskgenie',
      },
    });

    // Cognito user client
    const userPoolClient = new UserPoolClient(this, 'TaskGenieUserClient', {
      userPoolClientName: 'task_genie_user_client',
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      userPool,
    });

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

    const azureDevOpsPat = new ssm.StringParameter(this, 'AzureDevOpsPAT', {
      parameterName: `/${APP_NAME}/azure-devops-pat`,
      stringValue: process.env.AZURE_DEVOPS_PAT || '',
      description: 'Azure DevOps Personal Access Token',
    });

    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${cdk.Stack.of(this).region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:20`
    );

    const evaluateTasksFunction = new NodejsFunction(this, 'EvaluateTasks', {
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-evaluate-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/evaluateTasks/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 768,
      timeout: cdk.Duration.seconds(60),
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
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-define-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/defineTasks/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 768,
      timeout: cdk.Duration.seconds(60),
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
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-create-tasks`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/createTasks/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
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
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-add-comment`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/addComment/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
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

    // Step Function tasks
    const evaluateTasksTask = new tasks.LambdaInvoke(this, 'EvaluateTasksTask', {
      lambdaFunction: evaluateTasksFunction,
      outputPath: '$.Payload',
    });

    const defineTasksTask = new tasks.LambdaInvoke(this, 'DefineTasksTask', {
      lambdaFunction: defineTasksFunction,
      outputPath: '$.Payload',
    });

    const createTasksTask = new tasks.LambdaInvoke(this, 'CreateTasksTask', {
      lambdaFunction: createTasksFunction,
      outputPath: '$.Payload',
    });

    const addCommentTask = new tasks.LambdaInvoke(this, 'AddCommentTask', {
      lambdaFunction: addCommentFunction,
      outputPath: '$.Payload',
    });

    // Choice state to handle errors

    const choice = new Choice(this, 'User story is complete?')
      .when(Condition.numberEquals('$.statusCode', 400), addCommentTask)
      .otherwise(defineTasksTask.next(createTasksTask.next(addCommentTask)));
    const definition = evaluateTasksTask.next(choice);

    // Step Function
    const stateMachine = new StateMachine(this, 'StateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    const parseUserStory = new NodejsFunction(this, 'ParseUserStory', {
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${APP_NAME}-parse-user-story`,
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/parseUserStory/index.ts'),
      layers: [powertoolsLayer],
      memorySize: 384,
      timeout: cdk.Duration.seconds(10),
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

    const parseUserStoryFunctionUrl = parseUserStory.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Grant the parseUserStory function permissions to start the Step Function execution
    stateMachine.grantStartExecution(parseUserStory);

    // Create an interface VPC endpoint for CloudWatch Metrics
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

    // Create an interface VPC endpoint for Bedrock
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

    // Create an interface VPC endpoint for Step Functions
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

    // Outputs
    new cdk.CfnOutput(this, 'ParseUserStoryFunctionUrl', {
      value: parseUserStoryFunctionUrl.url,
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
    });
  }
}
