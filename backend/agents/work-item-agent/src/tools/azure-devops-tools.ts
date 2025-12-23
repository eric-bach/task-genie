import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { AzureService } from '@/services/AzureService';
import { WorkItemSchema } from './schemas';

const azureService = new AzureService();

export const get_work_item = tool({
  name: 'get_work_item',
  description: 'Retrieves an Azure DevOps work item by its ID.',
  inputSchema: z.object({
    workItemId: z.number().describe('The ID of the work item to retrieve.'),
    teamProject: z.string().describe('The team project name.'),
  }),
  callback: async ({ workItemId, teamProject }) => {
    try {
      const workItem = await azureService.getWorkItem(workItemId, teamProject);
      return JSON.stringify(workItem);
    } catch (error) {
      if (error instanceof Error) {
        return `Error getting work item: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const add_comment = tool({
  name: 'add_comment',
  description: 'Adds a comment to an Azure DevOps work item.',
  inputSchema: z.object({
    workItem: WorkItemSchema.describe(
      'The work item object to add the comment to.'
    ),
    comment: z.string().describe('The comment text to add.'),
  }),
  callback: async ({ workItem, comment }) => {
    try {
      // @ts-ignore - Schema matches sufficiently for runtime use, but strict types might mismatch slightly
      const result = await azureService.addComment(workItem, comment);
      return `Comment added successfully: ${result}`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error adding comment: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const add_tag = tool({
  name: 'add_tag',
  description: 'Adds a tag to an Azure DevOps work item.',
  inputSchema: z.object({
    teamProject: z.string().describe('The team project name.'),
    workItemId: z.number().describe('The ID of the work item.'),
    tag: z.string().describe('The tag to add.'),
  }),
  callback: async ({ teamProject, workItemId, tag }) => {
    try {
      const result = await azureService.addTag(teamProject, workItemId, tag);
      return `Tag added successfully: ${result}`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error adding tag: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const get_child_work_items = tool({
  name: 'get_child_work_items',
  description:
    'Retrieves child work items associated with a specific work item.',
  inputSchema: z.object({
    workItem: WorkItemSchema.describe(
      'The parent work item to fetch children for.'
    ),
  }),
  callback: async ({ workItem }) => {
    try {
      // @ts-ignore
      const childWorkItems = await azureService.getChildWorkItems(workItem);
      return JSON.stringify(childWorkItems);
    } catch (error) {
      if (error instanceof Error) {
        return `Error getting child work items: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});

export const create_child_work_items = tool({
  name: 'create_child_work_items',
  description:
    'Creates multiple child work items for a work item in Azure DevOps.',
  inputSchema: z.object({
    workItem: WorkItemSchema.describe(
      'The parent work item to create children for.'
    ),
    childWorkItems: z
      .array(WorkItemSchema)
      .describe('Array of child work items to create.'),
  }),
  callback: async ({ workItem, childWorkItems }) => {
    try {
      // @ts-ignore
      await azureService.createChildWorkItems(workItem, childWorkItems);
      return `Child work items created successfully.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error creating child work items: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  },
});
