---
sidebar_position: 1
---

# Best Practices

Learn the best practices for using Task Genie effectively in your development workflow.

## User Story Writing

### Well-Structured Stories

Write clear, actionable user stories that AI can understand:

#### Good Example ✅

```
**Title:** User Login with Multi-Factor Authentication

**Story:** As a registered user, I want to log in with multi-factor authentication so that my account remains secure even if my password is compromised.

**Acceptance Criteria:**
- User can enter username and password
- System sends MFA code to registered email/SMS
- User can enter MFA code within 5 minutes
- System grants access after successful MFA verification
- Failed MFA attempts are logged and user is locked after 3 attempts
- User receives notification of successful login
```

#### Poor Example ❌

```
**Title:** Login stuff

**Story:** Users need to login

**Acceptance Criteria:**
- Make it work
- Should be secure
```

### Story Template

Use this template for consistent results:

```markdown
**Title:** [Concise, descriptive title]

**Story:** As a [user type], I want [functionality] so that [business value].

**Acceptance Criteria:**

- [Specific, testable criterion]
- [Another specific criterion]
- [Error handling scenarios]
- [Performance requirements]
- [Security considerations]

**Additional Context:**

- [Technical constraints]
- [Integration requirements]
- [UI/UX considerations]
```

## Knowledge Base Management

### Document Organization

Structure your knowledge base for optimal AI retrieval:

#### Project-Scoped Structure

```
docs/
├── architecture/
│   ├── system-overview.md
│   ├── data-flow.md
│   └── integration-patterns.md
├── development/
│   ├── coding-standards.md
│   ├── testing-guidelines.md
│   └── deployment-process.md
├── business/
│   ├── requirements.md
│   ├── user-personas.md
│   └── business-rules.md
└── templates/
    ├── task-templates.md
    ├── code-snippets.md
    └── testing-scenarios.md
```

#### Agile-Guided Structure

```
agile-docs/
├── scrum-guidelines.md
├── definition-of-done.md
├── estimation-guide.md
├── retrospective-templates.md
└── cross-team-standards.md
```

### Document Quality

#### High-Quality Documents ✅

- **Specific and actionable**: Clear steps and requirements
- **Well-structured**: Use headers, lists, and code blocks
- **Current and accurate**: Regularly updated content
- **Context-rich**: Include examples and use cases
- **Searchable**: Use relevant keywords and tags

#### Example: High-Quality Architecture Document

````markdown
# Authentication Service Architecture

## Overview

The authentication service handles user login, registration, and session management using JWT tokens.

## Technology Stack

- **Framework:** Node.js with Express
- **Database:** PostgreSQL with Prisma ORM
- **Caching:** Redis for session storage
- **Security:** bcrypt for password hashing, JWT for tokens

## API Endpoints

### POST /auth/login

Authenticates user and returns JWT token.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

## Security Considerations

- Passwords must be at least 8 characters
- JWT tokens expire after 24 hours
- Rate limiting: 5 attempts per minute per IP
- All endpoints use HTTPS only
````

## Team Configuration

### Prompt Override

Prompt overrides provides the ability to customize and tailor the AI prompt to your specific use case. See [Prompt overrides](/docs/docs/configuration/prompt_overrides.md) for more details.

```text
You are a senior software engineer working on a microservices e-commerce platform.

Context:
- Technology: Node.js, TypeScript, React, PostgreSQL
- Architecture: Event-driven microservices on AWS
- Methodology: Scrum with 2-week sprints
- Team: 5 full-stack developers

Guidelines:
- Generate 3-5 tasks per user story
- Include unit and integration tests
- Consider error handling and edge cases
- Follow SOLID principles and clean architecture
- Estimate effort in story points (1, 2, 3, 5, 8)

Generate development tasks with these requirements:
- Break down into frontend, backend, and testing tasks
- Include database migration tasks when needed
- Consider API documentation updates
- Add deployment and monitoring tasks
- Include security review checkpoints
```

## Next Steps

- [Configure your team settings](../getting-started/configuration.md)
- [Set up knowledge base documents](../configuration/knowledge_base.md)
- [Override prompts for your workflow](../configuration/prompt_overrides.md)
