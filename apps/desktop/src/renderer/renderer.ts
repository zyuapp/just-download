type Theme = 'dark' | 'light';

interface RendererState {
  downloads: DownloadRecord[];
  contextTargetId: string | null;
  unsubscribeDownloads: (() => void) | null;
  theme: Theme | null;
}

interface ElementsState {
  addButton: HTMLButtonElement | null;
  urlDialog: HTMLElement | null;
  urlInput: HTMLInputElement | null;
  startButton: HTMLButtonElement | null;
  cancelButton: HTMLButtonElement | null;
  downloadList: HTMLElement | null;
  emptyState: HTMLElement | null;
  contextMenu: HTMLElement | null;
  themeToggle: HTMLButtonElement | null;
}

const state: RendererState = {
  downloads: [],
  contextTargetId: null,
  unsubscribeDownloads: null,
  theme: null
};

const elements: ElementsState = {
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

const THEME_DARK: Theme = 'dark';
const THEME_LIGHT: Theme = 'light';
const THEME_STORAGE_KEY = 'just-download:theme';
const DEFAULT_THEME: Theme = THEME_DARK;

function getAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error('Failed to initialize app bridge.');
  }
  return window.electronAPI;
}

function getNextTheme(theme: Theme): Theme {
  return theme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
}

function applyTheme(nextTheme: string | null): void {
  const resolvedTheme: Theme = nextTheme === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
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
  } catch (_error) {
    // ignore local storage failures
  }
}

function initializeTheme(): void {
  let savedTheme: string | null = null;

  try {
    savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch (_error) {
    // ignore local storage failures
  }

  applyTheme(savedTheme || DEFAULT_THEME);
}

function toggleTheme(): void {
  applyTheme(getNextTheme(state.theme || DEFAULT_THEME));
}

function formatBytes(bytes: number): string {
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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function statusLabel(download: DownloadRecord): string {
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

function getProgress(download: DownloadRecord): number {
  if (!Number.isFinite(download.totalBytes) || download.totalBytes <= 0) {
    return 0;
  }

  const value = Math.round((download.downloadedBytes / download.totalBytes) * 100);
  return Math.max(0, Math.min(value, 100));
}

function getActionsMarkup(download: DownloadRecord): string {
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

function createDownloadItem(download: DownloadRecord): HTMLElement {
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
        await getAPI().openFile(download.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to open file.';
        window.alert(message);
      }
    });

    item.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      showContextMenu(download.id, event.clientX, event.clientY);
    });
  }

  const actionButtons = item.querySelectorAll<HTMLButtonElement>('.action-btn');
  actionButtons.forEach((button) => {
    button.addEventListener('click', async (event: MouseEvent) => {
      event.stopPropagation();

      const action = button.dataset.action;
      try {
        if (action === 'pause') {
          await getAPI().pauseDownload(download.id);
        } else if (action === 'resume') {
          await getAPI().resumeDownload(download.id);
        } else if (action === 'cancel') {
          await getAPI().cancelDownload(download.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed.';
        window.alert(message);
      }
    });
  });

  return item;
}

function renderDownloads(): void {
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

function showUrlDialog(): void {
  if (!elements.urlDialog || !elements.urlInput) {
    return;
  }

  elements.urlDialog.classList.remove('hidden');
  elements.urlInput.focus();
  elements.urlInput.select();
}

function hideUrlDialog(): void {
  if (!elements.urlDialog || !elements.urlInput) {
    return;
  }

  elements.urlDialog.classList.add('hidden');
  elements.urlInput.value = '';
}

async function startDownloadFromInput(): Promise<void> {
  if (!elements.urlInput || !elements.startButton) {
    return;
  }

  const value = elements.urlInput.value.trim();
  if (!value) {
    return;
  }

  try {
    elements.startButton.disabled = true;
    await getAPI().startDownload(value);
    hideUrlDialog();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start download.';
    window.alert(message);
  } finally {
    elements.startButton.disabled = false;
  }
}

function showContextMenu(downloadId: string, x: number, y: number): void {
  state.contextTargetId = downloadId;

  const menu = elements.contextMenu;
  if (!menu) {
    return;
  }

  menu.classList.remove('hidden');

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = menu.getBoundingClientRect();

  const left = Math.min(x, viewportWidth - rect.width - 8);
  const top = Math.min(y, viewportHeight - rect.height - 8);

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function hideContextMenu(): void {
  state.contextTargetId = null;
  if (elements.contextMenu) {
    elements.contextMenu.classList.add('hidden');
  }
}

async function handleContextMenuAction(action: string): Promise<void> {
  if (!state.contextTargetId) {
    return;
  }

  const id = state.contextTargetId;

  if (action === 'open') {
    await getAPI().openFile(id);
  } else if (action === 'open-folder') {
    await getAPI().openFolder(id);
  } else if (action === 'remove') {
    await getAPI().removeDownload(id);
  } else if (action === 'delete') {
    await getAPI().deleteDownload(id);
  }
}

async function refreshDownloads(): Promise<void> {
  const current = await getAPI().getDownloads();
  state.downloads = Array.isArray(current) ? current : [];
  renderDownloads();
}

function bindEvents(): void {
  if (
    !elements.addButton
    || !elements.cancelButton
    || !elements.startButton
    || !elements.themeToggle
    || !elements.urlInput
    || !elements.contextMenu
  ) {
    return;
  }

  elements.addButton.addEventListener('click', showUrlDialog);
  elements.cancelButton.addEventListener('click', hideUrlDialog);
  elements.startButton.addEventListener('click', () => {
    void startDownloadFromInput();
  });
  elements.themeToggle.addEventListener('click', toggleTheme);

  elements.urlInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      void startDownloadFromInput();
    } else if (event.key === 'Escape') {
      hideUrlDialog();
    }
  });

  document.addEventListener('click', (event: MouseEvent) => {
    if (!elements.contextMenu) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      hideContextMenu();
      return;
    }

    if (!elements.contextMenu.contains(target)) {
      hideContextMenu();
    }
  });

  elements.contextMenu.addEventListener('click', async (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionElement = target.closest<HTMLElement>('[data-action]');
    const action = actionElement?.dataset.action;
    if (!action) {
      return;
    }

    try {
      await handleContextMenuAction(action);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.';
      window.alert(message);
    } finally {
      hideContextMenu();
    }
  });
}

function cacheElements(): void {
  elements.addButton = document.getElementById('add-btn') as HTMLButtonElement | null;
  elements.urlDialog = document.getElementById('url-dialog');
  elements.urlInput = document.getElementById('url-input') as HTMLInputElement | null;
  elements.startButton = document.getElementById('start-download') as HTMLButtonElement | null;
  elements.cancelButton = document.getElementById('cancel-dialog') as HTMLButtonElement | null;
  elements.downloadList = document.getElementById('download-list');
  elements.emptyState = document.getElementById('empty-state');
  elements.contextMenu = document.getElementById('context-menu');
  elements.themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement | null;
}

async function initialize(): Promise<void> {
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

  state.unsubscribeDownloads = getAPI().onDownloadsChanged((nextDownloads) => {
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
