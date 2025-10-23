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
  /** Unique identifier for the feedback record */
  feedbackId: string;

  /** Azure DevOps work item ID this task belongs to */
  workItemId: number;

  /** Azure DevOps task ID */
  taskId: number;

  /** Type of feedback action taken by user */
  action: FeedbackAction;

  /** Timestamp when the feedback was recorded */
  timestamp: string;

  /** User who performed the action */
  userId: string;

  /** Original AI-generated task details */
  originalTask: {
    title: string;
    description: string;
  };

  /** Modified task details (for MODIFIED action) */
  modifiedTask?: {
    title?: string;
    description?: string;
  };

  /** Context from the original work item */
  workItemContext: {
    title: string;
    areaPath: string;
    businessUnit?: string;
    system?: string;
    teamProject: string;
  };

  /** Optional user-provided feedback comment */
  userComment?: string;

  /** Task completion time in hours (for COMPLETED action) */
  completionTimeHours?: number;

  /** AI model parameters used during generation */
  generationContext?: {
    modelId: string;
    temperature?: number;
    topP?: number;
    promptUsed?: string;
  };

  /** Computed context key for efficient querying (areaPath#businessUnit#system) */
  contextKey?: string;
}

/**
 * Aggregated feedback patterns for learning
 */
export interface FeedbackPattern {
  /** Pattern identifier */
  patternId: string;

  /** Context this pattern applies to */
  context: {
    areaPath?: string;
    businessUnit?: string;
    system?: string;
  };

  /** Common modifications users make */
  commonModifications: {
    titlePatterns: string[];
    descriptionPatterns: string[];
  };

  /** Anti-patterns to avoid */
  antiPatterns: {
    titlesToAvoid: string[];
    descriptionsToAvoid: string[];
  };

  /** Patterns from tasks users created manually (AI missed) */
  missedTaskPatterns: {
    titlePatterns: string[];
    descriptionPatterns: string[];
  };

  /** Success metrics */
  metrics: {
    totalTasks: number;
    acceptanceRate: number; // % of tasks accepted without modification
    modificationRate: number; // % of tasks modified
    deletionRate: number; // % of tasks deleted
    missedTaskRate: number; // % of additional tasks users created manually
    avgCompletionTime?: number; // Average completion time for accepted tasks
  };

  /** When this pattern was last updated */
  lastUpdated: string;

  /** Number of feedback instances this pattern is based on */
  sampleSize: number;
}

/**
 * Learning insights derived from feedback analysis
 */
export interface FeedbackInsight {
  /** Insight identifier */
  insightId: string;

  /** Type of insight */
  type: 'improvement_suggestion' | 'anti_pattern' | 'success_pattern' | 'prompt_enhancement';

  /** Context this insight applies to */
  context: {
    areaPath?: string;
    businessUnit?: string;
    system?: string;
  };

  /** The insight description */
  description: string;

  /** Confidence score (0-1) */
  confidence: number;

  /** Supporting evidence */
  evidence: {
    feedbackCount: number;
    examples: string[];
  };

  /** Recommended action */
  recommendation: {
    action: 'enhance_prompt' | 'add_to_knowledge_base' | 'modify_generation_logic';
    details: string;
  };

  /** When this insight was generated */
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
  completionTimeHours?: number;
  workItemContext: TaskFeedback['workItemContext'];
  generationContext?: TaskFeedback['generationContext'];
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
