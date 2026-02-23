import type http from 'http';

import {
  BRIDGE_MODE_DRAFT,
  BRIDGE_MODE_START,
  parseBridgePayload,
  type BridgePayload
} from './payload';
import { normalizeDownloadRequest } from '../download/request-normalization';

type BridgeCacheEntry = {
  mode: typeof BRIDGE_MODE_START | typeof BRIDGE_MODE_DRAFT;
  downloadId: string | null;
  createdAt: number;
};

type BridgeQueueMetadata = {
  source?: string | null;
  requestId?: string | null;
};

type BridgeStartOptions = {
  auth: unknown;
};

type BridgeStartResult = {
  id: string;
};

type ParsedBridgeRequest = {
  payload: BridgePayload;
  normalizedUrl: string;
};

type BridgeConfig = {
  host: string;
  port: number;
  downloadsPath: string;
  healthPath: string;
  maxBodyBytes: number;
  requestTtlMs: number;
  getAppVersion: () => string;
  queueDraftRequest: (url: string, metadata: BridgeQueueMetadata) => void;
  startDownload: (url: string, options: BridgeStartOptions) => Promise<BridgeStartResult>;
};

function setBridgeResponseHeaders(response: http.ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Just-Download-Source, X-Just-Download-Request-Id');
  response.setHeader('Cache-Control', 'no-store');
}

function sendBridgeJson(response: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  setBridgeResponseHeaders(response);
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
}

function pruneBridgeRequestCache(cache: Map<string, BridgeCacheEntry>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;

  for (const [requestId, entry] of cache.entries()) {
    if (!entry || !Number.isFinite(entry.createdAt) || entry.createdAt < cutoff) {
      cache.delete(requestId);
    }
  }
}

function readBridgeErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return fallback;
  }

  return String((error as { message?: unknown }).message || fallback);
}

function readBridgeRequestBody(request: http.IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    let body = '';

    request.setEncoding('utf8');

    request.on('data', (chunk) => {
      if (overflow) {
        return;
      }

      size += Buffer.byteLength(chunk, 'utf8');
      if (size > maxBodyBytes) {
        overflow = true;
        return;
      }

      body += chunk;
    });

    request.on('end', () => {
      if (overflow) {
        reject(new Error('Payload too large.'));
        return;
      }

      resolve(body);
    });

    request.on('error', reject);
  });
}

function readRequestUrl(request: http.IncomingMessage, config: BridgeConfig): URL | null {
  try {
    return new URL(request.url || '/', `http://${config.host}:${config.port}`);
  } catch {
    return null;
  }
}

function handleHealthRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  config: BridgeConfig
): boolean {
  if (request.method !== 'GET' || requestUrl.pathname !== config.healthPath) {
    return false;
  }

  sendBridgeJson(response, 200, {
    ok: true,
    appVersion: config.getAppVersion(),
    bridge: {
      host: config.host,
      port: config.port
    }
  });
  return true;
}

async function parseBridgePostRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: BridgeConfig
): Promise<BridgePayload | null> {
  let rawBody = '';
  try {
    rawBody = await readBridgeRequestBody(request, config.maxBodyBytes);
  } catch (error) {
    sendBridgeJson(response, 413, {
      accepted: false,
      error: readBridgeErrorMessage(error, 'Payload too large.')
    });
    return null;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody || '{}');
  } catch {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: 'Invalid JSON payload.'
    });
    return null;
  }

  try {
    return parseBridgePayload(parsedPayload);
  } catch (error) {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: readBridgeErrorMessage(error, 'Invalid payload.')
    });
    return null;
  }
}

function normalizeBridgeRequest(
  payload: BridgePayload,
  response: http.ServerResponse
): ParsedBridgeRequest | null {
  try {
    const normalizedRequest = normalizeDownloadRequest(payload.url, payload.auth || null);
    return {
      payload,
      normalizedUrl: normalizedRequest.url
    };
  } catch (error) {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: readBridgeErrorMessage(error, 'Invalid URL.')
    });
    return null;
  }
}

function sendCachedDuplicateResponse(
  payload: BridgePayload,
  requestCache: Map<string, BridgeCacheEntry>,
  response: http.ServerResponse
): boolean {
  if (!payload.requestId || !requestCache.has(payload.requestId)) {
    return false;
  }

  const cached = requestCache.get(payload.requestId);
  sendBridgeJson(response, 200, {
    accepted: true,
    duplicate: true,
    mode: cached && cached.mode ? cached.mode : BRIDGE_MODE_START,
    downloadId: cached ? cached.downloadId : null
  });
  return true;
}

function rememberBridgeRequest(
  payload: BridgePayload,
  requestCache: Map<string, BridgeCacheEntry>,
  mode: typeof BRIDGE_MODE_START | typeof BRIDGE_MODE_DRAFT,
  downloadId: string | null
): void {
  if (!payload.requestId) {
    return;
  }

  requestCache.set(payload.requestId, {
    mode,
    downloadId,
    createdAt: Date.now()
  });
}

function handleDraftBridgeRequest(
  payload: BridgePayload,
  normalizedUrl: string,
  requestCache: Map<string, BridgeCacheEntry>,
  response: http.ServerResponse,
  config: BridgeConfig
): void {
  config.queueDraftRequest(normalizedUrl, {
    source: payload.source || 'bridge',
    requestId: payload.requestId || null
  });

  rememberBridgeRequest(payload, requestCache, BRIDGE_MODE_DRAFT, null);

  sendBridgeJson(response, 202, {
    accepted: true,
    duplicate: false,
    mode: BRIDGE_MODE_DRAFT,
    queued: true,
    downloadId: null
  });
}

async function handleStartBridgeRequest(
  payload: BridgePayload,
  normalizedUrl: string,
  requestCache: Map<string, BridgeCacheEntry>,
  response: http.ServerResponse,
  config: BridgeConfig
): Promise<void> {
  try {
    const record = await config.startDownload(normalizedUrl, {
      auth: payload.auth || null
    });

    rememberBridgeRequest(payload, requestCache, BRIDGE_MODE_START, record.id);

    sendBridgeJson(response, 202, {
      accepted: true,
      duplicate: false,
      mode: BRIDGE_MODE_START,
      downloadId: record.id
    });
  } catch (error) {
    sendBridgeJson(response, 500, {
      accepted: false,
      error: readBridgeErrorMessage(error, 'Failed to start download.')
    });
  }
}

async function handleBridgeDownloadRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: BridgeConfig,
  requestCache: Map<string, BridgeCacheEntry>
): Promise<void> {
  const payload = await parseBridgePostRequest(request, response, config);
  if (!payload) {
    return;
  }

  const parsedRequest = normalizeBridgeRequest(payload, response);
  if (!parsedRequest) {
    return;
  }

  pruneBridgeRequestCache(requestCache, config.requestTtlMs);
  if (sendCachedDuplicateResponse(payload, requestCache, response)) {
    return;
  }

  if (payload.mode === BRIDGE_MODE_DRAFT) {
    handleDraftBridgeRequest(payload, parsedRequest.normalizedUrl, requestCache, response, config);
    return;
  }

  await handleStartBridgeRequest(payload, parsedRequest.normalizedUrl, requestCache, response, config);
}

async function handleBridgeRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: BridgeConfig,
  requestCache: Map<string, BridgeCacheEntry>
): Promise<void> {
  if (!request || !response) {
    return;
  }

  if (request.method === 'OPTIONS') {
    setBridgeResponseHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  const requestUrl = readRequestUrl(request, config);
  if (!requestUrl) {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: 'Invalid request URL.'
    });
    return;
  }

  if (handleHealthRequest(request, response, requestUrl, config)) {
    return;
  }

  if (request.method !== 'POST' || requestUrl.pathname !== config.downloadsPath) {
    sendBridgeJson(response, 404, {
      accepted: false,
      error: 'Not found.'
    });
    return;
  }

  await handleBridgeDownloadRequest(request, response, config, requestCache);
}

export function createBridgeRequestHandler(config: BridgeConfig) {
  const requestCache = new Map<string, BridgeCacheEntry>();

  return async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    await handleBridgeRequest(request, response, config, requestCache);
  };
}
