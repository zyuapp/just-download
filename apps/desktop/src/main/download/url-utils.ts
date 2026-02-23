import path from 'path';

export function parsePositiveInt(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function sanitizeFilename(filename: unknown): string {
  if (!filename || typeof filename !== 'string') {
    return 'download';
  }

  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.length > 0 ? sanitized : 'download';
}

export function filenameFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const pathname = decodeURIComponent(parsed.pathname || '');
    const name = path.basename(pathname);
    return sanitizeFilename(name || 'download');
  } catch {
    return 'download';
  }
}

export function filenameFromContentDisposition(headerValue: string | null | undefined): string | null {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(utfMatch[1]));
    } catch {
      return sanitizeFilename(utfMatch[1]);
    }
  }

  const simpleMatch = headerValue.match(/filename="?([^";]+)"?/i);
  if (simpleMatch && simpleMatch[1]) {
    return sanitizeFilename(simpleMatch[1]);
  }

  return null;
}
