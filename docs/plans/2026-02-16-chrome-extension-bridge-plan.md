# Chrome Extension Bridge Plan

**Date**: 2026-02-16
**Project**: Chrome auto-intercept -> desktop download handoff

## Goal

Capture Chrome download clicks automatically and route all HTTP/HTTPS downloads into the Just Download desktop pipeline.

## Architecture

### 1) Chrome Extension (`apps/chrome-extension`)

- Manifest V3 extension with a background service worker.
- Uses `chrome.downloads.onCreated` to intercept downloads.
- Pauses new downloads and sends a handoff request to local desktop bridge.
- Extracts inline basic auth credentials from credentialed URLs and sends them separately.
- On success: cancels and erases Chrome download record.
- On failure: resumes Chrome download so users do not lose downloads.

### 2) Desktop Bridge (`apps/desktop/src/main/main.ts`)

- Local HTTP server bound to `127.0.0.1:17839`.
- Endpoints:
  - `GET /v1/health`
  - `POST /v1/downloads`
- Validates URL input and reuses existing `startDownload(...)` workflow.
- Supports optional basic-auth headers in memory (credentials are not persisted).
- Supports idempotency via `requestId` with in-memory TTL cache.

## Build and workspace integration

- New workspace package: `@just-download/chrome-extension`.
- Root scripts include `dev:extension` and `build:extension`.
- Extension build copies `manifest.json` and `src/*` into `dist/`.
- `apps/chrome-extension/dist` is ignored in git.

## Validation checklist

- Desktop app running: extension handoff succeeds, Chrome entry is removed, desktop queue receives item.
- Desktop app stopped: extension resumes native Chrome download.
- Non HTTP/HTTPS links: ignored by extension.
- Duplicate retries with same `requestId`: desktop responds with duplicate acceptance.
