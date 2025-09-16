# Task Genie

<div align="center">
  <img src="docs/logo.jpg" alt="Task Genie" width="120">
</div>

<div align="center">

<!-- Repository Stats -->

[![GitHub issues](https://img.shields.io/github/issues/eric-bach/task-genie)](https://github.com/eric-bach/task-genie/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/eric-bach/task-genie)](https://github.com/eric-bach/task-genie/pulls)
[![GitHub last commit](https://img.shields.io/github/last-commit/eric-bach/task-genie)](https://github.com/eric-bach/task-genie/commits/main)
[![GitHub release](https://img.shields.io/github/v/release/eric-bach/task-genie?include_prereleases)](https://github.com/eric-bach/task-genie/releases)

<!-- Technology Stack -->

[![Azure DevOps](https://img.shields.io/badge/Azure%20DevOps-Integration-blue.svg)](https://azure.microsoft.com/en-us/services/devops/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.0+-black.svg)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)

<!-- Project Status -->

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/eric-bach/task-genie?style=social)](https://github.com/eric-bach/task-genie/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/eric-bach/task-genie?style=social)](https://github.com/eric-bach/task-genie/network/members)

</div>

<div align="center">
  <strong>An AI-powered assistant that integrates with Azure DevOps Boards to ensure user story completeness and automatically breaks them down into actionable tasks, streamlining the Agile process and enhancing developer productivity.</strong>
</div>

<br>

<div align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#pricing">Pricing</a> •
  <a href="#contributing">Contributing</a>
</div>

## ✨ Features

### 🔍 User Story Validation

- Ensures user stories follow best practices
- Identifies missing components in user stories
- Provides suggestions to improve clarity and completeness
- **NEW**: Uses RAG to support additional context like tech details, domain context, application knowledge, etc.

### 📋 Task Breakdown

- Automatically decomposes validated user stories into smaller, actionable tasks
- Ensures tasks align with agile methodologies for efficient development

<div align="center">
  <img src="docs/ui.png" alt="Task Genie UI" width="800">
</div>

### 🔗 Azure DevOps Boards Integration

- Seamless integration with Azure DevOps Boards
- Automatically updates work items and tasks
- Supports custom workflows and board configurations

### 📊 Powerful Insights

- Built-in dashboards to visualize performance and effectiveness of task generation
- Offers recommendations for improving workflows based on historical data
- Detects potential bottlenecks or ambiguities in user stories

<div align="center">
  <img src="docs/dashboard.png" alt="Dashboard" width="800">
</div>

## 🏗️ Architecture

The architecture is deployed in AWS using a **serverless model** with **Step Functions** orchestrating the AI workflow. Integration with Azure DevOps is done through **Service Hooks** for each board.

<div align="center">
  <img src="docs/architecture_v2.png" alt="Architecture Diagram" width="800">
</div>

A state machine, leveraging **AWS Step Functions**, orchestrates the workflow for the interaction with the LLM.

<div align="center">
  <img src="docs/state_machine.png" alt="State Machine" width="600">
</div>

### 🛠️ Technology Stack

<div align="center">

|                                                              Technology                                                              |                  Description                   |
| :----------------------------------------------------------------------------------------------------------------------------------: | :--------------------------------------------: |
|     <img height="40" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/aws.png">      | **Amazon Web Services** - Cloud infrastructure |
|   <img height="40" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/next_js.png">    |   **Next.js** - React framework for frontend   |
|  <img height="40" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/shadcn_ui.png">   |      **ShadCN UI** - Modern UI components      |
| <img height="40" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/tailwind_css.png"> | **Tailwind CSS** - Utility-first CSS framework |
|  <img height="40" src="https://raw.githubusercontent.com/marwin1991/profile-technology-icons/refs/heads/main/icons/typescript.png">  |     **TypeScript** - Type-safe development     |

</div>

### ⚠️ Current Limitations

> **Azure DevOps Service Hooks Limitation**  
> Azure DevOps Service Hooks can only be configured to trigger on one or all fields when a work item is updated. When the Title, Description, and Acceptance Criteria of a work item are updated simultaneously, Task Genie will be triggered 3 times, resulting in 3x the number of tasks being generated.

> **Amazon Bedrock Knowledge Bases**  
> Task Genie uses S3 Vectors for the Knowledge Base Data Store, which is currently not supported in CloudFormation. The Bedrock Knowledge Base needs to be manually created in the console and the IDs need to be set in the `.env` file.

## 💰 Pricing

Estimated monthly costs (USD) for running in AWS:

<div align="center">

| Service                   | Rate (us-west-2)                      | Quantity | Estimated Cost |
| ------------------------- | ------------------------------------- | -------- | -------------- |
| CloudWatch                | $3 per dashboard                      | 1        | $3.00          |
| Amplify                   | $0.01 per minute                      | 10       | $0.10          |
| Lambda                    | $0.0000166667 per GB-second           | 100,000  | $1.67          |
| Step Functions            | $0.00001667 per GB-second             | 100,000  | $1.67          |
| Bedrock (Claude 4 Sonnet) | $3.00/1M (input) / $15.00/1M (output) | 1        | $18.00         |
| **TOTAL (estimated)**     |                                       |          | **$24.44**     |

</div>

## 🚀 Getting Started

### 📋 Prerequisites (One-time setup)

1. **Azure Service Principal Setup**

   - Request the `Identity and Productivity Team` to create an Azure Service Principal in Azure DevOps with "Read & Write" permissions to "Work Items"
   - Use these values to populate the `.env` in the next step

2. **Azure DevOps User Configuration**

   - Log in to Azure DevOps → `Organization Settings` → `Users` → `Add users`
   - Enter the Service Principal Client Id and set the `Access Level` and `Project`
   - Uncheck `Send email invites`

   - Uncheck `Send email invites`

<div align="center">
  <img src="docs/service_principal.png" alt="Azure DevOps Service Principal" width="600">
</div>

## 🔧 Deployment

### 🚀 Backend Deployment Options

#### Option 1: Automated Deployment (GitHub Actions)

The backend is deployed using GitHub Actions with the following pipelines:

- **CI Pipeline** (`ci.yml`) - Runs on every pull request and push
  - Builds and tests the code
  - Validates CloudFormation templates
  - Runs security scans
- **Staging Deployment** (`deploy-staging.yml`) - Automatically deploys to staging on `main` branch pushes
- **Production Deployment** (`deploy-production.yml`) - Manual deployment only with confirmation

**One-time Setup for Automated Deployment:**

1. **Deploy GitHub Actions Infrastructure**

   The GitHub Actions OIDC provider and IAM role are automatically deployed when you run the deployment command:

   ```bash
   cd infrastructure
   npm run deploy
   ```

   This will deploy all stacks including:

   - AWS OIDC provider for GitHub Actions
   - IAM role with necessary permissions for CDK deployment
   - Your application infrastructure (data, app, observability stacks)
   - Output with the role ARN you'll need for GitHub

2. **Configure GitHub Repository**

   **Create Environments:**

   1. Go to your GitHub repository
   2. Navigate to **Settings** → **Environments**
   3. Create two environments: `staging` and `production`

   **Add Secrets:**
   For each environment, add the following secrets under **Settings** → **Secrets and variables** → **Actions**:

   **Required Secrets:**

   - `AZURE_DEVOPS_PROJECT`: Your Azure DevOps project name
   - `AZURE_DEVOPS_TENANT_ID`: Azure tenant ID
   - `AZURE_DEVOPS_CLIENT_ID`: Azure client ID
   - `AZURE_DEVOPS_CLIENT_SECRET`: Azure client secret
   - `AZURE_DEVOPS_SCOPE`: Azure DevOps scope
   - `AWS_BEDROCK_MODEL_ID`: Bedrock model ID

   **Environment-Specific Secrets:**
   For **staging** and **production** environments:

   - `AWS_ROLE_ARN`
   - `AWS_BEDROCK_KNOWLEDGE_BASE_ID`
   - `AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID`

#### Option 2: Manual Deployment (CDK)

1. **Environment Configuration**

   Update the `/infrastructure/.env` file with your parameters:

   ```env
   AZURE_DEVOPS_PROJECT=
   AZURE_DEVOPS_TENANT_ID=
   AZURE_DEVOPS_CLIENT_ID=
   AZURE_DEVOPS_CLIENT_SECRET=
   AZURE_DEVOPS_SCOPE=
   AWS_BEDROCK_MODEL_ID=
   AWS_BEDROCK_KNOWLEDGE_BASE_ID=
   AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID=
   ```

2. **Install Dependencies**

   ```bash
   npm run install
   ```

3. **Deploy Infrastructure**

   ```bash
   npm run deploy
   npm run deploy-prod
   ```

   > ⚠️ **Note**: Amazon S3 Vectors for Bedrock Knowledge Bases is not yet supported in CloudFormation/CDK. The Bedrock Knowledge Base needs to be manually created in the AWS console.

4. **Create Bedrock Knowledge Base**

   - Set the Chunking strategy to `Semantic chunking` with `Max token size for a chunk` = 150

   <div align="center">
     <img src="docs/kb_chunking.png" alt="Chunking Strategy" width="600">
   </div>

   - Select `S3 Vectors` as the Data Source with the Knowledge Base Data Source Bucket from step 3

5. **Update Environment Variables**

   Update `/infrastructure/.env` with the created Bedrock Knowledge Base details:

   ```env
   AWS_BEDROCK_KNOWLEDGE_BASE_ID=your_kb_id
   AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID=your_data_source_id
   ```

6. **Re-deploy Backend**

   ```bash
   npm run deploy
   npm run deploy-prod
   ```

### 🌐 Frontend Deployment

The frontend is deployed using **Vercel**.

#### Local Development

1. **Environment Configuration**

   Update `/frontend/.env.local` with backend deployment parameters:

   ```env
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=
   NEXT_PUBLIC_COGNITO_CLIENT_ID=
   NEXT_PUBLIC_API_GATEWAY_URL=
   NEXT_PUBLIC_API_GATEWAY_API_KEY=
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=
   ```

2. **Install Dependencies**

   ```bash
   npm run install
   ```

3. **Start Development Server**

   ```bash
   npm run dev
   ```

### 🔗 Azure DevOps Configuration (One-time, per board)

The integration with Azure DevOps leverages **Service Hooks** and requires **4 Service Hooks** to be created for each Board:

- Work item created
- Work item updated (title)
- Work item updated (description)
- Work item updated (acceptance criteria)

<div align="center">
  <img src="docs/service_hooks.png" alt="Service Hooks Configuration" width="700">
</div>

> ⚠️ **Important**: When the title, acceptance criteria, and description are updated simultaneously, it will trigger 3 times, resulting in 3x the number of tasks being generated. This is a limitation of Azure DevOps, not Task Genie.

#### Configuration Steps

1. **Access Project Settings**

   - In Azure DevOps project → Click the gear icon → `Project Settings`

2. **Navigate to Service Hooks**

   - Click on `Service hooks`

3. **Create New Service Hook**

   - Click the `+` plus sign to create a new Service Hook

4. **Configure Four Service Hooks**

   Create **four (4) Service Hooks** with the following configuration:

   | Setting                           | Value                                                                   |
   | --------------------------------- | ----------------------------------------------------------------------- |
   | **Trigger on this type of event** | work item created (1), work item updated (3)                            |
   | **Area path**                     | Azure DevOps project name                                               |
   | **Work item type**                | User Story                                                              |
   | **URL**                           | `https://API_GW_ID.execute-api.us-west-2.amazonaws.com/prod/executions` |
   | **HTTP headers**                  | `x-api-key: <API_Gateway_API_Key>`                                      |

## 📚 References

- [YouTube Demo](https://www.youtube.com/watch?v=POn5WYFw4xU)
- [AWS GenAI for DevOps Samples](https://github.com/aws-samples/genai-for-devops/tree/main/automating-kanban-workflows)

## 🤝 Contributing

We welcome contributions to Task Genie! Please feel free to submit issues, feature requests, or pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions, please:

1. Check the [Issues](https://github.com/eric-bach/task-genie/issues) page
2. Create a new issue if your problem isn't already reported
3. Provide detailed information about your environment and the issue

---

<div align="center">
  <strong>Made with ❤️ by the Task Genie Team</strong>
</div>
