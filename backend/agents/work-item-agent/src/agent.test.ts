
import { handler } from './agent';
import { USER_STORY_CREATED_EVENT } from '../events/events';

describe('Work Item Agent', () => {
  it('should invoke the agent and return a result', async () => {
    const event = JSON.parse(USER_STORY_CREATED_EVENT);
    const result = await handler(event);
    expect(result).toBeDefined();
  });
});
