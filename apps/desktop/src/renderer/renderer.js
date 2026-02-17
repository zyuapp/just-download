const state = {
  downloads: [],
  contextTargetId: null,
  unsubscribeDownloads: null,
  theme: null
};

const elements = {
  addButton: null,
  urlDialog: null,
  urlInput: null,
  startButton: null,
  cancelButton: null,
  downloadList: null,
  emptyState: null,
  contextMenu: null,
  themeToggle: null
};

const THEME_DARK = 'dark';
const THEME_LIGHT = 'light';
const THEME_STORAGE_KEY = 'just-download:theme';
const DEFAULT_THEME = THEME_DARK;

function getNextTheme(theme) {
  return theme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
}

function applyTheme(nextTheme) {
  const resolvedTheme = nextTheme === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
  state.theme = resolvedTheme;
  document.body.dataset.theme = resolvedTheme;

  if (elements.themeToggle) {
    const nextLabelTheme = getNextTheme(resolvedTheme);
    const label = `Switch to ${nextLabelTheme} mode`;
    elements.themeToggle.setAttribute('aria-label', label);
    elements.themeToggle.title = label;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
  } catch (_error) {}
}

function initializeTheme() {
  let savedTheme = null;

  try {
    savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch (_error) {}

  applyTheme(savedTheme || DEFAULT_THEME);
}

function toggleTheme() {
  applyTheme(getNextTheme(state.theme || DEFAULT_THEME));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? Math.round(size) : size.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function statusLabel(download) {
  switch (download.status) {
    case 'downloading':
      return 'Downloading';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
    default:
      return download.status || 'Unknown';
  }
}

function getProgress(download) {
  if (!Number.isFinite(download.totalBytes) || download.totalBytes <= 0) {
    return 0;
  }

  const value = Math.round((download.downloadedBytes / download.totalBytes) * 100);
  return Math.max(0, Math.min(value, 100));
}

function getActionsMarkup(download) {
  if (download.status === 'completed') {
    return '';
  }

  const pauseOrResume = download.status === 'downloading'
    ? `
      <button class="action-btn pause-btn" data-action="pause" title="Pause">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    `
    : `
      <button class="action-btn resume-btn" data-action="resume" title="Resume">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    `;

  return `
    <div class="download-actions">
      ${pauseOrResume}
      <button class="action-btn cancel-action-btn" data-action="cancel" title="Cancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;
}

function createDownloadItem(download) {
  const item = document.createElement('article');
  item.className = `download-item state-${download.status || 'unknown'}`;
  item.dataset.id = download.id;

  const progress = getProgress(download);
  const totalLabel = download.totalBytes > 0 ? formatBytes(download.totalBytes) : 'Unknown';
  const statusClass = `status-${download.status || 'unknown'}`;
  const errorText = download.status === 'error' && download.error
    ? `<p class="download-error">${escapeHtml(download.error)}</p>`
    : '';

  item.innerHTML = `
    <div class="download-info">
      <span class="filename" title="${escapeHtml(download.filename)}">${escapeHtml(download.filename)}</span>
      <span class="status ${statusClass}">${statusLabel(download)}</span>
    </div>
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="progress-text">${formatBytes(download.downloadedBytes)} / ${totalLabel}</div>
    </div>
    ${errorText}
    ${getActionsMarkup(download)}
  `;

  if (download.status === 'completed') {
    item.classList.add('download-item-completed');

    item.addEventListener('dblclick', async () => {
      try {
        await window.electronAPI.openFile(download.id);
      } catch (error) {
        const message = error && error.message ? error.message : 'Unable to open file.';
        window.alert(message);
      }
    });

    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showContextMenu(download.id, event.clientX, event.clientY);
    });
  }

  item.querySelectorAll('.action-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();

      const action = button.dataset.action;
      try {
        if (action === 'pause') {
          await window.electronAPI.pauseDownload(download.id);
        } else if (action === 'resume') {
          await window.electronAPI.resumeDownload(download.id);
        } else if (action === 'cancel') {
          await window.electronAPI.cancelDownload(download.id);
        }
      } catch (error) {
        const message = error && error.message ? error.message : 'Action failed.';
        window.alert(message);
      }
    });
  });

  return item;
}

function renderDownloads() {
  const list = elements.downloadList;
  const empty = elements.emptyState;

  if (!list || !empty) {
    return;
  }

  list.querySelectorAll('.download-item').forEach((node) => node.remove());

  const sorted = [...state.downloads].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (sorted.length === 0) {
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  for (const download of sorted) {
    list.appendChild(createDownloadItem(download));
  }
}

function showUrlDialog() {
  elements.urlDialog.classList.remove('hidden');
  elements.urlInput.focus();
  elements.urlInput.select();
}

function hideUrlDialog() {
  elements.urlDialog.classList.add('hidden');
  elements.urlInput.value = '';
}

async function startDownloadFromInput() {
  const value = elements.urlInput.value.trim();
  if (!value) {
    return;
  }

  try {
    elements.startButton.disabled = true;
    await window.electronAPI.startDownload(value);
    hideUrlDialog();
  } catch (error) {
    const message = error && error.message ? error.message : 'Unable to start download.';
    window.alert(message);
  } finally {
    elements.startButton.disabled = false;
  }
}

function showContextMenu(downloadId, x, y) {
  state.contextTargetId = downloadId;

  const menu = elements.contextMenu;
  menu.classList.remove('hidden');

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = menu.getBoundingClientRect();

  const left = Math.min(x, viewportWidth - rect.width - 8);
  const top = Math.min(y, viewportHeight - rect.height - 8);

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function hideContextMenu() {
  state.contextTargetId = null;
  elements.contextMenu.classList.add('hidden');
}

async function handleContextMenuAction(action) {
  if (!state.contextTargetId) {
    return;
  }

  const id = state.contextTargetId;

  if (action === 'open') {
    await window.electronAPI.openFile(id);
  } else if (action === 'open-folder') {
    await window.electronAPI.openFolder(id);
  } else if (action === 'remove') {
    await window.electronAPI.removeDownload(id);
  } else if (action === 'delete') {
    await window.electronAPI.deleteDownload(id);
  }
}

async function refreshDownloads() {
  const current = await window.electronAPI.getDownloads();
  state.downloads = Array.isArray(current) ? current : [];
  renderDownloads();
}

function bindEvents() {
  elements.addButton.addEventListener('click', showUrlDialog);
  elements.cancelButton.addEventListener('click', hideUrlDialog);
  elements.startButton.addEventListener('click', startDownloadFromInput);
  elements.themeToggle.addEventListener('click', toggleTheme);

  elements.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void startDownloadFromInput();
    } else if (event.key === 'Escape') {
      hideUrlDialog();
    }
  });

  document.addEventListener('click', (event) => {
    if (!elements.contextMenu.contains(event.target)) {
      hideContextMenu();
    }
  });

  elements.contextMenu.addEventListener('click', async (event) => {
    const action = event.target.dataset.action;
    if (!action) {
      return;
    }

    try {
      await handleContextMenuAction(action);
    } catch (error) {
      const message = error && error.message ? error.message : 'Action failed.';
      window.alert(message);
    } finally {
      hideContextMenu();
    }
  });
}

function cacheElements() {
  elements.addButton = document.getElementById('add-btn');
  elements.urlDialog = document.getElementById('url-dialog');
  elements.urlInput = document.getElementById('url-input');
  elements.startButton = document.getElementById('start-download');
  elements.cancelButton = document.getElementById('cancel-dialog');
  elements.downloadList = document.getElementById('download-list');
  elements.emptyState = document.getElementById('empty-state');
  elements.contextMenu = document.getElementById('context-menu');
  elements.themeToggle = document.getElementById('theme-toggle');
}

async function initialize() {
  cacheElements();
  initializeTheme();

  const missingElement = Object.entries(elements).find(([, value]) => !value);
  if (missingElement) {
    window.alert(`Failed to initialize UI: missing element ${missingElement[0]}.`);
    return;
  }

  if (!window.electronAPI) {
    window.alert('Failed to initialize app bridge.');
    return;
  }

  bindEvents();

  state.unsubscribeDownloads = window.electronAPI.onDownloadsChanged((nextDownloads) => {
    state.downloads = Array.isArray(nextDownloads) ? nextDownloads : [];
    renderDownloads();
  });

  await refreshDownloads();
}

window.addEventListener('DOMContentLoaded', () => {
  void initialize();
});

window.addEventListener('beforeunload', () => {
  if (typeof state.unsubscribeDownloads === 'function') {
    state.unsubscribeDownloads();
  }
});
