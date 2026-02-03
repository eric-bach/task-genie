import express from 'express';
import { Agent, BedrockModel } from '@strands-agents/sdk';
import { finalize_response } from './tools/agent-tools.js';
import {
  get_work_item,
  add_comment,
  add_tag,
  get_child_work_items,
  create_child_work_items,
} from './tools/azure-devops-tools.js';
import { evaluate_work_item, generate_work_items } from './tools/bedrock-tools.js';
import {
  create_incomplete_work_item_metric,
  create_work_item_generated_metric,
  create_work_item_updated_metric,
} from './tools/cloudwatch-tools.js';

const PORT = process.env.PORT || 8080;

// Validate required environment variables
const AWS_REGION = process.env.AWS_REGION;
if (!AWS_REGION) {
  throw new Error('AWS_REGION environment variable is required');
}
const AWS_BEDROCK_MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID;
if (!AWS_BEDROCK_MODEL_ID) {
  throw new Error('AWS_BEDROCK_MODEL_ID environment variable is required');
}
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;
if (!AWS_BEDROCK_KNOWLEDGE_BASE_ID) {
  throw new Error('AWS_BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
}
const RESULTS_TABLE_NAME = process.env.RESULTS_TABLE_NAME;
if (!RESULTS_TABLE_NAME) {
  throw new Error('RESULTS_TABLE_NAME environment variable is required');
}
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME;
if (!CONFIG_TABLE_NAME) {
  throw new Error('CONFIG_TABLE_NAME environment variable is required');
}
const AZURE_DEVOPS_ORGANIZATION = process.env.AZURE_DEVOPS_ORGANIZATION;
if (!AZURE_DEVOPS_ORGANIZATION) {
  throw new Error('AZURE_DEVOPS_ORGANIZATION environment variable is required');
}
const AZURE_DEVOPS_CREDENTIALS_SECRET_NAME = process.env.AZURE_DEVOPS_CREDENTIALS_SECRET_NAME;
if (!AZURE_DEVOPS_CREDENTIALS_SECRET_NAME) {
  throw new Error('AZURE_DEVOPS_CREDENTIALS_SECRET_NAME environment variable is required');
}
const AZURE_DEVOPS_SCOPE = process.env.AZURE_DEVOPS_SCOPE;
if (!AZURE_DEVOPS_SCOPE) {
  throw new Error('AZURE_DEVOPS_SCOPE environment variable is required');
}
const AZURE_DEVOPS_TENANT_ID = process.env.AZURE_DEVOPS_TENANT_ID;
if (!AZURE_DEVOPS_TENANT_ID) {
  throw new Error('AZURE_DEVOPS_TENANT_ID environment variable is required');
}
const AZURE_DEVOPS_CLIENT_ID = process.env.AZURE_DEVOPS_CLIENT_ID;
if (!AZURE_DEVOPS_CLIENT_ID) {
  throw new Error('AZURE_DEVOPS_CLIENT_ID environment variable is required');
}
const AZURE_DEVOPS_CLIENT_SECRET = process.env.AZURE_DEVOPS_CLIENT_SECRET;
if (!AZURE_DEVOPS_CLIENT_SECRET) {
  throw new Error('AZURE_DEVOPS_CLIENT_SECRET environment variable is required');
}
const FEEDBACK_FEATURE_ENABLED = process.env.FEEDBACK_FEATURE_ENABLED === 'true';
const FEEDBACK_TABLE_NAME = process.env.FEEDBACK_TABLE_NAME;
if (FEEDBACK_FEATURE_ENABLED && !FEEDBACK_TABLE_NAME) {
  throw new Error('FEEDBACK_TABLE_NAME environment variable is required when FEEDBACK_FEATURE_ENABLED is true');
}

const logger = {
  _log(level: string, message: string, extra?: Record<string, unknown>) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: 'workItemAgent',
      ...extra,
    };
    console.log(JSON.stringify(logEntry));
  },
  info(message: string, extra?: Record<string, unknown>) {
    this._log('INFO', message, extra);
  },
  warn(message: string, extra?: Record<string, unknown>) {
    this._log('WARN', message, extra);
  },
  error(message: string, extra?: Record<string, unknown>) {
    this._log('ERROR', message, extra);
  },
};

// Initialize the Bedrock model
const model = new BedrockModel({
  region: AWS_REGION,
  modelId: AWS_BEDROCK_MODEL_ID,
});

// Create the agent with tools
const agent = new Agent({
  model,
  systemPrompt: `You are an AI assistant that orchestrates the evaluation and decomposition of Azure DevOps work items.

**Instructions:**
1. You will be given a work item event.
2. First, use the 'evaluate_work_item' tool to evaluate the work item's quality.
3. If the evaluation result indicates that the work item is not well-defined or has already been evaluated, use the 'add_comment' tool to post the feedback to the original work item and then stop.
4. If the evaluation passes, use the 'generate_work_items' tool to generate child work items.
5. After generating the work items, if the params.preview is false, use the 'create_child_work_items' tool to create them in Azure DevOps. If params.preview is true, do not create the work items and skip to step 7 to use the 'finalize_response' tool.
6. Finally, use the 'add_comment' tool to post a summary to the parent work item and use the 'add_tag' tool to add a 'Task Genie' tag to the parent work item to denote it has been successully evaluated.
7. Use the 'finalize_response' tool to signal that the process is complete. Pass the full work item object, the array of child work items created (if any), the outcome, and a brief summary.

**Error Handling:**
If ANY tool returns an error or fails at any step in the workflow:
1. IMMEDIATELY stop further processing
2. Use the 'add_comment' tool to post an error message to the work item explaining what went wrong
3. Use the 'finalize_response' tool with outcome='error' and include the error details in the summary
4. Format error comments as: "❌ <b>Task Genie Error:</b> [brief description of the error]. Please try again or contact support if the issue persists.<br /><i>This is an automated message from Task Genie.</i>"

**Comment Formatting Rules:**
When using 'add_comment' after successfully creating child work items, keep the comment concise:
- Use a brief one-line summary (e.g., "✅ Created X child Tasks for this User Story")
- Include any knowledge base sources used, formatted as a bulleted list with line breaks
- Use simple HTML tags for formatting (e.g., <b>, <i>, <br />)
- Do NOT include markdown formatting
- Do NOT list or describe each task - the user can see them as child items
- Do NOT repeat acceptance criteria or explain how tasks map to requirements
- Keep the entire comment to 2-3 sentences maximum

Example good comment:
"✅ Successfully generated 4 tasks for work item 168623 from 3 knowledge base documents.

<b>Sources:</b><br />
SPIKE Omni-POS 2.0 Performance Monitoring Strategy.docx
SPIKE Omni-POS 2.0 Performance Monitoring Strategy.docx

<i>This is an automated message from Task Genie.</i>"

**Output Rules:**
- Return the response that you receive from the 'finalize_response' agent.
- Do not include any additional content outside of that response.`,
  tools: [
    evaluate_work_item,
    generate_work_items,
    finalize_response,
    get_work_item,
    add_comment,
    add_tag,
    get_child_work_items,
    create_child_work_items,
    create_incomplete_work_item_metric,
    create_work_item_generated_metric,
    create_work_item_updated_metric,
  ],
});

const app = express();

app.get('/ping', (_, res) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  }),
);

app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    // Decode binary payload from AWS SDK
    const workItem = new TextDecoder().decode(req.body);
    logger.info('▶️ Decoded work item', { workItem });

    // Invoke the agent
    const response = await agent.invoke(`Here is the work item: ${workItem}`);

    logger.info('✅ Agent response', { response: response.lastMessage });

    return res.json({ response: response.lastMessage });
  } catch (err) {
    logger.error('💣 Error processing request', { error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  logger.info('🚀 AgentCore Runtime server started', {
    port: PORT,
    invocationsEndpoint: `POST http://0.0.0.0:${PORT}/invocations`,
    healthEndpoint: `GET http://0.0.0.0:${PORT}/ping`,
  });
});
