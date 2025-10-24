import { Task } from './azureDevOps';

/**
 * Enum for different types of user feedback actions on AI-generated tasks
 */
export enum FeedbackAction {
  DELETED = 'deleted', // Task was deleted by user
  MODIFIED = 'modified', // Task was edited by user
  ACCEPTED = 'accepted', // Task was moved to active/in-progress without changes
  COMPLETED = 'completed', // Task was completed successfully
  MISSED_TASK = 'missed_task', // User created additional task, indicating AI missed something
}

/**
 * Interface for tracking task feedback from users
 */
export interface TaskFeedback {
  feedbackId: string;
  contextKey?: string;
  workItemId: number;
  taskId: number;
  action: FeedbackAction;
  timestamp: string;
  userId: string;
  originalTask: {
    title: string;
    description: string;
  };
  modifiedTask?: {
    title?: string;
    description?: string;
  };
  workItemContext: {
    title: string;
    areaPath: string;
    businessUnit?: string;
    system?: string;
    teamProject: string;
  };
}

/**
 * Aggregated feedback patterns for learning
 */
export interface FeedbackPattern {
  patternId: string;
  context: {
    areaPath?: string;
    businessUnit?: string;
    system?: string;
  };
  commonModifications: {
    titlePatterns: string[];
    descriptionPatterns: string[];
  };
  antiPatterns: {
    titlesToAvoid: string[];
    descriptionsToAvoid: string[];
  };
  missedTaskPatterns: {
    titlePatterns: string[];
    descriptionPatterns: string[];
  };
  metrics: {
    totalTasks: number;
    acceptanceRate: number; // % of tasks accepted without modification
    modificationRate: number; // % of tasks modified
    deletionRate: number; // % of tasks deleted
    missedTaskRate: number; // % of additional tasks users created manually
  };
  lastUpdated: string;
  sampleSize: number;
}

/**
 * Learning insights derived from feedback analysis
 */
export interface FeedbackInsight {
  insightId: string;
  type: 'improvement_suggestion' | 'anti_pattern' | 'success_pattern' | 'prompt_enhancement';
  context: {
    areaPath?: string;
    businessUnit?: string;
    system?: string;
  };
  description: string;
  confidence: number;
  evidence: {
    feedbackCount: number;
    examples: string[];
  };
  recommendation: {
    action: 'enhance_prompt' | 'add_to_knowledge_base' | 'modify_generation_logic';
    details: string;
  };
  generatedAt: string;
}

/**
 * Request interface for recording feedback
 */
export interface RecordFeedbackRequest {
  workItemId: number;
  taskId: number;
  action: FeedbackAction;
  userId: string;
  originalTask: Pick<Task, 'title' | 'description'>;
  modifiedTask?: Partial<Pick<Task, 'title' | 'description'>>;
  userComment?: string;
  workItemContext: TaskFeedback['workItemContext'];
}

/**
 * Response interface for feedback queries
 */
export interface FeedbackQueryResponse {
  patterns: FeedbackPattern[];
  insights: FeedbackInsight[];
  totalFeedbackCount: number;
}

/**
 * Configuration for feedback analysis
 */
export interface FeedbackAnalysisConfig {
  /** Minimum sample size required for pattern recognition */
  minSampleSize: number;
  /** Time window for analysis (in days) */
  analysisWindowDays: number;
  /** Minimum confidence threshold for insights */
  minConfidenceThreshold: number;
  /** Maximum number of patterns to return */
  maxPatterns: number;
}
