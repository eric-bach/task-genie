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
  region: process.env.AWS_REGION,
  modelId: process.env.AWS_BEDROCK_MODEL_ID,
});

// Create the agent with tools
const agent = new Agent({
  model,
  systemPrompt: `You are an AI assistant that orchestrates the evaluation and decomposition of Azure DevOps work items.

**Instructions:**
1. You will be given a work item event.
2. First, use the 'evaluate_work_item' tool to evaluate the work item's quality.
3. If the evaluation result indicates that the work item is not well-defined, use the 'add_comment' tool to post the feedback to the original work item and then stop.
4. If the evaluation passes, use the 'generate_work_items' tool to generate child work items.
5. After generating the work items, use the 'create_child_work_items' tool to create them in Azure DevOps.
6. Finally, use the 'add_comment' tool to post a summary of the created child work items to the parent work item.
7. Use the 'finalize_response' tool to signal that the process is complete.

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
  })
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
