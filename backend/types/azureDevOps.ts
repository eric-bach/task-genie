import { BedrockInferenceParams } from './bedrock';

export interface WorkItemRequest {
  workItem: WorkItem;
  params: BedrockInferenceParams;
}

export interface WorkItemImage {
  url: string;
  alt?: string;
}

export interface WorkItem {
  workItemId: number;
  teamProject: string;
  areaPath: string;
  businessUnit?: string;
  system?: string;
  changedBy: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  images?: WorkItemImage[]; // Array of images with URLs and alt text extracted from description and acceptance criteria
}

export interface Task {
  taskId?: number;
  title: string;
  description: string;
}
