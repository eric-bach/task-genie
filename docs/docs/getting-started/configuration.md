---
sidebar_position: 3
---

# Configuration

**Task Genie** offers multiple layers of configuration to tailor the AI-powered task generation to your team's specific needs, organizational context, and Azure DevOps setup. This guide covers all configuration options available to end users.

## Configuration Overview

Task Genie configurations are organized into several categories:

| Configuration Type           | Scope                | Purpose                                                | Access Level |
| ---------------------------- | -------------------- | ------------------------------------------------------ | ------------ |
| **Azure DevOps Integration** | Organization/Project | Connect with Azure DevOps boards and work items        | Admin        |
| **AI Model Settings**        | Global/Per-Request   | Control AI behavior and response quality               | User/Admin   |
| **Team-Specific Prompts**    | Team/Project         | Customize task generation for specific contexts        | User         |
| **Extension Settings**       | Project              | Configure Azure DevOps extension behavior              | Admin        |
| **Knowledge Base**           | Organization         | Upload domain-specific context for better AI responses | Admin/User   |

---

## Azure DevOps Integration Configuration

### Project-Level Settings

These settings connect Task Genie to your Azure DevOps organization and projects:

#### **Required Azure DevOps Fields**

Task Genie requires specific work item fields to function properly:

| Field Name                                 | Purpose                                 | Required | Custom Field |
| ------------------------------------------ | --------------------------------------- | -------- | ------------ |
| `System.Title`                             | User story title for context            | ✅       | No           |
| `System.Description`                       | Main story description                  | ✅       | No           |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | Acceptance criteria for task generation | ✅       | No           |
| `System.AreaPath`                          | Project area path for organization      | ✅       | No           |
| `Custom.BusinessUnit2`                     | Business unit classification            | ✅       | Yes          |
| `Custom.System2`                           | System/application identifier           | ✅       | Yes          |

:::info Custom Field Setup
The `Custom.BusinessUnit2` and `Custom.System2` fields need to be created in your Azure DevOps process template. Contact your Azure DevOps administrator to add these custom fields to your User Story work item type.
:::

#### **Azure DevOps Service Principal Configuration**

For Service Hooks integration, configure these Azure DevOps settings:

```json
{
  "tenant_id": "your-azure-tenant-id",
  "client_id": "service-principal-client-id",
  "client_secret": "service-principal-secret",
  "scope": "https://app.vssps.visualstudio.com/.default"
}
```

**Required Permissions:**

- Work Items: Read & Write
- Project and team: Read
- Analytics: Read (for dashboard features)

---

## AI Model Configuration

### Global AI Settings

These settings control the AI model behavior across all task generation:

#### **Model Parameters**

| Parameter     | Default | Range    | Purpose                                             |
| ------------- | ------- | -------- | --------------------------------------------------- |
| `maxTokens`   | 4000    | 100-8000 | Maximum tokens in AI response                       |
| `temperature` | 0.7     | 0.0-1.0  | Creativity vs consistency (lower = more consistent) |
| `topP`        | 0.9     | 0.0-1.0  | Response diversity control                          |

```javascript
// Example configuration in web interface
{
  "maxTokens": 4000,
  "temperature": 0.7,
  "topP": 0.9
}
```

#### **Model Selection**

**Task Genie** supports multiple AI models via Amazon Bedrock and is currently configured to use `Anthropic Claude Sonnet 4.5` for the most advanced reasoning.

### Per-Request AI Settings

When using the web interface or API, you can override global settings:

```javascript
// Example API request with custom AI settings
{
  "params": {
    "prompt": "Custom prompt for this story",
    "maxTokens": 3000,
    "temperature": 0.5,
    "topP": 0.8
  },
  "resource": {
    // ... work item data
  }
}
```

---

## Team-Specific Configuration

### Custom Prompt Configuration

Task Genie allows you to create custom prompts tailored to your team's specific needs, development practices, and domain knowledge.

#### **Configuration Structure**

Each team configuration includes:

```javascript
{
  "areaPath": "MyProject\\Team Alpha",
  "businessUnit": "Engineering",
  "system": "Customer Portal",
  "prompt": "Your custom prompt template..."
}
```

#### **Prompt Template Variables**

Your custom prompts can reference these variables:

| Variable               | Description           | Example                      |
| ---------------------- | --------------------- | ---------------------------- |
| `{title}`              | User story title      | "As a user, I want to login" |
| `{description}`        | Story description     | "Full story description..."  |
| `{acceptanceCriteria}` | Acceptance criteria   | "Given/When/Then scenarios"  |
| `{businessUnit}`       | Business unit context | "Engineering"                |
| `{system}`             | System/application    | "Customer Portal"            |

#### **Sample Custom Prompts**

**For Web Development Teams:**

```text
You are a senior web developer creating tasks for a {system} story.
Consider these aspects:
- Frontend React components needed
- Backend API endpoints required
- Database schema changes
- Testing requirements (unit, integration, E2E)
- Security considerations
- Performance implications

Story: {title}
Description: {description}
Acceptance Criteria: {acceptanceCriteria}

Generate 3-7 specific, actionable development tasks.
```

**For Mobile Development Teams:**

```text
You are an experienced mobile developer working on {system}.
Focus on:
- UI/UX implementation for mobile screens
- Platform-specific considerations (iOS/Android)
- API integration and data management
- Offline functionality requirements
- Performance and battery optimization
- App store compliance

Story: {title}
Description: {description}
Acceptance Criteria: {acceptanceCriteria}

Create detailed tasks for mobile development.
```

**For DevOps/Infrastructure Teams:**

```text
You are a DevOps engineer implementing infrastructure for {system}.
Consider:
- Infrastructure as Code (Terraform/CloudFormation)
- CI/CD pipeline updates
- Security and compliance requirements
- Monitoring and alerting setup
- Backup and disaster recovery
- Environment configuration

Story: {title}
Description: {description}
Acceptance Criteria: {acceptanceCriteria}

Generate infrastructure and deployment tasks.
```

### Managing Team Configurations

#### **Web Interface Configuration**

1. **Access Configuration**

   - Login to Task Genie web interface
   - Navigate to **Configuration** page
   - View existing team configurations

2. **Create New Configuration**

   - Click **New Configuration**
   - Fill in required fields:
     - **Area Path**: Select your team's area path
     - **Business Unit**: Enter your business unit
     - **System**: Specify the system/application
     - **Custom Prompt**: Enter your tailored prompt template

3. **Edit Existing Configuration**
   - Select configuration from list
   - Only the custom prompt can be modified
   - Area Path, Business Unit, and System are immutable after creation

#### **Configuration Best Practices**

**Prompt Design Tips:**

- Be specific about your technology stack
- Include your team's coding standards
- Reference your Definition of Done criteria
- Consider your typical task size and complexity
- Include quality gates and review processes

**Organizational Structure:**

- Use consistent Business Unit naming across teams
- Align Area Paths with your Azure DevOps structure
- Use descriptive System names that match your architecture
- Create separate configurations for different project types

---

## Extension Configuration

### Azure DevOps Extension Setup

The Task Genie extension requires configuration within Azure DevOps:

#### **Extension Input Parameters**

| Parameter | Description                     | Required | Security |
| --------- | ------------------------------- | -------- | -------- |
| `ApiUrl`  | Task Genie API Gateway endpoint | ✅       | Public   |
| `ApiKey`  | API key for authentication      | ✅       | Secret   |

#### **Configuration Steps**

1. **Install Extension**

   - Install from Azure DevOps marketplace
   - Grant necessary permissions

2. **Configure Extension Settings**

   ```
   API URL: https://your-api-gateway.execute-api.us-west-2.amazonaws.com/prod
   API Key: your-secure-api-key
   ```

3. **Add to Work Item Forms**
   - Navigate to Process customization
   - Add "Task Genie Button" control to User Story layout
   - Configure control settings and positioning

### Extension Behavior Settings

#### **Button Appearance**

The extension button can be customized:

- **Height**: Default 80px (configurable)
- **Label**: "Generate Tasks" (customizable)
- **Position**: Configurable within work item form layout

#### **API Integration Settings**

```javascript
// Extension configuration object
{
  "witInputs": {
    "ApiUrl": "https://api-gateway-url.amazonaws.com/prod/executions",
    "ApiKey": "your-api-key"
  }
}
```

---

## Knowledge Base Configuration

### Document Upload and Management

Task Genie supports organizational knowledge bases to improve AI responses with domain-specific context.

#### **Supported File Types**

| File Type     | Purpose            | Best For                          |
| ------------- | ------------------ | --------------------------------- |
| `.md`, `.txt` | Documentation      | Technical specs, coding standards |
| `.pdf`        | Formal documents   | Requirements, architecture docs   |
| `.docx`       | Business documents | Process documentation             |
| `.json`       | Structured data    | API specs, configuration examples |

#### **Upload Organization**

Structure your knowledge base by:

```
Knowledge Base Structure:
├── Business Unit/
│   ├── System Name/
│   │   ├── technical-docs/
│   │   ├── business-rules/
│   │   └── templates/
```

#### **Content Optimization**

**Effective Knowledge Base Content:**

- Clear, well-structured documentation
- Up-to-date technical specifications
- Code examples and templates
- Business rules and domain knowledge
- Common patterns and anti-patterns

**Content to Avoid:**

- Outdated documentation
- Sensitive or confidential information
- Personal information or credentials
- Duplicate or redundant content

### Knowledge Base API Integration

The knowledge base integrates automatically with task generation:

```javascript
// Knowledge base context is automatically retrieved based on:
{
  "areaPath": "Project\\Team",
  "businessUnit": "Engineering",
  "system": "Customer Portal"
}
```

---

## Environment Variables Reference

### Backend Configuration

Required environment variables for Task Genie backend deployment:

```bash
# Azure DevOps Integration
AZURE_DEVOPS_PROJECT=your-project-name
AZURE_DEVOPS_TENANT_ID=azure-tenant-id
AZURE_DEVOPS_CLIENT_ID=service-principal-id
AZURE_DEVOPS_CLIENT_SECRET=service-principal-secret
AZURE_DEVOPS_SCOPE=https://app.vssps.visualstudio.com/.default

# AI Model Configuration
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_BEDROCK_KNOWLEDGE_BASE_ID=your-knowledge-base-id
AWS_BEDROCK_KNOWLEDGE_BASE_DATA_SOURCE_ID=your-data-source-id
```

### Frontend Configuration

Required environment variables for Task Genie web interface:

```bash
# Authentication
NEXT_PUBLIC_COGNITO_USER_POOL_ID=cognito-pool-id
NEXT_PUBLIC_COGNITO_CLIENT_ID=cognito-client-id

# API Integration
NEXT_PUBLIC_API_GATEWAY_URL=https://api-gateway-url.amazonaws.com
NEXT_PUBLIC_API_GATEWAY_API_KEY=your-api-key

# Security (Optional)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=cloudflare-turnstile-key
```

---

## Configuration Validation

### Testing Your Configuration

#### **Extension Configuration Test**

1. Open a User Story in Azure DevOps
2. Verify the "Generate Tasks" button appears
3. Click button and check for successful API call
4. Verify tasks are created and linked properly

#### **Web Interface Test**

1. Login to Task Genie web interface
2. Navigate to Playground
3. Fill in test user story details
4. Generate tasks and verify output quality
5. Check configuration settings are applied

#### **Service Hooks Test**

1. Create or update a User Story in Azure DevOps
2. Check Service Hooks activity logs
3. Verify API calls are successful
4. Confirm tasks are automatically generated

### Troubleshooting Configuration Issues

**Common Issues and Solutions:**

| Issue                          | Cause                                 | Solution                                      |
| ------------------------------ | ------------------------------------- | --------------------------------------------- |
| Extension button not appearing | Extension not installed or configured | Check extension installation and permissions  |
| API authentication errors      | Invalid API key or URL                | Verify API credentials and endpoint           |
| No tasks generated             | Missing custom fields or prompt       | Check required fields and custom prompt setup |
| Duplicate tasks                | Multiple Service Hooks triggered      | Review Service Hook configuration             |
| Poor task quality              | Generic or poorly designed prompt     | Refine custom prompt with specific context    |

---

## Best Practices

### Configuration Management

1. **Version Control**: Keep configuration templates in version control
2. **Documentation**: Document team-specific customizations
3. **Testing**: Test configuration changes in non-production environments
4. **Security**: Rotate API keys regularly and use secure storage
5. **Monitoring**: Monitor API usage and task generation quality

### Team Adoption

1. **Training**: Train team members on custom prompt creation
2. **Iteration**: Continuously improve prompts based on feedback
3. **Standardization**: Establish consistent configuration patterns
4. **Governance**: Define approval processes for configuration changes

### Performance Optimization

1. **Prompt Length**: Keep prompts concise but specific
2. **Token Limits**: Balance detail with token consumption
3. **Caching**: Leverage configuration caching for better performance
4. **Monitoring**: Track API response times and adjust settings accordingly

---

## Next Steps

After configuring Task Genie:

1. **[Knowledge Base Setup](./knowledge-base-setup.md)** - Upload domain-specific documentation
2. **[Monitoring & Analytics](./monitoring.md)** - Track performance and usage metrics

Ready to customize Task Genie for your team's needs? Start with the configuration method that best fits your current Azure DevOps setup!
