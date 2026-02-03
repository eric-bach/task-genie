#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { App, StackProps } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { DataStack } from '../lib/data-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { GitHubActionsStack } from '../lib/github-actions-stack';
import { DocsStack } from '../lib/docs-stack';

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
  extensionId?: string;
  params: {
    configTableArn: string;
    resultsTableArn: string;
    dataSourceBucketArn: string;
    azureDevOpsCredentialsSecretName: string;
  };
}
export interface ObservabilityStackProps extends BaseStackProps {
  params: {
    stateMachineArn: string;
    evaluateWorkItemFunctionArn: string;
    generateWorkItemsFunctionArn: string;
    createWorkItemsFunctionArn: string;
    addCommentFunctionArn: string;
    finalizeResponseFunctionArn: string;
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

if (ENV_NAME === 'stage' || ENV_NAME === 'prod') {
  new GitHubActionsStack(app, `${APP_NAME}-github-actions-${ENV_NAME}`, {
    ...baseProps,
    appName: APP_NAME,
    gitHubRepo: 'eric-bach/task-genie',
  });

  new DocsStack(app, `${APP_NAME}-docs-${ENV_NAME}`, {
    ...baseProps,
  });
}

const dataProps = new DataStack(app, `${APP_NAME}-data-${ENV_NAME}`, {
  ...baseProps,
});

const appProps = new AppStack(app, `${APP_NAME}-app-${ENV_NAME}`, {
  ...baseProps,
  params: {
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
    evaluateWorkItemFunctionArn: appProps.evaluateWorkItemFunctionArn,
    generateWorkItemsFunctionArn: appProps.generateWorkItemsFunctionArn,
    createWorkItemsFunctionArn: appProps.createWorkItemsFunctionArn,
    addCommentFunctionArn: appProps.addCommentFunctionArn,
    finalizeResponseFunctionArn: appProps.finalizeResponseFunctionArn,
    apiGwAccessLogGroupArn: appProps.apiGwAccessLogGroupArn,
    apiName: appProps.apiName,
  },
});
