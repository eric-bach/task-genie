import { WorkItem } from './azureDevOps';

export enum WorkItemGenerationMode {
  Refine = 'refine',
  Evaluate = 'evaluate',
  EvaluateAndGenerate = 'evaluate_and_generate',
  EvaluateAndGenerateAndCreate = 'evaluate_and_generate_and_create',
  Create = 'create',
}

export interface BedrockInferenceParams {
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  generatedWorkItems?: WorkItem[];
  refinementInstructions?: string;
  mode?: WorkItemGenerationMode;
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
