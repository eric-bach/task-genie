# Initial Concept

An AI-powered assistant that integrates with Azure DevOps Boards to ensure work items (Epic, Feature, User Story) are well-defined and automatically breaks them down into actionable work items, streamlining the Agile process and enhancing developer productivity.

## 1. Target Users

Task Genie is primarily designed for:

- **Agile development teams (Scrum, Kanban):** To streamline their work item management and task breakdown processes.
- **Project managers and product owners:** To ensure clarity, consistency, and efficiency in defining and managing project scope.

## 2. User Goals

The main goals for Task Genie users are:

- **Accelerate the decomposition of large work items:** Quickly break down Epics, Features, and User Stories into smaller, more manageable work items, including for consumption by AI coding agents like Codex.
- **Improve the quality and consistency of work items:** Ensure that Epics, Features, and User Stories adhere to best practices and are well-defined, providing contextually relevant and useful breakdowns that meet existing user expectations.
- **Incorporate user context:** Allow users to provide context, such as system knowledge, integration details, team processes, or other relevant information, to improve the quality and consistency of the generated work items.
- **Reduce manual effort and time:** Minimize the time spent on manual backlog grooming and sprint planning activities through automation, while maintaining the high accuracy and rich context currently achieved manually.

## 3. Existing Key Capabilities

Task Genie provides a robust set of features to enhance Agile workflows:

- **Automated Work Item Decomposition:** Automatically breaks down validated Epics, Features, and User Stories into actionable sub-items, preventing the creation of duplicate child items if they already exist.
- **Deep Azure DevOps Integration:** Seamless integration with Azure DevOps Boards, offering flexible options via both an Azure DevOps extension and service hooks.
- **Work Item Validation:** Ensures work items follow best practices by identifying missing components or inconsistencies.
- **Deep context integration:** Allows users to provide additional context, through a knowledge base for the AI to generate more relevant work items using Retrieval-Augmented Generation (RAG).- **Tool calling:** Provides integration to external resources such as web search and documentation (Confluence, Figma, etc.) to provide even more additional context for the task breakdown process.
- **Multimodal Context (Images):** Supports reading images within user stories to provide additional context for the task breakdown process.
- **Attachment Parsing:** Capability to parse and read various attachments added to Azure DevOps work items for richer context.
- **Customizable Prompts:** Enables teams to tailor the AI's instructions to fit their specific processes and expectations.

## 4. Unique Selling Points / Differentiators

Task Genie stands out from other solutions due to:

- **Deep Azure DevOps Integration:** Seamless integration with Azure DevOps Boards, offering flexible options via both an Azure DevOps extension and service hooks.
- **Adaptive AI-Powered Automation:** Utilizing AI for work item breakdown and validation, with the capability to adapt and learn from user feedback for continuous improvement.
- **Tool calling:** Provides integration to external resources such as web search and documentation (Confluence, Figma, etc.) to provide even more additional context for the task breakdown process.

## 5. Non-Functional Requirements

Critical non-functional requirements for Task Genie include:

- **Scalability:** The system must be scalable to efficiently handle a growing number of users, Azure DevOps organizations, and an increasing volume of work items.
- **SSO Integration:** Seamless Single Sign-On (SSO) integration for user authentication (completed).
- **CICD:** Robust Continuous Integration and Continuous Delivery (CICD) pipelines for automated deployment (completed).
- **Unit Testing:** Comprehensive unit test coverage to ensure code quality and prevent regressions.

## 6. Future Direction & Roadmap

The primary future goal for Task Genie is to evolve from its current orchestrated workflow into a more dynamic and autonomous agentic architecture.

- **Architectural Shift:** The first step is to refactor the application from the existing AWS Step Functions-based orchestration to an agentic model, exploring technologies like Strands Agents and Amazon AgentCore.
- **Autonomous Tool Use:** A key part of this evolution will be to incorporate support for a multi-tool calling platform (MCP) that enables the agent to autonomously leverage tools like the Azure DevOps APIs. This will replace hardcoded API interactions, allowing the agent to intelligently decide when and how to use tools to accomplish its goals.
- **Enhanced Tooling:** Future enhancements include integrating web search capabilities as an agent tool and enabling integration with Confluence for documentation ingestion.
- **Expanded Adaptive Feedback:** The adaptive feedback feature, currently supported for Tasks on User Story work items, is planned to be expanded to Features and Epics.
