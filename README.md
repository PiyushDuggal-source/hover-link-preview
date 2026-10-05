# Hover Link Preview

A Chrome extension (Manifest V3, plain JavaScript, no build step) that shows a **preview popup** when you hover a link for a few seconds.

- Hover any `http(s)` link for **5 seconds** (configurable, 1–30 s).
- A popup opens **beside the cursor**: 16px to its right (flips to the left if there's no room), vertically centered on the cursor and always kept inside the window.
- Drag the popup by its header bar. Close it with `✕` or `Esc`.
- Sites that refuse to be framed (GitHub, Google, …) show a fallback card with an **Open in new tab** button instead of a broken page.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Reload any tabs that were already open (content scripts only attach to pages loaded after install).
5. Open the extension's **Details → Extension options** to configure it.

## Behavior

| Setting | Behavior |
| --- | --- |
| **Keep popup on screen** ON | The popup stays until you close it (`✕` / `Esc`). Hovering another link opens an additional popup. Max 6 at once (oldest is dropped). Hovering a link that already has a popup brings that popup to the front. |
| **Keep popup on screen** OFF (default) | Hover mode: one popup at a time, closes ~300 ms after the mouse leaves both the link and the popup. |

`Esc` closes the frontmost popup (works when the page, not the iframe, has focus).

**Links that are ignored:** `mailto:`, `tel:`, `javascript:`, same-page `#anchors`, and links with a `download` attribute.

## Options

- Enabled toggle
- Keep popup on screen toggle (off by default)
- Hover delay (1–30 s)
- Popup size: Small 360×270 · Medium 480×360 (default) · Large 640×480 · XL 800×600
- Domain list, matched against the **link's destination**, subdomains included (one per line). Deny-list by default (`everywhere except…`), switchable to allow-list (`only…`).

## How it works

- `content.js`: hover timer, link eligibility filter, Shadow-DOM overlay, placement, drag, close rules.
- `background.js` + `lib/frame-check.js`: before the iframe is shown, the service worker fetches the target URL's headers (`HEAD`, then `GET`) and checks `Content-Security-Policy: frame-ancestors` and `X-Frame-Options`. If framing is blocked, the fallback card is shown. An https page linking to an http URL is also shown as a fallback (mixed content). If the check itself fails, the iframe is tried anyway.
- The preview iframe is sandboxed, so it can't navigate your page.
- `options.html` / `options.js`: settings UI, stored in `chrome.storage.sync`.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save your settings. |
| `<all_urls>` (host) | Lets the service worker read the response headers of the link you hover, to detect sites that block framing. Only the hovered URL is requested; nothing is sent anywhere else. |

## Tests

```bash
# Unit tests for the framing-header logic
node test/frame-check.test.mjs

# End-to-end: content.js against test/harness.html (stubbed chrome.* APIs), driven over CDP.
# Run the server and Chrome in separate terminals:
python3 -m http.server 8765 --bind 127.0.0.1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=/tmp/hp-test about:blank
node test/e2e.mjs
```

The e2e path is macOS-specific as written (Chrome path). Needs Node 22+ for the built-in `WebSocket` and `fetch`.

## Known limits

- A page with its own strict CSP `frame-src` can block the iframe without any way to detect it, which gives a blank popup.
- Sites that serve different headers to `HEAD`/`GET` or to extension requests may be misclassified.
- Links with no real `href` (click handled by JavaScript) are ignored.
- The e2e tests use a stubbed `chrome.*` API; they don't load the packed extension.
