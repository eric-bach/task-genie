// Define a custom tool as a TypeScript function
import { Agent, BedrockModel, tool } from '@strands-agents/sdk'
import z from 'zod'

const evaluateWorkItem = tool({
  name: 'evaluate_work_item',
  description: 'Evaluate that the work item is well-defined and complete based on the work item type (Epic, Feature, User Story). Only if the work item is well-defined, generate child work items to break down the work item into smaller, more manageable pieces.',
  // Zod schema for letter counter input validation
  inputSchema: z
    .object({
      workItem: z.string().describe('The work item to evaluate'),
    })
    .required(),
  callback: (input) => {
    return {pass: true}
  },
})

const generateWorkItems = tool({
  name: 'generate_work_items',
  description: 'Generate child work items to break down the work item into smaller, more manageable pieces.',
  // Zod schema for letter counter input validation
  inputSchema: z
    .object({
      workItem: z.string().describe('The work item to evaluate'),
    })
    .required(),
  callback: (input) => {
    return {workItems: []}
  },
})

const model = new BedrockModel({
  region: 'us-west-2',
  modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
})

// Create an agent with tools with our custom letterCounter tool
const agent = new Agent({
  model, 
  systemPrompt:`You are an AI assistant that evaluate and decomposes Azure DevOps work items into smaller child work items. Evaluate that the work item is well-defined and complete based on the work item type (Epic, Feature, User Story). Only if the work item is well-defined, generate child work items to break down the work item into smaller, more manageable pieces.
- A work item type of 'Epic' will generate 'Feature' work items.
- A work item type of 'Feature' will generate 'User Story' work items.
- A work item type of 'User Story' will generate 'Task' work items.
**Instructions:**
- Use the 'evaluate-work-item' agent to evaluate the work item.
- Use the 'generate-work-items' agent to generate child work items.
**Output Rules:**
- Return a JSON object with the following structure:
  - "pass": boolean (true if the work item is good enough to proceed, false only if it is seriously incomplete or confusing)
  - if "pass" is false, include a "comment" field (string) with a clear explanation of what's missing or unclear, and provide an example of a higher-quality work item type that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.
- Only output the JSON object, no extra text outside it.`,
tools: [evaluateWorkItem, generateWorkItems]
})

// Ask the agent a question that uses the available tools
async function main() {
  const message = `Evalute this user story: "As a user, I want to be able to search for products by name so that I can find the product I am looking for."`
  const result = await agent.invoke(message)
  console.log(result.lastMessage)
}

main().catch(console.error)