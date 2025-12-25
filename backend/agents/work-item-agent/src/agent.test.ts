import { handler } from './agent';
// import { USER_STORY_CREATED_EVENT } from '../events/events';
const USER_STORY_CREATED_EVENT = JSON.stringify({
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  notificationId: 1,
  id: '4d6d6b8b-3e5f-4a3d-9d4f-3e5f4a3d9d4f',
  eventType: 'workitem.created',
  publisherId: 'tfs',
  message: {
    text: 'User Story 123 created',
  },
  detailedMessage: {
    text: 'User Story 123 created by John Doe',
  },
  resource: {
    id: 123,
    rev: 1,
    fields: {
      'System.Title': 'Test User Story',
      'System.WorkItemType': 'User Story',
    },
  },
});

describe('Work Item Agent', () => {
  it('should invoke the agent and return a result', async () => {
    const event = JSON.parse(USER_STORY_CREATED_EVENT);
    const result = await handler(event);
    expect(result).toBeDefined();
  });
});
