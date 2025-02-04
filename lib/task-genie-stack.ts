import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import path = require('path');
import * as dotenv from 'dotenv';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

dotenv.config();

export class TaskGenieStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const azureDevOpsPat = new ssm.StringParameter(this, 'AzureDevOpsPAT', {
      parameterName: '/task-genie/azure-devops-pat',
      stringValue: process.env.AZURE_DEVOPS_PAT || '',
      description: 'Azure DevOps Personal Access Token',
    });

    const evaluateTasksFunction = new NodejsFunction(this, 'EvaluateTasks', {
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: 'task-genie-evaluate-tasks',
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/evaluateTasks/index.ts'),
      memorySize: 768,
      timeout: cdk.Duration.seconds(60),
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
      },
    });
    evaluateTasksFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${process.env.AWS_BEDROCK_MODEL_ID}`],
      })
    );

    const defineTasksFunction = new NodejsFunction(this, 'DefineTasks', {
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: 'task-genie-define-tasks',
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/defineTasks/index.ts'),
      memorySize: 768,
      timeout: cdk.Duration.seconds(60),
      environment: {
        AWS_BEDROCK_MODEL_ID: process.env.AWS_BEDROCK_MODEL_ID || '',
        AZURE_DEVOPS_PAT_PARAMETER_NAME: azureDevOpsPat.parameterName,
      },
    });
    azureDevOpsPat.grantRead(defineTasksFunction);
    defineTasksFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${process.env.AWS_BEDROCK_MODEL_ID}`],
      })
    );

    // Step Function tasks
    const evaluateTasksTask = new tasks.LambdaInvoke(this, 'EvaluateTasksTask', {
      lambdaFunction: evaluateTasksFunction,
      outputPath: '$.Payload',
    });

    const defineTasksTask = new tasks.LambdaInvoke(this, 'DefineTasksTask', {
      lambdaFunction: defineTasksFunction,
      outputPath: '$.Payload',
    });

    // Step Function definition
    const definition = evaluateTasksTask.next(defineTasksTask);

    // Step Function
    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    const reviewUserStory = new NodejsFunction(this, 'ReviewUserStory', {
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: 'task-genie-review-user-story',
      handler: 'handler',
      entry: path.resolve(__dirname, '../src/lambda/reviewUserStory/index.ts'),
      memorySize: 384,
      timeout: cdk.Duration.seconds(10),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });

    const reviewUserStoryFunctionUrl = reviewUserStory.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Grant the reviewUserStory function permissions to start the Step Function execution
    stateMachine.grantStartExecution(reviewUserStory);

    // Outputs
    new cdk.CfnOutput(this, 'ReviewUserStoryFunctionUrl', {
      value: reviewUserStoryFunctionUrl.url,
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
    });
  }
}
