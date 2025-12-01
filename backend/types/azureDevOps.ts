import { BedrockInferenceParams } from './bedrock';

export interface WorkItemRequest {
  workItem: WorkItem;
  params: BedrockInferenceParams;
}

export interface WorkItemImage {
  url: string;
  alt?: string;
}

// Base work item interface with common fields
export interface BaseWorkItem {
  workItemId: number;
  teamProject: string;
  state?: string;
  areaPath: string;
  iterationPath: string;
  businessUnit?: string;
  system?: string;
  changedBy: string;
  title: string;
  description: string;
  tags: string[];
  images?: WorkItemImage[];
}

// User Story specific interface
export interface UserStory extends BaseWorkItem {
  workItemType: 'User Story';
  acceptanceCriteria?: string; // Microsoft.VSTS.Common.AcceptanceCriteria
  importance?: string; // Custom.Importance
}

// Epic specific interface
export interface Epic extends BaseWorkItem {
  workItemType: 'Epic';
  successCriteria?: string; // Custom.SuccessCriteria
  objective?: string; // Custom.Objective
  addressedRisks?: string; // Custom.AddressedRisks
  pursueRisk?: string; // Custom.PursueRisk
  mostRecentUpdate?: string; // Custom.MostRecentUpdate
  outstandingActionItems?: string; // Custom.OutstandingActionItems
}

// Feature specific interface
export interface Feature extends BaseWorkItem {
  workItemType: 'Feature';
  successCriteria?: string; // Custom.SuccessCriteria
  businessDeliverable?: string; // Custom.BusinessDeliverable
}

// Task specific interface
export interface Task extends BaseWorkItem {
  workItemType: 'Task';
}

// Union type for any work item
export type WorkItem = UserStory | Epic | Feature | Task;

// Type guard functions for type narrowing
export function isUserStory(workItem: WorkItem): workItem is UserStory {
  return workItem.workItemType === 'User Story';
}

export function isEpic(workItem: WorkItem): workItem is Epic {
  return workItem.workItemType === 'Epic';
}

export function isFeature(workItem: WorkItem): workItem is Feature {
  return workItem.workItemType === 'Feature';
}

export function isTask(workItem: WorkItem): workItem is Task {
  return workItem.workItemType === 'Task';
}

/**
 * Determines the expected child work item type based on the parent work item type
 * @param parentType The parent work item type
 * @param plural Whether to return plural form
 * @returns The expected child work item type, or null if no specific type is expected
 */
export function getExpectedChildWorkItemType(parentType: string, plural: boolean = false): string | null {
  switch (parentType) {
    case 'Epic':
      return plural ? 'Features' : 'Feature';
    case 'Feature':
      return plural ? 'User Stories' : 'User Story';
    case 'User Story':
      return plural ? 'Tasks' : 'Task';
    default:
      return null; // Unknown parent type
  }
}

// Type for DynamoDB stored work item context (extends WorkItem with optional fields)
export interface StoredWorkItemContext {
  workItemId: number;
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  areaPath?: string;
  iterationPath?: string;
  businessUnit?: string;
  system?: string;
  teamProject?: string;
  changedBy?: string;
  tags?: string[];
  taskIds?: number[];
  [key: string]: unknown;
}

/**
 * Azure DevOps webhook event structure for work item updates
 * Many fields are optional as they depend on the event type and configuration
 */
export interface AzureDevOpsEvent {
  subscriptionId: string;
  notificationId: number;
  id: string;
  eventType: 'workitem.created' | 'workitem.updated' | 'workitem.deleted' | string;
  publisherId: string;
  message?: Message;
  detailedMessage?: Message;
  resource?: Resource;
  resourceVersion?: string;
  resourceContainers?: ResourceContainers;
  createdDate: string;
}

export interface Message {
  text?: string;
  html?: string;
  markdown?: string;
}

export interface Resource {
  id?: number;
  workItemId?: number;
  rev?: number;
  revisedBy?: User;
  revisedDate?: string;
  fields?: { [fieldName: string]: FieldChange | string };
  relations?: WorkItemRelation[] | WorkItemRelations;
  _links?: ResourceLinks;
  url?: string;
  revision?: WorkItemRevision;
}

export type Fields = {
  [fieldName: string]: string | FieldChange;
};

export interface User {
  id?: string;
  name?: string;
  displayName?: string;
  url?: string;
  _links?: {
    avatar?: {
      href?: string;
    };
  };
  uniqueName?: string;
  imageUrl?: string;
  descriptor?: string;
}

export interface FieldChange {
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
}

export interface ResourceLinks {
  self?: {
    href?: string;
  };
  workItemUpdates?: {
    href?: string;
  };
  parent?: {
    href?: string;
  };
  html?: {
    href?: string;
  };
}

export interface WorkItemRevision {
  id?: number;
  rev?: number;
  fields?: Fields;
  multilineFieldsFormat?: Fields;
  relations?: WorkItemRelation[] | WorkItemRelations;
  _links?: ResourceLinks;
  url?: string;
}

export interface WorkItemRelation {
  rel?: string;
  url?: string;
  attributes?: {
    isLocked?: boolean;
    comment?: string;
    name?: string;
  };
}

export interface WorkItemRelations {
  [key: string]: WorkItemRelation[] | undefined;
}

export interface ResourceContainers {
  collection?: {
    id?: string;
    baseUrl?: string;
  };
  account?: {
    id?: string;
    baseUrl?: string;
  };
  project?: {
    id?: string;
    baseUrl?: string;
  };
}
