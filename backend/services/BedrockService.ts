import { Logger } from '@aws-lambda-powertools/logger';
import {
  RetrieveCommand,
  RetrieveCommandInput,
  BedrockAgentRuntimeClient,
  RetrievalFilter,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { InvokeModelCommand, InvokeModelCommandInput, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

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
}

export class BedrockService {
  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly logger: any;
  private readonly config: Required<BedrockServiceConfig>;
  private readonly personalAccessToken: string | null;

  constructor(config: BedrockServiceConfig, personalAccessToken: string | null) {
    this.config = {
      maxKnowledgeDocuments: 3,
      maxImageSize: 5,
      maxImages: 3,
      ...config,
    };

    this.personalAccessToken = personalAccessToken;
    this.logger = new Logger({ serviceName: 'BedrockService' });
    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region: config.region });
    this.bedrockRuntimeClient = new BedrockRuntimeClient({ region: config.region });
  }

  /**
   * Main method to evaluate a work item and generate tasks
   */
  async evaluateWorkItem(workItem: WorkItem): Promise<BedrockWorkItemEvaluationResponse> {
    try {
      this.logger.info('Starting work item evaluation', { workItemId: workItem.workItemId });

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
   * Main method to generate tasks
   */
  async generateTasks(workItem: WorkItem, params: BedrockInferenceParams = {}): Promise<BedrockTaskGenerationResponse> {
    try {
      this.logger.info('Starting task generation', { workItemId: workItem.workItemId });

      // Step 1: Retrieve relevant knowledge base context
      const query = this.buildTaskBreakdownKnowledgeQuery(workItem);
      const filters = this.buildTaskBreakdownFilters(workItem);
      const knowledgeContext = await this.retrieveKnowledgeContext(query, filters);

      // Step 2: Generate tasks using the model
      const tasks = await this.invokeModelForTaskGeneration(workItem, params, knowledgeContext);

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
   * Retrieve relevant documents from the knowledge base
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

      this.logger.info(`Retrieved ${results.length} knowledge documents`);

      return this.processKnowledgeResults(results);
    } catch (error) {
      this.logger.warn('Failed to retrieve knowledge context', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Process knowledge base results into structured documents
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
   * Build the knowledge base query for user story evaluation
   */
  private buildWorkItemEvaluationKnowledgeQuery(workItem: WorkItem): string {
    return `Find any information about the user story process and guidelines that would help evaluate the following user story:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
  }

  /**
   * Build the knowledge base query for task breakdown
   */
  private buildTaskBreakdownKnowledgeQuery(workItem: WorkItem): string {
    return `Find relevant information to help with task breakdown and implementation guidance for the following use story:
    - Title: ${workItem.title}
    - Description: ${workItem.description}
    - Acceptance Criteria: ${workItem.acceptanceCriteria}`;
  }

  /**
   * Build knowledge base search filters for work item evaluation
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
   * Build knowledge base search filters for task breakdown
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
   * Invoke the Bedrock model with context to evaluate work items
   */
  private async invokeModelForWorkItemEvaluation(
    workItem: WorkItem,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<BedrockWorkItemEvaluationResponse> {
    const prompt = this.buildWorkItemEvaluationPrompt(workItem, knowledgeContext);
    const content = await this.buildModelContent(workItem, prompt);

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      temperature: 0.5,
      top_p: 0.9,
      messages: [{ role: 'user', content }],
    };

    const input: InvokeModelCommandInput = {
      modelId: this.config.modelId,
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    };

    this.logger.debug('Invoking Bedrock model', {
      modelId: this.config.modelId,
      contentCount: content.length - (workItem.images?.length || 0),
      contentLength: content.reduce((sum, item) => {
        return item.type === 'text' ? sum + (item.text?.length || 0) : sum;
      }, 0),
      knowledgeCount: knowledgeContext.length,
      knowledgeContentLength: knowledgeContext.reduce((sum, doc) => sum + doc.contentLength, 0),
      imagesCount: workItem.images?.length || 0,
      imagesSizeKB: Math.round(
        content.reduce((sum, item) => {
          if (item.type === 'image' && item.source?.data) {
            return sum + (item.source.data.length * 3) / 4 / 1024;
          }
          return sum;
        }, 0)
      ),
    });

    try {
      const command = new InvokeModelCommand(input);
      const response = await this.bedrockRuntimeClient.send(command);

      return this.parseWorkItemEvaluation(response);
    } catch (error) {
      this.logger.error('Model invocation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        modelId: this.config.modelId,
      });
      throw new Error(`Bedrock model invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Invoke the Bedrock model with context to generate tasks
   */
  private async invokeModelForTaskGeneration(
    workItem: WorkItem,
    params: BedrockInferenceParams,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): Promise<Task[]> {
    const prompt = this.buildTaskGenerationPrompt(workItem, params, knowledgeContext);
    const content = await this.buildModelContent(workItem, prompt);

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: params.maxTokens || 4096,
      temperature: params.temperature || 0.5,
      top_p: params.topP || 0.9,
      messages: [{ role: 'user', content }],
    };

    const input: InvokeModelCommandInput = {
      modelId: this.config.modelId,
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    };

    this.logger.debug('Invoking Bedrock model', {
      modelId: this.config.modelId,
      contentCount: content.length - (workItem.images?.length || 0),
      contentLength: content.reduce((sum, item) => {
        return item.type === 'text' ? sum + (item.text?.length || 0) : sum;
      }, 0),
      knowledgeCount: knowledgeContext.length,
      knowledgeContentLength: knowledgeContext.reduce((sum, doc) => sum + doc.contentLength, 0),
      imagesCount: workItem.images?.length || 0,
      imagesSizeKB: Math.round(
        content.reduce((sum, item) => {
          if (item.type === 'image' && item.source?.data) {
            return sum + (item.source.data.length * 3) / 4 / 1024;
          }
          return sum;
        }, 0)
      ),
    });

    try {
      const command = new InvokeModelCommand(input);
      const response = await this.bedrockRuntimeClient.send(command);

      return this.parseTasks(response);
    } catch (error) {
      this.logger.error('Model invocation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        modelId: this.config.modelId,
      });
      throw new Error(`Bedrock model invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the prompt for work item evaluation
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

    const prompt = `You are an AI assistant that reviews Azure DevOps work items. You evaluate work items to ensure they are reasonably clear, have enough detail to be understood, and are ready for a developer to work on with minimal clarification.

    Your task is to assess the quality of a user story based on the provided title, description, and acceptance criteria.

    Evaluate the user story based on the following criteria:
      - It states the user, need, and business value in some form.
      - The acceptance criteria is testable and provides some direction.
      - If images are provided, treat them as additional context.

    Return your assessment as a valid JSON object with the following structure:
      - "pass": boolean (true if the work item is good enough to proceed, false only it it is seriously incomplete or unclear)
      - if "pass" is false, include a "comment" field (string), explain what's missing or unclear, and provide
      a concrete example of a high-quality story that would pass. If you have multiple feedback points, use
      line breaks and indentations with HTML tags.
 
    Only output the JSON object, no additional text.

    The work item to review is: 
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}
      
    Additional business or domain context from knowledge base:
      ${knowledgeSection}

    Images referenced:
      ${imagesSection}
    `;

    return prompt;
  }

  /**
   * Build the prompt for task generation
   */
  private buildTaskGenerationPrompt(
    workItem: WorkItem,
    params: BedrockInferenceParams,
    knowledgeContext: BedrockKnowledgeDocument[]
  ): string {
    const imagesSection =
      workItem.images && workItem.images.length > 0
        ? `${workItem.images.map((img, i) => `${i + 1}. ${img.url}${img.alt ? ` (${img.alt})` : ''}`).join('\n')}`
        : '';
    const knowledgeSection =
      knowledgeContext.length > 0
        ? `${knowledgeContext.map((doc) => `- ${doc.content.substring(0, 500)}...`).join('\n')}`
        : '';

    const prompt =
      params.prompt ||
      `You are an expert Agile software development assistant for Azure DevOps that specializes in decomposing work items into actionable tasks.

      Your task is to break down the provided work item into a sequence of tasks that are clear and actionable for developers to work on. Each task should be independent and deployable separately.

      Ensure each task has a title and a comprehensive description that guides the developer (why, what, how, technical details, references to relevant systems/APIs). Do NOT create any tasks for analyzing, investigating, testing, or deployment.`;

    return `${prompt}
      Only return your assessment as a JSON object with the following structure:
      - "tasks": array of task objects, each with:
        - "title": string (task title, prefixed with order, e.g., "1. Task Title")
        - "description": string (detailed task description with HTML formatting)

      DO NOT output any text outside of the JSON object.

      Work Item Details:
      - Title: ${workItem.title}
      - Description: ${workItem.description}
      - Acceptance Criteria: ${workItem.acceptanceCriteria}

      Images referenced:
        ${imagesSection}
      
      Additional context from knowledge base:
        ${knowledgeSection}`;
  }

  /**
   * Build the content array for multi-modal input (text + images)
   */
  private async buildModelContent(workItem: WorkItem, textPrompt: string): Promise<any[]> {
    const content: any[] = [{ type: 'text', text: textPrompt }];

    if (!workItem.images || workItem.images.length === 0) {
      return content;
    }

    const imagesToProcess = workItem.images.slice(0, this.config.maxImages);

    for (const image of imagesToProcess) {
      try {
        const azureService = new AzureService(this.personalAccessToken);

        const imageData = await azureService.fetchImage(image.url);
        if (imageData && this.isImageSizeValid(imageData)) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageData,
            },
          });

          this.logger.debug('Added image to model input', {
            url: image.url,
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
   * Validate image size against configured limits
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
   * Parse the model response for work item evaluation
   */
  private parseWorkItemEvaluation(response: any): BedrockWorkItemEvaluationResponse {
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text;

    if (!content) {
      throw new Error('No text content found in model response');
    }

    const parsedResponse = this.safeJsonParse(content);

    if (!parsedResponse) {
      throw new Error('Invalid JSON response from model');
    }

    this.logger.info('Successfully parsed model response', {
      response: parsedResponse,
    });

    return parsedResponse;
  }

  /**
   * Parse the model response and extract tasks
   */
  private parseTasks(response: any): Task[] {
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text;

    if (!content) {
      throw new Error('No text content found in model response');
    }

    const parsedResponse = this.safeJsonParse(content);
    if (!parsedResponse || !parsedResponse.tasks) {
      throw new Error('Invalid JSON response from model');
    }

    this.logger.info('Successfully parsed model response', {
      tasks: parsedResponse.tasks,
      tasksCount: parsedResponse.tasks.length,
    });

    return parsedResponse.tasks;
  }

  /**
   * Safely parse JSON with error handling for malformed responses
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
}
