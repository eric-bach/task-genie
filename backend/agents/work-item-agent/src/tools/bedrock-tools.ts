
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { BedrockService } from '@/services/BedrockService';
import { WorkItem } from '@/types/azureDevOps';
import { BedrockInferenceParams } from '@/types/bedrock';

const bedrockService = new BedrockService({
  region: process.env.AWS_REGION || 'us-west-2',
  modelId: process.env.AWS_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  knowledgeBaseId: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
});

export const evaluate_work_item = tool({
  name: 'evaluate_work_item',
  description: 'Evaluates an Azure DevOps work item to determine if it is well-defined.',
  inputSchema: z.object({
    workItem: z.custom<WorkItem>().describe('The work item to evaluate.'),
  }),
  callback: async ({ workItem }) => {
    try {
      const result = await bedrockService.evaluateWorkItem(workItem);
      return JSON.stringify(result);
    } catch (error) {
      if (error instanceof Error) {
        return `Error evaluating work item: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const generate_work_items = tool({
  name: 'generate_work_items',
  description: 'Generates child work items for a given parent work item.',
  inputSchema: z.object({
    workItem: z.custom<WorkItem>().describe('The parent work item.'),
    existingChildWorkItems: z.custom<WorkItem[]>().describe('A list of existing child work items to avoid duplicates.'),
    params: z.custom<BedrockInferenceParams>().optional().describe('Optional inference parameters.'),
  }),
  callback: async ({ workItem, existingChildWorkItems, params }) => {
    try {
      const result = await bedrockService.generateWorkItems(workItem, existingChildWorkItems, params);
      return JSON.stringify(result);
    } catch (error) {
      if (error instanceof Error) {
        return `Error generating work items: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});
