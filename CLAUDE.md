# Install guide for Claude Code

You are helping someone install the **Claude Inline Edit** Chrome extension. Loading an unpacked extension is a manual step in Chrome's UI (you can't click it for them), so your job is to get the files in place and give crystal-clear steps. Be friendly and concise.

## 1. Get the files onto their machine
- If you're already running inside the cloned/downloaded repo folder, use it in place.
- Otherwise clone it: `gh repo clone oscareneriz/claude-inline-edit` (or have them download the ZIP from GitHub and unzip it).
- Note the **absolute path** to the folder that contains `manifest.json` — you'll give it to them in the next step.

## 2. Walk them through loading it in Chrome
Tell the user, step by step:
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder: `<absolute path from step 1>`
4. The teal **✦** icon should appear in their toolbar.

(Same steps work in Edge at `edge://extensions`.)

## 3. Add their API key
- Tell them to click the **✦** icon to open Settings and paste an **Anthropic API key** from https://console.anthropic.com/settings/keys, then pick a model and click **Save**.
- Explain briefly: it's pay-as-you-go on their own API account (a few cents per rewrite), the key is stored only in their browser, and the selected text is sent only to Anthropic.

## 4. Show them how to use it
- Highlight text on any page → click the **✦ Edit** pill (or press **Ctrl/Cmd+Shift+K**) → pick a preset or type an instruction → **Rewrite** → review/edit the result → **Apply ✓**.

## Notes
- Nothing to build or compile — it's a plain MV3 extension.
- If they update the files later, they reload it from `chrome://extensions` (↻) and refresh the tab.
- Don't commit or push anything.
