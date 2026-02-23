import { describe, expect, it } from 'vitest';

import {
  extractFilenameHint,
  normalizeSettings,
  normalizeStats,
  sanitizeErrorMessage,
  splitAuthFromUrl
} from './bridge-domain';

describe('normalizeSettings', () => {
  it('applies defaults and trims bridge URL', () => {
    const result = normalizeSettings({
      enabled: true,
      bridgeBaseUrl: ' http://127.0.0.1:17839/ ',
      requestTimeoutMs: 1200
    });

    expect(result).toEqual({
      enabled: true,
      bridgeBaseUrl: 'http://127.0.0.1:17839',
      requestTimeoutMs: 1200
    });
  });

  it('clamps timeout boundaries', () => {
    expect(normalizeSettings({ requestTimeoutMs: 10 }).requestTimeoutMs).toBe(500);
    expect(normalizeSettings({ requestTimeoutMs: 40000 }).requestTimeoutMs).toBe(30000);
  });
});

describe('normalizeStats', () => {
  it('normalizes numeric fields and defaults invalid values', () => {
    const stats = normalizeStats({ interceptedCount: -1, fallbackCount: 3.8, lastError: '', lastInterceptedAt: 'x' });
    expect(stats.interceptedCount).toBe(0);
    expect(stats.fallbackCount).toBe(3);
    expect(stats.lastError).toBeNull();
    expect(stats.lastInterceptedAt).toBeNull();
  });
});

describe('splitAuthFromUrl', () => {
  it('strips credentialed URLs into auth payload', () => {
    const result = splitAuthFromUrl('https://alice:secret@example.com/file.zip');
    expect(result.url).toBe('https://example.com/file.zip');
    expect(result.auth).toEqual({ type: 'basic', username: 'alice', password: 'secret' });
  });
});

describe('sanitizeErrorMessage', () => {
  it('redacts credentials in error text', () => {
    const result = sanitizeErrorMessage(new Error('boom at https://bob:pw@example.com/file'));
    expect(result).toContain('https://[redacted]@example.com/file');
  });
});

describe('extractFilenameHint', () => {
  it('extracts file name from path-like values', () => {
    expect(extractFilenameHint('/tmp/files/archive.zip')).toBe('archive.zip');
    expect(extractFilenameHint('')).toBeNull();
  });
});
