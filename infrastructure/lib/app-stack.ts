import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement, Role, ServicePrincipal, ManagedPolicy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import {
  AccessLogFormat,
  ApiKey,
  ApiKeySourceType,
  CfnAccount,
  Cors,
  EndpointType,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { LogGroup, LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { AgentRuntimeArtifact, Runtime } from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { AppStackProps } from '../bin/task-genie';
import { TaskGenieLambda } from './constructs/lambda';

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export class AppStack extends Stack {
  public trackTaskFeedbackFunctionArn: string;
  public apiGwAccessLogGroupArn: string;
  public apiName: string;

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

    const azureDevOpsCredentialsSecretName = props.params.azureDevOpsCredentialsSecretName;
    const azureDevOpsCredentialsSecret = Secret.fromSecretNameV2(
      this,
      'AzureDevOpsCredentialsSecret',
      azureDevOpsCredentialsSecretName
    );

    const resultsTable = Table.fromTableArn(this, 'ResultsTable', props.params.resultsTableArn);
    const configTable = Table.fromTableArn(this, 'ConfigTable', props.params.configTableArn);
    const feedbackTable = Table.fromTableArn(this, 'FeedbackTable', props.params.feedbackTableArn);

    const dataSourceBucket = Bucket.fromBucketArn(this, 'DataSourceBucket', props.params.dataSourceBucketArn);

    /*
     * Amazon Bedrock AgentCore
     */

    const role = new Role(this, 'AgentRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      inlinePolicies: {
        BedrockAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Retrieve'],
              resources: ['*'],
            }),
            new PolicyStatement({
              actions: ['cloudwatch:PutMetricData', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: ['*'],
            }),
            new PolicyStatement({
              actions: ['dynamodb:GetItem'],
              resources: [props.params.configTableArn],
            }),
            new PolicyStatement({
              actions: ['dynamodb:PutItem'],
              resources: [props.params.resultsTableArn],
            }),
            new PolicyStatement({
              actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'],
              resources: [
                feedbackTable.tableArn,
                `${feedbackTable.tableArn}/index/*`, // For GSI access
              ],
            }),
          ],
        }),
      },
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess')],
    });

    const workItemAgentArtifact = AgentRuntimeArtifact.fromAsset(path.join(__dirname, '..', '..'), {
      file: 'backend/agents/workItemAgent/Dockerfile',
      platform: Platform.LINUX_ARM64,
    });

    const workItemAgent = new Runtime(this, 'WorkItemAgent', {
      runtimeName: 'workItemAgent',
      executionRole: role,
      agentRuntimeArtifact: workItemAgentArtifact,
      environmentVariables: {
        AZURE_DEVOPS_CREDENTIALS_SECRET_NAME: azureDevOpsCredentialsSecretName,
        AZURE_DEVOPS_ORGANIZATION: process.env.AZURE_DEVOPS_ORGANIZATION || '',
        AZURE_DEVOPS_SCOPE: process.env.AZURE_DEVOPS_SCOPE || '',
        AZURE_DEVOPS_TENANT_ID: process.env.AZURE_DEVOPS_TENANT_ID || '',
        AZURE_DEVOPS_CLIENT_ID: process.env.AZURE_DEVOPS_CLIENT_ID || '',
        AZURE_DEVOPS_CLIENT_SECRET: process.env.AZURE_DEVOPS_CLIENT_SECRET || '',
        AWS_REGION: process.env.AWS_REGION || this.region,
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
        RESULTS_TABLE_NAME: resultsTable.tableName,
        CONFIG_TABLE_NAME: configTable.tableName,
        FEEDBACK_TABLE_NAME: feedbackTable.tableName,
        FEEDBACK_FEATURE_ENABLED: process.env.FEEDBACK_FEATURE_ENABLED || '',
      },
    });
    azureDevOpsCredentialsSecret.grantRead(workItemAgent);

    /*
     * AWS Lambda
     */

    const workItemAgentProxyFunction = new TaskGenieLambda(this, 'WorkItemAgentProxy', {
      functionName: `${props.appName}-workItemAgent-proxy-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/proxy/agent/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/proxy/agent'),
      depsLockFilePath: path.resolve(__dirname, '../../backend/lambda/proxy/agent/package-lock.json'),
      handler: 'handler',
      memorySize: 384,
      timeout: Duration.minutes(5),
      environment: {
        BEDROCK_AGENTCORE_RUNTIME_ARN: workItemAgent.agentRuntimeArn,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: ['bedrock-agentcore:InvokeAgentRuntime'],
          resources: [workItemAgent.agentRuntimeArn, `${workItemAgent.agentRuntimeArn}/*`],
        }),
      ],
    });

    const pollExecutionFunction = new TaskGenieLambda(this, 'PollExecution', {
      functionName: `${props.appName}-poll-execution-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/workflow/pollExecution/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/workflow/pollExecution'),
      depsLockFilePath: path.resolve(__dirname, '../../backend/lambda/workflow/pollExecution/package-lock.json'),
      memorySize: 384,
      timeout: Duration.seconds(5),
      environment: {
        TABLE_NAME: resultsTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [resultsTable.tableArn],
        }),
      ],
    });
    resultsTable.grantReadData(pollExecutionFunction);

    const syncKnowledgeBaseFunction = new TaskGenieLambda(this, 'SyncKnowledgeBase', {
      functionName: `${props.appName}-sync-knowledge-base-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/syncKnowledgeBase/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/syncKnowledgeBase'),
      depsLockFilePath: path.resolve(
        __dirname,
        '../../backend/lambda/knowledgeBase/syncKnowledgeBase/package-lock.json'
      ),
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
    // Also trigger for object deletions (covers Delete and DeleteMarkerCreated) to sync removals
    dataSourceBucket.addEventNotification(EventType.OBJECT_REMOVED, new LambdaDestination(syncKnowledgeBaseFunction));

    const generatePresignedUrlFunction = new TaskGenieLambda(this, 'GeneratePresignedUrl', {
      functionName: `${props.appName}-generate-presigned-url-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/generatePresignedUrl/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/generatePresignedUrl'),
      depsLockFilePath: path.resolve(
        __dirname,
        '../../backend/lambda/knowledgeBase/generatePresignedUrl/package-lock.json'
      ),
      memorySize: 384,
      timeout: Duration.seconds(5),
      environment: {
        S3_BUCKET_NAME: dataSourceBucket.bucketName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    // Grant the Lambda function permission to generate a presigned URL for the S3 bucket
    dataSourceBucket.grantPut(generatePresignedUrlFunction);

    // Manage Knowledge Base Documents Lambda (Consolidated)
    const manageKnowledgeBaseDocumentsFunction = new TaskGenieLambda(this, 'ManageKnowledgeBaseDocuments', {
      functionName: `${props.appName}-manage-kb-documents-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/manageKnowledgeBaseDocuments/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/knowledgeBase/manageKnowledgeBaseDocuments'),
      depsLockFilePath: path.resolve(
        __dirname,
        '../../backend/lambda/knowledgeBase/manageKnowledgeBaseDocuments/package-lock.json'
      ),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        S3_BUCKET_NAME: dataSourceBucket.bucketName,
        AWS_BEDROCK_KNOWLEDGE_BASE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: [
            'bedrock:GetKnowledgeBase',
            'bedrock:ListKnowledgeBases',
            'bedrock:ListKnowledgeBaseDocuments',
            'bedrock:StartIngestionJob',
            'bedrock:GetIngestionJob',
            'bedrock:ListIngestionJobs',
          ],
          resources: ['*'],
        }),
      ],
    });
    // Grant permissions
    dataSourceBucket.grantRead(manageKnowledgeBaseDocumentsFunction);
    dataSourceBucket.grantDelete(manageKnowledgeBaseDocumentsFunction);

    // Manage Config Lambda (Consolidated)
    const manageConfigFunction = new TaskGenieLambda(this, 'ManageConfig', {
      functionName: `${props.appName}-manage-config-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/config/manageConfig/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/config/manageConfig'),
      depsLockFilePath: path.resolve(__dirname, '../../backend/lambda/config/manageConfig/package-lock.json'),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        CONFIG_TABLE_NAME: configTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    configTable.grantReadWriteData(manageConfigFunction);

    // Feedback Tracking Lambda
    const trackTaskFeedbackFunction = new TaskGenieLambda(this, 'TrackTaskFeedback', {
      functionName: `${props.appName}-track-task-feedback-${props.envName}`,
      entry: path.resolve(__dirname, '../../backend/lambda/feedback/trackTaskFeedback/index.ts'),
      projectRoot: path.resolve(__dirname, '../../backend/lambda/feedback/trackTaskFeedback'),
      depsLockFilePath: path.resolve(__dirname, '../../backend/lambda/feedback/trackTaskFeedback/package-lock.json'),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        FEEDBACK_TABLE_NAME: feedbackTable.tableName,
        RESULTS_TABLE_NAME: resultsTable.tableName,
        FEEDBACK_FEATURE_ENABLED: process.env.FEEDBACK_FEATURE_ENABLED || 'false',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      policyStatements: [
        new PolicyStatement({
          actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:Scan'],
          resources: [
            feedbackTable.tableArn,
            `${feedbackTable.tableArn}/index/*`, // For GSI access
            resultsTable.tableArn,
            `${resultsTable.tableArn}/index/*`, // For GSI access
          ],
        }),
      ],
    });

    // Create CloudWatch Logs role for API Gateway
    const apiGatewayCloudWatchLogsRole = new Role(this, 'ApiGatewayCloudWatchLogsRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')],
    });

    // Configure API Gateway account settings for CloudWatch logging
    new CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayCloudWatchLogsRole.roleArn,
    });

    // API Gateway Access Log Group
    const apiGwAccessLogGroup = new LogGroup(this, 'ApiGwAccessLogGroup', {
      logGroupName: `/aws/apigateway/${props.appName}-api-access-logs-${props.envName}`,
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

    // Add API key
    const apiKey = new ApiKey(this, 'TaskGenieApiKey', {
      apiKeyName: `${props.appName}-web-api-key-${props.envName}`,
    });

    // Set API usage plan
    const usagePlan = api.addUsagePlan('TaskGenieUsagePlan', {
      name: `${props.appName}-usage-plan-${props.envName}`,
      throttle: {
        rateLimit: 200,
        burstLimit: 50,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    const executionsResource = api.root.addResource('executions');
    executionsResource.addMethod(
      'POST',
      new LambdaIntegration(workItemAgentProxyFunction, {
        proxy: false, // Don't use proxy integration for async
        integrationResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Work item submitted for processing',
                timestamp: '$context.requestTime',
              }),
            },
          },
        ],
        requestTemplates: {
          'application/json': '$input.body', // Pass the request body directly
        },
        requestParameters: {
          'integration.request.header.X-Amz-Invocation-Type': "'Event'", // Async invocation
        },
      }),
      {
        apiKeyRequired: true,
        methodResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Methods': true,
              'method.response.header.Access-Control-Allow-Headers': true,
            },
          },
        ],
      }
    );

    // Add method to list knowledge base documents
    //  GET /knowledge-base/documents
    const knowledgeBaseResource = api.root.addResource('knowledge-base');

    // Add method to generate a S3 presigned URL
    //  GET /knowledge-base/presigned-url
    const generatePresignedUrlResource = knowledgeBaseResource.addResource('presigned-url');
    generatePresignedUrlResource.addMethod(
      'GET',
      new LambdaIntegration(generatePresignedUrlFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false, // No API key required for uploading documents
      }
    );
    const documentsResource = knowledgeBaseResource.addResource('documents');
    documentsResource.addMethod(
      'GET',
      new LambdaIntegration(manageKnowledgeBaseDocumentsFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false, // No API key required for listing documents
      }
    );
    documentsResource.addMethod(
      'DELETE',
      new LambdaIntegration(manageKnowledgeBaseDocumentsFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false,
      }
    );

    // Config API resource
    //  PUT /config
    const configResource = api.root.addResource('config');
    configResource.addMethod('PUT', new LambdaIntegration(manageConfigFunction, { proxy: true }), {
      apiKeyRequired: false,
    });
    configResource.addMethod('GET', new LambdaIntegration(manageConfigFunction, { proxy: true }), {
      apiKeyRequired: false,
    });
    configResource.addMethod('DELETE', new LambdaIntegration(manageConfigFunction, { proxy: true }), {
      apiKeyRequired: false,
    });

    // Feedback webhook API resource for Azure DevOps (Asynchronous)
    //  POST /feedback/track
    const feedbackResource = api.root.addResource('feedback');
    const trackFeedbackResource = feedbackResource.addResource('track');

    // Asynchronous Lambda integration for feedback tracking
    trackFeedbackResource.addMethod(
      'POST',
      new LambdaIntegration(trackTaskFeedbackFunction, {
        proxy: false, // Don't use proxy integration for async
        integrationResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Feedback request accepted for processing',
                timestamp: '$context.requestTime',
              }),
            },
          },
        ],
        requestTemplates: {
          'application/json': '$input.body', // Pass the request body directly
        },
        requestParameters: {
          'integration.request.header.X-Amz-Invocation-Type': "'Event'", // Async invocation
        },
      }),
      {
        apiKeyRequired: true,
        methodResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Methods': true,
              'method.response.header.Access-Control-Allow-Headers': true,
            },
          },
        ],
      }
    );

    // Add method to poll Step Function execution results
    //  GET /executions/{executionId} (URL-encoded execution ID with colons)
    const pollResource = executionsResource.addResource('{executionId}');
    pollResource.addMethod(
      'GET',
      new LambdaIntegration(pollExecutionFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: true, // Require API key for polling endpoint
      }
    );

    /*
     * Properties
     */

    this.trackTaskFeedbackFunctionArn = trackTaskFeedbackFunction.functionArn;
    this.apiGwAccessLogGroupArn = apiGwAccessLogGroup.logGroupArn;
    this.apiName = api.restApiName;
  }
}
