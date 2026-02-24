import { reconcileDownloadItems } from './download-list-reconciler.js';
import { findTagName, getTagOptions, resolveSelectedTagId } from './download-tags.js';

import type { DownloadTagSettings } from '../shared/types';

type Theme = 'dark' | 'light';

interface RendererState {
  downloads: DownloadRecord[];
  downloadTagSettings: DownloadTagSettings;
  selectedTagId: string | null;
  editingTagId: string | null;
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

interface DownloadTagBadge {
  name: string | null;
  markup: string;
}

interface ElementsState {
  addButton: HTMLButtonElement | null;
  settingsToggleButton: HTMLButtonElement | null;
  settingsPanel: HTMLElement | null;
  settingsPanelBackdrop: HTMLElement | null;
  settingsCloseButton: HTMLButtonElement | null;
  tagList: HTMLElement | null;
  tagForm: HTMLFormElement | null;
  tagIdInput: HTMLInputElement | null;
  tagNameInput: HTMLInputElement | null;
  tagPathInput: HTMLInputElement | null;
  tagBrowseButton: HTMLButtonElement | null;
  tagSaveButton: HTMLButtonElement | null;
  tagResetButton: HTMLButtonElement | null;
  urlDialog: HTMLElement | null;
  urlDialogBackdrop: HTMLElement | null;
  urlInput: HTMLInputElement | null;
  tagSelect: HTMLSelectElement | null;
  startButton: HTMLButtonElement | null;
  cancelButton: HTMLButtonElement | null;
  downloadList: HTMLElement | null;
  emptyState: HTMLElement | null;
  contextMenu: HTMLElement | null;
  themeToggle: HTMLButtonElement | null;
}

const state: RendererState = {
  downloads: [],
  downloadTagSettings: {
    tags: [],
    lastSelectedTagId: null
  },
  selectedTagId: null,
  editingTagId: null,
  downloadSpeeds: new Map(),
  downloadItems: new Map(),
  contextTargetId: null,
  unsubscribeDownloads: null,
  unsubscribeDrafts: null,
  theme: null
};

const elements: ElementsState = {
  addButton: null,
  settingsToggleButton: null,
  settingsPanel: null,
  settingsPanelBackdrop: null,
  settingsCloseButton: null,
  tagList: null,
  tagForm: null,
  tagIdInput: null,
  tagNameInput: null,
  tagPathInput: null,
  tagBrowseButton: null,
  tagSaveButton: null,
  tagResetButton: null,
  urlDialog: null,
  urlDialogBackdrop: null,
  urlInput: null,
  tagSelect: null,
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

function getDownloadErrorMarkup(download: DownloadRecord): string {
  if (download.status !== 'error' || !download.error) {
    return '';
  }

  return `
    <div class="download-error" role="alert" aria-live="polite">
      <div class="download-error-label">Download failed</div>
      <p class="download-error-message">${escapeHtml(download.error)}</p>
    </div>
  `;
}

function getDownloadTagBadge(download: DownloadRecord): DownloadTagBadge {
  const name = findTagName(state.downloadTagSettings, download.tagId || null);
  if (!name) {
    return {
      name: null,
      markup: ''
    };
  }

  return {
    name,
    markup: `<div data-role="tag-badge" class="download-tag-badge" title="${escapeHtml(name)}">${escapeHtml(name)}</div>`
  };
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

function updateDownloadingItemContent(
  item: HTMLElement,
  download: DownloadRecord,
  progress: number,
  progressLabel: string,
  speedLabel: string,
  statusValue: string,
  tagName: string | null
): boolean {
  const filenameElement = item.querySelector<HTMLElement>('[data-role="filename"]');
  const statusChipElement = item.querySelector<HTMLElement>('[data-role="status-chip"]');
  const progressFillElement = item.querySelector<HTMLElement>('[data-role="progress-fill"]');
  const progressTextElement = item.querySelector<HTMLElement>('[data-role="progress-text"]');
  const tagBadgeElement = item.querySelector<HTMLElement>('[data-role="tag-badge"]');

  if (!filenameElement || !statusChipElement || !progressFillElement || !progressTextElement) {
    return false;
  }

  if (tagName && !tagBadgeElement) {
    return false;
  }

  filenameElement.textContent = download.filename;
  filenameElement.setAttribute('title', download.filename);

  statusChipElement.dataset.status = statusValue;
  statusChipElement.textContent = statusLabel(download);

  progressFillElement.dataset.status = statusValue;
  progressFillElement.style.width = `${progress}%`;

  progressTextElement.textContent = `${progressLabel}${speedLabel}`;

  if (tagName && tagBadgeElement) {
    tagBadgeElement.textContent = tagName;
    tagBadgeElement.setAttribute('title', tagName);
  } else if (!tagName && tagBadgeElement) {
    tagBadgeElement.remove();
  }

  return true;
}

function updateDownloadItem(item: HTMLElement, download: DownloadRecord): void {
  const previousStatus = item.dataset.status || null;
  const statusValue = download.status || 'unknown';
  const progress = getProgress(download);
  const totalLabel = download.totalBytes > 0 ? formatBytes(download.totalBytes) : 'Unknown';
  const progressLabel = `${formatBytes(download.downloadedBytes)} / ${totalLabel}`;
  const speedLabel = download.status === 'downloading'
    ? ` | ${formatSpeed(getDownloadSpeed(download))}`
    : '';
  const errorText = getDownloadErrorMarkup(download);
  const tagBadge = getDownloadTagBadge(download);

  item.dataset.status = statusValue;
  if (download.status === 'completed') {
    item.classList.add('cursor-pointer');
  } else {
    item.classList.remove('cursor-pointer');
  }

  if (previousStatus === 'downloading' && statusValue === 'downloading') {
    item.dataset.status = statusValue;
    if (updateDownloadingItemContent(item, download, progress, progressLabel, speedLabel, statusValue, tagBadge.name)) {
      return;
    }
  }

  item.innerHTML = `
    <div class="${DOWNLOAD_INFO_CLASS}">
      <span data-role="filename" class="${FILENAME_CLASS}" title="${escapeHtml(download.filename)}">${escapeHtml(download.filename)}</span>
      <span data-role="status-chip" class="status-chip" data-status="${statusValue}">${statusLabel(download)}</span>
    </div>
    <div class="mt-[8px]">
      <div class="${PROGRESS_TRACK_CLASS}">
        <div data-role="progress-fill" class="progress-fill" data-status="${statusValue}" style="width: ${progress}%"></div>
      </div>
      <div data-role="progress-text" class="${PROGRESS_TEXT_CLASS}">${progressLabel}${speedLabel}</div>
    </div>
    ${tagBadge.markup}
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

  reconcileDownloadItems({
    sortedDownloads: sorted,
    itemsById: state.downloadItems,
    list: {
      getChildAt: (index) => list.children.item(index) as HTMLElement | null,
      insertBefore: (item, referenceItem) => {
        list.insertBefore(item, referenceItem);
      }
    },
    createItem: createDownloadItem,
    updateItem: updateDownloadItem
  });
}

function readDownloadTagSettings(settings: unknown): DownloadTagSettings {
  if (!settings || typeof settings !== 'object') {
    return {
      tags: [],
      lastSelectedTagId: null
    };
  }

  const value = settings as DownloadTagSettings;
  return {
    tags: Array.isArray(value.tags) ? value.tags : [],
    lastSelectedTagId: typeof value.lastSelectedTagId === 'string' ? value.lastSelectedTagId : null
  };
}

function isSettingsPanelOpen(): boolean {
  return Boolean(elements.settingsPanel && !elements.settingsPanel.classList.contains('hidden'));
}

function showSettingsPanel(): void {
  if (!elements.settingsPanel) {
    return;
  }

  elements.settingsPanel.classList.remove('hidden');
  elements.settingsPanel.setAttribute('aria-hidden', 'false');
  elements.settingsPanel.dataset.open = 'true';
}

function hideSettingsPanel(): void {
  if (!elements.settingsPanel) {
    return;
  }

  elements.settingsPanel.dataset.open = 'false';
  elements.settingsPanel.setAttribute('aria-hidden', 'true');

  window.setTimeout(() => {
    if (!elements.settingsPanel || elements.settingsPanel.dataset.open === 'true') {
      return;
    }

    elements.settingsPanel.classList.add('hidden');
  }, 180);
}

function clearTagForm(): void {
  state.editingTagId = null;

  if (elements.tagIdInput) {
    elements.tagIdInput.value = '';
  }

  if (elements.tagNameInput) {
    elements.tagNameInput.value = '';
  }

  if (elements.tagPathInput) {
    elements.tagPathInput.value = '';
  }

  if (elements.tagSaveButton) {
    elements.tagSaveButton.textContent = 'Save Tag';
  }
}

function renderTagList(): void {
  if (!elements.tagList) {
    return;
  }

  if (state.downloadTagSettings.tags.length === 0) {
    elements.tagList.innerHTML = '<div class="text-[12px] text-[var(--text-faint)]">No tags yet. Add one below.</div>';
    return;
  }

  elements.tagList.innerHTML = state.downloadTagSettings.tags.map((tag) => `
    <article class="tag-entry" data-tag-id="${escapeHtml(tag.id)}">
      <div class="tag-entry-name">${escapeHtml(tag.name)}</div>
      <div class="tag-entry-path" title="${escapeHtml(tag.directoryPath)}">${escapeHtml(tag.directoryPath)}</div>
      <div class="tag-entry-actions">
        <button type="button" class="tag-entry-btn" data-action="edit" data-tag-id="${escapeHtml(tag.id)}">Edit</button>
        <button type="button" class="tag-entry-btn" data-action="delete" data-tag-id="${escapeHtml(tag.id)}">Delete</button>
      </div>
    </article>
  `).join('');
}

function renderTagSelectOptions(): void {
  if (!elements.tagSelect) {
    return;
  }

  const selectedTagId = resolveSelectedTagId(state.downloadTagSettings, state.selectedTagId);
  state.selectedTagId = selectedTagId;

  const options = getTagOptions(state.downloadTagSettings)
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join('');

  elements.tagSelect.innerHTML = `<option value="">System Downloads (default)</option>${options}`;
  elements.tagSelect.value = selectedTagId || '';
}

function applyDownloadTagSettings(settings: unknown): void {
  state.downloadTagSettings = readDownloadTagSettings(settings);
  state.selectedTagId = resolveSelectedTagId(state.downloadTagSettings, state.selectedTagId);

  if (
    state.editingTagId
    && !state.downloadTagSettings.tags.some((tag) => tag.id === state.editingTagId)
  ) {
    clearTagForm();
  }

  renderTagList();
  renderTagSelectOptions();
  renderDownloads();
}

function editDownloadTag(tagId: string): void {
  if (!elements.tagIdInput || !elements.tagNameInput || !elements.tagPathInput || !elements.tagSaveButton) {
    return;
  }

  const tag = state.downloadTagSettings.tags.find((entry) => entry.id === tagId);
  if (!tag) {
    return;
  }

  state.editingTagId = tag.id;
  elements.tagIdInput.value = tag.id;
  elements.tagNameInput.value = tag.name;
  elements.tagPathInput.value = tag.directoryPath;
  elements.tagSaveButton.textContent = 'Update Tag';
  elements.tagNameInput.focus();
  elements.tagNameInput.select();
}

async function refreshDownloadTagSettings(): Promise<void> {
  try {
    const settings = await getAPI().getDownloadTagSettings();
    applyDownloadTagSettings(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load tag settings.';
    window.alert(message);
  }
}

async function submitTagForm(): Promise<void> {
  if (!elements.tagNameInput || !elements.tagPathInput || !elements.tagSaveButton) {
    return;
  }

  const name = elements.tagNameInput.value.trim();
  const directoryPath = elements.tagPathInput.value.trim();
  if (!name || !directoryPath) {
    window.alert('Please provide both tag name and directory.');
    return;
  }

  try {
    elements.tagSaveButton.disabled = true;

    const settings = await getAPI().upsertDownloadTag({
      id: state.editingTagId,
      name,
      directoryPath
    });

    applyDownloadTagSettings(settings);
    clearTagForm();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save tag.';
    window.alert(message);
  } finally {
    elements.tagSaveButton.disabled = false;
  }
}

async function deleteTag(tagId: string): Promise<void> {
  if (!window.confirm('Delete this download tag? Existing downloads will no longer show the badge.')) {
    return;
  }

  try {
    const settings = await getAPI().deleteDownloadTag(tagId);
    applyDownloadTagSettings(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete tag.';
    window.alert(message);
  }
}

async function browseDownloadDirectory(): Promise<void> {
  if (!elements.tagPathInput) {
    return;
  }

  try {
    const selectedPath = await getAPI().pickDownloadDirectory();
    if (!selectedPath) {
      return;
    }

    elements.tagPathInput.value = selectedPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open directory picker.';
    window.alert(message);
  }
}

function showUrlDialog(prefilledUrl = ''): void {
  if (!elements.urlDialog || !elements.urlInput || !elements.tagSelect) {
    return;
  }

  if (typeof prefilledUrl === 'string' && prefilledUrl.trim()) {
    elements.urlInput.value = prefilledUrl.trim();
  }

  const selectedTagId = resolveSelectedTagId(state.downloadTagSettings, state.selectedTagId);
  state.selectedTagId = selectedTagId;
  elements.tagSelect.value = selectedTagId || '';

  elements.urlDialog.classList.remove('hidden');
  elements.urlDialog.setAttribute('aria-hidden', 'false');
  elements.urlInput.focus();
  elements.urlInput.select();
}

function isUrlDialogOpen(): boolean {
  return Boolean(elements.urlDialog && !elements.urlDialog.classList.contains('hidden'));
}

function hideUrlDialog(): void {
  if (!elements.urlDialog || !elements.urlInput || !elements.tagSelect) {
    return;
  }

  elements.urlDialog.classList.add('hidden');
  elements.urlDialog.setAttribute('aria-hidden', 'true');
  elements.urlInput.value = '';
  elements.tagSelect.value = state.selectedTagId || '';
  elements.addButton?.focus();
}

async function startDownloadFromInput(): Promise<void> {
  if (!elements.urlInput || !elements.startButton || !elements.tagSelect) {
    return;
  }

  const value = elements.urlInput.value.trim();
  if (!value) {
    return;
  }

  const selectedTagId = elements.tagSelect.value.trim() || null;

  try {
    elements.startButton.disabled = true;
    await getAPI().startDownload(value, { tagId: selectedTagId });
    state.selectedTagId = selectedTagId;
    hideUrlDialog();
    void refreshDownloadTagSettings();
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

function hasRequiredElements(): boolean {
  const required = [
    elements.addButton,
    elements.settingsToggleButton,
    elements.settingsPanel,
    elements.settingsPanelBackdrop,
    elements.settingsCloseButton,
    elements.tagList,
    elements.tagForm,
    elements.tagNameInput,
    elements.tagPathInput,
    elements.tagBrowseButton,
    elements.tagResetButton,
    elements.urlDialog,
    elements.urlDialogBackdrop,
    elements.cancelButton,
    elements.startButton,
    elements.tagSelect,
    elements.themeToggle,
    elements.urlInput,
    elements.contextMenu
  ];

  return required.every(Boolean);
}

function bindPrimaryControls(): void {
  elements.addButton?.addEventListener('click', () => {
    showUrlDialog();
  });
  elements.settingsToggleButton?.addEventListener('click', showSettingsPanel);
  elements.settingsPanelBackdrop?.addEventListener('click', hideSettingsPanel);
  elements.settingsCloseButton?.addEventListener('click', hideSettingsPanel);
  elements.urlDialogBackdrop?.addEventListener('click', hideUrlDialog);
  elements.cancelButton?.addEventListener('click', hideUrlDialog);
  elements.startButton?.addEventListener('click', () => {
    void startDownloadFromInput();
  });
  elements.themeToggle?.addEventListener('click', toggleTheme);

  elements.urlInput?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      void startDownloadFromInput();
      return;
    }

    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    hideUrlDialog();
  });

  elements.tagSelect?.addEventListener('change', () => {
    state.selectedTagId = elements.tagSelect?.value.trim() || null;
  });
}

function bindTagSettingsEvents(): void {
  elements.tagBrowseButton?.addEventListener('click', () => {
    void browseDownloadDirectory();
  });

  elements.tagResetButton?.addEventListener('click', () => {
    clearTagForm();
  });

  elements.tagForm?.addEventListener('submit', (event: SubmitEvent) => {
    event.preventDefault();
    void submitTagForm();
  });

  elements.tagList?.addEventListener('click', (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionElement = target.closest<HTMLElement>('[data-action][data-tag-id]');
    const action = actionElement?.dataset.action;
    const tagId = actionElement?.dataset.tagId;
    if (!action || !tagId) {
      return;
    }

    if (action === 'edit') {
      editDownloadTag(tagId);
      return;
    }

    if (action === 'delete') {
      void deleteTag(tagId);
    }
  });
}

function bindEscapeHandler(): void {
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (isUrlDialogOpen()) {
      event.preventDefault();
      hideUrlDialog();
      return;
    }

    if (!isSettingsPanelOpen()) {
      return;
    }

    event.preventDefault();
    hideSettingsPanel();
  });
}

function bindContextMenuEvents(): void {
  document.addEventListener('click', (event: MouseEvent) => {
    if (!elements.contextMenu) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node) || !elements.contextMenu.contains(target)) {
      hideContextMenu();
    }
  });

  elements.contextMenu?.addEventListener('click', async (event: MouseEvent) => {
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

function bindEvents(): void {
  if (!hasRequiredElements()) {
    return;
  }

  bindPrimaryControls();
  bindTagSettingsEvents();
  bindEscapeHandler();
  bindContextMenuEvents();
}

function cacheElements(): void {
  elements.addButton = document.getElementById('add-btn') as HTMLButtonElement | null;
  elements.settingsToggleButton = document.getElementById('settings-toggle') as HTMLButtonElement | null;
  elements.settingsPanel = document.getElementById('settings-panel');
  elements.settingsPanelBackdrop = document.getElementById('settings-panel-backdrop');
  elements.settingsCloseButton = document.getElementById('settings-close') as HTMLButtonElement | null;
  elements.tagList = document.getElementById('tag-list');
  elements.tagForm = document.getElementById('tag-form') as HTMLFormElement | null;
  elements.tagIdInput = document.getElementById('tag-id') as HTMLInputElement | null;
  elements.tagNameInput = document.getElementById('tag-name') as HTMLInputElement | null;
  elements.tagPathInput = document.getElementById('tag-path') as HTMLInputElement | null;
  elements.tagBrowseButton = document.getElementById('tag-browse') as HTMLButtonElement | null;
  elements.tagSaveButton = document.getElementById('tag-save') as HTMLButtonElement | null;
  elements.tagResetButton = document.getElementById('tag-reset') as HTMLButtonElement | null;
  elements.urlDialog = document.getElementById('url-dialog');
  elements.urlDialogBackdrop = document.getElementById('url-dialog-backdrop');
  elements.urlInput = document.getElementById('url-input') as HTMLInputElement | null;
  elements.tagSelect = document.getElementById('download-tag') as HTMLSelectElement | null;
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
  clearTagForm();

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

  await refreshDownloadTagSettings();
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
