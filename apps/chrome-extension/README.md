# Just Download Chrome Extension

This extension intercepts Chrome downloads and opens the desktop app in a confirmation-first flow.

## What it does

- Listens to `chrome.downloads.onCreated`.
- Pauses each new HTTP/HTTPS download.
- Ensures the desktop app is available:
  - checks `GET http://127.0.0.1:17839/v1/health`,
  - if unavailable, triggers `justdownload://open` to launch/focus the app,
  - waits for the local bridge to become ready.
- Sends a draft handoff to `POST /v1/downloads` with `mode: "draft"`.
- If draft handoff succeeds, cancels/removes the Chrome download entry.
- If handoff fails at any step, resumes the original Chrome download (fail-open behavior).

## Desktop app integration

The desktop app starts a local bridge server and accepts two modes:

- `mode: "start"` (default): starts download immediately.
- `mode: "draft"`: opens/focuses the app and prefills the URL dialog so the user can click **Download**.

Draft payload example:

```json
{
  "url": "https://example.com/file.zip",
  "requestId": "jd-123-uuid",
  "mode": "draft",
  "source": "chrome-extension",
  "referrer": "https://example.com",
  "filenameHint": "file.zip",
  "auth": {
    "type": "basic",
    "username": "user",
    "password": "pass"
  }
}
```

`auth` is optional and only included when a link uses inline credentials (`https://user:pass@host/...`). The extension strips credentials from the URL before handoff.

## Local development

1. Build the extension bundle:

```bash
npm run build:extension
```

2. Start the desktop app:

```bash
npm run dev:desktop
```

3. Open Chrome extension management page:

- Navigate to `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select `apps/chrome-extension/dist`

4. Verify behavior:

- Start a browser download.
- The desktop app should open/focus.
- The URL dialog should be prefilled.
- Click **Download** in desktop app to confirm.

## Monorepo scripts

- `npm run build:extension` builds `apps/chrome-extension/dist`.
- `npm run dev:extension` runs the extension build script.
- `npm run -w @just-download/chrome-extension typecheck` runs TypeScript checks for extension sources.
- `npm run dev:desktop` starts the Electron desktop app.

Extension source entry points are TypeScript (`src/background.ts`, `src/options.ts`) and compile to JavaScript in `dist/` for Chrome to load.

## Notes

- Interception is enabled by default.
- Only `http` and `https` downloads are intercepted.
- Bridge URL and timeout can be adjusted in extension options.
- Basic-auth URLs are supported without persisting credentials to disk.
