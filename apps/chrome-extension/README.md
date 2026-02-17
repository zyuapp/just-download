# Just Download Chrome Extension

This extension intercepts Chrome downloads and hands them to the desktop app via a local bridge.

## What it does

- Listens to `chrome.downloads.onCreated`.
- Pauses each new HTTP/HTTPS download.
- Sends the URL to the desktop app bridge: `POST http://127.0.0.1:17839/v1/downloads`.
- If handoff succeeds, cancels and removes the Chrome download entry.
- If handoff fails, resumes the original Chrome download (fail-open behavior).

## Desktop app integration

The desktop app now starts a local bridge server on startup:

- Health endpoint: `GET /v1/health`
- Download endpoint: `POST /v1/downloads`

Expected payload:

```json
{
  "url": "https://example.com/file.zip",
  "requestId": "jd-123-uuid",
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

The desktop side validates the URL, deduplicates by `requestId`, and starts the existing download pipeline with request headers when auth is present.

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

4. Open extension options and verify bridge connectivity:

- Click **Details** -> **Extension options**
- Use **Check Desktop Bridge**

## Monorepo scripts

- `npm run build:extension` builds `apps/chrome-extension/dist`.
- `npm run dev:extension` runs the extension build script.
- `npm run dev:desktop` starts the Electron desktop app.

## Notes

- Interception is enabled by default.
- Only `http` and `https` downloads are intercepted.
- Bridge URL and timeout can be adjusted in extension options.
- Basic-auth URLs are supported without persisting credentials to disk.
