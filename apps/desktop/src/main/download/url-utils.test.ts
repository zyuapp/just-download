import { describe, expect, it } from 'vitest';

import {
  filenameFromContentDisposition,
  filenameFromUrl,
  parsePositiveInt,
  sanitizeFilename
} from './url-utils';

describe('parsePositiveInt', () => {
  it('returns parsed positive integers', () => {
    expect(parsePositiveInt('42')).toBe(42);
    expect(parsePositiveInt(7)).toBe(7);
  });

  it('returns zero for invalid inputs', () => {
    expect(parsePositiveInt('')).toBe(0);
    expect(parsePositiveInt('abc')).toBe(0);
    expect(parsePositiveInt('-1')).toBe(0);
  });
});

describe('sanitizeFilename', () => {
  it('replaces invalid filename characters', () => {
    expect(sanitizeFilename('report:2026?.zip')).toBe('report_2026_.zip');
  });

  it('falls back to download for invalid values', () => {
    expect(sanitizeFilename('   ')).toBe('download');
    expect(sanitizeFilename(null)).toBe('download');
  });
});

describe('filenameFromUrl', () => {
  it('extracts filename from URL path', () => {
    expect(filenameFromUrl('https://example.com/files/archive.zip')).toBe('archive.zip');
  });

  it('decodes encoded path segments', () => {
    expect(filenameFromUrl('https://example.com/files/hello%20world.txt')).toBe('hello world.txt');
  });

  it('falls back when URL cannot be parsed', () => {
    expect(filenameFromUrl('not-a-url')).toBe('download');
  });
});

describe('filenameFromContentDisposition', () => {
  it('extracts quoted filename', () => {
    const header = 'attachment; filename="example.txt"';
    expect(filenameFromContentDisposition(header)).toBe('example.txt');
  });

  it('extracts RFC5987 UTF-8 filename', () => {
    const header = "attachment; filename*=UTF-8''hello%20world.zip";
    expect(filenameFromContentDisposition(header)).toBe('hello world.zip');
  });

  it('returns null when header does not include filename', () => {
    expect(filenameFromContentDisposition('inline')).toBeNull();
  });
});
