import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
  try {
    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (!API_GATEWAY_URL) {
      throw new Error('API_GATEWAY_URL environment variable is not set');
    }

    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;
    const backendUrl = new URL(`${baseUrl}/config`);

    const body = await request.json();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(backendUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text || 'Upsert failed' }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out'
        : error instanceof Error
        ? error.message
        : 'Unknown error';
    return NextResponse.json({ error: 'Failed to upsert config', details: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (!API_GATEWAY_URL) throw new Error('API_GATEWAY_URL environment variable is not set');

    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;
    const { searchParams } = new URL(request.url);
    const pageSize = searchParams.get('pageSize') || '50';
    const nextToken = searchParams.get('nextToken') || '';

    const backendUrl = new URL(`${baseUrl}/config`);
    backendUrl.searchParams.set('pageSize', pageSize);
    if (nextToken) backendUrl.searchParams.set('nextToken', nextToken);

    const resp = await fetch(backendUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text || 'List failed' }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to list config', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const adoKey = searchParams.get('adoKey');
    if (!adoKey) return NextResponse.json({ error: 'Missing adoKey' }, { status: 400 });

    const API_GATEWAY_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (!API_GATEWAY_URL) throw new Error('API_GATEWAY_URL environment variable is not set');

    const baseUrl = API_GATEWAY_URL.startsWith('http') ? API_GATEWAY_URL : `https://${API_GATEWAY_URL}`;
    const backendUrl = new URL(`${baseUrl}/config`);
    backendUrl.searchParams.set('adoKey', adoKey);

    const resp = await fetch(backendUrl, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text || 'Delete failed' }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to delete config', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
