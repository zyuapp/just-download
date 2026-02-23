import { describe, expect, it } from 'vitest';

import {
  normalizeBridgeRequestId,
  normalizeDownloadRequest,
  parseBridgeAuth
} from './request-normalization';

describe('normalizeBridgeRequestId', () => {
  it('normalizes to a trimmed, bounded id', () => {
    const value = `  ${'x'.repeat(220)}  `;
    expect(normalizeBridgeRequestId(value)).toBe('x'.repeat(200));
  });

  it('returns empty string for non-string values', () => {
    expect(normalizeBridgeRequestId(123)).toBe('');
  });
});

describe('parseBridgeAuth', () => {
  it('parses basic auth payload', () => {
    expect(parseBridgeAuth({ type: 'basic', username: 'u', password: 'p' })).toEqual({
      type: 'basic',
      username: 'u',
      password: 'p'
    });
  });

  it('rejects unsupported auth types', () => {
    expect(() => parseBridgeAuth({ type: 'digest' })).toThrow('Only basic auth is supported.');
  });
});

describe('normalizeDownloadRequest', () => {
  it('normalizes valid HTTP URL', () => {
    const request = normalizeDownloadRequest('https://example.com/file.zip');
    expect(request.url).toBe('https://example.com/file.zip');
    expect(request.auth).toBeNull();
  });

  it('strips embedded credentials and creates auth headers', () => {
    const request = normalizeDownloadRequest('https://alice:secret@example.com/file.zip');
    expect(request.url).toBe('https://example.com/file.zip');
    expect(request.auth).toEqual({ type: 'basic', username: 'alice', password: 'secret' });
    expect(request.authorizationHeader).toMatch(/^Basic\s+/);
  });

  it('throws for non-http protocols', () => {
    expect(() => normalizeDownloadRequest('ftp://example.com/file.zip')).toThrow(
      'Only HTTP and HTTPS URLs are supported.'
    );
  });
});
