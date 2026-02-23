import http from 'http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeRequestHandler } from './server';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind test server.'));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

const servers: http.Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const next = servers.pop();
    if (next) {
      await closeServer(next);
    }
  }
});

describe('createBridgeRequestHandler', () => {
  it('returns health payload', async () => {
    const handler = createBridgeRequestHandler({
      host: '127.0.0.1',
      port: 17839,
      downloadsPath: '/v1/downloads',
      healthPath: '/v1/health',
      maxBodyBytes: 32 * 1024,
      requestTtlMs: 5 * 60 * 1000,
      getAppVersion: () => '1.2.3',
      queueDraftRequest: () => {},
      startDownload: async () => ({ id: 'download-1' })
    });

    const server = http.createServer((request, response) => {
      void handler(request, response);
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.appVersion).toBe('1.2.3');
  });

  it('returns 400 for invalid JSON payload', async () => {
    const handler = createBridgeRequestHandler({
      host: '127.0.0.1',
      port: 17839,
      downloadsPath: '/v1/downloads',
      healthPath: '/v1/health',
      maxBodyBytes: 32 * 1024,
      requestTtlMs: 5 * 60 * 1000,
      getAppVersion: () => '1.2.3',
      queueDraftRequest: () => {},
      startDownload: async () => ({ id: 'download-1' })
    });

    const server = http.createServer((request, response) => {
      void handler(request, response);
    });
    servers.push(server);

    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/v1/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json'
    });

    expect(response.status).toBe(400);
  });

  it('deduplicates repeated draft request ids', async () => {
    const queueDraftRequest = vi.fn();
    const handler = createBridgeRequestHandler({
      host: '127.0.0.1',
      port: 17839,
      downloadsPath: '/v1/downloads',
      healthPath: '/v1/health',
      maxBodyBytes: 32 * 1024,
      requestTtlMs: 5 * 60 * 1000,
      getAppVersion: () => '1.2.3',
      queueDraftRequest,
      startDownload: async () => ({ id: 'download-1' })
    });

    const server = http.createServer((request, response) => {
      void handler(request, response);
    });
    servers.push(server);

    const port = await listen(server);
    const body = {
      url: 'https://example.com/file.zip',
      mode: 'draft',
      requestId: 'req-123',
      source: 'chrome-extension'
    };

    const first = await fetch(`http://127.0.0.1:${port}/v1/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const firstPayload = await first.json();

    const second = await fetch(`http://127.0.0.1:${port}/v1/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const secondPayload = await second.json();

    expect(first.status).toBe(202);
    expect(firstPayload.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(secondPayload.duplicate).toBe(true);
    expect(queueDraftRequest).toHaveBeenCalledTimes(1);
  });
});
