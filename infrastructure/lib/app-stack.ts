import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Choice, Condition, LogLevel, StateMachine, StateMachineType, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { InterfaceVpcEndpoint, Port } from 'aws-cdk-lib/aws-ec2';
import {
  AccessLogFormat,
  ApiKey,
  ApiKeySourceType,
  AwsIntegration,
  Cors,
  EndpointType,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  PassthroughBehavior,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { LogGroup, LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AppStackProps } from '../bin/task-genie';

import * as path from 'path';
import * as dotenv from 'dotenv';
import { TaskGenieLambda } from './constructs/lambda';

dotenv.config();

export class AppStack extends Stack {
  public stateMachineArn: string;
  public evaluateUserStoryFunctionArn: string;
  public defineTasksFunctionArn: string;
  public createTasksFunctionArn: string;
  public addCommentFunctionArn: string;
  public sendResponseFunctionArn: string;
  public apiGwAccessLogGroupArn: string;

  /**
   * Constructs a new instance of the Task Genie AppStack.
   *
   * This stack sets up the stateless resources for the Task Genie application, including:
   * - Lambda functions for task evaluation, definition, creation, and commenting.
   * - Step Functions for orchestrating task workflows.
   * - API Gateway for handling Azure DevOps webhooks.
   *
   * @param scope - The scope in which this stack is defined.
   * @param id - The scoped ID of the stack.
   * @param props - Stack properties.
   */
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    /*
     * Lookup properties
     */

    const vpc = props.params.vpc;

    const cloudwatchVpcEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
      this,
      'CloudWatchVpcEndpoint',
      {
        vpcEndpointId: props.params.cloudwatchVpcEndpointId,
        port: 443,
      }
    );

    const bedrockVpcEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(this, 'BedrockVpcEndpoint', {
      vpcEndpointId: props.params.bedrockVpcEndpointId,
      port: 443,
    });

    const bedrockAgentVpcEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
      this,
      'BedrockAgentVpcEndpoint',
      {
        vpcEndpointId: props.params.bedrockAgentVpcEndpointId,
        port: 443,
      }
    );

    const ssmVpcEndpoint = InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(this, 'SSMVpcEndpoint', {
      vpcEndpointId: props.params.ssmVpcEndpointId,
      port: 443,
    });

    const azurePersonalAccessToken = props.params.azurePersonalAccessToken;

    const resultsTable = Table.fromTableArn(this, 'ResultsTable', props.params.resultsTableArn);

    const dataSourceBucket = Bucket.fromBucketArn(this, 'DataSourceBucket', props.params.dataSourceBucketArn);

    /*
     * AWS Lambda
     */

    const evaluateUserStoryFunction = new TaskGenieLambda(this, 'EvaluateUserStory', {
      functionName: `${props.appName}-evaluate-user-story-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/evaluateUserStory/index.ts'),
      memorySize: 1024,
      timeout: Duration.seconds(120),
      vpc,
      environment: {
        AWS_ACCOUNT_ID: this.account,
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azurePersonalAccessToken.parameterName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      managedPolicies: [
        {
          managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonBedrockFullAccess',
        },
      ],
      policyStatements: [
        new PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
        }),
      ],
      interfaceEndpoints: [cloudwatchVpcEndpoint, bedrockVpcEndpoint, bedrockAgentVpcEndpoint, ssmVpcEndpoint],
    });
    azurePersonalAccessToken.grantRead(evaluateUserStoryFunction);

    const defineTasksFunction = new TaskGenieLambda(this, 'DefineTasks', {
      functionName: `${props.appName}-define-tasks-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/defineTasks/index.ts'),
      memorySize: 1024,
      timeout: Duration.seconds(120),
      vpc,
      environment: {
        AWS_ACCOUNT_ID: this.account,
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azurePersonalAccessToken.parameterName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      managedPolicies: [
        {
          managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonBedrockFullAccess',
        },
      ],
      interfaceEndpoints: [bedrockVpcEndpoint, bedrockAgentVpcEndpoint, ssmVpcEndpoint],
    });
    azurePersonalAccessToken.grantRead(defineTasksFunction);

    const createTasksFunction = new TaskGenieLambda(this, 'CreateTasks', {
      functionName: `${props.appName}-create-tasks-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/createTasks/index.ts'),
      memorySize: 1024,
      timeout: Duration.seconds(30),
      vpc,
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azurePersonalAccessToken.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
        }),
      ],
      interfaceEndpoints: [cloudwatchVpcEndpoint, ssmVpcEndpoint],
    });
    azurePersonalAccessToken.grantRead(createTasksFunction);

    const addCommentFunction = new TaskGenieLambda(this, 'AddComment', {
      functionName: `${props.appName}-add-comment-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/addComment/index.ts'),
      memorySize: 1024,
      timeout: Duration.seconds(10),
      vpc,
      environment: {
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azurePersonalAccessToken.parameterName,
        GITHUB_ORGANIZATION: process.env.GITHUB_ORGANIZATION || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      interfaceEndpoints: [ssmVpcEndpoint],
    });
    azurePersonalAccessToken.grantRead(addCommentFunction);

    const sendResponseFunction = new TaskGenieLambda(this, 'SendResponse', {
      functionName: `${props.appName}-send-response-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/sendResponse/index.ts'),
      memorySize: 256,
      timeout: Duration.seconds(3),
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        TABLE_NAME: resultsTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    resultsTable.grantWriteData(sendResponseFunction);

    const pollExecutionFunction = new TaskGenieLambda(this, 'PollExecution', {
      functionName: `${props.appName}-poll-execution-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/pollExecution/index.ts'),
      memorySize: 384,
      timeout: Duration.seconds(5),
      environment: {
        TABLE_NAME: resultsTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    resultsTable.grantReadData(pollExecutionFunction);

    const syncKnowledgeBaseFunction = new TaskGenieLambda(this, 'SyncKnowledgeBase', {
      functionName: `${props.appName}-sync-knowledge-base-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/syncKnowledgeBase/index.ts'),
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: {
        AWS_BEDROCK_KNOWLEDGE_BASE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: [
            'bedrock:StartIngestionJob',
            'bedrock:GetIngestionJob',
            'bedrock:ListIngestionJobs',
            'bedrock:GetKnowledgeBase',
            'bedrock:ListKnowledgeBases',
          ],
          resources: ['*'],
        }),
      ],
    });
    dataSourceBucket.grantRead(syncKnowledgeBaseFunction);

    // Add S3 event notification to trigger syncKnowledgeBase when files are uploaded
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(syncKnowledgeBaseFunction),
      {
        // Only trigger for non-metadata files (exclude .metadata.json files)
        suffix: '.pdf',
      }
    );
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(syncKnowledgeBaseFunction),
      {
        suffix: '.docx',
      }
    );
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(syncKnowledgeBaseFunction),
      {
        suffix: '.md',
      }
    );
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(syncKnowledgeBaseFunction),
      {
        suffix: '.txt',
      }
    );
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_CREATED_PUT,
      new LambdaDestination(syncKnowledgeBaseFunction),
      {
        suffix: '.doc',
      }
    );

    const presignedUrlFunction = new TaskGenieLambda(this, 'PresignedUrl', {
      functionName: `${props.appName}-presigned-url-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/presignedUrl/index.ts'),
      memorySize: 384,
      timeout: Duration.seconds(5),
      environment: {
        S3_BUCKET_NAME: dataSourceBucket.bucketName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    // Grant the Lambda function permission to generate presigned URLs for the S3 bucket
    dataSourceBucket.grantPut(presignedUrlFunction);

    /*
     * AWS Step Functions
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
      payload: TaskInput.fromObject({
        'body.$': '$.body',
        'statusCode.$': '$.statusCode',
        'executionName.$': '$$.Execution.Name',
      }),
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

    // Create the Log Group for State Machine separately
    const stateMachineLogGroup = new LogGroup(this, 'StateMachineLogGroup', {
      logGroupName: `/aws/stepfunctions/${props.appName}-state-machine-${props.envName}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Step Function
    const stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: `${props.appName}-state-machine-${props.envName}`,
      definition,
      stateMachineType: StateMachineType.EXPRESS,
      timeout: Duration.minutes(5),
      tracingEnabled: true,
      logs: {
        destination: stateMachineLogGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    /*
     * Amazon API Gateway
     */

    // API Gateway Access Log Group
    const apiGwAccessLogGroup = new LogGroup(this, 'ApiGwAccessLogGroup', {
      logGroupName: `/aws/apigateway/${props.appName}-api-access-logs`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new RestApi(this, 'TaskGenieAPI', {
      restApiName: `${props.appName}-api-${props.envName}`,
      description: 'API Gateway to handle for Task Genie',
      endpointTypes: [EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Amz-User-Agent'],
        allowCredentials: true,
      },
      apiKeySourceType: ApiKeySourceType.HEADER,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(apiGwAccessLogGroup),
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        accessLogFormat: AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
    });
    new LogRetention(this, 'APIExecutionLogsRetention', {
      logGroupName: `API-Gateway-Execution-Logs_${api.restApiId}/${api.deploymentStage.stageName}`,
      retention: RetentionDays.ONE_MONTH,
    });

    const apiExecutionRole = new Role(this, 'APIStepFunctionExecutionRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    apiExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: ['states:StartExecution', 'states:DescribeExecution'],
        resources: [stateMachine.stateMachineArn],
      })
    );

    // Add method to execute Step Function workflow
    //  POST /executions
    const startExecutionIntegration = new AwsIntegration({
      service: 'states',
      action: 'StartExecution',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiExecutionRole,
        requestTemplates: {
          'application/json': `
{
  "input": "$util.escapeJavaScript($input.body).replaceAll("\\'", "'").replaceAll(\"\\\\'\", \"'\")",
  "name": "$input.path('$.resource.workItemId')-rev$input.path('$.resource.rev')",
  "stateMachineArn": "${stateMachine.stateMachineArn}"
}`,
        },
        integrationResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
              'method.response.header.Access-Control-Allow-Credentials': "'true'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Request accepted for processing',
                executionArn: "$input.path('$.executionArn')",
                startDate: "$input.path('$.startDate')",
              }),
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
              'application/json': JSON.stringify({ message: 'Bad request' }),
            },
          },
          {
            statusCode: '500',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
              'method.response.header.Access-Control-Allow-Credentials': "'true'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({ message: 'Internal server error' }),
            },
          },
        ],
        passthroughBehavior: PassthroughBehavior.NEVER,
      },
    });

    const executionsResource = api.root.addResource('executions');
    executionsResource.addMethod('POST', startExecutionIntegration, {
      apiKeyRequired: true,
      methodResponses: [
        {
          statusCode: '202',
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
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
      ],
    });

    // Add method to generate a S3 presigned URL to upload knowledge base documents
    //  GET /uploads/presigned-url
    const presignedUrlResource = api.root.addResource('uploads');
    presignedUrlResource.addMethod(
      'GET',
      new LambdaIntegration(presignedUrlFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false, // No API key required for presigned URLs
      }
    );

    // Add method to poll Step Function execution results
    //  GET /executions/{executionName}
    const pollResource = executionsResource.addResource('{executionName}');
    pollResource.addMethod(
      'GET',
      new LambdaIntegration(pollExecutionFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: true, // Require API key for polling endpoint
      }
    );

    // Add API key
    const apiKey = new ApiKey(this, 'TaskGenieApiKey', {
      apiKeyName: `${props.appName}-web-api-key-${props.envName}`,
    });

    // Set API usage plan
    const usagePlan = api.addUsagePlan('TaskGenieUsagePlan', {
      name: `${props.appName}-usage-plan-${props.envName}`,
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
     * Outputs
     */

    new CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
    });

    /*
     * Properties
     */

    this.stateMachineArn = stateMachine.stateMachineArn;
    this.evaluateUserStoryFunctionArn = evaluateUserStoryFunction.functionArn;
    this.defineTasksFunctionArn = defineTasksFunction.functionArn;
    this.createTasksFunctionArn = createTasksFunction.functionArn;
    this.addCommentFunctionArn = addCommentFunction.functionArn;
    this.sendResponseFunctionArn = sendResponseFunction.functionArn;
    this.apiGwAccessLogGroupArn = apiGwAccessLogGroup.logGroupArn;
  }
}
