import { z } from 'zod';

export const WorkItemSchema = z.object({
  workItemId: z.number().describe('The ID of the work item'),
  teamProject: z.string().describe('The team project name'),
  title: z.string().describe('The title of the work item'),
  description: z.string().describe('The description of the work item'),
  workItemType: z
    .enum(['User Story', 'Epic', 'Feature', 'Task'])
    .describe('The type of the work item (e.g., User Story, Feature, Bug)'),
  state: z.string().optional().describe('The state of the work item'),
  areaPath: z.string().optional().describe('The area path'),
  iterationPath: z.string().optional().describe('The iteration path'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags associated with the work item'),
  changedBy: z
    .string()
    .optional()
    .describe('The user who changed the work item'),
  acceptanceCriteria: z
    .string()
    .optional()
    .describe('Acceptance criteria (for User Stories)'),
});

export const BedrockInferenceParamsSchema = z.object({
  prompt: z.string().optional().describe('Custom prompt for the inference'),
  maxTokens: z.number().optional().describe('Max tokens to sample'),
  temperature: z.number().optional().describe('Temperature for sampling'),
  topP: z.number().optional().describe('Top P for sampling'),
});
