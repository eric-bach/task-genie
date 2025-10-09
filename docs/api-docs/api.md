---
id: index
title: API Reference
sidebar_position: 1
---

# API Reference

**Task Genie** provides a REST API for managing AI-powered task generation, configuration settings, and knowledge base documents. The API is built on AWS API Gateway and provides endpoints for workflow execution, configuration management, and knowledge base operations.

## Base URL

The API is deployed on AWS API Gateway with regional endpoints:

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/
```

## Authentication

**Task Genie** uses two types of authentication depending on the endpoint:

- **API Key Required**: Workflow execution endpoints (`/executions`) require an API key in the `X-API-Key` header
- **No Authentication**: Configuration and knowledge base endpoints require a authenticated user session via OAuth

### API Key Usage

```bash
curl -H "X-API-Key: your-api-key-here" \
     -H "Content-Type: application/json" \
     https://api-url/executions
```

## Rate Limiting

The API implements rate limiting through AWS API Gateway Usage Plans:

- **Rate Limit**: 10 requests per second
- **Burst Limit**: 2 concurrent requests
- **Throttling**: Requests exceeding limits return `429 Too Many Requests`

## CORS Configuration

All endpoints support CORS with the following settings:

- **Allowed Origins**: `*` (all origins)
- **Allowed Methods**: `GET, POST, PUT, DELETE, OPTIONS`
- **Allowed Headers**: `Content-Type, X-Amz-Date, X-Api-Key, X-Amz-Security-Token, X-Amz-User-Agent`
- **Credentials**: Supported

## Response Format

All API responses use JSON format with consistent error handling:

### Success Response

```json
{
  "message": "Success message",
  "data": {
    /* response data */
  }
}
```

### Error Response

```json
{
  "message": "Error description",
  "error": "Detailed error information"
}
```

## Endpoints

### Workflow Execution

#### Start Execution

**POST** `/executions`

Starts a new Step Function workflow to process Azure DevOps work items and generate tasks using AI.

**Authentication**: API Key required

**Request Body**:

```json
{
  "resource": {
    "workItemId": "12345",
    "id": "67890",
    "rev": "3",
    "fields": {
      "System.Title": "User Story Title",
      "System.Description": "Detailed description...",
      "System.AreaPath": "MyProject\\Team1",
      "Custom.BusinessUnit": "Engineering",
      "Custom.System": "WebApp"
    }
  },
  "eventType": "workitem.updated",
  "publisherId": "tfs",
  "scope": "all"
}
```

**Response**:

_Success (202 Accepted):_

```json
{
  "message": "Request accepted for processing",
  "executionArn": "arn:aws:states:region:account:execution:state-machine:execution-id",
  "startDate": "2024-01-15T10:30:00.000Z"
}
```

_Error (400 Bad Request):_

```json
{
  "message": "Bad request"
}
```

_Error (500 Internal Server Error):_

```json
{
  "message": "Internal server error"
}
```

**Example**:

```bash
curl -X POST https://api-url/executions \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": {
      "workItemId": "12345",
      "fields": {
        "System.Title": "Implement user authentication",
        "System.AreaPath": "MyProject\\Backend"
      }
    }
  }'
```

#### Poll Execution Status

**GET** `/executions/{executionId}`

Polls the status of a Step Function execution and retrieves results when complete.

**Authentication**: API Key required

**Path Parameters**:

- `executionId` (string, required): URL-encoded execution ARN or ID

**Response**:

_Success - Execution Complete (200 OK):_

```json
{
  "status": "completed",
  "executionId": "arn:aws:states:region:account:execution:state-machine:execution-id",
  "result": {
    "statusCode": 200,
    "body": {
      "message": "Tasks created successfully",
      "tasksCreated": 3,
      "workItemId": "12345"
    }
  }
}
```

_Success - Execution Running (202 Accepted):_

```json
{
  "status": "running",
  "executionId": "arn:aws:states:region:account:execution:state-machine:execution-id",
  "message": "Step function execution is still in progress"
}
```

_Error (400 Bad Request):_

```json
{
  "error": "Missing executionId parameter",
  "message": "executionId is required in the path parameters"
}
```

**Example**:

```bash
curl -H "X-API-Key: your-api-key" \
     "https://api-url/executions/arn%3Aaws%3Astates%3Aregion%3Aaccount%3Aexecution%3Astate-machine%3Aexecution-id"
```

### Configuration Management

#### Create/Update Configuration

**PUT** `/config`

Creates or updates team-specific prompt configurations for AI task generation.

**Authentication**: None required

**Request Body**:

```json
{
  "areaPath": "MyProject\\Team1",
  "businessUnit": "Engineering",
  "system": "WebApp",
  "prompt": "Generate detailed technical tasks focusing on security and performance. Include acceptance criteria and testing requirements.",
  "username": "user@example.com"
}
```

**Response**:

_Success (200 OK):_

```json
{
  "message": "Configuration updated successfully",
  "adoKey": "MyProject|Team1|Engineering|WebApp"
}
```

_Error (400 Bad Request):_

```json
{
  "message": "Missing required fields: areaPath, businessUnit, system, prompt, username"
}
```

**Example**:

```bash
curl -X PUT https://api-url/config \
  -H "Content-Type: application/json" \
  -d '{
    "areaPath": "MyProject\\Backend",
    "businessUnit": "Engineering",
    "system": "API",
    "prompt": "Focus on API design patterns and error handling",
    "username": "developer@company.com"
  }'
```

#### List Configurations

**GET** `/config`

Retrieves all prompt configurations with pagination support.

**Authentication**: None required

**Query Parameters**:

- `pageSize` (number, optional): Number of items per page (max 100, default 50)
- `nextToken` (string, optional): Pagination token for next page

**Response**:

_Success (200 OK):_

```json
{
  "items": [
    {
      "adoKey": "MyProject|Team1|Engineering|WebApp",
      "areaPath": "MyProject\\Team1",
      "businessUnit": "Engineering",
      "system": "WebApp",
      "prompt": "Generate detailed technical tasks...",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "createdBy": "user@example.com",
      "updatedAt": "2024-01-16T14:20:00.000Z",
      "updatedBy": "user@example.com"
    }
  ],
  "nextToken": "base64-encoded-continuation-token",
  "count": 1
}
```

**Example**:

```bash
curl "https://api-url/config?pageSize=25"
```

#### Delete Configuration

**DELETE** `/config`

Deletes a specific prompt configuration.

**Authentication**: None required

**Query Parameters**:

- `areaPath` (string, required): Area path of the configuration to delete
- `businessUnit` (string, required): Business unit of the configuration
- `system` (string, required): System of the configuration

**Response**:

_Success (200 OK):_

```json
{
  "message": "Configuration deleted successfully"
}
```

_Error (404 Not Found):_

```json
{
  "message": "Configuration not found"
}
```

**Example**:

```bash
curl -X DELETE "https://api-url/config?areaPath=MyProject%5CTeam1&businessUnit=Engineering&system=WebApp"
```

### Knowledge Base Management

#### Generate Upload URL

**GET** `/knowledge-base/presigned-url`

Generates a presigned URL for uploading documents to the knowledge base S3 bucket.

**Authentication**: None required

**Query Parameters**:

- `areaPath` (string, required): Area path for organizing the document
- `businessUnit` (string, optional): Business unit classification
- `system` (string, optional): System classification
- `fileName` (string, required): Name of the file to upload
- `username` (string, optional): Username for audit tracking

**Response**:

_Success (200 OK):_

```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket-name/path/file.pdf?presigned-params",
  "key": "project-scoped/MyProject/Team1/Engineering/WebApp/document.pdf",
  "expires": "2024-01-15T11:30:00.000Z"
}
```

_Error (400 Bad Request):_

```json
{
  "error": "areaPath parameter is required"
}
```

**Example**:

```bash
curl "https://api-url/knowledge-base/presigned-url?areaPath=MyProject%5CTeam1&fileName=requirements.pdf&username=user@example.com"
```

#### List Knowledge Base Documents

**GET** `/knowledge-base/documents`

Lists documents in the knowledge base with filtering and pagination.

**Authentication**: None required

**Query Parameters**:

- `areaPath` (string, optional): Filter by area path
- `businessUnit` (string, optional): Filter by business unit
- `system` (string, optional): Filter by system
- `pageSize` (number, optional): Number of items per page (default 50)
- `nextToken` (string, optional): Pagination token

**Response**:

_Success (200 OK):_

```json
{
  "documents": [
    {
      "key": "project-scoped/MyProject/Team1/Engineering/WebApp/requirements.pdf",
      "fileName": "requirements.pdf",
      "size": 1024576,
      "lastModified": "2024-01-15T10:30:00.000Z",
      "areaPath": "MyProject\\Team1",
      "businessUnit": "Engineering",
      "system": "WebApp"
    }
  ],
  "nextToken": "continuation-token",
  "count": 1
}
```

**Example**:

```bash
curl "https://api-url/knowledge-base/documents?areaPath=MyProject%5CTeam1"
```

#### Delete Knowledge Base Document

**DELETE** `/knowledge-base/documents`

Deletes a document from the knowledge base.

**Authentication**: None required

**Query Parameters**:

- `key` (string, required): S3 key of the document to delete
- `username` (string, optional): Username for audit tracking

**Response**:

_Success (200 OK):_

```json
{
  "message": "Document deleted successfully",
  "key": "project-scoped/MyProject/Team1/document.pdf"
}
```

_Error (404 Not Found):_

```json
{
  "error": "Document not found",
  "key": "invalid-key"
}
```

**Example**:

```bash
curl -X DELETE "https://api-url/knowledge-base/documents?key=project-scoped%2FMyProject%2FTeam1%2Fdocument.pdf"
```

## Error Codes

| Status Code | Description           | Common Causes                                      |
| ----------- | --------------------- | -------------------------------------------------- |
| 200         | Success               | Request completed successfully                     |
| 202         | Accepted              | Request accepted for processing (async operations) |
| 400         | Bad Request           | Missing required parameters, invalid JSON          |
| 401         | Unauthorized          | Missing or invalid API key                         |
| 404         | Not Found             | Resource not found                                 |
| 405         | Method Not Allowed    | HTTP method not supported for endpoint             |
| 429         | Too Many Requests     | Rate limit exceeded                                |
| 500         | Internal Server Error | Server-side error, check logs                      |

## Webhook Integration

For Azure DevOps Service Hooks integration, configure your webhook to POST to the `/executions` endpoint:

**Webhook URL**: `https://your-api-url/executions`

**Headers**:

```
Content-Type: application/json
X-API-Key: your-api-key
```

**Payload**: Azure DevOps automatically sends work item data in the correct format.
