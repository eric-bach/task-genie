# Task Genie

<div align="center">
  <img src="images/logo.jpg" alt="Task Genie" width="120">
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
  <strong>An AI-powered Azure DevOps extension that ensures work items (Epic, Feature, User Story, Product Backlog Item) are well-defined and automatically breaks them down into actionable work items, streamlining the Agile process and enhancing developer productivity.</strong><br />
  Task Genie follows Azure DevOps hierarchy where Epics are broken down into Features, Features into User Stories, and User Stories and Product Backlog Items into Tasks.
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

### 🔍 Work Item Validation

- Ensures Epics, Features, User Stories, and Product Backlog Items follow best practices
- Identifies missing components in Epics, Features, User Stories, and Product Backlog Items
- Provides suggestions to improve clarity and completeness

### 📋 Work Item Breakdown

- Automatically decomposes validated Epics, Features, User Stories, and Product Backlog Items into smaller, actionable work items
- Understands images within user stories as context in task breakdown process
- Uses RAG to support additional context like tech details, domain context, application knowledge, etc.
- Ability to fully customize the AI prompt for mutliple workflows

<div align="center">
  <img src="images/ui.png" alt="Task Genie UI" width="800">
</div>

### 🔗 Azure DevOps Boards Integration

- Seamless integration with Azure DevOps Boards
- Automatically updates work items and comments
- Built-in dashboards to visualize performance and effectiveness of task generation

<div align="center">
  <img src="images/dashboard.png" alt="Dashboard" width="800">
</div>

## 🏗️ Architecture

The architecture is deployed in AWS using an **agentic architecture model** with **Amazon Bedrock AgentCore**. Integration with Azure DevOps is done through an **Azure DevOps extension**.

<div align="center">
  <img src="images/architecture_v3.png" alt="Architecture Diagram" width="800">
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

## 💰 Pricing

Estimated monthly costs (USD) for running in AWS:

<div align="center">

| Service                     | Rate (us-west-2)                      | Quantity | Estimated Cost |
| --------------------------- | ------------------------------------- | -------- | -------------- |
| CloudWatch                  | $3 per dashboard                      | 1        | $3.00          |
| Amplify                     | $0.01 per minute                      | 10       | $0.10          |
| Lambda                      | $0.0000166667 per GB-second           | 100,000  | $1.67          |
| S3 Vectors (storage)        | $0.06 per GB                          | 1        | $0.06          |
| S3 Vectors (requests)       | $0.20 per GB                          | 1        | $0.20          |
| S3 Vectors (query requests) | $0.0025 per 1,000 requests            | 1,000    | $2.50          |
| Bedrock (Claude 4 Sonnet)   | $3.00/1M (input) / $15.00/1M (output) | 1        | $18.00         |
| **TOTAL (estimated)**       |                                       |          | **$27.20**     |

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

<div align="center">
  <img src="images/service_principal.png" alt="Azure DevOps Service Principal" width="480">
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
- **Production Deployment** (`deploy-production.yml`) - Manual deployment through GitHub Actions
  ![Deploy](/images/deploy_prod.png)

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
   - `AZURE_DEVOPS_TENANT_ID`: Azure tenant ID
   - `AZURE_DEVOPS_CLIENT_ID`: Azure client ID
   - `AZURE_DEVOPS_CLIENT_SECRET`: Azure client secret
   - `AZURE_DEVOPS_EXTENSION_ID`: Azure DevOps extension ID
   - `AZURE_DEVOPS_EXTENSION_SECRET`: Azure DevOps extension secret key
   - `AWS_BEDROCK_MODEL_ID`: Bedrock model ID
   - `DOMAIN_NAME`: Domain name of the Task Genie frontend

   **Environment-Specific Secrets:**
   For **staging** and **production** environments:
   - `AZURE_DEVOPS_ORGANIZATION`: Your Azure DevOps organization name
   - `AZURE_DEVOPS_SCOPE`: Azure DevOps scope
   - `AWS_ROLE_ARN`: AWS IAM role for Github Actions deployment
   - `AWS_BEDROCK_KNOWLEDGE_BASE_ID`: Amazon Bedrock Knowledge Base ID
   - `AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID`: Amazon Bedrock Knowledge Base Data Source ID
   - `DOCS_DOMAIN_NAME`: domain name of the Docusarus website
   - `AWS_CERTIFICATE_ARN`: ARN of the AWS Certificate used for the Docusarus Cloudfront Distribution

#### Option 2: Manual Deployment (CDK)

1. **Environment Configuration**

   Update the `/infrastructure/.env` file with your parameters:

   ```env
   AZURE_DEVOPS_ORGANIZATION=
   AZURE_DEVOPS_TENANT_ID=
   AZURE_DEVOPS_CLIENT_ID=
   AZURE_DEVOPS_CLIENT_SECRET=
   AZURE_DEVOPS_SCOPE=
   AZURE_DEVOPS_EXTENSION_ID=
   AZURE_DEVOPS_EXTENSION_SECRET=
   AWS_BEDROCK_MODEL_ID=
   AWS_BEDROCK_KNOWLEDGE_BASE_ID=
   AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID=
   AWS_CERTIFICATE_ARN=
   DOCS_DOMAIN_NAME=
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

### 🌐 Frontend

The frontend is deployed using **AWS Amplify Console**.

#### Amplify Console

1. Create a new AWS Amplify project and point to this monorepo with `frontend` as the folder name.

2. Configure the environment variables in the project

   ```env
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=
   NEXT_PUBLIC_COGNITO_CLIENT_ID=
   NEXT_PUBLIC_DOMAIN=
   NEXT_PUBLIC_REDIRECT_SIGNIN_URL=
   NEXT_PUBLIC_REDIRECT_SIGNOUT_URL=
   NEXT_PUBLIC_API_GATEWAY_URL=
   NEXT_PUBLIC_API_GATEWAY_API_KEY=
   NEXT_PUBLIC_DOCS_URL=
   NEXT_PUBLIC_ADO_DEFAULT_PROJECT=
   ```

#### Local Development

1. **Environment Configuration**

   Update `/frontend/.env.local` with backend deployment parameters:

   ```env
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=
   NEXT_PUBLIC_COGNITO_CLIENT_ID=
   NEXT_PUBLIC_DOMAIN=
   NEXT_PUBLIC_REDIRECT_SIGNIN_URL=http://localhost:3000/dashboard
   NEXT_PUBLIC_REDIRECT_SIGNOUT_URL=http://localhost:3000
   NEXT_PUBLIC_API_GATEWAY_URL=
   NEXT_PUBLIC_API_GATEWAY_API_KEY=
   NEXT_PUBLIC_DOCS_URL=
   NEXT_PUBLIC_ADO_DEFAULT_PROJECT=
   ```

2. **Install Dependencies**

   ```bash
   npm run install
   ```

3. **Start Development Server**

   ```bash
   npm run dev
   ```

## ⚙️ Setup

### 🔗 Azure DevOps Configuration (one-time, per organization)

#### Install Azure DevOps Extension

1. Install the [Task Genie](https://marketplace.visualstudio.com/items?itemName=AMA.task-genie) extension to the Azure DevOps organization

2. Add the extension to the Process template
   - Go to the [Organization Settings](https://amaabca.visualstudio.com/_settings) in Azure DevOps and click [Process](https://amaabca.visualstudio.com/_settings/process)
   - Click on the Process to edit
   - Click on `User Story`
   - Click `Add custom control` and select the ~Task Genie Button (AMA)`
     ![](/images/custom_control.png)
   - Click `Options` and set the API URL to the values in the AWS environment
     ![](/images/custom_control_options.png)

3. The `Generate Tasks` button should now appear on any User Stories using the Process
   ![](/images/azure_devops_user_story.png)

## 💻 Development

### Building the extension

1. To publish a new version of the Azure DevOps Extension

   `npx tfx-cli extension create --rev-version --output-path ./dist`

   To publish the dev version of the Azure DevOps Extension

   `npx tfx-cli extension create --manifest-globs vss-extension.dev.json --rev-version --output-path ./dist`

2. To test the Azure DevOps Extension

   `start test-standalone.html`

### Publishing the extension

1. Log on to the Azure DevOps Marketplace
   https://marketplace.visualstudio.com/

2. Create a publisher (one-time)
   https://marketplace.visualstudio.com/manage/createpublisher

3. Click `New Extension` -> `Azure DevOps` (one-time)

4. Upload the published extension

5. Click the 3 dots and then `Share` to share with the applicable ADO Organizations

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
