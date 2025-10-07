---
sidebar_position: 2
---

# Prompt Overrides

**Task Genie** comes default with a standard built-in `software development` prompt. **Prompt Overrides** allows customization on how the AI generates tasks by replacing the default prompt with specific instructions. This powerful feature enables teams to fine-tune the default prompt and/or tailor task generation to team specific development practices, coding standards, and domain-specific requirements.

## How Prompt Overrides Work

### Prompt Resolution Process

When Task Genie generates tasks, it follows this resolution hierarchy:

```mermaid
graph TD
    A[Task Generation Request] --> B{Parameter Prompt Provided?}
    B -->|Yes| C[Use Parameter Prompt]
    B -->|No|  D{Database Config Exists?}
    D -->|Yes| E[Use Stored Team Prompt]
    D -->|No|  F[Use Default System Prompt]

    C --> G[Generate Tasks with Custom Instructions]
    E --> G
    F --> H[Generate Tasks with Standard Instructions]
```

## Configuration

### Configuration Structure

Each prompt override configuration contains:

```javascript
{
  "adoKey": "MyProject\\Team Alpha#Engineering#Customer Portal",
  "areaPath": "MyProject\\Team Alpha",
  "businessUnit": "Engineering",
  "system": "Customer Portal",
  "prompt": "Your custom task generation instructions...",
  "createdAt": "2025-09-23T10:30:00Z",
  "createdBy": "developer@company.com",
  "updatedAt": "2025-09-23T15:45:00Z",
  "updatedBy": "teamlead@company.com"
}
```

### Lookup Mechanism

Task Genie automatically retrieves the appropriate prompt using a composite key made up of the **Area Path**, **Business Unit**, and **System**:

```
adoKey = "{areaPath}#{businessUnit}#{system}"
```

**Example Lookup:**

- Work Item Area Path: `"MyProject\Team Alpha"`
- Work Item Business Unit: `"Engineering"`
- Work Item System: `"Customer Portal"`
- Generated Key: `"MyProject\\Team Alpha#Engineering#Customer Portal"`

### Configuration Management

#### **Creating New Prompt Overrides**

1. **Access Configuration Interface**

   - Navigate to Task Genie web interface
   - Go to **Configuration** → **Prompt Overrides**
   - Click **New Override** button

2. **Set Targeting Parameters**

   ```
   Area Path: Select from your Azure DevOps area paths
   Business Unit: Choose organizational unit (e.g., "Engineering")
   System: Specify target application (e.g., "Customer Portal")
   ```

3. **Write Custom Prompt**

   - Enter your team-specific task generation instructions
   - Focus on development methodology, coding standards, testing requirements
   - Include domain-specific context and business rules

4. **Save and Activate**
   - Configuration is immediately active for matching work items
   - All future task generation will use the custom prompt
   - Historical tasks are not affected

#### **Editing Existing Configurations**

1. **Locate Configuration**

   - Browse existing prompt overrides in the web interface
   - Use filters to find specific team configurations

2. **Edit Prompt Only**

   - Area Path, Business Unit, and System are immutable after creation
   - Only the custom prompt text can be modified
   - This prevents accidental targeting changes

3. **Version Control**
   - Each edit updates the `updatedAt` timestamp and `updatedBy` field
   - Consider maintaining prompt documentation in your team's repository

#### **Deleting Configurations**

1. **Confirmation Required**

   - Type "confirm" to proceed with deletion
   - Action cannot be undone
   - Affected work items will fall back to default prompt

2. **Impact Assessment**
   - Review which work items will be affected
   - Consider the number of stories in your backlog matching the configuration
   - Coordinate with team members before deletion

---

## Prompt Design Best Practices

### Effective Prompt Structure

#### **Start with Context Setting**

```text
You are a senior [role] working on [system/application] using [technology stack].
Your team follows [development methodology] and prioritizes [key values].

Focus on creating tasks that align with:
- [Coding standards and practices]
- [Testing requirements]
- [Architecture patterns]
- [Business rules and constraints]
```

#### **Include Specific Instructions**

```text
For each user story, generate tasks that include:

DEVELOPMENT TASKS:
- Break down into frontend, backend, and database components
- Include specific API endpoints and data models needed
- Reference existing patterns and reusable components

TESTING TASKS:
- Unit tests for all new functions and classes
- Integration tests for API endpoints
- E2E tests for complete user workflows
- Performance tests for critical paths

DOCUMENTATION TASKS:
- Update API documentation for new endpoints
- Create/update user guides for new features
- Update technical documentation for architecture changes
```

#### **Define Quality Standards**

```text
Each task should:
- Be completable within 4-8 hours by a mid-level developer
- Have clear acceptance criteria and definition of done
- Include references to relevant documentation or examples
- Consider error handling, validation, and edge cases
- Specify testing requirements and success metrics
```

### Domain-Specific Examples

#### **E-commerce Platform**

```text
You are an experienced e-commerce developer working on our online retail platform.
Our stack includes React frontend, Node.js/Express backend, PostgreSQL database, and Redis cache.

When generating tasks, consider:

BUSINESS RULES:
- All transactions must be ACID compliant
- PCI DSS compliance required for payment data
- Inventory updates must be atomic and consistent
- Customer data requires GDPR compliance

ARCHITECTURE PATTERNS:
- Use microservices for order, inventory, and payment domains
- Implement event-driven messaging for cross-service communication
- Apply CQRS pattern for read/write separation in high-traffic areas
- Use repository pattern for data access layer

DEVELOPMENT STANDARDS:
- All API endpoints must include rate limiting and authentication
- Database migrations must be backwards compatible
- Frontend components should be responsive and accessible (WCAG 2.1)
- Error messages must be user-friendly and actionable

Generate 4-6 specific, actionable tasks that follow these guidelines.
```

#### **Financial Services Application**

```text
You are a fintech developer working on our banking application platform.
Technology stack: Angular frontend, Java Spring Boot backend, Oracle database, Apache Kafka messaging.

Consider these requirements in all tasks:

COMPLIANCE & SECURITY:
- SOX compliance for financial reporting features
- Multi-factor authentication for sensitive operations
- Audit trails required for all data modifications
- Encryption at rest and in transit for PII

TECHNICAL STANDARDS:
- Use Spring Security for authentication and authorization
- Implement circuit breaker pattern for external service calls
- All database transactions must support rollback
- API responses must include correlation IDs for tracing

BUSINESS LOGIC:
- Financial calculations must use BigDecimal for precision
- Transaction limits must be enforced at multiple layers
- Real-time fraud detection integration required
- Regulatory reporting data must be immutable once created

Focus on creating tasks that address security, compliance, and reliability.
```

#### **Healthcare Application**

```text
You are a healthcare software developer working on our patient management system.
Stack: Vue.js frontend, Python Django backend, PostgreSQL database, Redis caching.

Healthcare-specific considerations:

COMPLIANCE REQUIREMENTS:
- HIPAA compliance for all patient data handling
- HL7 FHIR standards for healthcare data exchange
- Audit logs required for all patient data access
- Data retention policies must be configurable

TECHNICAL REQUIREMENTS:
- Zero-downtime deployments (patient care cannot be interrupted)
- Sub-second response times for critical patient lookup
- Offline capability for mobile devices in clinical areas
- Integration with existing Electronic Health Record (EHR) systems

CLINICAL WORKFLOW:
- Tasks must align with clinical decision-making processes
- User interfaces should minimize clicks and cognitive load
- Error prevention is critical (patient safety implications)
- Role-based access control with granular permissions

Generate tasks that prioritize patient safety and clinical workflow efficiency.
```

### Prompt Optimization Techniques

#### **Iterative Refinement**

1. **Start Simple**

   - Begin with basic team-specific instructions
   - Test with 3-5 representative user stories
   - Identify common gaps in generated tasks

2. **Add Specificity**

   - Include specific technology names and patterns
   - Reference internal tools and processes
   - Add examples of well-written tasks

3. **Address Edge Cases**

   - Handle integration scenarios
   - Include performance and security considerations
   - Address error handling and validation requirements

4. **Continuous Improvement**
   - Gather feedback from developers using generated tasks
   - Monitor task completion rates and quality
   - Refine prompts based on retrospective insights

#### **Testing and Validation**

1. **Representative Scenarios**

   - Test with various story types (feature, bug fix, technical debt)
   - Include stories of different complexity levels
   - Validate with both simple and complex acceptance criteria

2. **Quality Metrics**

   - Task clarity and actionability
   - Appropriate scope and granularity
   - Technical accuracy and feasibility
   - Alignment with team practices

3. **Team Review Process**
   - Have team members review and rate generated tasks
   - Compare custom prompt results with default prompt output
   - Iterate based on developer feedback and suggestions

---

## System Integration

### Automatic Context Enhancement

All custom prompts are automatically enhanced with contextual information:

#### **Work Item Context Injection**

```text
Your custom prompt...

**Context**
- Here is the work item:
  - Title: {User Story Title}
  - Description: {Detailed Description}
  - Acceptance Criteria: {Given/When/Then scenarios}

- Here are the tasks that have already been created for this work item (if any):
  {Existing Task List or "None"}

- Here are the images referenced (if any were included):
  {Image URLs and descriptions}

- Here is additional context that you should consider (if any were provided):
  {Knowledge Base Content}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "tasks": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object.
```

#### **Knowledge Base Integration**

Custom prompts work seamlessly with the Knowledge Base system:

- **Project-Scoped Knowledge**: Automatically retrieves team-specific technical documentation
- **Contextual Enhancement**: Adds relevant architecture, API specs, and business rules
- **Prompt Augmentation**: Knowledge base content enhances custom prompt instructions

Example of enhanced prompt with knowledge base content:

```text
Your custom prompt: "Generate React component tasks following our design system..."

Enhanced with knowledge base:
- Design System Documentation: "Use styled-components with theme tokens..."
- API Standards: "All API calls should use our custom useApi hook..."
- Testing Guidelines: "React components require Jest + React Testing Library tests..."
```

### Performance Considerations

#### **Prompt Length Optimization**

1. **Token Efficiency**

   - Keep prompts concise while maintaining specificity
   - Use bullet points and structured formatting
   - Avoid redundant or overly verbose instructions

2. **Context Window Management**

   - Balance custom prompt length with context injection needs
   - Consider that knowledge base content also consumes tokens
   - Monitor total prompt length to stay within model limits

3. **Response Quality vs. Speed**
   - Longer, more detailed prompts may produce higher quality tasks
   - Shorter prompts result in faster generation times
   - Find the optimal balance for your team's needs

#### **Caching and Performance**

1. **Database Configuration Caching**

   - Prompt configurations are cached for performance
   - Changes take effect immediately for new requests
   - No need to restart services after prompt updates

2. **Parameter Override Processing**
   - Parameter-based prompts bypass database lookup
   - Slightly faster processing for one-off customizations
   - Useful for high-frequency API usage scenarios

---

### Troubleshooting Common Issues

#### **Prompt Override Not Applied**

**Symptoms:**

- Tasks generated using default prompt despite custom configuration
- No indication of custom prompt usage in logs

**Diagnostic Steps:**

1. Verify work item metadata matches configuration targeting

   ```
   Work Item Area Path: "MyProject\Team Alpha"
   Config Area Path: "MyProject\\Team Alpha"  // Note: exact match required
   ```

2. Check configuration status in web interface

   - Ensure configuration exists and is not deleted
   - Verify prompt content is not empty

3. Review system logs for prompt resolution
   - Look for "Using prompt override" log messages
   - Check for database connectivity issues

**Solutions:**

- Update work item fields to match configuration exactly
- Recreate configuration with correct targeting parameters
- Verify database permissions and connectivity

#### **Poor Task Quality with Custom Prompts**

**Symptoms:**

- Generated tasks are unclear, incomplete, or inappropriate
- Tasks don't follow team standards despite custom instructions

**Diagnostic Steps:**

1. Review prompt content for clarity and specificity
2. Test prompt with various user story types
3. Compare results with default prompt output

**Solutions:**

- Add more specific instructions and examples
- Include context about team practices and standards
- Break complex prompts into structured sections
- Iterate based on developer feedback

#### **Parameter Override Not Working**

**Symptoms:**

- Custom prompt provided in API request is ignored
- Database configuration used instead of parameter

**Diagnostic Steps:**

1. Verify API request format and parameter structure
2. Check for parameter validation errors
3. Review request logs for prompt resolution messages

**Solutions:**

- Ensure prompt parameter is included in correct request section
- Validate JSON structure and parameter formatting
- Check for authentication and permission issues

---

## Advanced Use Cases

### Multi-Team Configurations

#### **Hierarchical Prompt Management**

Organize prompts for complex organizational structures:

```
Organization Structure:
├── Engineering Division
│   ├── Platform Team (Infrastructure focus)
│   ├── Frontend Team (UI/UX focus)
│   └── Backend Team (API/Database focus)
├── Product Division
│   ├── Mobile Team (iOS/Android focus)
│   └── Web Team (React/Vue focus)
```

**Configuration Strategy:**

```javascript
// Platform Team Configuration
{
  "areaPath": "Engineering\\Platform",
  "businessUnit": "Engineering",
  "system": "Infrastructure",
  "prompt": "Focus on scalability, DevOps, and infrastructure tasks..."
}

// Frontend Team Configuration
{
  "areaPath": "Engineering\\Frontend",
  "businessUnit": "Engineering",
  "system": "Web Application",
  "prompt": "Emphasize React components, accessibility, and responsive design..."
}
```

#### **Cross-Team Consistency**

Maintain consistency while allowing team-specific customization:

```text
Base Prompt Template:
You are a {ROLE} working on {SYSTEM} using {TECH_STACK}.

Standard Requirements (All Teams):
- Follow company coding standards and review process
- Include comprehensive testing at unit, integration, and E2E levels
- Consider security, performance, and accessibility implications
- Document APIs and update relevant technical documentation

Team-Specific Instructions:
{CUSTOM_TEAM_INSTRUCTIONS}

Generate 4-6 tasks following these guidelines.
```

### A/B Testing Custom Prompts

#### **Prompt Experimentation**

Test different prompt approaches:

1. **Baseline Measurement**

   - Establish metrics with default prompt
   - Track task quality, completion time, developer satisfaction

2. **Controlled Testing**

   - Create alternative prompt versions
   - Use parameter overrides for testing
   - Compare results across similar user stories

3. **Data-Driven Decisions**
   - Measure improvement in task quality metrics
   - Gather developer feedback on both versions
   - Implement winning approach as database configuration

#### **Gradual Rollout Strategy**

1. **Team Testing Phase**

   - Start with parameter overrides for specific stories
   - Gather feedback from team members
   - Refine prompt based on initial results

2. **Limited Deployment**

   - Create database configuration for subset of work items
   - Monitor performance and quality metrics
   - Address any issues before full deployment

3. **Full Implementation**
   - Apply configuration to all matching work items
   - Continue monitoring and iterating based on usage
   - Share successful patterns with other teams

### Integration with Development Workflow

#### **Continuous Improvement Process**

1. **Sprint Retrospectives**

   - Review generated task quality and relevance
   - Identify prompt improvement opportunities
   - Update configurations based on team feedback

2. **Onboarding New Team Members**

   - Use custom prompts to reflect current team practices
   - Update prompts as team practices evolve
   - Ensure generated tasks help new developers understand workflow

3. **Process Evolution**
   - Update prompts when adopting new technologies
   - Reflect changes in coding standards and practices
   - Maintain alignment with organizational goals

---

## Next Steps

After implementing prompt overrides:

1. **[Knowledge Base Integration](./knowledge_base.md)** - Enhance prompts with organizational knowledge
2. **[Team Collaboration Guide](../guides/team-collaboration.md)** - Share prompt management practices
3. **[Analytics & Monitoring](../guides/analytics.md)** - Track prompt effectiveness and usage

Ready to customize Task Genie for your team's specific needs? Start with the configuration method that matches your current workflow and begin creating prompts that reflect your development practices!
