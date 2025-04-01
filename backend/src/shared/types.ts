export interface WorkItem {
  workItemId: number;
  changedBy: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
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
