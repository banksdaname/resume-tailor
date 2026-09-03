# Releasing

A short checklist to run through for every release that changes the script.

## 1. Model & pricing review (do this every release)

Anthropic's model lineup and pricing change often. Before shipping, re-check
that what's in the script is still current — even if nothing else prompted it.

- [ ] Check Anthropic's current model list and pricing (docs.anthropic.com / the pricing page).
- [ ] Compare against `MODELS` (the dropdown list) in `resume-tailor.user.js`.
- [ ] Compare against `MODEL_RATES` (per-million-token input/output rates) in `resume-tailor.user.js`.
- [ ] Add any new models worth offering; update any changed prices.
- [ ] Deprecate models no longer available: remove them from `MODELS` and `MODEL_RATES`, and add the old ID to `RETIRED_MODELS` so anyone who had it selected is migrated to the current default instead of getting a blank dropdown or a dead model ID.
- [ ] Confirm the default model (in `CFG.model`) is still a good, available choice.
- [ ] If nothing changed, leave the list as-is — no edit needed.

Note: `MODELS`, `MODEL_RATES`, and `RETIRED_MODELS` are kept in sync by hand.
Editing one usually means editing the others.

## 2. Standard release steps

- [ ] Bump `@version` in the userscript header AND `SCRIPT_VERSION` (both must match).
- [ ] Add a CHANGELOG.md entry describing the changes.
- [ ] Syntax-check: strip the `// ==UserScript==` header and run the body through `new Function(...)`; do the same for the worker (`export default` → `var _w =`).
- [ ] Copy the changed files into `~/resume-tailor`, replacing the old ones (watch for browser `(1)` suffixes).
- [ ] Verify with `grep "@version" resume-tailor.user.js` before committing.
- [ ] `git add . && git commit && git push`, then tag: `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`.
- [ ] If `cloudflare-worker-proxy.js` changed, redeploy it in the Cloudflare dashboard — GitHub and Cloudflare do NOT sync.

## 3. Auth reminder

If `git push` fails with `403 / denied to audbanks`, the `gh` CLI reverted
accounts. Run `gh auth status`; if it's not `banksdaname`, `gh auth switch -u banksdaname` and retry.
