# Changelog

## 1.8.1

- **Tampermonkey now auto-updates the userscript.** Added `@updateURL`/`@downloadURL` pointing at `main` on GitHub, so once this version is installed, future userscript releases arrive automatically after a push to `main` — no more pasting into the Tampermonkey editor. Forks should repoint these at their own repo.

## 1.8.0

**Update both the Worker and the userscript** — see "Updating from an earlier version" in the README.

- **The model list now lives in the Worker.** Model IDs, display names, prices, supported effort levels, and the default model are defined once in `MODEL_CONFIG` at the top of `cloudflare-worker-proxy.js`, served on `GET`. The userscript fetches and caches it when the panel opens. Future model additions, retirements, and price changes need only a Worker redeploy, not a userscript update. A note under **Model** in Settings shows where the list came from.
- **Refreshed the lineup.** Added **Opus 5.5** (new default, $4/$20) and **Fable 5.1**. Current options: Sonnet 5, Opus 5.5, Opus 5, Fable 5.1. Sonnet 5 is now priced at its $2/$10 standard rate. Retired choices are switched automatically: Opus 4.x → Opus 5.5, Sonnet 4.6 and Haiku 4.5 → Sonnet 5, Fable 5 → Fable 5.1.
- **The Worker keeps older userscripts working.** It swaps retired model IDs for their replacements and drops effort levels a model doesn't accept, so a stale client can't send a request the API rejects.
- **Effort is model-aware.** Levels the selected model doesn't support are greyed out, the nearest supported level is sent instead, and effort is omitted for models without it. Deeper levels (`xhigh`) can be enabled from the config and raise the output-token ceiling automatically.
- **Clear message when a model declines a request.** Newer models can return `stop_reason: "refusal"`, which previously surfaced as a confusing JSON parse error and a wasted retry.
- The cost estimate now prices by the model that actually ran.

## 1.7.0

- **Fixed runs failing on Opus 5 ("Failed to fetch").** Opus 5 and Sonnet 5 run with thinking on by default at high effort, and thinking tokens are drawn from the same `max_tokens` budget as the response. The previous ceilings (4,000 analyze / 6,000 assemble) left almost no room for the actual JSON after thinking. Raised to 16,000 and 24,000, matching Anthropic's guidance of at least 16K for calls at high effort. `max_tokens` is a ceiling rather than a reservation, so raising it costs nothing on its own.
- **Added a Stop button** to both the Tailor and Build steps. It appears only while a request is running and cancels it immediately. Stopping is treated as a deliberate action, not an error — no red error box.
- **Added a 5-minute request timeout** so a dead request fails with an explanation instead of hanging indefinitely.
- **Replaced opaque network errors with actionable ones.** A failed request previously surfaced the browser's raw "Failed to fetch". It now names the proxy URL and points at the Worker deployment as the thing to check.
- **Added an Effort control** (below Model in Settings) with per-step settings. Effort governs how much the model thinks before answering; the API default is `high`, more than structured extraction needs. Three levels — Fast (`low`), Balanced (`medium`), Thorough (`high`) — with **Balanced as the default**, so runs are cheaper and faster out of the box. Tailor and Build can run at different levels, joined by a link toggle (solid bracket = linked, dashed = independent). If the API ever rejects the effort parameter, it's dropped for the session and the request retried without it.
- **Roles now appear in the same order as your knowledge base source.** The assemble step is instructed to preserve the original role sequence rather than reordering by date or relevance.
- **The Worker completes its D1 write after a client disconnects** via `ctx.waitUntil()`. Previously, stopping a run could terminate the Worker before the log was written — the run was still billed by Anthropic but left no record. Requires redeploying the Worker.
- **The cost readout is marked as an estimate** (`~$0.247 est`), with a tooltip noting that stopped runs are excluded from the panel total but may still be billed, since cancelling closes the browser connection without stopping generation upstream — the D1 log is the accurate record.

## 1.6.0

- **Refreshed the model lineup.** Added **Claude Opus 5** (released July 24, 2026) and made it the default. Removed Haiku 4.5 and Opus 4.6. Current options: Sonnet 4.6, Sonnet 5, Opus 4.7, Opus 4.8, Opus 5, Fable 5.
- **Added migration for retired models.** A model saved in settings that no longer appears in the dropdown would previously leave the selector blank and send a dead model ID to the API. Retired selections now switch to the current default automatically.
- Sonnet 5's cost estimate uses its standard $3/$15 rate rather than the introductory $2/$10 rate (in effect through Aug 31, 2026), so the estimate slightly over-reports during the intro window instead of silently under-reporting after it ends.
- **The launcher dot now hides while the panel is open** and returns when it closes.

## 1.5.x — site-compatibility hardening

- **Moved the panel into a Shadow DOM (1.5.0).** Host-page CSS can no longer reach the panel's styles, fixing layout corruption seen on Greenhouse and other sites with aggressive stylesheets. Previously the panel could render completely unstyled — full-width, no cards, no spacing — depending on the site.
- **Made the launcher dot survive stylesheet wipes (1.5.5).** On Greenhouse, repeated React hydration-recovery cycles were removing the injected stylesheet from `<head>`, leaving the dot present in the DOM but invisible (and later rendering its × as plain text inside the pill). The dot's critical styles are now applied inline on the element, with visibility state driven from JS rather than CSS classes.
- **Added DOM-removal recovery (1.5.1).** A `MutationObserver` now restores the launcher and panel host immediately if the page removes them, instead of waiting up to 1.5s for the next interval check. The reattach loop is also wrapped in try/catch so a single transient error can't permanently kill it.
- **Fixed the template preview on LinkedIn (1.5.2).** LinkedIn's CSP blocked sandboxed `srcdoc` iframes from rendering, causing the preview to display raw CSS source text instead of the résumé. Previews now load via blob URLs — the same approach already used for PDF export.
- **Fixed job-description capture across ATS layouts (1.5.3, 1.5.4).** Lever splits a posting across several sibling sections; only the first was being captured, silently truncating the grab after the intro paragraph. Matches that are siblings under one parent are now concatenated. Scattered matches (LinkedIn's job-list pages, where broad selectors also hit promos and footer chrome) resolve to the single largest match instead.

## 1.4.x

- **Replaced the review step's toggle buttons with segmented controls.** Each suggestion now shows both options side by side — `Use | Skip`, `Approve | Skip`, `Include | Skip` — with the active one filled. Previously a single button changed both its label and meaning on click ("✓ Use" became "Skipped"), which was easy to misread.
- **Improved job-description extraction heuristics (1.4.1).** Job-specific headings ("About the role", "What you'll do", "Responsibilities") now take priority over company headings, so a posting that opens with "About the company" no longer starts the capture on boilerplate. Added selectors for Greenhouse, Lever, Workable, Ashby, SmartRecruiters, Workday, and iCIMS, and expanded the stop-keyword list to trim EEO statements, benefits blocks, and footer legal text.

## 1.3.0

- **Added a primary-source selector.** Each knowledge base source (PDF, Google Doc, LinkedIn) now has a "Primary" radio button. Previously the script silently used the Google Doc and ignored the other two entirely.
- **Supplementary sources are now used.** The primary source is the résumé base; the others are passed as clearly labelled supplementary material. If the job calls for something documented in a supplementary source but missing from the primary, it surfaces as a normal bullet-rewrite or possible-addition suggestion for you to approve — nothing is added automatically.
- **Fixed approved title changes not applying to condensed roles.** Roles in the "Earlier Experience" section kept their original titles even when a title change was approved.

## 1.2.x — LinkedIn import

- **Added "Grab from LinkedIn"** to the knowledge base, replacing the URL field and paste box. It opens your LinkedIn profile in a new tab with a helper panel for pasting your About and Experience sections.
- Automatic DOM extraction was attempted first and abandoned: LinkedIn returns empty results for content that is visibly rendered on the page, so the guided paste flow is the reliable approach.
- The panel now closes when the grab starts, and re-reads saved data each time it opens, so a save made in the LinkedIn tab is reflected without a page refresh.

## 1.1.1

- **Raised the analyze step's token limit from 2,500 to 4,000.** D1 logs showed every analyze call hitting exactly 2,500 output tokens — the ceiling, not a natural stopping point — so responses were being truncated on every run.
- **Retries now escalate the token limit.** A retry after a `max_tokens` failure previously reused the same limit, guaranteeing the same failure. It now requests 50% more.

## 1.1.0

- **Added a usage/diagnostics log to a Cloudflare D1 database.** Each call now logs its model, call type (analyze/assemble), selected PDF style, `stop_reason`, input/output token counts, and parse success/failure to D1 for later analysis. Only call metadata is logged — résumé content and job description text are never sent to the log. Requires a one-time D1 database + Worker binding setup (see README).
- **Added automatic retry on JSON parse failure.** If a tailoring response comes back malformed or truncated, the script now retries once automatically before showing an error, rather than requiring a manual re-click.
- **Replaced the raw JSON parser error with a human-readable explanation** when both the original attempt and the retry fail, using the actual `stop_reason` and token usage from the response (e.g. "cut off at 5,980 of 6,000 allowed tokens") instead of `Expected ',' or ']' after array element...`.
- **Added a discreet cost/token display** in the panel header, next to the version number. Shows the current session's running total cost and the most recent call's token usage, estimated from Anthropic's published per-model rates. Hover for a breakdown of input vs. output tokens.

## 1.0.3 (reverted, not released)

A fix for a thumbnail scaling race condition was implemented and then rolled back before release. The underlying glitch (a cosmetic, self-correcting issue on first panel open — see 1.0.2's note) remains unfixed for now.

## 1.0.2

- **Removed the separate "Use selected text" button.** It duplicated what manual paste already covers, and its own behavior wasn't self-evident from its label. Its actual value — letting you select the exact job description text yourself when the page heuristic guesses wrong — is now folded into "Grab from this page": if you've selected text on the page before clicking it, that selection is used; otherwise it falls back to the existing automatic extraction. One button, simpler row, same capability.
- Fixed the underlying selection-tracking bug along the way: reading `window.getSelection()` at click-time was unreliable since clicking a button collapses the page's text selection before the click handler runs. The selection is now tracked continuously in the background instead.

## 1.0.0

Initial public release.

Four PDF styles to choose from: Editorial Warmth, Slate Professional (dark sidebar, amber accents), Engineering Blueprint (monospace labels, teal accent), and Bold Data-Forward (deep-blue header band, filled callouts). All four share the same `break-inside: avoid` print-safety rules. A style picker in Settings shows a live preview thumbnail against placeholder sample content, updating instantly as the dropdown changes.

The floating launcher is a small low-opacity dot rather than an always-visible pill. Click once to bring it to full opacity, click again to open the panel; a small × fades it back. The dot is also draggable — it stays exactly where you drop it (no edge-snapping), and the position persists across page loads and across sites.

Exported PDFs get automatic, standardized filenames following `FirstName_LastName_JobTitle_Resume` — the job title is pulled from the posting when detectable, falling back to the résumé's current role title.

The tailoring analysis step includes a complete `allCompanies` list, so the "possible additions" company picker lists every employer in the knowledge base, not just ones that received a title or bullet suggestion that run.

The inline preview in Step 3 renders the actual selected template's real HTML inside a sandboxed iframe, so preview, Export, and Copy HTML always agree — there's a single HTML builder per style, not a separate hand-built look-alike.

Earlier development iterations (not separately released) covered the following fixes, folded into this release:

- **Fixed a missing variable declaration** that caused a `SyntaxError` on certain sites, preventing the script from initializing at all.
- **Switched async/await to promise chains and arrow functions to `function()` declarations** throughout, for broader compatibility across site JS environments.
- **Fixed PDF export on LinkedIn**, which has a strict `script-src 'strict-dynamic'` Content Security Policy. Earlier approaches (writing directly into a new tab, then trying a `blob:` URL with an inlined pagination script) were both blocked by this policy, since it forbids inline script execution regardless of the document's origin. The fix removes the script-based pagination dependency entirely — the PDF template is pure HTML/CSS using a CSS Paged Media `@page` rule, and the print dialog is triggered from the userscript's own context (which isn't subject to the page's CSP) rather than from inside the exported document.
- **Fixed "Copy HTML"** to produce a `data:text/html;base64,...` URI that can be pasted directly into a browser address bar, replacing an earlier approach that asked users to paste raw HTML into the DevTools console (which broke on long content and quoting).
- **Added a dedicated "original summary" field** to the knowledge base, and anchored the AI-generated Profile/Summary section on it, since earlier versions would sometimes generate a new summary that drifted from the user's intended phrasing.
- **Added a drift-detection warning** in the review step that flags when the generated summary diverges too far from the user's saved original, with a one-click revert.
- **Added deduplication** to strip a role's "Signature win" highlight from also appearing as a duplicate first bullet underneath it, both via a prompt instruction and a deterministic client-side safety net.
- **Added `break-inside: avoid` rules** to role blocks, the Signature win callout, earlier-experience rows, and sidebar blocks, so the PDF print engine keeps each unit intact across a page break instead of splitting a role's bullets mid-sentence across two pages.
- Fixed a bug where clicking the dot's fade (×) button would also reopen the panel, caused by a click event bubbling from the × up to the dot's own click handler after the drag feature was added.
- Fixed a startup bug where a stale `true` value from an early "fully hidden" launcher state could leave the dot permanently invisible with no way to recall it. That state is now cleared automatically on load and has been retired entirely.
- **Removed all remaining `innerHTML` usage** (error messages and the loading spinner), replacing it with the same `createElement`-based pattern used everywhere else in the script, so these states render correctly even under a strict CSP.
- Removed unused `appToken` config field and the unused `GM_openInTab` permission grant.

### Known open issues
- On a two-page résumé, the sidebar's background color only renders on page 1; page 2's sidebar content currently appears on a plain white background. Chrome's print engine has inconsistent support for the CSS Paged Media features (`position: running()`, named page regions) that would be the standard fix for this. This affects all PDF styles.
- Chrome's print-to-PDF omits page-number footers defined via `@page { @bottom-right { ... } }`. A dedicated Paged Media renderer (Prince, WeasyPrint) would render them correctly; this is a Chrome limitation outside the script's control.
