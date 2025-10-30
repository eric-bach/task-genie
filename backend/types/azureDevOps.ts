import { BedrockInferenceParams } from './bedrock';

export interface WorkItemRequest {
  workItem: WorkItem;
  params: BedrockInferenceParams;
}

export interface WorkItemImage {
  url: string;
  alt?: string;
}

export interface WorkItem {
  workItemId: number;
  teamProject: string;
  areaPath: string;
  iterationPath: string;
  businessUnit?: string;
  system?: string;
  changedBy: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  images?: WorkItemImage[]; // Array of images with URLs and alt text extracted from description and acceptance criteria
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

export interface Task {
  taskId?: number;
  title: string;
  description: string;
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
