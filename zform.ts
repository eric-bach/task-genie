export async function callWebhookAPI(userId: string, title: string, description: string, acceptanceCriteria: string) {
  const apiUrl = `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/test`;
  const apiKey = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY || '';

  try {
    const body = {
      // TODO: Add prompt here
      // prompt: {
      //   evaluateUserStoryPrompt: // Prompt to evaluate user story
      //   defineTaskPrompt:         // Prompt to define tasks
      // inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
      // },
      resource: {
        // TODO: How to tell the backend to just generate tasks and not to create them in ADO
        workItemId: 0,
        revision: {
          fields: {
            'System.ChangedBy': userId,
            'System.Title': title,
            'System.Description': description,
            'Microsoft.VSTS.Common.AcceptanceCriteria': acceptanceCriteria,
          },
        },
      },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    // TODO Handle response
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error calling webhook:', error);
  }
}
