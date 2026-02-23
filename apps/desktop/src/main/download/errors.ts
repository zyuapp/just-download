export function redactCredentialUrls(message: unknown): string {
  if (typeof message !== 'string' || !message) {
    return '';
  }

  return message.replace(/(https?:\/\/)([^\s/:@]+)(?::[^\s@/]*)?@/gi, '$1[redacted]@');
}

export function formatDownloadError(error: unknown): string {
  const rawMessage = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : '';

  if (!rawMessage) {
    return 'Download failed.';
  }

  const message = rawMessage.trim();
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('includes credentials')) {
    return 'This download URL includes credentials. The app now strips credentials from the URL, but this request could not be prepared. Please retry.';
  }

  if (/^HTTP\s+401\b/i.test(message)) {
    return 'Authentication failed (401). The app retried alternate auth strategies (including Digest), but the server still rejected the login.';
  }

  if (/^HTTP\s+403\b/i.test(message)) {
    return 'Access denied by server (403).';
  }

  if (/^HTTP\s+404\b/i.test(message)) {
    return 'File not found on server (404).';
  }

  if (lowerMessage.includes('fetch failed')) {
    return 'Network request failed. Check your connection and retry.';
  }

  const sanitized = redactCredentialUrls(message).replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return 'Download failed.';
  }

  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}
