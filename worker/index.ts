const HOLDED_BASE = 'https://api.holded.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Holded-Key',
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname + url.search;

    const apiKey = request.headers.get('X-Holded-Key');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing X-Holded-Key header' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(`${HOLDED_BASE}${path}`, {
      method: 'GET',
      headers: { key: apiKey },
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};
