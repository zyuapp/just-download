const SETTINGS_KEY = 'bridgeSettings';
const STATS_KEY = 'bridgeStats';

type BridgeSettings = {
  enabled: boolean;
  bridgeBaseUrl: string;
  requestTimeoutMs: number;
};

type BridgeStats = {
  interceptedCount: number;
  fallbackCount: number;
  lastError: string | null;
  lastInterceptedAt: number | null;
  lastFallbackAt: number | null;
};

type HandoffAuth = {
  type: 'basic';
  username: string;
  password: string;
};

type HandoffPayload = {
  url: string;
  requestId: string;
  mode: 'draft';
  source: 'chrome-extension';
  referrer: string | null;
  filenameHint: string | null;
  auth: HandoffAuth | null;
};

const DEFAULT_SETTINGS = Object.freeze<BridgeSettings>({
  enabled: true,
  bridgeBaseUrl: 'http://127.0.0.1:17839',
  requestTimeoutMs: 4000
});

const DESKTOP_LAUNCH_URL = 'justdownload://open?source=chrome-extension';
const DESKTOP_STARTUP_TIMEOUT_MS = 45000;
const DESKTOP_HEALTH_POLL_INTERVAL_MS = 300;
const DESKTOP_HEALTH_TIMEOUT_MS = 1500;
const DESKTOP_LAUNCH_TAB_GC_DELAY_MS = 25000;
const DESKTOP_LAUNCH_COOLDOWN_MS = 2000;

const DEFAULT_STATS = Object.freeze<BridgeStats>({
  interceptedCount: 0,
  fallbackCount: 0,
  lastError: null,
  lastInterceptedAt: null,
  lastFallbackAt: null
});

let settingsCache: BridgeSettings = { ...DEFAULT_SETTINGS };
const activeInterceptions = new Set<number>();
let lastDesktopLaunchAt = 0;

function normalizeSettings(value): BridgeSettings {
  const next = value && typeof value === 'object' ? value : {};
  const requestTimeoutMs = Number.isFinite(next.requestTimeoutMs)
    ? Math.min(30000, Math.max(500, Math.floor(next.requestTimeoutMs)))
    : DEFAULT_SETTINGS.requestTimeoutMs;

  return {
    enabled: next.enabled !== false,
    bridgeBaseUrl: typeof next.bridgeBaseUrl === 'string' && next.bridgeBaseUrl.trim()
      ? next.bridgeBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_SETTINGS.bridgeBaseUrl,
    requestTimeoutMs
  };
}

function normalizeStats(value): BridgeStats {
  const next = value && typeof value === 'object' ? value : {};

  return {
    interceptedCount: Number.isFinite(next.interceptedCount) ? Math.max(0, Math.floor(next.interceptedCount)) : 0,
    fallbackCount: Number.isFinite(next.fallbackCount) ? Math.max(0, Math.floor(next.fallbackCount)) : 0,
    lastError: typeof next.lastError === 'string' && next.lastError ? next.lastError : null,
    lastInterceptedAt: Number.isFinite(next.lastInterceptedAt) ? next.lastInterceptedAt : null,
    lastFallbackAt: Number.isFinite(next.lastFallbackAt) ? next.lastFallbackAt : null
  };
}

function storageGet(keys) {
  return new Promise<Record<string, any>>((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });
}

function storageSet(values) {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function generateRequestId(downloadId: number) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `jd-${downloadId}-${suffix}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getDownloadUrl(downloadItem: chrome.downloads.DownloadItem | null | undefined) {
  if (!downloadItem || typeof downloadItem !== 'object') {
    return '';
  }

  if (typeof downloadItem.finalUrl === 'string' && downloadItem.finalUrl.trim()) {
    return downloadItem.finalUrl.trim();
  }

  if (typeof downloadItem.url === 'string' && downloadItem.url.trim()) {
    return downloadItem.url.trim();
  }

  return '';
}

function isHttpDownloadUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function splitAuthFromUrl(url: string): { url: string; auth: HandoffAuth | null } {
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

function redactCredentialUrls(message: string) {
  if (typeof message !== 'string' || !message) {
    return '';
  }

  return message.replace(/(https?:\/\/)([^\s/:@]+)(?::[^\s@/]*)?@/gi, '$1[redacted]@');
}

function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Desktop handoff failed.');
  const sanitized = redactCredentialUrls(message).replace(/\s+/g, ' ').trim();

  if (!sanitized) {
    return 'Desktop handoff failed.';
  }

  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}

function extractFilenameHint(pathLikeValue: string | null | undefined) {
  if (typeof pathLikeValue !== 'string' || !pathLikeValue.trim()) {
    return null;
  }

  const filename = pathLikeValue.replace(/\\/g, '/').split('/').pop();
  return filename && filename.trim() ? filename.trim() : null;
}

function pauseDownload(downloadId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.downloads.pause(downloadId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function resumeDownload(downloadId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.downloads.resume(downloadId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function cancelDownload(downloadId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.downloads.cancel(downloadId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function eraseDownload(downloadId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.downloads.erase({ id: downloadId }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

function createTab(createProperties: chrome.tabs.CreateProperties) {
  return new Promise<chrome.tabs.Tab | null>((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(tab || null);
    });
  });
}

function removeTab(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

async function safeResumeDownload(downloadId: number) {
  try {
    await resumeDownload(downloadId);
  } catch {
    // best effort fallback
  }
}

async function safeCancelDownload(downloadId: number) {
  try {
    await cancelDownload(downloadId);
  } catch {
    // best effort cleanup
  }
}

async function safeEraseDownload(downloadId: number) {
  try {
    await eraseDownload(downloadId);
  } catch {
    // best effort cleanup
  }
}

async function safeRemoveTab(tabId: number) {
  try {
    await removeTab(tabId);
  } catch {
    // best effort cleanup
  }
}

async function updateStats(mutator: (stats: BridgeStats) => void) {
  const stored = await storageGet([STATS_KEY]);
  const nextStats = normalizeStats(stored[STATS_KEY] || DEFAULT_STATS);

  mutator(nextStats);

  await storageSet({
    [STATS_KEY]: nextStats
  });
}

async function ensureDefaults() {
  const stored = await storageGet([SETTINGS_KEY, STATS_KEY]);
  const updates = {};

  if (!stored[SETTINGS_KEY]) {
    updates[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
  }

  if (!stored[STATS_KEY]) {
    updates[STATS_KEY] = { ...DEFAULT_STATS };
  }

  if (Object.keys(updates).length > 0) {
    await storageSet(updates);
  }

  settingsCache = normalizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function refreshSettingsCache() {
  const stored = await storageGet([SETTINGS_KEY]);
  settingsCache = normalizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function safeReadResponse(response) {
  try {
    const text = await response.text();
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return '';
  }
}

async function checkDesktopBridgeHealth() {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, Math.min(settingsCache.requestTimeoutMs, DESKTOP_HEALTH_TIMEOUT_MS));

  try {
    const response = await fetch(`${settingsCache.bridgeBaseUrl}/v1/health`, {
      method: 'GET',
      signal: timeoutController.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function launchDesktopApp() {
  const now = Date.now();
  if (now - lastDesktopLaunchAt < DESKTOP_LAUNCH_COOLDOWN_MS) {
    return null;
  }

  lastDesktopLaunchAt = now;

  try {
    const tab = await createTab({
      url: DESKTOP_LAUNCH_URL,
      active: false
    });

    const tabId = tab && Number.isInteger(tab.id) ? tab.id : null;

    if (Number.isInteger(tabId)) {
      setTimeout(() => {
        void safeRemoveTab(tabId);
      }, DESKTOP_LAUNCH_TAB_GC_DELAY_MS);
    }

    return tabId;
  } catch {
    return null;
  }
}

async function waitForDesktopBridge() {
  const deadline = Date.now() + DESKTOP_STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const reachable = await checkDesktopBridgeHealth();
    if (reachable) {
      return true;
    }

    await sleep(DESKTOP_HEALTH_POLL_INTERVAL_MS);
  }

  return false;
}

async function ensureDesktopBridgeAvailable() {
  if (await checkDesktopBridgeHealth()) {
    return true;
  }

  const launchTabId = await launchDesktopApp();
  const bridgeAvailable = await waitForDesktopBridge();

  if (bridgeAvailable && Number.isInteger(launchTabId)) {
    void safeRemoveTab(launchTabId);
  }

  return bridgeAvailable;
}

async function handoffToDesktop(payload) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, settingsCache.requestTimeoutMs);

  try {
    const response = await fetch(`${settingsCache.bridgeBaseUrl}/v1/downloads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Just-Download-Source': 'chrome-extension',
        'X-Just-Download-Request-Id': payload.requestId
      },
      body: JSON.stringify(payload),
      signal: timeoutController.signal
    });

    if (!response.ok) {
      const details = await safeReadResponse(response);
      throw new Error(details ? `Desktop app returned HTTP ${response.status}: ${details}` : `Desktop app returned HTTP ${response.status}.`);
    }

    const responseBody = await response.json().catch(() => ({}));
    return Boolean(responseBody && responseBody.accepted);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Desktop app request timed out.');
    }

    throw error instanceof Error ? error : new Error('Desktop app request failed.');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function interceptDownload(downloadItem) {
  if (!settingsCache.enabled) {
    return;
  }

  if (!downloadItem || !Number.isInteger(downloadItem.id)) {
    return;
  }

  const downloadId = downloadItem.id;
  if (activeInterceptions.has(downloadId)) {
    return;
  }

  if (downloadItem.byExtensionId && downloadItem.byExtensionId === chrome.runtime.id) {
    return;
  }

  const sourceUrl = getDownloadUrl(downloadItem);
  if (!isHttpDownloadUrl(sourceUrl)) {
    return;
  }

  const normalizedRequest = splitAuthFromUrl(sourceUrl);

  activeInterceptions.add(downloadId);

  try {
    await pauseDownload(downloadId);

    const bridgeAvailable = await ensureDesktopBridgeAvailable();
    if (!bridgeAvailable) {
      throw new Error('Desktop app did not become ready in time.');
    }

    const requestId = generateRequestId(downloadId);
    const accepted = await handoffToDesktop({
      url: normalizedRequest.url,
      requestId,
      mode: 'draft',
      source: 'chrome-extension',
      referrer: typeof downloadItem.referrer === 'string' ? downloadItem.referrer : null,
      filenameHint: extractFilenameHint(downloadItem.filename),
      auth: normalizedRequest.auth
    });

    if (!accepted) {
      throw new Error('Desktop app did not accept this download.');
    }

    await safeCancelDownload(downloadId);
    await safeEraseDownload(downloadId);

    await updateStats((stats) => {
      stats.interceptedCount += 1;
      stats.lastInterceptedAt = Date.now();
      stats.lastError = null;
    });
  } catch (error) {
    await safeResumeDownload(downloadId);

    await updateStats((stats) => {
      stats.fallbackCount += 1;
      stats.lastFallbackAt = Date.now();
      stats.lastError = sanitizeErrorMessage(error);
    });
  } finally {
    activeInterceptions.delete(downloadId);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshSettingsCache();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SETTINGS_KEY]) {
    return;
  }

  settingsCache = normalizeSettings(changes[SETTINGS_KEY].newValue || DEFAULT_SETTINGS);
});

chrome.downloads.onCreated.addListener((downloadItem) => {
  void interceptDownload(downloadItem);
});

void ensureDefaults();

export {};
