export function redactCredentialUrls(message: unknown): string {
  if (typeof message !== 'string' || !message) {
    return '';
  }

  return message.replace(/(https?:\/\/)([^\s/:@]+)(?::[^\s@/]*)?@/gi, '$1[redacted]@');
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return '';
  }

  return String((error as { message?: unknown }).message || '');
}

function mapKnownDownloadError(message: string, lowerMessage: string): string | null {
  if (lowerMessage.includes('includes credentials')) {
    return 'This download URL includes credentials. The app now strips credentials from the URL, but this request could not be prepared. Please retry.';
  }

  const statusMessages: Array<[RegExp, string]> = [
    [/^HTTP\s+401\b/i, 'Authentication failed (401). The app retried alternate auth strategies (including Digest), but the server still rejected the login.'],
    [/^HTTP\s+403\b/i, 'Access denied by server (403).'],
    [/^HTTP\s+404\b/i, 'File not found on server (404).']
  ];

  for (const [pattern, replacement] of statusMessages) {
    if (pattern.test(message)) {
      return replacement;
    }
  }

  if (lowerMessage.includes('fetch failed')) {
    return 'Network request failed. Check your connection and retry.';
  }

  return null;
}

export function formatDownloadError(error: unknown): string {
  const rawMessage = readErrorMessage(error);

  if (!rawMessage) {
    return 'Download failed.';
  }

  const message = rawMessage.trim();
  const lowerMessage = message.toLowerCase();
  const knownMessage = mapKnownDownloadError(message, lowerMessage);

  if (knownMessage) {
    return knownMessage;
  }

  const sanitized = redactCredentialUrls(message).replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return 'Download failed.';
  }

  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}
