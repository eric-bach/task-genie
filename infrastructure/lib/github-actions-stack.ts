import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Effect,
  ManagedPolicy,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';

export interface GitHubActionsStackProps extends StackProps {
  appName: string;
  gitHubRepo: string; // format: "owner/repository"
}

export class GitHubActionsStack extends Stack {
  public readonly gitHubActionsRole: Role;

  constructor(scope: Construct, id: string, props: GitHubActionsStackProps) {
    super(scope, id, props);

    // OIDC Provider for GitHub Actions
    const gitHubOidcProvider = new OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1', '1c58a3a8518e8759bf075b76b750d4f2df264fcd'],
    });

    // IAM Role for GitHub Actions
    this.gitHubActionsRole = new Role(this, 'GitHubActionsRole', {
      roleName: `${props.appName}-github-actions-role`,
      assumedBy: new WebIdentityPrincipal(gitHubOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.gitHubRepo}:ref:refs/heads/main`,
            `repo:${props.gitHubRepo}:ref:refs/heads/develop`,
            `repo:${props.gitHubRepo}:environment:staging`,
            `repo:${props.gitHubRepo}:environment:production`,
          ],
        },
      }),
      description: 'Role for GitHub Actions to deploy infrastructure',
      maxSessionDuration: Duration.hours(1),
    });

    // Policies for CDK deployment
    this.gitHubActionsRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess'));

    // Additional permissions for IAM operations (needed for CDK)
    this.gitHubActionsRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:UpdateRole',
          'iam:GetRole',
          'iam:ListRoles',
          'iam:PassRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:GetRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          'iam:CreateInstanceProfile',
          'iam:DeleteInstanceProfile',
          'iam:GetInstanceProfile',
          'iam:AddRoleToInstanceProfile',
          'iam:RemoveRoleFromInstanceProfile',
          'iam:ListInstanceProfiles',
          'iam:ListInstanceProfilesForRole',
          'sts:TagSession',
        ],
        resources: ['*'],
      })
    );

    // CDK specific permissions
    this.gitHubActionsRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudformation:*', 'ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: ['*'],
      })
    );

    // Output the role ARN for GitHub Actions configuration
    new CfnOutput(this, 'GitHubActionsRoleArn', {
      value: this.gitHubActionsRole.roleArn,
      description: 'ARN of the IAM role for GitHub Actions',
      exportName: `${props.appName}-github-actions-role-arn`,
    });
  }
}
