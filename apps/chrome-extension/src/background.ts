import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  SETTINGS_KEY,
  STATS_KEY,
  extractFilenameHint,
  extractFilenameHintFromUrl,
  normalizeSettings,
  normalizeStats,
  sanitizeErrorMessage,
  splitAuthFromUrl,
  type BridgeSettings,
  type BridgeStats,
  type HandoffAuth
} from './shared/bridge-domain';

type HandoffPayload = {
  url: string;
  requestId: string;
  mode: 'draft';
  source: 'chrome-extension';
  referrer: string | null;
  filenameHint: string | null;
  auth: HandoffAuth | null;
};

type DraftDownloadRequest = {
  sourceUrl: string;
  requestIdSource: number | string;
  referrer: string | null;
  filenameHint: string | null;
};

const CONTEXT_MENU_LINK_DOWNLOAD_ID = 'download-link-with-just-download';
const CONTEXT_MENU_MEDIA_DOWNLOAD_ID = 'download-media-with-just-download';
const CONTEXT_MENU_TARGET_PATTERNS = ['http://*/*', 'https://*/*'];
const DESKTOP_LAUNCH_URL = 'justdownload://open?source=chrome-extension';
const DESKTOP_STARTUP_TIMEOUT_MS = 45000;
const DESKTOP_HEALTH_POLL_INTERVAL_MS = 300;
const DESKTOP_HEALTH_TIMEOUT_MS = 1500;
const DESKTOP_LAUNCH_TAB_GC_DELAY_MS = 25000;
const DESKTOP_LAUNCH_COOLDOWN_MS = 2000;

let settingsCache: BridgeSettings = { ...DEFAULT_SETTINGS };
const activeInterceptions = new Set<number>();
let lastDesktopLaunchAt = 0;

type StorageItems = Record<string, unknown>;

function createContextMenu() {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_LINK_DOWNLOAD_ID,
    title: 'Download link with Just Download',
    contexts: ['link'],
    targetUrlPatterns: CONTEXT_MENU_TARGET_PATTERNS
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_MEDIA_DOWNLOAD_ID,
    title: 'Download media with Just Download',
    contexts: ['image', 'video', 'audio'],
    targetUrlPatterns: CONTEXT_MENU_TARGET_PATTERNS
  });
}

function resetContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      return;
    }

    createContextMenu();
  });
}

function storageGet(keys: string[]): Promise<StorageItems> {
  return new Promise<StorageItems>((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });
}

function storageSet(values: StorageItems): Promise<void> {
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

function generateRequestId(sourceId: number | string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `jd-${sourceId}-${suffix}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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

function getContextMenuDownloadUrl(info: chrome.contextMenus.OnClickData) {
  if (info.menuItemId === CONTEXT_MENU_LINK_DOWNLOAD_ID && typeof info.linkUrl === 'string' && info.linkUrl.trim()) {
    return info.linkUrl.trim();
  }

  if (info.menuItemId === CONTEXT_MENU_MEDIA_DOWNLOAD_ID && typeof info.srcUrl === 'string' && info.srcUrl.trim()) {
    return info.srcUrl.trim();
  }

  return '';
}

function getTabReferrer(tab: chrome.tabs.Tab | undefined) {
  if (!tab || typeof tab.url !== 'string' || !isHttpDownloadUrl(tab.url)) {
    return null;
  }

  return tab.url;
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

async function sendDraftDownloadToDesktop(request: DraftDownloadRequest) {
  const normalizedRequest = splitAuthFromUrl(request.sourceUrl);
  const bridgeAvailable = await ensureDesktopBridgeAvailable();

  if (!bridgeAvailable) {
    throw new Error('Desktop app did not become ready in time.');
  }

  const accepted = await handoffToDesktop({
    url: normalizedRequest.url,
    requestId: generateRequestId(request.requestIdSource),
    mode: 'draft',
    source: 'chrome-extension',
    referrer: request.referrer,
    filenameHint: request.filenameHint,
    auth: normalizedRequest.auth
  });

  if (!accepted) {
    throw new Error('Desktop app did not accept this download.');
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

  activeInterceptions.add(downloadId);

  try {
    await pauseDownload(downloadId);

    await sendDraftDownloadToDesktop({
      sourceUrl,
      requestIdSource: downloadId,
      referrer: typeof downloadItem.referrer === 'string' ? downloadItem.referrer : null,
      filenameHint: extractFilenameHint(downloadItem.filename)
    });

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

async function handleContextMenuDownload(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) {
  if (info.menuItemId !== CONTEXT_MENU_LINK_DOWNLOAD_ID && info.menuItemId !== CONTEXT_MENU_MEDIA_DOWNLOAD_ID) {
    return;
  }

  await refreshSettingsCache();

  const sourceUrl = getContextMenuDownloadUrl(info);
  if (!isHttpDownloadUrl(sourceUrl)) {
    return;
  }

  try {
    await sendDraftDownloadToDesktop({
      sourceUrl,
      requestIdSource: 'context-menu',
      referrer: getTabReferrer(tab),
      filenameHint: extractFilenameHintFromUrl(sourceUrl)
    });

    await updateStats((stats) => {
      stats.lastError = null;
    });
  } catch (error) {
    await updateStats((stats) => {
      stats.lastError = sanitizeErrorMessage(error);
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
  resetContextMenus();
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuDownload(info, tab);
});

void ensureDefaults();

export {};
