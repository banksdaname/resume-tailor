/**
 * Résumé Tailor — Cloudflare Worker proxy
 *
 * Forwards requests from the Résumé Tailor userscript to Anthropic's API,
 * attaching your API key server-side so it never appears in client-side
 * JavaScript (where anyone could read it via DevTools).
 *
 * SETUP:
 * 1. Paste this whole file into your Worker's "Edit code" view.
 * 2. Go to Settings -> Variables and Secrets -> add a secret named
 *    ANTHROPIC_API_KEY with your Anthropic API key as the value.
 * 3. Deploy, then copy the Worker's URL into the Résumé Tailor panel's
 *    Settings -> Proxy URL field.
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Only POST is supported' }, 405);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: 'ANTHROPIC_API_KEY is not configured on this Worker. Add it under Settings -> Variables and Secrets.' },
        500
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
    }

    // Basic shape check — the userscript always sends { model, max_tokens, system, messages }
    if (!body || !body.model || !Array.isArray(body.messages)) {
      return jsonResponse({ error: 'Request must include model and messages' }, 400);
    }

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const text = await anthropicRes.text();
      return new Response(text, {
        status: anthropicRes.status,
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    } catch (err) {
      return jsonResponse({ error: 'Upstream request to Anthropic failed: ' + err.message }, 502);
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}
