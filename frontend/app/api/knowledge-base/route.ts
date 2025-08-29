import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    console.log('Knowledge base documents API route called');

    // Parse query parameters from the request
    const { searchParams } = new URL(request.url);
    const pageSize = searchParams.get('pageSize') || '10';
    const pageNumber = searchParams.get('pageNumber') || '1';
    const nextToken = searchParams.get('nextToken') || '';

    console.log(
      `Pagination parameters: pageSize=${pageSize}, pageNumber=${pageNumber}, nextToken=${nextToken || 'none'}`
    );

    // Get the API Gateway URL from environment variable
    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    console.log('API Gateway URL:', API_GATEWAY_URL);

    if (!API_GATEWAY_URL) {
      throw new Error('API_GATEWAY_URL environment variable is not set');
    }

    // Ensure the URL has the correct protocol
    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;

    // Build backend URL with pagination parameters
    const backendUrl = new URL(`${baseUrl}/knowledge-base/documents`);
    backendUrl.searchParams.set('pageSize', pageSize);
    backendUrl.searchParams.set('pageNumber', pageNumber);
    if (nextToken) {
      backendUrl.searchParams.set('nextToken', nextToken);
    }

    console.log('Making request to backend URL:', backendUrl.toString());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('Request timed out after 30 seconds');
      controller.abort();
    }, 30000); // 30 second timeout

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend error response:', errorText);

      let errorMessage = `HTTP error! status: ${response.status}`;
      let errorType = 'HTTPError';

      if (response.status === 503) {
        errorMessage = 'Backend service is temporarily unavailable. Please try again in a moment.';
        errorType = 'ServiceUnavailable';
      } else if (response.status === 502) {
        errorMessage = 'Backend service is not responding. Please try again later.';
        errorType = 'BadGateway';
      } else if (response.status === 500) {
        errorMessage = 'Backend encountered an internal error. Please try again.';
        errorType = 'InternalServerError';
      } else if (errorText) {
        errorMessage += ` - ${errorText}`;
      }

      return NextResponse.json(
        { error: errorMessage, details: errorText, type: errorType },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Knowledge base documents response:', {
      count: data.count,
      documentsFound: data.documents?.length || 0,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error getting knowledge base documents:', error);
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown');

    let errorMessage = 'Failed to get knowledge base documents';
    let errorType = 'Unknown error';

    if (error instanceof Error) {
      errorMessage = error.message;
      errorType = error.constructor.name;

      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out after 30 seconds';
        errorType = 'TimeoutError';
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error - unable to reach backend service.';
        errorType = 'NetworkError';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Backend service is not available. Please try again in a moment.';
        errorType = 'ConnectionError';
      }
    }

    return NextResponse.json(
      {
        error: 'Failed to get knowledge base documents',
        details: errorMessage,
        type: errorType,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
    }

    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (!API_GATEWAY_URL) {
      throw new Error('API_GATEWAY_URL environment variable is not set');
    }

    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;
    const backendUrl = new URL(`${baseUrl}/knowledge-base/documents`);
    backendUrl.searchParams.set('key', key);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(backendUrl, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text || 'Deletion failed' }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out after 30 seconds'
        : error instanceof Error
        ? error.message
        : 'Unknown error';
    return NextResponse.json({ error: 'Failed to delete document', details: message }, { status: 500 });
  }
}
