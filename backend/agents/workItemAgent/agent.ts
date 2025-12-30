// Bedrock AgentCore Runtime requires an Express server with /ping and /invocations endpoints
// Reference: https://strandsagents.com/latest/documentation/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/
import express from 'express';
import { Agent, BedrockModel, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import {
  get_work_item,
  add_comment,
  add_tag,
  get_child_work_items,
  create_child_work_items,
} from './tools/azure-devops-tools.js';
import {
  evaluate_work_item,
  generate_work_items,
} from './tools/bedrock-tools.js';
import {
  create_incomplete_work_item_metric,
  create_work_item_generated_metric,
  create_work_item_updated_metric,
} from './tools/cloudwatch-tools.js';

const PORT = process.env.PORT || 8080;

// Define the finalize response tool
const finalizeResponse = tool({
  name: 'finalize_response',
  description: 'Finalize the response to the work item.',
  inputSchema: z.object({
    workItem: z.string().describe('The work item to evaluate'),
  }),
  callback: (input) => {
    return { workItems: [], response: 'Good' };
  },
});

// Initialize the Bedrock model
const model = new BedrockModel({
  region: process.env.AWS_REGION || 'us-west-2',
  modelId: process.env.AWS_BEDROCK_MODEL_ID || '',
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
    finalizeResponse,
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

// Create Express app
const app = express();

// Health check endpoint - REQUIRED by AgentCore Runtime
app.get('/ping', (_, res) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  })
);

// Agent invocation endpoint - REQUIRED by AgentCore Runtime
// AWS sends binary payload, so we use express.raw middleware
app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    // Decode binary payload from AWS SDK
    const prompt = new TextDecoder().decode(req.body);
    console.log('Received invocation, decoded prompt:', prompt);

    // Invoke the agent
    const response = await agent.invoke(prompt);
    console.log('Agent response:', response.lastMessage);

    // Return response
    return res.json({ response: response.lastMessage });
  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentCore Runtime server listening on port ${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   POST http://0.0.0.0:${PORT}/invocations`);
  console.log(`   GET http://0.0.0.0:${PORT}/ping`);
});

// // Export handler for backward compatibility (if needed for testing)
// export const handler = async (event: any): Promise<any> => {
//   const message = `Evaluate this work item: ${JSON.stringify(event)}`;
//   const result = await agent.invoke(message);
//   console.log(result.lastMessage);
//   return result.lastMessage;
// };
