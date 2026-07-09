// ==UserScript==
// @name         Résumé Tailor
// @namespace    banksdaname
// @version      1.5.0
// @description  Tailor your résumé to any job posting. Editorial Warmth PDF + ATS plain text.
// @author       banksdaname
// @match        *://*/*
// @exclude-match chrome-extension://*/*
// @exclude-match moz-extension://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_openInTab
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  var SCRIPT_VERSION = '1.5.0';

  /* ============ LinkedIn paste helper — runs only on linkedin.com/in/* pages
     opened by the "Grab from LinkedIn" button (identified by #rt_grab).
     Shows a small corner panel with two textareas (About, Experience) for
     the user to paste content from the profile page. Auto-scraping the DOM
     turns out to not work reliably — LinkedIn's actively defending against
     it (queries return null for content that's visibly rendered). This
     honest guided flow is the reliable alternative. ============ */
  if (/linkedin\.com\/in\//i.test(location.href) && /#rt_grab/.test(location.hash)) {
    var buildPasteHelper = function() {
      var helper = document.createElement('div');
      helper.style.cssText = 'position:fixed;top:80px;right:20px;width:360px;max-height:85vh;overflow-y:auto;background:#fff;border:2px solid #3b4cca;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);z-index:99999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c2230';

      var head = document.createElement('div');
      head.style.cssText = 'background:#3b4cca;color:#fff;padding:12px 15px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between';
      var headTitle = document.createElement('div');
      headTitle.style.cssText = 'font-weight:700;font-size:14px';
      headTitle.textContent = '📄 Résumé Tailor — Grab from LinkedIn';
      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;line-height:1';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function() { helper.remove(); });
      head.appendChild(headTitle); head.appendChild(closeBtn);

      var body = document.createElement('div');
      body.style.cssText = 'padding:14px 15px';

      var intro = document.createElement('div');
      intro.style.cssText = 'font-size:12.5px;color:#4a5060;margin-bottom:14px;line-height:1.45';
      intro.textContent = 'Copy your About and Experience sections from the profile below and paste them here. LinkedIn actively blocks automatic grabbing, so a quick copy/paste is the reliable path.';

      var mkLabel = function(text) {
        var l = document.createElement('label');
        l.style.cssText = 'display:block;font-size:12px;font-weight:600;margin:10px 0 5px;color:#1c2230';
        l.textContent = text;
        return l;
      };
      var mkTa = function(placeholder, rows) {
        var t = document.createElement('textarea');
        t.rows = rows;
        t.placeholder = placeholder;
        t.style.cssText = 'width:100%;padding:8px 10px;font-size:12.5px;border:1px solid #d0d4dc;border-radius:7px;font-family:inherit;box-sizing:border-box;resize:vertical';
        return t;
      };

      var aboutTa = mkTa('Paste your About section text here…', 4);
      var expTa = mkTa('Paste your entire Experience section here (all roles, one after another)…', 8);

      var msg = document.createElement('div');
      msg.style.cssText = 'font-size:12px;margin-top:10px;min-height:16px';

      var saveBtn = document.createElement('button');
      saveBtn.style.cssText = 'width:100%;margin-top:12px;padding:10px;background:#3b4cca;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer';
      saveBtn.textContent = 'Save to Résumé Tailor';
      saveBtn.addEventListener('click', function() {
        var aboutText = aboutTa.value.trim();
        var expText = expTa.value.trim();
        if (!aboutText && !expText) {
          msg.style.color = '#b23a3a';
          msg.textContent = 'Paste at least one section before saving.';
          return;
        }
        var liText = '';
        if (aboutText) { liText += '=== ABOUT ===\n' + aboutText + '\n\n'; }
        if (expText) { liText += '=== EXPERIENCE ===\n' + expText; }

        var KB = GM_getValue('rt_kb', null);
        if (typeof KB === 'string') { try { KB = JSON.parse(KB); } catch(e) { KB = {}; } }
        if (!KB || typeof KB !== 'object') { KB = {}; }
        KB.liText = liText.trim();
        KB.liGrabbedAt = Date.now();
        GM_setValue('rt_kb', JSON.stringify(KB));

        msg.style.color = '#1f7a34';
        msg.textContent = '✓ Saved. You can close this tab and continue in Résumé Tailor.';
        saveBtn.disabled = true;
        saveBtn.style.background = '#7d84a8';
        saveBtn.textContent = 'Saved ✓';
      });

      body.appendChild(intro);
      body.appendChild(mkLabel('About section'));
      body.appendChild(aboutTa);
      body.appendChild(mkLabel('Experience section'));
      body.appendChild(expTa);
      body.appendChild(saveBtn);
      body.appendChild(msg);

      helper.appendChild(head);
      helper.appendChild(body);
      return helper;
    };

    var mountHelper = function() {
      if (!document.body) { setTimeout(mountHelper, 200); return; }
      document.body.appendChild(buildPasteHelper());
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      mountHelper();
    } else {
      document.addEventListener('DOMContentLoaded', mountHelper);
    }

    return; // ← early exit: don't build the normal panel on this tab
  }
  /* ============ end LinkedIn paste helper — normal panel below ============ */

  var CFG = {
    proxyUrl: GM_getValue('rt_proxyUrl', ''),
    model: GM_getValue('rt_model', 'claude-sonnet-4-6'),
    template: GM_getValue('rt_template', 'editorial'),
  };
  var KB = GM_getValue('rt_kb', null);
  if (typeof KB === 'string') { try { KB = JSON.parse(KB); } catch (e) { KB = null; } }
  var ANALYSIS = null, DECISIONS = null, LAST_RESUME = null, pdfText = '';

  var MODELS = [
    ['claude-haiku-4-5-20251001', 'Haiku 4.5 — cheapest (~5¢/run)'],
    ['claude-sonnet-4-6', 'Sonnet 4.6 — recommended (~15¢/run)'],
    ['claude-sonnet-5', 'Sonnet 5 — newer Sonnet (~15¢/run)'],
    ['claude-opus-4-6', 'Opus 4.6 — older Opus (~25¢/run)'],
    ['claude-opus-4-7', 'Opus 4.7 — Opus intermediate (~25¢/run)'],
    ['claude-opus-4-8', 'Opus 4.8 — top Opus (~25¢/run)'],
    ['claude-fable-5', 'Fable 5 — Mythos-class, most capable (~50¢/run)'],
  ];

  var esc = function(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // btoa() only handles Latin1 — this routes the string through UTF-8 bytes
  // first so accented characters (é, ·, etc.) survive the round trip.
  function b64EncodeUtf8(str) {
    var utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8);
  }

  // Launcher-dot CSS stays in the light DOM — the dot itself lives outside
  // the shadow root so it can use position:fixed against the outer document.
  GM_addStyle(`
    #rt-launch{position:fixed!important;z-index:2147483646!important;width:34px;height:34px;border-radius:50%;background:#3b4cca;color:#fff;display:flex!important;align-items:center;justify-content:center;font:700 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);border:none;cursor:grab;opacity:.22;transition:opacity .18s ease;padding:0;touch-action:none}
    #rt-launch.rt-dragging{cursor:grabbing;opacity:1;transition:none}
    #rt-launch:hover{opacity:.45}
    #rt-launch.rt-solid{opacity:1}
    #rt-launch.rt-solid:hover{opacity:1}
    #rt-launch.rt-off{display:none!important}
    #rt-launch .rt-dotlabel{pointer-events:none}
    #rt-launch .rt-x{display:none;position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;background:#1c2230;color:#fff;border:1.5px solid #f4f5f8;font-size:11px;line-height:1;align-items:center;justify-content:center;cursor:pointer;padding:0}
    #rt-launch.rt-solid .rt-x{display:flex}
    #rt-launch .rt-x:hover{background:#3b4cca}
    /* Shadow host is the light-DOM element that hosts our panel's shadow.
       It needs position:fixed so it can pin to the viewport edge. Everything
       *inside* the shadow (the actual panel UI) is isolated from host-page CSS. */
    #rt-shadow-host{position:fixed!important;top:0!important;right:0!important;z-index:2147483647!important;width:0;height:0;pointer-events:none}
    #rt-shadow-host.open{width:auto;height:auto;pointer-events:auto}
  `);

  // Panel CSS is injected as a <style> element inside the shadow root, where
  // host-page CSS cannot reach it. This is the fix for CSS collisions with
  // sites like Greenhouse, LinkedIn, etc. — no matter what rules the host page
  // has, they can't override styles inside a shadow tree.
  var PANEL_CSS = `
    #rt-root,#rt-root *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    #rt-root{position:fixed;top:0;right:0;width:430px;max-width:96vw;height:100vh;background:#f4f5f8;color:#1c2230;box-shadow:-8px 0 30px rgba(0,0,0,.18);overflow-y:auto;line-height:1.45;display:none}
    #rt-root.open{display:block}
    #rt-root .rt-hd{position:sticky;top:0;background:#fff;border-bottom:1px solid #e6e8ee;padding:13px 16px;display:flex;align-items:center;gap:9px;z-index:2}
    #rt-root .rt-hd b{font-size:15px}
    #rt-root .rt-x{margin-left:auto;border:none;background:#f0f1f4;border-radius:7px;width:28px;height:28px;cursor:pointer;font-size:16px}
    #rt-root .rt-body{padding:16px}
    #rt-root .card{background:#fff;border:1px solid #e6e8ee;border-radius:13px;padding:15px;margin-bottom:14px}
    #rt-root h2{font-size:14px;margin:0 0 4px;display:flex;align-items:center;gap:7px}
    #rt-root .desc{color:#6b7280;font-size:12.5px;margin:0 0 12px}
    #rt-root label{font-size:12px;font-weight:600;display:block;margin:0 0 5px}
    #rt-root textarea,#rt-root input[type=text],#rt-root select{width:100%;border:1px solid #e6e8ee;border-radius:8px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fcfcfe;color:#1c2230;resize:vertical}
    #rt-root textarea:focus,#rt-root input:focus,#rt-root select:focus{outline:none;border-color:#3b4cca;box-shadow:0 0 0 3px #eef0fb}
    #rt-root .field{margin-bottom:12px}
    #rt-root .note{font-size:11.5px;color:#6b7280;margin:4px 0 0}
    #rt-root .filebtn{display:inline-block;padding:7px 12px;border:1px dashed #3b4cca;color:#3b4cca;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;background:#eef0fb}
    #rt-root .filebtn input{display:none}
    #rt-root .btn{border:none;border-radius:9px;padding:10px 16px;font-size:13.5px;font-weight:650;cursor:pointer;font-family:inherit}
    #rt-root .btn.primary{background:#3b4cca;color:#fff}
    #rt-root .btn.primary:disabled{opacity:.5}
    #rt-root .btn.ghost{background:#fff;border:1px solid #e6e8ee;color:#1c2230}
    #rt-root .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #rt-root .pill{font-size:11px;padding:3px 8px;border-radius:99px;font-weight:600}
    #rt-root .pill.ok{background:#e9f7ef;color:#16a34a}
    #rt-root .pill.ok.primary{background:#eef0fb;color:#3b4cca;font-weight:700}
    #rt-root .pill.none{background:#f0f1f4;color:#9aa0ab}
    #rt-root .hidden{display:none!important}
    #rt-root .banner{display:flex;gap:9px;background:#fdf3e7;border:1px solid #f3dcbd;color:#b45309;border-radius:9px;padding:10px 12px;font-size:12px;margin-bottom:12px}
    #rt-root .rev{border:1px solid #e6e8ee;border-radius:10px;padding:11px;margin-bottom:10px;background:#fcfcfe}
    #rt-root .rev.is-skip{opacity:.55}
    #rt-root .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:6px}
    #rt-root .orig{font-size:12px;color:#6b7280;margin:0 0 6px;padding-left:9px;border-left:2px solid #e6e8ee}
    #rt-root .why{font-size:11.5px;color:#6b7280;margin-top:7px;font-style:italic}
    #rt-root .seg{display:inline-flex;background:#f0f1f4;border-radius:9px;padding:3px;margin-top:8px;gap:2px}
    #rt-root .seg .chip{border:none;background:transparent;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;color:#6b7280;transition:background .15s,color .15s;margin:0}
    #rt-root .seg .chip:hover{color:#1c2230}
    #rt-root .seg .chip.on-ok{background:#3b4cca;color:#fff;box-shadow:0 1px 2px rgba(59,76,202,.25)}
    #rt-root .seg .chip.on-skip{background:#fff;color:#6b7280;box-shadow:0 1px 2px rgba(0,0,0,.06)}
    #rt-root .chip{border:1px solid #e6e8ee;background:#fff;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;margin-right:6px;margin-top:7px;display:inline-block}
    #rt-root .chip.on-ok{background:#e9f7ef;border-color:#bfe6cd;color:#16a34a}
    #rt-root .chip.on-skip{background:#f0f1f4;color:#9aa0ab}
    #rt-root .sec-title{font-size:12.5px;font-weight:700;margin:16px 0 8px}
    #rt-root .skill{font-size:12px;padding:5px 10px;border-radius:7px;border:1px solid #e6e8ee;background:#fff;cursor:pointer;display:inline-block;margin:0 6px 6px 0}
    #rt-root .skill.on{background:#3b4cca;color:#fff;border-color:#3b4cca}
    #rt-root .skill.add{border-style:dashed;border-color:#3b4cca;color:#3b4cca}
    #rt-root .skill.add.on{background:#3b4cca;color:#fff}
    #rt-root .err{background:#fdecec;border:1px solid #f6c9c9;color:#b91c1c;border-radius:8px;padding:9px 11px;font-size:12.5px;margin-top:9px}
    #rt-root .spin{width:14px;height:14px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:rtsp .7s linear infinite;vertical-align:-2px;margin-right:6px}
    @keyframes rtsp{to{transform:rotate(360deg)}}
    #rt-root .primary-source-row{display:flex;align-items:center;gap:8px;margin:8px 0 4px;font-size:11.5px;color:#4a5060}
    #rt-root .primary-source-row input[type=radio]{margin:0;cursor:pointer}
    #rt-root .primary-source-row label{margin:0;font-size:11.5px;font-weight:500;cursor:pointer}
    #rt-root .primary-source-row.active label{color:#1c2230;font-weight:600}
    #rt-root #rt-preview iframe{display:block;width:100%;height:560px;border:none}
    #rt-root .tpl-preview-row{display:block;margin-top:10px}
    #rt-root .tpl-thumb{width:100%;aspect-ratio:850/1100;border:1px solid #e6e8ee;border-radius:6px;overflow:hidden;position:relative;background:#fff}
    #rt-root .tpl-thumb iframe{width:850px;height:1100px;border:none;transform-origin:top left;pointer-events:none}
    #rt-root .tpl-preview-row .note{margin-top:8px}
    #rt-root #rt-ats{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;background:#fff}
  `;

  /* ============ DOM — createElement only, no innerHTML, bypasses LinkedIn TrustedHTML ============ */
  function mk(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function(k) {
        if (k === 'cls') { e.className = props[k]; }
        else if (k === 'txt') { e.textContent = props[k]; }
        else if (k === 'id') { e.id = props[k]; }
        else { e.setAttribute(k, props[k]); }
      });
    }
    return e;
  }
  function ap(parent) {
    var args = Array.prototype.slice.call(arguments, 1);
    args.forEach(function(c) { if (c) { parent.appendChild(c); } });
    return parent;
  }
  function mkBtn(cls, id, txt) { return ap(mk('button', { cls: 'btn ' + cls, id: id }), document.createTextNode(txt)); }
  function mkCard() { var d = mk('div', { cls: 'card' }); Array.prototype.slice.call(arguments).forEach(function(c) { if(c) d.appendChild(c); }); return d; }
  function mkField(labelTxt) {
    var d = mk('div', { cls: 'field' });
    var l = mk('label'); l.textContent = labelTxt; d.appendChild(l);
    Array.prototype.slice.call(arguments, 1).forEach(function(c) { if(c) d.appendChild(c); });
    return d;
  }
  // Field variant with an inline "Primary" radio next to the label, for
  // sources the user can designate as primary in the tailor step. The
  // radio's `value` is the source key (pdf, gdoc, li); grouping via `name`
  // makes them mutually exclusive across the three source fields.
  function mkFieldWithRadio(labelTxt, sourceKey) {
    var d = mk('div', { cls: 'field' });
    var labelRow = mk('div'); labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    var l = mk('label'); l.textContent = labelTxt; l.style.margin = '0';
    var radioWrap = mk('label'); radioWrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#6b7280;font-weight:normal;cursor:pointer;white-space:nowrap;margin:0';
    var radio = mk('input', { type: 'radio', id: 'rt-primary-' + sourceKey });
    radio.name = 'rt-primary'; radio.value = sourceKey;
    radio.style.cssText = 'margin:0;cursor:pointer';
    radioWrap.appendChild(radio);
    radioWrap.appendChild(document.createTextNode('Primary'));
    labelRow.appendChild(l);
    labelRow.appendChild(radioWrap);
    d.appendChild(labelRow);
    Array.prototype.slice.call(arguments, 2).forEach(function(c) { if(c) d.appendChild(c); });
    return d;
  }
  function mkNote(id) { return mk('span', { cls: 'note', id: id }); }
  function mkRow() { var d = mk('div', { cls: 'row' }); Array.prototype.slice.call(arguments).forEach(function(c) { if(c) d.appendChild(c); }); return d; }
  function mkInp(type, id, placeholder) { return mk('input', { type: type, id: id, placeholder: placeholder }); }
  function mkTa(id, rows, placeholder) { return mk('textarea', { id: id, rows: rows, placeholder: placeholder }); }

  var launch = mk('button', { id: 'rt-launch' });
  launch.title = 'R\u00E9sum\u00E9 Tailor';
  var dotLabel = mk('span', { cls: 'rt-dotlabel' }); dotLabel.textContent = 'RT';
  var hbtn = mk('span', { cls: 'rt-x' }); hbtn.title = 'Fade'; hbtn.textContent = '\u00D7';
  ap(launch, dotLabel, hbtn);
  document.documentElement.appendChild(launch);

  var root = mk('div', { id: 'rt-root' });

  // Header
  var hdLogo = mk('div'); hdLogo.style.cssText = 'width:24px;height:24px;border-radius:6px;background:#3b4cca;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0'; hdLogo.textContent = 'R';
  var hdInner = mk('div'); hdInner.style.cssText = 'display:flex;flex-direction:column;gap:1px';
  var hdTitle = mk('b'); hdTitle.textContent = 'R\u00E9sum\u00E9 Tailor';
  var hdVer = mk('span'); hdVer.style.cssText = 'font-size:10px;color:#9aa0ab;font-weight:400'; hdVer.textContent = 'v' + SCRIPT_VERSION;
  hdInner.appendChild(hdTitle); hdInner.appendChild(hdVer);
  var hdCost = mk('span', { id: 'rt-hdCost' }); hdCost.style.cssText = 'margin-left:8px;font-size:10.5px;color:#9aa0ab;white-space:nowrap';
  var closeBtn = mk('button', { cls: 'rt-x', id: 'rt-close' }); closeBtn.textContent = '\u00D7';
  var hd = ap(mk('div', { cls: 'rt-hd' }), hdLogo, hdInner, hdCost, closeBtn);

  // Settings card
  var proxyInp = mkInp('text', 'rt-proxy', 'https://name.account.workers.dev');
  var modelSel = mk('select', { id: 'rt-model' });
  var templateSel = mk('select', { id: 'rt-template' });
  var templateThumb = mk('div', { cls: 'tpl-thumb', id: 'rt-templateThumb' });
  var templateBlurb = mk('p', { cls: 'note', id: 'rt-templateBlurb' });
  var templatePreviewRow = ap(mk('div', { cls: 'tpl-preview-row' }), templateThumb, templateBlurb);
  var cfgCard = mkCard(
    ap(mk('h2'), document.createTextNode('\u2699\uFE0F Settings')),
    ap(mk('p', { cls: 'desc' }), document.createTextNode('One-time setup. Your API key stays in your Cloudflare Worker.')),
    mkField('Proxy URL', proxyInp),
    mkField('Model', modelSel),
    mkField('PDF style', templateSel, templatePreviewRow),
    mkBtn('primary', 'rt-saveCfg', 'Save settings'),
    mkNote('rt-cfgMsg')
  );

  // KB card
  var kbStatus = mk('span', { cls: 'pill none', id: 'rt-kbStatus' }); kbStatus.textContent = 'Not set up';
  var kbH2 = mk('h2'); kbH2.appendChild(document.createTextNode('\uD83D\uDCDA Knowledge base ')); kbH2.appendChild(kbStatus);
  var pdfFileInp = mk('input', { type: 'file', id: 'rt-pdf', accept: 'application/pdf' });
  var pdfFileLbl = ap(mk('label', { cls: 'filebtn' }), document.createTextNode('Choose PDF'), pdfFileInp);
  var pdfState = mkNote('rt-pdfState'); pdfState.textContent = 'No file yet';
  var liGrabBtn = mkBtn('ghost', 'rt-liGrab', '\uD83D\uDD17 Grab from LinkedIn');
  liGrabBtn.style.cssText = 'padding:7px 12px;font-size:12.5px;width:100%';
  var liGrabNote = mkNote('rt-liGrabNote');
  liGrabNote.textContent = 'Opens your LinkedIn profile in a new tab with a helper panel \u2014 paste your About and Experience sections, then click Save.';
  var kbForm = ap(mk('div', { id: 'rt-kbForm' }),
    mkFieldWithRadio('1 \u00B7 R\u00E9sum\u00E9 PDF', 'pdf', pdfFileLbl, pdfState),
    mkFieldWithRadio('2 \u00B7 Paste from your Google Doc (no length limit)', 'gdoc', mkTa('rt-gdoc', '10', 'Paste your full r\u00E9sum\u00E9 text here\u2026')),
    mkFieldWithRadio('3 \u00B7 LinkedIn', 'li', liGrabBtn, liGrabNote),
    mkField('4 \u00B7 Your original Profile/Summary statement (used as-is, lightly tuned per job)', mkTa('rt-summary', '3', 'Paste the short profile/summary you actually want on the r\u00E9sum\u00E9 \u2014 not your LinkedIn About section.')),
    mkBtn('primary', 'rt-saveKb', 'Save knowledge base'),
    mkNote('rt-kbMsg')
  );
  var p1 = mk('span', { cls: 'pill none', id: 'rt-p1' }); p1.textContent = 'PDF';
  var p2 = mk('span', { cls: 'pill none', id: 'rt-p2' }); p2.textContent = 'Doc';
  var p3 = mk('span', { cls: 'pill none', id: 'rt-p3' }); p3.textContent = 'LinkedIn';
  var p4 = mk('span', { cls: 'pill none', id: 'rt-p4' }); p4.textContent = 'Summary';
  var editKbBtn = mkBtn('ghost', 'rt-editKb', 'Edit'); editKbBtn.style.cssText = 'margin-left:auto;padding:6px 11px;font-size:12px';
  var kbSummary = ap(mk('div', { cls: 'hidden', id: 'rt-kbSummary' }), mkRow(p1, p2, p3, p4, editKbBtn));
  var kbCard = mkCard(kbH2, ap(mk('p', { cls: 'desc' }), document.createTextNode('Add your background once \u2014 saved locally in this browser.')), kbForm, kbSummary);

  // JD card
  var grabBtn = mkBtn('ghost', 'rt-grab', 'Grab from this page'); grabBtn.style.cssText = 'padding:7px 12px;font-size:12.5px';
  var analyzeBtn = mkBtn('primary', 'rt-analyze', 'Tailor my r\u00E9sum\u00E9');
  var jdCard = mkCard(
    ap(mk('h2'), document.createTextNode('\uD83C\uDFAF Step 1 \u00B7 Job description')),
    ap(mk('p', { cls: 'desc' }), document.createTextNode('Grab it off this page, or paste it in.')),
    mkRow(grabBtn),
    mkTa('rt-jd', '6', 'Paste the job description\u2026'),
    ap(mk('div', { cls: 'row' }), analyzeBtn),
    mk('div', { id: 'rt-analyzeErr' })
  );

  // Review card
  var bannerDiv = mk('div', { cls: 'banner' });
  bannerDiv.textContent = '\uD83D\uDEE1\uFE0F ';
  var bannerInner = mk('div');
  var bannerB = mk('b'); bannerB.textContent = 'Grounded by design.';
  bannerInner.appendChild(bannerB);
  bannerInner.appendChild(document.createTextNode(' Rewrites stay based on your real material \u2014 nothing is invented. Any new bullet only appears as a "did you do this?" prompt for you to confirm.'));
  bannerDiv.appendChild(bannerInner);
  var reviewCard = ap(mk('div', { cls: 'card hidden', id: 'rt-reviewCard' }),
    ap(mk('h2'), document.createTextNode('\u2705 Step 2 \u00B7 Review')),
    bannerDiv,
    mk('div', { id: 'rt-titleSec' }),
    mk('div', { id: 'rt-bulletSec' }),
    mk('div', { id: 'rt-newSec' }),
    mk('div', { id: 'rt-skillSec' }),
    ap(mk('div', { cls: 'row' }), mkBtn('primary', 'rt-assemble', 'Build my r\u00E9sum\u00E9 \u2192')),
    mk('div', { id: 'rt-assembleErr' })
  );

  // Output card
  var viewPdfBtn = mk('button', { id: 'rt-viewPdf', cls: 'on' }); viewPdfBtn.textContent = 'PDF preview';
  var viewAtsBtn = mk('button', { id: 'rt-viewAts' }); viewAtsBtn.textContent = 'ATS \u00B7 copy';
  var segDiv = ap(mk('div', { cls: 'seg' }), viewPdfBtn, viewAtsBtn);
  var exportBtn = mkBtn('primary', 'rt-export', 'Export PDF'); exportBtn.style.marginLeft = 'auto';
  var copyHtmlBtn = mkBtn('ghost', 'rt-copyHtml', 'Copy HTML');
  var copyBtn = mkBtn('primary hidden', 'rt-copy', 'Copy text');
  var atsArea = mkTa('rt-ats', '20', ''); atsArea.readOnly = true; atsArea.classList.add('hidden');
  var outputCard = ap(mk('div', { cls: 'card hidden', id: 'rt-outputCard' }),
    ap(mk('h2'), document.createTextNode('\uD83D\uDCC4 Step 3 \u00B7 Output')),
    mk('p', { cls: 'desc', id: 'rt-outputDesc' }),
    mkRow(segDiv, exportBtn, copyHtmlBtn, copyBtn),
    mk('div', { id: 'rt-driftWarn' }),
    mk('div', { id: 'rt-preview' }),
    atsArea,
    mk('p', { cls: 'note', id: 'rt-copyMsg' })
  );

  var rtBody = ap(mk('div', { cls: 'rt-body' }), cfgCard, kbCard, jdCard, reviewCard, outputCard);
  ap(root, hd, rtBody);

  // Shadow DOM setup: create a host in the light DOM, attach an open shadow
  // root, and put both our CSS and our panel inside it. This isolates our
  // styles from the host page's CSS completely — no matter what rules
  // Greenhouse/LinkedIn/etc. define, they can't reach into a shadow tree.
  // The host itself is intentionally sized 0x0 when closed; the panel's
  // own position:fixed inside the shadow handles its actual dimensions.
  var shadowHost = mk('div', { id: 'rt-shadow-host' });
  document.documentElement.appendChild(shadowHost);
  var shadow = shadowHost.attachShadow({ mode: 'open' });
  var shadowStyle = document.createElement('style');
  shadowStyle.textContent = PANEL_CSS;
  shadow.appendChild(shadowStyle);
  shadow.appendChild(root);

  function rt$(id) { return root.querySelector('#' + id); }
  var sel = rt$('rt-model');
  MODELS.forEach(function(m) {
    var o = document.createElement('option');
    o.value = m[0];
    o.textContent = m[1];
    sel.appendChild(o);
  });

  /* ============ pill state machine ============
     State A (faded): low-opacity dot, only "RT" visible, no X shown.
     State B (solid): full-opacity dot with an X in its corner.
       - click the dot itself -> opens the panel.
       - click the X -> fades back to State A.
       - drag the dot anywhere -> repositions it; release leaves it exactly
         where dropped (no edge-snap), and the position persists across
         page loads via GM_setValue.
     Closing the panel (its own × in the header) returns to State B,
     never all the way back to State A — only the dot's own X does that. */
  function reattach() {
    if (!document.documentElement.contains(launch)) { document.documentElement.appendChild(launch); }
    if (!document.documentElement.contains(shadowHost)) { document.documentElement.appendChild(shadowHost); }
  }
  function setSolid(isSolid) {
    if (isSolid) { launch.classList.add('rt-solid'); } else { launch.classList.remove('rt-solid'); }
    GM_setValue('rt_pillSolid', isSolid);
  }
  function openPanel() { reattach(); setSolid(true); root.classList.add('open'); shadowHost.classList.add('open'); try { hydrate(); } catch(e) { console.error('[Résumé Tailor]', e); } }
  function closePanel() { root.classList.remove('open'); shadowHost.classList.remove('open'); setSolid(true); }
  function showPill() { reattach(); launch.classList.remove('rt-off'); GM_setValue('rt_pillHidden', false); }

  // Position the dot via left/top (not right/bottom) so drag math is a
  // simple delta-add. Default mirrors the old right:18px/top:18px corner.
  function applyPillPosition(pos) {
    launch.style.left = pos.x + 'px';
    launch.style.top = pos.y + 'px';
    launch.style.right = 'auto';
  }
  function clampToViewport(x, y) {
    var size = 34; // matches #rt-launch width/height
    var maxX = Math.max(0, window.innerWidth - size);
    var maxY = Math.max(0, window.innerHeight - size);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }
  var savedPos = GM_getValue('rt_pillPos', null);
  var pillPos = savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number'
    ? clampToViewport(savedPos.x, savedPos.y)
    : clampToViewport(window.innerWidth - 18 - 34, 18);
  applyPillPosition(pillPos);

  // Drag handling: track pointer movement distance so a small jitter still
  // counts as a click (opens the panel / toggles solid), while a real drag
  // never fires the click behavior on release.
  var DRAG_THRESHOLD = 6; // px of movement before it's treated as a drag, not a click
  var dragState = null;

  launch.addEventListener('pointerdown', function(e) {
    if (e.target.closest('.rt-x')) { return; } // let the X's own click handler run
    var rect = launch.getBoundingClientRect();
    dragState = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false
    };
    launch.setPointerCapture(e.pointerId);
  });
  launch.addEventListener('pointermove', function(e) {
    if (!dragState) { return; }
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      dragState.moved = true;
      launch.classList.add('rt-dragging');
    }
    if (dragState.moved) {
      var next = clampToViewport(e.clientX - dragState.offsetX, e.clientY - dragState.offsetY);
      pillPos = next;
      applyPillPosition(pillPos);
    }
  });
  function endDrag(e) {
    if (!dragState) { return; }
    var wasDrag = dragState.moved;
    if (wasDrag) {
      launch.classList.remove('rt-dragging');
      GM_setValue('rt_pillPos', pillPos);
    }
    dragState = null;
    return wasDrag;
  }
  launch.addEventListener('pointerup', function(e) {
    if (e.target.closest('.rt-x')) { return; } // the X's own click handler owns this; don't also toggle/open
    var wasDrag = endDrag(e);
    if (wasDrag) { return; } // suppress the click that follows a drag release
    if (launch.classList.contains('rt-solid')) { openPanel(); }
    else { setSolid(true); }
  });
  launch.addEventListener('pointercancel', function(e) { endDrag(e); });

  launch.querySelector('.rt-x').addEventListener('click', function(e) {
    e.stopPropagation();
    setSolid(false);
  });
  rt$('rt-close').addEventListener('click', closePanel);

  // One-time migration: versions before 1.6.0 had a fully-hidden "rt-off"
  // state with no recovery path other than a userscript-manager menu command
  // (GM_registerMenuCommand). ScriptVault doesn't expose that menu, so if a
  // user's stored value was true from an earlier version, the pill would
  // disappear with no way back. Clear it unconditionally so this state can
  // never recur — the faded dot is now the only "hidden" state, and it
  // always has a click-to-recall path.
  GM_setValue('rt_pillHidden', false);

  if (GM_getValue('rt_pillSolid', false) === true) { launch.classList.add('rt-solid'); }
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open R\u00E9sum\u00E9 Tailor', function() { showPill(); openPanel(); });
  }
  setInterval(reattach, 1500);

  /* ============ hydrate ============ */
  // Generic placeholder résumé content used ONLY for the style-preview
  // thumbnail in Settings — never shown anywhere a real résumé would be,
  // and never sent to the API. Lets a user see what a style looks like
  // before ever running a tailoring pass.
  var SAMPLE_RESUME = {
    name: 'Jordan Avery',
    tagline: 'Senior Product Manager \u00B7 Growth & Platform',
    contact: 'Austin, TX \u00B7 512-555-0148 \u00B7 jordan.avery@email.com \u00B7 linkedin.com/in/jordanavery',
    summary: 'Product manager with eight years driving growth initiatives across B2B SaaS platforms, combining data-driven prioritization with close cross-functional execution.',
    experience: [
      {
        title: 'Senior Product Manager', company: 'Northwind Software', dates: '2021\u2013Present',
        highlight: 'Launched a self-serve onboarding flow that lifted trial-to-paid conversion 18% within two quarters.',
        condensed: false,
        bullets: ['Own the product roadmap for the platform\u2019s core workspace.', 'Run quarterly discovery cycles with enterprise customers.']
      },
      {
        title: 'Product Manager', company: 'Carverdale Tech', dates: '2018\u20132021',
        condensed: false,
        bullets: ['Managed the end-to-end roadmap for billing and subscriptions.']
      },
      { title: 'Associate Product Manager', company: 'Carverdale Tech', dates: '2016\u20132018', condensed: true }
    ],
    skills: ['Roadmapping', 'SQL', 'A/B testing', 'Stakeholder alignment'],
    education: [{ degree: 'B.S. Business Administration', sub: 'University of Texas at Austin \u00B7 2012\u20132016' }],
    certifications: ['Certified Scrum Product Owner']
  };

  // Single persistent resize handler — re-scales whichever thumbnail iframe
  // is currently in the DOM. Using one shared listener here (rather than
  // adding a new one inside renderTemplateThumb on every dropdown change)
  // avoids accumulating stale listeners that reference detached iframes.
  function rescaleTemplateThumb() {
    var thumbEl = rt$('rt-templateThumb');
    var frame = thumbEl && thumbEl.querySelector('iframe');
    if (!frame) { return; }
    var boxWidth = thumbEl.clientWidth || 1;
    frame.style.transform = 'scale(' + (boxWidth / 850) + ')';
  }
  window.addEventListener('resize', rescaleTemplateThumb);

  function renderTemplateThumb(templateId) {
    var t = TEMPLATES[templateId] || TEMPLATES.editorial;
    var thumbEl = rt$('rt-templateThumb');
    clearEl(thumbEl);
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.srcdoc = t.build(SAMPLE_RESUME);
    thumbEl.appendChild(frame);
    // Defer one frame so clientWidth is accurate after layout settles.
    requestAnimationFrame(rescaleTemplateThumb);
  }

  function hydrate() {
    // Re-read KB from storage every time the panel opens, since a save
    // may have happened on another tab (e.g. the LinkedIn paste helper)
    // while this tab's in-memory KB was stale.
    var fresh = GM_getValue('rt_kb', null);
    if (typeof fresh === 'string') { try { fresh = JSON.parse(fresh); } catch(e) { fresh = null; } }
    if (fresh) { KB = fresh; }
    rt$('rt-proxy').value = CFG.proxyUrl;
    sel.value = CFG.model;
    var tplSel = rt$('rt-template');
    if (!tplSel.options.length) {
      Object.keys(TEMPLATES).forEach(function(id) {
        var o = document.createElement('option');
        o.value = id;
        o.textContent = TEMPLATES[id].label;
        tplSel.appendChild(o);
      });
      tplSel.addEventListener('change', function() {
        rt$('rt-templateBlurb').textContent = (TEMPLATES[tplSel.value] || {}).blurb || '';
        renderTemplateThumb(tplSel.value);
      });
    }
    tplSel.value = CFG.template;
    rt$('rt-templateBlurb').textContent = (TEMPLATES[CFG.template] || TEMPLATES.editorial).blurb;
    renderTemplateThumb(CFG.template);
    if (KB) { renderKbSummary(); }
  }

  /* ============ settings ============ */
  rt$('rt-saveCfg').addEventListener('click', function() {
    CFG.proxyUrl = rt$('rt-proxy').value.trim();
    CFG.model = sel.value;
    CFG.template = rt$('rt-template').value || 'editorial';
    GM_setValue('rt_proxyUrl', CFG.proxyUrl);
    GM_setValue('rt_model', CFG.model);
    GM_setValue('rt_template', CFG.template);
    rt$('rt-cfgMsg').textContent = ' Saved \u2713';
    setTimeout(function() { rt$('rt-cfgMsg').textContent = ''; }, 2000);
    // If a résumé was already built, refresh the preview + Step 3 explainer
    // to reflect the newly selected template immediately, rather than
    // leaving a stale preview until the next "Build my résumé" run.
    if (LAST_RESUME && !rt$('rt-outputCard').classList.contains('hidden')) {
      var previewEl = rt$('rt-preview');
      clearEl(previewEl);
      previewEl.appendChild(buildPreviewFrame(LAST_RESUME));
      var activeTpl = TEMPLATES[CFG.template] || TEMPLATES.editorial;
      rt$('rt-outputDesc').textContent = 'PDF is your ' + activeTpl.label + ' formatted version. ATS is plain text for job portals.';
    }
  });

  /* ============ PDF extraction ============ */
  rt$('rt-pdf').addEventListener('change', function(e) {
    var f = e.target.files[0];
    if (!f) { return; }
    rt$('rt-pdfState').textContent = 'Reading\u2026';
    var lib = window.pdfjsLib;
    if (!lib) { rt$('rt-pdfState').textContent = 'PDF reader not ready — try again in a moment.'; return; }
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var reader = new FileReader();
    reader.onload = function(ev) {
      var buf = ev.target.result;
      lib.getDocument({ data: buf }).promise.then(function(pdf) {
        var pages = [];
        for (var i = 1; i <= pdf.numPages; i++) { pages.push(i); }
        var texts = [];
        var chain = Promise.resolve();
        pages.forEach(function(i) {
          chain = chain.then(function() {
            return pdf.getPage(i).then(function(p) {
              return p.getTextContent().then(function(c) {
                texts.push(c.items.map(function(x) { return x.str; }).join(' '));
              });
            });
          });
        });
        return chain.then(function() {
          pdfText = texts.join('\n').trim();
          rt$('rt-pdfState').textContent = '\u2713 ' + f.name + ' (' + pdfText.length + ' chars)';
        });
      }).catch(function(err) {
        rt$('rt-pdfState').textContent = 'Could not read PDF — paste text into box 2 instead.';
        console.error('[R\u00E9sum\u00E9 Tailor]', err);
      });
    };
    reader.readAsArrayBuffer(f);
  });

  /* ============ KB ============ */
  rt$('rt-saveKb').addEventListener('click', function() {
    var gdocText = rt$('rt-gdoc').value.trim();
    var originalSummary = rt$('rt-summary').value.trim();
    var usePdf = pdfText || (KB && KB.pdfText) || '';
    var liText = (KB && KB.liText) || ''; // preserved from last LinkedIn grab, not re-entered
    if (!usePdf && !gdocText && !liText) { rt$('rt-kbMsg').textContent = ' Add at least one source.'; return; }

    // Which source is designated as primary? Enforce an explicit pick when
    // more than one source is provided — the tailor step behaves very
    // differently depending on which is chosen, and a silent default would
    // hide that decision from the user. Query is scoped to `root` because
    // the radios live inside the shadow root, not the light DOM.
    var primaryRadio = root.querySelector('input[name="rt-primary"]:checked');
    var primarySource = primaryRadio ? primaryRadio.value : '';
    var providedSources = [usePdf && 'pdf', gdocText && 'gdoc', liText && 'li'].filter(Boolean);
    if (providedSources.length > 1 && !primarySource) {
      rt$('rt-kbMsg').textContent = ' Choose which source is Primary before saving.';
      return;
    }
    if (providedSources.length === 1 && !primarySource) {
      primarySource = providedSources[0]; // only one option, no ambiguity
    }

    KB = { pdfText: usePdf, gdocText: gdocText, liText: liText, originalSummary: originalSummary, primarySource: primarySource, updatedAt: Date.now() };
    GM_setValue('rt_kb', JSON.stringify(KB));
    rt$('rt-kbMsg').textContent = ' Saved \u2713';
    renderKbSummary();
  });
  rt$('rt-editKb').addEventListener('click', function() {
    rt$('rt-gdoc').value = KB.gdocText || '';
    rt$('rt-summary').value = KB.originalSummary || '';
    if (KB.pdfText) { rt$('rt-pdfState').textContent = '\u2713 Saved PDF text on file. Choose a new PDF to replace.'; }
    if (KB.liText) {
      var grabbed = KB.liGrabbedAt ? new Date(KB.liGrabbedAt).toLocaleDateString() : 'previously';
      rt$('rt-liGrabNote').textContent = '\u2713 LinkedIn grabbed ' + grabbed + '. Click to refresh.';
    }
    // Restore radio selection so the user's prior primary-source choice is
    // visible when they edit the KB.
    if (KB.primarySource) {
      var restoreRadio = root.querySelector('input[name="rt-primary"][value="' + KB.primarySource + '"]');
      if (restoreRadio) { restoreRadio.checked = true; }
    }
    rt$('rt-kbSummary').classList.add('hidden');
    rt$('rt-kbForm').classList.remove('hidden');
  });
  function pill(id, on, label, isPrimary) {
    var e = rt$(id);
    e.className = 'pill ' + (on ? (isPrimary ? 'ok primary' : 'ok') : 'none');
    e.textContent = (isPrimary ? '\u2605 ' : (on ? '\u2713 ' : '\u2014 ')) + label + (isPrimary ? ' \u00B7 primary' : '');
  }
  function renderKbSummary() {
    var p = KB.primarySource || '';
    pill('rt-p1', !!KB.pdfText, 'PDF', p === 'pdf');
    pill('rt-p2', !!KB.gdocText, 'Doc', p === 'gdoc');
    pill('rt-p3', !!KB.liText, 'LinkedIn', p === 'li');
    pill('rt-p4', !!KB.originalSummary, 'Summary', false);
    rt$('rt-kbStatus').className = 'pill ok';
    rt$('rt-kbStatus').textContent = 'Saved';
    rt$('rt-kbForm').classList.add('hidden');
    rt$('rt-kbSummary').classList.remove('hidden');
  }

  /* ============ smart JD grab ============ */
  function smartGrabJD() {
    // Normalizes a raw text blob: strip carriage returns, trim per-line
    // whitespace, drop empty lines, collapse repeated newlines.
    var normalize = function(txt) {
      return txt.replace(/\r/g, '')
        .split('\n').map(function(l) { return l.trim(); }).filter(Boolean)
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };

    // Tier 1: try known ATS content selectors first. These are the most
    // reliable when they hit — they mark the exact job description block
    // that the ATS renders, sidestepping company boilerplate and footer.
    // Covers LinkedIn, Greenhouse, Lever, Workable, Ashby, Rippling,
    // SmartRecruiters, Workday, iCIMS. If any selector's content is
    // substantial (>200 chars), use it and skip the heuristics entirely.
    var atsSels = [
      // LinkedIn
      '.jobs-description__content', '.jobs-box__html-content', '[class*="jobs-description"]', '[class*="job-details"]', '.description__text',
      // Greenhouse
      '#content', '#app_body #content', '.opening', '.section-wrapper .content', '[class*="job__description"]',
      // Lever
      '.posting-page .section-wrapper', '[data-qa="job-description"]', '.section.page-centered',
      // Workable
      '[data-ui="job-description"]', 'section[data-ui="job"]',
      // Ashby
      '[class*="_descriptionText"]', '[class*="_jobPostingContent"]',
      // SmartRecruiters
      '.job-description-content', '[itemprop="description"]',
      // Workday
      '[data-automation-id="jobPostingDescription"]',
      // iCIMS
      '.iCIMS_JobContent', '[itemprop="description"]',
      // Rippling / generic ATS patterns
      '[class*="job-description" i]', '[class*="jobDescription"]',
      // Generic microdata / semantic
      'article[itemtype*="JobPosting"]', '[itemtype*="JobPosting"]'
    ];
    for (var i = 0; i < atsSels.length; i++) {
      try {
        var el = document.querySelector(atsSels[i]);
        if (el && (el.innerText || '').trim().length > 200) {
          return normalize(el.innerText).slice(0, 8000);
        }
      } catch (e) { /* invalid selector on some browsers; skip */ }
    }

    // Tier 2: fall back to keyword-anchored scan of the main content area.
    // Prefer <main>/[role=main]/<article>; only use full body if none of
    // those exist (they usually do).
    var mainEl = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('article');
    var text = (mainEl && (mainEl.innerText || '').trim().length > 300) ? mainEl.innerText : (document.body.innerText || '');
    text = text.replace(/\r/g, '');
    var low = text.toLowerCase();

    // Tiered start keys: job-content-first headers (tier A) take priority
    // over company info (tier B). If a tier A header exists anywhere, use
    // it — even if a tier B header appears earlier in the doc. This fixes
    // the "About the company" appearing before "About the job" trap.
    var startKeysA = [
      'about the job', 'about this job', 'about the role', 'about this role',
      'the role', 'job description', 'job details', 'role description',
      "what you'll do", 'what you will do', "what you'll be doing",
      'responsibilities', 'key responsibilities', 'your responsibilities',
      "what impact you'll have", 'what you will bring',
      'the position', 'position summary', 'position overview', 'role summary',
      "who you'll work with", 'requirements', 'qualifications', 'minimum qualifications', 'preferred qualifications', 'basic qualifications'
    ];
    var startKeysB = [
      'about the company', 'about us', 'who we are', 'about', 'overview', 'company overview'
    ];

    var findEarliest = function(keys) {
      var earliest = -1;
      for (var k = 0; k < keys.length; k++) {
        var idx = low.indexOf(keys[k]);
        if (idx !== -1 && (earliest === -1 || idx < earliest)) { earliest = idx; }
      }
      return earliest;
    };
    var startA = findEarliest(startKeysA);
    var startB = findEarliest(startKeysB);
    // Use tier A if it exists at all. Fall back to tier B only if tier A found nothing.
    var start = (startA !== -1) ? startA : startB;
    if (start > 0) { text = text.slice(start); }

    // Expanded stop keys: cut before footer legal, EEO statements,
    // benefits enumeration, salary boilerplate, related-jobs sections,
    // and generic site chrome. Only look for these in the second half of
    // the (already-trimmed) document — a "benefits" section that shows up
    // in the first 500 chars is probably a nav item, not the actual end.
    var stopKeys = [
      // Related content
      'similar jobs', 'more jobs from', 'people also viewed', 'jobs you may be interested', 'related jobs',
      'recommended for you', 'show more jobs', 'other opportunities', 'other openings',
      // Site actions/UI chrome
      'set alert', 'report this job', 'apply for this job', 'apply now', 'share this job', 'save this job',
      'sign in to', 'create alert', 'back to jobs',
      // Legal footer
      'cookie policy', 'privacy policy', 'terms of service', 'terms of use', 'terms and conditions',
      'copyright ', '© ', 'all rights reserved',
      // EEO / diversity statements (usually well after the actual job content)
      'equal opportunity employer', 'equal employment opportunity', 'affirmative action',
      'reasonable accommodation', 'e-verify', 'protected veteran',
      // Compensation/benefits boilerplate that usually comes last
      'salary range', 'compensation range', 'expected salary', 'base salary range',
      'benefits include', 'we offer', 'perks and benefits', 'total rewards',
      // Application-tracking chrome
      'powered by', 'apply for this position', 'submit application'
    ];
    var low2 = text.toLowerCase();
    var halfway = Math.floor(text.length / 2);
    var end = text.length;
    for (var ki = 0; ki < stopKeys.length; ki++) {
      var kidx = low2.indexOf(stopKeys[ki]);
      // Only treat as a stop if it's in the later half — an earlier
      // occurrence is more likely part of the job content itself
      // (e.g. "we offer competitive compensation" inside a benefits bullet
      // that's still part of the JD, not the site's benefits footer).
      if (kidx > halfway && kidx < end) { end = kidx; }
    }
    return normalize(text.slice(0, end)).slice(0, 8000);
  }

  /* ============ LinkedIn grab button ============ */
  rt$('rt-liGrab').addEventListener('click', function() {
    var note = rt$('rt-liGrabNote');
    note.textContent = 'Opening LinkedIn\u2026 Paste your About and Experience there, then reopen this panel.';
    GM_openInTab('https://www.linkedin.com/in/#rt_grab', { active: true, insert: true });
    closePanel();
  });

  // window.getSelection() at click-time is unreliable: clicking the Grab
  // button itself collapses whatever text was selected on the page before
  // the click handler ever runs. Instead, track the last non-empty
  // selection continuously, ignoring selections made inside our own panel
  // (e.g. highlighting text in the JD textarea shouldn't count). If the
  // user had manually selected the job description before clicking Grab,
  // that's a precise, deliberate signal — prefer it over the heuristic.
  var lastPageSelection = '';
  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) { return; }
    var anchorNode = sel.anchorNode;
    if (anchorNode && root.contains(anchorNode)) { return; } // ignore selections inside our own panel
    var text = String(sel).trim();
    if (text) { lastPageSelection = text; }
  });

  rt$('rt-grab').addEventListener('click', function() {
    if (lastPageSelection) {
      rt$('rt-jd').value = lastPageSelection;
      lastPageSelection = ''; // one-shot: don't keep reusing a stale selection on later clicks
      return;
    }
    var t = smartGrabJD();
    rt$('rt-jd').value = t || '';
    if (!t) { rt$('rt-jd').placeholder = "Couldn't isolate a job section — paste it in manually."; }
  });

  /* ============ Claude via proxy ============ */
  function callClaude(system, user, maxTok, callType) {
    if (!CFG.proxyUrl) { return Promise.reject(new Error('Set your Proxy URL in Settings first.')); }
    var url = CFG.proxyUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CFG.model, max_tokens: maxTok || 2500, system: system, messages: [{ role: 'user', content: user }],
        // Logging-only context for the Worker's D1 log — stripped before
        // the Worker forwards the request to Anthropic's actual API.
        call_type: callType || 'unknown', template: CFG.template
      })
    }).then(function(res) {
      if (!res.ok) {
        return res.text().then(function(detail) {
          throw new Error('API error ' + res.status + ' — ' + detail.slice(0, 300));
        }).catch(function(e) {
          if (e.message.indexOf('API error') === 0) { throw e; }
          throw new Error('API error ' + res.status);
        });
      }
      return res.json();
    }).then(function(data) {
      var text = (data.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
      var inputTokens = (data.usage && data.usage.input_tokens) || 0;
      var outputTokens = (data.usage && data.usage.output_tokens) || 0;
      recordRunCost(CFG.model, inputTokens, outputTokens);
      return {
        text: text,
        stopReason: data.stop_reason || null,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        maxTokensRequested: maxTok || 2500
      };
    });
  }

  // Per-million-token USD rates. Anthropic's published rates as of July 2026;
  // update here whenever pricing changes. Unrecognized models fall back to
  // the Sonnet rate as a reasonable middle-ground estimate rather than
  // silently showing nothing.
  var MODEL_RATES = {
    'claude-haiku-4-5-20251001': { input: 1, output: 5 },
    'claude-sonnet-4-6':         { input: 3, output: 15 },
    'claude-sonnet-5':           { input: 3, output: 15 },
    'claude-opus-4-6':           { input: 5, output: 25 },
    'claude-opus-4-7':           { input: 5, output: 25 },
    'claude-opus-4-8':           { input: 5, output: 25 },
    'claude-fable-5':            { input: 10, output: 50 }
  };
  var sessionCostTotal = 0;
  function estimateCost(model, inputTokens, outputTokens) {
    var rates = MODEL_RATES[model] || MODEL_RATES['claude-sonnet-4-6'];
    return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
  }
  function recordRunCost(model, inputTokens, outputTokens) {
    var cost = estimateCost(model, inputTokens, outputTokens);
    sessionCostTotal += cost;
    var el = rt$('rt-hdCost');
    if (!el) { return; } // header not yet built on very first call (shouldn't happen, but defensive)
    var totalTokens = inputTokens + outputTokens;
    el.textContent = '$' + sessionCostTotal.toFixed(3) + ' \u00B7 ' + totalTokens.toLocaleString() + ' tok (this run)';
    el.title = 'Session total: $' + sessionCostTotal.toFixed(3) + '. Last run: ' + inputTokens.toLocaleString() + ' in / ' + outputTokens.toLocaleString() + ' out. Estimated from published per-token rates \u2014 actual billing may vary slightly.';
  }
  // Builds a human-readable explanation for a JSON parse failure, using the
  // stop_reason/usage that came back with the response, instead of just
  // showing the raw "Expected ',' or ']'..." parser error.
  function describeParseFailure(parseError, meta) {
    if (meta && meta.stopReason === 'max_tokens') {
      return 'The response was cut off before it finished (used ' + meta.outputTokens + ' of ' + meta.maxTokensRequested + ' allowed tokens). This can happen with longer résumés or more verbose models. Try again \u2014 it often succeeds on a retry.';
    }
    return 'The response could not be read (' + parseError.message + '). This is usually temporary \u2014 try again.';
  }
  function parseJson(txt) {
    var s = txt.replace(/```json/g, '').replace(/```/g, '').trim();
    var a = s.indexOf('{');
    var b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { s = s.slice(a, b + 1); }
    return JSON.parse(s);
  }
  // Calls Claude and parses the JSON response, automatically retrying once
  // if parsing fails (truncated/malformed JSON is often a one-off — a
  // re-run frequently succeeds, which matches what re-running manually was
  // already accomplishing, just without the wasted round-trip back to you).
  // Other error types (bad proxy URL, network failure, HTTP error) are not
  // retried here, since a retry won't fix those.
  function callClaudeAndParse(system, user, maxTok, callType, isRetry) {
    return callClaude(system, user, maxTok, callType).then(function(result) {
      try {
        return parseJson(result.text);
      } catch (parseErr) {
        if (!isRetry) {
          // If we hit the token ceiling, retry with 50% more tokens rather
          // than the same limit — retrying identically is guaranteed to fail
          // the same way. For other parse failures, keep the same limit since
          // the issue is content formatting, not response length.
          var retryMax = (result.stopReason === 'max_tokens')
            ? Math.round(maxTok * 1.5)
            : maxTok;
          return callClaudeAndParse(system, user, retryMax, callType, true);
        }
        throw new Error(describeParseFailure(parseErr, result));
      }
    });
  }
  function capTokens(str, maxTok) {
    var maxChars = maxTok * 4;
    return str.length > maxChars ? str.slice(0, maxChars) + '\n[truncated]' : str;
  }
  function kbText() {
    var KB_MAX = 8000;
    var SUPP_MAX = 3000; // supplementary sources capped smaller since primary is what drives most content
    var sourceLabels = { pdf: 'PDF', gdoc: 'GOOGLE DOC', li: 'LINKEDIN' };
    var sourceTexts = { pdf: KB.pdfText || '', gdoc: KB.gdocText || '', li: KB.liText || '' };

    // Primary source becomes the résumé base. Others get included as
    // clearly labeled supplementary material so the model can pull
    // JD-relevant experience/skills the primary missed.
    var primaryKey = KB.primarySource;
    if (!primaryKey || !sourceTexts[primaryKey] || sourceTexts[primaryKey].trim().length < 100) {
      // Fallback: if no valid primary set (legacy KB or empty primary source),
      // pick the first non-empty source in the previous priority order.
      if (sourceTexts.gdoc.trim().length > 100) { primaryKey = 'gdoc'; }
      else if (sourceTexts.pdf.trim().length > 100) { primaryKey = 'pdf'; }
      else if (sourceTexts.li.trim().length > 100) { primaryKey = 'li'; }
    }

    var primary = '';
    if (primaryKey && sourceTexts[primaryKey]) {
      primary = '=== R\u00C9SUM\u00C9 (' + sourceLabels[primaryKey] + ' \u2014 PRIMARY, use as the base r\u00E9sum\u00E9) ===\n' + capTokens(sourceTexts[primaryKey], KB_MAX);
    }

    var supp = '';
    ['pdf', 'gdoc', 'li'].forEach(function(k) {
      if (k === primaryKey) { return; }
      var t = sourceTexts[k];
      if (t && t.trim().length > 100) {
        supp += '\n\n=== SUPPLEMENTARY (' + sourceLabels[k] + ') ===\n' + capTokens(t, SUPP_MAX);
      }
    });

    var out = '';
    if (KB.originalSummary && KB.originalSummary.trim()) {
      out += '=== ORIGINAL PROFILE/SUMMARY (use this as the base for the summary field \u2014 do not replace with LinkedIn text) ===\n' + KB.originalSummary.trim() + '\n\n';
    }
    out += primary;
    if (supp) {
      out += '\n\n[SUPPLEMENTARY SOURCES: the following are additional r\u00E9sum\u00E9 material the candidate has provided but not marked as primary. If the target job calls for a skill or experience that is not in the primary r\u00E9sum\u00E9 but is honestly documented in one of these supplementary sources, surface it as a bullet rewrite for the appropriate role or as a possible-addition suggestion, rather than asking a "Did you...?" question. Do not treat these as inferior sources \u2014 they are equally real, just not the primary structure.]';
      out += supp;
    }
    out += '\n\n';
    return out;
  }
  // Rough similarity check (word-overlap ratio) used to flag when the
  // assembled summary has drifted far from the candidate's original text.
  function summaryDriftRatio(original, generated) {
    if (!original || !original.trim()) { return 0; }
    var norm = function(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); };
    var a = norm(original), b = norm(generated || '');
    if (!a.length) { return 0; }
    var setA = {}; a.forEach(function(w) { setA[w] = true; });
    var overlap = 0;
    b.forEach(function(w) { if (setA[w]) { overlap++; } });
    return overlap / a.length; // fraction of original's words that reappear
  }
  function cleanJD(jd) { return capTokens(jd, 3000); }

  // Word-overlap similarity, case/punctuation-insensitive — used to catch
  // near-duplicate (not just byte-identical) highlight/bullet pairs, since
  // the model may reformat slightly while still repeating the same content.
  function textSimilarity(a, b) {
    var norm = function(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); };
    var wa = norm(a), wb = norm(b);
    if (!wa.length || !wb.length) { return 0; }
    var setA = {}; wa.forEach(function(w) { setA[w] = true; });
    var overlap = 0;
    wb.forEach(function(w) { if (setA[w]) { overlap++; } });
    return overlap / Math.max(wa.length, wb.length);
  }

  // Safety net for the HIGHLIGHT RULE in SYS_B: even with the prompt
  // instruction, the model can still repeat a role's highlight verbatim (or
  // near-verbatim) as the first bullet. Strip any bullet that's >=80%
  // word-overlap with that role's own highlight before rendering.
  function dedupeHighlightBullets(resume) {
    if (!resume || !Array.isArray(resume.experience)) { return; }
    resume.experience.forEach(function(job) {
      if (!job.highlight || !Array.isArray(job.bullets)) { return; }
      job.bullets = job.bullets.filter(function(b) {
        return textSimilarity(job.highlight, b) < 0.8;
      });
    });
  }

  var SYS_A = 'You are an expert r\u00E9sum\u00E9 editor and career coach. Tailor the r\u00E9sum\u00E9 to the job WITHOUT exaggerating or fabricating.\nRULES:\n1. Rewrites must be grounded in the candidate\'s existing material.\n2. New bullets must be phrased as "Did you \u2026?" questions, never asserted as fact.\n3. Keep the candidate\'s voice: clear, factual, achievement-oriented. No buzzwords.\n4. Title suggestions reframe the real role in the target role\'s language while preserving honest seniority signal.\n5. highlight: one crisp Signature win sentence per role for top 2-3 roles.\n6. condensed: set true for older/less relevant roles.\n7. allCompanies must list EVERY employer/company name you can identify anywhere in the candidate\'s materials, in reverse-chronological order \u2014 not just the ones referenced in titleSuggestions or bulletRewrites. This list is used to populate a company picker, so it must be complete even for roles that didn\'t get a suggestion this run.\n8. targetJobTitle: the exact job title from the TARGET JOB DESCRIPTION (e.g. "Senior Data Analyst"), used only for naming the exported file. If the posting has no clear single title, use an empty string \u2014 do not guess.\nOutput ONLY valid JSON. No markdown, no preamble.';
  var SYS_B = 'You are an expert r\u00E9sum\u00E9 editor. Assemble the FINAL tailored r\u00E9sum\u00E9 as structured JSON applying ONLY approved changes. Do not invent content. Preserve real employers, dates, education, metrics. Keep the voice factual and clean.\nSUMMARY RULE (important): The candidate\'s materials include an ORIGINAL SUMMARY/PROFILE field. Use that as your starting point and edit it minimally to tune emphasis toward the job \u2014 reorder or lightly reword, do not rewrite from scratch, do not pull in unrelated material from LinkedIn or other sources, do not pad with generic resume language. Target 2-3 sentences, hard cap 60 words. If no original summary exists in the materials, write a short one in the candidate\'s own voice from their real experience only.\nHIGHLIGHT RULE (important): For each role, "highlight" is a standalone callout, NOT a duplicate of any line in "bullets". If a role\'s best metric/achievement is the basis for the highlight, the matching bullet in "bullets" must either be removed (if it would be 100% redundant) or rewritten to cover different specifics not already stated in the highlight. Never let the highlight sentence and a bullet sentence repeat the same wording back to back.\nOutput ONLY valid JSON, no markdown.';

  /* ============ analyze ============ */
  rt$('rt-analyze').addEventListener('click', function() {
    var jd = rt$('rt-jd').value.trim();
    var errEl = rt$('rt-analyzeErr');
    var btn = rt$('rt-analyze');
    clearEl(errEl);
    if (!KB) { showErr(errEl, 'Set up your knowledge base first.'); return; }
    if (!jd) { showErr(errEl, 'Add the job description first.'); return; }
    btn.disabled = true;
    setBtnSpinner(btn, 'Analyzing\u2026');
    var user = 'CANDIDATE MATERIALS:\n' + kbText() + '\n\nTARGET JOB DESCRIPTION:\n' + cleanJD(jd) + '\n\nReturn JSON exactly:\n{\n  "allCompanies":["..."],\n  "targetJobTitle":"",\n  "titleSuggestions":[{"id":"t1","company":"","original":"","suggested":"","rationale":""}],\n  "bulletRewrites":[{"id":"b1","company":"","original":"","rewritten":"","rationale":""}],\n  "newBulletPrompts":[{"id":"n1","question":"Did you \u2026?","phrasingIfYes":"","rationale":""}],\n  "skills":{"prioritized":["..."],"toAdd":[{"skill":"","note":""}],"considerDropping":["..."]}\n}\nMax ~6 items per array except allCompanies, which must be complete. skills.prioritized = the candidate\'s real, JD-relevant skills, best first.';
    callClaudeAndParse(SYS_A, user, 4000, 'analyze').then(function(parsed) {
      ANALYSIS = parsed;
      renderReview();
      rt$('rt-reviewCard').classList.remove('hidden');
      rt$('rt-reviewCard').scrollIntoView({ behavior: 'smooth' });
    }).catch(function(e) {
      showErr(errEl, e.message);
    }).then(function() {
      btn.disabled = false;
      btn.textContent = 'Tailor my r\u00E9sum\u00E9';
    });
  });

  /* ============ review cards — createElement only, no innerHTML ============ */
  function mkChip(cls, act, extra, label) {
    var c = mk('span', { cls: 'chip' + (cls ? ' ' + cls : '') });
    c.textContent = label;
    c.dataset.act = act;
    Object.keys(extra).forEach(function(k) { c.dataset[k] = extra[k]; });
    return c;
  }
  // Segmented two-button choice: an approved-side (yesLabel) and a
  // skipped-side (noLabel), always both visible. Whichever is currently
  // selected renders solid; the other renders as a light outline. Clicking
  // either sets the state, no morphing labels. Consistent across title,
  // bullet, and new-bullet suggestions.
  function mkSegChoice(k, id, yesLabel, noLabel, initiallyApproved) {
    var seg = mk('div', { cls: 'seg' });
    var yes = mk('span', { cls: 'chip' + (initiallyApproved ? ' on-ok' : '') });
    yes.textContent = yesLabel;
    yes.dataset.act = 'seg-yes'; yes.dataset.k = k; yes.dataset.id = id;
    var no = mk('span', { cls: 'chip' + (initiallyApproved ? '' : ' on-skip') });
    no.textContent = noLabel;
    no.dataset.act = 'seg-no'; no.dataset.k = k; no.dataset.id = id;
    seg.appendChild(yes); seg.appendChild(no);
    return seg;
  }
  function mkRev(id, labelTxt, origTxt, inputEl, whyTxt) {
    var d = mk('div', { cls: 'rev', id: id });
    var lbl2 = mk('div', { cls: 'lbl' }); lbl2.textContent = labelTxt; d.appendChild(lbl2);
    if (origTxt) { var p = mk('p', { cls: 'orig' }); p.textContent = origTxt; d.appendChild(p); }
    if (inputEl) { d.appendChild(inputEl); }
    if (whyTxt) { var w = mk('p', { cls: 'why' }); w.textContent = whyTxt; d.appendChild(w); }
    return d;
  }
  function clearEl(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  // createElement-based replacements for the innerHTML error/spinner pattern,
  // so error messages and loading states render correctly even under a
  // strict TrustedHTML CSP (matches the "no innerHTML" rule used elsewhere).
  function showErr(el, msg) {
    clearEl(el);
    var d = mk('div', { cls: 'err' }); d.textContent = msg; el.appendChild(d);
  }
  function setBtnSpinner(btn, label) {
    clearEl(btn);
    var spin = mk('span', { cls: 'spin' }); btn.appendChild(spin);
    btn.appendChild(document.createTextNode(label));
  }

  function renderReview() {
    DECISIONS = { titles: {}, bullets: {}, news: {}, skills: { keep: new Set(), add: new Set() } };

    var titleSec = rt$('rt-titleSec');
    var bulletSec = rt$('rt-bulletSec');
    var newSec = rt$('rt-newSec');
    var skillSec = rt$('rt-skillSec');
    clearEl(titleSec); clearEl(bulletSec); clearEl(newSec); clearEl(skillSec);

    // Title adjustments
    var ts = ANALYSIS.titleSuggestions || [];
    if (ts.length) {
      var th = mk('div', { cls: 'sec-title' }); th.textContent = 'Title adjustments'; titleSec.appendChild(th);
      ts.forEach(function(t) {
        DECISIONS.titles[t.id] = { status: 'approved', text: t.suggested, original: t.original, company: t.company };
        var inp2 = mk('input', { type: 'text' }); inp2.value = t.suggested;
        inp2.dataset.edit = ''; inp2.dataset.k = 'titles'; inp2.dataset.id = t.id;
        var rev = mkRev('rev-titles-' + t.id, t.company || '', t.original, inp2, t.rationale || '');
        rev.appendChild(mkSegChoice('titles', t.id, 'Use', 'Skip', true));
        titleSec.appendChild(rev);
      });
    }

    // Bullet rewrites
    var bs = ANALYSIS.bulletRewrites || [];
    if (bs.length) {
      var bh = mk('div', { cls: 'sec-title' }); bh.textContent = 'Bullet rewrites'; bulletSec.appendChild(bh);
      bs.forEach(function(b) {
        DECISIONS.bullets[b.id] = { status: 'approved', text: b.rewritten, company: b.company };
        var ta2 = mk('textarea', { rows: '2' }); ta2.textContent = b.rewritten;
        ta2.dataset.edit = ''; ta2.dataset.k = 'bullets'; ta2.dataset.id = b.id;
        var rev = mkRev('rev-bullets-' + b.id, b.company || '', b.original, ta2, b.rationale || '');
        rev.appendChild(mkSegChoice('bullets', b.id, 'Approve', 'Skip', true));
        bulletSec.appendChild(rev);
      });
    }

    // New bullet prompts
    var ns = ANALYSIS.newBulletPrompts || [];
    // Prefer the model's full employer list (covers every real company in
    // the candidate's materials, not just ones with a suggestion this run).
    // Fall back to deriving from titleSuggestions/bulletRewrites/the prompts
    // themselves if allCompanies is missing for any reason.
    var companies = [];
    (ANALYSIS.allCompanies || []).forEach(function(c) { if (c && companies.indexOf(c) === -1) { companies.push(c); } });
    if (!companies.length) {
      (ANALYSIS.titleSuggestions || []).forEach(function(t) { if (t.company && companies.indexOf(t.company) === -1) { companies.push(t.company); } });
      (ANALYSIS.bulletRewrites || []).forEach(function(b) { if (b.company && companies.indexOf(b.company) === -1) { companies.push(b.company); } });
    }
    ns.forEach(function(n) { if (n.company && companies.indexOf(n.company) === -1) { companies.push(n.company); } });

    if (ns.length) {
      var nh = mk('div', { cls: 'sec-title' }); nh.textContent = 'Possible additions \u2014 only if true'; newSec.appendChild(nh);
      ns.forEach(function(n) {
        var defaultCo = n.company || (companies[0] || '');
        DECISIONS.news[n.id] = { status: 'skipped', text: n.phrasingIfYes, company: defaultCo };
        var ta2 = mk('textarea', { rows: '2' }); ta2.textContent = n.phrasingIfYes;
        ta2.dataset.edit = ''; ta2.dataset.k = 'news'; ta2.dataset.id = n.id;

        var coSel = mk('select'); coSel.style.cssText = 'margin-bottom:6px;font-size:12px';
        companies.forEach(function(co) {
          var opt = mk('option'); opt.value = co; opt.textContent = co;
          if (co === defaultCo) { opt.selected = true; }
          coSel.appendChild(opt);
        });
        if (defaultCo && companies.indexOf(defaultCo) === -1) {
          var opt2 = mk('option'); opt2.value = defaultCo; opt2.textContent = defaultCo; opt2.selected = true;
          coSel.insertBefore(opt2, coSel.firstChild);
        }
        coSel.addEventListener('change', function() { DECISIONS.news[n.id].company = coSel.value; });

        var rev = mkRev('rev-news-' + n.id, n.question, null, null, n.rationale || '');
        rev.classList.add('is-skip');
        rev.insertBefore(coSel, rev.querySelector('.why') || null);
        rev.insertBefore(ta2, rev.querySelector('.why') || null);
        rev.appendChild(mkSegChoice('news', n.id, 'Include', 'Skip', false));
        newSec.appendChild(rev);
      });
    }

    // Skills
    var sk = ANALYSIS.skills || {};
    (sk.prioritized || []).forEach(function(s) { DECISIONS.skills.keep.add(s); });
    var sh = mk('div', { cls: 'sec-title' }); sh.textContent = 'Skills \u2014 tap to toggle'; skillSec.appendChild(sh);
    var skillWrap = mk('div'); skillSec.appendChild(skillWrap);
    (sk.prioritized || []).forEach(function(s) {
      var sp = mk('span', { cls: 'skill on' }); sp.textContent = s;
      sp.dataset.act = 'skill'; sp.dataset.kind = 'keep'; sp.dataset.skill = s;
      skillWrap.appendChild(sp);
    });
    (sk.toAdd || []).forEach(function(o) {
      var sp = mk('span', { cls: 'skill add' }); sp.textContent = '+ ' + o.skill; sp.title = o.note || '';
      sp.dataset.act = 'skill'; sp.dataset.kind = 'add'; sp.dataset.skill = o.skill;
      skillWrap.appendChild(sp);
    });
    if ((sk.considerDropping || []).length) {
      var dn = mk('p', { cls: 'note' }); dn.textContent = 'Suggested to drop: ' + sk.considerDropping.join(', ');
      skillSec.appendChild(dn);
    }

    var customRow = mk('div'); customRow.style.cssText = 'display:flex;gap:6px;margin-top:10px';
    var customInp = mk('input', { type: 'text', placeholder: 'Add a skill\u2026' }); customInp.style.cssText = 'flex:1;font-size:12px;padding:6px 9px;border:1px solid #e6e8ee;border-radius:7px';
    var customBtn = mk('button', { cls: 'btn ghost' }); customBtn.textContent = '+ Add'; customBtn.style.cssText = 'padding:6px 11px;font-size:12px;white-space:nowrap';
    customBtn.addEventListener('click', function() {
      var val = customInp.value.trim();
      if (!val) { return; }
      if (DECISIONS.skills.add.has(val) || DECISIONS.skills.keep.has(val)) { customInp.value = ''; return; }
      DECISIONS.skills.add.add(val);
      var sp = mk('span', { cls: 'skill add on' }); sp.textContent = val;
      sp.dataset.act = 'skill'; sp.dataset.kind = 'add'; sp.dataset.skill = val;
      skillWrap.appendChild(sp);
      customInp.value = '';
    });
    customInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { customBtn.click(); } });
    customRow.appendChild(customInp); customRow.appendChild(customBtn);
    skillSec.appendChild(customRow);
  }

  root.addEventListener('click', function(e) {
    var t = e.target.closest('[data-act]');
    if (!t) { return; }
    var act = t.dataset.act;
    if (act === 'seg-yes' || act === 'seg-no') {
      var k = t.dataset.k, id = t.dataset.id;
      var d = DECISIONS[k][id];
      var rev = root.querySelector('#rev-' + k + '-' + id);
      var seg = t.parentNode;
      var chips = seg.querySelectorAll('.chip');
      if (act === 'seg-yes') {
        d.status = 'approved';
        chips[0].className = 'chip on-ok';
        chips[1].className = 'chip';
        rev.classList.remove('is-skip');
      } else {
        d.status = 'skipped';
        chips[0].className = 'chip';
        chips[1].className = 'chip on-skip';
        rev.classList.add('is-skip');
      }
    } else if (act === 'skill') {
      var sset = DECISIONS.skills[t.dataset.kind];
      var sv = t.dataset.skill;
      if (sset.has(sv)) { sset.delete(sv); t.classList.remove('on'); }
      else { sset.add(sv); t.classList.add('on'); }
    }
  });
  root.addEventListener('input', function(e) {
    var t = e.target;
    if (t.dataset && t.dataset.edit !== undefined) { DECISIONS[t.dataset.k][t.dataset.id].text = t.value; }
  });

  /* ============ assemble ============ */
  rt$('rt-assemble').addEventListener('click', function() {
    var btn = rt$('rt-assemble');
    var errEl = rt$('rt-assembleErr');
    clearEl(errEl);
    btn.disabled = true;
    setBtnSpinner(btn, 'Building\u2026');
    var titles = Object.values(DECISIONS.titles).filter(function(d) { return d.status === 'approved'; }).map(function(d) { return { company: d.company, original: d.original, use: d.text }; });
    var bullets = Object.values(DECISIONS.bullets).filter(function(d) { return d.status === 'approved'; }).map(function(d) { return { company: d.company, text: d.text }; });
    var news = Object.values(DECISIONS.news).filter(function(d) { return d.status === 'approved'; }).map(function(d) { return d.text; });
    var skills = Array.from(DECISIONS.skills.keep).concat(Array.from(DECISIONS.skills.add));
    var user = 'ORIGINAL MATERIALS:\n' + kbText() + '\nAPPROVED TITLE CHANGES: ' + JSON.stringify(titles) + '\nAPPROVED REWRITTEN BULLETS: ' + JSON.stringify(bullets) + '\nAPPROVED NEW BULLETS: ' + JSON.stringify(news) + '\nFINAL SKILLS: ' + JSON.stringify(skills) + '\n\nBuild the complete r\u00E9sum\u00E9. Use approved titles \u2014 apply them to matching roles whether the role is condensed or not (a condensed row still shows the title, just without bullets). Place rewritten/new bullets in correct roles; keep other real bullets.\nFor top 2-3 roles set highlight to best single measurable Signature Win sentence.\nFor older/less relevant roles set condensed:true and omit bullets, but still apply any approved title change for that role.\nReturn JSON exactly:\n{"name":"","tagline":"short italic descriptor","contact":"City, ST \u00B7 phone \u00B7 email \u00B7 linkedin","summary":"2-3 factual sentences tuned to the job","experience":[{"title":"","company":"","location":"","dates":"","highlight":"","condensed":false,"bullets":[""]}],"skills":[""],"education":[{"degree":"","sub":""}],"certifications":[""]}';
    callClaudeAndParse(SYS_B, user, 6000, 'assemble').then(function(parsed) {
      LAST_RESUME = parsed;
      dedupeHighlightBullets(LAST_RESUME);
      var previewEl = rt$('rt-preview');
      clearEl(previewEl);

      var driftWarn = rt$('rt-driftWarn');
      clearEl(driftWarn);
      var origSummary = (KB && KB.originalSummary || '').trim();
      if (origSummary) {
        var ratio = summaryDriftRatio(origSummary, LAST_RESUME.summary || '');
        if (ratio < 0.35) {
          var banner = mk('div', { cls: 'banner' });
          var bIcon = document.createTextNode('\u26A0\uFE0F ');
          var bInner = mk('div');
          var bB = mk('b'); bB.textContent = 'Profile drifted from your original.';
          bInner.appendChild(bB);
          bInner.appendChild(document.createTextNode(' The generated summary shares little wording with what you saved in Knowledge base \u00B7 4. '));
          var revertBtn = mk('button', { cls: 'btn ghost' }); revertBtn.textContent = 'Use my original instead'; revertBtn.style.cssText = 'margin-top:6px;padding:5px 10px;font-size:11.5px';
          revertBtn.addEventListener('click', function() {
            LAST_RESUME.summary = origSummary;
            var previewEl2 = rt$('rt-preview');
            clearEl(previewEl2);
            previewEl2.appendChild(buildPreviewFrame(LAST_RESUME));
            rt$('rt-ats').value = atsText(LAST_RESUME);
            clearEl(driftWarn);
          });
          bInner.appendChild(document.createElement('br'));
          bInner.appendChild(revertBtn);
          banner.appendChild(bIcon);
          banner.appendChild(bInner);
          driftWarn.appendChild(banner);
        }
      }

      previewEl.appendChild(buildPreviewFrame(LAST_RESUME));
      rt$('rt-ats').value = atsText(LAST_RESUME);
      var activeTpl = TEMPLATES[CFG.template] || TEMPLATES.editorial;
      rt$('rt-outputDesc').textContent = 'PDF is your ' + activeTpl.label + ' formatted version. ATS is plain text for job portals.';
      rt$('rt-outputCard').classList.remove('hidden');
      rt$('rt-outputCard').scrollIntoView({ behavior: 'smooth' });
    }).catch(function(e) {
      showErr(errEl, e.message);
    }).then(function() {
      btn.disabled = false;
      btn.textContent = 'Build my r\u00E9sum\u00E9 \u2192';
    });
  });

  /* ============ preview — renders the SAME HTML the active template's
     builder produces for Export/Copy HTML, inside a sandboxed iframe via
     srcdoc. This guarantees the inline preview can never drift out of sync
     with what actually gets exported, since there is only one HTML string
     per template, not a second hand-built look-alike. ============ */
  function buildPreviewFrame(r) {
    var html = activeTemplateBuild()(r);
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', ''); // no scripts, no same-origin — pure static render
    frame.srcdoc = html;
    return frame;
  }

  /* ============ Shared experience-block builder ============
     Each template's role markup differs slightly (different ki wrapper,
     different bullet marker), so each template supplies a roleRenderer
     function; this just handles the common split into full vs condensed
     rows and the optional "Earlier Experience" section. */
  function buildExperienceParts(r, roleRenderer, sectionHeaderHtml) {
    var expHTML = (r.experience || []).map(function(j) {
      if (j.condensed) { return '<div class="earlier-row"><span>' + esc(j.title) + ' &middot; ' + esc(j.company) + '</span><span>' + esc(j.dates) + '</span></div>'; }
      return roleRenderer(j);
    });
    var fullRoles = expHTML.filter(function(h, i) { return !(r.experience[i] || {}).condensed; }).join('\n');
    var earlierRows = expHTML.filter(function(h, i) { return !!(r.experience[i] || {}).condensed; }).join('\n');
    var hasEarlier = earlierRows.length > 0;
    var earlierSection = hasEarlier ? '\n    ' + sectionHeaderHtml + '\n    ' + earlierRows : '';
    return { fullRoles: fullRoles, earlierSection: earlierSection };
  }

  /* ============ Editorial Warmth PDF — script-free, matches the reference
     template exactly. No paged.js: relies on the browser's native print-to-PDF
     against a CSS Paged Media @page rule. Print is triggered from the
     userscript's own context (see rt-export handler) rather than from inside
     the exported document, so no inline <script> ever needs to execute in the
     blob — this is what makes it work under LinkedIn's strict-dynamic CSP. ============ */
  function buildEditorialHTML(r) {
    var expHTML = (r.experience || []).map(function(j) {
      if (j.condensed) { return '<div class="earlier-row"><span>' + esc(j.title) + ' &middot; ' + esc(j.company) + '</span><span>' + esc(j.dates) + '</span></div>'; }
      var ki = j.highlight ? '<div class="ki"><div class="ki-label">Signature win</div><div class="ki-text">' + esc(j.highlight) + '</div></div>' : '';
      var lis = (j.bullets || []).map(function(b) { return '<li>' + esc(b) + '</li>'; }).join('');
      return '<div class="role"><div class="role-top"><span class="role-title">' + esc(j.title) + '</span><span class="role-dates">' + esc(j.dates) + '</span></div><div class="role-co">' + esc(j.company) + '</div>' + ki + '<ul>' + lis + '</ul></div>';
    });
    var fullRoles = expHTML.filter(function(h, i) { return !(r.experience[i] || {}).condensed; }).join('\n');
    var earlierRows = expHTML.filter(function(h, i) { return !!(r.experience[i] || {}).condensed; }).join('\n');
    var hasEarlier = earlierRows.length > 0;
    var earlierSection = hasEarlier ? '\n    <div class="section-h" style="margin-top:14px;">Earlier Experience</div>\n    ' + earlierRows : '';
    var skillsStr = (r.skills || []).map(esc).join(' &middot; ');
    var eduHTML = (r.education || []).map(function(e) { return '<div class="edu-deg">' + esc(e.degree || '') + '</div><div class="edu-sub">' + esc(e.sub || '') + '</div>'; }).join('');
    var certHTML = (r.certifications || []).map(esc).join('<br>');
    var contactHtml = esc(r.contact || '').replace(/ \u00B7 /g, ' &nbsp;&middot;&nbsp; ').replace(/\n/g, '<br>');

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Poppins:wght@300;400;500;600&display=swap">\n<style>\n' +
      '@page{size:Letter;margin:0 0 0.34in 0;@bottom-right{content:"' + esc(r.name || '') + '  \u00B7 " counter(page) " / " counter(pages);font-family:\'Poppins\',sans-serif;font-size:7pt;color:#b3a48f;padding-right:0.55in}}\n' +
      'html{background:#faf8f4}\n' +
      '*{margin:0;padding:0;box-sizing:border-box}\n' +
      'body{font-family:\'Poppins\',\'DejaVu Sans\',sans-serif;color:#2d2926;font-size:9.3pt;line-height:1.4;position:relative}\n' +
      '.header{padding:0.5in 0.55in 0.16in 0.55in}\n' +
      '.name{font-family:\'Lora\',serif;font-size:27pt;font-weight:600;letter-spacing:0.5px;color:#2d2926;line-height:1}\n' +
      '.tagline-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:7px;border-bottom:1.5px solid #bb4d22;padding-bottom:7px}\n' +
      '.tagline{font-family:\'Lora\',serif;font-style:italic;font-size:11pt;color:#9a3d1c}\n' +
      '.contact{font-size:8pt;color:#6b6258;text-align:right;line-height:1.5}\n' +
      '.main{margin-right:36%;padding:0.14in 0 0.5in 0.55in}\n' +
      '.section-h{font-family:\'Lora\',serif;font-size:12pt;font-weight:600;color:#2d2926;border-bottom:1px solid #d8a282;padding-bottom:3px;margin-bottom:9px}\n' +
      '.role{margin-bottom:11px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.role-top{display:flex;justify-content:space-between;align-items:baseline}\n' +
      '.role-title{font-size:10pt;font-weight:500;color:#2d2926}\n' +
      '.role-dates{font-size:8pt;color:#8a8278;white-space:nowrap;padding-left:8px}\n' +
      '.role-co{font-family:\'Lora\',serif;font-style:italic;font-size:9.5pt;color:#9a3d1c;margin-top:1px}\n' +
      '.ki{border-left:2.5px solid #bb4d22;padding:1px 0 1px 9px;margin:6px 0 5px 0;break-inside:avoid;page-break-inside:avoid}\n' +
      '.ki-label{font-size:6.5pt;font-weight:500;letter-spacing:1.2px;color:#bb4d22;text-transform:uppercase}\n' +
      '.ki-text{font-family:\'Lora\',serif;font-style:italic;font-size:9.5pt;font-weight:500;color:#8a3417;line-height:1.35}\n' +
      'ul{list-style:none;margin-top:3px}\n' +
      'li{position:relative;padding-left:11px;margin-bottom:2.5px;color:#4a443d;font-size:9pt;line-height:1.36}\n' +
      'li::before{content:"";position:absolute;left:0;top:6px;width:3.5px;height:3.5px;background:#c9a07f;border-radius:50%}\n' +
      '.earlier-row{display:flex;justify-content:space-between;font-size:8.7pt;padding:2.5px 0;border-bottom:0.5px solid #e7dccb;color:#4a443d;break-inside:avoid;page-break-inside:avoid}\n' +
      '.earlier-row span:last-child{color:#8a8278;white-space:nowrap;padding-left:8px}\n' +
      '.sidebar{position:absolute;top:1.5in;right:0;width:34%;min-height:9in;background:#ece2d0;padding:0.28in 0.5in 0.4in 0.42in}\n' +
      '.side-h{font-family:\'Lora\',serif;font-size:11pt;font-weight:600;color:#2d2926;margin-bottom:6px}\n' +
      '.side-block{margin-bottom:16px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.side-text{font-size:8.7pt;color:#4a443d;line-height:1.5}\n' +
      '.skill-cat{font-size:8pt;font-weight:500;color:#8a3417;margin:7px 0 2px 0}\n' +
      '.edu-deg{font-size:9pt;font-weight:500;color:#2d2926}\n' +
      '.edu-sub{font-size:8.3pt;color:#6b6258;line-height:1.45}\n' +
      '.cert{font-size:8.5pt;color:#4a443d;line-height:1.7}\n' +
      '</style>\n</head>\n<body>\n\n' +
      '  <div class="header">\n    <div class="name">' + esc(r.name || '') + '</div>\n    <div class="tagline-row">\n      <div class="tagline">' + esc(r.tagline || '') + '</div>\n      <div class="contact">' + contactHtml + '</div>\n    </div>\n  </div>\n\n' +
      '  <div class="sidebar">\n    <div class="side-block">\n      <div class="side-h">Profile</div>\n      <div class="side-text">' + esc(r.summary || '') + '</div>\n    </div>\n\n' +
      '    <div class="side-block">\n      <div class="side-h">Skills</div>\n      <div class="side-text">' + skillsStr + '</div>\n    </div>\n\n' +
      '    <div class="side-block">\n      <div class="side-h">Education</div>\n      ' + eduHTML + '\n    </div>\n\n' +
      (certHTML ? '    <div class="side-block">\n      <div class="side-h">Certifications</div>\n      <div class="cert">' + certHTML + '</div>\n    </div>\n' : '') +
      '  </div>\n\n' +
      '  <div class="main">\n    <div class="section-h">Experience</div>\n\n    ' + fullRoles + earlierSection + '\n  </div>\n\n' +
      '</body>\n</html>';
  }

  /* ============ Slate Professional — dark sidebar, amber accents.
     Matches style1_slate_professional_template.html exactly. ============ */
  function buildSlateHTML(r) {
    var roleRenderer = function(j) {
      var ki = j.highlight ? '<div class="ki"><div class="ki-label">Signature win</div><div class="ki-text">' + esc(j.highlight) + '</div></div>' : '';
      var lis = (j.bullets || []).map(function(b) { return '<li>' + esc(b) + '</li>'; }).join('');
      return '<div class="role"><div class="role-top"><span class="role-title">' + esc(j.title) + '</span><span class="role-dates">' + esc(j.dates) + '</span></div><div class="role-co">' + esc(j.company) + '</div>' + ki + '<ul>' + lis + '</ul></div>';
    };
    var parts = buildExperienceParts(r, roleRenderer, '<div class="section-h" style="margin-top:6px;">Earlier Experience</div>');
    var skillsStr = (r.skills || []).map(esc).join(' &middot; ');
    var eduHTML = (r.education || []).map(function(e) { return '<div class="edu-deg">' + esc(e.degree || '') + '</div><div class="edu-sub">' + esc(e.sub || '') + '</div>'; }).join('');
    var certHTML = (r.certifications || []).map(esc).join('<br>');
    var contactLines = esc(r.contact || '').split(/ \u00B7 |\n/).filter(Boolean).map(function(line) { return '<div>' + line + '</div>'; }).join('');

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n' +
      '@page{size:Letter;margin:0}\n' +
      '*{margin:0;padding:0;box-sizing:border-box}\n' +
      'html,body{font-family:-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#2C2C2A;background:#ffffff}\n' +
      'body{font-size:9.3pt;line-height:1.42;position:relative}\n' +
      '.page{display:flex;min-height:11in}\n' +
      '.sidebar{width:36%;background:#25303f;color:#cbd5e1;padding:0.5in 0.34in 0.5in 0.45in;min-height:11in}\n' +
      '.name{font-size:21pt;font-weight:600;color:#ffffff;letter-spacing:1.5px;line-height:1.15}\n' +
      '.tagline{font-size:9.5pt;color:#EF9F27;margin:6px 0 20px;letter-spacing:0.4px}\n' +
      '.contact-block{font-size:9pt;line-height:2;margin-bottom:6px}\n' +
      '.contact-block div{color:#e2e8f0}\n' +
      '.side-h{font-size:9.5pt;font-weight:600;color:#EF9F27;letter-spacing:1.8px;text-transform:uppercase;margin:20px 0 7px}\n' +
      '.side-block:first-of-type .side-h{margin-top:22px}\n' +
      '.side-block{break-inside:avoid;page-break-inside:avoid}\n' +
      '.side-text{font-size:9pt;line-height:1.7;color:#e2e8f0}\n' +
      '.skill-cat{font-size:8.3pt;font-weight:600;color:#f5c97a;margin:10px 0 3px}\n' +
      '.edu-deg{font-size:9pt;font-weight:600;color:#ffffff}\n' +
      '.edu-sub{font-size:8.6pt;line-height:1.55;color:#94a3b8;margin-top:2px}\n' +
      '.cert-list{font-size:8.8pt;line-height:1.75;color:#e2e8f0}\n' +
      '.main{width:64%;padding:0.5in 0.55in 0.5in 0.5in}\n' +
      '.section-h{font-size:11pt;font-weight:700;color:#25303f;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #EF9F27;padding-bottom:6px;margin-bottom:10px}\n' +
      '.profile-text{font-size:9.5pt;line-height:1.6;color:#444441;margin:0 0 20px}\n' +
      '.role{margin-bottom:13px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.role-top{display:flex;justify-content:space-between;align-items:baseline}\n' +
      '.role-title{font-size:10.5pt;font-weight:700;color:#1a1a1a}\n' +
      '.role-dates{font-size:8.3pt;color:#888780;white-space:nowrap;padding-left:8px}\n' +
      '.role-co{font-size:9.5pt;color:#BA7517;font-weight:600;margin-top:1px}\n' +
      '.ki{background:#FAEEDA;border-left:3px solid #EF9F27;padding:7px 10px;margin:8px 0;break-inside:avoid;page-break-inside:avoid}\n' +
      '.ki-label{font-size:7pt;font-weight:700;color:#854F0B;letter-spacing:1.1px;text-transform:uppercase}\n' +
      '.ki-text{font-size:9.3pt;color:#633806;font-weight:600;line-height:1.4;margin-top:1px}\n' +
      'ul{list-style:none;margin-top:6px}\n' +
      'li{position:relative;padding-left:13px;margin-bottom:3px;color:#444441;font-size:9pt;line-height:1.4}\n' +
      'li::before{content:"\u2013";position:absolute;left:0;top:0;color:#EF9F27;font-weight:700}\n' +
      '.earlier-row{display:flex;justify-content:space-between;font-size:8.7pt;padding:3px 0;border-bottom:0.5px solid #e2e0d8;color:#444441;break-inside:avoid;page-break-inside:avoid}\n' +
      '.earlier-row span:last-child{color:#888780;white-space:nowrap;padding-left:8px}\n' +
      '</style>\n</head>\n<body>\n\n<div class="page">\n\n' +
      '  <div class="sidebar">\n    <div class="name">' + esc(r.name || '') + '</div>\n    <div class="tagline">' + esc(r.tagline || '') + '</div>\n\n' +
      '    <div class="contact-block">' + contactLines + '</div>\n\n' +
      '    <div class="side-block">\n      <div class="side-h">Skills</div>\n      <div class="side-text">' + skillsStr + '</div>\n    </div>\n\n' +
      '    <div class="side-block">\n      <div class="side-h">Education</div>\n      ' + eduHTML + '\n    </div>\n\n' +
      (certHTML ? '    <div class="side-block">\n      <div class="side-h">Certifications</div>\n      <div class="cert-list">' + certHTML + '</div>\n    </div>\n' : '') +
      '  </div>\n\n' +
      '  <div class="main">\n    <div class="section-h">Profile</div>\n    <div class="profile-text">' + esc(r.summary || '') + '</div>\n\n' +
      '    <div class="section-h">Experience</div>\n\n    ' + parts.fullRoles + parts.earlierSection + '\n  </div>\n\n' +
      '</div>\n\n</body>\n</html>';
  }

  /* ============ Engineering Blueprint — teal top rule, mono labels.
     Matches style2_engineering_blueprint_template.html exactly. ============ */
  function buildBlueprintHTML(r) {
    var roleRenderer = function(j) {
      var ki = j.highlight ? '<div class="ki-row"><span class="ki-chip mono">SIGNATURE WIN</span><span class="ki-text">' + esc(j.highlight) + '</span></div>' : '';
      var lis = (j.bullets || []).map(function(b) { return '<li>' + esc(b) + '</li>'; }).join('');
      return '<div class="role"><div class="role-top"><span class="role-title">' + esc(j.title) + '</span><span class="role-dates mono">' + esc(j.dates) + '</span></div><div class="role-co">' + esc(j.company) + '</div>' + ki + '<ul>' + lis + '</ul></div>';
    };
    var earlierHeader = '<div class="section-h mono" style="margin-top:4px;">// EARLIER EXPERIENCE</div>';
    var expHTML = (r.experience || []).map(function(j) {
      if (j.condensed) { return '<div class="earlier-row"><span>' + esc(j.title) + ' &middot; ' + esc(j.company) + '</span><span class="mono">' + esc(j.dates) + '</span></div>'; }
      return roleRenderer(j);
    });
    var fullRoles = expHTML.filter(function(h, i) { return !(r.experience[i] || {}).condensed; }).join('\n');
    var earlierRows = expHTML.filter(function(h, i) { return !!(r.experience[i] || {}).condensed; }).join('\n');
    var earlierSection = earlierRows.length ? '\n    ' + earlierHeader + '\n    ' + earlierRows : '';
    var skillsStr = (r.skills || []).map(esc).join(' &middot; ');
    var eduHTML = (r.education || []).map(function(e) { return '<div class="edu-deg">' + esc(e.degree || '') + '</div><div class="edu-sub">' + esc(e.sub || '') + '</div>'; }).join('');
    var certHTML = (r.certifications || []).map(esc).join('<br>');
    var contactParts = esc(r.contact || '').split(/ \u00B7 |\n/).filter(Boolean).map(function(p) { return '<span>' + p + '</span>'; }).join('');

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n' +
      '@page{size:Letter;margin:0}\n' +
      '*{margin:0;padding:0;box-sizing:border-box}\n' +
      'html,body{font-family:-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#1a1a1a;background:#ffffff}\n' +
      'body{font-size:9.3pt;line-height:1.42}\n' +
      '.mono{font-family:\'SFMono-Regular\',Consolas,\'DejaVu Sans Mono\',monospace}\n' +
      '.top-rule{height:4px;background:#0F6E56;width:100%}\n' +
      '.header{padding:0.32in 0.55in 0.18in 0.55in}\n' +
      '.name{font-size:22pt;font-weight:700;color:#1a1a1a;letter-spacing:0.5px}\n' +
      '.contact-row{display:flex;gap:18px;font-size:8.6pt;color:#5F5E5A;margin-top:6px}\n' +
      '.page-body{display:flex;border-top:0.5px solid #e2e2dd}\n' +
      '.sidebar{width:36%;background:#F1EFE8;border-right:0.5px solid #d8d6cd;padding:0.3in 0.4in 0.5in 0.55in}\n' +
      '.side-h{font-size:8.6pt;font-weight:700;color:#0F6E56;letter-spacing:1px;margin-bottom:7px}\n' +
      '.side-block{margin-bottom:18px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.side-text{font-size:9pt;line-height:1.75;color:#444441}\n' +
      '.skill-cat{font-size:8.3pt;font-weight:700;color:#0F6E56;margin:9px 0 3px}\n' +
      '.edu-deg{font-size:9.3pt;font-weight:600;color:#1a1a1a}\n' +
      '.edu-sub{font-size:8.6pt;line-height:1.5;color:#888780;margin-top:2px}\n' +
      '.cert-list{font-size:8.8pt;line-height:1.75;color:#444441}\n' +
      '.main{width:64%;padding:0.3in 0.55in 0.5in 0.45in}\n' +
      '.section-h{font-size:8.6pt;font-weight:700;color:#0F6E56;letter-spacing:1px;margin-bottom:8px}\n' +
      '.profile-text{font-size:9.5pt;line-height:1.6;color:#444441;margin:0 0 18px}\n' +
      '.role{margin-bottom:13px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.role-top{display:flex;justify-content:space-between;align-items:baseline}\n' +
      '.role-title{font-size:10.3pt;font-weight:700;color:#1a1a1a}\n' +
      '.role-dates{font-size:8pt;color:#888780;white-space:nowrap;padding-left:8px;letter-spacing:0.4px}\n' +
      '.role-co{font-size:9.5pt;color:#0F6E56;font-weight:600;margin-top:1px}\n' +
      '.ki-row{display:flex;align-items:flex-start;gap:8px;margin:9px 0;break-inside:avoid;page-break-inside:avoid}\n' +
      '.ki-chip{font-size:7.3pt;font-weight:700;color:#0F6E56;background:#E1F5EE;padding:3px 7px;border-radius:3px;white-space:nowrap;letter-spacing:0.5px;flex-shrink:0}\n' +
      '.ki-text{font-size:9.3pt;color:#0F6E56;font-weight:600;line-height:1.4}\n' +
      'ul{list-style:none;margin-top:6px}\n' +
      'li{position:relative;padding-left:13px;margin-bottom:3px;color:#444441;font-size:9pt;line-height:1.4}\n' +
      'li::before{content:"\u2192";position:absolute;left:0;top:0;color:#0F6E56;font-size:8pt}\n' +
      '.earlier-row{display:flex;justify-content:space-between;font-size:8.7pt;padding:3px 0;border-bottom:0.5px solid #e2e2dd;color:#444441;break-inside:avoid;page-break-inside:avoid}\n' +
      '.earlier-row span:last-child{color:#888780;white-space:nowrap;padding-left:8px}\n' +
      '</style>\n</head>\n<body>\n\n<div class="top-rule"></div>\n\n' +
      '<div class="header">\n  <div class="name">' + esc(r.name || '') + '</div>\n  <div class="contact-row mono">' + contactParts + '</div>\n</div>\n\n' +
      '<div class="page-body">\n\n' +
      '  <div class="sidebar">\n    <div class="side-block">\n      <div class="side-h mono">// SKILLS</div>\n      <div class="side-text">' + skillsStr + '</div>\n    </div>\n\n' +
      '    <div class="side-block">\n      <div class="side-h mono">// EDUCATION</div>\n      ' + eduHTML + '\n    </div>\n\n' +
      (certHTML ? '    <div class="side-block">\n      <div class="side-h mono">// CERTIFICATIONS</div>\n      <div class="cert-list">' + certHTML + '</div>\n    </div>\n' : '') +
      '  </div>\n\n' +
      '  <div class="main">\n    <div class="section-h mono">// PROFILE</div>\n    <div class="profile-text">' + esc(r.summary || '') + '</div>\n\n' +
      '    <div class="section-h mono">// EXPERIENCE</div>\n\n    ' + fullRoles + earlierSection + '\n  </div>\n\n' +
      '</div>\n\n</body>\n</html>';
  }

  /* ============ Bold Data-Forward — deep-blue header band, filled callouts.
     Matches style4_bold_data_forward_template.html exactly. ============ */
  function buildBoldHTML(r) {
    var roleRenderer = function(j) {
      var ki = j.highlight ? '<div class="ki"><div class="ki-label">Signature win</div><div class="ki-text">' + esc(j.highlight) + '</div></div>' : '';
      var lis = (j.bullets || []).map(function(b) { return '<li>' + esc(b) + '</li>'; }).join('');
      return '<div class="role"><div class="role-top"><span class="role-title">' + esc(j.title) + '</span><span class="role-dates">' + esc(j.dates) + '</span></div><div class="role-co">' + esc(j.company) + '</div>' + ki + '<ul>' + lis + '</ul></div>';
    };
    var parts = buildExperienceParts(r, roleRenderer, '<div class="section-h" style="margin-top:4px;">EARLIER EXPERIENCE</div>');
    var skillsStr = (r.skills || []).map(esc).join(' &middot; ');
    var eduHTML = (r.education || []).map(function(e) { return '<div class="edu-deg">' + esc(e.degree || '') + '</div><div class="edu-sub">' + esc(e.sub || '') + '</div>'; }).join('');
    var certHTML = (r.certifications || []).map(esc).join('<br>');
    var contactStr = esc(r.contact || '').replace(/\n/g, ' &middot; ');

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n' +
      '@page{size:Letter;margin:0}\n' +
      '*{margin:0;padding:0;box-sizing:border-box}\n' +
      'html,body{font-family:-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#1a1a1a;background:#ffffff}\n' +
      'body{font-size:9.3pt;line-height:1.42}\n' +
      '.header-band{background:#0C447C;padding:0.42in 0.55in 0.3in 0.55in}\n' +
      '.name{font-size:24pt;font-weight:700;color:#ffffff;letter-spacing:0.5px}\n' +
      '.tagline-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;flex-wrap:wrap;gap:8px}\n' +
      '.tagline{font-size:10pt;color:#B5D4F4;font-weight:600}\n' +
      '.contact{font-size:8.4pt;color:#85B7EB}\n' +
      '.page-body{display:flex}\n' +
      '.sidebar{width:35%;padding:0.32in 0.4in 0.5in 0.55in}\n' +
      '.side-h{font-size:8.8pt;font-weight:700;color:#0C447C;letter-spacing:1px;margin-bottom:7px}\n' +
      '.side-block{margin-bottom:18px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.side-text{font-size:9pt;line-height:1.7;color:#444441}\n' +
      '.skill-cat{font-size:8.3pt;font-weight:700;color:#185FA5;margin:9px 0 3px}\n' +
      '.edu-deg{font-size:9.3pt;font-weight:600;color:#1a1a1a}\n' +
      '.edu-sub{font-size:8.6pt;line-height:1.5;color:#888780;margin-top:2px}\n' +
      '.cert-list{font-size:8.8pt;line-height:1.75;color:#444441}\n' +
      '.main{width:65%;padding:0.32in 0.55in 0.5in 0.4in}\n' +
      '.section-h{font-size:8.8pt;font-weight:700;color:#0C447C;letter-spacing:1px;margin-bottom:11px}\n' +
      '.role{margin-bottom:14px;break-inside:avoid;page-break-inside:avoid}\n' +
      '.role-top{display:flex;justify-content:space-between;align-items:baseline}\n' +
      '.role-title{font-size:10.3pt;font-weight:700;color:#1a1a1a}\n' +
      '.role-dates{font-size:8pt;color:#888780;white-space:nowrap;padding-left:8px}\n' +
      '.role-co{font-size:9.5pt;color:#185FA5;font-weight:600;margin-top:1px}\n' +
      '.ki{background:#E6F1FB;border-radius:4px;padding:8px 11px;margin:8px 0;break-inside:avoid;page-break-inside:avoid}\n' +
      '.ki-label{font-size:7pt;font-weight:700;color:#185FA5;letter-spacing:1px;text-transform:uppercase}\n' +
      '.ki-text{font-size:9.3pt;color:#0C447C;font-weight:700;line-height:1.4;margin-top:1px}\n' +
      'ul{list-style:none;margin-top:6px}\n' +
      'li{position:relative;padding-left:13px;margin-bottom:3px;color:#444441;font-size:9pt;line-height:1.4}\n' +
      'li::before{content:"\u25AA";position:absolute;left:0;top:3px;color:#185FA5;font-size:7pt}\n' +
      '.earlier-row{display:flex;justify-content:space-between;font-size:8.7pt;padding:3px 0;border-bottom:0.5px solid #e2e2dd;color:#444441;break-inside:avoid;page-break-inside:avoid}\n' +
      '.earlier-row span:last-child{color:#888780;white-space:nowrap;padding-left:8px}\n' +
      '</style>\n</head>\n<body>\n\n' +
      '  <div class="header-band">\n    <div class="name">' + esc(r.name || '') + '</div>\n    <div class="tagline-row">\n      <span class="tagline">' + esc(r.tagline || '') + '</span>\n      <span class="contact">' + contactStr + '</span>\n    </div>\n  </div>\n\n' +
      '  <div class="page-body">\n\n' +
      '    <div class="sidebar">\n      <div class="side-block">\n        <div class="side-h">PROFILE</div>\n        <div class="side-text">' + esc(r.summary || '') + '</div>\n      </div>\n\n' +
      '      <div class="side-block">\n        <div class="side-h">SKILLS</div>\n        <div class="side-text">' + skillsStr + '</div>\n      </div>\n\n' +
      '      <div class="side-block">\n        <div class="side-h">EDUCATION</div>\n        ' + eduHTML + '\n      </div>\n\n' +
      (certHTML ? '      <div class="side-block">\n        <div class="side-h">CERTIFICATIONS</div>\n        <div class="cert-list">' + certHTML + '</div>\n      </div>\n' : '') +
      '    </div>\n\n' +
      '    <div class="main">\n      <div class="section-h">EXPERIENCE</div>\n\n      ' + parts.fullRoles + parts.earlierSection + '\n    </div>\n\n' +
      '  </div>\n\n</body>\n</html>';
  }

  // Template registry — maps a template id to its builder function, plus
  // metadata used by the Settings selector and the Step 3 explainer text.
  var TEMPLATES = {
    editorial: {
      label: 'Editorial Warmth',
      build: buildEditorialHTML,
      blurb: 'Warm cream background with serif headers and a clay-accented sidebar \u2014 a classic, approachable design.'
    },
    slate: {
      label: 'Slate Professional',
      build: buildSlateHTML,
      blurb: 'A dark slate sidebar with amber accents and a clean corporate masthead feel \u2014 confident and modern.'
    },
    blueprint: {
      label: 'Engineering Blueprint',
      build: buildBlueprintHTML,
      blurb: 'A technical \u201cspec sheet\u201d look with monospace labels and a teal accent \u2014 suited to engineering and technical roles.'
    },
    bold: {
      label: 'Bold Data-Forward',
      build: buildBoldHTML,
      blurb: 'A full-width deep-blue header band with filled achievement callouts \u2014 high-contrast and direct.'
    }
  };

  /* ============ ATS plain text ============ */
  function atsText(r) {
    var L = [];
    if (r.name) { L.push((r.name || '').toUpperCase()); }
    if (r.contact) { L.push((r.contact || '').replace(/ \u00B7 /g, ' | ')); }
    L.push('');
    if (r.summary) { L.push('SUMMARY'); L.push(r.summary); L.push(''); }
    if ((r.experience || []).length) {
      L.push('EXPERIENCE');
      r.experience.forEach(function(j) {
        L.push((j.title || '') + (j.company ? '  \u2014  ' + j.company : ''));
        var m = [j.location, j.dates].filter(Boolean).join('  |  ');
        if (m) { L.push(m); }
        (j.bullets || []).forEach(function(b) { L.push('- ' + b); });
        L.push('');
      });
    }
    if ((r.skills || []).length) { L.push('SKILLS'); L.push(r.skills.join(', ')); L.push(''); }
    if ((r.education || []).length) { L.push('EDUCATION'); r.education.forEach(function(e) { L.push((e.degree || '') + (e.sub ? ' \u2014 ' + e.sub : '')); }); L.push(''); }
    if ((r.certifications || []).length) { L.push('CERTIFICATIONS'); r.certifications.forEach(function(c) { L.push(c); }); }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ============ output toggle ============ */
  function showPdf() {
    rt$('rt-preview').classList.remove('hidden');
    rt$('rt-ats').classList.add('hidden');
    rt$('rt-export').classList.remove('hidden');
    rt$('rt-copy').classList.add('hidden');
    rt$('rt-viewPdf').classList.add('on');
    rt$('rt-viewAts').classList.remove('on');
  }
  function showAts() {
    rt$('rt-preview').classList.add('hidden');
    rt$('rt-ats').classList.remove('hidden');
    rt$('rt-export').classList.add('hidden');
    rt$('rt-copy').classList.remove('hidden');
    rt$('rt-viewPdf').classList.remove('on');
    rt$('rt-viewAts').classList.add('on');
  }
  rt$('rt-viewPdf').addEventListener('click', showPdf);
  rt$('rt-viewAts').addEventListener('click', showAts);

  // Resolves the currently selected template's HTML builder, falling back
  // to Editorial Warmth if the saved id is unrecognized (e.g. an older
  // install without a template choice yet, or a registry key typo).
  function activeTemplateBuild() {
    var t = TEMPLATES[CFG.template];
    return (t && t.build) || buildEditorialHTML;
  }

  // Builds "FirstName_LastName_JobTitle_Resume" for the exported file name.
  // Title fallback chain: the job title extracted from the JD this run ->
  // the candidate's own current-role title on the assembled résumé -> a
  // generic fallback if neither is available. Strips characters that are
  // unsafe in filenames across Windows/Mac/Linux.
  function slugifyFilenamePart(s) {
    return (s || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents (é -> e)
      .replace(/[\\/:*?"<>|]/g, '') // strip characters illegal in filenames
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
  function buildExportFilename(resume) {
    var nameParts = (resume.name || '').trim().split(/\s+/);
    var first = nameParts[0] || 'Resume';
    var last = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    var jdTitle = (ANALYSIS && ANALYSIS.targetJobTitle || '').trim();
    var resumeTitle = ((resume.experience || [])[0] || {}).title || '';
    var title = jdTitle || resumeTitle || '';
    var parts = [first, last, title, 'Resume'].map(slugifyFilenamePart).filter(Boolean);
    return parts.join('_') || 'Resume';
  }
  // Injects a <title> tag right after <head> — this is what Chrome's print
  // dialog and "Save As" use to suggest a filename. None of the template
  // builders set one, since the HTML is otherwise meant to be a standalone
  // print document, not a tab someone browses by name.
  function withFilenameTitle(html, filename) {
    return html.replace(/<head>/i, '<head>\n<title>' + esc(filename) + '</title>');
  }

  rt$('rt-copyHtml').addEventListener('click', function() {
    if (!LAST_RESUME) { return; }
    var msg = rt$('rt-copyMsg');
    var html = withFilenameTitle(activeTemplateBuild()(LAST_RESUME), buildExportFilename(LAST_RESUME));
    // Use a data: URI so the result can be pasted directly into a new
    // tab's address bar — no console, no quoting, no execCommand needed.
    var dataUri = 'data:text/html;base64,' + b64EncodeUtf8(html);
    var copyFallback = function() {
      var ta3 = document.createElement('textarea');
      ta3.value = dataUri; ta3.style.position = 'fixed'; ta3.style.opacity = '0';
      document.documentElement.appendChild(ta3); ta3.select();
      try { document.execCommand('copy'); } catch(e2) { void e2; }
      document.documentElement.removeChild(ta3);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(dataUri).catch(copyFallback);
    } else {
      copyFallback();
    }
    msg.textContent = 'Link copied \u2713 \u2014 open a new tab and paste it straight into the address bar, then press Enter.';
    setTimeout(function() { msg.textContent = ''; }, 10000);
  });

  rt$('rt-export').addEventListener('click', function() {
    if (!LAST_RESUME) { return; }
    var html = withFilenameTitle(activeTemplateBuild()(LAST_RESUME), buildExportFilename(LAST_RESUME));
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var w = window.open(url, '_blank');
    if (!w) {
      rt$('rt-copyMsg').textContent = 'Pop-up blocked. Use Copy HTML instead, then paste the link into a new tab.';
      setTimeout(function() { rt$('rt-copyMsg').textContent = ''; }, 8000);
      URL.revokeObjectURL(url);
      return;
    }
    // Trigger print from the OPENER's context, not from inside the blob doc.
    // No script ever executes inside the new tab, so there is nothing for a
    // strict-dynamic CSP (e.g. LinkedIn) on the opener side to block — the
    // blob document only needs to finish loading its fonts/CSS, which the
    // browser's native rendering handles without any script.
    var printed = false;
    var tryPrint = function() {
      if (printed) { return; }
      printed = true;
      try { w.focus(); w.print(); } catch (e) { void e; }
      setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
    };
    // onload fires once the blob document (incl. linked stylesheets) is ready
    w.addEventListener('load', function() { setTimeout(tryPrint, 350); });
    // Fallback in case 'load' doesn't fire for some reason
    setTimeout(tryPrint, 3000);
  });

  rt$('rt-copy').addEventListener('click', function() {
    var t = rt$('rt-ats');
    t.focus();
    t.select();
    var copyFallback = function() {
      try { document.execCommand('copy'); } catch(e2) { void e2; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t.value).catch(copyFallback);
    } else {
      copyFallback();
    }
    rt$('rt-copyMsg').textContent = 'Copied \u2713 \u2014 paste straight into the application.';
    setTimeout(function() { rt$('rt-copyMsg').textContent = ''; }, 3000);
  });

})();
