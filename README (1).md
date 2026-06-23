# Résumé Tailor

A browser userscript that tailors your résumé to a specific job posting using Claude, then produces two outputs:

- A formatted **PDF** in your choice of four styles (Editorial Warmth, Slate Professional, Engineering Blueprint, or Bold Data-Forward).
- A plain-text **ATS version** for pasting directly into job application portals.

It runs entirely in your browser. Your résumé content is stored locally via your userscript manager's storage — nothing is sent anywhere except the job description and your résumé text, which go to Claude through a small proxy you control (see below).

## How it works

1. You save your résumé content once (PDF upload, pasted text, or LinkedIn text) into a local knowledge base.
2. On any page, a small blue dot sits faded in the corner. Click it once to bring it to full opacity, click it again to open the panel. (See "The floating dot" below for the full interaction.)
3. On a job posting page, grab the job description, and click "Tailor my résumé."
4. Claude suggests title reframes, bullet rewrites, and possible new bullets — phrased as "did you do this?" questions, never asserted as fact. You approve or skip each one.
5. Click "Build my résumé" to assemble the final version, then export it as a PDF in your chosen style, or copy the ATS plain-text version.

The script is intentionally conservative about honesty: it won't invent achievements, and anything it's not sure about gets surfaced as a yes/no question for you to confirm.

## The floating dot

The launcher is a small circular dot, faded to low opacity by default so it doesn't clutter every page you visit:

- **Click it once** — it becomes fully visible, with a small × in its corner.
- **Click it again** — opens the full panel.
- **Click the ×** — fades it back to low opacity.
- **Drag it anywhere** — it stays exactly where you drop it (no edge-snapping), and that position is remembered across page loads and across every site you visit.
- Closing the panel (its own × in the header) returns the dot to its solid state, not all the way back to faded — only the dot's own × does that.

## Prerequisites

You'll need three things before this is useful:

1. **A userscript manager** — [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari) or [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox). Either works; this guide uses Tampermonkey.
2. **An Anthropic API key** — from [console.anthropic.com](https://console.anthropic.com). This is a pay-as-you-go API key, separate from a claude.ai subscription. Typical cost per tailoring run is a few cents depending on the model you choose.
3. **A small proxy of your own** — the script never embeds an API key directly (that would expose it to anyone who reads the script's source, since userscripts run in plain JavaScript visible in DevTools). Instead it calls a tiny proxy you deploy yourself, which holds your key server-side. Setup instructions for a free Cloudflare Worker proxy are below — it takes about five minutes.

## Installation

1. Install Tampermonkey for your browser.
2. Click the Tampermonkey icon → **Create a new script**.
3. Delete the placeholder content and paste in the entire contents of [`resume-tailor.user.js`](./resume-tailor.user.js) from this repo.
4. Save (Ctrl+S or File → Save).
5. Visit any webpage — a small faded blue dot should appear in the top-right corner (see "The floating dot" above for how it works).

## Setting up your proxy (required)

The script needs a URL it can POST to that forwards requests to Anthropic's API with your key attached. The easiest free option is a Cloudflare Worker.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free tier is enough).
2. Go to **Workers & Pages** → **Create** → **Create Worker**. Give it any name (e.g. `resume-tailor-proxy`) and deploy the default template.
3. Click **Edit code** and replace everything with the contents of [`cloudflare-worker-proxy.js`](./cloudflare-worker-proxy.js) from this repo.
4. Go to the Worker's **Settings → Variables and Secrets**, and add a secret named `ANTHROPIC_API_KEY` with your API key as the value. Keeping it as a secret (not a plaintext variable) means it's encrypted and never shown again in the dashboard.
5. Deploy. Copy the Worker's URL — it'll look like `https://resume-tailor-proxy.<your-subdomain>.workers.dev`.
6. Open the Résumé Tailor panel in your browser, go to **Settings**, paste that URL into **Proxy URL**, pick a model, and click **Save settings**.

That's it — the script now has a working path to Claude without your API key ever touching client-side code.

## Setting up usage logging (optional)

The script can log call metadata — model, token usage, success/failure, and similar diagnostics — to a Cloudflare D1 database. This is **optional**; without it, the script works exactly the same, just without a persistent log. Only metadata is logged, never résumé content or job description text.

1. In your Cloudflare dashboard, go to **Workers & Pages** → **D1** → **Create database**. Name it `resume_tailor_logdb`.
2. Open the database's **Console** tab and run:
   ```sql
   CREATE TABLE runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL,
     call_type TEXT NOT NULL,
     model TEXT,
     template TEXT,
     stop_reason TEXT,
     input_tokens INTEGER,
     output_tokens INTEGER,
     max_tokens_requested INTEGER,
     request_id TEXT,
     parse_ok INTEGER,
     error_message TEXT,
     job_title TEXT,
     company TEXT
   );
   ```
3. Go to your Worker's **Settings → Bindings → Add binding → D1 database**. Set the variable name to `DB` and select `resume_tailor_logdb`.
4. Deploy. The Worker's existing code (from this repo) already includes the logging logic — no further setup needed.

Logging failures never block the actual proxy response — if the binding isn't set up, or D1 is briefly unavailable, the script still works normally, it just won't have a log entry for that call.

`job_title` and `company` columns exist in the schema but are intentionally left empty by the current code, since populating them would mean logging which job you're applying to. See the comment in `cloudflare-worker-proxy.js` if you want to enable that yourself.

## Setting up your knowledge base

In the Résumé Tailor panel, under **Knowledge base**, fill in as many of these as you have:

- **Résumé PDF** — upload your current résumé; the script extracts text from it locally using pdf.js.
- **Google Doc paste** — paste your full résumé text if you keep it in a doc.
- **LinkedIn** — your profile URL plus pasted About/experience text.
- **Original Profile/Summary statement** — this one matters: paste the exact short summary you want to appear on the résumé, not your LinkedIn About section. The script anchors the generated Profile section on this text and edits it minimally per job, rather than inventing a new one. If you skip this field, the generated summary will likely run longer and drift from your intended phrasing.

Click **Save knowledge base**. This is stored locally in your browser via the userscript manager's storage — it doesn't leave your machine except as part of the prompts sent to your own proxy when you run a tailoring pass.

## Choosing a PDF style

In **Settings**, the **PDF style** dropdown offers four designs:

- **Editorial Warmth** — warm cream background, serif headers, clay-accented sidebar. Classic and approachable.
- **Slate Professional** — dark slate sidebar with amber accents. A confident, modern corporate look.
- **Engineering Blueprint** — monospace section labels and a teal accent. Suited to engineering and technical roles.
- **Bold Data-Forward** — a full-width deep-blue header band with filled achievement callouts. High-contrast and direct.

A live preview thumbnail below the dropdown updates as you change the selection, using placeholder sample content, so you can see what a style looks like before ever running a tailoring pass. Your choice is saved with the rest of your settings.

## Using it on a job posting

1. Open the job posting in your browser.
2. Click the dot, then click it again to open the panel.
3. Click **Grab from this page** (or paste the job description manually if auto-detection doesn't isolate it cleanly).
4. Click **Tailor my résumé**. Review each suggested title change, bullet rewrite, and potential new bullet — approve or skip individually.
5. Click **Build my résumé**.
6. **Export PDF** opens a new tab in your chosen style and triggers your browser's print dialog — choose **Save as PDF**, and make sure **Background graphics** is checked under Options, or the sidebar's background color won't appear in the saved PDF. The suggested filename follows the pattern `FirstName_LastName_JobTitle_Resume`, using the job title from the posting when it can be detected, or your current résumé title otherwise.
7. **Copy HTML** copies a link you can paste directly into a new tab's address bar, useful as a fallback if a popup blocker stops Export from opening a new tab.
8. **ATS · copy** switches to the plain-text version for pasting into application portals.

A running cost estimate for the current session is shown discreetly in the panel header, next to the version number — hover over it for a breakdown of input/output tokens on the most recent call. This is an estimate based on Anthropic's published rates, not a billing-accurate figure.

## Known limitations

- On a résumé long enough to span two pages, each style's sidebar background currently only renders on page 1; page 2's sidebar content appears on a plain background. Chrome's print engine has inconsistent support for the CSS features that would be the standard fix for this. This affects all four PDF styles.
- The Editorial Warmth style's page-number footer only renders correctly through a dedicated CSS Paged Media engine (e.g. Prince, WeasyPrint). Chrome's built-in print-to-PDF omits it — a Chrome limitation, not a script bug.
- Site-specific job description extraction is heuristic — it works well on LinkedIn and most standard job boards, but unusual page layouts may require pasting the description manually.
- Sites with very strict Content Security Policies (LinkedIn included) are supported: PDF export works by triggering the print dialog from the userscript's own context rather than executing any script inside the exported document, which sidesteps CSP restrictions entirely. If a new site behaves unexpectedly, please open an issue with the console error.

## Privacy notes

- Your résumé content and knowledge base are stored locally via your userscript manager (`GM_setValue`/`GM_getValue`), not on any third-party server.
- Job descriptions and résumé content are sent to Anthropic's API only when you click "Tailor my résumé" or "Build my résumé," routed through the proxy you control.
- No analytics, tracking, or telemetry of any kind.

## License

MIT — see [LICENSE](./LICENSE).
