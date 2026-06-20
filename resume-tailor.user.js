// ==UserScript==
// @name         Résumé Tailor
// @namespace    banksdaname
// @version      1.1.0
// @description  Tailor your résumé to any job posting. Editorial Warmth PDF + ATS plain text.
// @author       banksdaname
// @match        *://*/*
// @exclude-match chrome-extension://*/*
// @exclude-match moz-extension://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  var SCRIPT_VERSION = '1.1.0';

  var CFG = {
    proxyUrl: GM_getValue('rt_proxyUrl', ''),
    model: GM_getValue('rt_model', 'claude-sonnet-4-6'),
    template: GM_getValue('rt_template', 'editorial'),
  };
  var KB = GM_getValue('rt_kb', null);
  if (typeof KB === 'string') { try { KB = JSON.parse(KB); } catch (e) { KB = null; } }
  var ANALYSIS = null, DECISIONS = null, LAST_RESUME = null, pdfText = '';

  var MODELS = [
    ['claude-haiku-4-5-20251001', 'Haiku 4.5 — cheapest (~2¢/run)'],
    ['claude-sonnet-4-6', 'Sonnet 4.6 — recommended (~6¢/run)'],
    ['claude-opus-4-8', 'Opus 4.8 — top quality (~10¢/run)'],
  ];

  var esc = function(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // btoa() only handles Latin1 — this routes the string through UTF-8 bytes
  // first so accented characters (é, ·, etc.) survive the round trip.
  function b64EncodeUtf8(str) {
    var utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8);
  }

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
    #rt-root,#rt-root *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    #rt-root{position:fixed!important;top:0!important;right:0!important;width:430px;max-width:96vw;height:100vh;z-index:2147483647!important;background:#f4f5f8;color:#1c2230;box-shadow:-8px 0 30px rgba(0,0,0,.18);overflow-y:auto;line-height:1.45;display:none!important}
    #rt-root.open{display:block!important}
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
    #rt-root .pill.none{background:#f0f1f4;color:#9aa0ab}
    #rt-root .hidden{display:none!important}
    #rt-root .banner{display:flex;gap:9px;background:#fdf3e7;border:1px solid #f3dcbd;color:#b45309;border-radius:9px;padding:10px 12px;font-size:12px;margin-bottom:12px}
    #rt-root .rev{border:1px solid #e6e8ee;border-radius:10px;padding:11px;margin-bottom:10px;background:#fcfcfe}
    #rt-root .rev.is-skip{opacity:.55}
    #rt-root .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:6px}
    #rt-root .orig{font-size:12px;color:#6b7280;margin:0 0 6px;padding-left:9px;border-left:2px solid #e6e8ee}
    #rt-root .why{font-size:11.5px;color:#6b7280;margin-top:7px;font-style:italic}
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
    #rt-root .seg{display:inline-flex;border:1px solid #e6e8ee;border-radius:8px;overflow:hidden}
    #rt-root .seg button{border:none;background:#fff;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;color:#6b7280;font-family:inherit}
    #rt-root .seg button.on{background:#3b4cca;color:#fff}
    #rt-root #rt-preview{border:1px solid #e6e8ee;border-radius:9px;overflow:hidden;background:#fff}
    #rt-root #rt-preview iframe{display:block;width:100%;height:560px;border:none}
    #rt-root .tpl-preview-row{display:block;margin-top:10px}
    #rt-root .tpl-thumb{width:100%;aspect-ratio:850/1100;border:1px solid #e6e8ee;border-radius:6px;overflow:hidden;position:relative;background:#fff}
    #rt-root .tpl-thumb iframe{width:850px;height:1100px;border:none;transform-origin:top left;pointer-events:none}
    #rt-root .tpl-preview-row .note{margin-top:8px}
    #rt-root #rt-ats{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;background:#fff}
  `);

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
  var closeBtn = mk('button', { cls: 'rt-x', id: 'rt-close' }); closeBtn.textContent = '\u00D7';
  var hd = ap(mk('div', { cls: 'rt-hd' }), hdLogo, hdInner, closeBtn);

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
  var liUrlInp = mkInp('text', 'rt-liUrl', 'https://linkedin.com/in/yourname'); liUrlInp.style.marginBottom = '7px';
  var kbForm = ap(mk('div', { id: 'rt-kbForm' }),
    mkField('1 \u00B7 R\u00E9sum\u00E9 PDF', pdfFileLbl, pdfState),
    mkField('2 \u00B7 Paste from your Google Doc (no length limit)', mkTa('rt-gdoc', '10', 'Paste your full r\u00E9sum\u00E9 text here\u2026')),
    mkField('3 \u00B7 LinkedIn', liUrlInp, mkTa('rt-liText', '4', 'Paste your LinkedIn About + experience text\u2026')),
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
  var grabSelBtn = mkBtn('ghost', 'rt-grabSel', 'Use selected text'); grabSelBtn.style.cssText = 'padding:7px 12px;font-size:12.5px';
  var analyzeBtn = mkBtn('primary', 'rt-analyze', 'Tailor my r\u00E9sum\u00E9');
  var jdCard = mkCard(
    ap(mk('h2'), document.createTextNode('\uD83C\uDFAF Step 1 \u00B7 Job description')),
    ap(mk('p', { cls: 'desc' }), document.createTextNode('Grab it off this page, or paste it in.')),
    mkRow(grabBtn, grabSelBtn),
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
  document.documentElement.appendChild(root);

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
    if (!document.documentElement.contains(root)) { document.documentElement.appendChild(root); }
  }
  function setSolid(isSolid) {
    if (isSolid) { launch.classList.add('rt-solid'); } else { launch.classList.remove('rt-solid'); }
    GM_setValue('rt_pillSolid', isSolid);
  }
  function openPanel() { reattach(); setSolid(true); root.classList.add('open'); try { hydrate(); } catch(e) { console.error('[Résumé Tailor]', e); } }
  function closePanel() { root.classList.remove('open'); setSolid(true); }
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
    var liUrl = rt$('rt-liUrl').value.trim();
    var liText = rt$('rt-liText').value.trim();
    var originalSummary = rt$('rt-summary').value.trim();
    var usePdf = pdfText || (KB && KB.pdfText) || '';
    if (!usePdf && !gdocText && !liText) { rt$('rt-kbMsg').textContent = ' Add at least one source.'; return; }
    KB = { pdfText: usePdf, gdocText: gdocText, liUrl: liUrl, liText: liText, originalSummary: originalSummary, updatedAt: Date.now() };
    GM_setValue('rt_kb', JSON.stringify(KB));
    rt$('rt-kbMsg').textContent = ' Saved \u2713';
    renderKbSummary();
  });
  rt$('rt-editKb').addEventListener('click', function() {
    rt$('rt-gdoc').value = KB.gdocText || '';
    rt$('rt-liUrl').value = KB.liUrl || '';
    rt$('rt-liText').value = KB.liText || '';
    rt$('rt-summary').value = KB.originalSummary || '';
    if (KB.pdfText) { rt$('rt-pdfState').textContent = '\u2713 Saved PDF text on file. Choose a new PDF to replace.'; }
    rt$('rt-kbSummary').classList.add('hidden');
    rt$('rt-kbForm').classList.remove('hidden');
  });
  function pill(id, on, label) {
    var e = rt$(id);
    e.className = 'pill ' + (on ? 'ok' : 'none');
    e.textContent = (on ? '\u2713 ' : '\u2014 ') + label;
  }
  function renderKbSummary() {
    pill('rt-p1', !!KB.pdfText, 'PDF');
    pill('rt-p2', !!KB.gdocText, 'Doc');
    pill('rt-p3', !!(KB.liText || KB.liUrl), 'LinkedIn');
    pill('rt-p4', !!KB.originalSummary, 'Summary');
    rt$('rt-kbStatus').className = 'pill ok';
    rt$('rt-kbStatus').textContent = 'Saved';
    rt$('rt-kbForm').classList.add('hidden');
    rt$('rt-kbSummary').classList.remove('hidden');
  }

  /* ============ smart JD grab ============ */
  function smartGrabJD() {
    if (/linkedin\.com/i.test(location.hostname)) {
      var liSels = ['.jobs-description__content', '.jobs-box__html-content', '[class*="jobs-description"]', '[class*="job-details"]', '.description__text'];
      for (var i = 0; i < liSels.length; i++) {
        var el = document.querySelector(liSels[i]);
        if (el && (el.innerText || '').trim().length > 200) {
          return el.innerText.replace(/\r/g, '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
        }
      }
    }
    var startKeys = ['about the job', 'about this job', 'about the role', 'about this role', 'job description', 'job details', 'role description', "what you'll do", 'what you will do', 'responsibilities', 'overview', 'about the company', 'about us', 'who we are', 'requirements', 'qualifications', 'the role'];
    var stopKeys = ['similar jobs', 'more jobs from', 'people also viewed', 'jobs you may be interested', 'related jobs', 'set alert', 'report this job', 'recommended for you', 'show more jobs', 'cookie policy', 'privacy policy', 'terms of service', 'sign in to', 'create alert'];
    var mainEl = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('article');
    var text = (mainEl && (mainEl.innerText || '').trim().length > 300) ? mainEl.innerText : (document.body.innerText || '');
    text = text.replace(/\r/g, '');
    var low = text.toLowerCase();
    var start = -1;
    for (var si = 0; si < startKeys.length; si++) {
      var idx = low.indexOf(startKeys[si]);
      if (idx !== -1 && (start === -1 || idx < start)) { start = idx; }
    }
    if (start > 0) { text = text.slice(start); }
    var low2 = text.toLowerCase();
    var end = text.length;
    for (var ki = 0; ki < stopKeys.length; ki++) {
      var kidx = low2.indexOf(stopKeys[ki]);
      if (kidx > 200 && kidx < end) { end = kidx; }
    }
    text = text.slice(0, end).split('\n').map(function(l) { return l.trim(); }).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return text.slice(0, 8000);
  }
  rt$('rt-grab').addEventListener('click', function() {
    var t = smartGrabJD();
    rt$('rt-jd').value = t || '';
    if (!t) { rt$('rt-jd').placeholder = "Couldn't isolate a job section — paste it in manually."; }
  });
  rt$('rt-grabSel').addEventListener('click', function() {
    var s = String(window.getSelection());
    if (s.trim()) { rt$('rt-jd').value = s.trim(); }
    else { rt$('rt-jd').placeholder = 'Select text on the page first, then click here.'; }
  });

  /* ============ Claude via proxy ============ */
  function callClaude(system, user, maxTok) {
    if (!CFG.proxyUrl) { return Promise.reject(new Error('Set your Proxy URL in Settings first.')); }
    var url = CFG.proxyUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: CFG.model, max_tokens: maxTok || 2500, system: system, messages: [{ role: 'user', content: user }] })
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
      return (data.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
    });
  }
  function parseJson(txt) {
    var s = txt.replace(/```json/g, '').replace(/```/g, '').trim();
    var a = s.indexOf('{');
    var b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { s = s.slice(a, b + 1); }
    return JSON.parse(s);
  }
  function capTokens(str, maxTok) {
    var maxChars = maxTok * 4;
    return str.length > maxChars ? str.slice(0, maxChars) + '\n[truncated]' : str;
  }
  function kbText() {
    var KB_MAX = 8000;
    var source = '';
    if (KB.gdocText && KB.gdocText.trim().length > 100) {
      source = '=== R\u00C9SUM\u00C9 (GOOGLE DOC) ===\n' + capTokens(KB.gdocText, KB_MAX);
    } else if (KB.pdfText && KB.pdfText.trim().length > 100) {
      source = '=== R\u00C9SUM\u00C9 (PDF) ===\n' + capTokens(KB.pdfText, KB_MAX);
    } else if (KB.liText && KB.liText.trim().length > 100) {
      source = '=== LINKEDIN ===\n' + capTokens(KB.liText, KB_MAX);
    }
    var out = '';
    if (KB.originalSummary && KB.originalSummary.trim()) {
      out += '=== ORIGINAL PROFILE/SUMMARY (use this as the base for the summary field \u2014 do not replace with LinkedIn text) ===\n' + KB.originalSummary.trim() + '\n\n';
    }
    out += source + '\n\n';
    if (KB.liUrl) { out += 'LinkedIn URL: ' + KB.liUrl + '\n'; }
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
    callClaude(SYS_A, user, 2500).then(function(text) {
      ANALYSIS = parseJson(text);
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
        rev.appendChild(mkChip('on-ok', 'toggle', { k: 'titles', id: t.id }, '\u2713 Use'));
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
        rev.appendChild(mkChip('on-ok', 'toggle', { k: 'bullets', id: b.id }, '\u2713 Approve'));
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
        rev.appendChild(mkChip('', 'new-yes', { id: n.id }, 'Yes \u2014 include'));
        rev.appendChild(mkChip('on-skip', 'new-no', { id: n.id }, 'No'));
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
    if (act === 'toggle') {
      var d = DECISIONS[t.dataset.k][t.dataset.id];
      var rev = root.querySelector('#rev-' + t.dataset.k + '-' + t.dataset.id);
      if (d.status === 'approved') { d.status = 'skipped'; t.className = 'chip on-skip'; t.textContent = 'Skipped'; rev.classList.add('is-skip'); }
      else { d.status = 'approved'; t.className = 'chip on-ok'; t.textContent = (t.dataset.k === 'titles' ? '\u2713 Use' : '\u2713 Approve'); rev.classList.remove('is-skip'); }
    } else if (act === 'new-yes' || act === 'new-no') {
      var id = t.dataset.id;
      var nd = DECISIONS.news[id];
      var nrev = root.querySelector('#rev-news-' + id);
      var chips = nrev.querySelectorAll('.chip');
      chips.forEach(function(c) { c.className = 'chip'; });
      if (act === 'new-yes') { nd.status = 'approved'; chips[0].className = 'chip on-ok'; nrev.classList.remove('is-skip'); }
      else { nd.status = 'skipped'; chips[1].className = 'chip on-skip'; nrev.classList.add('is-skip'); }
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
    var user = 'ORIGINAL MATERIALS:\n' + kbText() + '\nAPPROVED TITLE CHANGES: ' + JSON.stringify(titles) + '\nAPPROVED REWRITTEN BULLETS: ' + JSON.stringify(bullets) + '\nAPPROVED NEW BULLETS: ' + JSON.stringify(news) + '\nFINAL SKILLS: ' + JSON.stringify(skills) + '\n\nBuild the complete r\u00E9sum\u00E9. Use approved titles. Place rewritten/new bullets in correct roles; keep other real bullets.\nFor top 2-3 roles set highlight to best single measurable Signature Win sentence.\nFor older/less relevant roles set condensed:true and omit bullets.\nReturn JSON exactly:\n{"name":"","tagline":"short italic descriptor","contact":"City, ST \u00B7 phone \u00B7 email \u00B7 linkedin","summary":"2-3 factual sentences tuned to the job","experience":[{"title":"","company":"","location":"","dates":"","highlight":"","condensed":false,"bullets":[""]}],"skills":[""],"education":[{"degree":"","sub":""}],"certifications":[""]}';
    callClaude(SYS_B, user, 6000).then(function(text) {
      LAST_RESUME = parseJson(text);
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
