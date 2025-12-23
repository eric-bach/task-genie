import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
  PolicyStatement,
  Role,
  ServicePrincipal,
  ManagedPolicy,
} from 'aws-cdk-lib/aws-iam';
import {
  AgentRuntimeArtifact,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { AgentStackProps } from '../bin/task-genie';

import * as path from 'path';
import * as dotenv from 'dotenv';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';

dotenv.config();

export class AgentStack extends Stack {
  /**
   * Constructs a new instance of the Task Genie AgentStack.
   *
   * @param scope - The scope in which this stack is defined.
   * @param id - The scoped ID of the stack.
   * @param props - Stack properties.
   */
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

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
  }
}
