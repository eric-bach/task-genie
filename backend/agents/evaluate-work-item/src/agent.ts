// Define a custom tool as a TypeScript function
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import z from "zod";

const model = new BedrockModel({
  region: "us-west-2",
  modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
});

export const evaluateWorkItem = tool({
  name: "evaluate_work_item",
  description:
    "Evaluate the work item to check if it is reasonably clear and has enough detail for a developer or team to begin with minimal clarification.",
  inputSchema: z
    .object({
      message: z.string().describe("The work item to evaluate"),
    })
    .required(),
  callback: async (input) => {
    const agent = new Agent({
      model,
      systemPrompt: `You are an AI assistant that reviews Azure DevOps work items. 
**Instructions**
- Evaluate the work item to check if it is reasonably clear and has enough detail for a developer or team to begin with minimal clarification.
- Your task is to assess the quality of a work item (Epic, Feature, or User Story) based on the provided title, description, and available criteria fields.
- If images are provided, treat them as additional context to understand the work item.

**Output Rules**
- Return a JSON object with the following structure:
  - "pass": boolean (true if the work item is good enough to proceed, false only if it is seriously incomplete or unclear)
  - if "pass" is false, include a "comment" field (string) with a clear explanation of what's missing or unclear, and provide an example of a higher-quality work item that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.
- Only output the JSON object, no extra text outside it.`,
    });

    console.log("input", input.message);

    const result = await agent.invoke(
      "Evaluate this work item: " + input.message
    );

    console.log(result.lastMessage);

    return result.lastMessage.content as any;
  },
});
