#!/usr/bin/env node
import { App, StackProps } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { DataStack } from '../lib/data-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

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
    resultsTableArn: string;
    dataSourceBucketArn: string;
    azurePersonalAccessToken: StringParameter;
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
  };
}

const app = new App();

const APP_NAME = 'task-genie';
const ENV_NAME = app.node.tryGetContext('envName') || 'dev';

const baseProps: BaseStackProps = {
  appName: APP_NAME,
  envName: ENV_NAME,
  tags: {
    environment: ENV_NAME,
    application: APP_NAME,
  },
};

const dataProps = new DataStack(app, `${APP_NAME}-data`, {
  ...baseProps,
});

const appProps = new AppStack(app, `${APP_NAME}-app`, {
  ...baseProps,
  params: {
    // vpc: dataProps.vpc,
    // cloudwatchVpcEndpointId: dataProps.cloudwatchVpcEndpointId,
    // bedrockVpcEndpointId: dataProps.bedrockVpcEndpointId,
    // bedrockAgentVpcEndpointId: dataProps.bedrockAgentVpcEndpointId,
    // ssmVpcEndpointId: dataProps.ssmVpcEndpointId,
    resultsTableArn: dataProps.resultsTableArn,
    dataSourceBucketArn: dataProps.dataSourceBucketArn,
    azurePersonalAccessToken: dataProps.azurePersonalAccessToken,
  },
});

new ObservabilityStack(app, `${APP_NAME}-observability`, {
  ...baseProps,
  params: {
    stateMachineArn: appProps.stateMachineArn,
    evaluateUserStoryFunctionArn: appProps.evaluateUserStoryFunctionArn,
    defineTasksFunctionArn: appProps.defineTasksFunctionArn,
    createTasksFunctionArn: appProps.createTasksFunctionArn,
    addCommentFunctionArn: appProps.addCommentFunctionArn,
    sendResponseFunctionArn: appProps.sendResponseFunctionArn,
    apiGwAccessLogGroupArn: appProps.apiGwAccessLogGroupArn,
  },
});
