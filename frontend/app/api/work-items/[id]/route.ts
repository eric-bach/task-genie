import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    props: { params: Promise<{ id: string }> }
) {
    try {
        const params = await props.params;
        const id = params.id;
        console.log(`Work items API route called for ID: ${id}`);

        if (!id) {
            return NextResponse.json(
                { error: 'Missing work item ID' },
                { status: 400 }
            );
        }

        const TEAM_PROJECT = process.env.NEXT_PUBLIC_ADO_DEFAULT_PROJECT;
        const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
        const API_KEY = process.env.NEXT_PUBLIC_API_GATEWAY_API_KEY;

        if (!TEAM_PROJECT) {
            throw new Error('ADO_DEFAULT_PROJECT environment variable is not set');
        }
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


        // Append teamProject to backend URL if present
        const backendUrl = `${baseUrl}/work-items/${id}?teamProject=${encodeURIComponent(TEAM_PROJECT)}`

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
                'x-api-key': API_KEY,
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        console.log('Backend response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend error response:', errorText);

            if (response.status === 404) {
                return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
            }

            return NextResponse.json(
                { error: `Backend error: ${response.status}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error getting work item:', error);

        return NextResponse.json(
            {
                error: 'Failed to get work item',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
