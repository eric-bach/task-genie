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

## Refining the AI Prompt

1. Edit the prompts and inputs in `bedrock/evaluateTasks.ts` and `bedrock/defineTasks.ts`

2. Run the following commands to run the scripts to test the prompts and inputs in order to refine the prompt

   ```
   npm run bedrock:evaluateTasks
   npm run bedrock:defineTasks
   ```

## References

https://www.youtube.com/watch?v=POn5WYFw4xU
https://github.com/aws-samples/genai-for-devops/tree/main/automating-kanban-workflows
