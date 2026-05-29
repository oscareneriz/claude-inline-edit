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
  try {
    chrome.storage.sync.get(["presets"], (r) => { presets = (r && r.presets) || []; });
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.presets) presets = ch.presets.newValue || [];
    });
  } catch (_) {}

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
      .status { font-size: 12px; color: ${C.FG2}; margin-top: 8px; min-height: 16px; }
      .status.err { color: ${C.RED}; font-weight: 600; }
      .status.ok  { color: ${C.GRN}; font-weight: 600; }
      .spin { display: inline-block; width: 12px; height: 12px; vertical-align: -1px;
              border: 2px solid ${C.SEP}; border-top-color: ${C.ACT};
              border-radius: 50%; animation: sp .7s linear infinite; margin-right: 6px; }
      @keyframes sp { to { transform: rotate(360deg); } }
    </style>

    <div class="pill" id="pill">✦ Edit</div>

    <div class="panel" id="panel">
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

  // The selection we'll act on, captured before the panel steals focus.
  let target = null;

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
    const cap = captureSelection();
    if (!cap) { hidePill(); return; }
    const r = selectionRect();
    if (!r) { hidePill(); return; }
    target = cap;
    pill.style.display = "flex";
    const left = Math.min(r.right, window.innerWidth - 80);
    const top = Math.min(r.bottom + 6, window.innerHeight - 36);
    pill.style.left = Math.max(6, left) + "px";
    pill.style.top = Math.max(6, top) + "px";
  }
  function hidePill() { pill.style.display = "none"; }

  // Events — note: NO selectionchange listener (that was the lag source).
  document.addEventListener("mousedown", (e) => {
    // A new click/drag is starting. Clear the pill unless the click is on our UI.
    if (!e.composedPath || !e.composedPath().includes(host)) hidePill();
  }, true);

  document.addEventListener("mouseup", () => {
    // Defer one tick so the browser finalizes the selection first.
    setTimeout(showPillIfSelection, 0);
  });

  // Hide stale UI on scroll (positions are viewport-fixed).
  window.addEventListener("scroll", () => {
    hidePill();
    if (panel.style.display === "block") closePanel();
  }, true);

  // Keyboard shortcut: Ctrl/Cmd + Shift + K
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key && e.key.toLowerCase() === "k") {
      const cap = captureSelection();
      if (cap) { e.preventDefault(); target = cap; openPanel(); }
    }
  });

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
    hidePill();
    buildPresetOptions();
    setStatus("");
    instruction.value = "";
    presetSel.value = "";

    const r = selectionRect();
    panel.style.display = "block";
    const left = Math.min(r ? r.left : 60, window.innerWidth - 340);
    const top = Math.min(r ? r.bottom + 6 : 60, window.innerHeight - 230);
    panel.style.left = Math.max(8, left) + "px";
    panel.style.top = Math.max(8, top) + "px";
    setTimeout(() => instruction.focus(), 0);
  }

  function closePanel() {
    panel.style.display = "none";
    target = null;
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
  pill.addEventListener("click", openPanel);

  // Keep the page selection alive when clicking buttons inside our panel.
  // Listen on the shadow root so e.target is the real inner element.
  root.addEventListener("mousedown", (e) => {
    if (e.target === instruction || e.target === presetSel) return;
    e.preventDefault();
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

    const applied = applyResult(resp.text);
    if (applied === "replaced") { setStatus("Done ✓", "ok"); setTimeout(closePanel, 500); }
    else { setStatus("That text isn't editable — result copied to clipboard ✓", "ok"); }
  }

  // --- Apply the rewrite ------------------------------------------------------
  function applyResult(newText) {
    if (target.kind === "input") {
      const el = target.el, v = el.value;
      el.value = v.slice(0, target.start) + newText + v.slice(target.end);
      const caret = target.start + newText.length;
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
      if (document.execCommand("insertText", false, newText)) return "replaced";
    }
    navigator.clipboard.writeText(newText).catch(() => {});
    return "copied";
  }
})();
