// Claude Inline Edit — settings page logic.

const $ = (id) => document.getElementById(id);
const DEFAULT_MODEL = "claude-sonnet-4-6";

let presets = [];

function flash(msg, ok = true) {
  const s = $("status");
  s.textContent = msg;
  s.className = ok ? "ok" : "err";
  setTimeout(() => { s.textContent = ""; s.className = ""; }, 2500);
}

// --- Load existing settings ---------------------------------------------------
chrome.storage.sync.get(["apiKey", "model", "presets"], (r) => {
  if (r.apiKey) $("apiKey").value = r.apiKey;
  $("model").value = r.model || DEFAULT_MODEL;
  presets = r.presets || [];
  renderPresets();
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
      <span class="name"></span>
      <span class="instr"></span>
      <button class="btn btn-danger" title="Delete">×</button>`;
    row.querySelector(".name").textContent = p.name;
    row.querySelector(".instr").textContent = p.instruction;
    row.querySelector("button").addEventListener("click", async () => {
      presets.splice(i, 1);
      await chrome.storage.sync.set({ presets });
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
