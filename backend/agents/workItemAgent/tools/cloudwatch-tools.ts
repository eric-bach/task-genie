import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { CloudWatchService } from '../../../services/CloudWatchService.js';

const cloudWatchService = new CloudWatchService();

const workItemTypeSchema = z.enum(['User Story', 'Epic', 'Feature', 'Task']);

export const create_incomplete_work_item_metric = tool({
  name: 'create_incomplete_work_item_metric',
  description: 'Creates a CloudWatch metric for an incomplete work item.',
  inputSchema: z.object({
    workItemType: workItemTypeSchema,
  }),
  callback: async ({ workItemType }) => {
    try {
      await cloudWatchService.createIncompleteWorkItemMetric(workItemType);
      return `Metric for incomplete ${workItemType} created.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error creating metric: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const create_work_item_generated_metric = tool({
  name: 'create_work_item_generated_metric',
  description: 'Creates a CloudWatch metric for generated work items.',
  inputSchema: z.object({
    value: z.number().describe('The number of work items generated.'),
    workItemType: z.string().describe('The type of work item generated.'),
  }),
  callback: async ({ value, workItemType }) => {
    try {
      await cloudWatchService.createWorkItemGeneratedMetric(
        value,
        workItemType
      );
      return `Metric for ${value} ${workItemType}(s) generated created.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error creating metric: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const create_work_item_updated_metric = tool({
  name: 'create_work_item_updated_metric',
  description: 'Creates a CloudWatch metric for an updated work item.',
  inputSchema: z.object({
    workItemType: workItemTypeSchema,
  }),
  callback: async ({ workItemType }) => {
    try {
      await cloudWatchService.createWorkItemUpdatedMetric(workItemType);
      return `Metric for updated ${workItemType} created.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error creating metric: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});
