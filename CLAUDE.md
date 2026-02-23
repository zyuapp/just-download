# CLAUDE Guide

This guide is for agentic coding tools working in `just-download`.
It captures current build/lint/test workflows and coding conventions.
Follow this file before making changes.

## Repository Overview
- Monorepo using npm workspaces (`package.json` at root).
- Workspaces:
  - `@just-download/desktop`: Electron desktop app (TypeScript + Tailwind CSS).
  - `@just-download/chrome-extension`: MV3 extension (TypeScript + static HTML/CSS).
- Task runner: `lage` (`lage.config.js`).
- Build outputs:
  - Desktop: `apps/desktop/dist`
  - Desktop release artifacts: `apps/desktop/release`
  - Extension: `apps/chrome-extension/dist`

## Tooling Reality Check
- Package manager: npm (`package-lock.json` is canonical).
- ESLint config: present at `eslint.config.cjs` (flat config, repo-wide).
- Prettier config: not present.
- Test runner framework: Vitest (desktop + extension workspaces).
- Desktop has dedicated `lint`, `typecheck`, and `test` scripts.
- Extension has dedicated `lint`, `typecheck`, and `test` scripts.

## Install / Bootstrap
- Install dependencies: `npm install`
- Clean reinstall (if needed): `rm -rf node_modules package-lock.json && npm install`

## Command Reference

### Build
- Build all workspaces via lage: `npm run build`
- Desktop build (root shortcut): `npm run build:desktop`
- Desktop build (workspace direct): `npm run -w @just-download/desktop build`
- Extension build (root shortcut): `npm run build:extension`
- Extension build (workspace direct): `npm run -w @just-download/chrome-extension build`
- Build one workspace via lage: `npm run build -- --to @just-download/desktop`
- Build one workspace via lage: `npm run build -- --to @just-download/chrome-extension`

### Dev / Run
- Desktop dev: `npm run dev` or `npm run dev:desktop`
- Extension dev script: `npm run dev:extension` (currently just builds once)
- Desktop dev (workspace direct): `npm run -w @just-download/desktop dev`
- Extension dev (workspace direct): `npm run -w @just-download/chrome-extension dev`
- Desktop start alias: `npm run start`

### Lint / Typecheck
- Monorepo lint: `npm run lint`
- Desktop lint: `npm run -w @just-download/desktop lint`
- Extension lint: `npm run -w @just-download/chrome-extension lint`
- Desktop typecheck: `npm run -w @just-download/desktop typecheck`
- Extension typecheck: `npm run -w @just-download/chrome-extension typecheck`

### Test (including single-test guidance)
- Monorepo test pipeline: `npm run test`
- Extension tests direct: `npm run -w @just-download/chrome-extension test`
- Desktop tests direct: `npm run -w @just-download/desktop test`
- Workspace-scoped test via lage: `npm run test -- --to @just-download/chrome-extension`
- Single-test execution uses pass-through args, e.g.:
- `npm run -w <workspace> test -- <path-or-pattern>`

### Package / Release
- Package desktop macOS DMG and open release folder: `npm run package:mac`
- Workspace direct packaging and open release folder: `npm run -w @just-download/desktop package:mac`
- Generate desktop icons: `npm run -w @just-download/desktop icon:generate`

## Manual Verification
- Desktop smoke flow:
  - Start desktop: `npm run dev:desktop`
  - Add an HTTP/HTTPS URL and confirm download starts.
  - Verify pause, resume, cancel, remove, and delete actions.
  - Confirm open-file and reveal-in-folder work for completed downloads.
- Extension smoke flow:
  - Build extension: `npm run build:extension`
  - Load unpacked extension from `apps/chrome-extension/dist`.
  - Keep desktop app running while testing handoff.
  - Download an HTTP/HTTPS file in Chrome and confirm handoff.
  - In options page, run "Check Desktop Bridge".

## Architecture Pointers
- Desktop main process: `apps/desktop/src/main/main.ts`
- Desktop preload bridge: `apps/desktop/src/main/preload.ts`
- Desktop shared contracts: `apps/desktop/src/shared/types.ts`
- Desktop renderer logic: `apps/desktop/src/renderer/renderer.ts`
- Extension background worker: `apps/chrome-extension/src/background.ts`
- Extension options page logic: `apps/chrome-extension/src/options.ts`
- Bridge endpoints: `/v1/health` and `/v1/downloads` on `127.0.0.1:17839`

## Code Style and Conventions

### Formatting
- Use 2-space indentation.
- Use semicolons consistently.
- Prefer single quotes.
- Prefer `const`; use `let` only when reassignment is required.
- Keep helper functions small and composable.
- Favor early returns to reduce nesting.
- Avoid adding non-ASCII unless the file already needs it.

### Imports and Modules
- Match module style used by each file.
- In `apps/desktop/src/main/main.ts`, keep CommonJS `require`.
- In preload/renderer TypeScript files, use ESM `import`.
- Use explicit type-only imports (`import type { ... }`).
- Group imports consistently (built-ins first, then local modules).
- Do not broadly convert CommonJS <-> ESM unless required.

### TypeScript and Typing
- Desktop compiles with `strict: false`; still write explicit public types.
- Keep IPC contracts centralized in `apps/desktop/src/shared/types.ts`.
- Prefer narrow unions over loose string types.
- Avoid `any` unless there is no practical option.
- Validate untrusted payloads at runtime (IPC, HTTP, storage).
- Keep `apps/desktop/src/renderer/global.d.ts` aligned with preload APIs.

### Naming
- `camelCase`: variables, functions, object keys.
- `PascalCase`: interfaces/types and structured state shapes.
- `UPPER_SNAKE_CASE`: constants and config literals.
- Prefer descriptive names (`normalizeSettings`, `formatDownloadError`).

### Error Handling and Logging
- Throw user-meaningful errors for recoverable failures.
- Redact credentials from logs and user-visible messages.
- Use best-effort cleanup helpers (`safe*`) for non-critical teardown.
- Swallow only expected errors and include a short reason comment.
- In UI async handlers, catch and surface readable error text.
- For bridge/server failures, return structured JSON with status codes.

### Async, State, and Side Effects
- Prefer `async`/`await` over chained promises.
- Use `void` for intentional fire-and-forget listeners.
- Keep shared mutable state centralized.
- Persist durable state after state-changing mutations.
- Unsubscribe/remove listeners on unload where applicable.

### UI and Security Boundaries
- Desktop renderer uses Tailwind utility classes plus `styles.css` layers.
- Reuse CSS custom properties (`--*`) for theme values.
- Keep stable DOM IDs because renderer logic depends on them.
- Preserve accessibility attributes (`aria-*`, roles, labels).
- Maintain `contextIsolation: true` and `nodeIntegration: false`.
- Expose privileged capabilities via preload API only.
- Normalize/validate external URLs before download actions.
- Enforce bridge payload limits and malformed JSON handling.

## Agent Workflow Expectations
- Read nearby code before editing to match local patterns.
- Prefer minimal, incremental diffs over broad rewrites.
- Update docs when commands or behavior change.
- Avoid new dependencies unless task requirements justify them.
- Do not add lint/test frameworks unless explicitly requested.

## Cursor / Copilot Rules
- `.cursor/rules/`: not present.
- `.cursorrules`: not present.
- `.github/copilot-instructions.md`: not present.
- If any are added later, treat them as higher-priority instructions and merge guidance here.
