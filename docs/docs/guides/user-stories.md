---
sidebar_position: 1
---

# Working with Azure DevOps User Stories

This guide explains how Task Genie integrates with Azure DevOps User Stories to generate development tasks with the **Azure DevOps Extension**.

## Creating a New User Story

### User Story Creation

1. **Navigate to Azure DevOps Boards**
   - Open your Azure DevOps project
   - Go to **Boards** → **Work Items**
   - Click **New Work Item** → **User Story**

2. **Fill in Required Fields**

   Fill in these essential fields for optimal Task Genie results:

   ```
   Title: As a [user type], I want to [goal] so that [benefit]

   Description: Detailed explanation of the feature including:
   - Business context and rationale
   - User personas and scenarios
   - Technical considerations
   - Dependencies and constraints

   Acceptance Criteria: Clear, testable criteria such as:
   - Given [context]
   - When [action]
   - Then [expected result]

   Area Path: Select your team's area path
   Custom.BusinessUnit: Your business unit (e.g., "Engineering")
   Custom.System: Target system (e.g., "Customer Portal")
   ```

3. **Save the User Story**
   - Click **Save & Close** or **Save**

### Generating Tasks (Extension)

With the Azure DevOps Extension installed, you have full control over when Task Genie processes your stories.

#### **Step 1: Create the User Story**

Follow the process above to create and save your User Story with all required fields.

#### **Step 2: Manual Task Generation**

1. **Open the User Story**
   - Navigate to your saved User Story
   - The Task Genie button appears in the work item form

2. **Click "Generate Tasks"**
   - Click the **Generate Tasks** button
   - Task Genie processes the story immediately
   - A status message shows processing progress

3. **Monitor Processing**
   - Watch for status updates in the button area
   - Processing typically takes 30-60 seconds
   - Success/error messages appear when complete

#### **Benefits of Manual Workflow**

- **Timing Control**: Generate tasks when story is fully refined
- **Selective Processing**: Only process stories that need task breakdown
- **Iterative Refinement**: Regenerate tasks after story updates
- **Review Before Generation**: Ensure story quality before task creation

---

### Updating Process

With the Extension workflow, you control when updates are processed:

#### **Update Process**

1. **Edit Your User Story**
   - Make all desired changes to Title, Description, Acceptance Criteria
   - Save your changes

2. **Regenerate Tasks When Ready**
   - Click the **Generate Tasks** button
   - Task Genie processes the updated story
   - New tasks are created based on current story state

#### **Best Practices for Updates**

- **Complete Your Edits First**: Make all changes before regenerating tasks
- **Review Existing Tasks**: Check if current tasks still align with updated story
- **Clean Up Duplicates**: Remove obsolete tasks before generating new ones
- **Preserve Work**: Consider task history and work already completed

---

## Task Genie Tag System

Task Genie uses a tagging system to track and organize generated tasks, making it easy to identify AI-generated work items and manage the task generation lifecycle.

### Automatic Tagging

#### **Standard Tags Applied**

Task Genie automatically applies these tags to generated tasks:

| Tag               | Purpose                         | Applied To               |
| ----------------- | ------------------------------- | ------------------------ |
| `task-genie`      | Identifies AI-generated tasks   | All generated tasks      |
| `auto-generated`  | Distinguishes from manual tasks | All generated tasks      |
| `v{version}`      | Tracks generation iteration     | Tasks from story updates |
| `{business-unit}` | Organizational grouping         | Team-specific tasks      |
| `{system}`        | System/application context      | System-specific tasks    |

#### **Example Tag Configuration**

```
Tags: task-genie, auto-generated, v1, engineering, customer-portal
```

### Tag-Based Management

#### **Filtering and Queries**

Use tags to create useful Azure DevOps queries:

**Find All Task Genie Tasks:**

```
Tags Contains "task-genie"
```

**Find Tasks by System:**

```
Tags Contains "customer-portal" AND Tags Contains "task-genie"
```

**Find Latest Task Generation:**

```
Tags Contains "v2" AND Tags Contains "task-genie"
```

#### **Bulk Operations**

Tags enable efficient bulk operations:

1. **Bulk Assignment**: Select all tasks with specific tags
2. **Progress Tracking**: Monitor completion of AI-generated tasks
3. **Cleanup Operations**: Remove obsolete task generations
4. **Reporting**: Analyze task generation effectiveness

### Custom Tagging Strategy

#### **Team-Specific Tags**

Configure additional tags in your custom prompts:

```
Add these tags to generated tasks:
- sprint-{number}: Current sprint identifier
- priority-{level}: Task priority level
- component-{name}: System component affected
- effort-{size}: Estimated effort (S/M/L/XL)
```

#### **Integration with Azure DevOps**

Tags integrate seamlessly with Azure DevOps features:

- **Board Filtering**: Filter Kanban boards by Task Genie tags
- **Dashboard Widgets**: Create widgets showing AI-generated task progress
- **Analytics**: Track velocity and completion rates for generated tasks
- **Automation Rules**: Create rules based on tag combinations

---

## Workflow Best Practices

#### **Strategic Generation**

1. **Refine Before Generation**: Ensure story quality before clicking generate
2. **Iterative Improvement**: Regenerate after story refinements
3. **Selective Processing**: Only generate tasks for stories needing breakdown
4. **Team Coordination**: Coordinate generation timing with team activities

#### **Quality Control**

1. **Review Before Generation**: Validate story completeness
2. **Customize Context**: Ensure business unit and system fields are accurate
3. **Post-Generation Review**: Thoroughly review and refine generated tasks
4. **Team Feedback**: Gather team input on task quality and usefulness

---

## Troubleshooting Common Issues

### Extension Issues

**Generate Tasks Button Not Appearing**

- Verify extension is installed and configured
- Check that custom control is added to User Story layout
- Ensure proper permissions for extension usage
- Confirm API URL and API Key are configured correctly

**Button Click Not Working**

- Check browser developer tools for JavaScript errors
- Verify API connectivity and authentication
- Ensure User Story has required custom fields
- Review extension configuration parameters

### General Quality Issues

**Poor Task Quality**

- Review and refine custom prompt templates
- Ensure User Stories follow best practices
- Add more context to story descriptions
- Upload relevant documentation to knowledge base

**Tasks Don't Match Team Practices**

- Customize prompts for your development methodology
- Include team-specific coding standards in prompts
- Add technical context to knowledge base
- Iterate on prompt design based on team feedback

---

## Next Steps

After mastering User Story workflows with Task Genie:

2. **[Knowledge Base Management](./knowledge-base.md)** - Upload team-specific documentation
3. **[Analytics & Reporting](./analytics.md)** - Track task generation effectiveness

Ready to streamline your User Story workflow? Choose the integration method that best fits your team's needs and start generating high-quality development tasks automatically!
