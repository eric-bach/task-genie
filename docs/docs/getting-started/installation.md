---
sidebar_position: 1
---

# Installation & Setup

Task Genie offers two primary methods for integration with Azure DevOps, each designed to meet different organizational needs and preferences. Choose the method that best fits your team's workflow and administrative requirements.

:::tip My tip

Use this awesome feature option

:::

## Overview of Setup Methods

| Method                        | Best For                          | Pros                                                       | Cons                                               |
| ----------------------------- | --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| **Azure DevOps Extension**    | Individual teams, quick setup     | Easy installation, integrated UI, per-project control      | Manual trigger, requires extension permissions     |
| **Service Hooks Integration** | Enterprise deployment, automation | Automatic triggering, organization-wide, seamless workflow | Requires admin setup, potential duplicate triggers |

---

## Method 1: Azure DevOps Extension

The Azure DevOps Extension provides the quickest and most user-friendly way to get started with Task Genie. It adds a "Generate Tasks" button directly to your User Story work item forms.

### Prerequisites

Before installing the extension, ensure you have:

- **Azure DevOps Project Access**: Write permissions to work items in your project
- **Extension Installation Rights**: Ability to install extensions in your Azure DevOps organization
- **Task Genie API Access**: API endpoint URL and API key from your Task Genie deployment

### Installation Steps

#### Step 1: Install the Extension

1. **Access Azure DevOps Marketplace**

   - Navigate to the [Azure DevOps Marketplace](https://marketplace.visualstudio.com/)
   - Search for "Task Genie" or contact your administrator for the extension package

2. **Install in Your Organization**
   - Click "Get it free" or "Install"
   - Select your Azure DevOps organization
   - Choose the projects where you want to install Task Genie
   - Complete the installation process

#### Step 2: Configure the Extension

1. **Navigate to Project Settings**

   - Open your Azure DevOps project
   - Click the gear icon → **Project Settings**

2. **Access Extensions**

   - In the left sidebar, click **Extensions**
   - Find "Task Genie" in the installed extensions list

3. **Configure API Settings**
   - Click on Task Genie extension
   - Enter the following configuration:
     - **API URL**: Your Task Genie API endpoint (e.g., `https://your-api-gateway.execute-api.us-west-2.amazonaws.com/prod`)
     - **API Key**: Your Task Genie API key (will be stored securely)

#### Step 3: Add Control to Work Item Forms

1. **Customize Work Item Process**

   - Go to **Project Settings** → **Process**
   - Select your process template (Agile, Scrum, etc.)

2. **Edit User Story Work Item Type**

   - Click on **User Story** work item type
   - Navigate to **Layout** tab

3. **Add Task Genie Control**
   - Click **Add a custom control**
   - Select "Task Genie Button" from the list
   - Configure the control settings:
     - **Label**: "Task Genie"
     - **API URL**: Reference your configured API endpoint
     - **API Key**: Reference your configured API key
   - Save the changes

### Using the Extension

Once installed and configured:

1. **Open a User Story**

   - Navigate to any User Story work item in your project
   - The "Generate Tasks" button will appear in the work item form

2. **Generate Tasks**

   - Click the **Generate Tasks** button
   - Task Genie will analyze your user story
   - Generated tasks will be automatically created and linked to your story

3. **Review Generated Tasks**
   - Check the **Related Work** section for newly created tasks
   - Review and modify tasks as needed
   - Tasks are ready for sprint planning and assignment

### Troubleshooting Extension Issues

**Button Not Appearing?**

- Verify the extension is installed for your project
- Check that the control was added to the User Story layout
- Ensure you have proper permissions to view custom controls

**API Connection Issues?**

- Verify the API URL is correct and accessible
- Check that the API key is valid and has proper permissions
- Review browser developer tools for network errors

---

## Method 2: Service Hooks Integration

Service Hooks provide automatic, real-time integration with Task Genie. This method is ideal for organizations wanting seamless, automated task generation without manual intervention.

### Prerequisites

- **Azure DevOps Project Administrator Access**: Required to configure Service Hooks
- **Task Genie Deployment**: Completed backend deployment with API Gateway endpoint
- **API Gateway Configuration**: Proper API key setup for authentication

### Important Limitations

:::warning Azure DevOps Service Hooks Limitation
Azure DevOps Service Hooks can only trigger on individual field changes. When Title, Description, and Acceptance Criteria are updated simultaneously, Task Genie will be triggered 3 times, potentially generating 3x the number of tasks. This is a limitation of Azure DevOps, not Task Genie.
:::

### Service Hooks Configuration

#### Step 1: Access Project Settings

1. **Navigate to Project Settings**

   - In your Azure DevOps project, click the gear icon
   - Select **Project Settings** from the dropdown

2. **Open Service Hooks**
   - In the left sidebar, click **Service hooks**
   - This section manages external service integrations

#### Step 2: Create Service Hooks

You need to create **four (4) separate Service Hooks** for comprehensive integration:

| Hook Type | Trigger Event                           | Purpose                             |
| --------- | --------------------------------------- | ----------------------------------- |
| Hook 1    | Work item created                       | Analyze new User Stories            |
| Hook 2    | Work item updated (Title)               | Re-analyze when title changes       |
| Hook 3    | Work item updated (Description)         | Re-analyze when description changes |
| Hook 4    | Work item updated (Acceptance Criteria) | Re-analyze when criteria change     |

#### Step 3: Configure Each Service Hook

For each of the four hooks, follow these steps:

1. **Create New Service Hook**

   - Click the **+** (plus) button
   - Select **Web Hooks** as the service type

2. **Configure Trigger Settings**

   - **Trigger on this type of event**:
     - For Hook 1: "Work item created"
     - For Hooks 2-4: "Work item updated"
   - **Area path**: Select your project area path
   - **Work item type**: Select "User Story"
   - **Field**: (For update hooks only)
     - Hook 2: "Title"
     - Hook 3: "Description"
     - Hook 4: "Acceptance Criteria"

3. **Configure Action Settings**

   - **URL**: `https://{API_GATEWAY_ID}.execute-api.{REGION}.amazonaws.com/prod/executions`
   - **HTTP Headers**:
     ```
     x-api-key: {YOUR_API_KEY}
     Content-Type: application/json
     ```
   - **Resource details to send**: Select "All"
   - **Messages to send**: Select "All"

4. **Test the Configuration**
   - Click **Test** to verify the connection
   - Ensure you receive a successful response
   - Save the Service Hook

#### Step 4: Verify Integration

1. **Create a Test User Story**

   - Create a new User Story with title, description, and acceptance criteria
   - Task Genie should automatically analyze and generate tasks

2. **Monitor Service Hook Activity**
   - Return to **Service hooks** in project settings
   - Click on each hook to view activity logs
   - Verify successful executions and troubleshoot any failures

### Service Hooks Best Practices

**Minimize Duplicate Triggers**

- Update User Story fields one at a time when possible
- Use bulk edit operations sparingly
- Consider disabling hooks temporarily during large migrations

**Monitor API Usage**

- Track Service Hook execution logs regularly
- Set up CloudWatch alarms for API Gateway errors
- Monitor AWS costs related to increased API calls

**Security Considerations**

- Rotate API keys regularly
- Use least-privilege access for Service Hook configurations
- Monitor unauthorized API access attempts

### Troubleshooting Service Hooks

**Hooks Not Triggering?**

- Verify the Service Hook is enabled and properly configured
- Check that the work item type and field filters are correct
- Review Azure DevOps activity logs for hook execution

**API Errors?**

- Validate the API Gateway endpoint URL
- Ensure the API key is correctly formatted in headers
- Check AWS CloudWatch logs for backend errors

**Duplicate Task Generation?**

- Review which hooks are triggering simultaneously
- Consider implementing deduplication logic in your backend
- Monitor task creation patterns and adjust accordingly

---

## Next Steps

After completing either installation method:

1. **[Configure Your Knowledge Base](./knowledge-base-setup.md)** - Enhance AI responses with organizational context
2. **[Customize Task Templates](./customization.md)** - Tailor task generation to your team's needs
3. **[Monitor and Analytics](./monitoring.md)** - Track performance and optimize your workflow

Choose the method that best fits your organization's needs and start transforming your Agile workflow with AI-powered task generation!
