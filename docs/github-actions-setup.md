# GitHub Actions Deployment Setup

This guide will help you set up GitHub Actions to automatically deploy your Task Genie infrastructure to AWS.

## Prerequisites

1. AWS CLI configured with administrative permissions
2. Node.js 20+ installed
3. GitHub repository with the code

## Setup Steps

### 1. Deploy GitHub Actions Infrastructure

The GitHub Actions OIDC provider and IAM role are automatically deployed when you run the standard deployment command:

```bash
cd infrastructure
npm run deploy
```

This will deploy all stacks including:

- AWS OIDC provider for GitHub Actions
- IAM role with necessary permissions for CDK deployment
- Your application infrastructure (data, app, observability stacks)
- Output with the role ARN you'll need for GitHub

**Note:** The GitHub Actions infrastructure is only deployed in the staging environment to avoid duplication.

### 2. Configure GitHub Repository

#### Create Environments

1. Go to your GitHub repository
2. Navigate to **Settings** → **Environments**
3. Create two environments:
   - `staging`
   - `production`

#### Add Secrets

For each environment, add the following secrets under **Settings** → **Secrets and variables** → **Actions**:

**Required Secrets:**

- `AWS_ROLE_ARN`: The role ARN from the CDK output (step 1)
- `AZURE_DEVOPS_PROJECT`: Your Azure DevOps project name
- `AZURE_DEVOPS_TENANT_ID`: Azure tenant ID
- `AZURE_DEVOPS_CLIENT_ID`: Azure client ID
- `AZURE_DEVOPS_CLIENT_SECRET`: Azure client secret
- `AZURE_DEVOPS_SCOPE`: Azure DevOps scope
- `AWS_BEDROCK_MODEL_ID`: Bedrock model ID

**Environment-Specific Secrets:**

For **staging** environment:

- `AWS_BEDROCK_KNOWLEDGE_BASE_ID`
- `AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID`

For **production** environment:

- `AWS_BEDROCK_KNOWLEDGE_BASE_ID`
- `AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID`

### 3. Test the Setup

1. Push a commit to the `main` branch
2. Check the **Actions** tab in GitHub to see the staging deployment
3. For production deployment, go to **Actions** → **Deploy to Production** → **Run workflow**

## Workflows

### CI Pipeline (`ci.yml`)

- Runs on every pull request and push
- Builds and tests the code
- Validates CloudFormation templates
- Runs security scans

### Staging Deployment (`deploy-staging.yml`)

- Automatically deploys to staging on `main` branch pushes
- Can also be triggered manually

### Production Deployment (`deploy-production.yml`)

- Manual deployment only
- Requires typing "DEPLOY" for confirmation
- Uses production environment protection rules

## Security Considerations

1. **Environment Protection**: Consider adding environment protection rules in GitHub for the production environment
2. **Required Reviewers**: Add required reviewers for production deployments
3. **Branch Protection**: Protect the `main` branch with required status checks
4. **Secret Rotation**: Regularly rotate AWS and Azure credentials

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure the GitHub Actions role has sufficient permissions
2. **Bootstrap Issues**: Make sure CDK is bootstrapped in your AWS account/region
3. **Environment Variables**: Verify all required secrets are set in GitHub

### Getting Help

- Check the GitHub Actions logs for detailed error messages
- Verify AWS CloudTrail for permission issues
- Ensure your AWS account has the necessary service limits

## Customization

### Different AWS Regions

Update the `AWS_REGION` environment variable in the workflow files:

```yaml
env:
  AWS_REGION: us-west-2 # Change to your preferred region
```

### Additional Environments

To add more environments (e.g., `dev`):

1. Create the environment in GitHub
2. Add a new workflow file
3. Update the CDK context in the workflow
