// Define a custom tool as a TypeScript function
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import z from "zod";
import { USER_STORY_CREATED_EVENT } from "../events/events";
import {
  get_work_item,
  add_comment,
  add_tag,
  get_child_work_items,
  create_child_work_items,
} from "./tools/azure-devops-tools";
import {
  evaluate_work_item,
  generate_work_items,
} from "./tools/bedrock-tools";

const finalizeResponse = tool({
  name: "finalize_response",
  description: "Finalize the response to the work item.",
  // Zod schema for letter counter input validation
  inputSchema: z
    .object({
      workItem: z.string().describe("The work item to evaluate"),
    })
    .required(),
  callback: (input) => {
    return { workItems: [], response: "Good" };
  },
});

const model = new BedrockModel({
  region: "us-west-2",
  modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
});

import {
  create_incomplete_work_item_metric,
  create_work_item_generated_metric,
  create_work_item_updated_metric,
} from "./tools/cloudwatch-tools";

// Create an agent with tools with our custom letterCounter tool
const agent = new Agent({
  model,
  systemPrompt: `You are an AI assistant that evaluate and decomposes Azure DevOps work items into smaller child work items. Evaluate that the work item is well-defined and complete based on the work item type (Epic, Feature, User Story). Only if the work item is well-defined, generate child work items to break down the work item into smaller, more manageable pieces.
- A work item type of 'Epic' will generate 'Feature' work items.
- A work item type of 'Feature' will generate 'User Story' work items.
- A work item type of 'User Story' will generate 'Task' work items.
**Instructions:**
- Use the 'evaluate-work-item' agent to evaluate the work item.
- Use the 'generate-work-items' agent to generate child work items.
- Always call the 'finalize-response' agent to finalize the response that will be returned to the user.
**Output Rules:**
- Return the response that you receive from the 'finalize-response' agent.
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
export const handler = async (event: any): Promise<any> => {
  // The event payload will contain the work item details.
  const message = `Evaluate this work item: ${JSON.stringify(event)}`;
  const result = await agent.invoke(message);
  console.log(result.lastMessage);
  return result.lastMessage;
};
