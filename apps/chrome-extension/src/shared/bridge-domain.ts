export const SETTINGS_KEY = 'bridgeSettings';
export const STATS_KEY = 'bridgeStats';

export type BridgeSettings = {
  enabled: boolean;
  bridgeBaseUrl: string;
  requestTimeoutMs: number;
};

export type BridgeStats = {
  interceptedCount: number;
  fallbackCount: number;
  lastError: string | null;
  lastInterceptedAt: number | null;
  lastFallbackAt: number | null;
};

export type HandoffAuth = {
  type: 'basic';
  username: string;
  password: string;
};

export const DEFAULT_SETTINGS = Object.freeze<BridgeSettings>({
  enabled: true,
  bridgeBaseUrl: 'http://127.0.0.1:17839',
  requestTimeoutMs: 4000
});

export const DEFAULT_STATS = Object.freeze<BridgeStats>({
  interceptedCount: 0,
  fallbackCount: 0,
  lastError: null,
  lastInterceptedAt: null,
  lastFallbackAt: null
});

export function normalizeSettings(value: unknown): BridgeSettings {
  const next = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const requestTimeoutMs = Number.isFinite(next.requestTimeoutMs)
    ? Math.min(30000, Math.max(500, Math.floor(Number(next.requestTimeoutMs))))
    : DEFAULT_SETTINGS.requestTimeoutMs;

  return {
    enabled: next.enabled !== false,
    bridgeBaseUrl: typeof next.bridgeBaseUrl === 'string' && next.bridgeBaseUrl.trim()
      ? next.bridgeBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_SETTINGS.bridgeBaseUrl,
    requestTimeoutMs
  };
}

export function normalizeStats(value: unknown): BridgeStats {
  const next = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return {
    interceptedCount: Number.isFinite(next.interceptedCount) ? Math.max(0, Math.floor(Number(next.interceptedCount))) : 0,
    fallbackCount: Number.isFinite(next.fallbackCount) ? Math.max(0, Math.floor(Number(next.fallbackCount))) : 0,
    lastError: typeof next.lastError === 'string' && next.lastError ? next.lastError : null,
    lastInterceptedAt: Number.isFinite(next.lastInterceptedAt) ? Number(next.lastInterceptedAt) : null,
    lastFallbackAt: Number.isFinite(next.lastFallbackAt) ? Number(next.lastFallbackAt) : null
  };
}

export function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function splitAuthFromUrl(url: string): { url: string; auth: HandoffAuth | null } {
  try {
    const parsed = new URL(url);
    const hasEmbeddedAuth = Boolean(parsed.username || parsed.password);

    if (!hasEmbeddedAuth) {
      return {
        url: parsed.toString(),
        auth: null
      };
    }

    const auth: HandoffAuth = {
      type: 'basic',
      username: decodeURIComponentSafe(parsed.username || ''),
      password: decodeURIComponentSafe(parsed.password || '')
    };

    parsed.username = '';
    parsed.password = '';

    return {
      url: parsed.toString(),
      auth
    };
  } catch {
    return {
      url,
      auth: null
    };
  }
}

export function redactCredentialUrls(message: string): string {
  if (typeof message !== 'string' || !message) {
    return '';
  }

  return message.replace(/(https?:\/\/)([^\s/:@]+)(?::[^\s@/]*)?@/gi, '$1[redacted]@');
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Desktop handoff failed.');
  const sanitized = redactCredentialUrls(message).replace(/\s+/g, ' ').trim();

  if (!sanitized) {
    return 'Desktop handoff failed.';
  }

  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}

export function extractFilenameHint(pathLikeValue: string | null | undefined): string | null {
  if (typeof pathLikeValue !== 'string' || !pathLikeValue.trim()) {
    return null;
  }

  const filename = pathLikeValue.replace(/\\/g, '/').split('/').pop();
  return filename && filename.trim() ? filename.trim() : null;
}

export function formatTimestamp(value: number | null): string {
  if (!Number.isFinite(value)) {
    return 'Never';
  }

  return new Date(value).toLocaleString();
}
