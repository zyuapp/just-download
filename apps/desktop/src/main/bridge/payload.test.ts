import { describe, expect, it } from 'vitest';

import {
  BRIDGE_MODE_DRAFT,
  BRIDGE_MODE_START,
  normalizeBridgeMode,
  parseBridgePayload
} from './payload';

describe('normalizeBridgeMode', () => {
  it('defaults to start for unknown mode', () => {
    expect(normalizeBridgeMode('unknown')).toBe(BRIDGE_MODE_START);
    expect(normalizeBridgeMode(null)).toBe(BRIDGE_MODE_START);
  });

  it('accepts draft mode', () => {
    expect(normalizeBridgeMode('draft')).toBe(BRIDGE_MODE_DRAFT);
  });
});

describe('parseBridgePayload', () => {
  it('parses valid payload values', () => {
    const payload = parseBridgePayload({
      url: 'https://example.com/file.zip',
      requestId: ' req-1 ',
      source: ' chrome-extension ',
      mode: 'draft',
      auth: {
        type: 'basic',
        username: 'u',
        password: 'p'
      }
    });

    expect(payload.url).toBe('https://example.com/file.zip');
    expect(payload.requestId).toBe('req-1');
    expect(payload.source).toBe('chrome-extension');
    expect(payload.mode).toBe(BRIDGE_MODE_DRAFT);
    expect(payload.auth).toEqual({
      type: 'basic',
      username: 'u',
      password: 'p'
    });
  });

  it('throws for invalid payload objects', () => {
    expect(() => parseBridgePayload(null)).toThrow('Invalid payload.');
  });
});
