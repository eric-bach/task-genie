# Task Genie

Task Genie integrates directly in Azure DevOps Boards, utilizing AI services powered by Amazon Bedrock, to ensure the completeness of user stories and automatically breaks them down into actionable tasks, streamlining the Agile process and enhancing developer productivity.

## Features

1. User Story Validation

   - Ensures user stories follow best practices
   - Identifies missing components in user stories
   - Provides suggestions to improve clarity and completeness

2. Task Breakdown

   - Automatically decomposes validated user stories into smaller, actionable tasks
   - Ensures tasks align with agile methodologies for efficient development

3. Azure DevOps Boards integration

   - Supports integration with Azure DevOps Boards to automatically update work items and tasks

4. Powerful Insights

   - Built-in dashboards to visualize performance and effectiveness of task generation
   - Offers recommendations for improving workflows based on historical data
   - Detects potential bottlenecks or ambiguities in user stories

## Architecture

The architecture is deployed in AWS using a serverless model using AWS PrivateLink for private network communication between all AWS services. Integration with Azure DevOps is done through Service Hooks for each board.

![architecture](/docs/architecture.png)

A state machine, leveraging AWS Step Functions, orchestrates the workflow for the interaction with the LLM.

![state_machine](/docs/state_machine.png)

### Technology

|                                                                                                                                      |     Technology      |
| :----------------------------------------------------------------------------------------------------------------------------------: | :-----------------: |
|     <img height="30" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/aws.png">      | Amazon Web Services |
|   <img height="30" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/next_js.png">    |       Next.js       |
|  <img height="30" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/shadcn_ui.png">   |      ShadCn UI      |
| <img height="30" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/tailwind_css.png"> |    Tailwind CSS     |
|  <img height="30" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/typescript.png">  |     TypeScript      |

## Getting Started

### Pre-requisites

1. Create a PAT in AzureDevOps (until service principal is setup)

### Deployment

#### Backend

1. Update the `/backend/.env` file with the parameters:

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

3. Deploy the backend (default to observability2 AWS profile)

   ```
   npm run deploy
   ```

#### Frontend

The frontend is deployed using AWS Amplify.

To run the frontend locally:

1. Update the `/frontend/.env.local` file with the parameters from the backend deployment:

   ```
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=
   NEXT_PUBLIC_COGNITO_CLIENT_ID=
   NEXT_PUBLIC_API_GATEWAY_URL=
   NEXT_PUBLIC_API_GATEWAY_API_KEY=
   ```

2. Install dependencies

   ```
   npm run install
   ```

3. Run the frontend

   ```
   npm run dev
   ```

### Azure DevOps configuration (one-time, per board)

The integration with Azure DevOps leverages Service Hooks and requires 4 Service Hooks to be created for each Board.

- Work item created
- Work item updated (title)
- Work item updated (description)
- Work item updated (acceptance criteria)

![service_hooks](/docs/service_hooks.png)

1. In the Azure DevOps project, click on the gear to open the Project Settings

2. Click on Service hooks

3. Click the '+' plus sign to create a new Service Hook

4. Create four (4) Service Hooks with the following configuration:
   - **Trigger on this type of event:** work item created (1), work item updated (3)
   - **Area path:** the name of the Azure DevOps project to configure
   - **Work item type:** User Story
   - **URL:** the API Gateway URL from the backend deployment
   - **HTTP headers:** Set this to x-api-key:<the API Gateway API Key from the backend deployment>

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
