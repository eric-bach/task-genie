import { Agent, BedrockModel } from '@strands-agents/sdk';
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { z } from 'zod';
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
import { SYSTEM_PROMPT } from './prompt.js';

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

// Create the agent with tools
const agent = new Agent({
  model: new BedrockModel({
    region: AWS_REGION,
    modelId: AWS_BEDROCK_MODEL_ID,
  }),
  systemPrompt: SYSTEM_PROMPT,
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

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ body: z.any() }),
    process: async (req, res: any) => {
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
    },
  },
});

app.run();
