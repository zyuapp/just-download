import type http from 'http';

import { BRIDGE_MODE_DRAFT, BRIDGE_MODE_START, parseBridgePayload } from './payload';
import { normalizeDownloadRequest } from '../download/request-normalization';

type BridgeCacheEntry = {
  mode: typeof BRIDGE_MODE_START | typeof BRIDGE_MODE_DRAFT;
  downloadId: string | null;
  createdAt: number;
};

type BridgeConfig = {
  host: string;
  port: number;
  downloadsPath: string;
  healthPath: string;
  maxBodyBytes: number;
  requestTtlMs: number;
  getAppVersion: () => string;
  queueDraftRequest: (url: string, metadata: { source?: string | null; requestId?: string | null }) => void;
  startDownload: (url: string, options: { auth: unknown }) => Promise<{ id: string }>;
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

export function createBridgeRequestHandler(config: BridgeConfig) {
  const requestCache = new Map<string, BridgeCacheEntry>();

  return async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!request || !response) {
      return;
    }

    if (request.method === 'OPTIONS') {
      setBridgeResponseHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url || '/', `http://${config.host}:${config.port}`);
    } catch {
      sendBridgeJson(response, 400, {
        accepted: false,
        error: 'Invalid request URL.'
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === config.healthPath) {
      sendBridgeJson(response, 200, {
        ok: true,
        appVersion: config.getAppVersion(),
        bridge: {
          host: config.host,
          port: config.port
        }
      });
      return;
    }

    if (request.method !== 'POST' || requestUrl.pathname !== config.downloadsPath) {
      sendBridgeJson(response, 404, {
        accepted: false,
        error: 'Not found.'
      });
      return;
    }

    let rawBody = '';
    try {
      rawBody = await readBridgeRequestBody(request, config.maxBodyBytes);
    } catch (error) {
      sendBridgeJson(response, 413, {
        accepted: false,
        error: error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Payload too large.'
      });
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody || '{}');
    } catch {
      sendBridgeJson(response, 400, {
        accepted: false,
        error: 'Invalid JSON payload.'
      });
      return;
    }

    let payload;
    try {
      payload = parseBridgePayload(parsedPayload);
    } catch (error) {
      sendBridgeJson(response, 400, {
        accepted: false,
        error: error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Invalid payload.'
      });
      return;
    }

    let normalizedRequest;
    try {
      normalizedRequest = normalizeDownloadRequest(payload.url, payload.auth || null);
    } catch (error) {
      sendBridgeJson(response, 400, {
        accepted: false,
        error: error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Invalid URL.'
      });
      return;
    }

    pruneBridgeRequestCache(requestCache, config.requestTtlMs);

    if (payload.requestId && requestCache.has(payload.requestId)) {
      const cached = requestCache.get(payload.requestId);

      sendBridgeJson(response, 200, {
        accepted: true,
        duplicate: true,
        mode: cached && cached.mode ? cached.mode : BRIDGE_MODE_START,
        downloadId: cached ? cached.downloadId : null
      });
      return;
    }

    if (payload.mode === BRIDGE_MODE_DRAFT) {
      config.queueDraftRequest(normalizedRequest.url, {
        source: payload.source || 'bridge',
        requestId: payload.requestId || null
      });

      if (payload.requestId) {
        requestCache.set(payload.requestId, {
          mode: BRIDGE_MODE_DRAFT,
          downloadId: null,
          createdAt: Date.now()
        });
      }

      sendBridgeJson(response, 202, {
        accepted: true,
        duplicate: false,
        mode: BRIDGE_MODE_DRAFT,
        queued: true,
        downloadId: null
      });
      return;
    }

    try {
      const record = await config.startDownload(normalizedRequest.url, {
        auth: normalizedRequest.auth || null
      });

      if (payload.requestId) {
        requestCache.set(payload.requestId, {
          mode: BRIDGE_MODE_START,
          downloadId: record.id,
          createdAt: Date.now()
        });
      }

      sendBridgeJson(response, 202, {
        accepted: true,
        duplicate: false,
        mode: BRIDGE_MODE_START,
        downloadId: record.id
      });
    } catch (error) {
      sendBridgeJson(response, 500, {
        accepted: false,
        error: error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Failed to start download.'
      });
    }
  };
}
