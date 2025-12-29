import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  PolicyStatement,
  Role,
  ServicePrincipal,
  ManagedPolicy,
} from 'aws-cdk-lib/aws-iam';
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
import {
  AgentRuntimeArtifact,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
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

    const azureDevOpsCredentialsSecretName =
      props.params.azureDevOpsCredentialsSecretName;
    const azureDevOpsCredentialsSecret = Secret.fromSecretNameV2(
      this,
      'AzureDevOpsCredentialsSecret',
      azureDevOpsCredentialsSecretName
    );

    const resultsTable = Table.fromTableArn(
      this,
      'ResultsTable',
      props.params.resultsTableArn
    );
    const configTable = Table.fromTableArn(
      this,
      'ConfigTable',
      props.params.configTableArn
    );
    const feedbackTable = Table.fromTableArn(
      this,
      'FeedbackTable',
      props.params.feedbackTableArn
    );

    const dataSourceBucket = Bucket.fromBucketArn(
      this,
      'DataSourceBucket',
      props.params.dataSourceBucketArn
    );

    /*
     * Amazon Bedrock AgentCore
     */

    const role = new Role(this, 'AgentRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    role.addToPolicy(
      new PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      })
    );

    role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess')
    );

    const workItemAgentArtifact = AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, '..', '..', 'backend', 'agents', 'work-item-agent'),
      {
        platform: Platform.LINUX_ARM64,
      }
    );

    const workItemAgent = new Runtime(this, 'WorkItemAgent', {
      runtimeName: 'workItemAgent',
      executionRole: role,
      agentRuntimeArtifact: workItemAgentArtifact,
      environmentVariables: {
        AZURE_DEVOPS_ORGANIZATION: process.env.AZURE_DEVOPS_ORGANIZATION || '',
        AZURE_DEVOPS_SCOPE: process.env.AZURE_DEVOPS_SCOPE || '',
        AZURE_DEVOPS_TENANT_ID: process.env.AZURE_DEVOPS_TENANT_ID || '',
        AZURE_DEVOPS_CLIENT_ID: process.env.AZURE_DEVOPS_CLIENT_ID || '',
        AZURE_DEVOPS_CLIENT_SECRET:
          process.env.AZURE_DEVOPS_CLIENT_SECRET || '',
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_ID:
          process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
        AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID:
          process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
        CONFIG_TABLE_NAME: process.env.CONFIG_TABLE_NAME || '',
        FEEDBACK_TABLE_NAME: process.env.FEEDBACK_TABLE_NAME || '',
        FEEDBACK_FEATURE_ENABLED: process.env.FEEDBACK_FEATURE_ENABLED || '',
      },
    });

    /*
     * AWS Lambda
     */

    const workItemAgentProxyFunction = new TaskGenieLambda(
      this,
      'WorkItemAgentProxy',
      {
        functionName: `${props.appName}-work-item-agent-proxy-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/proxy/agent/index.ts'
        ),
        handler: 'handler',
        memorySize: 1024,
        timeout: Duration.minutes(5),
        environment: {
          BEDROCK_AGENTCORE_RUNTIME_ARN: workItemAgent.agentRuntimeArn,
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
        ],
        policyStatements: [
          new PolicyStatement({
            actions: ['cloudwatch:PutMetricData'],
            resources: ['*'],
          }),
          new PolicyStatement({
            actions: ['dynamodb:GetItem'],
            resources: [props.params.configTableArn],
          }),
          new PolicyStatement({
            actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [
              feedbackTable.tableArn,
              `${feedbackTable.tableArn}/index/*`, // For GSI access
            ],
          }),
        ],
      }
    );
    azureDevOpsCredentialsSecret.grantRead(workItemAgentProxyFunction);

    const pollExecutionFunction = new TaskGenieLambda(this, 'PollExecution', {
      functionName: `${props.appName}-poll-execution-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/workflow/pollExecution/index.ts'
      ),
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

    const syncKnowledgeBaseFunction = new TaskGenieLambda(
      this,
      'SyncKnowledgeBase',
      {
        functionName: `${props.appName}-sync-knowledge-base-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/knowledgeBase/syncKnowledgeBase/index.ts'
        ),
        memorySize: 512,
        timeout: Duration.minutes(5),
        environment: {
          AWS_BEDROCK_KNOWLEDGE_BASE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
          AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
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
      }
    );
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
    dataSourceBucket.addEventNotification(
      EventType.OBJECT_REMOVED,
      new LambdaDestination(syncKnowledgeBaseFunction)
    );

    const generatePresignedUrlFunction = new TaskGenieLambda(
      this,
      'GeneratePresignedUrl',
      {
        functionName: `${props.appName}-generate-presigned-url-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/knowledgeBase/generatePresignedUrl/index.ts'
        ),
        memorySize: 384,
        timeout: Duration.seconds(5),
        environment: {
          S3_BUCKET_NAME: dataSourceBucket.bucketName,
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
      }
    );
    // Grant the Lambda function permission to generate a presigned URL for the S3 bucket
    dataSourceBucket.grantPut(generatePresignedUrlFunction);

    const listKnowledgeBaseDocumentsFunction = new TaskGenieLambda(
      this,
      'ListKnowledgeBaseDocuments',
      {
        functionName: `${props.appName}-list-knowledge-base-documents-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/knowledgeBase/listKnowledgeBaseDocuments/index.ts'
        ),
        memorySize: 512,
        timeout: Duration.seconds(30),
        environment: {
          S3_BUCKET_NAME: dataSourceBucket.bucketName,
          AWS_BEDROCK_KNOWLEDGE_BASE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
          AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        policyStatements: [
          new PolicyStatement({
            actions: [
              'bedrock:GetKnowledgeBase',
              'bedrock:ListKnowledgeBases',
              'bedrock:ListKnowledgeBaseDocuments',
            ],
            resources: ['*'],
          }),
        ],
      }
    );
    // Grant the Lambda function permission to read from the S3 bucket
    dataSourceBucket.grantRead(listKnowledgeBaseDocumentsFunction);

    const deleteKnowledgeBaseDocumentFunction = new TaskGenieLambda(
      this,
      'DeleteKnowledgeBaseDocument',
      {
        functionName: `${props.appName}-delete-knowledge-base-document-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/knowledgeBase/deleteKnowledgeBaseDocument/index.ts'
        ),
        memorySize: 512,
        timeout: Duration.minutes(3),
        environment: {
          S3_BUCKET_NAME: dataSourceBucket.bucketName,
          AWS_BEDROCK_KNOWLEDGE_BASE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
          AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID || '',
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        policyStatements: [
          new PolicyStatement({
            actions: [
              'bedrock:StartIngestionJob',
              'bedrock:GetIngestionJob',
              'bedrock:ListIngestionJobs',
            ],
            resources: ['*'],
          }),
        ],
      }
    );
    dataSourceBucket.grantDelete(deleteKnowledgeBaseDocumentFunction);
    dataSourceBucket.grantRead(deleteKnowledgeBaseDocumentFunction);

    // Update Config Lambda
    const updateConfigFunction = new TaskGenieLambda(this, 'UpdateConfig', {
      functionName: `${props.appName}-update-config-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/config/updateConfig/index.ts'
      ),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        CONFIG_TABLE_NAME: configTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    configTable.grantReadWriteData(updateConfigFunction);

    // List Config Lambda
    const listConfigFunction = new TaskGenieLambda(this, 'ListConfig', {
      functionName: `${props.appName}-list-config-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/config/listConfig/index.ts'
      ),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        CONFIG_TABLE_NAME: configTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    configTable.grantReadData(listConfigFunction);

    // Delete Config Lambda
    const deleteConfigFunction = new TaskGenieLambda(this, 'DeleteConfig', {
      functionName: `${props.appName}-delete-config-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/config/deleteConfig/index.ts'
      ),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        CONFIG_TABLE_NAME: configTable.tableName,
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    configTable.grantWriteData(deleteConfigFunction);

    // Feedback Tracking Lambda
    const trackTaskFeedbackFunction = new TaskGenieLambda(
      this,
      'TrackTaskFeedback',
      {
        functionName: `${props.appName}-track-task-feedback-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/feedback/trackTaskFeedback/index.ts'
        ),
        memorySize: 512,
        timeout: Duration.seconds(30),
        environment: {
          FEEDBACK_TABLE_NAME: feedbackTable.tableName,
          RESULTS_TABLE_NAME: resultsTable.tableName,
          FEEDBACK_FEATURE_ENABLED:
            process.env.FEEDBACK_FEATURE_ENABLED || 'false',
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        policyStatements: [
          new PolicyStatement({
            actions: [
              'dynamodb:PutItem',
              'dynamodb:GetItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
              'dynamodb:Scan',
            ],
            resources: [
              feedbackTable.tableArn,
              `${feedbackTable.tableArn}/index/*`, // For GSI access
              resultsTable.tableArn,
              `${resultsTable.tableArn}/index/*`, // For GSI access
            ],
          }),
        ],
      }
    );

    // Create CloudWatch Logs role for API Gateway
    const apiGatewayCloudWatchLogsRole = new Role(
      this,
      'ApiGatewayCloudWatchLogsRole',
      {
        assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonAPIGatewayPushToCloudWatchLogs'
          ),
        ],
      }
    );

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
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Amz-User-Agent',
        ],
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
      new LambdaIntegration(workItemAgentProxyFunction),
      {
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
      }
    );

    // Add method to list knowledge base documents
    //  GET /knowledge-base/documents
    const knowledgeBaseResource = api.root.addResource('knowledge-base');

    // Add method to generate a S3 presigned URL
    //  GET /knowledge-base/presigned-url
    const generatePresignedUrlResource =
      knowledgeBaseResource.addResource('presigned-url');
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
      new LambdaIntegration(listKnowledgeBaseDocumentsFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false, // No API key required for listing documents
      }
    );
    documentsResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteKnowledgeBaseDocumentFunction, {
        proxy: true,
      }),
      {
        apiKeyRequired: false,
      }
    );

    // Config API resource
    //  PUT /config
    const configResource = api.root.addResource('config');
    configResource.addMethod(
      'PUT',
      new LambdaIntegration(updateConfigFunction, { proxy: true }),
      {
        apiKeyRequired: false,
      }
    );
    configResource.addMethod(
      'GET',
      new LambdaIntegration(listConfigFunction, { proxy: true }),
      {
        apiKeyRequired: false,
      }
    );
    configResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteConfigFunction, { proxy: true }),
      {
        apiKeyRequired: false,
      }
    );

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
              'method.response.header.Access-Control-Allow-Methods':
                "'OPTIONS,POST'",
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
