import { WorkItem } from './azureDevOps';

export interface BedrockInferenceParams {
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  preview?: boolean;
  generatedWorkItems?: WorkItem[];
  refinementInstructions?: string;
}

export interface BedrockKnowledgeDocument {
  content: string;
  contentLength: number;
  source: string;
  score: number | undefined;
}

export interface BedrockWorkItemEvaluationResponse {
  pass: boolean;
  comment: string;
}

export interface BedrockWorkItemGenerationResponse {
  workItems: WorkItem[];
  documents: BedrockKnowledgeDocument[];
}

export interface BedrockResponse {
  workItems: WorkItem[];
  documents: BedrockKnowledgeDocument[];
}
