---
sidebar_position: 1
---

# Knowledge Base

**Task Genie** leverages **Amazon Bedrock Knowledge Bases** with **S3 Vectors** to provide organizational and project context for highly accurate task breakdown. The system supports two distinct knowledge base types, each serving different purposes in the Agile workflow: **Agile (User Story Evaluation)** and **Project (Task Generation)**.

## Knowledge Base Types

**Task Genie** uses Retrieval-Augmented Generation (RAG) to combine AI capabilities with your organization's specific knowledge, ensuring generated tasks and evaluations are contextually relevant and aligned with your team's practices.

| Knowledge Base Type               | Purpose                                                    | Scope                 | When Applied                 |
| --------------------------------- | ---------------------------------------------------------- | --------------------- | ---------------------------- |
| **Agile (User Story Evaluation)** | Improve user story quality assessment                      | Organization-wide     | During user story evaluation |
| **Project (Task Generation)**     | Enhance task breakdown with technical and business context | Team/Project specific | During task generation       |

---

## Agile Knowledge Base (User Story Evaluation)

The Agile Knowledge Base provides organization-wide guidance for evaluating user story quality, ensuring consistency in Agile practices across all teams and projects.

### Purpose and Benefits

#### **User Story Quality Assessment**

- **Best Practices**: Agile methodology guidelines and standards
- **Template Examples**: Well-written user story templates and patterns
- **Common Patterns**: Effective acceptance criteria formats
- **Quality Criteria**: Evaluation rubrics and checklists

#### **Organization-Wide Consistency**

Agile documents apply to all user stories regardless of team, project, or system, ensuring consistent quality standards across the organization.

### How Agile Knowledge Works

#### **Evaluation Query Construction**

**Task Genie** searches the Agile Knowledge Base for any process guidance on evaluating a user story:

```
Find relevant information about the user story process and guidelines that would help evaluate the following user story is well-defined:
- Title: [User Story Title]
- Description: [User Story Description]
- Acceptance Criteria: [Acceptance Criteria]
```

:::warning Retrieval Chunks

**Task Genie** will retrieve up to 3 chunks from the knowledge base

:::

#### **Integration with Story Evaluation**

Retrieved guidance is then added as context to enhances the User Story evaluation process:

```
Additional business or domain context from knowledge base:
- User Story Best Practices: Stories should follow the "As a... I want... So that..." format
- Acceptance Criteria Standards: Use Given/When/Then format for testable scenarios
- Definition of Ready: All stories must include persona, rationale, and clear criteria
```

### Document Organization for Agile Knowledge

#### **Required Metadata**

All Agile documents must use this specific metadata (automatically added by **Task Genie**):

```javascript
{
  "areaPath": "agile-process",
}
```

#### **Content Categories**

Organize Agile content into these categories:

```
Agile Process Knowledge/
├── user-story-standards/
│   ├── story-template-guidelines.md
│   ├── acceptance-criteria-formats.md
│   └── persona-definitions.md
├── quality-criteria/
│   ├── definition-of-ready.md
│   ├── story-evaluation-rubric.md
│   └── common-anti-patterns.md
├── process-guidelines/
│   ├── sprint-planning-best-practices.md
│   ├── backlog-refinement-process.md
│   └── estimation-techniques.md
└── templates-examples/
    ├── epic-breakdown-examples.md
    ├── well-written-story-samples.md
    └── acceptance-criteria-templates.md
```

### Best Practices for Agile Knowledge

**Common Story Problems:**

```markdown
# User Story Anti-Patterns to Avoid

## The "As a Developer" Anti-Pattern

❌ **Wrong:** "As a developer, I want to refactor the authentication module so that code is cleaner"
✅ **Right:** "As a customer, I want faster login response times so that I can access my account quickly"

## The Technical Task Disguised as Story

❌ **Wrong:** "As a user, I want the database to be optimized so that queries run faster"  
✅ **Right:** "As a customer, I want search results to load in under 2 seconds so that I can find products efficiently"

## The Epic Masquerading as Story

❌ **Wrong:** "As a customer, I want a complete e-commerce platform so that I can shop online"
✅ **Right:** "As a customer, I want to add items to my shopping cart so that I can purchase multiple products at once"

## Vague Acceptance Criteria

❌ **Wrong:** "The system should work properly and be user-friendly"
✅ **Right:** "Login succeeds within 3 seconds with valid credentials and displays helpful error messages for invalid attempts"
```

## Project Knowledge Base (Task Generation)

The Project Knowledge Base provides team-specific context to improve the quality and relevance of AI-generated tasks. Documents in this knowledge base are filtered and applied based on the Azure DevOps Boards fields: **Area Path**, **Business Unit**, and **System**.

### Purpose and Benefits

#### **Enhanced Task Generation**

- **Technical Context**: Architecture diagrams, API specifications, coding standards
- **Business Context**: Domain knowledge, business rules, workflow patterns
- **Team Practices**: Development methodologies, testing strategies, deployment procedures
- **System Knowledge**: Component relationships, dependencies, integration patterns

#### **Targeted Application**

Documents are automatically retrieved based on matching criteria:

- **Area Path**: Azure DevOps area path hierarchy
- **Business Unit**: Organizational division (e.g., "Engineering", "Product")
- **System**: Application or service identifier (e.g., "Customer Portal", "Payment Service")

### How Project Knowledge Works

#### **Required Metadata**

Documents are automatically retrieved based on matching criteria:

- **Area Path**: Azure DevOps area path hierarchy
- **Business Unit**: AMA custom field denoting the business unit name
- **System**: AMA custom field denoting the application name

When generating tasks, Task Genie builds search filters based on the user story's metadata:

```javascript
// Example filtering logic
{
  "filter": {
    "andAll": [
      { "equals": { "key": "areaPath", "value": "MyProject\\Team Alpha" } },
      { "equals": { "key": "businessUnit", "value": "Engineering" } },
      { "equals": { "key": "system", "value": "Customer Portal" } }
    ]
  }
}
```

#### **Knowledge Retrieval Query**

**Task Genie** constructs context-aware queries to find relevant documentation:

```
Find relevant information to help with task breakdown (such as technical details,
application architecture, business context, etc.) for the following user story:
- Title: [User Story Title]
- Description: [User Story Description]
- Acceptance Criteria: [Acceptance Criteria]
```

:::warning Retrieval Chunks

**Task Genie** will retrieve up to 3 chunks from the knowledge base

:::

#### **Integration with Task Generation**

Retrieved knowledge is seamlessly integrated into the AI prompt:

```
Here is additional context that you should consider:
- Architecture: The Customer Portal uses React frontend with Node.js backend...
- Business Rules: Payment processing must comply with PCI DSS standards...
- Testing Strategy: All API endpoints require unit tests and integration tests...
```

### Document Organization Structure

#### **Recommended Folder Hierarchy**

Organize your Project documents using this structure:

```
Knowledge Base/
├── [Business Unit]/
│   ├── [System]/
│   │   ├── technical-docs/
│   │   │   ├── api-specifications.md
│   │   │   ├── architecture-diagrams.pdf
│   │   │   └── database-schema.md
│   │   ├── business-rules/
│   │   │   ├── domain-logic.md
│   │   │   ├── workflow-patterns.md
│   │   │   └── compliance-requirements.md
│   │   └── team-practices/
│   │       ├── coding-standards.md
│   │       ├── testing-guidelines.md
│   │       └── deployment-procedures.md
```

### Content Guidelines for Project Documents

#### **Technical Documentation**

**API Specifications:**

```markdown
# Customer API Endpoints

## Authentication

All endpoints require JWT token authentication...

## User Management Endpoints

- POST /api/users - Create new user
- GET /api/users/{id} - Retrieve user details
- PUT /api/users/{id} - Update user information

## Common Response Patterns

All API responses follow this structure:
{
"data": {},
"errors": [],
"meta": {}
}
```

**Architecture Patterns:**

```markdown
# Microservices Architecture

## Service Communication

- Synchronous: REST APIs for real-time operations
- Asynchronous: Event-driven messaging via AWS SQS
- Data Storage: Each service owns its database

## Cross-Cutting Concerns

- Authentication: Centralized via Auth Service
- Logging: Structured logging with CloudWatch
- Monitoring: Prometheus metrics + Grafana dashboards
```

#### **Business Context Documentation**

**Domain Rules:**

```markdown
# Payment Processing Rules

## Validation Requirements

- Credit card numbers must pass Luhn algorithm validation
- Transaction amounts cannot exceed $10,000 without approval
- International transactions require additional verification

## Compliance Standards

- PCI DSS Level 1 compliance required for card data
- GDPR compliance for EU customer data
- SOX compliance for financial reporting
```

**Workflow Patterns:**

```markdown
# User Registration Workflow

## Standard Flow

1. User submits registration form
2. System validates email format and password strength
3. Verification email sent to user
4. User clicks verification link
5. Account activated and welcome email sent

## Exception Handling

- Invalid email: Show inline error, keep form data
- Duplicate email: Offer password reset option
- Email delivery failure: Retry mechanism with exponential backoff
```

#### **Team Practices Documentation**

**Development Standards:**

```markdown
# Code Review Guidelines

## Required Checks

- [ ] All tests pass in CI/CD pipeline
- [ ] Code coverage maintains minimum 80%
- [ ] No security vulnerabilities detected
- [ ] Documentation updated for API changes

## Review Criteria

- Code follows established patterns and conventions
- Error handling is comprehensive and consistent
- Performance implications are considered
- Security best practices are followed
```

### Best Practices for Project Knowledge

#### **Document Quality**

1. **Keep Content Current**: Regular review and update cycles
2. **Use Clear Structure**: Consistent formatting and organization
3. **Include Examples**: Code samples, configuration examples, screenshots
4. **Cross-Reference**: Link related documents and external resources

#### **Metadata Consistency**

1. **Standardize Values**: Use consistent naming conventions for metadata
2. **Document Taxonomy**: Maintain a central registry of valid values
3. **Regular Audits**: Verify metadata accuracy and completeness
4. **Team Training**: Ensure all team members understand the structure

#### **Content Optimization**

1. **Chunk Appropriately**: Break large documents into focused sections
2. **Use Keywords**: Include terms developers commonly search for
3. **Avoid Duplication**: Reference centralized documents when possible
4. **Version Control**: Track document changes and maintain history

---

## Knowledge Base Management

### Document Upload and Synchronization

#### **Upload Process**

1. **Access Knowledge Base Interface**

   - Navigate to **Task Genie** web interface
   - Go to **Knowledge Base** section
   - Choose appropriate knowledge base type

2. **Select Knowledge Base Type**

   - **Project (Task Generation)**: For team-specific technical/business context
   - **Agile (User Story Evaluation)**: For organization-wide process guidance

3. **Configure Metadata**

   - **Project**: Set Area Path, Business Unit, and System
   - **Agile**: Area Path is defaulted to "agile-process"

4. **Upload Documents**
   - Support for `.md`, `.txt`, `.pdf`, `.docx`, `.json` files
   - Maximum file size: 5MB per document
   - Automatic text extraction and chunking

#### **Synchronization Process**

After upload, documents undergo automatic processing:

1. **Text Extraction**: Content extracted from various file formats
2. **Semantic Chunking**: Documents split into 150-token chunks with overlap
3. **Vector Embedding**: Text converted to vector representations for similarity search
4. **Index Integration**: Chunks added to searchable knowledge base index
5. **Metadata Tagging**: Filter metadata applied for targeted retrieval

### Supported File Types and Best Practices

#### **File Format Guidelines**

| File Type          | Best For                           | Optimization Tips                             |
| ------------------ | ---------------------------------- | --------------------------------------------- |
| **Markdown (.md)** | Technical documentation, processes | Use clear headers, bullet points, code blocks |
| **Text (.txt)**    | Simple guidelines, checklists      | Keep formatting minimal but structured        |
| **PDF (.pdf)**     | Formal documents, diagrams         | Ensure text is selectable, not image-based    |
| **Word (.docx)**   | Business documents, templates      | Use styles for consistent formatting          |
| **JSON (.json)**   | API specs, configuration examples  | Include comments and clear structure          |

#### **Content Optimization**

**Effective Knowledge Base Content:**

- **Clear Structure**: Use headers, bullets, and numbered lists
- **Specific Examples**: Include code samples, templates, real scenarios
- **Actionable Information**: Focus on "how-to" rather than theoretical concepts
- **Current Information**: Regular updates to maintain accuracy
- **Searchable Keywords**: Use terms developers and PMs actually search for

**Content to Avoid:**

- **Outdated Information**: Remove or update deprecated practices
- **Sensitive Data**: No credentials, personal info, or confidential details
- **Duplicate Content**: Avoid redundancy across multiple documents
- **Overly Generic Advice**: Focus on organization-specific guidance

---

## Troubleshooting and Optimization

### Common Issues and Solutions

#### **Documents Not Retrieved**

**Problem:** Knowledge base documents aren't being used in task generation.

**Diagnosis Steps:**

1. Verify document metadata matches work item attributes
2. Check knowledge base synchronization status
3. Review query construction and filtering logic
4. Confirm document content relevance to search query

**Solutions:**

- Update document metadata to match Azure DevOps structure
- Resync knowledge base after metadata changes
- Refine document content with more specific keywords
- Split large documents into focused, searchable chunks

#### **Poor Task Quality Despite Knowledge Base**

**Problem:** Generated tasks don't reflect uploaded knowledge.

**Diagnosis Steps:**

1. Review retrieved documents in generation logs
2. Assess document content quality and specificity
3. Check for conflicting or outdated information
4. Evaluate chunk size and content organization

**Solutions:**

- Improve document structure and clarity
- Remove outdated or conflicting content
- Add more specific examples and guidelines
- Optimize chunk size for better context retrieval

#### **Inconsistent Story Evaluations**

**Problem:** Story quality assessments vary unexpectedly.

**Diagnosis Steps:**

1. Review Agile knowledge base content
2. Check for ambiguous or contradictory guidelines
3. Verify universal application of evaluation criteria
4. Compare AI assessments with human reviews

**Solutions:**

- Standardize evaluation criteria and language
- Remove ambiguous or subjective guidance
- Add more specific examples and counter-examples
- Regular calibration against human expert assessments

### Performance Optimization

#### **Retrieval Efficiency**

1. **Optimize Metadata**: Use consistent, specific values for better filtering
2. **Content Quality**: Focus on actionable, specific information
3. **Document Size**: Balance detail with retrievability (aim for 500-2000 words per document)
4. **Regular Cleanup**: Remove outdated or duplicate content

#### **Integration Performance**

1. **Monitor Latency**: Track knowledge retrieval time impact on overall generation
2. **Batch Processing**: Consider async processing for large knowledge bases
3. **Caching Strategy**: Implement caching for frequently accessed content
4. **Incremental Updates**: Use incremental sync for knowledge base updates

---

## Next Steps

After configuring your knowledge bases:

1. **[Prompt Overrides](./prompt_overrides.md)** - Enhance prompts with knowledge base references
2. **[Team Collaboration](../guides/team-collaboration.md)** - Share knowledge management practices
3. **[Analytics & Monitoring](../guides/analytics.md)** - Track knowledge base effectiveness

Ready to enhance **Task Genie** with your organization's knowledge? Start by identifying your most valuable documentation and organizing it into Project and Agile categories!
