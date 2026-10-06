---
name: release
description: Cut a Résumé Tailor release end to end. Bump versions, write the changelog, syntax-check, confirm once, then commit, push, tag, verify GitHub serves it, and deploy the Worker if it changed. Use when the user runs /release (optionally with a version, "patch"/"minor", or "test") or asks to ship/release the current changes.
---

# Release

One command for the checklist in `RELEASING.md`. Fast path: **one confirmation**,
everything else automatic. Arguments (optional, any order):
- a version (`1.9.5`), or `patch` (default) / `minor`
- `test`: a test release. Version bump + one-line changelog only, **no tag**.

## 1. Work out what's shipping
- `git status --short` and `git describe --tags --abbrev=0` (last tag).
- Changed since the last tag (committed or not): `git diff --stat <last-tag>`.
- Shipped files are `resume-tailor.user.js` (userscript) and
  `cloudflare-worker-proxy.js` (Worker). If neither changed and this isn't a
  `test` release, say so and stop.
- If not on `main`, stop and ask.

## 2. Bump versions
New version = argument, or the next patch/minor after the current one.
- Userscript changed (or `test`): set `// @version` **and** `SCRIPT_VERSION`
  to the new version. They must match.
- Worker changed: bump `WORKER_VERSION` (patch for config-only changes).
- A Worker-only release keeps the userscript version unchanged. Its changelog heading
  is `## X.Y.Z (Worker only)` using the Worker version, as in past entries.

## 3. Changelog
Add a new top entry to `CHANGELOG.md` in the existing style: plain words, written
for users, bold lead-in per bullet, saying what they'll notice. Base it on the
actual diff, not guesses. For `test`: `- Test release for <purpose>. No other changes.`
If the Worker changed, open with a bold line telling users to redeploy it.

## 4. Check
- Run the syntax check from `CLAUDE.md`. If it fails, stop and show the error.
- `grep -n "@version\|SCRIPT_VERSION = \|WORKER_VERSION = "` and confirm the
  numbers are what you intended.

## 5. Confirm once
Show a compact summary: version(s), files changed (`git diff --stat`), the
changelog entry, and what will happen (commit → push → tag / no tag → Worker
deploy yes/no). Ask: **"Ship it?"** Do nothing outward-facing until the user says yes.
If they ask to change something, edit and show the summary again.

## 6. Ship
1. **GitHub account:** the expected account is the repo owner, from
   `git remote get-url origin`. If `gh auth status` shows a different active
   account, run `gh auth switch -u <owner>`. If that fails, stop and tell the user.
2. Stage only the files that are part of this release by name (not `git add .`).
   Commit as `vX.Y.Z — <short summary>`, with a body if useful, ending with the
   attribution line from the system reminder.
3. `git push origin main`.
4. Not `test`: `git tag -a vX.Y.Z -m "vX.Y.Z — <short summary>"` then
   `git push origin vX.Y.Z`.

## 7. Verify
- Userscript released: fetch
  `https://raw.githubusercontent.com/<owner>/<repo>/main/resume-tailor.user.js?t=<now>`
  and confirm `@version` is the new one. Retry a few times over ~30s if it's stale.
- Worker changed: ask "Deploy the Worker now?" On yes, run `npx wrangler deploy`
  from the repo folder. Then GET the Worker URL printed by Wrangler and confirm
  `workerVersion` matches. A push alone does **not** update the Worker.

## 8. Report
Keep it short:
- What shipped (version, commit, tag), and that GitHub serves it.
- **How users get it:** the in-panel badge shows "Update available (vX.Y.Z)" the
  next time the panel opens (up to 30 min after its last check). Otherwise the
  manager's own daily check picks it up. The badge and its hint come from the
  version being updated *from*, so UI changes to the update flow itself only
  show on the following release.
- Any pending release follow-ups in memory (e.g. things the user asked to check
  "at the next release"): remind the user now.
