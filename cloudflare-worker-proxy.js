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
 *
 * MODEL LIST: the userscript's model dropdown, cost estimates, and effort
 * options all come from MODEL_CONFIG below (served on GET). To add, remove,
 * or re-price a model, edit ONLY this block, bump `updated`, and redeploy —
 * no userscript update needed. See RELEASING.md / the /model-watch command.
 */

const WORKER_VERSION = '1.8.0';

/* ==================== MODEL CONFIG (single source of truth) ====================
 * models[]:
 *   id            Anthropic API model ID
 *   name          Short display name
 *   note          Shown after the name in the dropdown
 *   rates         USD per million tokens { input, output } — used for the cost estimate
 *   efforts       Effort levels the model accepts ([] = model doesn't support effort)
 *   defaultEffort What the API uses when effort is omitted (informational)
 * replaced: models no longer offered → what to use instead. Applied to saved
 *   settings in the userscript AND to incoming requests here, so an old
 *   userscript still sending a retired ID keeps working.
 * effortLevels: the levels shown in the panel, in order. `minMaxTokens` raises
 *   the output ceiling for deep levels (Anthropic recommends >= 64k at
 *   xhigh/max, since thinking and the answer share max_tokens).
 * ============================================================================= */
const MODEL_CONFIG = {
  updated: '2026-09-24',
  defaultModel: 'claude-opus-5-5',
  models: [
    { id: 'claude-sonnet-5',  name: 'Sonnet 5',   note: 'fast + budget (~10¢/run)',
      rates: { input: 2, output: 10 },  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
    { id: 'claude-opus-5-5',  name: 'Opus 5.5',   note: 'recommended (~20¢/run)',
      rates: { input: 4, output: 20 },  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
    { id: 'claude-opus-5',    name: 'Opus 5',     note: 'previous Opus (~25¢/run)',
      rates: { input: 5, output: 25 },  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
    { id: 'claude-fable-5-1', name: 'Fable 5.1',  note: 'Mythos-class, most capable (~50¢/run)',
      rates: { input: 10, output: 50 }, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
  ],
  replaced: {
    'claude-fable-5': 'claude-fable-5-1',
    'claude-opus-4-8': 'claude-opus-5-5',
    'claude-opus-4-7': 'claude-opus-5-5',
    'claude-opus-4-6': 'claude-opus-5-5',
    'claude-opus-4-5': 'claude-opus-5-5',
    'claude-sonnet-4-6': 'claude-sonnet-5',
    'claude-haiku-4-5-20251001': 'claude-sonnet-5',
  },
  effortLevels: [
    { id: 'low',    label: 'Fast' },
    { id: 'medium', label: 'Balanced' },
    { id: 'high',   label: 'Thorough' },
    // To offer deeper levels, uncomment (all current models support them):
    // { id: 'xhigh', label: 'Deep', minMaxTokens: 64000 },
  ],
};
/* =========================== end MODEL CONFIG =========================== */

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // GET returns the model config for the userscript's Settings panel.
    // No API key or D1 involved, so this works before the secret is set.
    if (request.method === 'GET') {
      return jsonResponse({ workerVersion: WORKER_VERSION, ...MODEL_CONFIG });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Only GET and POST are supported' }, 405);
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
    normalizeRequest(anthropicBody);

    // The upstream call and the D1 write are bundled into one promise so it
    // can be registered with ctx.waitUntil(). Without that, a client that
    // disconnects mid-request (the panel's Stop button, a closed tab, a
    // dropped connection) can get this Worker terminated before the log is
    // written — so the run would still be billed by Anthropic but leave no
    // trace in D1. waitUntil() lets the fetch and the log finish regardless.
    const work = (async () => {
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

      // Logging never blocks or fails the actual response to the userscript —
      // if it errors (binding not set up yet, D1 quota, etc.) we swallow it
      // so the proxy still works.
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

      return { text, status: anthropicRes.status };
    })();

    if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(work); }

    try {
      const result = await work;
      return new Response(result.text, {
        status: result.status,
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    } catch (err) {
      return jsonResponse({ error: 'Upstream request to Anthropic failed: ' + err.message }, 502);
    }
  },
};

// Keeps requests valid as the lineup changes, including requests from older
// userscripts that still have a hardcoded model list:
//  - a replaced/retired model ID is swapped for its replacement
//  - an effort level the model doesn't accept is dropped (API default applies)
// Unknown model IDs pass through untouched so a brand-new model still works
// before this config is updated.
function normalizeRequest(body) {
  if (MODEL_CONFIG.replaced[body.model]) {
    body.model = MODEL_CONFIG.replaced[body.model];
  }
  const model = MODEL_CONFIG.models.find((m) => m.id === body.model);
  const effort = body.output_config && body.output_config.effort;
  if (model && effort && model.efforts.indexOf(effort) === -1) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) { delete body.output_config; }
  }
}

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

