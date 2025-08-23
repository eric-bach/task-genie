import { Task } from './azureDevOps';

export interface BedrockInferenceParams {
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
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

export interface BedrockTaskGenerationResponse {
  tasks: Task[];
  documents: BedrockKnowledgeDocument[];
}

export interface BedrockResponse {
  tasks: Task[];
  documents: BedrockKnowledgeDocument[];
}
