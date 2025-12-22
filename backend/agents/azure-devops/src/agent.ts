// Define a custom tool as a TypeScript function
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import z from "zod";

const model = new BedrockModel({
  region: "us-west-2",
  modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
});

const parseWorkItemEvent = tool({
  name: "parse_work_item_event",
  description: "Parse the work item event to extract the work item.",
  inputSchema: z
    .object({
      workItemEvent: z.string().describe("The work item event to parse"),
    })
    .required(),
  callback: async (input) => {
    const agent = new Agent({
      model,
      systemPrompt: `You are an Azure DevOps agent that can extract and parse work item events to extract the work item, whether it is an Epic, Feature, or User Story.
**Instructions:**
- Extract the work item event to extract the work item, whether it is an Epic, Feature, or User Story.
**Output Rules:**
- Return a JSON object with the following structure:
  - "workItemId": number (the work item ID)
  - "workItemType": string (the work item type)
  - "teamProject": string (the team project)
  - "areaPath": string (the area path)
  - "iterationPath": string (the iteration path)
  - "businessUnit": string (the business unit, a custom field)
  - "system": string (the system, a custom field)
  - "changedBy": string (the user who last changed the work item)
  - "title": string (the title)
  - "description": string (the description)
  - "tags": string (the tags)
  - "images": string (the images)`,
    });

    const result = await agent.invoke(
      "Parse this work item event and return a work item object: " +
        input.workItemEvent
    );

    console.log(result.lastMessage);

    return result.lastMessage.content as any;
  },
});

export const azureDevOps = tool({
  name: "azure-devops",
  description:
    "Integrate with Azure DevOps to provide a seamless experience for users to manage their work items.",
  inputSchema: z
    .object({
      message: z.string().describe("The message to evaluate"),
    })
    .required(),
  callback: async (input) => {
    const agent = new Agent({
      model,
      systemPrompt: `You are an Azure DevOps interface to Azure DevOps that integrates with Azure DevOps to provide a seamless experience for users to manage their work items.
**Instructions:**
- Select the appropriate tool based on the message.
**Tools:**
- parse_work_item_event: Parse the work item event to extract the work item.`,
      tools: [parseWorkItemEvent],
    });

    const result = await agent.invoke(input.message);

    console.log(result.lastMessage);

    return result.lastMessage.content as any;
  },
});
