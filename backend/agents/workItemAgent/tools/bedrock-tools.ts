import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { BedrockService } from '@/services/BedrockService';
import { WorkItemSchema, BedrockInferenceParamsSchema } from './schemas';

const bedrockService = new BedrockService({
  region: process.env.AWS_REGION || 'us-west-2',
  modelId: process.env.AWS_BEDROCK_MODEL_ID || '',
  knowledgeBaseId: process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID || '',
  maxKnowledgeDocuments: 3,
  maxImageSize: 5,
  maxImages: 3,
  configTableName: process.env.CONFIG_TABLE_NAME || '',
  feedbackTableName: process.env.FEEDBACK_TABLE_NAME || '',
  feedbackFeatureEnabled: process.env.FEEDBACK_FEATURE_ENABLED ? true : false,
});

export const evaluate_work_item = tool({
  name: 'evaluate_work_item',
  description:
    'Evaluates an Azure DevOps work item to determine if it is well-defined.',
  inputSchema: z.object({
    workItem: WorkItemSchema.describe('The work item to evaluate.'),
  }),
  callback: async ({ workItem }) => {
    try {
      // @ts-ignore
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
    workItem: WorkItemSchema.describe('The parent work item.'),
    existingChildWorkItems: z
      .array(WorkItemSchema)
      .describe('A list of existing child work items to avoid duplicates.'),
    params: BedrockInferenceParamsSchema.optional().describe(
      'Optional inference parameters.'
    ),
  }),
  callback: async ({ workItem, existingChildWorkItems, params }) => {
    try {
      // @ts-ignore
      const result = await bedrockService.generateWorkItems(
        workItem as any,
        existingChildWorkItems as any,
        params
      );
      return JSON.stringify(result);
    } catch (error) {
      if (error instanceof Error) {
        return `Error generating work items: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});
