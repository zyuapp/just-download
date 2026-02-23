import { describe, expect, it } from 'vitest';

import { formatDownloadError, redactCredentialUrls } from './errors';

describe('redactCredentialUrls', () => {
  it('redacts credentials in URLs', () => {
    const input = 'Failed https://alice:secret@example.com/file.zip';
    expect(redactCredentialUrls(input)).toBe('Failed https://[redacted]@example.com/file.zip');
  });
});

describe('formatDownloadError', () => {
  it('maps known HTTP status errors', () => {
    expect(formatDownloadError({ message: 'HTTP 401 Unauthorized' })).toContain('Authentication failed');
    expect(formatDownloadError({ message: 'HTTP 404 Not Found' })).toBe('File not found on server (404).');
  });

  it('returns fallback message for empty errors', () => {
    expect(formatDownloadError({})).toBe('Download failed.');
  });

  it('redacts credential-bearing URLs in unknown errors', () => {
    expect(formatDownloadError({ message: 'Boom at https://bob:pass@example.com/a' })).toContain(
      'https://[redacted]@example.com/a'
    );
  });
});
