# Claude Inline Edit

A Chrome extension that lets you **highlight text anywhere, tell Claude how to change it, and have it rewritten in place** — no more copy → paste into a Claude tab → copy back.

- Select text → a teal **✦ Edit** pill appears next to it (or press **Ctrl/Cmd + Shift + K**)
- A small panel opens with a **style-preset dropdown** + a free-text box
- Pick a preset (Improve, Shorten, Fix grammar, Translate…) or type your own instruction, hit **Rewrite**
- If the text is **editable** (Gmail, Slack, forms) → it's replaced right there
- If it's **read-only** → the result is copied to your clipboard
- Save your own presets anytime with the **＋** button, or manage them in Settings

## Install (one time)

1. Open **Chrome → `chrome://extensions`**
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder:
   `C:\Users\oscare\claude-inline-edit`
4. Click the extension's icon (the teal ✦) to open **Settings**
5. Paste your **Anthropic API key** — get one at
   [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys) —
   pick a model, click **Save**

That's it. Go to any page, select some text, and look for the ✦ pill.

## Notes

- **Cost:** each rewrite is a normal Anthropic API call (a few cents at most, billed pay-as-you-go on your API account — separate from any Claude.ai subscription).
- **Privacy:** your API key is stored only in your browser's extension storage and is sent only to `api.anthropic.com`. The selected text is sent to Anthropic to be rewritten; nothing else.
- **Models:** Haiku 4.5 (fastest/cheapest), Sonnet 4.6 (balanced, default), Opus 4.8 (most capable). Change anytime in Settings.
- If a rewrite ever fails, the panel shows the error message (e.g. bad key, rate limit).

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker — calls the Anthropic API |
| `content.js` | Injects the pill + panel, captures selection, replaces text |
| `options.html` / `options.js` | Settings page — API key, model, presets |
| `icons/` | Extension icons |

## Updating

After editing any file, go to `chrome://extensions` and click the **reload ↻** icon on the card. Reload the web page too so the new content script loads.
