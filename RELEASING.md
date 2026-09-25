# Releasing

A short checklist to run through for every release that changes the script.

## 1. Model & pricing review (do this every release)

Anthropic's model lineup and pricing change often. Everything model-related
lives in ONE place: the `MODEL_CONFIG` block at the top of
`cloudflare-worker-proxy.js`. The userscript fetches it from the Worker, so a
model-only change is a Worker redeploy — no userscript version bump.

**Fastest path (Claude Code, from the repo folder):** run `/model-watch`. It
checks Anthropic's docs, compares them against `MODEL_CONFIG`, reports what
changed, and proposes the edit for your approval.

Manual checklist, if you'd rather do it by hand:

- [ ] Check Anthropic's models overview, pricing, deprecations, and effort pages (platform.claude.com/docs).
- [ ] New model worth offering → add an entry to `models` (id, name, note, rates, efforts, defaultEffort).
- [ ] Price change → update that model's `rates`.
- [ ] Model dropped from the dropdown (or retired by Anthropic) → remove it from `models` and add `'old-id': 'replacement-id'` to `replaced`, so saved settings and older userscripts are moved over automatically.
- [ ] Effort support changed → update that model's `efforts` list.
- [ ] Confirm `defaultModel` is still a good, available choice.
- [ ] Bump `updated` to today's date.
- [ ] If nothing changed, leave it as-is.
- [ ] Deprecated **parameters** (e.g. a thinking or sampling field the script sends) need a code change, not just a config edit. In Claude Code, `/claude-api migrate` handles these.

If the config changed, the Worker must be redeployed (see step 2's last item).

## 2. Standard release steps

- [ ] Bump `@version` in the userscript header AND `SCRIPT_VERSION` (both must match). If the Worker changed, bump `WORKER_VERSION` too.
- [ ] Add a CHANGELOG.md entry describing the changes.
- [ ] Syntax-check: strip the `// ==UserScript==` header and run the body through `new Function(...)`; do the same for the worker (`export default` → `var _w =`).
- [ ] If working outside the repo folder: copy the changed files into `~/resume-tailor`, replacing the old ones (watch for browser `(1)` suffixes). Not needed when working in Claude Code from `~/resume-tailor`.
- [ ] Verify with `grep "@version" resume-tailor.user.js` before committing.
- [ ] `git add . && git commit && git push`, then tag: `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`.
- [ ] The pushed userscript reaches installed copies automatically — Tampermonkey polls the `@updateURL` on `main` and offers the update. No manual paste needed.
- [ ] If `cloudflare-worker-proxy.js` changed, redeploy it from the repo folder with `npx wrangler deploy` (config lives in `wrangler.toml`). GitHub and Cloudflare do NOT sync, so a push alone does not update the Worker.

## 3. Auth reminder

If `git push` fails with `403 / denied to audbanks`, the `gh` CLI reverted
accounts. Run `gh auth status`; if it's not `banksdaname`, `gh auth switch -u banksdaname` and retry.
