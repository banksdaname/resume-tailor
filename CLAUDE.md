# Résumé Tailor — notes for Claude Code

A Tampermonkey userscript (`resume-tailor.user.js`) that calls Anthropic's
Messages API through a Cloudflare Worker proxy (`cloudflare-worker-proxy.js`)
using raw `fetch` (no SDK). The Worker also logs call metadata to Cloudflare D1.

## Where things live
- **Model list, prices, effort support, default model:** `MODEL_CONFIG` at the
  top of `cloudflare-worker-proxy.js`. This is the single source of truth. The
  userscript fetches it on `GET`. Don't re-add hardcoded model lists to the
  userscript (its `FALLBACK_CONFIG` is intentionally a short starter list).
- **Release checklist:** `RELEASING.md`. **Upgrade guide for users:** README →
  "Updating from an earlier version".

## Commands
- `/model-watch`: check Anthropic's docs for model, price, and effort changes and propose a `MODEL_CONFIG` update.
- `/claude-api migrate …`: built-in skill for API parameter and breaking changes. It does not auto-activate here (no SDK import), so invoke it by name.

## Working rules
- Do what's asked. Ask before large or unrequested changes. Fixes should be general, not site-specific patches.
- Every shipped file gets a version bump: `@version` + `SCRIPT_VERSION` in the userscript, `WORKER_VERSION` in the Worker.
- Syntax-check before committing:
  ```
  node -e 'const f=require("fs");new Function(f.readFileSync("resume-tailor.user.js","utf8").replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/,""));new Function(f.readFileSync("cloudflare-worker-proxy.js","utf8").replace("export default","var _w ="));console.log("OK")'
  ```
- Before any push: `gh auth status` must show `banksdaname`. If not, `gh auth switch -u banksdaname`. The old `audbanks` account causes 403s.
- GitHub and Cloudflare don't sync. If the Worker changed, remind the user to paste it into the Cloudflare editor and deploy.
- D1 console: no inline `--` SQL comments (they cause "incomplete input").
