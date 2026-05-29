// ============================================================================
// Claude Inline Edit — background service worker
// Handles the one thing content scripts can't do safely on their own:
// calling the Anthropic API with the user's key.
// ============================================================================

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = [
  "You are an inline text editor embedded in the user's browser.",
  "You receive a piece of selected text and an instruction describing how to change it.",
  "Rewrite the text according to the instruction.",
  "Return ONLY the rewritten text — no preamble, no explanation, no quotation marks,",
  "no markdown code fences, no 'Here is...'. Just the final text, ready to drop in place.",
  "Preserve the original language unless the instruction explicitly asks to translate.",
  "Match the original formatting (line breaks, lists) unless asked otherwise.",
  "Never use em-dashes or en-dashes. Use commas, periods, colons, parentheses, or reword instead."
].join(" ");

// Hard guarantee: strip em-dashes from the output, whatever the model did.
// (En-dashes are left alone so number ranges like "5–10" survive; the system
// prompt already tells the model to avoid them.)
function stripEmDashes(s) {
  return s
    .replace(/\s*[—―]\s*/g, ", ")   // em dash / horizontal bar → ", "
    .replace(/ {2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1");          // tidy stray space before punctuation
}

// Default style presets, seeded on first install. Users can add/edit/delete them.
// Bump PRESETS_VERSION when adding new defaults so existing installs get them
// appended (by name) without clobbering the user's own presets.
const PRESETS_VERSION = 2;
const DEFAULT_PRESETS = [
  { name: "Improve writing",      instruction: "Improve the clarity and flow of this text while keeping my meaning and tone." },
  { name: "Shorten",             instruction: "Make this shorter and more concise without losing the key information." },
  { name: "Fix grammar",         instruction: "Fix grammar, spelling, and punctuation. Do not change the meaning or tone." },
  { name: "More professional",   instruction: "Rewrite this in a more professional, polished tone." },
  { name: "More friendly",       instruction: "Rewrite this in a warmer, friendlier, more casual tone." },
  { name: "Translate → English", instruction: "Translate this into natural, fluent English." },
  { name: "Translate → Spanish", instruction: "Translate this into natural, fluent Spanish." },
  // Engineering-flavored presets for Oscar's vendor / RFQ / leadership writing.
  { name: "Vendor reply",        instruction: "Rewrite this as a clear, professional reply to a machine shop or vendor. Keep it concise and unambiguous about specs, quantities, tolerances, and dates." },
  { name: "Bullet summary",      instruction: "Turn this into a clear, concise bulleted summary of the key points." },
  { name: "More direct",         instruction: "Rewrite this to be more direct and confident, without hedging or filler. Keep it respectful." },
  { name: "More diplomatic",     instruction: "Rewrite this in a more diplomatic, tactful tone while keeping the message clear and honest." }
];

// Seed on install; on update, append any new default presets the user is missing.
chrome.runtime.onInstalled.addListener(() => ensurePresets());
chrome.runtime.onStartup.addListener(() => ensurePresets());

async function ensurePresets() {
  const { presets, model, presetsVersion } =
    await chrome.storage.sync.get(["presets", "model", "presetsVersion"]);
  const out = {};

  if (!Array.isArray(presets)) {
    out.presets = DEFAULT_PRESETS;                       // fresh install
  } else if ((presetsVersion || 0) < PRESETS_VERSION) {
    // Append defaults whose names aren't already present (don't touch the rest).
    const have = new Set(presets.map((p) => p.name));
    const merged = presets.concat(DEFAULT_PRESETS.filter((p) => !have.has(p.name)));
    if (merged.length !== presets.length) out.presets = merged;
  }
  if (!model) out.model = DEFAULT_MODEL;
  out.presetsVersion = PRESETS_VERSION;

  await chrome.storage.sync.set(out);
}

// Keyboard command (Ctrl/Cmd+Shift+K) — handled at the browser level so it works
// even on pages that swallow keydown. Tell the active tab's content script to open.
chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-inline-edit") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs && tabs[0] && tabs[0].id;
    if (id != null) chrome.tabs.sendMessage(id, { type: "open-panel" }).catch(() => {});
  });
});

// Content script asks us to rewrite text; we call the API and return the result.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "rewrite") {
    rewrite(msg.text, msg.instruction)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err && err.message || err) }));
    return true; // keep the message channel open for the async response
  }
});

async function rewrite(text, instruction) {
  const { apiKey, model } = await chrome.storage.sync.get(["apiKey", "model"]);

  if (!apiKey) {
    return { error: "No API key set. Click the extension icon to open settings and paste your Anthropic API key." };
  }

  let resp;
  try {
    resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required so Anthropic accepts a request originating from a browser context.
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `<instruction>\n${instruction}\n</instruction>\n\n` +
              `<text>\n${text}\n</text>`
          }
        ]
      })
    });
  } catch (e) {
    return { error: "Network error reaching Anthropic. Check your connection." };
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return { error: `Unexpected response from API (status ${resp.status}).` };
  }

  if (!resp.ok) {
    const m = (data && data.error && data.error.message) || `API error ${resp.status}`;
    return { error: m };
  }

  const out = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("")
    : "";

  if (!out.trim()) return { error: "Claude returned an empty result." };
  return { text: stripEmDashes(out.trim()) };
}
