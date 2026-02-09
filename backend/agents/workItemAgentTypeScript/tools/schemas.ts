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
  businessUnit: z.string().optional().describe('The business unit associated with the work item'),
  system: z.string().optional().describe('The system associated with the work item'),
  tags: z.array(z.string()).optional().describe('Tags associated with the work item'),
  changedBy: z.string().optional().describe('The user who last changed the work item'),
  originalChangedBy: z.string().optional().describe('The original user who submitted the work item for evaluation'),
  acceptanceCriteria: z.string().optional().describe('Acceptance criteria (for User Stories)'),
});

export const BedrockInferenceParamsSchema = z.object({
  prompt: z.string().optional().describe('Custom prompt for the inference'),
  maxTokens: z.number().optional().describe('Max tokens to sample'),
  temperature: z.number().optional().describe('Temperature for sampling'),
  topP: z.number().optional().describe('Top P for sampling'),
});
