type Theme = 'dark' | 'light';

interface RendererState {
  downloads: DownloadRecord[];
  downloadSpeeds: Map<string, DownloadSpeedState>;
  downloadItems: Map<string, HTMLElement>;
  contextTargetId: string | null;
  unsubscribeDownloads: (() => void) | null;
  unsubscribeDrafts: (() => void) | null;
  theme: Theme | null;
}

interface DownloadSpeedState {
  lastBytes: number;
  lastTimestamp: number;
  bytesPerSecond: number;
  lastStatus: DownloadRecord['status'];
}

interface ElementsState {
  addButton: HTMLButtonElement | null;
  urlDialog: HTMLElement | null;
  urlDialogBackdrop: HTMLElement | null;
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
  downloadSpeeds: new Map(),
  downloadItems: new Map(),
  contextTargetId: null,
  unsubscribeDownloads: null,
  unsubscribeDrafts: null,
  theme: null
};

const elements: ElementsState = {
  addButton: null,
  urlDialog: null,
  urlDialogBackdrop: null,
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
const SPEED_SMOOTHING_FACTOR = 0.35;

const DOWNLOAD_ITEM_BASE_CLASS = 'download-item rounded-[12px] border border-[var(--border)] bg-[var(--surface-strong)] p-[13px] shadow-[var(--shadow-card)] transition-[transform,border-color,background-color] duration-150 ease-out hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]';
const DOWNLOAD_INFO_CLASS = 'mb-[7px] flex items-start justify-between gap-[10px] max-[760px]:flex-col max-[760px]:items-start';
const FILENAME_CLASS = 'flex-1 break-words text-[14px] font-[620] text-[var(--text-title)]';
const PROGRESS_TRACK_CLASS = 'h-[9px] overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--border)_76%,transparent)] bg-[var(--progress-track)]';
const PROGRESS_TEXT_CLASS = 'mt-[6px] text-[11px] uppercase tracking-[0.04em] text-[var(--text-faint)]';
const ACTION_KEY_SEPARATOR = ':';

type DownloadAction = 'pause' | 'resume' | 'cancel';

const pendingActions = new Set<string>();

function getAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error('Failed to initialize app bridge.');
  }
  return window.electronAPI;
}

function isDownloadAction(action: string | undefined): action is DownloadAction {
  return action === 'pause' || action === 'resume' || action === 'cancel';
}

function getActionKey(downloadId: string, action: DownloadAction): string {
  return `${downloadId}${ACTION_KEY_SEPARATOR}${action}`;
}

async function runDownloadAction(downloadId: string, action: DownloadAction): Promise<void> {
  const actionKey = getActionKey(downloadId, action);
  if (pendingActions.has(actionKey)) {
    return;
  }

  pendingActions.add(actionKey);

  try {
    if (action === 'pause') {
      await getAPI().pauseDownload(downloadId);
    } else if (action === 'resume') {
      await getAPI().resumeDownload(downloadId);
    } else {
      await getAPI().cancelDownload(downloadId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed.';
    window.alert(message);
  } finally {
    pendingActions.delete(actionKey);
  }
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

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function getNowTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function getSafeDownloadedBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function updateDownloadSpeeds(downloads: DownloadRecord[]): void {
  const timestamp = getNowTimestamp();
  const nextSpeeds = new Map<string, DownloadSpeedState>();

  for (const download of downloads) {
    const downloadedBytes = getSafeDownloadedBytes(download.downloadedBytes);
    const previous = state.downloadSpeeds.get(download.id);

    if (!previous) {
      nextSpeeds.set(download.id, {
        lastBytes: downloadedBytes,
        lastTimestamp: timestamp,
        bytesPerSecond: 0,
        lastStatus: download.status
      });
      continue;
    }

    if (download.status !== 'downloading') {
      nextSpeeds.set(download.id, {
        lastBytes: downloadedBytes,
        lastTimestamp: timestamp,
        bytesPerSecond: 0,
        lastStatus: download.status
      });
      continue;
    }

    if (previous.lastStatus !== 'downloading') {
      nextSpeeds.set(download.id, {
        lastBytes: downloadedBytes,
        lastTimestamp: timestamp,
        bytesPerSecond: 0,
        lastStatus: download.status
      });
      continue;
    }

    const elapsedMs = timestamp - previous.lastTimestamp;
    const deltaBytes = downloadedBytes - previous.lastBytes;

    let measuredBytesPerSecond = 0;
    if (elapsedMs > 0 && deltaBytes > 0) {
      measuredBytesPerSecond = (deltaBytes * 1000) / elapsedMs;
    }

    const normalizedSpeed = Number.isFinite(measuredBytesPerSecond) && measuredBytesPerSecond > 0
      ? measuredBytesPerSecond
      : 0;

    const smoothedSpeed = previous.bytesPerSecond > 0 && normalizedSpeed > 0
      ? (previous.bytesPerSecond * (1 - SPEED_SMOOTHING_FACTOR)) + (normalizedSpeed * SPEED_SMOOTHING_FACTOR)
      : normalizedSpeed;

    nextSpeeds.set(download.id, {
      lastBytes: downloadedBytes,
      lastTimestamp: timestamp,
      bytesPerSecond: smoothedSpeed,
      lastStatus: download.status
    });
  }

  state.downloadSpeeds = nextSpeeds;
}

function getDownloadSpeed(download: DownloadRecord): number {
  if (download.status !== 'downloading') {
    return 0;
  }

  const speedState = state.downloadSpeeds.get(download.id);
  return speedState && speedState.bytesPerSecond > 0 ? speedState.bytesPerSecond : 0;
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
      <button class="action-btn" data-action="pause" title="Pause">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    `
    : `
      <button class="action-btn" data-action="resume" title="Resume">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    `;

  return `
    <div class="mt-[11px] flex gap-2">
      ${pauseOrResume}
      <button class="action-btn" data-action="cancel" title="Cancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;
}

function getDownloadRecord(downloadId: string): DownloadRecord | undefined {
  return state.downloads.find((entry) => entry.id === downloadId);
}

function bindActionButtons(item: HTMLElement, downloadId: string): void {
  const actionButtons = item.querySelectorAll<HTMLButtonElement>('.action-btn');
  actionButtons.forEach((button) => {
    const triggerAction = (action: string | undefined): void => {
      if (!isDownloadAction(action)) {
        return;
      }

      void runDownloadAction(downloadId, action);
    };

    button.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      triggerAction(button.dataset.action);
    });

    button.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      triggerAction(button.dataset.action);
    });
  });
}

function updateDownloadItem(item: HTMLElement, download: DownloadRecord): void {
  const statusValue = download.status || 'unknown';
  const progress = getProgress(download);
  const totalLabel = download.totalBytes > 0 ? formatBytes(download.totalBytes) : 'Unknown';
  const progressLabel = `${formatBytes(download.downloadedBytes)} / ${totalLabel}`;
  const speedLabel = download.status === 'downloading'
    ? ` | ${formatSpeed(getDownloadSpeed(download))}`
    : '';
  const errorText = download.status === 'error' && download.error
    ? `
      <div class="download-error" role="alert" aria-live="polite">
        <div class="download-error-label">Download failed</div>
        <p class="download-error-message">${escapeHtml(download.error)}</p>
      </div>
    `
    : '';

  item.dataset.status = statusValue;
  if (download.status === 'completed') {
    item.classList.add('cursor-pointer');
  } else {
    item.classList.remove('cursor-pointer');
  }

  item.innerHTML = `
    <div class="${DOWNLOAD_INFO_CLASS}">
      <span class="${FILENAME_CLASS}" title="${escapeHtml(download.filename)}">${escapeHtml(download.filename)}</span>
      <span class="status-chip" data-status="${statusValue}">${statusLabel(download)}</span>
    </div>
    <div class="mt-[8px]">
      <div class="${PROGRESS_TRACK_CLASS}">
        <div class="progress-fill" data-status="${statusValue}" style="width: ${progress}%"></div>
      </div>
      <div class="${PROGRESS_TEXT_CLASS}">${progressLabel}${speedLabel}</div>
    </div>
    ${errorText}
    ${getActionsMarkup(download)}
  `;

  bindActionButtons(item, download.id);
}

function createDownloadItem(download: DownloadRecord): HTMLElement {
  const item = document.createElement('article');
  item.className = DOWNLOAD_ITEM_BASE_CLASS;
  item.dataset.id = download.id;

  item.addEventListener('dblclick', async () => {
    const downloadId = item.dataset.id;
    if (!downloadId) {
      return;
    }

    const current = getDownloadRecord(downloadId);
    if (!current || current.status !== 'completed') {
      return;
    }

    try {
      await getAPI().openFile(downloadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.';
      window.alert(message);
    }
  });

  item.addEventListener('contextmenu', (event: MouseEvent) => {
    const downloadId = item.dataset.id;
    if (!downloadId) {
      return;
    }

    const current = getDownloadRecord(downloadId);
    if (!current || current.status !== 'completed') {
      return;
    }

    event.preventDefault();
    showContextMenu(downloadId, event.clientX, event.clientY);
  });

  updateDownloadItem(item, download);

  return item;
}

function renderDownloads(): void {
  const list = elements.downloadList;
  const empty = elements.emptyState;

  if (!list || !empty) {
    return;
  }

  const sorted = [...state.downloads].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const sortedIds = new Set(sorted.map((download) => download.id));

  for (const [downloadId, item] of state.downloadItems) {
    if (!sortedIds.has(downloadId)) {
      item.remove();
      state.downloadItems.delete(downloadId);
    }
  }

  if (sorted.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  const fragment = document.createDocumentFragment();

  for (const download of sorted) {
    const existingItem = state.downloadItems.get(download.id);
    const item = existingItem || createDownloadItem(download);

    if (!existingItem) {
      state.downloadItems.set(download.id, item);
    } else {
      updateDownloadItem(item, download);
    }

    fragment.appendChild(item);
  }

  list.appendChild(fragment);
}

function showUrlDialog(prefilledUrl = ''): void {
  if (!elements.urlDialog || !elements.urlInput) {
    return;
  }

  if (typeof prefilledUrl === 'string' && prefilledUrl.trim()) {
    elements.urlInput.value = prefilledUrl.trim();
  }

  elements.urlDialog.classList.remove('hidden');
  elements.urlDialog.setAttribute('aria-hidden', 'false');
  elements.urlInput.focus();
  elements.urlInput.select();
}

function isUrlDialogOpen(): boolean {
  return Boolean(elements.urlDialog && !elements.urlDialog.classList.contains('hidden'));
}

function hideUrlDialog(): void {
  if (!elements.urlDialog || !elements.urlInput) {
    return;
  }

  elements.urlDialog.classList.add('hidden');
  elements.urlDialog.setAttribute('aria-hidden', 'true');
  elements.urlInput.value = '';
  elements.addButton?.focus();
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
  updateDownloadSpeeds(state.downloads);
  renderDownloads();
}

function bindEvents(): void {
  if (
    !elements.addButton
    || !elements.urlDialog
    || !elements.urlDialogBackdrop
    || !elements.cancelButton
    || !elements.startButton
    || !elements.themeToggle
    || !elements.urlInput
    || !elements.contextMenu
  ) {
    return;
  }

  elements.addButton.addEventListener('click', () => {
    showUrlDialog();
  });
  elements.urlDialogBackdrop.addEventListener('click', hideUrlDialog);
  elements.cancelButton.addEventListener('click', hideUrlDialog);
  elements.startButton.addEventListener('click', () => {
    void startDownloadFromInput();
  });
  elements.themeToggle.addEventListener('click', toggleTheme);

  elements.urlInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      void startDownloadFromInput();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideUrlDialog();
    }
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !isUrlDialogOpen()) {
      return;
    }

    event.preventDefault();
    hideUrlDialog();
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
  elements.urlDialogBackdrop = document.getElementById('url-dialog-backdrop');
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

  state.unsubscribeDrafts = getAPI().onDraftRequested((draft) => {
    if (!draft || typeof draft.url !== 'string') {
      return;
    }

    const normalizedUrl = draft.url.trim();
    if (!normalizedUrl) {
      return;
    }

    showUrlDialog(normalizedUrl);
  });

  getAPI().notifyRendererReady();

  state.unsubscribeDownloads = getAPI().onDownloadsChanged((nextDownloads) => {
    state.downloads = Array.isArray(nextDownloads) ? nextDownloads : [];
    updateDownloadSpeeds(state.downloads);
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

  if (typeof state.unsubscribeDrafts === 'function') {
    state.unsubscribeDrafts();
  }
});
