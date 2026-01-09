import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    props: { params: Promise<{ id: string }> }
) {
    try {
        const params = await props.params;
        const executionId = params.id;
        console.log(`Executions poll API route called for ID: ${executionId}`);

        if (!executionId) {
            return NextResponse.json(
                { error: 'Missing execution ID' },
                { status: 400 }
            );
        }

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
        const baseUrl = API_GATEWAY_URL.startsWith('http')
            ? API_GATEWAY_URL
            : `https://${API_GATEWAY_URL}`;

        // Backend expects colons in execution ID, but they might be encoded in URL
        const encodedExecutionId = encodeURIComponent(executionId);

        // Note: The execution ID format from step functions often includes colons.
        // We should usually pass it as is if the backend expects it, or encoded.
        // The previous frontend code encoded it: const encodedExecutionId = encodeURIComponent(executionId);
        const backendUrl = `${baseUrl}/executions/${encodedExecutionId}`;

        console.log('Making request to backend URL:', backendUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log('Request timed out after 30 seconds');
            controller.abort();
        }, 30000); // 30 second timeout

        const response = await fetch(backendUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        console.log('Backend response status:', response.status);

        const data = await response.json();

        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error('Error polling execution:', error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
