import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Choice,
  Condition,
  LogLevel,
  StateMachine,
  StateMachineType,
  TaskInput,
  Errors,
  Pass,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
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
  AwsIntegration,
  CfnAccount,
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
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { LogGroup, LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AppStackProps } from '../bin/task-genie';
import { TaskGenieLambda } from './constructs/lambda';

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export class AppStack extends Stack {
  public stateMachineArn: string;
  public evaluateWorkItemFunctionArn: string;
  public generateWorkItemsFunctionArn: string;
  public createWorkItemsFunctionArn: string;
  public addCommentFunctionArn: string;
  public finalizeResponseFunctionArn: string;
  public handleErrorFunctionArn: string;
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
     * AWS Lambda
     */

    const evaluateWorkItemFunction = new TaskGenieLambda(
      this,
      'EvaluateWorkItem',
      {
        functionName: `${props.appName}-evaluate-work-item-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/workflow/evaluateWorkItem/index.ts'
        ),
        memorySize: 1024,
        timeout: Duration.seconds(120),
        // vpc: removed to use default VPC with internet access
        environment: {
          AWS_ACCOUNT_ID: this.account,
          AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
          AWS_BEDROCK_KNOWLEDGE_BASE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
          AZURE_DEVOPS_CREDENTIALS_SECRET_NAME:
            azureDevOpsCredentialsSecretName,
          AZURE_DEVOPS_ORGANIZATION:
            process.env.AZURE_DEVOPS_ORGANIZATION || '',
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
        ],
        // interfaceEndpoints: removed since not using private VPC
      }
    );
    azureDevOpsCredentialsSecret.grantRead(evaluateWorkItemFunction);

    const generateWorkItemsFunction = new TaskGenieLambda(
      this,
      'GenerateWorkItems',
      {
        functionName: `${props.appName}-generate-work-items-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/workflow/generateWorkItems/index.ts'
        ),
        memorySize: 1024,
        timeout: Duration.seconds(300),
        // vpc: removed to use default VPC with internet access
        environment: {
          AWS_ACCOUNT_ID: this.account,
          AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
          AWS_BEDROCK_KNOWLEDGE_BASE_ID:
            process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
          AZURE_DEVOPS_CREDENTIALS_SECRET_NAME:
            azureDevOpsCredentialsSecretName,
          AZURE_DEVOPS_ORGANIZATION:
            process.env.AZURE_DEVOPS_ORGANIZATION || '',
          CONFIG_TABLE_NAME: props.params.configTableArn.split('/').pop() || '',
          FEEDBACK_TABLE_NAME: feedbackTable.tableName,
          FEEDBACK_FEATURE_ENABLED:
            process.env.FEEDBACK_FEATURE_ENABLED || 'false',
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
        ],
        policyStatements: [
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
        // interfaceEndpoints: removed since not using private VPC
      }
    );
    azureDevOpsCredentialsSecret.grantRead(generateWorkItemsFunction);

    const createWorkItemsFunction = new TaskGenieLambda(
      this,
      'CreateWorkItems',
      {
        functionName: `${props.appName}-create-work-items-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/workflow/createWorkItems/index.ts'
        ),
        memorySize: 1024,
        timeout: Duration.seconds(30),
        // vpc: removed to use default VPC with internet access
        environment: {
          AZURE_DEVOPS_CREDENTIALS_SECRET_NAME:
            azureDevOpsCredentialsSecretName,
          AZURE_DEVOPS_ORGANIZATION:
            process.env.AZURE_DEVOPS_ORGANIZATION || '',
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
        policyStatements: [
          new PolicyStatement({
            actions: ['cloudwatch:PutMetricData'],
            resources: ['*'],
          }),
        ],
        // interfaceEndpoints: removed since not using private VPC
      }
    );
    azureDevOpsCredentialsSecret.grantRead(createWorkItemsFunction);

    const addCommentFunction = new TaskGenieLambda(this, 'AddComment', {
      functionName: `${props.appName}-add-comment-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/workflow/addComment/index.ts'
      ),
      memorySize: 1024,
      timeout: Duration.seconds(10),
      // vpc: removed to use default VPC with internet access
      environment: {
        AZURE_DEVOPS_CREDENTIALS_SECRET_NAME: azureDevOpsCredentialsSecretName,
        AZURE_DEVOPS_ORGANIZATION: process.env.AZURE_DEVOPS_ORGANIZATION || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
      // interfaceEndpoints: removed since not using private VPC
    });
    azureDevOpsCredentialsSecret.grantRead(addCommentFunction);

    const finalizeResponseFunction = new TaskGenieLambda(
      this,
      'FinalizeResponse',
      {
        functionName: `${props.appName}-finalize-response-${props.envName}`,
        entry: path.resolve(
          __dirname,
          '../../backend/lambda/workflow/finalizeResponse/index.ts'
        ),
        memorySize: 256,
        timeout: Duration.seconds(3),
        environment: {
          AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
          TABLE_NAME: resultsTable.tableName,
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
        },
      }
    );
    resultsTable.grantWriteData(finalizeResponseFunction);

    // Error Handling Lambda
    const handleErrorFunction = new TaskGenieLambda(this, 'HandleError', {
      functionName: `${props.appName}-handle-error-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/workflow/handleError/index.ts'
      ),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        AZURE_DEVOPS_CREDENTIALS_SECRET_NAME: azureDevOpsCredentialsSecretName,
        AZURE_DEVOPS_ORGANIZATION: process.env.AZURE_DEVOPS_ORGANIZATION || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    azureDevOpsCredentialsSecret.grantRead(handleErrorFunction);

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

    // Get Work Item Lambda
    const getWorkItemFunction = new TaskGenieLambda(this, 'GetWorkItem', {
      functionName: `${props.appName}-get-work-item-${props.envName}`,
      entry: path.resolve(
        __dirname,
        '../../backend/lambda/workflow/getWorkItem/index.ts'
      ),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        AZURE_DEVOPS_CREDENTIALS_SECRET_NAME: azureDevOpsCredentialsSecretName,
        AZURE_DEVOPS_ORGANIZATION: process.env.AZURE_DEVOPS_ORGANIZATION || '',
        POWERTOOLS_LOG_LEVEL: 'DEBUG',
      },
    });
    azureDevOpsCredentialsSecret.grantRead(getWorkItemFunction);

    /*
     * AWS Step Functions
     */

    // Tasks
    const evaluateWorkItemTask = new LambdaInvoke(
      this,
      'EvaluateWorkItemTask',
      {
        lambdaFunction: evaluateWorkItemFunction,
        outputPath: '$.Payload',
      }
    );

    const generateWorkItemsTask = new LambdaInvoke(
      this,
      'GenerateWorkItemsTask',
      {
        lambdaFunction: generateWorkItemsFunction,
        outputPath: '$.Payload',
      }
    );

    const createWorkItemsTask = new LambdaInvoke(this, 'CreateWorkItemsTask', {
      lambdaFunction: createWorkItemsFunction,
      outputPath: '$.Payload',
    });

    const addCommentTask = new LambdaInvoke(this, 'AddCommentTask', {
      lambdaFunction: addCommentFunction,
      outputPath: '$.Payload',
    });

    const finalizeResponseTask = new LambdaInvoke(
      this,
      'FinalizeResponseTask',
      {
        lambdaFunction: finalizeResponseFunction,
        payload: TaskInput.fromObject({
          'body.$': '$.body',
          'statusCode.$': '$.statusCode',
          'executionArn.$': '$$.Execution.Id',
        }),
        outputPath: '$.Payload',
      }
    );

    // Create separate error handling tasks for each catch block
    const evaluateWorkItemErrorTask = new LambdaInvoke(
      this,
      'EvaluateWorkItemErrorTask',
      {
        lambdaFunction: handleErrorFunction,
        payload: TaskInput.fromObject({
          'resource.$': '$.resource',
          'Error.$': '$.Error',
          'Cause.$': '$.Cause',
          'errorStep.$': '$.errorStep',
        }),
        outputPath: '$.Payload',
      }
    ).next(finalizeResponseTask);

    const generateWorkItemsErrorTask = new LambdaInvoke(
      this,
      'GenerateWorkItemsErrorTask',
      {
        lambdaFunction: handleErrorFunction,
        payload: TaskInput.fromObject({
          'body.$': '$.body',
          'Error.$': '$.Error',
          'Cause.$': '$.Cause',
          'errorStep.$': '$.errorStep',
        }),
        outputPath: '$.Payload',
      }
    ).next(finalizeResponseTask);

    const createWorkItemsErrorTask = new LambdaInvoke(
      this,
      'CreateWorkItemsErrorTask',
      {
        lambdaFunction: handleErrorFunction,
        payload: TaskInput.fromObject({
          'body.$': '$.body',
          'Error.$': '$.Error',
          'Cause.$': '$.Cause',
          'errorStep.$': '$.errorStep',
        }),
        outputPath: '$.Payload',
      }
    ).next(finalizeResponseTask);

    const addCommentErrorTask = new LambdaInvoke(this, 'AddCommentErrorTask', {
      lambdaFunction: handleErrorFunction,
      payload: TaskInput.fromObject({
        'body.$': '$.body',
        'Error.$': '$.Error',
        'Cause.$': '$.Cause',
        'errorStep.$': '$.errorStep',
      }),
      outputPath: '$.Payload',
    }).next(finalizeResponseTask);

    // Add error handling to tasks with catch blocks
    const evaluateWorkItemTaskWithCatch = evaluateWorkItemTask.addCatch(
      new Pass(this, 'SetEvaluateWorkItemError', {
        parameters: {
          errorStep: 'Evaluate Work Item',
          'resource.$': '$.resource',
          'Error.$': '$.error.Error',
          'Cause.$': '$.error.Cause',
        },
      }).next(evaluateWorkItemErrorTask),
      {
        errors: [Errors.ALL],
        resultPath: '$.error',
      }
    );

    const generateWorkItemsTaskWithCatch = generateWorkItemsTask.addCatch(
      new Pass(this, 'SetGenerateWorkItemsError', {
        parameters: {
          errorStep: 'Generate Work Items',
          'body.$': '$.body',
          'Error.$': '$.error.Error',
          'Cause.$': '$.error.Cause',
        },
      }).next(generateWorkItemsErrorTask),
      {
        errors: [Errors.ALL],
        resultPath: '$.error',
      }
    );

    const createWorkItemsTaskWithCatch = createWorkItemsTask.addCatch(
      new Pass(this, 'SetCreateWorkItemsError', {
        parameters: {
          errorStep: 'Create Work Items',
          'body.$': '$.body',
          'Error.$': '$.error.Error',
          'Cause.$': '$.error.Cause',
        },
      }).next(createWorkItemsErrorTask),
      {
        errors: [Errors.ALL],
        resultPath: '$.error',
      }
    );

    const addCommentTaskWithCatch = addCommentTask.addCatch(
      new Pass(this, 'SetAddCommentError', {
        parameters: {
          errorStep: 'Add Comment',
          'body.$': '$.body',
          'Error.$': '$.error.Error',
          'Cause.$': '$.error.Cause',
        },
      }).next(addCommentErrorTask),
      {
        errors: [Errors.ALL],
        resultPath: '$.error',
      }
    );

    // State Machine Definition with error handling
    const definition = evaluateWorkItemTaskWithCatch.next(
      new Choice(this, 'Work item is defined?')
        .when(
          Condition.or(
            Condition.numberEquals('$.statusCode', 400),
            Condition.numberEquals('$.statusCode', 500)
          ),
          finalizeResponseTask
        )
        .when(
          Condition.or(
            Condition.numberEquals('$.statusCode', 204),
            Condition.numberEquals('$.statusCode', 412)
          ),
          new Choice(this, 'Add comment?')
            .when(
              Condition.numberGreaterThan('$.body.workItem.workItemId', 0),
              addCommentTaskWithCatch.next(finalizeResponseTask)
            )
            .otherwise(finalizeResponseTask)
        )
        .otherwise(
          generateWorkItemsTaskWithCatch.next(
            new Choice(this, 'Create task?')
              .when(
                Condition.numberEquals('$.statusCode', 500),
                finalizeResponseTask
              )
              .when(
                Condition.numberGreaterThan('$.body.workItem.workItemId', 0),
                createWorkItemsTaskWithCatch.next(addCommentTaskWithCatch)
              )
              .otherwise(finalizeResponseTask)
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
      logGroupName: `/aws/apigateway/${props.appName}-api-access-logs-${props.envName}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

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
  "name": "ado-#if($input.path('$.resource.workItemId') && $input.path('$.resource.workItemId') != '')$input.path('$.resource.workItemId')#elseif($input.path('$.resource.id') && $input.path('$.resource.id') != '')$input.path('$.resource.id')#else$context.requestId#end-rev-$input.path('$.resource.rev')",
  "stateMachineArn": "${stateMachine.stateMachineArn}"
}`,
        },
        integrationResponses: [
          {
            statusCode: '202',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods':
                "'OPTIONS,GET,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
              'method.response.header.Access-Control-Allow-Credentials':
                "'true'",
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
              'method.response.header.Access-Control-Allow-Methods':
                "'OPTIONS,GET,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
              'method.response.header.Access-Control-Allow-Credentials':
                "'true'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({ message: 'Bad request' }),
            },
          },
          {
            statusCode: '500',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods':
                "'OPTIONS,GET,POST'",
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
              'method.response.header.Access-Control-Allow-Credentials':
                "'true'",
            },
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Internal server error',
              }),
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

    // Work Item Details API resource (ADO)
    //  GET /work-items/{id}
    const workItemsResource = api.root.addResource('work-items');
    const workItemResource = workItemsResource.addResource('{id}');
    workItemResource.addMethod(
      'GET',
      new LambdaIntegration(getWorkItemFunction, { proxy: true }),
      {
        apiKeyRequired: true,
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
    this.evaluateWorkItemFunctionArn = evaluateWorkItemFunction.functionArn;
    this.generateWorkItemsFunctionArn = generateWorkItemsFunction.functionArn;
    this.createWorkItemsFunctionArn = createWorkItemsFunction.functionArn;
    this.addCommentFunctionArn = addCommentFunction.functionArn;
    this.finalizeResponseFunctionArn = finalizeResponseFunction.functionArn;
    this.handleErrorFunctionArn = handleErrorFunction.functionArn;
    this.trackTaskFeedbackFunctionArn = trackTaskFeedbackFunction.functionArn;
    this.apiGwAccessLogGroupArn = apiGwAccessLogGroup.logGroupArn;
    this.apiName = api.restApiName;
  }
}
