const SETTINGS_KEY = 'bridgeSettings';
const STATS_KEY = 'bridgeStats';

const DEFAULT_SETTINGS = {
  enabled: true,
  bridgeBaseUrl: 'http://127.0.0.1:17839',
  requestTimeoutMs: 4000
};

const DEFAULT_STATS = {
  interceptedCount: 0,
  fallbackCount: 0,
  lastError: null,
  lastInterceptedAt: null,
  lastFallbackAt: null
};

const elements = {
  enabled: null,
  bridgeUrl: null,
  timeoutMs: null,
  saveSettings: null,
  checkBridge: null,
  statusLine: null,
  interceptedCount: null,
  fallbackCount: null,
  lastSuccess: null,
  lastFallback: null,
  lastError: null
};

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
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

function normalizeSettings(value) {
  const next = value && typeof value === 'object' ? value : {};

  return {
    enabled: next.enabled !== false,
    bridgeBaseUrl: typeof next.bridgeBaseUrl === 'string' && next.bridgeBaseUrl.trim()
      ? next.bridgeBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_SETTINGS.bridgeBaseUrl,
    requestTimeoutMs: Number.isFinite(next.requestTimeoutMs)
      ? Math.min(30000, Math.max(500, Math.floor(next.requestTimeoutMs)))
      : DEFAULT_SETTINGS.requestTimeoutMs
  };
}

function normalizeStats(value) {
  const next = value && typeof value === 'object' ? value : {};

  return {
    interceptedCount: Number.isFinite(next.interceptedCount) ? Math.max(0, Math.floor(next.interceptedCount)) : 0,
    fallbackCount: Number.isFinite(next.fallbackCount) ? Math.max(0, Math.floor(next.fallbackCount)) : 0,
    lastError: typeof next.lastError === 'string' && next.lastError ? next.lastError : null,
    lastInterceptedAt: Number.isFinite(next.lastInterceptedAt) ? next.lastInterceptedAt : null,
    lastFallbackAt: Number.isFinite(next.lastFallbackAt) ? next.lastFallbackAt : null
  };
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) {
    return 'Never';
  }

  return new Date(value).toLocaleString();
}

function setStatus(message, tone = 'neutral') {
  if (!elements.statusLine) {
    return;
  }

  elements.statusLine.textContent = message;
  elements.statusLine.classList.remove('success', 'error');

  if (tone === 'success') {
    elements.statusLine.classList.add('success');
  } else if (tone === 'error') {
    elements.statusLine.classList.add('error');
  }
}

function cacheElements() {
  elements.enabled = document.getElementById('enabled-toggle');
  elements.bridgeUrl = document.getElementById('bridge-url');
  elements.timeoutMs = document.getElementById('timeout-ms');
  elements.saveSettings = document.getElementById('save-settings');
  elements.checkBridge = document.getElementById('check-bridge');
  elements.statusLine = document.getElementById('status-line');
  elements.interceptedCount = document.getElementById('intercepted-count');
  elements.fallbackCount = document.getElementById('fallback-count');
  elements.lastSuccess = document.getElementById('last-success');
  elements.lastFallback = document.getElementById('last-fallback');
  elements.lastError = document.getElementById('last-error');
}

function renderSettings(settings) {
  if (!elements.enabled || !elements.bridgeUrl || !elements.timeoutMs) {
    return;
  }

  elements.enabled.checked = settings.enabled;
  elements.bridgeUrl.value = settings.bridgeBaseUrl;
  elements.timeoutMs.value = String(settings.requestTimeoutMs);
}

function renderStats(stats) {
  if (
    !elements.interceptedCount
    || !elements.fallbackCount
    || !elements.lastSuccess
    || !elements.lastFallback
    || !elements.lastError
  ) {
    return;
  }

  elements.interceptedCount.textContent = String(stats.interceptedCount);
  elements.fallbackCount.textContent = String(stats.fallbackCount);
  elements.lastSuccess.textContent = formatTimestamp(stats.lastInterceptedAt);
  elements.lastFallback.textContent = formatTimestamp(stats.lastFallbackAt);
  elements.lastError.textContent = stats.lastError || 'None';
}

async function loadFromStorage() {
  const stored = await storageGet([SETTINGS_KEY, STATS_KEY]);
  const settings = normalizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
  const stats = normalizeStats(stored[STATS_KEY] || DEFAULT_STATS);

  renderSettings(settings);
  renderStats(stats);
}

async function saveSettings() {
  if (!elements.enabled || !elements.bridgeUrl || !elements.timeoutMs) {
    return;
  }

  const nextSettings = normalizeSettings({
    enabled: elements.enabled.checked,
    bridgeBaseUrl: elements.bridgeUrl.value,
    requestTimeoutMs: Number.parseInt(elements.timeoutMs.value || '', 10)
  });

  await storageSet({
    [SETTINGS_KEY]: nextSettings
  });

  renderSettings(nextSettings);
}

async function checkBridge() {
  if (!elements.bridgeUrl) {
    return;
  }

  const baseUrl = elements.bridgeUrl.value.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.bridgeBaseUrl;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, 3500);

  try {
    const response = await fetch(`${baseUrl}/v1/health`, {
      method: 'GET',
      signal: timeoutController.signal
    });

    if (!response.ok) {
      throw new Error(`Desktop app returned HTTP ${response.status}.`);
    }

    setStatus('Desktop app is reachable.', 'success');
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setStatus('Desktop app check timed out.', 'error');
      return;
    }

    const message = error instanceof Error ? error.message : 'Unable to reach desktop app.';
    setStatus(message, 'error');
  } finally {
    clearTimeout(timeoutId);
  }
}

function bindEvents() {
  if (!elements.saveSettings || !elements.checkBridge) {
    return;
  }

  elements.saveSettings.addEventListener('click', async () => {
    try {
      await saveSettings();
      setStatus('Settings saved.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.';
      setStatus(message, 'error');
    }
  });

  elements.checkBridge.addEventListener('click', async () => {
    await checkBridge();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[SETTINGS_KEY]) {
      renderSettings(normalizeSettings(changes[SETTINGS_KEY].newValue || DEFAULT_SETTINGS));
    }

    if (changes[STATS_KEY]) {
      renderStats(normalizeStats(changes[STATS_KEY].newValue || DEFAULT_STATS));
    }
  });
}

async function initialize() {
  cacheElements();
  bindEvents();
  await loadFromStorage();
}

void initialize();
