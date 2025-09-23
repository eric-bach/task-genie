#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { App, StackProps } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { DataStack } from '../lib/data-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { GitHubActionsStack } from '../lib/github-actions-stack';
import { DocsStack } from '../lib/docs-stack';
// import { IVpc } from 'aws-cdk-lib/aws-ec2';

// Load environment variables
dotenv.config();

export interface BaseStackProps extends StackProps {
  appName: string;
  envName: string;
  tags: {
    environment: string;
    application: string;
  };
}
export interface DataStackProps extends BaseStackProps {}
export interface AppStackProps extends BaseStackProps {
  params: {
    // vpc: IVpc;
    // cloudwatchVpcEndpointId: string;
    // bedrockVpcEndpointId: string;
    // bedrockAgentVpcEndpointId: string;
    // ssmVpcEndpointId: string;
    configTableArn: string;
    resultsTableArn: string;
    dataSourceBucketArn: string;
    azureDevOpsCredentialsSecretName: string;
  };
}
export interface ObservabilityStackProps extends BaseStackProps {
  params: {
    stateMachineArn: string;
    evaluateUserStoryFunctionArn: string;
    defineTasksFunctionArn: string;
    createTasksFunctionArn: string;
    addCommentFunctionArn: string;
    sendResponseFunctionArn: string;
    apiGwAccessLogGroupArn: string;
    apiName: string;
  };
}

const app = new App();

const APP_NAME = 'task-genie';
const ENV_NAME = app.node.tryGetContext('envName') || 'stage';

const baseProps: BaseStackProps = {
  appName: APP_NAME,
  envName: ENV_NAME,
  tags: {
    environment: ENV_NAME,
    application: APP_NAME,
  },
};

new GitHubActionsStack(app, `${APP_NAME}-github-actions-${ENV_NAME}`, {
  ...baseProps,
  appName: APP_NAME,
  gitHubRepo: 'eric-bach/task-genie',
});

const dataProps = new DataStack(app, `${APP_NAME}-data-${ENV_NAME}`, {
  ...baseProps,
});

const appProps = new AppStack(app, `${APP_NAME}-app-${ENV_NAME}`, {
  ...baseProps,
  params: {
    // vpc: dataProps.vpc,
    // cloudwatchVpcEndpointId: dataProps.cloudwatchVpcEndpointId,
    // bedrockVpcEndpointId: dataProps.bedrockVpcEndpointId,
    // bedrockAgentVpcEndpointId: dataProps.bedrockAgentVpcEndpointId,
    // ssmVpcEndpointId: dataProps.ssmVpcEndpointId,
    configTableArn: dataProps.configTableArn,
    resultsTableArn: dataProps.resultsTableArn,
    dataSourceBucketArn: dataProps.dataSourceBucketArn,
    azureDevOpsCredentialsSecretName: dataProps.azureDevOpsCredentialsSecretName,
  },
});

new ObservabilityStack(app, `${APP_NAME}-observability-${ENV_NAME}`, {
  ...baseProps,
  params: {
    stateMachineArn: appProps.stateMachineArn,
    evaluateUserStoryFunctionArn: appProps.evaluateUserStoryFunctionArn,
    defineTasksFunctionArn: appProps.defineTasksFunctionArn,
    createTasksFunctionArn: appProps.createTasksFunctionArn,
    addCommentFunctionArn: appProps.addCommentFunctionArn,
    sendResponseFunctionArn: appProps.sendResponseFunctionArn,
    apiGwAccessLogGroupArn: appProps.apiGwAccessLogGroupArn,
    apiName: appProps.apiName,
  },
});

// Documentation Stack
new DocsStack(app, `${APP_NAME}-docs-${ENV_NAME}`, {
  ...baseProps,
  params: {
    domainName: process.env.DOCS_DOMAIN_NAME || app.node.tryGetContext('domainName'),
    certificateArn: process.env.AWS_CERTIFICATE_ARN || app.node.tryGetContext('certificateArn'),
  },
});
