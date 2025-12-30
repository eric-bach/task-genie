import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

// Define the finalize response tool
export const finalize_response = tool({
  name: 'finalize_response',
  description: 'Finalize the response to the work item.',
  inputSchema: z.object({
    workItem: z.string().describe('The work item to evaluate'),
  }),
  callback: (input) => {
    return { workItems: [], response: 'Good' };
  },
});
