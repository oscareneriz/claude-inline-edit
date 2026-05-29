// ============================================================================
// Claude Inline Edit — content script
// Shows a pill when you finish selecting text, opens a prompt panel with style
// presets, asks the background worker to rewrite, and drops the result in place.
// All UI lives in a shadow root so page CSS can't break it.
//
// Perf note: we do NOTHING during the drag itself. Work happens only on mouseup
// and on the keyboard shortcut — never on selectionchange — so selecting text
// on heavy pages (Gmail, docs) stays smooth.
// ============================================================================

(() => {
  if (window.__claudeInlineEditLoaded) return;
  window.__claudeInlineEditLoaded = true;

  // --- 60s pastel palette -----------------------------------------------------
  const C = {
    BG: "#f5edde", BG2: "#ebe0cc", BG3: "#dfd0b4", SEP: "#c4b090",
    FG: "#2a1c0c", FG2: "#7a5c38", FG3: "#a07c50",
    ACT: "#40a8b8", ACT2: "#2888a0", GRN: "#5ca870", RED: "#d86050"
  };

  let presets = [];
  let defaultPreset = "";   // name of the preset preselected when the panel opens
  let panelPinned = false;  // if true, reopen at panelPos instead of lower-right
  let panelPos = null;      // { left, top } the user pinned
  let pillEnabled = true;     // show the ✦ pill when text is highlighted
  let pillPos = null;         // { left, top } absolute viewport spot chosen by the user
  let pillCalibrating = false;// "set position" mode triggered from settings
  let formatMode = "plain";   // "plain" = strip markdown, "rich" = render **bold**
  try {
    chrome.storage.sync.get(
      ["presets", "defaultPreset", "panelPinned", "panelPos",
       "pillEnabled", "pillPos", "pillCalibrating", "formatMode"],
      (r) => {
        presets = (r && r.presets) || [];
        defaultPreset = (r && r.defaultPreset) || "";
        panelPinned = !!(r && r.panelPinned);
        panelPos = (r && r.panelPos) || null;
        pillEnabled = !(r && r.pillEnabled === false);   // default ON
        pillPos = (r && r.pillPos) || null;
        pillCalibrating = !!(r && r.pillCalibrating);
        formatMode = (r && r.formatMode) || "plain";
        if (pillCalibrating) startCalibration();
      }
    );
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.presets) presets = ch.presets.newValue || [];
      if (ch.defaultPreset) defaultPreset = ch.defaultPreset.newValue || "";
      if (ch.panelPinned) panelPinned = !!ch.panelPinned.newValue;
      if (ch.panelPos) panelPos = ch.panelPos.newValue || null;
      if (ch.pillEnabled) {
        pillEnabled = ch.pillEnabled.newValue !== false;
        if (!pillEnabled) hidePill();          // hide it right away when turned off
      }
      if (ch.pillPos) pillPos = ch.pillPos.newValue || null;
      if (ch.pillCalibrating) {
        pillCalibrating = !!ch.pillCalibrating.newValue;
        if (pillCalibrating) startCalibration(); else endCalibration();
      }
      if (ch.formatMode) { formatMode = ch.formatMode.newValue || "plain"; updateFmtButtons(); }
    });
  } catch (_) {}

  // --- Markdown handling ------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Strip markdown emphasis so nothing pastes as literal **, __, *, ` characters.
  function mdToPlain(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1");
  }
  // Convert markdown bold/italic to real HTML (everything else escaped).
  function mdToHtml(s) {
    let h = escapeHtml(s);
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/__(.+?)__/g, "<strong>$1</strong>");
    h = h.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
    h = h.replace(/`([^`]+)`/g, "$1");
    h = h.replace(/\n/g, "<br>");
    return h;
  }

  // --- Shadow-root host -------------------------------------------------------
  // pointer-events:none on the host so the (mostly invisible) overlay never
  // intercepts clicks or text selection on the page. The pill/panel re-enable
  // pointer events on themselves.
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;" +
    "z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
      .pill, .panel { position: fixed; pointer-events: auto; }
      .pill {
        display: none; align-items: center; gap: 5px;
        padding: 5px 11px; border-radius: 999px; cursor: pointer; user-select: none;
        background: ${C.ACT}; color: #fff; font-size: 13px; font-weight: 600;
        box-shadow: 0 3px 10px rgba(0,0,0,.25); white-space: nowrap;
      }
      .pill:hover { background: ${C.ACT2}; }
      .panel {
        display: none; width: 320px; padding: 12px;
        background: ${C.BG}; border: 1px solid ${C.SEP}; border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,.28); color: ${C.FG};
      }
      .head { display: flex; align-items: center; justify-content: space-between;
              margin: -2px 0 9px; cursor: move; user-select: none; }
      .title { font-size: 12px; font-weight: 700; color: ${C.FG2}; letter-spacing: .03em; }
      .headbtns { display: flex; align-items: center; gap: 2px; }
      .pin { cursor: pointer; font-size: 13px; line-height: 1; padding: 3px 5px;
             border-radius: 6px; filter: grayscale(1) opacity(.55); }
      .pin:hover { background: ${C.BG3}; filter: grayscale(.4) opacity(.9); }
      .pin.on { filter: none; background: ${C.BG3}; }
      .close { cursor: pointer; color: ${C.FG3}; font-size: 13px; line-height: 1;
               padding: 3px 7px; border-radius: 6px; }
      .close:hover { background: ${C.RED}; color: #fff; }
      .grip { cursor: move; color: ${C.FG3}; font-size: 15px; line-height: 1;
              padding: 2px 7px; border-radius: 6px; }
      .grip:hover { background: ${C.BG3}; color: ${C.FG}; }
      .row { display: flex; gap: 6px; align-items: center; }
      .label { font-size: 11px; font-weight: 700; color: ${C.FG2};
               text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
      select, input, textarea {
        font-family: inherit; font-size: 13px; color: ${C.FG};
        background: ${C.BG2}; border: 1px solid ${C.SEP}; border-radius: 8px;
        padding: 7px 9px; width: 100%; outline: none;
      }
      select:focus, input:focus, textarea:focus { border-color: ${C.ACT}; }
      textarea { resize: vertical; min-height: 54px; margin-top: 8px; }
      .btn {
        font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        border: none; border-radius: 8px; padding: 8px 12px; white-space: nowrap;
      }
      .btn-primary { background: ${C.ACT}; color: #fff; flex: 1; }
      .btn-primary:hover { background: ${C.ACT2}; }
      .btn-ghost { background: ${C.BG3}; color: ${C.FG}; }
      .btn-ghost:hover { background: ${C.SEP}; }
      .btn:disabled { opacity: .55; cursor: default; }
      .save { font-size: 16px; line-height: 1; padding: 8px 11px; }
      .foot { display: flex; gap: 6px; margin-top: 8px; }
      .fmtrow { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
      .fmtlabel { font-size: 11px; font-weight: 700; color: ${C.FG2};
                  text-transform: uppercase; letter-spacing: .04em; margin-right: 2px; }
      .fmtbtn { background: ${C.BG3}; color: ${C.FG}; padding: 5px 12px; font-size: 12px; }
      .fmtbtn:hover { background: ${C.SEP}; }
      .fmtbtn.active { background: ${C.ACT}; color: #fff; }
      .status { font-size: 12px; color: ${C.FG2}; margin-top: 8px; min-height: 16px; }
      .status.err { color: ${C.RED}; font-weight: 600; }
      .status.ok  { color: ${C.GRN}; font-weight: 600; }
      .spin { display: inline-block; width: 12px; height: 12px; vertical-align: -1px;
              border: 2px solid ${C.SEP}; border-top-color: ${C.ACT};
              border-radius: 50%; animation: sp .7s linear infinite; margin-right: 6px; }
      @keyframes sp { to { transform: rotate(360deg); } }
      .box { font-size: 13px; border-radius: 8px; padding: 8px 9px; max-height: 110px;
             overflow: auto; white-space: pre-wrap; word-break: break-word;
             border: 1px solid ${C.SEP}; }
      .orig { background: ${C.BG2}; color: ${C.FG2}; }
      .neww { background: #fff; color: ${C.FG}; border-color: ${C.ACT}; }
      .calbar { position: fixed; display: none; pointer-events: auto;
                left: 50%; top: 16px; transform: translateX(-50%);
                align-items: center; gap: 8px; padding: 9px 12px;
                background: ${C.BG}; border: 1px solid ${C.SEP}; border-radius: 12px;
                box-shadow: 0 8px 28px rgba(0,0,0,.28); color: ${C.FG}; }
      .caltext { font-size: 13px; font-weight: 600; color: ${C.FG2}; }
      .calbar .btn { flex: 0 0 auto; }
    </style>

    <div class="pill" id="pill">✦ Edit</div>

    <div class="calbar" id="calbar">
      <span class="caltext">Drag the ✦ pill where you want it, then</span>
      <button class="btn btn-primary" id="calSave">Save position</button>
      <button class="btn btn-ghost" id="calCancel">Cancel</button>
    </div>

    <div class="panel" id="panel">
      <div class="head" id="head">
        <span class="title">✦ Claude Inline Edit</span>
        <span class="headbtns">
          <span class="pin" id="pin" title="Pin the panel to this spot">📌</span>
          <span class="close" id="close" title="Close">✕</span>
          <span class="grip" id="grip" title="Drag to move">⠿</span>
        </span>
      </div>
      <div id="editor">
        <div class="label">Style preset</div>
        <div class="row">
          <select id="preset"></select>
          <button class="btn btn-ghost save" id="save" title="Save the box below as a new preset">＋</button>
        </div>
        <textarea id="instruction" placeholder="Tell Claude how to change the selected text…"></textarea>
        <div class="foot">
          <button class="btn btn-primary" id="go">Rewrite</button>
          <button class="btn btn-ghost" id="cancel">Esc</button>
        </div>
      </div>
      <div id="preview" style="display:none">
        <div class="label">Before</div>
        <div class="box orig" id="prevOrig"></div>
        <div class="label" style="margin-top:8px">After</div>
        <div class="box neww" id="prevNew"></div>
        <div class="fmtrow">
          <span class="fmtlabel">Insert as</span>
          <button class="btn fmtbtn" id="fmtPlain2">Plain text</button>
          <button class="btn fmtbtn" id="fmtBold2">Bold</button>
        </div>
        <div class="foot">
          <button class="btn btn-primary" id="apply">Apply ✓</button>
          <button class="btn btn-ghost" id="back">Back</button>
        </div>
      </div>
      <div class="status" id="status"></div>
    </div>
  `;

  const pill = root.getElementById("pill");
  const panel = root.getElementById("panel");
  const presetSel = root.getElementById("preset");
  const instruction = root.getElementById("instruction");
  const goBtn = root.getElementById("go");
  const cancelBtn = root.getElementById("cancel");
  const saveBtn = root.getElementById("save");
  const statusEl = root.getElementById("status");
  const editor = root.getElementById("editor");
  const preview = root.getElementById("preview");
  const prevOrig = root.getElementById("prevOrig");
  const prevNew = root.getElementById("prevNew");
  const applyBtn = root.getElementById("apply");
  const backBtn = root.getElementById("back");
  const head = root.getElementById("head");
  const pinBtn = root.getElementById("pin");
  const closeBtn = root.getElementById("close");
  const calbar = root.getElementById("calbar");
  const calSave = root.getElementById("calSave");
  const calCancel = root.getElementById("calCancel");
  const fmtPlainBtn2 = root.getElementById("fmtPlain2");
  const fmtBoldBtn2 = root.getElementById("fmtBold2");

  // The selection we'll act on, captured before the panel steals focus.
  let target = null;
  // The rewrite waiting in the preview, not yet applied.
  let pendingText = null;

  // --- Selection capture (called only on mouseup / shortcut) ------------------
  function captureSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      const start = active.selectionStart, end = active.selectionEnd;
      if (start != null && end != null && end > start) {
        return { kind: "input", el: active, start, end,
                 text: active.value.substring(start, end) };
      }
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const text = sel.toString();
      if (!text.trim()) return null;
      const range = sel.getRangeAt(0).cloneRange();
      let node = range.commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentElement;
      const ceHost = node && node.closest
        ? node.closest('[contenteditable=""],[contenteditable="true"]') : null;
      return ceHost
        ? { kind: "editable", range, host: ceHost, text }
        : { kind: "readonly", range, text };
    }
    return null;
  }

  // Viewport-relative rect of the current selection (or the active field).
  function selectionRect() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && r.width + r.height > 0) return r;
    }
    const a = document.activeElement;
    if (a && a.getBoundingClientRect) {
      const r = a.getBoundingClientRect();
      if (r && r.width + r.height > 0) return r;
    }
    return null;
  }

  // --- Pill -------------------------------------------------------------------
  function showPillIfSelection() {
    if (panel.style.display === "block") return;     // panel open → ignore
    if (pillCalibrating) return;                      // calibration controls the pill
    if (!pillEnabled) { hidePill(); return; }         // pill turned off
    const cap = captureSelection();
    if (!cap) { hidePill(); return; }
    const r = selectionRect();
    if (!r) { hidePill(); return; }
    target = cap;
    pill.textContent = "✦ Edit";
    pill.style.cursor = "pointer";
    pill.style.display = "flex";
    if (pillPos) {
      // Fixed spot the user chose during calibration.
      const left = Math.min(pillPos.left, window.innerWidth - 80);
      const top = Math.min(pillPos.top, window.innerHeight - 36);
      pill.style.left = Math.max(6, left) + "px";
      pill.style.top = Math.max(6, top) + "px";
    } else {
      // Default: just below-right of the selection.
      pill.style.left = Math.max(6, Math.min(r.right, window.innerWidth - 80)) + "px";
      pill.style.top = Math.max(6, Math.min(r.bottom + 6, window.innerHeight - 36)) + "px";
    }
  }
  function hidePill() { pill.style.display = "none"; }

  // Events — note: NO selectionchange listener (that was the lag source).
  document.addEventListener("mousedown", (e) => {
    if (pillCalibrating) return;                       // keep the pill during calibration
    // A new click/drag is starting. Clear the pill unless the click is on our UI.
    if (!e.composedPath || !e.composedPath().includes(host)) hidePill();
  }, true);

  document.addEventListener("mouseup", () => {
    // Defer one tick so the browser finalizes the selection first.
    setTimeout(showPillIfSelection, 0);
  });

  // Hide stale UI on scroll (positions are viewport-fixed).
  window.addEventListener("scroll", () => {
    if (pillCalibrating) return;
    hidePill();
    if (panel.style.display === "block") closePanel();
  }, true);

  // Open the panel for the current selection (used by the shortcut + the command).
  function openForSelection() {
    const cap = captureSelection();
    if (!cap) {
      // No selection — flash the pill area isn't possible, so briefly show a hint.
      return false;
    }
    target = cap;
    openPanel();
    return true;
  }

  // Keyboard shortcut fallback, in the CAPTURE phase so we see it before most
  // pages can swallow it. The primary path is the Chrome command (background.js),
  // which works even on pages that fully intercept keydown.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key && e.key.toLowerCase() === "k") {
      if (openForSelection()) e.preventDefault();
    }
  }, true);

  // The Chrome command (Ctrl/Cmd+Shift+K) routes through the background worker,
  // which messages us here. This is the reliable path on stubborn pages.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "open-panel") openForSelection();
    });
  } catch (_) {}

  // --- Panel ------------------------------------------------------------------
  function buildPresetOptions() {
    presetSel.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "— Custom (type below) —";
    presetSel.appendChild(blank);
    presets.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i); o.textContent = p.name;
      presetSel.appendChild(o);
    });
  }

  function openPanel() {
    if (!target) return;
    if (panel.style.display === "block") return;   // already open — don't re-open
    hidePill();
    buildPresetOptions();
    setStatus("");
    instruction.value = "";
    presetSel.value = "";
    pendingText = null;
    editor.style.display = "block";
    preview.style.display = "none";

    panel.style.display = "block";
    applyDefaultPreset();            // preselect the user's default preset, if any
    updateFmtButtons();
    pinBtn.classList.toggle("on", panelPinned);

    if (panelPinned && panelPos) {
      // Reopen exactly where the user pinned it.
      panel.style.left = panelPos.left + "px";
      panel.style.top = panelPos.top + "px";
      clampIntoView();
    } else {
      // Default: spawn near the lower-right corner of the viewport.
      const w = panel.offsetWidth || 320;
      const h = panel.offsetHeight || 220;
      panel.style.left = Math.max(8, window.innerWidth - w - 16) + "px";
      panel.style.top = Math.max(8, window.innerHeight - h - 16) + "px";
    }
    setTimeout(() => instruction.focus(), 0);
  }

  // Keep the panel fully on-screen (used after its height changes, e.g. preview).
  function clampIntoView() {
    const w = panel.offsetWidth || 320, h = panel.offsetHeight || 220;
    let l = parseFloat(panel.style.left) || 0;
    let t = parseFloat(panel.style.top) || 0;
    l = Math.max(8, Math.min(l, window.innerWidth - w - 8));
    t = Math.max(8, Math.min(t, window.innerHeight - h - 8));
    panel.style.left = l + "px";
    panel.style.top = t + "px";
  }

  // Preselect the default preset (by name) and load its instruction text.
  function applyDefaultPreset() {
    if (!defaultPreset) { presetSel.value = ""; return; }
    const idx = presets.findIndex((p) => p.name === defaultPreset);
    if (idx >= 0) {
      presetSel.value = String(idx);
      instruction.value = presets[idx].instruction;
    } else {
      presetSel.value = "";
    }
  }

  function closePanel() {
    panel.style.display = "none";
    target = null;
    pendingText = null;
  }

  function setStatus(msg, cls) {
    statusEl.className = "status" + (cls ? " " + cls : "");
    statusEl.innerHTML = msg;
  }

  presetSel.addEventListener("change", () => {
    const i = presetSel.value;
    if (i !== "") { instruction.value = presets[Number(i)].instruction; instruction.focus(); }
  });

  saveBtn.addEventListener("click", async () => {
    const text = instruction.value.trim();
    if (!text) { setStatus("Type an instruction first, then save it.", "err"); return; }
    const name = prompt("Name this preset:", text.slice(0, 40));
    if (!name) return;
    presets = [...presets, { name: name.trim(), instruction: text }];
    try { await chrome.storage.sync.set({ presets }); } catch (_) {}
    buildPresetOptions();
    presetSel.value = String(presets.length - 1);
    setStatus(`Saved preset “${name.trim()}”.`, "ok");
  });

  cancelBtn.addEventListener("click", closePanel);
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
  pill.addEventListener("click", () => { if (!pillCalibrating) openPanel(); });

  // --- Plain / Bold formatting toggle ----------------------------------------
  function updateFmtButtons() {
    const isRich = formatMode === "rich";
    if (fmtPlainBtn2) fmtPlainBtn2.classList.toggle("active", !isRich);
    if (fmtBoldBtn2) fmtBoldBtn2.classList.toggle("active", isRich);
  }
  function renderPreviewAfter() {
    if (pendingText == null) return;
    if (formatMode === "rich") prevNew.innerHTML = mdToHtml(pendingText);
    else prevNew.textContent = mdToPlain(pendingText);
  }
  function setFmtMode(mode) {
    formatMode = mode;
    updateFmtButtons();
    try { chrome.storage.sync.set({ formatMode: mode }); } catch (_) {}
    if (preview.style.display === "block") renderPreviewAfter();   // re-render live
  }
  fmtPlainBtn2.addEventListener("click", () => setFmtMode("plain"));
  fmtBoldBtn2.addEventListener("click", () => setFmtMode("rich"));

  // Keep the page selection alive when clicking buttons inside our panel.
  // Listen on the shadow root so e.target is the real inner element.
  root.addEventListener("mousedown", (e) => {
    if (e.target === instruction || e.target === presetSel) return;
    e.preventDefault();
  });

  // --- Drag the panel by its header ------------------------------------------
  let drag = null;
  head.addEventListener("mousedown", (e) => {
    if (e.target === pinBtn || e.target === closeBtn) return;   // let buttons get their click
    drag = {
      x: e.clientX, y: e.clientY,
      left: parseFloat(panel.style.left) || 0,
      top: parseFloat(panel.style.top) || 0
    };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    let nl = drag.left + (e.clientX - drag.x);
    let nt = drag.top + (e.clientY - drag.y);
    nl = Math.max(6, Math.min(nl, window.innerWidth - (panel.offsetWidth || 320) - 6));
    nt = Math.max(6, Math.min(nt, window.innerHeight - 40));
    panel.style.left = nl + "px";
    panel.style.top = nt + "px";
  });
  window.addEventListener("mouseup", () => {
    // If pinned, dragging updates the saved spot.
    if (drag && panelPinned) {
      panelPos = { left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0 };
      try { chrome.storage.sync.set({ panelPos }); } catch (_) {}
    }
    drag = null;
  });

  // --- Pin / unpin the panel position ----------------------------------------
  pinBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    panelPinned = !panelPinned;
    pinBtn.classList.toggle("on", panelPinned);
    try {
      if (panelPinned) {
        panelPos = { left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0 };
        await chrome.storage.sync.set({ panelPinned: true, panelPos });
        setStatus("Pinned here — opens here from now on ✓", "ok");
      } else {
        await chrome.storage.sync.set({ panelPinned: false });
        setStatus("Unpinned — opens in the lower-right.");
      }
    } catch (_) {}
  });

  // --- Calibrate the pill position ("Set pill position" in settings) ---------
  // Shows the pill in the page center with a Save/Cancel bar. The user drags the
  // pill anywhere and clicks Save; the chosen spot becomes the pill's fixed
  // viewport position for every future highlight.
  function startCalibration() {
    if (!calbar || document.visibilityState !== "visible") return;
    pill.textContent = "✦ Edit";
    pill.style.cursor = "grab";
    pill.style.display = "flex";
    const w = pill.offsetWidth || 70, h = pill.offsetHeight || 30;
    if (pillPos) {
      pill.style.left = pillPos.left + "px";
      pill.style.top = pillPos.top + "px";
    } else {
      pill.style.left = Math.round(window.innerWidth / 2 - w / 2) + "px";
      pill.style.top = Math.round(window.innerHeight / 2 - h / 2) + "px";
    }
    calbar.style.display = "flex";
  }
  function endCalibration() {
    if (calbar) calbar.style.display = "none";
    pill.style.cursor = "pointer";
    hidePill();
  }
  // If the page was in the background when calibration was armed, start it when
  // the user switches to this tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pillCalibrating) startCalibration();
  });

  let pillDrag = null;
  pill.addEventListener("mousedown", (e) => {
    if (!pillCalibrating) return;          // normal mode: click opens the panel
    pillDrag = {
      x: e.clientX, y: e.clientY,
      left: parseFloat(pill.style.left) || 0,
      top: parseFloat(pill.style.top) || 0
    };
    pill.style.cursor = "grabbing";
    e.preventDefault();
    e.stopPropagation();
  });
  window.addEventListener("mousemove", (e) => {
    if (!pillDrag) return;
    let nl = pillDrag.left + (e.clientX - pillDrag.x);
    let nt = pillDrag.top + (e.clientY - pillDrag.y);
    nl = Math.max(2, Math.min(nl, window.innerWidth - 40));
    nt = Math.max(2, Math.min(nt, window.innerHeight - 24));
    pill.style.left = nl + "px";
    pill.style.top = nt + "px";
  });
  window.addEventListener("mouseup", () => {
    if (pillDrag) { pillDrag = null; pill.style.cursor = "grab"; }
  });

  calSave.addEventListener("click", () => {
    const pos = {
      left: parseFloat(pill.style.left) || 0,
      top: parseFloat(pill.style.top) || 0
    };
    pillPos = pos;
    pillCalibrating = false;
    try { chrome.storage.sync.set({ pillPos: pos, pillCalibrating: false }); } catch (_) {}
    endCalibration();
  });
  calCancel.addEventListener("click", () => {
    pillCalibrating = false;
    try { chrome.storage.sync.set({ pillCalibrating: false }); } catch (_) {}
    endCalibration();
  });

  instruction.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
    if (e.key === "Escape") { e.preventDefault(); closePanel(); }
  });

  goBtn.addEventListener("click", run);

  async function run() {
    const instr = instruction.value.trim();
    if (!instr) { setStatus("Tell Claude what to do first.", "err"); return; }
    if (!target) { setStatus("Selection was lost — re-select and try again.", "err"); return; }

    goBtn.disabled = true;
    setStatus(`<span class="spin"></span>Asking Claude…`);

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "rewrite", text: target.text, instruction: instr
      });
    } catch (e) {
      resp = { error: "Extension link lost — reload the page and try again." };
    }

    goBtn.disabled = false;

    if (!resp || resp.error) { setStatus(resp ? resp.error : "Unknown error.", "err"); return; }

    // Show a before/after preview instead of replacing immediately.
    pendingText = resp.text;
    prevOrig.textContent = target.text;
    renderPreviewAfter();            // renders plain or bold per the current mode
    editor.style.display = "none";
    preview.style.display = "block";
    setStatus("Review the change, then Apply.");
    clampIntoView();                 // preview is taller — keep it on-screen
  }

  applyBtn.addEventListener("click", () => {
    if (pendingText == null) return;
    const applied = applyResult(pendingText);
    if (applied === "replaced") { setStatus("Done ✓", "ok"); setTimeout(closePanel, 400); }
    else { setStatus("That text isn't editable — result copied to clipboard ✓", "ok"); }
  });

  backBtn.addEventListener("click", () => {
    preview.style.display = "none";
    editor.style.display = "block";
    setStatus("");
    instruction.focus();
  });

  // --- Apply the rewrite ------------------------------------------------------
  function applyResult(newText) {
    const plain = mdToPlain(newText);
    if (target.kind === "input") {
      // Inputs/textareas can't hold formatting — always plain, no stray markdown.
      const el = target.el, v = el.value;
      el.value = v.slice(0, target.start) + plain + v.slice(target.end);
      const caret = target.start + plain.length;
      try { el.setSelectionRange(target.start, caret); } catch (_) {}
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.focus();
      return "replaced";
    }
    if (target.kind === "editable") {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(target.range);
      target.host.focus();
      // execCommand is deprecated but remains the most reliable way to edit
      // contenteditable surfaces (Gmail, Slack) — it fires the events they expect.
      if (formatMode === "rich") {
        // Render **bold** as real bold, escaping everything else.
        if (document.execCommand("insertHTML", false, mdToHtml(newText))) return "replaced";
      }
      if (document.execCommand("insertText", false, plain)) return "replaced";
    }
    navigator.clipboard.writeText(plain).catch(() => {});
    return "copied";
  }
})();
