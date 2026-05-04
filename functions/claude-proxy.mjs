// Netlify Function (v2 ESM) — Anthropic Claude API proxy with optional SSE streaming.
// Streaming bypasses the Lambda response timeout: tokens flow through as they arrive,
// so the function never sits idle waiting for Anthropic to finish.
// Set { stream: true } in the request body to enable; otherwise behaves like a JSON proxy.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://mizanmind.netlify.app';

const baseHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
);

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: baseHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const netlifyUser = context.clientContext?.user;
  if (!netlifyUser?.email) {
    return json({ error: 'Kimlik doğrulama gerekli' }, 401);
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY not set.' }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  if (!body.messages || !Array.isArray(body.messages)) {
    return json({ error: 'messages required' }, 400);
  }

  const wantStream = !!body.stream;

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: Math.min(body.max_tokens || 2000, 2000),
        messages: body.messages,
        ...(wantStream ? { stream: true } : {}),
      }),
    });
  } catch (err) {
    return json({ error: 'Proxy: ' + err.message }, 500);
  }

  if (!upstream.ok) {
    let errMsg = 'API error';
    try {
      const errData = await upstream.json();
      errMsg = errData.error?.message || errMsg;
    } catch {}
    return json({ error: errMsg }, upstream.status);
  }

  if (wantStream) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
  });
};
