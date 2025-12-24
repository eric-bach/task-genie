import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import {
  Bucket,
  BucketEncryption,
  CfnBucket,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { DataStackProps } from '../bin/task-genie';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as dotenv from 'dotenv';
import { CfnIndex, CfnVectorBucket } from 'aws-cdk-lib/aws-s3vectors';

dotenv.config();

export class DataStack extends Stack {
  public configTableArn: string;
  public resultsTableArn: string;
  public feedbackTableArn: string;
  public dataSourceBucketArn: string;
  public azureDevOpsCredentialsSecretName: string;

  /**
   * Constructs a new instance of the Task Genie DataStack.
   *
   * This stack sets up the stateful resources for the Task Genie application, including:
   * - Cognito User Pool for user authenticatapion and management.
   * - DynamoDB table for storing evaluation results.
   * - S3 bucket for storing knowledge base documents.
   * - VPC and VPC endpoints for networking.
   *
   * @param scope - The scope in which this stack is defined.
   * @param id - The scoped ID of the stack.
   * @param props - Stack properties.
   */
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    /*
     * Amazon Cognito
     */

    const userPool = new UserPool(this, 'CognitoUserPool', {
      userPoolName: `${props.appName}-users-${props.envName}`,
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

    new UserPoolDomain(this, 'CognitoUserPoolDomain', {
      userPool: userPool,
      cognitoDomain: {
        domainPrefix: `${props.appName}-${props.envName}`,
      },
    });

    const userPoolClient = new UserPoolClient(this, 'CognitoUserClient', {
      userPoolClientName: `${props.appName}-user-client-${props.envName}`,
      accessTokenValidity: Duration.hours(4),
      idTokenValidity: Duration.hours(4),
      userPool,
    });

    /*
     * Amazon DynamoDB
     */

    const configTable = new Table(this, 'ConfigurationTable', {
      tableName: `${props.appName}-config-${props.envName}`,
      partitionKey: {
        name: 'adoKey',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    const resultsTable = new Table(this, 'EvaluationResultsTable', {
      tableName: `${props.appName}-results-${props.envName}`,
      partitionKey: {
        name: 'executionId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying results by work item Ids
    resultsTable.addGlobalSecondaryIndex({
      indexName: 'workItemId-timestamp-index',
      partitionKey: {
        name: 'workItemId',
        type: AttributeType.NUMBER,
      },
      sortKey: {
        name: 'timestamp',
        type: AttributeType.STRING,
      },
    });

    // Task Feedback table for AI learning and improvement
    const feedbackTable = new Table(this, 'TaskFeedbackTable', {
      tableName: `${props.appName}-feedback-${props.envName}`,
      partitionKey: {
        name: 'feedbackId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying feedback by work item
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'workItemId-timestamp-index',
      partitionKey: {
        name: 'workItemId',
        type: AttributeType.NUMBER,
      },
      sortKey: {
        name: 'timestamp',
        type: AttributeType.STRING,
      },
    });

    // GSI for querying feedback by task ID
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'taskId-timestamp-index',
      partitionKey: {
        name: 'taskId',
        type: AttributeType.NUMBER,
      },
      sortKey: {
        name: 'timestamp',
        type: AttributeType.STRING,
      },
    });

    // GSI for querying feedback by context key
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'contextKey-timestamp-index',
      partitionKey: {
        name: 'contextKey',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: AttributeType.STRING,
      },
    });

    /*
     * Amazon S3 Buckets
     */

    // Used for the Knowledge Base documents
    const dataSourceBucket = new Bucket(this, 'KnowledgeBaseDataSource', {
      bucketName: `${props.appName}-data-source-${props.envName}`,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: BucketEncryption.S3_MANAGED,
    });
    dataSourceBucket.addCorsRule({
      allowedMethods: [HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000,
    });

    const vectorStoreBucket = new CfnVectorBucket(
      this,
      'KnowledgeBaseVectorStoreBucket',
      {
        vectorBucketName: `${props.appName}-vector-store-${props.envName}`,
        encryptionConfiguration: {
          sseType: 'AES256',
        },
      }
    );
    // const vectorIndex = new CfnIndex(this, 'KnowledgeBaseVectorIndex', {
    //   indexName: `${props.appName}-vector-index-${props.envName}`,
    //   vectorBucketName: vectorStoreBucket.vectorBucketName, // The CfnVectorBucket from before
    //   dataType: 'float32',
    //   dimension: 1024, // REQUIRED: Titan Text Embeddings v2 is 1024
    //   distanceMetric: 'cosine', // Recommended for Titan embeddings
    // });

    /*
     * Amazon Bedrock Knowledge Base
     */

    // Knowledge Base Service Role
    const knowledgeBaseRole = new Role(
      this,
      'BedrockKnowledgeBaseServiceRole',
      {
        roleName: `${props.appName}-bedrock-knowledge-base-role-${props.envName}`,
        assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account,
            },
            ArnLike: {
              'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
            },
          },
        }),
      }
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${dataSourceBucket.bucketArn}/*`],
      })
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [dataSourceBucket.bucketArn],
      })
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: [
          's3vectors:GetIndex',
          's3vectors:QueryVectors',
          's3vectors:PutVectors',
          's3vectors:GetVectors',
          's3vectors:DeleteVectors',
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorStoreBucket.vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorStoreBucket.vectorBucketName}/*`,
        ],
      })
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:DeleteObject',
        ],
        resources: [
          `arn:aws:s3:::${vectorStoreBucket.vectorBucketName}`,
          `arn:aws:s3:::${vectorStoreBucket.vectorBucketName}/*`,
        ],
      })
    );
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        actions: ['bedrock:GetInferenceProfile', 'bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*'],
      })
    );

    const knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: `${props.appName}-knowledge-base-${props.envName}`,
      description: 'Knowledge base for Task Genie application',
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          vectorBucketArn: vectorStoreBucket.attrVectorBucketArn,
          // indexArn: vectorIndex.attrIndexArn,
          // indexName: vectorIndex.indexName,
        },
      },
    });
    knowledgeBase.node.addDependency(knowledgeBaseRole);
    // knowledgeBase.node.addDependency(vectorIndex);

    const knowledgeBaseDataSource = new CfnDataSource(
      this,
      'S3KnowledgeBaseDataSource',
      {
        knowledgeBaseId: knowledgeBase.ref,
        name: `${props.appName}-data-source-${props.envName}`,
        description: 'S3 Data Source for Task Genie Knowledge Base',
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn: dataSourceBucket.bucketArn,
          },
        },
        vectorIngestionConfiguration: {
          chunkingConfiguration: {
            chunkingStrategy: 'SEMANTIC',
            semanticChunkingConfiguration: {
              breakpointPercentileThreshold: 90,
              bufferSize: 1,
              maxTokens: 512,
            },
          },
        },
      }
    );

    /*
     * AWS Secrets Manager
     */

    const azureDevOpsCredentials = new Secret(this, 'AzureDevOpsCredentials', {
      secretName: `${props.appName}/${props.envName}/azure-devops-credentials`,
      description: 'Azure DevOps OAuth credentials',
      secretObjectValue: {
        tenantId: SecretValue.unsafePlainText(
          process.env.AZURE_DEVOPS_TENANT_ID || ''
        ),
        clientId: SecretValue.unsafePlainText(
          process.env.AZURE_DEVOPS_CLIENT_ID || ''
        ),
        clientSecret: SecretValue.unsafePlainText(
          process.env.AZURE_DEVOPS_CLIENT_SECRET || ''
        ),
        scope: SecretValue.unsafePlainText(
          process.env.AZURE_DEVOPS_SCOPE || ''
        ),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /*
     * Outputs
     */

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      exportName: `${props.appName}-cognito-user-pool-id-${props.envName}`,
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      exportName: `${props.appName}-cognito-user-pool-client-id-${props.envName}`,
    });

    new CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.ref,
      exportName: `${props.appName}-knowledge-base-id-${props.envName}`,
    });

    new CfnOutput(this, 'KnowledgeBaseDataSourceId', {
      value: knowledgeBaseDataSource.ref,
      exportName: `${props.appName}-knowledge-base-data-source-id-${props.envName}`,
    });

    /*
     * Properties
     */

    this.configTableArn = configTable.tableArn;
    this.resultsTableArn = resultsTable.tableArn;
    this.feedbackTableArn = feedbackTable.tableArn;
    this.dataSourceBucketArn = dataSourceBucket.bucketArn;
    this.azureDevOpsCredentialsSecretName = azureDevOpsCredentials.secretName;
  }
}
