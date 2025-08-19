import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AccountRecovery, UserPool, UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import { Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { IpAddresses, IVpc, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { DataStackProps } from '../bin/task-genie';
import * as dotenv from 'dotenv';

dotenv.config();

export class DataStack extends Stack {
  public vpc: IVpc;
  public cloudwatchVpcEndpointId: string;
  public bedrockVpcEndpointId: string;
  public bedrockAgentVpcEndpointId: string;
  public ssmVpcEndpointId: string;
  public resultsTableArn: string;
  public dataSourceBucketArn: string;
  public azurePersonalAccessToken: StringParameter;

  /**
   * Constructs a new instance of the Task Genie DataStack.
   *
   * This stack sets up the stateful resources for the Task Genie application, including:
   * - Cognito User Pool for user authentication and management.
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
        domainPrefix: `${props.appName}`,
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

    const resultsTable = new Table(this, 'EvaluationResultsTable', {
      tableName: `${props.appName}-results-${props.envName}`,
      partitionKey: {
        name: 'executionName',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
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
    });
    dataSourceBucket.addCorsRule({
      allowedMethods: [HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000,
    });

    /*
     * Tokens (until an Azure Service Principal is setup)
     */

    const azurePersonalAccessToken = new StringParameter(this, 'AzureDevOpsPersonalAccessToken', {
      parameterName: `/${props.appName}/${props.envName}/azure-devops-personal-access-token`,
      stringValue: process.env.AZURE_DEVOPS_PERSONAL_ACCESS_TOKEN || '',
      description: 'Azure DevOps Personal Access Token',
    });

    /*
     * AWS VPC
     */

    const vpc = new Vpc(this, 'TaskGenieVPC', {
      ipAddresses: IpAddresses.cidr('10.1.0.0/16'),
      natGateways: 1,
      maxAzs: 1,
      subnetConfiguration: [
        {
          cidrMask: 25,
          name: `Public Subnet - ${props.appName}`,
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 25,
          name: `Private Subnet - ${props.appName}`,
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      restrictDefaultSecurityGroup: true,
    });

    // Interface VPC endpoint for CloudWatch Metrics
    const cloudwatchEndpoint = vpc.addInterfaceEndpoint('CloudWatchEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.monitoring`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Interface VPC endpoint for Amazon Bedrock
    const bedrockEndpoint = vpc.addInterfaceEndpoint('BedrockEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.bedrock-runtime`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    const bedrockAgentEndpoint = vpc.addInterfaceEndpoint('BedrockAgentEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.bedrock-agent-runtime`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Interface VPC endpoint for SSM Parameter Store
    const ssmEndpoint = vpc.addInterfaceEndpoint('SSMEndpoint', {
      service: {
        name: `com.amazonaws.${this.region}.ssm`,
        port: 443,
      },
      subnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    /*
     * Outputs
     */

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      exportName: `${props.appName}-cognito-user-pool-id`,
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      exportName: `${props.appName}-cognito-user-pool-client-id`,
    });

    /*
     * Properties
     */

    this.vpc = vpc;
    this.cloudwatchVpcEndpointId = cloudwatchEndpoint.vpcEndpointId;
    this.bedrockVpcEndpointId = bedrockEndpoint.vpcEndpointId;
    this.bedrockAgentVpcEndpointId = bedrockAgentEndpoint.vpcEndpointId;
    this.ssmVpcEndpointId = ssmEndpoint.vpcEndpointId;
    this.resultsTableArn = resultsTable.tableArn;
    this.dataSourceBucketArn = dataSourceBucket.bucketArn;
    this.azurePersonalAccessToken = azurePersonalAccessToken;
  }
}
