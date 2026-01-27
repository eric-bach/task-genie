import { Logger } from '@aws-lambda-powertools/logger';
import {
  RetrieveCommand,
  RetrieveCommandInput,
  BedrockAgentRuntimeClient,
  RetrievalFilter,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  ConverseCommand,
  ConverseCommandInput,
  BedrockRuntimeClient,
  SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

import { AzureService } from './AzureService';
import { FeedbackService } from './FeedbackService';
import {
  WorkItem,
  isUserStory,
  isEpic,
  isFeature,
  UserStory,
  Feature,
  getExpectedChildWorkItemType,
  isProductBacklogItem,
  ProductBacklogItem,
} from '../types/azureDevOps';
import {
  BedrockInferenceParams,
  BedrockKnowledgeDocument,
  BedrockWorkItemGenerationResponse,
  BedrockWorkItemEvaluationResponse,
} from '../types/bedrock';
import { FeedbackPattern, FeedbackInsight, TaskFeedback } from '../types/feedback';

export interface BedrockServiceConfig {
  region: string;
  modelId: string;
  knowledgeBaseId: string;
  maxKnowledgeDocuments?: number;
  maxImageSize?: number; // in MB
  maxImages?: number;
  configTableName?: string;
  feedbackTableName?: string;
  feedbackFeatureEnabled?: boolean;
}

const MAX_OUTPUT_TOKENS = 10240;

export class BedrockService {
  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly dynamoClient: DynamoDBClient;
  private readonly logger: any;
  private readonly config: Required<BedrockServiceConfig>;
  private readonly feedbackService?: FeedbackService;

  /**
   * Creates a new BedrockService instance
   * @param config Configuration object containing AWS region, model settings, and limits
   */
  constructor(config: BedrockServiceConfig) {
    this.config = {
      maxKnowledgeDocuments: 3,
      maxImageSize: 5,
      maxImages: 3,
      configTableName: config.configTableName || '',
      feedbackTableName: config.feedbackTableName || '',
      feedbackFeatureEnabled: config.feedbackFeatureEnabled || false,
      ...config,
    };

    this.logger = new Logger({ serviceName: 'BedrockService' });
    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region: config.region });
    this.bedrockRuntimeClient = new BedrockRuntimeClient({ region: config.region });
    this.dynamoClient = new DynamoDBClient({ region: config.region });

    // Initialize FeedbackService if feature is enabled
    if (this.config.feedbackFeatureEnabled) {
      this.feedbackService = new FeedbackService({
        region: config.region,
        tableName: this.config.feedbackTableName,
      });
    }
  }

  /**
   * Evaluates a work item to determine if it's well-defined and ready for development
   * @param workItem The Azure DevOps work item to evaluate
   * @returns An evaluation response indicating if the work item passes quality checks
   */
  public async evaluateWorkItem(workItem: WorkItem): Promise<BedrockWorkItemEvaluationResponse> {
    try {
      this.logger.info(`⚙️ Starting evaluation of ${workItem.workItemType} ${workItem.workItemId}`, {
        workItemId: workItem.workItemId,
        workItemType: workItem.workItemType,
      });

      // Step 1: Try to retrieve relevant documents from Knowledge Base
      const query = this.buildWorkItemEvaluationKnowledgeQuery(workItem);
      const filters = this.buildWorkItemEvaluationFilters(workItem.workItemType);
      const knowledgeContext = await this.retrieveKnowledgeContext(query, filters);

      // Step 2: Use direct model inference with any retrieved context
      const result = await this.invokeModelForWorkItemEvaluation(workItem, knowledgeContext);

      this.logger.info(`${workItem.workItemType} evaluation completed`, {
        workItemId: workItem.workItemId,
        documentsRetrieved: knowledgeContext.length,
        result,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to evaluate work item', {
        workItemId: workItem.workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Generates work items using AI and knowledge base context. Epic work item types will generate Features,
   * Feature work item types will generate User Stories, Product Backlog Item or User Story work item types
   * will generate Tasks.
   * @param workItem The parent work item to generate child work items for
   * @param existingChildWorkItems Array of child work items that already exist for this work item
   * @param params Optional inference parameters including custom prompts and model settings
   * @returns Generated work items along with supporting knowledge base documents
   */
  public async generateWorkItems(
    workItem: WorkItem,
    existingChildWorkItems: WorkItem[],
    params: BedrockInferenceParams = {}
  ): Promise<BedrockWorkItemGenerationResponse> {
    try {
      this.logger.info(`⚙️ Starting work item generation of ${workItem.workItemType} ${workItem.workItemId}`, {
        workItemId: workItem.workItemId,
        feedbackEnabled: !!this.feedbackService,
        isRefinement: !!params.refinementInstructions,
      });

      // Step 1: Check if this is a refinement request (skip knowledge/feedback retrieval to stay focused on user intent, unless we want to keep context)
      // Actually good to keep context, but let's prioritize the user instructions.
      // We will still fetch knowledge for context but maybe not use it as heavily.
      
      const query = this.buildWorkItemBreakdownKnowledgeQuery(workItem);
      const filters = this.buildWorkItemBreakdownFilters(workItem);
      const knowledgeContext = await this.retrieveKnowledgeContext(query, filters);

      // Step 2: Build feedback context (only if not doing slight refinement - but let's keep it for consistency)
      const feedbackContext = await this.buildFeedbackContext(workItem);

      // Step 3: Generate or Refine work items
      const workItems = await this.invokeModelForWorkItemGeneration(
        workItem,
        existingChildWorkItems,
        params,
        knowledgeContext,
        feedbackContext
      );

      this.logger.info('Work item generation completed', {
        workItemId: workItem.workItemId,
        workItems: workItems,
        workItemsCount: workItems.length,
        documentsRetrieved: knowledgeContext.length,
        feedbackEnabled: !!this.feedbackService,
      });

      return {
        workItems,
        documents: knowledgeContext,
      };
    } catch (error) {
      this.logger.error('Failed to generate work items', {
        workItemId: workItem.workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Retrieves relevant documents from the AWS Bedrock knowledge base using vector search
   * @param query The search query text to find relevant documents
   * @param filters Optional filters to narrow down the search results
   * @returns Array of processed knowledge base documents with content and metadata
   */
  private async retrieveKnowledgeContext(
    query: string,
    filters: RetrievalFilter | undefined
  ): Promise<BedrockKnowledgeDocument[]> {
    const input: RetrieveCommandInput = {
      knowledgeBaseId: this.config.knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: this.config.maxKnowledgeDocuments,
          ...filters,
        },
      },
    };

    this.logger.debug('Retrieving knowledge base context', {
      knowledgeBaseId: this.config.knowledgeBaseId,
      query,
      filterConditions: filters,
      maxResults: this.config.maxKnowledgeDocuments,
    });

    try {
      const command = new RetrieveCommand(input);
      const response = await this.bedrockAgentClient.send(command);
      const results = response.retrievalResults || [];

      this.logger.info(`📄 Retrieved ${results.length} knowledge documents`);

      return this.processKnowledgeResults(results);
    } catch (error) {
      this.logger.warn('Failed to retrieve knowledge context', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Processes raw knowledge base retrieval results into structured document objects
   * @param results Raw results array from Bedrock knowledge base retrieval
   * @returns Array of structured knowledge documents with content, source, and scoring information
   */
  private processKnowledgeResults(results: any[]): BedrockKnowledgeDocument[] {
    return results.map((result, index) => {
      const content = result.content?.text || '';
      const source = result.location?.s3Location?.uri || `Document ${index + 1}`;
      const score = result.score;

      this.logger.debug(`Processed knowledge chunk ${index + 1}`, {
        source,
        contentLength: content.length,
        score,
        preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      });

      return {
        content,
        contentLength: content.length,
        source,
        score,
      };
    });
  }

  /**
   * Constructs a knowledge base search query for work item evaluation
   * @param workItem The work item to create a search query for
   * @returns A formatted search query string for finding relevant evaluation guidelines
   */
  private buildWorkItemEvaluationKnowledgeQuery(workItem: WorkItem): string {
    let criteriaField = '';
    if ((isProductBacklogItem(workItem) || isUserStory(workItem)) && workItem.acceptanceCriteria) {
      criteriaField = `\n    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
    } else if ((isEpic(workItem) || isFeature(workItem)) && workItem.successCriteria) {
      criteriaField = `\n    - Success Criteria: ${workItem.successCriteria}`;
    }

    return `Find relevant information about the ${
      workItem.workItemType
    } process and guidelines that would help evaluate the following ${workItem.workItemType} is well-defined:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - ${
      isProductBacklogItem(workItem) || isUserStory(workItem) ? 'Acceptance Criteria' : 'Success Criteria'
    }: ${criteriaField}`;
  }

  /**
   * Constructs a knowledge base search query for work item breakdown and generation
   * @param workItem The work item to create a work item breakdown query
   * @returns A formatted search query string for finding relevant technical and architectural information
   */
  private buildWorkItemBreakdownKnowledgeQuery(workItem: WorkItem): string {
    let criteriaField = '';
    if ((isProductBacklogItem(workItem) || isUserStory(workItem)) && workItem.acceptanceCriteria) {
      criteriaField = `\n    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
    } else if ((isEpic(workItem) || isFeature(workItem)) && workItem.successCriteria) {
      criteriaField = `\n    - Success Criteria: ${workItem.successCriteria}`;
    }

    return `Find relevant information to help break down the ${workItem.workItemType} (such as technical details, application architecture, business context, etc.) for the following ${workItem.workItemType}:
    - Title: ${workItem.title}
    - Description: ${workItem.description}${criteriaField}`;
  }

  /**
   * Creates search filters for work item evaluation knowledge base queries
   * @returns Filter object configured to find agile process documentation
   */
  private buildWorkItemEvaluationFilters(workItemType: string): any {
    return {
      filter: {
        andAll: [
          {
            equals: {
              key: 'workItemType',
              value: workItemType,
            },
          },
          {
            equals: {
              key: 'areaPath',
              value: 'agile-process',
            },
          },
        ],
      },
    };
  }

  /**
   * Creates search filters for work item breakdown knowledge base queries based on work item context
   * @param workItem The work item containing area path, business unit, and system information
   * @returns Filter object configured to find relevant technical documentation
   */
  private buildWorkItemBreakdownFilters(workItem: WorkItem): any {
    const filterConditions = [];

    if (workItem.workItemType) {
      filterConditions.push({
        equals: { key: 'workItemType', value: workItem.workItemType },
      });
    }

    if (workItem.areaPath) {
      filterConditions.push({
        equals: { key: 'areaPath', value: workItem.areaPath },
      });
    }

    if (workItem.businessUnit) {
      filterConditions.push({
        equals: { key: 'businessUnit', value: workItem.businessUnit },
      });
    }

    if (workItem.system) {
      filterConditions.push({
        equals: { key: 'system', value: workItem.system },
      });
    }

    // Return appropriate filter structure based on number of conditions
    if (filterConditions.length >= 2) {
      return { filter: { andAll: filterConditions } };
    } else if (filterConditions.length === 1) {
      return { filter: filterConditions[0] };
    } else {
      return {};
    }
  }

  /**
   * Invokes the Bedrock model to evaluate work item quality and readiness
   * @param workItem The work item to evaluate
   * @param knowledgeContext Relevant knowledge base documents to provide context
   * @returns Evaluation response indicating if the work item passes quality checks
   */
  private async invokeModelForWorkItemEvaluation(
    workItem: WorkItem,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<BedrockWorkItemEvaluationResponse> {
    const systemPrompt = this.buildWorkItemEvaluationSystemPrompt(workItem);
    const userPrompt = this.buildWorkItemEvaluationUserPrompt(workItem, knowledgeContext);
    const content = await this.buildModelContent(workItem, userPrompt);

    const input: ConverseCommandInput = {
      modelId: this.config.modelId,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.5,
      },
      system: systemPrompt,
    };

    const imagesCount = content.filter((item) => item.image).length;
    const imagesSizeKB = Math.round(
      content.reduce((sum, item) => {
        if (item.image?.source?.bytes) {
          return sum + item.image.source.bytes.length / 1024;
        }
        return sum;
      }, 0)
    );

    this.logger.debug(`🧠 Invoking Bedrock model for ${workItem.workItemType} Evaluation`, {
      modelId: this.config.modelId,
      contextCount: content.length - (workItem.images?.length || 0),
      contextLength: content.reduce((sum, item) => {
        return item.type === 'text' ? sum + (item.text?.length || 0) : sum;
      }, 0),
      knowledgeCount: knowledgeContext.length,
      knowledgeContentLength: knowledgeContext.reduce((sum, doc) => sum + doc.contentLength, 0),
      imagesCount,
      imagesSizeKB,
      inferenceConfig: input.inferenceConfig,
    });

    try {
      const command = new ConverseCommand(input);
      const response = await this.bedrockRuntimeClient.send(command);

      this.logger.info('Received response from Bedrock model', {
        response,
        responseStatus: response.$metadata?.httpStatusCode,
        contentLength: response.output?.message?.content?.length,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });

      return this.parseWorkItemEvaluation(response);
    } catch (error) {
      this.logger.error('Model invocation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        modelId: this.config.modelId,
        inputStructure: {
          modelId: input.modelId,
          messagesCount: input.messages?.length,
          hasInferenceConfig: !!input.inferenceConfig,
          contentItems: content.length,
          contentTypes: content.map((item) => item.type || (item.image ? 'image' : 'unknown')),
        },
      });
      throw new Error(`Bedrock model invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Invokes the Bedrock model to generate work items for a work item
   * @param workItem The work item to generate work items for
   * @param existingChildWorkItems Array of child work items that already exist to avoid duplication
   * @param params Inference parameters including custom prompts and model settings
   * @param knowledgeContext Relevant knowledge base documents to provide technical context
   * @returns Array of generated work items with titles and descriptions
   */
  private async invokeModelForWorkItemGeneration(
    workItem: WorkItem,
    existingChildWorkItems: WorkItem[],
    params: BedrockInferenceParams,
    knowledgeContext: BedrockKnowledgeDocument[],
    feedbackContext?: string
  ): Promise<WorkItem[]> {
    const systemPrompt = await this.buildWorkItemGenerationSystemPrompt(workItem, params);
    
    let userPrompt = '';
    
    // Check if this is a refinement request
    if (params.refinementInstructions && params.generatedWorkItems) {
         userPrompt = await this.buildWorkItemRefinementUserPrompt(
            workItem,
            params.generatedWorkItems,
            params.refinementInstructions,
            existingChildWorkItems,
            knowledgeContext
         );
    } else {
         // Standard generation request
         userPrompt = await this.buildWorkItemGenerationUserPrompt(
          workItem,
          existingChildWorkItems,
          knowledgeContext,
          feedbackContext
        );
    }

    const content = await this.buildModelContent(workItem, userPrompt);

    const inferenceConfig: any = {
      maxTokens: params.maxTokens || MAX_OUTPUT_TOKENS,
    };

    // Add inference parameter (temperature OR topP, not both)
    if (params.temperature) {
      inferenceConfig.temperature = params.temperature;
    } else if (params.topP) {
      inferenceConfig.topP = params.topP;
    } else {
      // Default to temperature if neither is specified
      inferenceConfig.temperature = 0.5;
    }

    const input: ConverseCommandInput = {
      modelId: this.config.modelId,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      inferenceConfig,
      system: systemPrompt,
    };

    const textLength = content.reduce((sum, item) => {
      return item.text ? sum + item.text.length : sum;
    }, 0);

    const imagesCount = content.filter((item) => item.image).length;
    const imagesSizeKB = Math.round(
      content.reduce((sum, item) => {
        if (item.image?.source?.bytes) {
          return sum + item.image.source.bytes.length / 1024;
        }
        return sum;
      }, 0)
    );

    this.logger.info(`🧠 Invoking Bedrock model for ${getExpectedChildWorkItemType(workItem, false)} generation`, {
      modelId: this.config.modelId,
      contentItems: content.length,
      textLength,
      existingWorkItemsCount: existingChildWorkItems.length,
      knowledgeCount: knowledgeContext.length,
      knowledgeContentLength: knowledgeContext.reduce((sum, doc) => sum + doc.contentLength, 0),
      imagesCount,
      imagesSizeKB,
      feedbackContext: !!feedbackContext,
      inferenceConfig: input.inferenceConfig,
    });

    try {
      const command = new ConverseCommand(input);
      const response = await this.bedrockRuntimeClient.send(command);

      this.logger.info('Received response from Bedrock model', {
        responseStatus: response.$metadata?.httpStatusCode,
        contentLength: response.output?.message?.content?.length,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });

      return this.parseWorkItems(response);
    } catch (error) {
      this.logger.error('Model invocation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        modelId: this.config.modelId,
        inputStructure: {
          modelId: input.modelId,
          messagesCount: input.messages?.length,
          hasInferenceConfig: !!input.inferenceConfig,
          contentItems: content.length,
          contentTypes: content.map((item) => item.type || (item.image ? 'image' : 'unknown')),
        },
      });
      throw new Error(`Bedrock model invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Constructs the system prompt for work item evaluation
   * @param workItem The work item being evaluated to determine type-specific criteria
   * @returns A formatted prompt string for work item quality evaluation
   */
  private buildWorkItemEvaluationSystemPrompt(workItem: WorkItem): SystemContentBlock[] {
    let evaluationCriteria = '';

    switch (workItem.workItemType) {
      case 'Product Backlog Item':
        evaluationCriteria = `- Evaluate the product backlog item based on the following criteria:
  - It should generally state the user, the need, and the business value in some way.
  - The acceptance criteria should provide guidance that is testable or verifiable, though it need not be exhaustive.
  - The story should be appropriately sized for a development team to complete within a sprint.`;
        break;

      case 'User Story':
        evaluationCriteria = `- Evaluate the user story based on the following criteria:
  - It should generally state the user, the need, and the business value in some way.
  - The acceptance criteria should provide guidance that is testable or verifiable, though it need not be exhaustive.
  - The story should be appropriately sized for a development team to complete within a sprint.`;
        break;

      case 'Epic':
        evaluationCriteria = `- Evaluate the epic based on the following criteria:
  - It should clearly describe a high-level business objective or strategic goal.
  - The description should provide sufficient business context and rationale.
  - Success criteria should define measurable outcomes or business value.
  - The scope should be appropriate for breaking down into multiple features.`;
        break;

      case 'Feature':
        evaluationCriteria = `- Evaluate the feature based on the following criteria:
  - It should describe a cohesive piece of functionality that delivers user value.
  - The description should clearly define the functional boundaries and user interactions.
  - Success criteria should be testable and define what constitutes completion.
  - The scope should be appropriate for breaking down into multiple user stories.`;
        break;
    }

    const system: SystemContentBlock[] = [
      {
        text: `You are an AI assistant that reviews Azure DevOps work items. 
**Instructions**
- Evaluate the work item to check if it is reasonably clear and has enough detail for a developer or team to begin with minimal clarification.
- Your task is to assess the quality of a ${workItem.workItemType} based on the provided title, description, and available criteria fields.
${evaluationCriteria}
  - If images are provided, treat them as additional context to understand the work item.

**Output Rules**
- Return a JSON object with the following structure:
  - "pass": boolean (true if the work item is good enough to proceed, false only if it is seriously incomplete or confusing)
  - if "pass" is false, include a "comment" field (string) with a clear explanation of what's missing or unclear, and provide an example of a higher-quality ${workItem.workItemType} that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.
- Only output the JSON object, no extra text outside it.`,
      },
    ];

    return system;
  }

  /**
   * Constructs the user prompt for work item evaluation with knowledge context
   * @param workItem The work item to create an evaluation prompt for
   * @param knowledgeContext Relevant knowledge base documents to include in the prompt
   * @returns A formatted prompt string for work item quality evaluation
   */
  private buildWorkItemEvaluationUserPrompt(workItem: WorkItem, knowledgeContext: BedrockKnowledgeDocument[]): string {
    const knowledgeSection =
      knowledgeContext.length > 0
        ? `${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 500)}...`).join('\n')}`
        : '';

    const imagesSection =
      workItem.images && workItem.images.length > 0
        ? `${workItem.images.map((img, i) => `${i + 1}. ${img.url}${img.alt ? ` (${img.alt})` : ''}`).join('\n')}`
        : '';

    // Build criteria section based on work item type
    let criteriaSection = '';
    if ((isProductBacklogItem(workItem) || isUserStory(workItem)) && workItem.acceptanceCriteria) {
      criteriaSection = `\n  - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
    } else if ((isEpic(workItem) || isFeature(workItem)) && workItem.successCriteria) {
      criteriaSection = `\n  - Success Criteria: ${workItem.successCriteria}`;
    }

    // Add Epic-specific fields
    let epicFieldsSection = '';
    if (isEpic(workItem)) {
      const epicFields = [];
      if (workItem.objective) epicFields.push(`  - Objective: ${workItem.objective}`);
      if (workItem.addressedRisks) epicFields.push(`  - Addressed Risks: ${workItem.addressedRisks}`);
      if (workItem.pursueRisk) epicFields.push(`  - Pursue Risk: ${workItem.pursueRisk}`);
      if (workItem.mostRecentUpdate) epicFields.push(`  - Most Recent Update: ${workItem.mostRecentUpdate}`);
      if (workItem.outstandingActionItems)
        epicFields.push(`  - Outstanding Action Items: ${workItem.outstandingActionItems}`);
      if (epicFields.length > 0) {
        epicFieldsSection = `\n${epicFields.join('\n')}`;
      }
    }

    // Add Feature-specific fields
    let featureFieldsSection = '';
    if (isFeature(workItem) && workItem.businessDeliverable) {
      featureFieldsSection = `\n  - Business Deliverable: ${workItem.businessDeliverable}`;
    }

    // Add Product Backlog Item-specific fields
    let productBacklogItemFieldsSection = '';
    if (isProductBacklogItem(workItem)) {
      const productBacklogItemFields = [];
      if (workItem.releaseNotes) productBacklogItemFields.push(`  - Release Notes: ${workItem.releaseNotes}`);
      if (workItem.qaNotes) productBacklogItemFields.push(`  - QA Notes: ${workItem.qaNotes}`);
    }

    // Add User Story-specific fields
    let userStoryFieldsSection = '';
    if (isUserStory(workItem) && workItem.importance) {
      userStoryFieldsSection = `\n  - Importance: ${workItem.importance}`;
    }

    return `**Context**
- Work item: 
Use this information to understand the scope and expectation for evaluation.
  - Work Item Type: ${workItem.workItemType}
  - Title: ${workItem.title}
  - Description: ${workItem.description}
  ${criteriaSection}
  ${epicFieldsSection}${featureFieldsSection}${productBacklogItemFieldsSection}${userStoryFieldsSection}
      
- Additional contextual knowledge (if any):
Extra domain knowledge, system information, or reference material to guide more context-aware and accurate evaluation.
  ${knowledgeSection || 'None'}

- Images (if any):
Visual aids or references that provide additional context for evaluation.
  ${imagesSection || 'None'}`;
  }

  /**
   * Constructs the system prompt for work item generation. Epics generate Features, Features generate User Stories, and User Stories generate Tasks.
   * @param workItem The work item to generate child work items for
   * @param params Inference parameters that may include custom prompts
   * @returns A formatted prompt string for work item generation
   */
  private async buildWorkItemGenerationSystemPrompt(
    workItem: WorkItem,
    params: BedrockInferenceParams
  ): Promise<SystemContentBlock[]> {
    let defaultPrompt = '';

    switch (workItem.workItemType) {
      case 'Product Backlog Item':
        defaultPrompt = `You are an expert Agile software development assistant that specializes in decomposing a Product Backlog Item into clear, actionable, and appropriately sized Tasks.
**Instructions**
- Your task is to break down the provided Product Backlog Item into a sequence of Tasks that are clear and actionable for developers to work on. Each task should be independent and deployable.
- Ensure each Task has a title and a description that guides the developer (why, what, how, technical details, references to relevant systems/APIs).
- Avoid creating duplicate Tasks if they already exist.
- Do NOT create any Tasks for analysis, investigation, testing, or deployment.`;
        break;
      case 'User Story':
        defaultPrompt = `You are an expert Agile software development assistant that specializes in decomposing a User Story into clear, actionable, and appropriately sized Tasks.
**Instructions**
- Your task is to break down the provided User Story into a sequence of Tasks that are clear and actionable for developers to work on. Each task should be independent and deployable.
- Ensure each Task has a title and a description that guides the developer (why, what, how, technical details, references to relevant systems/APIs).
- Avoid creating duplicate Tasks if they already exist.
- Do NOT create any Tasks for analysis, investigation, testing, or deployment.`;
        break;
      case 'Feature':
        // Scrum process: Feature -> Product Backlog Items
        // Agile process: Feature -> User Stories
        if (workItem.processTemplate === 'Scrum') {
          defaultPrompt = `You are an expert Agile software development assistant that specializes in decomposing a Feature into clear, actionable, and appropriately sized Product Backlog Items.
**Instructions**
- Your task is to break down the provided Feature into a sequence of Product Backlog Items that are clear and deliver business value.
- Ensure each Product Backlog Item has a title, description, and acceptance criteria.
- Avoid creating duplicate Product Backlog Items if they already exist.`;
        } else {
          defaultPrompt = `You are an expert Agile software development assistant that specializes in decomposing a Feature into clear, actionable, and appropriately sized User Stories.
**Instructions**
- Your task is to break down the provided Feature into a sequence of User Stories that are clear and deliver business value.
- Ensure each User Story has a title, description, and acceptance criterial.
- Avoid creating duplicate User Stories if they already exist.`;
        }
        break;
      case 'Epic':
        defaultPrompt = `You are an expert Agile software development assistant that specializes in decomposing an Epic into clear, actionable, and appropriately sized Features.
**Instructions**
- Your task is to break down the provided Epic into a sequence of Features that are clear and deliver business value.
- Ensure each Feature has a title and a comprehensive description.
- Avoid creating duplicate Features if they already exist.`;
        break;
    }

    // Get base prompt (either custom override or default)
    const basePrompt = (await this.resolvePrompt(workItem, params.prompt)) || defaultPrompt;

    const system: SystemContentBlock[] = [];
    switch (workItem.workItemType) {
      case 'Product Backlog Item':
        system.push({
          text: `${basePrompt}\n
**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object.`,
        });
        break;
      case 'User Story':
        system.push({
          text: `${basePrompt}\n
**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object.`,
        });
        break;
      case 'Feature':
        // Scrum process: Feature -> Product Backlog Items
        // Agile process: Feature -> User Stories
        if (workItem.processTemplate === 'Scrum') {
          system.push({
            text: `${basePrompt}\n
**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of product backlog item objects, each with:
    - "title": string (product backlog item title, prefixed with order, e.g., "1. Product Backlog Item Title")
    - "description": string (detailed product backlog item description with HTML formatting)
    - "acceptanceCriteria": string (detailed acceptance criteria with HTML formatting)
- DO NOT output any text outside of the JSON object.`,
          });
        } else {
          system.push({
            text: `${basePrompt}\n
**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of user story objects, each with:
    - "title": string (user story title, prefixed with order, e.g., "1. User Story Title")
    - "description": string (detailed user story description with HTML formatting)
    - "acceptanceCriteria": string (detailed acceptance criteria with HTML formatting)
- DO NOT output any text outside of the JSON object.`,
          });
        }
        break;
      case 'Epic':
        system.push({
          text: `${basePrompt}\n
**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of feature objects, each with:
    - "title": string (feature title, prefixed with order, e.g., "1. Feature Title")
    - "description": string (detailed feature description with HTML formatting)
    - "successCriteria": string (detailed success criteria with HTML formatting)
- DO NOT output any text outside of the JSON object.`,
        });
        break;
    }

    return system;
  }

  /**
   * Constructs the user prompt for work item generation with all relevant context
   * @param workItem The work item to generate child work items for
   * @param existingChildWorkItems Array of existing child work items to avoid duplication
   * @param knowledgeContext Relevant knowledge base documents to provide technical context
   * @param feedbackContext Optional feedback insights to guide work item generation
   * @returns A formatted prompt string for work item generation
   */
  private async buildWorkItemGenerationUserPrompt(
    workItem: WorkItem,
    existingChildWorkItems: WorkItem[],
    knowledgeContext: BedrockKnowledgeDocument[],
    feedbackContext?: string
  ): Promise<string> {
    const imagesSection =
      workItem.images && workItem.images.length > 0
        ? `${workItem.images.map((img, i) => `${i + 1}. ${img.url}${img.alt ? ` (${img.alt})` : ''}`).join('\n')}`
        : '';

    const knowledgeSection =
      knowledgeContext.length > 0
        ? `${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 500)}...`).join('\n')}`
        : '';

    // Build criteria section based on work item type
    let criteriaSection = '';
    if ((isProductBacklogItem(workItem) || isUserStory(workItem)) && workItem.acceptanceCriteria) {
      criteriaSection = `\n  - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
    } else if ((isEpic(workItem) || isFeature(workItem)) && workItem.successCriteria) {
      criteriaSection = `\n  - Success Criteria: ${workItem.successCriteria}`;
    }

    // Add type-specific fields
    let typeSpecificFields = '';
    if (isEpic(workItem)) {
      const epicFields = [];
      if (workItem.objective) epicFields.push(`  - Objective: ${workItem.objective}`);
      if (workItem.addressedRisks) epicFields.push(`  - Addressed Risks: ${workItem.addressedRisks}`);
      if (workItem.pursueRisk) epicFields.push(`  - Pursue Risk: ${workItem.pursueRisk}`);
      if (workItem.mostRecentUpdate) epicFields.push(`  - Most Recent Update: ${workItem.mostRecentUpdate}`);
      if (workItem.outstandingActionItems)
        epicFields.push(`  - Outstanding Action Items: ${workItem.outstandingActionItems}`);
      if (epicFields.length > 0) {
        typeSpecificFields = `\n${epicFields.join('\n')}`;
      }
    } else if (isFeature(workItem) && workItem.businessDeliverable) {
      typeSpecificFields = `\n  - Business Deliverable: ${workItem.businessDeliverable}`;
    } else if (isProductBacklogItem(workItem)) {
      const productBacklogItemFields = [];
      if (workItem.releaseNotes) productBacklogItemFields.push(`  - Release Notes: ${workItem.releaseNotes}`);
      if (workItem.qaNotes) productBacklogItemFields.push(`  - QA Notes: ${workItem.qaNotes}`);
    } else if (isUserStory(workItem) && workItem.importance) {
      typeSpecificFields = `\n  - Importance: ${workItem.importance}`;
    }

    const childWorkItemType = `${getExpectedChildWorkItemType(workItem, true) || 'child work items'}`;

    // Build the existing child work items list with type-specific details
    let existingChildWorkItemsList = 'None';
    if (existingChildWorkItems.length > 0) {
      if (childWorkItemType === 'Features') {
        existingChildWorkItemsList = existingChildWorkItems
          .map((item, i) => {
            const featureItem = item as Feature;
            let details = `${i + 1}. ${item.title}`;
            if (featureItem.businessDeliverable) {
              details += `\n   Business Deliverable: ${featureItem.businessDeliverable}`;
            }
            if (featureItem.successCriteria) {
              details += `\n   Success Criteria: ${featureItem.successCriteria}`;
            }
            return details;
          })
          .join('\n\n');
      } else if (childWorkItemType === 'Product Backlog Items') {
        existingChildWorkItemsList = existingChildWorkItems
          .map((item, i) => {
            const productBacklogItem = item as ProductBacklogItem;
            let details = `${i + 1}. ${item.title}`;
            if (item.description) {
              details += `\n   Description: ${item.description}`;
            }
            if (productBacklogItem.acceptanceCriteria) {
              details += `\n   Acceptance Criteria: ${productBacklogItem.acceptanceCriteria}`;
            }
            if (productBacklogItem.releaseNotes) {
              details += `\n   Release Notes: ${productBacklogItem.releaseNotes}`;
            }
            if (productBacklogItem.qaNotes) {
              details += `\n   QA Notes: ${productBacklogItem.qaNotes}`;
            }
            return details;
          })
          .join('\n\n');
      } else if (childWorkItemType === 'User Stories') {
        existingChildWorkItemsList = existingChildWorkItems
          .map((item, i) => {
            const userStoryItem = item as UserStory;
            let details = `${i + 1}. ${item.title}`;
            if (item.description) {
              details += `\n   Description: ${item.description}`;
            }
            if (userStoryItem.acceptanceCriteria) {
              details += `\n   Acceptance Criteria: ${userStoryItem.acceptanceCriteria}`;
            }
            if (userStoryItem.importance) {
              details += `\n   Importance: ${userStoryItem.importance}`;
            }
            return details;
          })
          .join('\n\n');
      } else {
        existingChildWorkItemsList = existingChildWorkItems
          .map((item, i) => {
            let details = `${i + 1}. ${item.title}`;
            if (item.description) {
              details += `\n   Description: ${item.description}`;
            }
            return details;
          })
          .join('\n\n');
      }
    }

    // ... code above ...
    
    return `**Context**
- Work item:
Use this information to understand the scope and expectation to generate relevant tasks.
  - Work Item Type: ${workItem.workItemType}
  - Title: ${workItem.title}
  - Description: ${workItem.description}${criteriaSection}${typeSpecificFields}

- Existing ${childWorkItemType} (if any):
Current ${childWorkItemType} already created for this ${
      workItem.workItemType
    }. Avoid duplicating these; generate only missing or supplementary ${childWorkItemType} for completeness.
  ${existingChildWorkItemsList}

- Feedback or past learnings (if any):
Previous user feedback relevant to this ${
      workItem.workItemType
    }; such as tasks that were missed, or tasks that were removed or not relevant. Incorporate these insights to improve quality and relevance.
  ${feedbackContext || 'None'}

- Images (if any):
Visual aids or references that provide additional context for task generation.
  ${imagesSection || 'None'}
      
- Additional contextual knowledge (if any):
Extra domain knowledge, system information, or reference material to guide more context-aware and accurate task generation.
  ${knowledgeSection || 'None'}`;
  }

  /**
   * Constructs the user prompt for work item refinement based on user instructions
   */
  private async buildWorkItemRefinementUserPrompt(
    workItem: WorkItem,
    draftWorkItems: WorkItem[],
    instructions: string,
    existingChildWorkItems: WorkItem[],
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<string> {
    
    const childWorkItemType = `${getExpectedChildWorkItemType(workItem, true) || 'child work items'}`;
    
    // Format the current draft list
    const draftList = draftWorkItems.map((item, i) => {
        let text = `${i + 1}. ${item.title}`;
        if (item.description) text += `\n   Description: ${item.description.replace(/<[^>]*>/g, '').substring(0, 150)}...`; // Brief description
        return text;
    }).join('\n\n');

    // Build context similar to generation (brief version)
    const knowledgeSection = knowledgeContext.length > 0
        ? `\n\nReference Context:\n${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 300)}...`).join('\n')}`
        : '';
        
     let criteriaSection = '';
    if ((isProductBacklogItem(workItem) || isUserStory(workItem)) && workItem.acceptanceCriteria) {
      criteriaSection = `\nRequired Criteria: ${workItem.acceptanceCriteria}`;
    }

    return `**Refinement Request**

You have previously generated a list of ${childWorkItemType} for the ${workItem.workItemType}: "${workItem.title}".
Criteria: ${criteriaSection}

**Current Draft List:**
${draftList}

**User Instructions:**
"${instructions}"

**Task:**
Update the list of ${childWorkItemType} based on the User Instructions. 
- If the user asks to add something, add it as a new item.
- If the user asks to remove something, remove it.
- If the user asks to change details, update the relevant item.
- Keep the rest of the list stable unless the instructions imply broader changes.
- Ensure all items remain clear, actionable, and appropriately sized.

Return the COMPLETE updated list of work items in the specified JSON format.`;
  }

  /**
   * Builds multi-modal content array combining text prompt with processed images
   * @param workItem The work item containing potential image attachments
   * @param userPrompt The user prompt to include in the content
   * @returns Array of content items including text and processed images for model input
   */
  private async buildModelContent(workItem: WorkItem, userPrompt: string): Promise<any[]> {
    const content: any[] = [
      {
        type: 'text',
        text: userPrompt,
      },
    ];

    if (!workItem.images || workItem.images.length === 0) {
      return content;
    }

    const imagesToProcess = workItem.images.slice(0, this.config.maxImages);

    let i = 0;
    for (const image of imagesToProcess) {
      ++i;

      try {
        const azureService = new AzureService();

        const imageData = await azureService.fetchImage(image.url);
        if (imageData && this.isImageSizeValid(imageData)) {
          const imageBytes = Buffer.from(imageData, 'base64');
          const format = this.detectImageFormat(imageBytes);

          content.push({
            image: {
              format: format,
              source: {
                bytes: imageBytes,
              },
            },
          });

          this.logger.debug(`📷 Added image (${i} of ${imagesToProcess.length}) to model input`, {
            url: image.url,
            format: format,
            sizeKB: Math.round((imageData.length * 3) / 4 / 1024),
          });
        }
      } catch (error) {
        this.logger.warn('Failed to process image', {
          url: image.url,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (workItem.images.length > this.config.maxImages) {
      this.logger.info('Limited images for model input', {
        total: workItem.images.length,
        processed: this.config.maxImages,
      });
    }

    return content;
  }

  /**
   * Validates that an image meets the configured size limits
   * @param base64Data The base64-encoded image data to validate
   * @returns True if the image is within size limits, false otherwise
   */
  private isImageSizeValid(base64Data: string): boolean {
    const sizeInBytes = (base64Data.length * 3) / 4;
    const sizeInMB = sizeInBytes / (1024 * 1024);

    if (sizeInMB > this.config.maxImageSize) {
      this.logger.warn('Image exceeds size limit', {
        actualSizeMB: Math.round(sizeInMB * 100) / 100,
        limitMB: this.config.maxImageSize,
      });
      return false;
    }

    return true;
  }

  /**
   * Detects image format from binary data by examining file signatures
   * @param buffer The image buffer to analyze
   * @returns The detected image format (jpeg, png, webp, gif) or jpeg as default
   */
  private detectImageFormat(buffer: Buffer): string {
    // Check file signatures (magic numbers)
    if (buffer.length >= 4) {
      // JPEG: FF D8 FF
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpeg';
      }
      // PNG: 89 50 4E 47
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'png';
      }
      // WebP: 52 49 46 46 ... 57 45 42 50
      if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer.length >= 12 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      ) {
        return 'webp';
      }
      // GIF: 47 49 46 38
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return 'gif';
      }
    }

    // Default to jpeg if we can't detect the format
    this.logger.warn('Could not detect image format, defaulting to jpeg', {
      firstFourBytes:
        buffer.length >= 4
          ? Array.from(buffer.slice(0, 4))
              .map((b) => b.toString(16))
              .join(' ')
          : 'insufficient data',
    });
    return 'jpeg';
  }

  /**
   * Parses the Bedrock model response for work item evaluation
   * @param response The raw response from the Bedrock Converse API
   * @returns Parsed evaluation response with pass/fail status and optional comments
   */
  private parseWorkItemEvaluation(response: any): BedrockWorkItemEvaluationResponse {
    // Converse API returns response directly without needing to decode body
    const messageContent = response.output?.message?.content;

    if (!messageContent || !Array.isArray(messageContent) || messageContent.length === 0) {
      this.logger.error('Invalid message content structure in Converse API response', {
        hasOutput: !!response.output,
        hasMessage: !!response.output?.message,
        hasContent: !!response.output?.message?.content,
        contentType: typeof response.output?.message?.content,
        contentLength: Array.isArray(messageContent) ? messageContent.length : 'not array',
        response: JSON.stringify(response, null, 2),
      });
      throw new Error('Invalid message content structure in model response');
    }

    const content = messageContent[0]?.text;

    if (!content) {
      this.logger.error('No text content found in first message content item', {
        firstItem: messageContent[0],
        response: JSON.stringify(response, null, 2),
      });
      throw new Error('No text content found in model response');
    }

    const parsedResponse = this.safeJsonParse(content);

    if (!parsedResponse) {
      this.logger.error('Failed to parse JSON from model response', {
        rawContent: content,
      });
      throw new Error('Invalid JSON response from model');
    }

    this.logger.info('Parsed Bedrock model response', {
      response: parsedResponse,
    });

    return parsedResponse;
  }

  /**
   * Parses the Bedrock model response and extracts generated work items
   * @param response The raw response from the Bedrock Converse API
   * @returns Array of parsed work items with titles and descriptions
   */
  private parseWorkItems(response: any): WorkItem[] {
    // Log the full response structure for debugging
    this.logger.debug('Full Bedrock response structure for parsing', {
      hasOutput: !!response.output,
      hasMessage: !!response.output?.message,
      hasContent: !!response.output?.message?.content,
      contentLength: response.output?.message?.content?.length,
      hasUsage: !!response.usage,
    });

    // Converse API returns response directly without needing to decode body
    const messageContent = response.output?.message?.content;

    if (!messageContent || !Array.isArray(messageContent) || messageContent.length === 0) {
      this.logger.error('Invalid message content structure in Converse API response', {
        hasOutput: !!response.output,
        hasMessage: !!response.output?.message,
        hasContent: !!response.output?.message?.content,
        contentType: typeof response.output?.message?.content,
        contentLength: Array.isArray(messageContent) ? messageContent.length : 'not array',
        response: JSON.stringify(response, null, 2),
      });
      throw new Error('🛑 Invalid message content structure in model response');
    }

    const content = messageContent[0]?.text;
    const outputTokens = response.usage?.outputTokens;

    if (!content) {
      this.logger.error('No text content found in first message content item', {
        firstItem: messageContent[0],
        response: JSON.stringify(response, null, 2),
      });
      throw new Error('🛑 No text content found in model response');
    }

    if (outputTokens && outputTokens >= MAX_OUTPUT_TOKENS) {
      this.logger.error('🛑 Output token limit exceeded', {
        outputTokens,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
      throw new Error('Model response exceeds maximum token limit');
    }

    const parsedResponse = this.safeJsonParse(content);
    if (!parsedResponse || !parsedResponse.workItems) {
      this.logger.error('Failed to parse work items from model response', {
        rawContent: content,
        parsedResponse,
      });
      throw new Error('🛑 Invalid JSON response from model');
    }

    this.logger.info('Received Bedrock model response', {
      workItems: parsedResponse.workItems,
      workItemsCount: parsedResponse.workItems.length,
    });

    return parsedResponse.workItems;
  }

  /**
   * Safely parses JSON strings with error handling for malformed model responses
   * @param input The input string that may contain JSON
   * @returns Parsed JSON object or undefined if parsing fails
   */
  private safeJsonParse<T = any>(input: string): T | undefined {
    // Find the first '{' and the last '}'
    const start = input.indexOf('{');
    const end = input.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      return undefined; // No valid JSON found
    }

    const jsonSubstring = input.slice(start, end + 1);

    try {
      return JSON.parse(jsonSubstring);
    } catch {
      return undefined; // Invalid JSON
    }
  }

  /**
   * Resolves the prompt to use for work item generation with priority-based selection
   * Priority: 1) Parameter override, 2) Database config, 3) Default (undefined)
   * @param workItem The work item used for database prompt lookup
   * @param parameterPrompt Optional prompt override passed as parameter
   * @returns The resolved prompt string or undefined to use default
   */
  private async resolvePrompt(workItem: WorkItem, parameterPrompt?: string): Promise<string | undefined> {
    // If a prompt was passed as a parameter, use it (highest priority)
    if (parameterPrompt) {
      this.logger.info(`⭐ Using prompt override for ${getExpectedChildWorkItemType(workItem, false)} generation`, {
        prompt: parameterPrompt,
        source: 'parameter',
      });
      return parameterPrompt;
    }

    const databasePrompt = await this.getCustomPrompt(workItem);
    if (databasePrompt) {
      this.logger.info(`⭐ Using prompt override for ${getExpectedChildWorkItemType(workItem, false)} generation`, {
        prompt: databasePrompt,
        source: 'database',
      });
      return databasePrompt;
    }

    // No override found, will use default prompt in buildWorkItemGenerationPrompt
    this.logger.debug('No prompt override found, using default prompt');
    return undefined;
  }

  /**
   * Retrieves a custom prompt from the DynamoDB config table based on work item context
   * @param workItem The work item containing work item type, area path, business unit, and system information
   * @returns Custom prompt string if found, undefined otherwise
   */
  private async getCustomPrompt(workItem: WorkItem): Promise<string | undefined> {
    if (!this.config.configTableName) {
      this.logger.warn('Config table name not configured, skipping custom prompt lookup.');
      return undefined;
    }

    // Construct the adoKey from workItem properties including workItemType
    const adoKey = `${workItem.workItemType}#${workItem.areaPath}#${workItem.businessUnit || ''}#${
      workItem.system || ''
    }`;

    const input = {
      TableName: this.config.configTableName,
      Key: {
        adoKey: { S: adoKey },
      },
    };

    try {
      const command = new GetItemCommand(input);
      const response = await this.dynamoClient.send(command);

      if (response.Item) {
        const configItem = response.Item as any;
        this.logger.debug('Found custom prompt override. Using prompt override.', {
          adoKey: adoKey,
          prompt: configItem.prompt?.S,
        });

        return configItem.prompt?.S;
      }

      return undefined;
    } catch (error) {
      this.logger.error('Failed to retrieve custom prompt from config table', {
        adoKey: adoKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  /**
   * Get feedback examples for learning from similar work items
   */
  private async getFeedbackExamples(workItem: WorkItem): Promise<{
    patterns: FeedbackPattern[];
    insights: FeedbackInsight[];
    successfulExamples: TaskFeedback[];
    antiPatterns: { title: string; description: string; frequency: number }[];
  } | null> {
    if (!this.feedbackService) {
      this.logger.debug('ℹ️ Feedback service not available or not enabled, skipping feedback context');
      return null;
    }

    try {
      // Analyze feedback patterns for this context
      const feedbackAnalysis = await this.feedbackService.analyzeFeedbackPatterns(
        workItem.areaPath,
        workItem.businessUnit,
        workItem.system
      );

      // Get successful task examples
      const successfulExamples = await this.feedbackService.getSuccessfulTaskExamples(
        workItem.areaPath,
        workItem.businessUnit,
        workItem.system,
        10
      );

      // Get anti-patterns to avoid
      const antiPatterns = await this.feedbackService.getAntiPatterns(
        workItem.areaPath,
        workItem.businessUnit,
        workItem.system,
        5
      );

      if (
        feedbackAnalysis.patterns.length > 0 ||
        feedbackAnalysis.insights.length > 0 ||
        successfulExamples.length > 0 ||
        antiPatterns.length > 0
      ) {
        this.logger.info('Retrieved feedback context to assist in task generation', {
          workItemId: workItem.workItemId,
          patternsCount: feedbackAnalysis.patterns.length,
          insightsCount: feedbackAnalysis.insights.length,
          successfulExamplesCount: successfulExamples.length,
          antiPatternsCount: antiPatterns.length,
        });
      } else {
        this.logger.info('No feedback context found for work item', {
          workItemId: workItem.workItemId,
        });
      }

      return {
        patterns: feedbackAnalysis.patterns,
        insights: feedbackAnalysis.insights,
        successfulExamples,
        antiPatterns,
      };
    } catch (error) {
      this.logger.error('Failed to get feedback context', {
        workItemId: workItem.workItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Build feedback context for the prompt
   */
  private async buildFeedbackContext(workItem: WorkItem): Promise<string> {
    if (workItem.workItemType !== 'User Story') {
      this.logger.warn('⚠️ Feedback context is currently only available for User Story work items');
      return '';
    }

    const feedbackExamples = await this.getFeedbackExamples(workItem);
    if (!feedbackExamples) {
      return '';
    }

    const enhancements: string[] = [];

    // Add successful examples section
    if (feedbackExamples.successfulExamples?.length > 0) {
      const examples = feedbackExamples.successfulExamples
        .slice(0, 3)
        .map(
          (example: TaskFeedback) =>
            `- "${example.originalTask.title}": ${example.originalTask.description.substring(0, 200)}...`
        )
        .join('\n');

      enhancements.push(`**✅ SUCCESSFUL TASK PATTERNS (Learn from these):**
${examples}`);
    }

    // Add anti-patterns section
    if (feedbackExamples.antiPatterns?.length > 0) {
      const antiPatterns = feedbackExamples.antiPatterns
        .slice(0, 3)
        .map((pattern: any) => `- Avoid: "${pattern.title}" (${pattern.description})`)
        .join('\n');

      enhancements.push(`**❌ AVOID THESE PATTERNS (Users frequently deleted/modified these):**
${antiPatterns}`);
    }

    // Add insights section
    if (feedbackExamples.insights?.length > 0) {
      const insights = feedbackExamples.insights
        .filter((insight: FeedbackInsight) => insight.confidence > 0.7)
        .slice(0, 2)
        .map((insight: FeedbackInsight) => `- ${insight.description} (${insight.recommendation.details})`)
        .join('\n');

      if (insights) {
        enhancements.push(`**📊 FEEDBACK INSIGHTS:**
${insights}`);
      }
    }

    // Add metrics-based guidance
    if (feedbackExamples.patterns?.length > 0) {
      const pattern = feedbackExamples.patterns[0];
      const metrics = pattern.metrics;

      if (metrics.modificationRate > 0.3) {
        enhancements.push(
          `**⚠️ ATTENTION:** ${Math.round(
            metrics.modificationRate * 100
          )}% of tasks in this context are typically modified by users. Focus on adding more specific technical details and clear acceptance criteria.`
        );
      }

      if (metrics.deletionRate > 0.2) {
        enhancements.push(
          `**⚠️ ATTENTION:** ${Math.round(
            metrics.deletionRate * 100
          )}% of tasks in this context are typically deleted by users. Ensure tasks are relevant, actionable, and not too high-level.`
        );
      }

      if (metrics.missedTaskRate > 0.15) {
        const missedPatterns = pattern.missedTaskPatterns;
        if (missedPatterns.titlePatterns.length > 0) {
          const patterns = missedPatterns.titlePatterns
            .slice(0, 3)
            .map((title: string) => `- "${title}"`)
            .join('\n');

          enhancements.push(
            `**📋 COMMONLY MISSED TASKS:** ${Math.round(
              metrics.missedTaskRate * 100
            )}% of users create additional tasks. Consider including tasks like:\n${patterns}`
          );
        }
      }
    }

    if (enhancements.length > 0) {
      this.logger.debug('🔀 Added feedback context for task generation', {
        successfulExamples: feedbackExamples?.successfulExamples?.length || 0,
        succcessfulExamplesSample: JSON.stringify(feedbackExamples?.successfulExamples).substring(0, 200),

        antiPatterns: feedbackExamples?.antiPatterns?.length || 0,
        antiPatternsSample: JSON.stringify(feedbackExamples?.antiPatterns).substring(0, 200),

        feedbackInsights: feedbackExamples?.insights?.length || 0,
        feedbackInsightsSample: JSON.stringify(feedbackExamples?.insights).substring(0, 200),

        feedbackPatternsUsed: feedbackExamples?.patterns?.length || 0,
        feedbackPatternsSample: JSON.stringify(feedbackExamples?.patterns).substring(0, 200),
      });
    }

    return enhancements.length > 0 ? `\n**🤖 AI LEARNING FROM USER FEEDBACK:**\n${enhancements.join('\n\n')}` : '';
  }
}
