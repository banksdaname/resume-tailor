/**
 * Résumé Tailor — Cloudflare Worker proxy
 *
 * Forwards requests from the Résumé Tailor userscript to Anthropic's API,
 * attaching your API key server-side so it never appears in client-side
 * JavaScript (where anyone could read it via DevTools).
 *
 * Also logs call metadata (token usage, stop_reason, success/failure) to a
 * D1 database for diagnosing truncated/failed responses. Only metadata is
 * logged — never résumé content or job description text.
 *
 * SETUP:
 * 1. Paste this whole file into your Worker's "Edit code" view.
 * 2. Go to Settings -> Variables and Secrets -> add a secret named
 *    ANTHROPIC_API_KEY with your Anthropic API key as the value.
 * 3. Go to Settings -> Bindings -> Add binding -> D1 database. Set the
 *    variable name to DB and select your resume_tailor_logdb database.
 * 4. Deploy, then copy the Worker's URL into the Résumé Tailor panel's
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

    // call_type and template are logging-only context sent by the userscript
    // alongside the real request fields. Strip them before forwarding to
    // Anthropic, since the API doesn't expect them.
    const callType = body.call_type || 'unknown';
    const template = body.template || null;
    const anthropicBody = { ...body };
    delete anthropicBody.call_type;
    delete anthropicBody.template;

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      const text = await anthropicRes.text();

      // Log call metadata to D1. This never blocks or fails the actual
      // response to the userscript — if logging itself errors (binding not
      // set up yet, D1 quota, etc.) we swallow it so the proxy still works.
      try {
        await logRun(env, {
          callType,
          template,
          requestedModel: anthropicBody.model,
          maxTokensRequested: anthropicBody.max_tokens,
          responseText: text,
          httpStatus: anthropicRes.status,
        });
      } catch (logErr) {
        // Intentionally swallowed — see comment above.
      }

      return new Response(text, {
        status: anthropicRes.status,
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    } catch (err) {
      return jsonResponse({ error: 'Upstream request to Anthropic failed: ' + err.message }, 502);
    }
  },
};

async function logRun(env, info) {
  if (!env.DB) { return; } // D1 binding not configured — skip silently

  let stopReason = null, inputTokens = null, outputTokens = null, requestId = null;
  let parseOk = 0, errorMessage = null;

  if (info.httpStatus >= 200 && info.httpStatus < 300) {
    try {
      const parsed = JSON.parse(info.responseText);
      stopReason = parsed.stop_reason || null;
      inputTokens = (parsed.usage && parsed.usage.input_tokens) || null;
      outputTokens = (parsed.usage && parsed.usage.output_tokens) || null;
      requestId = parsed.id || null;
      parseOk = 1;
    } catch (e) {
      errorMessage = 'Worker could not parse Anthropic response: ' + e.message;
    }
  } else {
    errorMessage = 'HTTP ' + info.httpStatus + ': ' + info.responseText.slice(0, 500);
  }

  await env.DB.prepare(
    `INSERT INTO runs
      (created_at, call_type, model, template, stop_reason, input_tokens, output_tokens, max_tokens_requested, request_id, parse_ok, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    new Date().toISOString(),
    info.callType,
    info.requestedModel || null,
    info.template,
    stopReason,
    inputTokens,
    outputTokens,
    info.maxTokensRequested || null,
    requestId,
    parseOk,
    errorMessage
    // job_title and company columns intentionally left NULL for now —
    // population is commented out pending a future privacy decision.
    // To enable: add job_title/company params here and to the INSERT
    // column list and placeholders above, and have the userscript pass
    // them in the request body the same way call_type/template are sent.
  ).run();
}

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

