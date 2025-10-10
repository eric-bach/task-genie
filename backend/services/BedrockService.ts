import { Logger } from '@aws-lambda-powertools/logger';
import {
  RetrieveCommand,
  RetrieveCommandInput,
  BedrockAgentRuntimeClient,
  RetrievalFilter,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { ConverseCommand, ConverseCommandInput, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

import { AzureService } from './AzureService';
import { WorkItem, Task } from '../types/azureDevOps';
import {
  BedrockInferenceParams,
  BedrockKnowledgeDocument,
  BedrockTaskGenerationResponse,
  BedrockWorkItemEvaluationResponse,
} from '../types/bedrock';

export interface BedrockServiceConfig {
  region: string;
  modelId: string;
  knowledgeBaseId: string;
  maxKnowledgeDocuments?: number;
  maxImageSize?: number; // in MB
  maxImages?: number;
  configTableName?: string; // Optional: for custom prompts
}

const MAX_OUTPUT_TOKENS = 10240;

export class BedrockService {
  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly dynamoClient: DynamoDBClient;
  private readonly logger: any;
  private readonly config: Required<BedrockServiceConfig>;

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
      ...config,
    };

    this.logger = new Logger({ serviceName: 'BedrockService' });
    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region: config.region });
    this.bedrockRuntimeClient = new BedrockRuntimeClient({ region: config.region });
    this.dynamoClient = new DynamoDBClient({ region: config.region });
  }

  /**
   * Evaluates a work item to determine if it's well-defined and ready for development
   * @param workItem The Azure DevOps work item to evaluate
   * @returns An evaluation response indicating if the work item passes quality checks
   */
  public async evaluateWorkItem(workItem: WorkItem): Promise<BedrockWorkItemEvaluationResponse> {
    try {
      this.logger.info('⚙️ Starting work item evaluation', { workItemId: workItem.workItemId });

      // Step 1: Try to retrieve relevant documents from Knowledge Base
      const query = this.buildWorkItemEvaluationKnowledgeQuery(workItem);
      const filters = this.buildWorkItemEvaluationFilters();
      const knowledgeContext = await this.retrieveKnowledgeContext(query, filters);

      // Step 2: Use direct model inference with any retrieved context
      const result = await this.invokeModelForWorkItemEvaluation(workItem, knowledgeContext);

      this.logger.info('Work item evaluation completed', {
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
   * Generates development tasks for a work item using AI and knowledge base context
   * @param workItem The Azure DevOps work item to generate tasks for
   * @param existingTasks Array of tasks that already exist for this work item
   * @param params Optional inference parameters including custom prompts and model settings
   * @returns Generated tasks along with supporting knowledge base documents
   */
  public async generateTasks(
    workItem: WorkItem,
    existingTasks: Task[],
    params: BedrockInferenceParams = {}
  ): Promise<BedrockTaskGenerationResponse> {
    try {
      this.logger.info('⚙️ Starting task generation', { workItemId: workItem.workItemId });

      // Step 1: Retrieve relevant knowledge base context
      const query = this.buildTaskBreakdownKnowledgeQuery(workItem);
      const filters = this.buildTaskBreakdownFilters(workItem);
      const knowledgeContext = await this.retrieveKnowledgeContext(query, filters);

      // Resolve the prompt to use (parameter override takes precedence over database config)
      const resolvedPrompt = await this.resolvePrompt(workItem, params.prompt);
      const enhancedParams = { ...params, prompt: resolvedPrompt };

      // Step 2: Generate tasks using the model
      const tasks = await this.invokeModelForTaskGeneration(workItem, existingTasks, enhancedParams, knowledgeContext);

      this.logger.info('Task generation completed', {
        workItemId: workItem.workItemId,
        tasks,
        tasksCount: tasks.length,
        documentsRetrieved: knowledgeContext.length,
      });

      return {
        tasks,
        documents: knowledgeContext,
      };
    } catch (error) {
      this.logger.error('Failed to generate tasks', {
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
    return `Find relevant information about the user story process and guidelines that would help evaluate the following user story is well-defined:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
  }

  /**
   * Constructs a knowledge base search query for task breakdown and generation
   * @param workItem The work item to create a task breakdown query for
   * @returns A formatted search query string for finding relevant technical and architectural information
   */
  private buildTaskBreakdownKnowledgeQuery(workItem: WorkItem): string {
    return `Find relevant information to help with task breakdown (such as technical details, application architecture, business context, etc.) for the following use story:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
  }

  /**
   * Creates search filters for work item evaluation knowledge base queries
   * @returns Filter object configured to find agile process documentation
   */
  private buildWorkItemEvaluationFilters(): any {
    return {
      filter: {
        equals: {
          key: 'areaPath',
          value: 'agile-process',
        },
      },
    };
  }

  /**
   * Creates search filters for task breakdown knowledge base queries based on work item context
   * @param workItem The work item containing area path, business unit, and system information
   * @returns Filter object configured to find relevant technical documentation
   */
  private buildTaskBreakdownFilters(workItem: WorkItem): any {
    const filterConditions = [];

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
    const prompt = this.buildWorkItemEvaluationPrompt(workItem, knowledgeContext);
    const content = await this.buildModelContent(workItem, prompt);

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

    this.logger.debug('🧠 Invoking Bedrock model for Work Item Evaluation', {
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
   * Invokes the Bedrock model to generate development tasks for a work item
   * @param workItem The work item to generate tasks for
   * @param existingTasks Array of tasks that already exist to avoid duplication
   * @param params Inference parameters including custom prompts and model settings
   * @param knowledgeContext Relevant knowledge base documents to provide technical context
   * @returns Array of generated tasks with titles and descriptions
   */
  private async invokeModelForTaskGeneration(
    workItem: WorkItem,
    existingTasks: Task[],
    params: BedrockInferenceParams,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<Task[]> {
    const prompt = await this.buildTaskGenerationPrompt(workItem, existingTasks, params, knowledgeContext);
    const content = await this.buildModelContent(workItem, prompt);

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

    this.logger.info('🧠 Invoking Bedrock model for Task Breakdown', {
      modelId: this.config.modelId,
      contentItems: content.length,
      textLength,
      tasksCount: existingTasks.length,
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
        responseStatus: response.$metadata?.httpStatusCode,
        contentLength: response.output?.message?.content?.length,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });

      return this.parseTasks(response);
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
   * Constructs the AI prompt for work item evaluation with knowledge context
   * @param workItem The work item to create an evaluation prompt for
   * @param knowledgeContext Relevant knowledge base documents to include in the prompt
   * @returns A formatted prompt string for work item quality evaluation
   */
  private buildWorkItemEvaluationPrompt(workItem: WorkItem, knowledgeContext: BedrockKnowledgeDocument[]): string {
    const knowledgeSection =
      knowledgeContext.length > 0
        ? `${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 500)}...`).join('\n')}`
        : '';

    const imagesSection =
      workItem.images && workItem.images.length > 0
        ? `${workItem.images.map((img, i) => `${i + 1}. ${img.url}${img.alt ? ` (${img.alt})` : ''}`).join('\n')}`
        : '';

    return `You are an AI assistant that reviews Azure DevOps work items. 
**Instructions**
- Evaluate the work item to ensure it is reasonably clear, has enough detail to be understood, and is ready for a developer to work on with minimal clarification.
- Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

- Evaluate the user story based on the following criteria:
  - It states the user, need, and business value in some form.
  - The acceptance criteria is testable and provides some direction.
  - If images are provided, treat them as additional context.

**Context**
- The work item to review is: 
  - Title: ${workItem.title}
  - Description: ${workItem.description}
  - Acceptance Criteria: ${workItem.acceptanceCriteria}
      
Additional business or domain context from knowledge base:
  ${knowledgeSection}

Images referenced:
  ${imagesSection}

**Output Rules**
- Return your assessment as a valid JSON object with the following structure:
  - "pass": boolean (true if the work item is good enough to proceed, false only it it is seriously incomplete or unclear)
  - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide a concrete example of a high-quality story that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.
- Only output a JSON object, no additional text.`;
  }

  /**
   * Constructs the AI prompt for task generation with all relevant context
   * @param workItem The work item to generate tasks for
   * @param existingTasks Array of existing tasks to avoid duplication
   * @param params Inference parameters that may include custom prompts
   * @param knowledgeContext Relevant knowledge base documents to provide technical context
   * @returns A formatted prompt string for task generation
   */
  private async buildTaskGenerationPrompt(
    workItem: WorkItem,
    existingTasks: Task[],
    params: BedrockInferenceParams,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<string> {
    const imagesSection =
      workItem.images && workItem.images.length > 0
        ? `${workItem.images.map((img, i) => `${i + 1}. ${img.url}${img.alt ? ` (${img.alt})` : ''}`).join('\n')}`
        : '';
    const knowledgeSection =
      knowledgeContext.length > 0
        ? `${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 500)}...`).join('\n')}`
        : '';

    const defaultPrompt = `You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing work items into actionable tasks.
**Instructions**
- Your task is to break down the provided work item into a sequence of tasks that are clear and actionable for developers to work on. Each task should be independent and deployable.
- Ensure each task has a title and a comprehensive description that guides the developer (why, what, how, technical details, references to relevant systems/APIs).
- If some tasks already exist, only generate the additional tasks that are missing so the set of tasks is complete without duplication.
- Do NOT create any tasks for analyzing, investigating, testing, or deployment.`;

    const prompt = params.prompt || defaultPrompt;

    return `${prompt}\n
**Context**
- Here is the work item:
  - Title: ${workItem.title}
  - Description: ${workItem.description}
  - Acceptance Criteria: ${workItem.acceptanceCriteria}

- Here are the tasks that have already been created for this work item (if any):
  ${existingTasks.length > 0 ? existingTasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n') : 'None'}

- Here are the images referenced (if any were included):
  ${imagesSection}
      
- Here is additional context that you should consider (if any were provided):
  ${knowledgeSection}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "tasks": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object.`;
  }

  /**
   * Builds multi-modal content array combining text prompt with processed images
   * @param workItem The work item containing potential image attachments
   * @param textPrompt The text prompt to include in the content
   * @returns Array of content items including text and processed images for model input
   */
  private async buildModelContent(workItem: WorkItem, textPrompt: string): Promise<any[]> {
    const content: any[] = [
      {
        type: 'text',
        text: textPrompt,
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
   * Parses the Bedrock model response and extracts generated tasks
   * @param response The raw response from the Bedrock Converse API
   * @returns Array of parsed tasks with titles and descriptions
   */
  private parseTasks(response: any): Task[] {
    // Log the full response structure for debugging
    this.logger.debug('Full Bedrock response structure for task parsing', {
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
    if (!parsedResponse || !parsedResponse.tasks) {
      this.logger.error('Failed to parse tasks from model response', {
        rawContent: content,
        parsedResponse,
      });
      throw new Error('🛑 Invalid JSON response from model');
    }

    this.logger.info('Received Bedrock model response', {
      tasks: parsedResponse.tasks,
      tasksCount: parsedResponse.tasks.length,
    });

    return parsedResponse.tasks;
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
   * Resolves the prompt to use for task generation with priority-based selection
   * Priority: 1) Parameter override, 2) Database config, 3) Default (undefined)
   * @param workItem The work item used for database prompt lookup
   * @param parameterPrompt Optional prompt override passed as parameter
   * @returns The resolved prompt string or undefined to use default
   */
  private async resolvePrompt(workItem: WorkItem, parameterPrompt?: string): Promise<string | undefined> {
    // If a prompt was passed as a parameter, use it (highest priority)
    if (parameterPrompt) {
      this.logger.info('⭐ Using prompt override for task generation', {
        prompt: parameterPrompt,
        source: 'parameter',
      });
      return parameterPrompt;
    }

    const databasePrompt = await this.getCustomPrompt(workItem);
    if (databasePrompt) {
      this.logger.info('⭐ Using prompt override for task generation', {
        prompt: databasePrompt,
        source: 'database',
      });
      return databasePrompt;
    }

    // No override found, will use default prompt in buildTaskGenerationPrompt
    this.logger.debug('No prompt override found, using default prompt');
    return undefined;
  }

  /**
   * Retrieves a custom prompt from the DynamoDB config table based on work item context
   * @param workItem The work item containing area path, business unit, and system information
   * @returns Custom prompt string if found, undefined otherwise
   */
  private async getCustomPrompt(workItem: WorkItem): Promise<string | undefined> {
    if (!this.config.configTableName) {
      this.logger.warn('Config table name not configured, skipping custom prompt lookup.');
      return undefined;
    }

    // Construct the adoKey from workItem properties
    const adoKey = `${workItem.areaPath}#${workItem.businessUnit || ''}#${workItem.system || ''}`;

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
}
