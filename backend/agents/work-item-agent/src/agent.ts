// Define a custom tool as a TypeScript function
import { Agent, BedrockModel, tool } from '@strands-agents/sdk';
import z from 'zod';
import {
  get_work_item,
  add_comment,
  add_tag,
  get_child_work_items,
  create_child_work_items,
} from './tools/azure-devops-tools';
import { evaluate_work_item, generate_work_items } from './tools/bedrock-tools';

const finalizeResponse = tool({
  name: 'finalize_response',
  description: 'Finalize the response to the work item.',
  // Zod schema for letter counter input validation
  inputSchema: z
    .object({
      workItem: z.string().describe('The work item to evaluate'),
    })
    .required(),
  callback: (input) => {
    return { workItems: [], response: 'Good' };
  },
});

const model = new BedrockModel({
  region: process.env.AWS_REGION || 'us-west-2',
  modelId: process.env.AWS_BEDROCK_MODEL_ID || '',
});

import {
  create_incomplete_work_item_metric,
  create_work_item_generated_metric,
  create_work_item_updated_metric,
} from './tools/cloudwatch-tools';

// Create an agent with tools with our custom letterCounter tool
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

// This handler can be called by a Lambda, etc.
// This handler can be called by a Lambda, etc.
export const handler = async (event: any): Promise<any> => {
  const message = `Evaluate this work item: ${JSON.stringify(event)}`;
  const result = await agent.invoke(message);
  console.log(result.lastMessage);
  return result.lastMessage;
};
