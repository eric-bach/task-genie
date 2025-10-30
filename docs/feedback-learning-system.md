# Task Genie AI Feedback Learning System

## Overview

The Task Genie AI Feedback Learning System automatically captures user behavior in Azure DevOps and uses it to continuously improve AI task generation. The system learns from implicit user actions without requiring manual feedback, making the AI smarter over time through real-world usage patterns.

## Architecture

### System Components

1. **Azure DevOps Service Hooks** - Webhook triggers for task changes
2. **API Gateway** - Routes webhook requests to processing Lambda
3. **TrackTaskFeedback Lambda** - Captures and processes Azure DevOps events
4. **FeedbackService** - Handles feedback data storage, retrieval, and pattern analysis
5. **Enhanced BedrockService** - Integrates feedback learnings into task generation
6. **DynamoDB Feedback Table** - Stores feedback data with efficient querying capabilities

### Data Flow

```
Azure DevOps Task Changes → Service Hook → API Gateway → TrackTaskFeedback Lambda → DynamoDB
                                                                    ↓
BedrockService (Task Generation) ← Feedback Context ← FeedbackService (Pattern Analysis)
```

## Feedback Collection System

### Automated Event Detection

The system automatically captures user actions on tasks through Azure DevOps webhooks:

#### Task Feedback Actions

- **Task Deletion**: User removes a task → `DELETED` (task wasn't useful)
- **Task "Removed" Status**: User sets status to "Removed" → `DELETED` (task wasn't useful)
- **Task Modification**: User edits title/description → `MODIFIED` (task needed improvement)
- **Task Acceptance**: User moves to "Active" without changes → `ACCEPTED` (task was good)
- **Task Completion**: User marks as done → `COMPLETED` (task was successful)
- **Missed Tasks**: User creates additional tasks → `MISSED_TASK` (AI missed something important)

#### AI Task Identification

AI-generated tasks are automatically tagged with "Task Genie" to distinguish them from user-created tasks. This enables the system to:

- Ignore AI task creation events (prevents noise in feedback data)
- Detect when users create additional tasks (indicates missed requirements)
- Track only meaningful user interactions with AI-generated content

### Webhook Event Processing

#### Azure DevOps Event Structure

The system processes different event types with varying data structures:

- **Created Tasks**: `event.resource.fields` contains field data
- **Updated Tasks**: `event.resource.revision.fields` contains old/new values
- **Deleted Tasks**: `event.resource.revision.fields` contains final field values

#### Sample Webhook Payloads

**Task Created Event:**

```json
{
  "eventType": "workitem.created",
  "resource": {
    "id": 12345,
    "workItemType": "Task",
    "fields": {
      "System.Title": "New task title",
      "System.Description": "Task description",
      "System.State": "New",
      "System.Tags": "User Created",
      "System.ChangedBy": "user@company.com"
    },
    "relations": [
      {
        "rel": "System.LinkTypes.Hierarchy-Reverse",
        "url": "https://dev.azure.com/org/project/_apis/wit/workItems/67890"
      }
    ]
  }
}
```

**Task Updated Event:**

```json
{
  "eventType": "workitem.updated",
  "resource": {
    "id": 2,
    "workItemId": 12345,
    "workItemType": "Task",
    "revision": {
      "fields": {
        "System.Title": {
          "oldValue": "Task title",
          "newValue": "Updated task title"
        },
        "System.Description": {
          "oldValue": "Task description",
          "newValue": "Updated task description"
        },
        "System.State": {
          "oldValue": "New",
          "newValue": "Active"
        }
      },
      "relations": [
        {
          "rel": "System.LinkTypes.Hierarchy-Reverse",
          "url": "https://dev.azure.com/org/project/_apis/wit/workItems/67890"
        }
      ]
    }
  }
}
```

**Task Status Changed to "Removed":**

```json
{
  "eventType": "workitem.updated",
  "resource": {
    "id": 2,
    "workItemId": 12345,
    "revision": {
      "fields": {
        "System.Title": {
          "oldValue": "Task title",
          "newValue": "Task title"
        },
        "System.Description": {
          "oldValue": "Task description",
          "newValue": "Task description"
        },
        "System.State": {
          "oldValue": "New",
          "newValue": "Removed"
        }
      }
    }
  }
}
```

**Task Deleted Event:**

```json
{
  "eventType": "workitem.deleted",
  "resource": {
    "id": 12345,
    "revision": {
      "fields": {
        "System.Title": "Task title",
        "System.Description": "Task description",
        "System.State": "New"
      }
    }
  }
}
```

## Learning and Pattern Analysis

### Pattern Recognition

The FeedbackService analyzes feedback to identify:

- **Success Patterns**: Tasks that users accept and complete quickly
- **Anti-Patterns**: Common characteristics of deleted/heavily modified tasks
- **Modification Trends**: How users typically improve AI-generated tasks
- **Missed Task Patterns**: Types of work users commonly add manually
- **Context-Specific Insights**: Patterns by area path, business unit, or system

### Enhanced Feedback Types

#### Missed Task Detection

When users create additional tasks after AI generation:

1. **Detection**: User-created tasks lack "Task Genie" tag
2. **Analysis**: System extracts patterns from user-added task titles/descriptions
3. **Learning**: AI learns what types of tasks it commonly misses
4. **Application**: Future generations include guidance for commonly missed items

**Example Missed Task Learning:**

- AI generates authentication tasks: "Implement login", "Add validation"
- User adds: "Set up OAuth integration", "Implement 2FA"
- System learns to suggest OAuth and 2FA for similar contexts

### AI Learning Integration

#### During Task Generation

The BedrockService integrates feedback learnings by:

1. **Retrieving Context**: Gets relevant patterns for current work item context
2. **Enhancing Queries**: Includes successful examples and anti-patterns in knowledge searches
3. **Augmenting Prompts**: Adds feedback-derived guidance to AI prompts
4. **Including Missed Patterns**: Suggests commonly missed task types
5. **Improving Output**: Generates more accurate and complete task lists

#### Continuous Improvement

- Learning from new feedback in real-time
- Adapting to different team/project contexts
- Identifying and avoiding problematic patterns
- Reinforcing successful approaches
- Calculating missed task rates and improvement metrics

## System Implementation

### Core Features

#### Automatic Learning

- No manual intervention required
- Learns from implicit user behavior
- Continuous improvement over time
- Real-time pattern recognition

#### Context-Aware Intelligence

- Different learnings for different teams/systems
- Area path, business unit, and system-specific patterns
- Confidence-based recommendations
- Team-specific task preferences

#### Comprehensive Feedback Types

All feedback types are automatically detected and processed:

| User Action            | Feedback Type | Learning Signal         | Example                          |
| ---------------------- | ------------- | ----------------------- | -------------------------------- |
| Delete task            | `DELETED`     | Task wasn't useful      | "Remove boilerplate tasks"       |
| Set status "Removed"   | `DELETED`     | Task wasn't useful      | "Avoid overly generic tasks"     |
| Edit task content      | `MODIFIED`    | Task needed improvement | "Add more technical details"     |
| Move to Active         | `ACCEPTED`    | Task was good as-is     | "Use similar task patterns"      |
| Mark completed         | `COMPLETED`   | Task was successful     | "Prioritize similar tasks"       |
| Create additional task | `MISSED_TASK` | AI missed something     | "Include OAuth for auth stories" |

#### Actionable AI Insights

- **Success Examples**: "Tasks like 'Implement API endpoint validation' are typically accepted without modification"
- **Anti-Patterns**: "Avoid vague titles like 'Update system' - users delete these 60% of the time"
- **Improvement Suggestions**: "Add more technical details - 40% of tasks in this context are modified to include implementation specifics"
- **Missed Task Guidance**: "Consider including OAuth integration - 25% of users add this for authentication stories"

### Performance Metrics

#### Core Metrics

- **Task Acceptance Rate**: % of tasks used without modification
- **Task Modification Rate**: % of tasks that users improve
- **Task Deletion Rate**: % of tasks users find unhelpful
- **Missed Task Rate**: % of work items where users add tasks
- **Average Completion Time**: Speed of task completion by type

#### Learning Effectiveness

- Reduction in deletion rate over time
- Increase in acceptance rate as AI learns
- Context-specific improvement tracking
- Pattern confidence scoring

## Learning Scenarios & Examples

### Scenario 1: Eliminating Vague Tasks

**Problem Detected**: Tasks titled "Update documentation" deleted 70% of the time in Frontend projects

**AI Learning**: Avoid generic titles, include specific components

- Enhanced prompts with anti-pattern guidance
- Knowledge base queries focus on specific documentation types

**Result**: Tasks now generated as "Update API documentation for user authentication endpoints"

### Scenario 2: Adding Technical Details

**Problem Detected**: Backend API tasks frequently modified to add implementation specifics

**AI Learning**: Include more technical context in generation

- Enhanced knowledge base queries for implementation patterns
- Prompts include technical detail requirements

**Result**: Tasks include acceptance criteria like "Ensure proper error handling and input validation"

### Scenario 3: Reinforcing Success Patterns

**Success Detected**: Tasks starting with "Implement unit tests for..." have 90% acceptance rate

**AI Learning**: Apply successful patterns more broadly

- Template successful task structures
- Prioritize similar formatting for related contexts

**Result**: More testing tasks use proven successful patterns and complete 30% faster

### Scenario 4: Addressing Missed Tasks

**Gap Detected**: 25% of authentication user stories have users manually adding OAuth tasks

**AI Learning**: Proactively suggest commonly missed work

- Analysis of user-created task patterns
- Integration into AI prompt enhancements

**Result**: Authentication stories now include guidance: "Consider OAuth integration tasks"

### Scenario 5: Context-Specific Adaptation

**Team Pattern**: Mobile team frequently modifies tasks to add platform-specific details

**AI Learning**: Adapt to team-specific preferences

- Team/area path specific pattern recognition
- Context-aware task generation improvements

**Result**: Mobile area tasks automatically include iOS/Android specific considerations

## Deployment & Configuration

### 1. Deploy Infrastructure

```bash
cd infrastructure
npm run build
cdk deploy task-genie-data-stage  # DynamoDB tables and core infrastructure
cdk deploy task-genie-app-stage   # Lambda functions and API Gateway
```

### 2. Configure Azure DevOps Webhooks

#### Step 1: Get Webhook URL

After deployment, find your API Gateway URL:

```bash
# Your webhook URL format:
https://{API_GW_ID}.execute-api.{region}.amazonaws.com/{stage}/feedback/track
```

**URL Components:**

- `{API_GW_ID}`: Your API Gateway ID (AWS Console → API Gateway)
- `{region}`: AWS region (e.g., us-west-2)
- `{stage}`: Deployment stage (prod, stage, dev)

#### Step 2: Create Azure DevOps Service Hooks

**Navigate**: Azure DevOps Project → Project Settings → Service Hooks → "+"

**Required Webhooks:**

1. **Task Updates** (Primary feedback source)

   - **Service**: Web Hooks
   - **Trigger**: Work item updated
   - **Filters**: Work item type = Task
   - **URL**: Your webhook URL
   - **Method**: POST

2. **Task Deletions** (Negative feedback)

   - **Service**: Web Hooks
   - **Trigger**: Work item deleted
   - **Filters**: Work item type = Task
   - **URL**: Your webhook URL
   - **Method**: POST

3. **Task Creation** (Missed task detection)
   - **Service**: Web Hooks
   - **Trigger**: Work item created
   - **Filters**: Work item type = Task
   - **URL**: Your webhook URL
   - **Method**: POST

> **Important**: The system automatically filters out AI-generated task creation events using the "Task Genie" tag to prevent noise in feedback data.

#### Step 3: Webhook Testing & Verification

1. **Test Webhook Delivery:**

   ```bash
   # Create a test task in Azure DevOps
   # Modify task title/description
   # Set task status to "Removed"
   # Delete the task
   ```

2. **Verify Event Processing:**
   ```bash
   # Check CloudWatch Logs: /aws/lambda/trackTaskFeedback
   # Verify DynamoDB: feedback table for new records
   # Monitor API Gateway: request/response metrics
   ```

### 3. System Verification

#### End-to-End Testing

1. **Generate AI Tasks**: Use Task Genie to create tasks for a user story
2. **Create User Interactions**:
   - Accept some tasks (move to Active)
   - Modify others (edit title/description)
   - Delete/remove unhelpful tasks
   - Create additional tasks manually
3. **Verify Feedback Capture**: Check DynamoDB feedback table for recorded events
4. **Test Learning Integration**: Generate new similar tasks and observe improvements in logs

#### Monitoring Setup

- **CloudWatch Dashboards**: Track feedback processing metrics
- **DynamoDB Metrics**: Monitor table performance and storage
- **Learning Effectiveness**: Track improvement trends over time

## Configuration & Monitoring

### Environment Variables

**Required Configuration:**

```bash
FEEDBACK_TABLE_NAME=task-genie-feedback-table
RESULTS_TABLE_NAME=task-genie-results-table
FEEDBACK_FEATURE_ENABLED=true
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
AWS_REGION=us-west-2
```

**Analysis Parameters:**

- `minSampleSize`: Minimum feedback events for pattern recognition (default: 5)
- `analysisWindowDays`: Time window for analysis (default: 30 days)
- `minConfidenceThreshold`: Minimum confidence for using insights (default: 0.6)
- `missedTaskThreshold`: Threshold for missed task rate alerts (default: 0.15)

### Monitoring & Metrics

#### CloudWatch Metrics

- **Feedback Events**: Total processed, by type, error rates
- **Pattern Analysis**: Patterns identified, confidence scores
- **Learning Integration**: AI prompt enhancements, knowledge query improvements
- **Performance**: Processing latency, DynamoDB query times

#### DynamoDB Metrics

- **Storage**: Feedback records count, storage utilization
- **Performance**: Query latency, throttling events
- **Patterns**: Most common feedback types by context

#### AI Improvement Tracking

- **Task Quality Trends**: Acceptance rate improvements over time
- **Context Adaptation**: Team-specific learning effectiveness
- **Missed Task Reduction**: Decrease in user-added tasks
- **Modification Patterns**: Types of improvements users make

### System Benefits

1. **Improved Task Quality** - Tasks become more relevant and actionable over time
2. **Reduced User Effort** - Less manual task editing and fewer missed requirements
3. **Context Adaptation** - AI learns team, project, and domain-specific preferences
4. **Continuous Enhancement** - System automatically improves with more usage
5. **Zero Manual Training** - No configuration or explicit feedback required
6. **Real-Time Learning** - Immediate pattern recognition and application

### Troubleshooting Guide

#### No Feedback Data Collected

```bash
# Check webhook configuration
curl -X POST https://your-api-gateway-url/feedback/track -d '{test payload}'

# Verify Lambda execution
aws logs filter-log-events --log-group-name /aws/lambda/trackTaskFeedback

# Check DynamoDB permissions
aws dynamodb scan --table-name task-genie-feedback-table --limit 5
```

#### Learning Not Applied

```bash
# Verify FeedbackService integration
# Check minimum sample size threshold
# Review pattern confidence scores
# Ensure feedback table name is configured in BedrockService
```

#### Performance Issues

```bash
# Monitor DynamoDB query performance
aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB

# Check Lambda memory/timeout settings
# Review analysis parameter tuning
# Consider implementing result caching for frequently accessed patterns
```

### Future Enhancements

#### Planned Improvements

- **Explicit User Ratings** - Optional task quality scoring interface
- **A/B Testing Framework** - Compare different AI generation approaches
- **Advanced NLP Analysis** - Semantic understanding of task modifications
- **Cross-Project Learning** - Share successful patterns across teams/projects
- **Predictive Quality Scoring** - Predict task acceptance before generation
- **Real-Time Suggestions** - Live task improvement recommendations

#### Integration Opportunities

- **IDE Extensions** - Feedback collection from development environments
- **Jira/GitHub Integration** - Expand beyond Azure DevOps
- **Analytics Dashboards** - Business intelligence for development processes
- **Team Performance Insights** - Task quality metrics for management

---

**Summary**: The Task Genie AI Feedback Learning System creates a continuous improvement loop where user behavior automatically teaches the AI to generate better, more relevant tasks. This zero-effort learning approach ensures the system becomes more valuable with every interaction, adapting to team preferences and eliminating common task generation problems over time.
