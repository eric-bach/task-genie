import { Duration, Stack } from 'aws-cdk-lib';
import { IInterfaceVpcEndpoint, IVpc, Port } from 'aws-cdk-lib/aws-ec2';
import { IManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, ILayerVersion, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogRetention, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import * as path from 'path';

export interface TaskGenieLambdaProps {
  functionName: string;
  projectRoot?: string;
  entry: string;
  handler?: string;
  runtime?: Runtime;
  architecture?: Architecture;
  layers?: ILayerVersion[];
  memorySize?: number;
  timeout?: Duration;
  vpc?: IVpc;
  logRetention?: RetentionDays;
  bundling?: {
    externalModules?: string[];
  };
  environment?: { [key: string]: string };
  managedPolicies?: IManagedPolicy[];
  policyStatements?: PolicyStatement[];
  interfaceEndpoints?: IInterfaceVpcEndpoint[];
}

export class TaskGenieLambda extends NodejsFunction {
  constructor(scope: Construct, id: string, props: TaskGenieLambdaProps) {
    const powertoolsLayer = LayerVersion.fromLayerVersionArn(
      scope,
      `${id}PowertoolsLayer`,
      `arn:aws:lambda:${Stack.of(scope).region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:20`
    );

    // Set default values
    const projectRoot = props.projectRoot ?? path.resolve(__dirname, '../../..');
    const handler = props.handler ?? 'handler';
    const runtime = props.runtime ?? Runtime.NODEJS_22_X;
    const architecture = props.architecture ?? Architecture.X86_64;
    const layers = props.layers ?? [powertoolsLayer];
    const memorySize = props.memorySize ?? 256;
    const timeout = props.timeout ?? Duration.seconds(10);
    const vpc = props.vpc;
    const environment = props.environment ?? {};
    const logRetention = props.logRetention ?? RetentionDays.ONE_MONTH;
    const bundling = props.bundling ?? {
      externalModules: ['@aws-lambda-powertools/*', '@aws-sdk/*'],
    };

    super(scope, id, {
      functionName: props.functionName,
      projectRoot: projectRoot,
      entry: props.entry,
      handler,
      runtime,
      architecture,
      layers,
      memorySize,
      timeout,
      vpc,
      environment,
      logRetention,
      bundling,
    });

    // Configure log retention
    new LogRetention(this, `${props.functionName}LogRetention`, {
      logGroupName: `/aws/lambda/${this.functionName}`,
      retention: RetentionDays.ONE_MONTH,
    });

    // Add permissions
    for (const managedPolicy of props.managedPolicies ?? []) {
      this.role?.addManagedPolicy(managedPolicy);
    }
    for (const policyStatement of props.policyStatements ?? []) {
      this.addToRolePolicy(policyStatement);
    }

    // Add VPC interface endpoints
    for (const interfaceEndpoint of props.interfaceEndpoints ?? []) {
      interfaceEndpoint.connections.allowFrom(this, Port.tcp(443));
    }
  }
}
