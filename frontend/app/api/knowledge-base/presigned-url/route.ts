import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('▶️ Presigned URL API route called');

    // Get the file name from query parameters
    const { searchParams } = new URL(request.url);
    const workItemType = searchParams.get('workItemType');
    const areaPath = searchParams.get('areaPath');
    const businessUnit = searchParams.get('businessUnit');
    const system = searchParams.get('system');
    const fileName = searchParams.get('fileName');
    const username = searchParams.get('username');

    if (!workItemType) {
      return NextResponse.json({ error: 'workItemType parameter is required' }, { status: 400 });
    }
    if (!areaPath) {
      return NextResponse.json({ error: 'areaPath parameter is required' }, { status: 400 });
    }
    if (!fileName) {
      return NextResponse.json({ error: 'fileName parameter is required' }, { status: 400 });
    }

    console.log('File details:', { fileName, workItemType, areaPath, businessUnit, system, username });

    // Get the API Gateway URL from environment variable
    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    console.log('API Gateway URL:', API_GATEWAY_URL);

    if (!API_GATEWAY_URL) {
      throw new Error('API_GATEWAY_URL environment variable is not set');
    }

    // Ensure the URL has the correct protocol
    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;

    // Build query parameters, only including those that are provided
    const backendParams = new URLSearchParams({
      workItemType: workItemType,
      areaPath: areaPath,
      fileName: fileName,
    });

    if (businessUnit) backendParams.append('businessUnit', businessUnit);
    if (system) backendParams.append('system', system);
    if (username) backendParams.append('username', username);

    const backendUrl = `${baseUrl}/knowledge-base/presigned-url?${backendParams.toString()}`;
    console.log('Making request to backend URL:', backendUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('Request timed out after 10 seconds');
      controller.abort();
    }, 10000); // 10 second timeout

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
    console.log('Presigned URL response:', {
      presignedurl: data.presignedurl ? '***URL***' : 'missing',
      key: data.key,
      bucket: data.bucket,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error getting presigned URL:', error);
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown');

    let errorMessage = 'Failed to get presigned URL';
    let errorType = 'Unknown error';

    if (error instanceof Error) {
      errorMessage = error.message;
      errorType = error.constructor.name;

      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out after 10 seconds';
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
        error: 'Failed to get presigned URL',
        details: errorMessage,
        type: errorType,
      },
      { status: 500 }
    );
  }
}
