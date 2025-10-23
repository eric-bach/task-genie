import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import {
  TaskFeedback,
  FeedbackPattern,
  FeedbackInsight,
  RecordFeedbackRequest,
  FeedbackQueryResponse,
  FeedbackAnalysisConfig,
  FeedbackAction,
} from '../types/feedback';

export interface FeedbackServiceConfig {
  region: string;
  tableName: string;
}

/**
 * Service for managing task feedback data and learning insights
 */
export class FeedbackService {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly logger: Logger;
  private readonly tableName: string;

  constructor(config: FeedbackServiceConfig) {
    const dynamoClient = new DynamoDBClient({ region: config.region });
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, { marshallOptions: { removeUndefinedValues: true } });
    this.logger = new Logger({ serviceName: 'FeedbackService' });
    this.tableName = config.tableName;
  }

  /**
   * Record user feedback on a task
   */
  async recordFeedback(request: RecordFeedbackRequest): Promise<string> {
    const feedbackId = uuidv4();
    const timestamp = new Date().toISOString();

    this.logger.info('⚙️ Recording feedback from request', {
      request,
    });

    // Create context key for querying by context
    const contextKey = this.buildContextKey(
      request.workItemContext.areaPath,
      request.workItemContext.businessUnit,
      request.workItemContext.system
    );

    // Build feedback object with only defined values
    // Clean workItemContext to remove undefined properties
    const cleanWorkItemContext = {
      title: request.workItemContext.title,
      areaPath: request.workItemContext.areaPath,
      teamProject: request.workItemContext.teamProject,
      ...(request.workItemContext.businessUnit && { businessUnit: request.workItemContext.businessUnit }),
      ...(request.workItemContext.system && { system: request.workItemContext.system }),
    };

    // Clean originalTask to ensure no undefined properties
    const cleanOriginalTask = {
      title: request.originalTask.title || '',
      description: request.originalTask.description || '',
    };

    const feedback: TaskFeedback = {
      feedbackId,
      workItemId: request.workItemId,
      taskId: request.taskId,
      action: request.action,
      timestamp,
      userId: request.userId,
      originalTask: cleanOriginalTask,
      workItemContext: cleanWorkItemContext,
      contextKey,
    };

    // Only add modifiedTask if it's defined and clean it
    if (request.modifiedTask) {
      feedback.modifiedTask = {
        title: request.modifiedTask.title || '',
        description: request.modifiedTask.description || '',
      };
    }

    this.logger.debug('Prepared feedback item for storage', {
      feedback,
    });

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: JSON.parse(JSON.stringify(feedback)), // Ensure no undefined values
        })
      );

      this.logger.info('Feedback recorded successfully', {
        feedbackId,
        workItemId: request.workItemId,
        taskId: request.taskId,
        action: request.action,
      });

      return feedbackId;
    } catch (error) {
      this.logger.error('Failed to record feedback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        feedbackData: request,
      });
      throw error;
    }
  }

  /**
   * Get feedback for a specific work item
   */
  async getFeedbackForWorkItem(workItemId: number, limit = 50): Promise<TaskFeedback[]> {
    try {
      const response = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'workItemId-timestamp-index',
          KeyConditionExpression: 'workItemId = :workItemId',
          ExpressionAttributeValues: {
            ':workItemId': workItemId,
          },
          ScanIndexForward: false, // Most recent first
          Limit: limit,
        })
      );

      return (response.Items as TaskFeedback[]) || [];
    } catch (error) {
      this.logger.error('Failed to get feedback for work item', {
        workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get feedback by context (areaPath, businessUnit, system)
   */
  async getFeedbackByContext(
    areaPath?: string,
    businessUnit?: string,
    system?: string,
    limit = 50
  ): Promise<TaskFeedback[]> {
    try {
      const contextKey = this.buildContextKey(areaPath, businessUnit, system);

      const response = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'contextKey-timestamp-index',
          KeyConditionExpression: 'contextKey = :contextKey',
          ExpressionAttributeValues: {
            ':contextKey': contextKey,
          },
          ScanIndexForward: false, // Most recent first
          Limit: limit,
        })
      );

      return (response.Items as TaskFeedback[]) || [];
    } catch (error) {
      this.logger.error('Failed to get feedback by context', {
        areaPath,
        businessUnit,
        system,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Analyze feedback patterns for a given context
   */
  async analyzeFeedbackPatterns(
    areaPath?: string,
    businessUnit?: string,
    system?: string,
    config: FeedbackAnalysisConfig = {
      minSampleSize: 5,
      analysisWindowDays: 30,
      minConfidenceThreshold: 0.6,
      maxPatterns: 10,
    }
  ): Promise<FeedbackQueryResponse> {
    try {
      // Get recent feedback for the context
      const feedback = await this.getFeedbackByContext(areaPath, businessUnit, system);

      // Filter by time window
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - config.analysisWindowDays);

      const recentFeedback = feedback.filter((f) => new Date(f.timestamp) >= cutoffDate);

      if (recentFeedback.length < config.minSampleSize) {
        return {
          patterns: [],
          insights: [],
          totalFeedbackCount: recentFeedback.length,
        };
      }

      // Analyze patterns
      const patterns = this.extractPatterns(recentFeedback, config);
      const insights = this.generateInsights(recentFeedback, patterns, config);

      return {
        patterns: patterns.slice(0, config.maxPatterns),
        insights,
        totalFeedbackCount: recentFeedback.length,
      };
    } catch (error) {
      this.logger.error('Failed to analyze feedback patterns', {
        areaPath,
        businessUnit,
        system,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get successful task examples for learning
   */
  async getSuccessfulTaskExamples(
    areaPath?: string,
    businessUnit?: string,
    system?: string,
    limit = 20
  ): Promise<TaskFeedback[]> {
    try {
      const feedback = await this.getFeedbackByContext(areaPath, businessUnit, system);

      // Filter for successful tasks (accepted or completed without modification)
      const successfulTasks = feedback.filter(
        (f) => f.action === FeedbackAction.ACCEPTED || f.action === FeedbackAction.COMPLETED
      );

      // Sort by completion time for completed tasks (faster = better)
      return successfulTasks
        .sort((a, b) => {
          if (a.completionTimeHours && b.completionTimeHours) {
            return a.completionTimeHours - b.completionTimeHours;
          }
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        })
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Failed to get successful task examples', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get common anti-patterns to avoid
   */
  async getAntiPatterns(
    areaPath?: string,
    businessUnit?: string,
    system?: string,
    limit = 20
  ): Promise<{ title: string; description: string; frequency: number }[]> {
    try {
      const feedback = await this.getFeedbackByContext(areaPath, businessUnit, system);

      // Get tasks that were deleted or heavily modified
      const problematicTasks = feedback.filter(
        (f) => f.action === FeedbackAction.DELETED || f.action === FeedbackAction.MODIFIED
      );

      // Analyze common patterns in problematic tasks
      const titlePatterns = this.extractCommonPhrases(problematicTasks.map((f) => f.originalTask.title));

      return titlePatterns
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, limit)
        .map((pattern) => ({
          title: pattern.phrase,
          description: `Tasks with "${pattern.phrase}" were ${
            pattern.frequency > 1 ? 'frequently' : 'sometimes'
          } deleted or modified by users`,
          frequency: pattern.frequency,
        }));
    } catch (error) {
      this.logger.error('Failed to get anti-patterns', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Extract patterns from feedback data
   */
  private extractPatterns(feedback: TaskFeedback[], config: FeedbackAnalysisConfig): FeedbackPattern[] {
    const contextKey = feedback.length > 0 ? feedback[0].contextKey || '' : '';
    const [areaPath, businessUnit, system] = contextKey.split('#');

    // Calculate metrics
    const totalTasks = feedback.length;
    const acceptedTasks = feedback.filter((f) => f.action === FeedbackAction.ACCEPTED).length;
    const modifiedTasks = feedback.filter((f) => f.action === FeedbackAction.MODIFIED).length;
    const deletedTasks = feedback.filter((f) => f.action === FeedbackAction.DELETED).length;
    const missedTasks = feedback.filter((f) => f.action === FeedbackAction.MISSED_TASK).length;

    const acceptanceRate = totalTasks > 0 ? acceptedTasks / totalTasks : 0;
    const modificationRate = totalTasks > 0 ? modifiedTasks / totalTasks : 0;
    const deletionRate = totalTasks > 0 ? deletedTasks / totalTasks : 0;
    const missedTaskRate = totalTasks > 0 ? missedTasks / totalTasks : 0;

    // Extract common modifications
    const modifications = feedback
      .filter((f) => f.action === FeedbackAction.MODIFIED && f.modifiedTask)
      .map((f) => f.modifiedTask!);

    const titlePatterns = this.extractCommonPhrases(modifications.map((m) => m.title).filter(Boolean) as string[]).map(
      (p) => p.phrase
    );

    const descriptionPatterns = this.extractCommonPhrases(
      modifications.map((m) => m.description).filter(Boolean) as string[]
    ).map((p) => p.phrase);

    // Extract anti-patterns from deleted tasks
    const deletedTaskTitles = feedback
      .filter((f) => f.action === FeedbackAction.DELETED)
      .map((f) => f.originalTask.title);

    const antiPatterns = {
      titlesToAvoid: this.extractCommonPhrases(deletedTaskTitles).map((p) => p.phrase),
      descriptionsToAvoid: [], // Could be enhanced later
    };

    // Extract patterns from user-created tasks (missed by AI)
    const missedTaskPatterns = feedback
      .filter((f) => f.action === FeedbackAction.MISSED_TASK)
      .map((f) => f.originalTask);

    const missedTaskTitles = this.extractCommonPhrases(
      missedTaskPatterns.map((t) => t.title).filter(Boolean) as string[]
    ).map((p) => p.phrase);

    const missedTaskDescriptions = this.extractCommonPhrases(
      missedTaskPatterns.map((t) => t.description).filter(Boolean) as string[]
    ).map((p) => p.phrase);

    const pattern: FeedbackPattern = {
      patternId: uuidv4(),
      context: { areaPath, businessUnit, system },
      commonModifications: { titlePatterns, descriptionPatterns },
      antiPatterns,
      missedTaskPatterns: { titlePatterns: missedTaskTitles, descriptionPatterns: missedTaskDescriptions },
      metrics: {
        totalTasks,
        acceptanceRate,
        modificationRate,
        deletionRate,
        missedTaskRate,
        avgCompletionTime: this.calculateAverageCompletionTime(feedback),
      },
      lastUpdated: new Date().toISOString(),
      sampleSize: totalTasks,
    };

    return [pattern];
  }

  /**
   * Generate actionable insights from patterns
   */
  private generateInsights(
    feedback: TaskFeedback[],
    patterns: FeedbackPattern[],
    config: FeedbackAnalysisConfig
  ): FeedbackInsight[] {
    const insights: FeedbackInsight[] = [];

    for (const pattern of patterns) {
      // High deletion rate insight
      if (pattern.metrics.deletionRate > 0.3) {
        insights.push({
          insightId: uuidv4(),
          type: 'anti_pattern',
          context: pattern.context,
          description: `High task deletion rate (${(pattern.metrics.deletionRate * 100).toFixed(
            1
          )}%) indicates tasks may be too vague or irrelevant`,
          confidence: Math.min(pattern.metrics.deletionRate * 2, 1),
          evidence: {
            feedbackCount: Math.floor(pattern.metrics.totalTasks * pattern.metrics.deletionRate),
            examples: pattern.antiPatterns.titlesToAvoid.slice(0, 3),
          },
          recommendation: {
            action: 'enhance_prompt',
            details: 'Add more specific technical context and avoid generic task titles',
          },
          generatedAt: new Date().toISOString(),
        });
      }

      // High modification rate insight
      if (pattern.metrics.modificationRate > 0.4) {
        insights.push({
          insightId: uuidv4(),
          type: 'improvement_suggestion',
          context: pattern.context,
          description: `Tasks frequently modified (${(pattern.metrics.modificationRate * 100).toFixed(
            1
          )}%), suggesting they need more detail`,
          confidence: Math.min(pattern.metrics.modificationRate * 1.5, 1),
          evidence: {
            feedbackCount: Math.floor(pattern.metrics.totalTasks * pattern.metrics.modificationRate),
            examples: pattern.commonModifications.titlePatterns.slice(0, 3),
          },
          recommendation: {
            action: 'add_to_knowledge_base',
            details: 'Include successful modification patterns as examples for future generation',
          },
          generatedAt: new Date().toISOString(),
        });
      }

      // High acceptance rate insight (positive)
      if (pattern.metrics.acceptanceRate > 0.7 && pattern.sampleSize >= config.minSampleSize) {
        insights.push({
          insightId: uuidv4(),
          type: 'success_pattern',
          context: pattern.context,
          description: `High task acceptance rate (${(pattern.metrics.acceptanceRate * 100).toFixed(
            1
          )}%) - current approach is working well`,
          confidence: Math.min(pattern.metrics.acceptanceRate * 1.2, 1),
          evidence: {
            feedbackCount: Math.floor(pattern.metrics.totalTasks * pattern.metrics.acceptanceRate),
            examples: ['Tasks are well-structured and actionable'],
          },
          recommendation: {
            action: 'enhance_prompt',
            details: 'Continue using current successful patterns for this context',
          },
          generatedAt: new Date().toISOString(),
        });
      }

      // High missed task rate insight
      if (pattern.metrics.missedTaskRate > 0.2) {
        insights.push({
          insightId: uuidv4(),
          type: 'improvement_suggestion',
          context: pattern.context,
          description: `Users frequently create additional tasks (${(pattern.metrics.missedTaskRate * 100).toFixed(
            1
          )}%), indicating AI is missing important work items`,
          confidence: Math.min(pattern.metrics.missedTaskRate * 2, 1),
          evidence: {
            feedbackCount: Math.floor(pattern.metrics.totalTasks * pattern.metrics.missedTaskRate),
            examples: pattern.missedTaskPatterns.titlePatterns.slice(0, 3),
          },
          recommendation: {
            action: 'enhance_prompt',
            details: 'Include patterns from user-created tasks to improve completeness of AI task generation',
          },
          generatedAt: new Date().toISOString(),
        });
      }
    }

    return insights.filter((i) => i.confidence >= config.minConfidenceThreshold);
  }

  /**
   * Build composite key for context-based queries
   */
  private buildContextKey(areaPath?: string, businessUnit?: string, system?: string): string {
    return `${areaPath || 'ALL'}#${businessUnit || 'ALL'}#${system || 'ALL'}`;
  }

  /**
   * Extract common phrases from text array
   */
  private extractCommonPhrases(texts: string[]): { phrase: string; frequency: number }[] {
    if (texts.length === 0) return [];

    const phrases: Map<string, number> = new Map();

    texts.forEach((text) => {
      if (!text) return;

      // Simple word extraction - could be enhanced with NLP
      const words = text.toLowerCase().split(/\s+/);

      // Extract 1-3 word phrases
      for (let i = 0; i < words.length; i++) {
        for (let len = 1; len <= Math.min(3, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ');
          if (phrase.length > 2) {
            // Skip very short phrases
            phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
          }
        }
      }
    });

    return Array.from(phrases.entries())
      .map(([phrase, frequency]) => ({ phrase, frequency }))
      .filter((p) => p.frequency > 1) // Only return phrases that appear multiple times
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Calculate average completion time for completed tasks
   */
  private calculateAverageCompletionTime(feedback: TaskFeedback[]): number | undefined {
    const completedTasks = feedback.filter((f) => f.action === FeedbackAction.COMPLETED && f.completionTimeHours);

    if (completedTasks.length === 0) return undefined;

    const totalTime = completedTasks.reduce((sum, task) => sum + (task.completionTimeHours || 0), 0);

    return totalTime / completedTasks.length;
  }
}
