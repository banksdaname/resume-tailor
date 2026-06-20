# Changelog

## 1.1.0

- **Added three new PDF styles** alongside Editorial Warmth: Slate Professional (dark sidebar, amber accents), Engineering Blueprint (monospace labels, teal accent), and Bold Data-Forward (deep-blue header band, filled callouts). All four share the same `break-inside: avoid` print-safety rules.
- **Added a style picker** in Settings with a live preview thumbnail that renders the selected style against placeholder sample content, updating instantly as the dropdown changes — no need to run a real tailoring pass just to see what a style looks like. The thumbnail fills the full settings card width, with the description underneath.
- **Rebuilt the floating launcher** as a small low-opacity dot instead of an always-visible pill. Click once to bring it to full opacity, click again to open the panel; a small × fades it back. The dot is also now **draggable** — it stays exactly where you drop it (no edge-snapping), and the position persists across page loads and across sites.
- Fixed a bug where clicking the dot's fade (×) button would also reopen the panel, caused by a click event bubbling from the × up to the dot's own click handler after the drag feature was added.
- Fixed a startup bug where a stale `true` value from a pre-1.0 install's "fully hidden" state could leave the dot permanently invisible with no way to recall it. That state is now cleared automatically on load and has been retired entirely.
- **Added an `allCompanies` field** to the tailoring analysis step, so the company picker for "possible additions" lists every employer in your knowledge base, not just the ones that happened to get a title or bullet suggestion that run.
- **Added automatic, standardized export filenames** following `FirstName_LastName_JobTitle_Resume` — the job title is pulled from the posting when detectable, falling back to your résumé's current role title. This drives the filename Chrome's print dialog suggests, via a `<title>` tag injected into the exported document (browsers don't otherwise let a page set its own save-as filename).
- **Removed all remaining `innerHTML` usage** (error messages and the loading spinner), replacing it with the same `createElement`-based pattern used everywhere else in the script, so these states render correctly even under a strict CSP.
- Removed unused `appToken` config field and the unused `GM_openInTab` permission grant.
- The inline preview in Step 3 now renders the actual selected template's real HTML inside a sandboxed iframe, instead of a separate hand-built look-alike that only ever matched the original Editorial Warmth style. Preview, Export, and Copy HTML now always agree, since there's a single HTML builder per style.

## 1.0.0

Initial public release.

Earlier internal versions (1.4.6 through 1.5.2) covered the following fixes, folded into this release:

- **Fixed a missing variable declaration** that caused a `SyntaxError` on certain sites, preventing the script from initializing at all.
- **Switched async/await to promise chains and arrow functions to `function()` declarations** throughout, for broader compatibility across site JS environments.
- **Fixed PDF export on LinkedIn**, which has a strict `script-src 'strict-dynamic'` Content Security Policy. Earlier approaches (writing directly into a new tab, then trying a `blob:` URL with an inlined pagination script) were both blocked by this policy, since it forbids inline script execution regardless of the document's origin. The fix removes the script-based pagination dependency entirely — the PDF template is pure HTML/CSS using a CSS Paged Media `@page` rule, and the print dialog is triggered from the userscript's own context (which isn't subject to the page's CSP) rather than from inside the exported document.
- **Fixed "Copy HTML"** to produce a `data:text/html;base64,...` URI that can be pasted directly into a browser address bar, replacing an earlier approach that asked users to paste raw HTML into the DevTools console (which broke on long content and quoting).
- **Added a dedicated "original summary" field** to the knowledge base, and anchored the AI-generated Profile/Summary section on it, since earlier versions would sometimes generate a new summary that drifted from the user's intended phrasing.
- **Added a drift-detection warning** in the review step that flags when the generated summary diverges too far from the user's saved original, with a one-click revert.
- **Added deduplication** to strip a role's "Signature win" highlight from also appearing as a duplicate first bullet underneath it, both via a prompt instruction and a deterministic client-side safety net.
- **Added `break-inside: avoid` rules** to role blocks, the Signature win callout, earlier-experience rows, and sidebar blocks, so the PDF print engine keeps each unit intact across a page break instead of splitting a role's bullets mid-sentence across two pages.

### Known open issues
- On a two-page résumé, the sidebar's background color only renders on page 1; page 2's sidebar content currently appears on a plain white background. Chrome's print engine has inconsistent support for the CSS Paged Media features (`position: running()`, named page regions) that would be the standard fix for this. This affects all PDF styles, not just Editorial Warmth.
- Chrome's print-to-PDF omits page-number footers defined via `@page { @bottom-right { ... } }`. A dedicated Paged Media renderer (Prince, WeasyPrint) would render them correctly; this is a Chrome limitation outside the script's control.
