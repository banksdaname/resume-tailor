# Changelog

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
