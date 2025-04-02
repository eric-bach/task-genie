// export interface EventBody {
//   params: {
//     prompt: string;
//     maxTokens: number;
//     temperature: number;
//     topP: number;
//   };
//   resource: {
//     workItemId: number;
//     revision: {
//       fields: {
//         'System.ChangedBy': string;
//         'System.Title': string;
//         'System.Description': string;
//         'Microsoft.VSTS.Common.AcceptanceCriteria': string;
//       };
//     };
//   };
// }

export interface WorkItemRequest {
  workItem: WorkItem;
  params: BedrockConfig;
}

export interface BedrockConfig {
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface WorkItem {
  workItemId: number;
  iterationPath: string;
  changedBy: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
}

export interface Task {
  taskId?: number;
  title: string;
  description: string;
}
export interface Comment {
  text: string;
}

export interface BedrockResponse {
  pass: boolean;
  comment: string;
}
