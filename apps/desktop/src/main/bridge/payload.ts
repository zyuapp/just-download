import { normalizeBridgeRequestId, parseBridgeAuth, type BasicAuth } from '../download/request-normalization';

export const BRIDGE_MODE_START = 'start';
export const BRIDGE_MODE_DRAFT = 'draft';

export type BridgeMode = typeof BRIDGE_MODE_START | typeof BRIDGE_MODE_DRAFT;

export interface BridgePayload {
  url: string;
  requestId: string;
  source: string;
  referrer: string | null;
  filenameHint: string | null;
  mode: BridgeMode;
  auth: BasicAuth | null;
}

export function normalizeBridgeMode(value: unknown): BridgeMode {
  if (typeof value !== 'string') {
    return BRIDGE_MODE_START;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === BRIDGE_MODE_DRAFT ? BRIDGE_MODE_DRAFT : BRIDGE_MODE_START;
}

export function parseBridgePayload(payload: unknown, maxAuthFieldLength = 1024): BridgePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload.');
  }

  const rawPayload = payload as {
    url?: unknown;
    requestId?: unknown;
    source?: unknown;
    referrer?: unknown;
    filenameHint?: unknown;
    mode?: unknown;
    auth?: unknown;
  };

  const url = typeof rawPayload.url === 'string' ? rawPayload.url.trim() : '';
  const requestId = normalizeBridgeRequestId(rawPayload.requestId);
  const source = typeof rawPayload.source === 'string' ? rawPayload.source.trim().slice(0, 100) : '';
  const referrer = typeof rawPayload.referrer === 'string' ? rawPayload.referrer.trim() : null;
  const filenameHint = typeof rawPayload.filenameHint === 'string' ? rawPayload.filenameHint.trim() : null;
  const mode = normalizeBridgeMode(rawPayload.mode);
  const auth = parseBridgeAuth(rawPayload.auth, maxAuthFieldLength);

  return {
    url,
    requestId,
    source,
    referrer,
    filenameHint,
    mode,
    auth
  };
}
