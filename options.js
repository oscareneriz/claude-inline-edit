// Claude Inline Edit — settings page logic.

const $ = (id) => document.getElementById(id);
const DEFAULT_MODEL = "claude-sonnet-4-6";

let presets = [];
let defaultPreset = "";   // name of the preset preselected when the panel opens

function flash(msg, ok = true) {
  const s = $("status");
  s.textContent = msg;
  s.className = ok ? "ok" : "err";
  setTimeout(() => { s.textContent = ""; s.className = ""; }, 2500);
}

// --- Load existing settings ---------------------------------------------------
chrome.storage.sync.get(["apiKey", "model", "presets", "defaultPreset", "pillEnabled"], (r) => {
  if (r.apiKey) $("apiKey").value = r.apiKey;
  $("model").value = r.model || DEFAULT_MODEL;
  presets = r.presets || [];
  defaultPreset = r.defaultPreset || "";
  $("pillEnabled").checked = r.pillEnabled !== false;   // default ON
  renderPresets();
});

// --- Highlight pill -----------------------------------------------------------
function flashPill(msg, ok = true) {
  const s = $("pillStatus");
  s.textContent = msg;
  s.style.cssText = `font-size:13px;font-weight:600;color:${ok ? "var(--grn)" : "var(--red)"};`;
  setTimeout(() => { s.textContent = ""; }, 3500);
}

$("pillEnabled").addEventListener("change", async () => {
  await chrome.storage.sync.set({ pillEnabled: $("pillEnabled").checked });
  flashPill($("pillEnabled").checked ? "Pill on ✓" : "Pill off — use Ctrl/Cmd+Shift+K");
});

$("setPillPos").addEventListener("click", async () => {
  await chrome.storage.sync.set({ pillCalibrating: true });
  flashPill("Switch to a web page — a pill is now in the center. Drag it, then click Save position.");
});

$("resetPillPos").addEventListener("click", async () => {
  await chrome.storage.sync.set({ pillPos: null, pillCalibrating: false });
  flashPill("Pill position reset to default ✓");
});

// --- Connection (key + model) -------------------------------------------------
$("saveConn").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  const model = $("model").value;
  if (apiKey && !apiKey.startsWith("sk-ant-")) {
    flash("That doesn't look like an Anthropic key (should start with sk-ant-).", false);
    return;
  }
  await chrome.storage.sync.set({ apiKey, model });
  flash("Saved ✓");
});

// --- Presets ------------------------------------------------------------------
function renderPresets() {
  const list = $("presetList");
  list.innerHTML = "";
  if (!presets.length) {
    list.innerHTML = `<div style="color:var(--fg3);font-size:13px;">No presets yet — add one below.</div>`;
    return;
  }
  presets.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "preset";
    row.innerHTML = `
      <button class="star" title="Show this preset first when the panel opens"></button>
      <span class="name"></span>
      <span class="instr"></span>
      <button class="btn btn-danger" title="Delete">×</button>`;
    const isDefault = p.name === defaultPreset;
    const star = row.querySelector(".star");
    star.textContent = isDefault ? "★" : "☆";
    star.classList.toggle("on", isDefault);
    row.querySelector(".name").textContent = p.name;
    row.querySelector(".instr").textContent = p.instruction;

    // Star: set this preset as the default (or clear it if it already is).
    star.addEventListener("click", async () => {
      defaultPreset = isDefault ? "" : p.name;
      await chrome.storage.sync.set({ defaultPreset });
      renderPresets();
      flash(isDefault ? "Default cleared" : `“${p.name}” shows first now ✓`);
    });

    // Delete; if it was the default, clear that too.
    row.querySelector(".btn-danger").addEventListener("click", async () => {
      const removed = presets[i];
      presets.splice(i, 1);
      const patch = { presets };
      if (removed && removed.name === defaultPreset) { defaultPreset = ""; patch.defaultPreset = ""; }
      await chrome.storage.sync.set(patch);
      renderPresets();
    });

    list.appendChild(row);
  });
}

$("addPreset").addEventListener("click", async () => {
  const name = $("newName").value.trim();
  const instruction = $("newInstr").value.trim();
  if (!name || !instruction) { flash("Give the preset a name and an instruction.", false); return; }
  presets = [...presets, { name, instruction }];
  await chrome.storage.sync.set({ presets });
  $("newName").value = "";
  $("newInstr").value = "";
  renderPresets();
  flash("Preset added ✓");
});
