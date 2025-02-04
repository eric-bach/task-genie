import { Context } from 'aws-lambda';
import * as bedrock from '@aws-sdk/client-bedrock-runtime';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

type Task = { title: string; description: string };

const ORGANIZATION = 'amaabca';
const PROJECT = 'eric-test';

export const handler = async (event: any, context: Context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const body = JSON.parse(event.body || '{}');

  const workItemId = body.workItemId;
  console.log('WorkItemId: ', workItemId);
  const description = body.description;
  console.log('Description: ', description);
  const acceptanceCriteria = body.acceptanceCriteria;
  console.log('Acceptance Criteria: ', acceptanceCriteria);

  const bedrockClient = new bedrock.BedrockRuntimeClient({ region: process.env.AWS_REGION });

  const userMessage = `You are a technical project manager for Azure DevOps Work Items, who breaks down work items that into tasks where there may be multiple individuals involved or the time expected to complete is longer than 2 hours.
    You will return a result in a JSON format with one attribute key being tasks. This is a list. If no tasks are needed this will be empty.
    Each would be an object in the list with a key of title and a key of description. Split by logical divisions and provide as much guidance as possible. Make sure the ticket description is high quality.
    The parent task description to review is: ${description} along with the acceptance criteria: ${acceptanceCriteria}.
    Only generate tasks where it is completely neccessary. These are tasks completed by software development engineers, frontend developers and/or DevOps Engineers. Do not include tasks to do testing (including unit and integration) or deployment as this is part of the SDLC.
    Investigation and analysis should not have separate tasks.
    Not tasks for analyzing, no tasks for regression testing.
    Each task must be able to be deployed separately (increasing deployment frequency). Do not make any assumptions, only use the existing knowledge you have.
    Only return JSON, no text. JSON should be a single line`;

  const conversation = [
    {
      role: bedrock.ConversationRole.USER,
      content: [{ text: userMessage }],
    },
  ];

  const input: bedrock.ConverseCommandInput = {
    modelId: process.env.AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5, topP: 0.9 },
  };

  const command = new bedrock.ConverseCommand(input);
  const response = await bedrockClient.send(command);

  console.log('Response:', JSON.stringify(response, null, 2));

  // Get tasks
  const text: string = response.output?.message?.content
    ? response.output?.message?.content[0].text || '{tasks:[{}]}'
    : '{tasks:[{}]}';
  const tasks: Task[] = JSON.parse(text).tasks;

  console.log('Identified Tasks:', tasks);

  await createTasks(workItemId, tasks);

  console.log('Tasks created');

  return {
    statusCode: 200,
    body: JSON.stringify({
      // TODO Return proper work item and tasks
      input: { workItemId: event.workItemId, tasks },
    }),
  };
};

const getParameter = async (name: string): Promise<string> => {
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

  const command = new GetParameterCommand({ Name: name, WithDecryption: true });
  const response = await ssmClient.send(command);
  return response.Parameter?.Value || '';
};

const getHeaders = async (): Promise<HeadersInit> => {
  const base64EncodedPAT = await getParameter(process.env.AZURE_DEVOPS_PAT_PARAMETER_NAME || '');
  console.log('Received PAT');

  return {
    'Content-Type': 'application/json-patch+json',
    Authorization: `Basic ${base64EncodedPAT}`,
  };
};

const createTasks = async (workItemId: string, tasks: Task[]) => {
  console.log('Creating tasks in ADO...');

  const headers = await getHeaders();

  for (const task of tasks) {
    console.log('Creating task', task);

    const taskResponse = await createTask(headers, workItemId, task);
  }
};

const createTask = async (header: HeadersInit, workItemId: string, task: Task) => {
  const taskFields = [
    {
      op: 'add',
      path: '/fields/System.Title',
      value: task.title,
    },
    {
      op: 'add',
      path: '/fields/System.Description',
      value: task.description,
    },
    {
      op: 'add',
      path: '/fields/System.WorkItemType',
      value: 'Task',
    },
  ];

  const body = JSON.stringify(taskFields);

  try {
    const url = `https://${ORGANIZATION}.visualstudio.com/${PROJECT}/_apis/wit/workitems/$task?api-version=7.1`;

    console.debug('Creating task in ADO', url, body);

    const response = await fetch(url, {
      method: 'POST',
      headers: header,
      body: body,
    });

    console.debug('Creating ADO task response', response);

    if (response.ok) {
      const data = await response.json();
      console.log('Task Id', data.id);

      await linkTask(header, workItemId, data.id);
    } else {
      throw new Error('Failed to create task');
    }
  } catch (error) {
    console.log(error);
  }
};

const linkTask = async (headers: HeadersInit, workItemId: string, taskId: string) => {
  try {
    const url = `https://${ORGANIZATION}.visualstudio.com/${PROJECT}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

    const body = `[
      {
        "op": "add",
        "path": "/relations/-",
        "value": {
          "rel": "System.LinkTypes.Hierarchy-Forward",
          "url": "https://amaabca.visualstudio.com/eric-test/_apis/wit/workItems/${taskId}",
          "attributes": {
            "comment": "Linking dependency"
          }
        }
      }
    ]`;

    console.debug('Linking task in ADO', url, body);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: headers,
      body: body,
    });

    console.debug('Linking ADO task response', response);

    if (response.ok) {
      const data = await response.json();
      console.log('Linked Task', data);

      return response;
    }

    throw new Error('Failed to link task');
  } catch (error) {
    console.log(error);
  }
};
