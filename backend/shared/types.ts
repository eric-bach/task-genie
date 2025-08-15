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
  teamProject: string;
  areaPath: string;
  businessUnit: string;
  system: string;
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

export interface BedrockResponse {
  pass: boolean;
  comment: string;
}
