import {
  BedrockAgentClient,
  CreateDataSourceCommand,
  CreateDataSourceCommandInput,
  GetDataSourceCommand,
  GetDataSourceCommandInput,
} from '@aws-sdk/client-bedrock-agent';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const AWS_BEDROCK_KNOWLEDGE_BASE_ID = process.env.AWS_BEDROCK_KNOWLEDGE_BASE_ID;

if (!AWS_BEDROCK_KNOWLEDGE_BASE_ID) {
  throw new Error('AWS_BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
}

const bedrockAgentClient = new BedrockAgentClient({
  endpoint: `https://bedrock-agent.${AWS_REGION}.amazonaws.com`,
  region: AWS_REGION,
});

interface UserStory {
  title: string;
  description: string;
  acceptanceCriteria: string;
  tasks?: {
    title: string;
    description: string;
  }[];
}

async function ingestUserStories(userStories: UserStory[]) {
  try {
    // Convert user stories to text format for ingestion
    const documents = userStories.map((story, index) => {
      const tasksText = story.tasks
        ? story.tasks
            .map((task, taskIndex) => `Task ${taskIndex + 1}:\nTitle: ${task.title}\nDescription: ${task.description}`)
            .join('\n\n')
        : '';

      return {
        text: `User Story ${index + 1}:\nTitle: ${story.title}\nDescription: ${
          story.description
        }\nAcceptance Criteria: ${story.acceptanceCriteria}\n\n${tasksText}`,
        metadata: {
          type: 'user_story',
          has_tasks: story.tasks ? 'true' : 'false',
          task_count: story.tasks ? story.tasks.length.toString() : '0',
        },
      };
    });

    // Create a data source for the documents
    const createDataSourceInput: CreateDataSourceCommandInput = {
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      name: `user-stories-${Date.now()}`,
      description: 'User stories and their tasks',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: `arn:aws:s3:::${process.env.AWS_BUCKET_NAME}`,
          inclusionPrefixes: ['user-stories/'],
        },
      },
    };

    const createDataSourceCommand = new CreateDataSourceCommand(createDataSourceInput);
    const dataSource = await bedrockAgentClient.send(createDataSourceCommand);

    // Get the data source details
    const getDataSourceInput: GetDataSourceCommandInput = {
      knowledgeBaseId: AWS_BEDROCK_KNOWLEDGE_BASE_ID,
      dataSourceId: dataSource.dataSource?.dataSourceId,
    };

    const getDataSourceCommand = new GetDataSourceCommand(getDataSourceInput);
    const result = await bedrockAgentClient.send(getDataSourceCommand);

    console.log('Successfully retrieved data source:', result);
  } catch (error) {
    console.error('Error ingesting documents:', error);
    throw error;
  }
}

// Example usage
const exampleUserStories: UserStory[] = [
  {
    title: 'As a user, I want to receive email notifications for important updates',
    description:
      'Users need to stay informed about important updates to their account and system changes. Email notifications will help them stay up to date without having to constantly check the application.',
    acceptanceCriteria:
      'GIVEN a user has an email address on file\nWHEN an important update occurs\nTHEN the user receives an email notification\nAND the email contains relevant details about the update\nAND the user can click a link to view more information',
    tasks: [
      {
        title: '1. Set up email service integration',
        description:
          'Integrate with AWS SES or similar email service to handle email delivery. Configure email templates and verify domain ownership.',
      },
      {
        title: '2. Create notification preferences system',
        description:
          'Build a system for users to manage their notification preferences, including email frequency and types of notifications.',
      },
      {
        title: '3. Implement notification queue',
        description:
          'Create a queue system to handle notification delivery, ensuring reliable delivery and retry logic for failed attempts.',
      },
    ],
  },
  {
    title: 'As a developer, I want to see test coverage reports',
    description:
      'Developers need visibility into test coverage to ensure code quality and identify areas that need additional testing. This will help maintain high code quality standards.',
    acceptanceCriteria:
      'GIVEN a developer has access to the codebase\nWHEN tests are run\nTHEN a coverage report is generated\nAND the report shows percentage of code covered\nAND the report highlights uncovered lines\nAND the report can be viewed in the CI/CD pipeline',
    tasks: [
      {
        title: '1. Integrate test coverage tool',
        description:
          'Set up a test coverage tool (e.g., Jest, Istanbul) and configure it to generate coverage reports in the CI/CD pipeline.',
      },
      {
        title: '2. Create coverage report viewer',
        description: 'Build a web interface to display coverage reports, including filtering and search capabilities.',
      },
      {
        title: '3. Set up coverage thresholds',
        description:
          'Configure minimum coverage thresholds and implement blocking in the CI/CD pipeline for low coverage.',
      },
    ],
  },
];

// Run the ingestion
ingestUserStories(exampleUserStories)
  .then(() => console.log('Ingestion completed successfully'))
  .catch((error) => console.error('Ingestion failed:', error));
