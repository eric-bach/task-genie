# Plan: Implement Core Agentic Architecture

This plan outlines the phases and tasks required to refactor the existing orchestrated workflow to a new agentic architecture.

---

## Phase 1: Adapt Existing Agent & Dependencies

*   [x] Task: Review the existing `work-item-agent` and identify the main entry point and structure.
*   [x] Task: Add/update dependencies for Strands Agents and Amazon AgentCore in `work-item-agent/package.json`.
*   [x] Task: Modify the existing agent structure to conform to the basic Strands Agents agent loop.
*   [ ] Task: Fix Jest configuration for ES Modules in `work-item-agent`.
*   [ ] Task: Conductor - User Manual Verification 'Adapt Existing Agent & Dependencies' (Protocol in workflow.md)

---

## Phase 2: Refactor Services into Agent Tools [checkpoint: 0a4a0ee]

*   [x] Task: Refactor `AzureService.ts` into a set of agent tools for interacting with Azure DevOps.
*   [x] Task: Refactor `BedrockService.ts` into a set of agent tools for interacting with Amazon Bedrock.
*   [x] Task: Refactor `CloudWatchService.ts` into a set of agent tools for logging and monitoring.
*   [ ] Task: Conductor - User Manual Verification 'Refactor Services into Agent Tools' (Protocol in workflow.md)

---

## Phase 3: Refactor Core Logic into Agent Tools [checkpoint: 18c32c5]

*   [x] Task: Refactor the `evaluateWorkItem` function logic into a dedicated agent tool.
*   [x] Task: Refactor the `generateWorkItems` function logic into a dedicated agent tool.
*   [x] Task: Integrate the new tools (`AzureService`, `BedrockService`, `evaluateWorkItem`, `generateWorkItems`, etc.) into the main agent loop to replicate the original Step Function workflow.
*   [ ] Task: Conductor - User Manual Verification 'Refactor Core Logic into Agent Tools' (Protocol in workflow.md)

---

## Phase 4: Integration and Deployment

*   [ ] Task: Create a new Lambda function or modify the existing service hook entry point to trigger the new agent instead of the Step Function.
*   [ ] Task: Configure the necessary IAM roles and permissions for the new agent.
*   [ ] Task: Write/update the AWS CDK scripts to deploy the new agentic service.
*   [ ] Task: Deploy the new stack to the staging environment.
*   [ ] Task: Conductor - User Manual Verification 'Integration and Deployment' (Protocol in workflow.md)

---

## Phase 5: End-to-End Testing and Validation

*   [ ] Task: Manually trigger the workflow with a sample Azure DevOps work item.
*   [ ] Task: Verify that the agent executes the full workflow as expected by observing logs.
*   [ ] Task: Confirm that the expected child work items are created correctly in Azure DevOps.
*   [ ] Task: Conductor - User Manual Verification 'End-to-End Testing and Validation' (Protocol in workflow.md)