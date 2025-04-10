import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';

const USER_STORIES = [
  {
    title: 'A title',
    description: 'stuff',
    acceptanceCriteria: 'blah',
  },
  {
    title: 'Bad User Story',
    description: 'Test Test',
    acceptanceCriteria: 'blaha',
  },
  {
    title:
      'As a frequent traveler, I want to receive notifications about gate changes so that I can avoid missing my flight.',
    description:
      "Frequent travelers often face the challenge of keeping track of gate changes, which can occur unexpectedly and cause confusion and inconvenience. Missing a flight due to last-minute gate changes can be stressful and disruptive. By providing timely notifications about gate changes directly to travelers' mobile devices, we help ensure they are informed in real-time and can make their way to the new gate without delay.",
    acceptanceCriteria:
      'GIVEN a frequent traveler has a booked flight, WHEN a gate change occurs, THEN the traveler receives a notification with the updated gate information.',
  },
  {
    title: 'GP Lambdas are no longer triggered by the membership event bus',
    description:
      'Currently, Dev environments mock out GP events by sending events directly to their membership event bus. Since we want to remove that event bus, we\'ll need to finally clean that up. GP is probably just writing events to the staging m2 event bus. Get them to additionally write events to the account bus (if they are not already).\nWhy the staging account event bus? GP doesn\'t know about our internal dev env structure, so we need to work around that. \n\nOnce events are written to the staging account event bus, we\'ll need to update our dev lambdas to look for events on the shared bus.  At this point, all dev environments will be getting triggered by the same event. So to avoid any logging issues, we should gracefully stop our dev environments when they see GP events for customer ids outside their database. \n\nLambdas (checklist dev can you confirm):\nPost Payment State machine\nCancel Lambda\nRenewal Lambda\nNote:  We don\'t want the regular flow to be triggered by mocks anymore after this change. However, for a while we\'ll need to mock out the new events for the rebuild flow. The solution for that shouldn\'t interfer with our BFM goal of removing the membership and foundation event bus. Maybe we send the mocked event to the post payment state machine directly?\n\nUpdate\nStephen talked to GP, and they are aleady sending CEB style events to the CEB. Below is a sample. \n\n​Use this to query for the latest invoicePaid events via CEB:\nhttps://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:log-groups/log-group/$252Faws$252Fevents$252Faccount-eventbus-all-events-staging/log-events$3FfilterPattern$3DinvoicePaid$26start$3D-3600000\n\n{ "Detail": { "metadata": { "businessAction": "invoicePaid", "correlationId": "30122558-eb34-4101-82b8-d4c831418bdc", "dataContentType": "application/json", "domain": "payment", "id": "52e5eea3-bf43-456c-b4d1-4138fe88374f", "sensitiveData": [ "giftCardPin", "extendedAccountNumber", "iin", "emv_auth_data" ], "source": "gp", "subject": "invoicePaid", "time": "2025-02-25T03:05:59.777Z", "version": "v1" }, "payload": { "correlationInfo": { "customerId": "Lela-Schultz-1wgr2WRqPLceerJcqJD59N" }, "eventData": { "attemptCount": 1, "card": { "brand": "visa", "expMonth": 11, "expYear": 2027, "holderName": "Lela Schultz", "last4": 4242 }, "customerId": "Lela-Schultz-1wgr2WRqPLceerJcqJD59N", "detailType": "invoicePaid", "ESBTransactionGUID": "30122558-eb34-4101-82b8-d4c831418bdc", "idempotencyKey": "714e5e84-eb59-4e5e-bf0d-fe0dec875ab9", "invoiceItems": [ { "amount": 600, "priceCode": "price_CommunityMonthlyFee", "priceName": "Monthly Fee", "productCode": "product_CommunitySubscription", "productName": "AMA Community Membership", "tax": 30 } ], "invoiceNumber": "94000290-0001", "nextPaymentDate": "2025-03-25T03:09:24.000Z", "periodEnd": "2025-03-25T03:09:24.000Z", "periodStart": "2025-02-25T03:09:24.000Z", "receiptNumber": null, "sourceInfo": "", "status": "paid", "subtotal": 600, "tax": 30, "total": 630, "transactionTimestamp": "2025-02-25T03:09:24.000Z" } } }, "DetailType": "invoicePaid", "EventBusName": "mark-eventbus-eventBridgeCeb-v2", "Source": "mark-gp" }',
    acceptanceCriteria:
      "- The GP triggered lambdas in the dev environment listen to the staging account bus for GP events\n    - The regular no rebuild flow should no longer trigger mock events\n- In a dev environment, don't log an error messages (or Rollbar) when we see a GP events with customers not in our the environment.",
  },
];
const AWS_BEDROCK_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';
const AWS_PROFILE = 'observability2';

async function evaluateTasks(title: string, description: string, acceptanceCriteria: string) {
  const PROMPT = `You are a reviewer of Azure DevOps work items, designed to highlight when a work item is not clear enough for a developer to work on.
  You will only return a result in JSON format where one attribute key is "pass" being either true or false, where false indicates it does not meet the quality bar.
  A second optional JSON attribute key will be called "comment", that is returned in a single line, and where you are providing guidance and provide an example of how the work item would meet the pass requirements.
  A work item is a short, simple description of a customer requirement told from the perspective of the user or customer. It focuses on what the user needs and why.
  Focus on whether a developer would understand without being pedantic.
  The task title to review is: ${title} along with the description: ${description} and the acceptance criteria: ${acceptanceCriteria}.`;
  // const PROMPT = `You are a reviewer of Azure DevOps Work Items, designed to highlight when a work item is not clear enough for a developer to work on.
  //   You will return a result in a JSON format where one attribute key is pass being either true or false. It is false if it does not meet the quality bar.
  //   A second optional JSON attribute key will be called comment, that is returned in a single line and where you are providing guidance and provide an example of how the work item would meet the pass requirements.
  //   Focus on whether a developer would understand without being pedantic.
  //   Ensure there is a clear title, user story and acceptance criteria.
  //   The task title to review is: ${title} along with the description: ${description} and the acceptance criteria: ${acceptanceCriteria}.
  //   Only return JSON, no text. JSON should be a single line.`;

  const conversation = [
    {
      role: ConversationRole.USER,
      content: [{ text: PROMPT }],
    },
  ];

  const input: ConverseCommandInput = {
    modelId: AWS_BEDROCK_MODEL_ID,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  };

  try {
    const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2', profile: AWS_PROFILE });

    const command = new ConverseCommand(input);
    const response = await bedrockClient.send(command);

    const content = response.output?.message?.content;

    if (!content || !content[0].text) {
      console.error('No content found in response', { response: response });
      throw new Error('No content found in response');
    }

    const jsonResponse = JSON.parse(content[0].text);
    if (jsonResponse.pass === true) {
      console.log(`✔  Work item meets requirements`);
    } else {
      console.log(`❌ Work item does not meet requirements\n${jsonResponse.comment}`);
    }
  } catch (error) {
    console.error(`💣 An error has occurred: ${error}`);
  }
}

async function main() {
  let i = 0;

  for (const { title, description, acceptanceCriteria } of USER_STORIES) {
    console.log(`🚀 Evaluating user story ${++i}:\n`);

    await evaluateTasks(title, description, acceptanceCriteria);

    console.log('\n');
  }
}

main();
