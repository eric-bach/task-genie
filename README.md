# Task Genie

<div style="display: flex; align-items: center;">
   <img src="docs/logo.jpg" alt="Task Genie" width="60" style="margin-right: 10px;">
   <span>Task Genie integrates directly in Azure DevOps Boards, utilizing AI services powered by Amazon Bedrock, to ensure the completeness of user stories and automatically breaks them down into actionable tasks, streamlining the Agile process and enhancing developer productivity.
</span>
</div>

## Features

1. User Story Validation

   - Ensures user stories follow best practices
   - Identifies missing components in user stories
   - Provides suggestions to improve clarity and completeness
   - NEW: Uses RAG to support additional context like tech details, domain context, application knowledge, etc.

2. Task Breakdown

   - Automatically decomposes validated user stories into smaller, actionable tasks
   - Ensures tasks align with agile methodologies for efficient development
   - ![ui](docs/ui.png)

3. Azure DevOps Boards integration

   - Supports integration with Azure DevOps Boards to automatically update work items and tasks

4. Powerful Insights

   - Built-in dashboards to visualize performance and effectiveness of task generation
   - Offers recommendations for improving workflows based on historical data
   - Detects potential bottlenecks or ambiguities in user stories
   - ![dashboard](docs/dashboard.png)

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

### Limitations

⚠️ API Gateway has trouble serializing JSON that includes single quotes ('). As such all outputs are sanitized to remove single quotes (') for now. ⚠️

⚠️ When a work item is updated, Azure DevOps Service Hooks can only be configured to trigger when one or any fields are updated. Meaning we have 3 Service Hooks, each for Title, Description, and AC; so if you update all 3 fields at the same time, it will trigger Task Genie 3x, resulting in 3x the tasks being generated. We cannot set this Service Hook to "any fields" as this will create a circular loop whenever the user story is updated by Task Genie. ⚠️

#### Revert to well-known version

This commit has a good verion but the prompts should be updated
49c0d7a696d2e422ed6e39d31e1e6427e2e01ca5

**evaluteUserStory**
You are an expert Agile software development assistant that reviews Azure DevOps work items.
You evaluate work items to ensure they are complete, clear, and ready for a developer to work on.
Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    Evaluate the user story based on the following criteria:
      - Check if it clearly states the user, need, and business value.
      - Ensure acceptance criteria are present and specific.
      - Confirm the story is INVEST-aligned (Independent, Negotiable, Valuable, Estimable, Small, Testable).

    Only return your assessment as a JSON object with the following structure:
      - "pass": boolean (true if the work item meets the quality bar, false otherwise)
      - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide
      a concrete example of a high-quality story that would pass. If you have multiple feedback points, use
      line breaks and indentations with HTML tags.

    Do not output any text outside of the JSON object.

    The work item to review is:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}

**defineTasks**
You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing
work items into actionable tasks.

Your task is to break down the provided work item into a sequence of tasks that are clear and actionable
for developers to work on. Each task should be independent and deployable separately.

Ensure each task has a title and a comprehensive description that guides the developer (why, what, how,
technical details, references to relevant systems/APIs). Do NOT create any tasks for analyzing,
investigating, analyzing, testing, or deployment.

When providing technical details, align them with the current architecture and technologies used:

- Serverless, microservices, and event-driven architectures
- Infrastructure: AWS services (Lambda, DynamoDB, EventBridge, etc.)
- Language: Python
- Frontend framework: React
- Mobile framework: Flutter
  If you are unsure about the technology, do not make assumptions.

Only return your assessment as a JSON object with the following structure: - "tasks": array of task objects, each with: - "title": string (task title, prefixed with its order in the sequence, e.g., "1. Task Title") - "description": string (detailed task description). Please use HTML tags for formatting, such as <br> for
line breaks, to make it easier to read.

Do not output any text outside of the JSON object.

The work item to decompose is:

- Title: ${workItem.title}
- Description: ${workItem.description}
- Acceptance Criteria: ${workItem.acceptanceCriteria}

## Pricing

Estimated monthly costs (USD) for running in an AWS ###:

| Service                   | Rate (us-west-2)                      | Quantity | Estimated cost |
| ------------------------- | ------------------------------------- | -------- | -------------- |
| VPC public IPv4           | $0.005 per hour                       | 1        | $3.60          |
| VPC endpoint              | $0.01 per hour                        | 2        | $14.40         |
| CloudWatch                | $3 per dashboard                      | 1        | $3.00          |
| Amplify                   | $0.01 per minute                      | 10       | $0.10          |
| Lambda                    | $0.0000166667 per GB-second           | 100,000  | $1.67          |
| Step Functions            | $0.00001667 per GB-second             | 100,000  | $1.67          |
| Bedrock (Claude 4 Sonnet) | $3.00/1M (input) / $15.00/1M (output) | 1        | $18.00         |
| **TOTAL (estimated)**     |                                       |          | **$42.44**     |

## Getting Started

### Pre-requisites

1. Create a PAT in AzureDevOps (until service principal is setup)

### Deployment

#### Backend

1. Update the `/backend/.env` file with the parameters:

   ```
   AZURE_DEVOPS_PAT=
   AWS_BEDROCK_MODEL_ID=
   AWS_BEDROCK_KNOWLEDGE_BASE_ID=
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

⚠️ NOTE: Amazon S3 Vectors for Bedrock Knowledge Bases is not yet supported in CloudFormation/CDK. As such, the Bedrock Knowledge Base needs to be manually created.

4. Create a Bedrock Knowledge Base with the S3 Bucket from the previous deploy (step 3) as the Data Source

5. Re-deploy the backend

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

⚠️ NOTE: This means when the title, AC, and description is updated at the same time, it will trigger 3x, resulting in 3x the number of tasks being generated. Please be aware of this. This is a limitation of Azure DevOps and not Task Genie. ⚠️

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

- https://www.youtube.com/watch?v=POn5WYFw4xU
- https://github.com/aws-samples/genai-for-devops/tree/main/automating-kanban-workflows
