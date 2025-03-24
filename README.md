# Task Genie

![architecture](/docs/architecture.png)

## Getting Started

### Pre-requisites

1. Create a PAT in AzureDevOps

### Deployment

1. Update the .env with the parameters

   ```
   AZURE_DEVOPS_PAT=
   AWS_BEDROCK_MODEL_ID=
   GITHUB_ORGANIZATION=
   GITHUB_REPOSITORY=
   ```

2. Install dependencies

   ```
   npm run install
   ```

3. Deploy the backend

   ```
   npm run deploy
   ```

### Post-setup (one-time)

1. Create 4 Service hooks in the ADO project setttings
