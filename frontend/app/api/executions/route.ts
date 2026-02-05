import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    console.log('Executions API route called');

    const body = await request.json();

    // Get the API Gateway URL and Key from environment variables
    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    const API_KEY = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY;

    if (!API_GATEWAY_URL) {
      throw new Error('API_GATEWAY_URL environment variable is not set');
    }

    if (!API_KEY) {
      throw new Error('API_GATEWAY_API_KEY environment variable is not set');
    }

    // Ensure the URL has the correct protocol
    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;

    const backendUrl = `${baseUrl}/executions`;

    console.log('Making request to backend URL:', backendUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('Request timed out after 30 seconds');
      controller.abort();
    }, 30000); // 30 second timeout

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Backend response status:', response.status);

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error creating execution:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
