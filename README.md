# Claude Inline Edit

A Chrome extension that lets you **highlight text anywhere, tell Claude how to change it, and have it rewritten in place** — no more copy → paste into a Claude tab → copy back.

- Select text → a teal **✦ Edit** pill appears next to it (or press **Ctrl/Cmd + Shift + K**)
- A small panel opens with a **style-preset dropdown** + a free-text box
- Pick a preset (Improve, Shorten, Fix grammar, Translate…) or type your own instruction, hit **Rewrite**
- See a **before / after preview**, edit the result, and keep iterating with **Rewrite ↻** — then **Apply ✓**
- If the text is **editable** (Gmail, Slack, forms) → it's replaced right there. If it's **read-only** → copied to your clipboard
- Choose **Plain** or **Bold** output, resize/pin the window, set a default preset — all in Settings

---

## Set it up with your Claude (easiest)

If you have **Claude Code**, paste this to it:

> **"Install this Chrome extension on my machine: https://github.com/oscareneriz/claude-inline-edit — follow its CLAUDE.md."**

Your Claude will download it and walk you through the (one-time) load-unpacked step and adding your API key. See [`CLAUDE.md`](CLAUDE.md) for what it does.

---

## Do it yourself (manual, ~2 min)

1. **Download** this repo: click the green **Code → Download ZIP** button above and unzip it (or `gh repo clone oscareneriz/claude-inline-edit`).
2. Open **Chrome → `chrome://extensions`**
3. Turn on **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the unzipped **`claude-inline-edit`** folder
5. Click the extension's icon (the teal ✦) to open **Settings**
6. Paste your **Anthropic API key** — get one at [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys) — pick a model, click **Save**

That's it. Go to any page, select some text, and look for the ✦ pill (or press Ctrl/Cmd+Shift+K).

---

## Notes

- **Cost:** each rewrite is a normal Anthropic API call (a few cents at most, pay-as-you-go on your API account — separate from any Claude.ai subscription).
- **Privacy:** your API key is stored only in your browser's extension storage and is sent only to `api.anthropic.com`. The selected text is sent to Anthropic to be rewritten; nothing else.
- **Models:** Haiku (fastest/cheapest), Sonnet (balanced, default), Opus (most capable). Change anytime in Settings.
- If a rewrite ever fails, the panel shows the error message (e.g. bad key, rate limit).

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker — calls the Anthropic API |
| `content.js` | Injects the pill + panel, captures selection, replaces text |
| `options.html` / `options.js` | Settings page — API key, model, presets, pill, window size |
| `icons/` | Extension icons |

## Updating

After editing any file, go to `chrome://extensions` and click the **reload ↻** icon on the card. Reload the web page too so the new content script loads.
