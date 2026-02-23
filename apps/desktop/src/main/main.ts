const { randomUUID } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  shell
} = require('electron');
const {
  sanitizeFilename,
  filenameFromUrl
} = require('./download/url-utils');
const {
  createDownloadAuthState
} = require('./download/auth');
const {
  normalizeDownloadRequest
} = require('./download/request-normalization');
const {
  formatDownloadError
} = require('./download/errors');
const {
  runDownloadWithDependencies
} = require('./download/coordinator');
const {
  fetchMetadata
} = require('./download/http-client');
const {
  downloadPartWithHelpers
} = require('./download/part-downloader');
const {
  createBridgeRequestHandler
} = require('./bridge/server');

const PART_COUNT = 4;
const PROGRESS_SYNC_INTERVAL_MS = 250;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 17839;
const BRIDGE_DOWNLOADS_PATH = '/v1/downloads';
const BRIDGE_HEALTH_PATH = '/v1/health';
const BRIDGE_MAX_BODY_BYTES = 32 * 1024;
const BRIDGE_REQUEST_TTL_MS = 5 * 60 * 1000;
const APP_PROTOCOL_SCHEME = 'justdownload';
const MAX_DRAFT_QUEUE_SIZE = 20;

const APP_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="icon-bg" x1="26" y1="486" x2="486" y2="26" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#38BCFA" />
      <stop offset="0.5" stop-color="#1C75E3" />
      <stop offset="1" stop-color="#0A2D75" />
    </linearGradient>
    <radialGradient id="icon-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(182 146) rotate(90) scale(267)">
      <stop offset="0" stop-color="#BAEBFF" stop-opacity="0.52" />
      <stop offset="1" stop-color="#63ABFF" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="icon-shade" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(394 387) rotate(-140) scale(377)">
      <stop offset="0" stop-color="#052866" stop-opacity="0" />
      <stop offset="1" stop-color="#031D5B" stop-opacity="0.4" />
    </radialGradient>
    <radialGradient id="icon-orb" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(234 235) scale(133)">
      <stop offset="0" stop-color="#ABD7FF" stop-opacity="0.44" />
      <stop offset="0.55" stop-color="#61A4FC" stop-opacity="0.18" />
      <stop offset="1" stop-color="#3162D3" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="icon-glyph" x1="256" y1="155" x2="256" y2="348" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FCFDFF" stop-opacity="0.98" />
      <stop offset="1" stop-color="#C4E8FF" stop-opacity="0.92" />
    </linearGradient>
    <filter id="glyph-shadow" x="170" y="144" width="172" height="236" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#063D86" flood-opacity="0.42" />
    </filter>
  </defs>
  <rect x="26" y="26" width="460" height="460" rx="123" fill="url(#icon-bg)" />
  <rect x="26" y="26" width="460" height="460" rx="123" fill="url(#icon-glow)" />
  <path d="M26 84C106 28 290 14 410 62C446 76 472 100 486 128V26H26V84Z" fill="#FFFFFF" fill-opacity="0.15" />
  <rect x="26" y="26" width="460" height="460" rx="123" fill="url(#icon-shade)" />
  <rect x="26" y="26" width="460" height="460" rx="123" stroke="#03163E" stroke-opacity="0.55" stroke-width="3" />
  <rect x="36" y="36" width="440" height="440" rx="111" stroke="#FFFFFF" stroke-opacity="0.15" stroke-width="2" />
  <circle cx="256" cy="246" r="110" fill="url(#icon-orb)" />
  <circle cx="256" cy="246" r="110" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="2" />
  <g filter="url(#glyph-shadow)">
    <path d="M235 155H277V257H319L256 348L193 257H235V155Z" fill="url(#icon-glyph)" />
    <path d="M235 155H277V257H319L256 348L193 257H235V155Z" stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="2" />
    <rect x="182" y="339" width="148" height="28" rx="14" fill="#FFFFFF" fill-opacity="0.9" />
    <rect x="194" y="347" width="124" height="12" rx="6" fill="#2D69D8" fill-opacity="0.26" />
  </g>
</svg>
`.trim();

const TRAY_TEMPLATE_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path d="M12 3.75C12 3.33579 11.6642 3 11.25 3C10.8358 3 10.5 3.33579 10.5 3.75V11.9393L7.28033 8.71967C6.98744 8.42678 6.51256 8.42678 6.21967 8.71967C5.92678 9.01256 5.92678 9.48744 6.21967 9.78033L10.7197 14.2803C11.0126 14.5732 11.4874 14.5732 11.7803 14.2803L16.2803 9.78033C16.5732 9.48744 16.5732 9.01256 16.2803 8.71967C15.9874 8.42678 15.5126 8.42678 15.2197 8.71967L12 11.9393V3.75Z" fill="#000000" />
  <path d="M4.5 15.75C4.08579 15.75 3.75 16.0858 3.75 16.5C3.75 16.9142 4.08579 17.25 4.5 17.25H19.5C19.9142 17.25 20.25 16.9142 20.25 16.5C20.25 16.0858 19.9142 15.75 19.5 15.75H4.5Z" fill="#000000" />
</svg>
`.trim();

const STATUS = {
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[app] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let bridgeServer = null;
let isRendererReady = false;

let store = null;
let downloads = [];

let downloadsDir = '';

app.on('will-finish-launching', () => {
  app.on('open-url', (event, urlValue) => {
    event.preventDefault();
    queueProtocolUrl(urlValue);
  });
});
let partialsDir = '';

const activeDownloads = new Map();
const progressTimers = new Map();
const pendingDraftRequests = [];
const pendingProtocolUrls = [];

type DraftRequestMetadata = {
  source?: string | null;
  requestId?: string | null;
};

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function serializePart(part) {
  return {
    index: Number.isInteger(part.index) ? part.index : 0,
    start: Number.isFinite(part.start) ? part.start : 0,
    end: Number.isFinite(part.end) ? part.end : null,
    downloaded: Number.isFinite(part.downloaded) && part.downloaded >= 0 ? part.downloaded : 0,
    tempPath: typeof part.tempPath === 'string' ? part.tempPath : ''
  };
}

function serializeDownload(download) {
  return {
    id: download.id,
    url: download.url,
    filename: download.filename,
    savePath: download.savePath,
    totalBytes: Number.isFinite(download.totalBytes) ? download.totalBytes : 0,
    downloadedBytes: Number.isFinite(download.downloadedBytes) ? download.downloadedBytes : 0,
    status: download.status,
    error: download.error || null,
    supportsRanges: Boolean(download.supportsRanges),
    parts: Array.isArray(download.parts) ? download.parts.map(serializePart) : [],
    createdAt: Number.isFinite(download.createdAt) ? download.createdAt : Date.now(),
    completedAt: Number.isFinite(download.completedAt) ? download.completedAt : null
  };
}

function publicDownloads() {
  return downloads.map(serializeDownload);
}

function persistDownloads() {
  if (!store) {
    return;
  }
  store.set('downloads', downloads.map(serializeDownload));
}

function notifyDownloadsChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('downloads:changed', publicDownloads());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
}

function flushPendingDraftRequests() {
  if (!isRendererReady || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  while (pendingDraftRequests.length > 0) {
    const nextRequest = pendingDraftRequests.shift();
    if (!nextRequest) {
      continue;
    }

    try {
      mainWindow.webContents.send('download:draft', nextRequest);
    } catch {
      pendingDraftRequests.unshift(nextRequest);
      isRendererReady = false;
      return;
    }
  }
}

function queueDraftRequest(url, metadata: DraftRequestMetadata = {}) {
  const normalizedUrl = typeof url === 'string' ? url.trim() : '';
  if (!normalizedUrl) {
    return;
  }

  pendingDraftRequests.push({
    url: normalizedUrl,
    source: typeof metadata.source === 'string' && metadata.source ? metadata.source : null,
    requestId: typeof metadata.requestId === 'string' && metadata.requestId ? metadata.requestId : null,
    createdAt: Date.now()
  });

  while (pendingDraftRequests.length > MAX_DRAFT_QUEUE_SIZE) {
    pendingDraftRequests.shift();
  }

  showMainWindow();
  flushPendingDraftRequests();
}

function extractProtocolUrlFromArgv(argv: string[]) {
  const protocolPrefix = `${APP_PROTOCOL_SCHEME}://`;

  for (const value of argv) {
    if (typeof value !== 'string') {
      continue;
    }

    if (value.toLowerCase().startsWith(protocolPrefix)) {
      return value;
    }
  }

  return null;
}

function registerProtocolClient() {
  let registered = false;

  if (process.defaultApp && process.argv.length >= 2) {
    const entryPath = path.resolve(process.argv[1]);
    registered = app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME, process.execPath, [entryPath]);
  } else {
    registered = app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME);
  }

  if (!registered) {
    console.warn(`[protocol] Unable to register ${APP_PROTOCOL_SCHEME}:// handler.`);
  }
}

function handleProtocolUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  if (parsed.protocol !== `${APP_PROTOCOL_SCHEME}:`) {
    return;
  }

  const action = (parsed.hostname || parsed.pathname.replace(/^\/+/, '') || 'open').toLowerCase();
  if (action === 'download') {
    const targetUrl = parsed.searchParams.get('url');
    if (typeof targetUrl === 'string' && targetUrl.trim()) {
      try {
        const normalizedTarget = normalizeDownloadRequest(targetUrl).url;
        queueDraftRequest(normalizedTarget, {
          source: 'protocol',
          requestId: null
        });
      } catch {
        showMainWindow();
      }
      return;
    }
  }

  showMainWindow();
}

function processPendingProtocolUrls() {
  if (!app.isReady()) {
    return;
  }

  while (pendingProtocolUrls.length > 0) {
    const nextUrl = pendingProtocolUrls.shift();
    if (!nextUrl) {
      continue;
    }

    handleProtocolUrl(nextUrl);
  }
}

function queueProtocolUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return;
  }

  pendingProtocolUrls.push(rawUrl.trim());
  processPendingProtocolUrls();
}

function scheduleProgressSync(downloadId) {
  if (progressTimers.has(downloadId)) {
    return;
  }

  const timer = setTimeout(() => {
    progressTimers.delete(downloadId);
    persistDownloads();
    notifyDownloadsChanged();
  }, PROGRESS_SYNC_INTERVAL_MS);

  progressTimers.set(downloadId, timer);
}

function flushProgressSync(downloadId) {
  const timer = progressTimers.get(downloadId);
  if (timer) {
    clearTimeout(timer);
    progressTimers.delete(downloadId);
  }
  persistDownloads();
  notifyDownloadsChanged();
}

function clearProgressSync(downloadId) {
  const timer = progressTimers.get(downloadId);
  if (timer) {
    clearTimeout(timer);
    progressTimers.delete(downloadId);
  }
}

function svgToDataUrl(svgContent) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`;
}

function createIconFromSvg(svgContent, size) {
  const icon = nativeImage.createFromDataURL(svgToDataUrl(svgContent));
  if (!icon || icon.isEmpty()) {
    return null;
  }

  if (Number.isFinite(size) && size > 0) {
    return icon.resize({ width: size, height: size, quality: 'best' });
  }

  return icon;
}

function createAppIcon(size = 256) {
  return createIconFromSvg(APP_ICON_SVG, size);
}

function sumDownloadedBytes(parts) {
  if (!Array.isArray(parts)) {
    return 0;
  }

  return parts.reduce((total, part) => {
    const downloaded = Number.isFinite(part.downloaded) ? part.downloaded : 0;
    return total + Math.max(downloaded, 0);
  }, 0);
}

function makePartPath(downloadId, partIndex) {
  return path.join(partialsDir, `${downloadId}.part${partIndex}`);
}

function createSinglePart(downloadId, totalBytes, downloaded = 0) {
  return {
    index: 0,
    start: 0,
    end: totalBytes > 0 ? totalBytes - 1 : null,
    downloaded,
    tempPath: makePartPath(downloadId, 0)
  };
}

function createParts(downloadId, totalBytes, supportsRanges) {
  const canMultipart = supportsRanges && totalBytes > 1;
  if (!canMultipart) {
    return [createSinglePart(downloadId, totalBytes, 0)];
  }

  const partCount = Math.max(1, Math.min(PART_COUNT, totalBytes));
  const partSize = Math.floor(totalBytes / partCount);
  const parts = [];

  for (let index = 0; index < partCount; index += 1) {
    const start = index * partSize;
    const end = index === partCount - 1 ? totalBytes - 1 : (start + partSize - 1);
    parts.push({
      index,
      start,
      end,
      downloaded: 0,
      tempPath: makePartPath(downloadId, index)
    });
  }

  return parts;
}

function getDownloadIndex(id) {
  return downloads.findIndex((item) => item.id === id);
}

function getDownloadById(id) {
  const index = getDownloadIndex(id);
  return index >= 0 ? downloads[index] : null;
}

function removeDownloadFromState(id) {
  downloads = downloads.filter((item) => item.id !== id);
}

async function safeUnlink(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error && !['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) {
      throw error;
    }
  }
}

async function cleanupPartialFiles(download) {
  if (!download || !Array.isArray(download.parts)) {
    return;
  }

  for (const part of download.parts) {
    if (part && part.tempPath) {
      await safeUnlink(part.tempPath);
    }
  }
}

function makeUniqueFilename(baseName) {
  const sanitizedBase = sanitizeFilename(baseName);
  const ext = path.extname(sanitizedBase);
  const stem = path.basename(sanitizedBase, ext);

  const existingFilenames = new Set(downloads.map((item) => item.filename));
  let candidate = sanitizedBase;
  let suffix = 1;

  while (
    existingFilenames.has(candidate) ||
    fs.existsSync(path.join(downloadsDir, candidate))
  ) {
    candidate = `${stem} (${suffix})${ext}`;
    suffix += 1;
  }

  return candidate;
}

function assertValidDownloadUrl(rawUrl) {
  return normalizeDownloadRequest(rawUrl).url;
}

function isPersistedDownloadCandidate(item) {
  return Boolean(item && typeof item.id === 'string' && typeof item.url === 'string');
}

function normalizePersistedParts(item, downloadId) {
  if (!Array.isArray(item.parts) || item.parts.length === 0) {
    return [createSinglePart(downloadId, item.totalBytes || 0, item.downloadedBytes || 0)];
  }

  const normalizedParts = item.parts.map((part, index) => {
    const normalized = serializePart({ ...part, index });
    normalized.tempPath = normalized.tempPath || part.path || makePartPath(downloadId, index);
    return normalized;
  });

  if (!(item.totalBytes > 0)) {
    return normalizedParts;
  }

  return normalizedParts.map((part) => ({
    ...part,
    end: Number.isFinite(part.end) ? part.end : item.totalBytes - 1
  }));
}

function normalizePersistedStatus(status) {
  const allowedStatuses = [STATUS.DOWNLOADING, STATUS.PAUSED, STATUS.COMPLETED, STATUS.ERROR];
  if (!allowedStatuses.includes(status)) {
    return STATUS.ERROR;
  }

  if (status === STATUS.DOWNLOADING) {
    return STATUS.PAUSED;
  }

  return status;
}

function normalizePersistedDownload(item) {
  if (!isPersistedDownloadCandidate(item)) {
    return null;
  }

  const id = item.id;
  const filename = sanitizeFilename(item.filename || filenameFromUrl(item.url));
  const parts = normalizePersistedParts(item, id);

  return {
    id,
    url: item.url,
    filename,
    savePath: typeof item.savePath === 'string' && item.savePath
      ? item.savePath
      : path.join(downloadsDir, filename),
    totalBytes: Number.isFinite(item.totalBytes) ? item.totalBytes : 0,
    downloadedBytes: sumDownloadedBytes(parts),
    status: normalizePersistedStatus(item.status),
    error: item.error ? formatDownloadError({ message: item.error }) : null,
    supportsRanges: Boolean(item.supportsRanges || (Array.isArray(item.parts) && item.parts.length > 1)),
    parts,
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    completedAt: Number.isFinite(item.completedAt) ? item.completedAt : null
  };
}

function normalizePersistedDownloads() {
  const sourceDownloads = Array.isArray(downloads) ? downloads : [];
  const nextDownloads = [];

  for (const item of sourceDownloads) {
    const normalized = normalizePersistedDownload(item);
    if (normalized) {
      nextDownloads.push(normalized);
    }
  }

  downloads = nextDownloads;
}

function stopActiveDownload(downloadId, reason) {
  const runtime = activeDownloads.get(downloadId);
  if (!runtime) {
    return;
  }

  runtime.reason = reason;

  for (const controller of runtime.controllers) {
    controller.abort();
  }

  for (const stream of runtime.streams) {
    try {
      stream.destroy();
    } catch {
      // ignore stream destroy errors
    }
  }
}

async function appendFile(sourcePath, destinationPath, writeMode) {
  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destinationPath, { flags: writeMode });

    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    readStream.pipe(writeStream);
  });
}

async function moveFile(sourcePath, destinationPath) {
  try {
    await fsp.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      await appendFile(sourcePath, destinationPath, 'w');
      await safeUnlink(sourcePath);
      return;
    }
    throw error;
  }
}

async function assembleDownloadedFile(download) {
  const orderedParts = [...download.parts].sort((a, b) => a.index - b.index);

  await safeUnlink(download.savePath);

  if (orderedParts.length === 1) {
    await moveFile(orderedParts[0].tempPath, download.savePath);
    return;
  }

  for (let index = 0; index < orderedParts.length; index += 1) {
    const mode = index === 0 ? 'w' : 'a';
    await appendFile(orderedParts[index].tempPath, download.savePath, mode);
  }

  for (const part of orderedParts) {
    await safeUnlink(part.tempPath);
  }
}

async function downloadPart(download, part, runtime) {
  await downloadPartWithHelpers(download, part, runtime, {
    safeUnlink,
    scheduleProgressSync,
    sumDownloadedBytes
  });
}

async function runDownload(downloadId) {
  await runDownloadWithDependencies(downloadId, {
    getDownloadById,
    activeDownloads,
    status: STATUS,
    downloadPart,
    assembleDownloadedFile,
    sumDownloadedBytes,
    flushProgressSync,
    formatDownloadError
  });
}

async function startDownload(rawUrl, options: unknown = {}) {
  const optionRecord = options && typeof options === 'object'
    ? options as Record<string, unknown>
    : null;
  const authPayload = optionRecord ? optionRecord.auth || null : null;
  const normalizedRequest = normalizeDownloadRequest(rawUrl.trim(), authPayload);
  const normalizedUrl = normalizedRequest.url;
  const authState = createDownloadAuthState(normalizedRequest);

  const metadata = await fetchMetadata(normalizedUrl, authState);

  const sourceUrl = metadata.finalUrl || normalizedUrl;
  const sourceFilename = metadata.filename || filenameFromUrl(sourceUrl);
  const filename = makeUniqueFilename(sourceFilename || 'download');

  const downloadId = randomUUID();
  const totalBytes = Number.isFinite(metadata.totalBytes) ? metadata.totalBytes : 0;
  const supportsRanges = Boolean(metadata.supportsRanges);

  const record = {
    id: downloadId,
    url: sourceUrl,
    authState,
    filename,
    savePath: path.join(downloadsDir, filename),
    totalBytes,
    downloadedBytes: 0,
    status: STATUS.DOWNLOADING,
    error: null,
    supportsRanges,
    parts: createParts(downloadId, totalBytes, supportsRanges),
    createdAt: Date.now(),
    completedAt: null
  };

  downloads.unshift(record);
  persistDownloads();
  notifyDownloadsChanged();

  runDownload(record.id);

  return serializeDownload(record);
}

async function pauseDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download || download.status !== STATUS.DOWNLOADING) {
    return;
  }

  download.status = STATUS.PAUSED;
  stopActiveDownload(downloadId, 'paused');

  flushProgressSync(download.id);
}

async function resumeDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download) {
    return;
  }

  if (download.status === STATUS.DOWNLOADING) {
    runDownload(download.id);
    return;
  }

  if (download.status !== STATUS.PAUSED && download.status !== STATUS.ERROR) {
    return;
  }

  download.status = STATUS.DOWNLOADING;
  download.error = null;

  persistDownloads();
  notifyDownloadsChanged();

  runDownload(download.id);
}

async function cancelDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download) {
    return;
  }

  stopActiveDownload(downloadId, 'cancelled');

  await cleanupPartialFiles(download);
  await safeUnlink(download.savePath);

  clearProgressSync(downloadId);
  removeDownloadFromState(downloadId);
  persistDownloads();
  notifyDownloadsChanged();
}

async function removeDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download) {
    return;
  }

  stopActiveDownload(downloadId, 'cancelled');
  await cleanupPartialFiles(download);

  clearProgressSync(downloadId);
  removeDownloadFromState(downloadId);
  persistDownloads();
  notifyDownloadsChanged();
}

async function deleteDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download) {
    return;
  }

  stopActiveDownload(downloadId, 'cancelled');

  await cleanupPartialFiles(download);
  await safeUnlink(download.savePath);

  clearProgressSync(downloadId);
  removeDownloadFromState(downloadId);
  persistDownloads();
  notifyDownloadsChanged();
}

async function openFile(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download || !download.savePath) {
    return;
  }

  const openResult = await shell.openPath(download.savePath);
  if (openResult) {
    throw new Error(openResult);
  }
}

async function openFolder(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download) {
    return;
  }

  if (download.savePath && fs.existsSync(download.savePath)) {
    shell.showItemInFolder(download.savePath);
  } else {
    await shell.openPath(downloadsDir);
  }
}

function startBridgeServer() {
  if (bridgeServer) {
    return;
  }

  const handleBridgeRequest = createBridgeRequestHandler({
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    downloadsPath: BRIDGE_DOWNLOADS_PATH,
    healthPath: BRIDGE_HEALTH_PATH,
    maxBodyBytes: BRIDGE_MAX_BODY_BYTES,
    requestTtlMs: BRIDGE_REQUEST_TTL_MS,
    getAppVersion: () => app.getVersion(),
    queueDraftRequest,
    startDownload
  });

  const server = http.createServer((request, response) => {
    void handleBridgeRequest(request, response);
  });

  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  server.on('error', (error) => {
    const message = error && error.message ? error.message : 'Unknown error';

    if (error && error.code === 'EADDRINUSE') {
      console.warn(`[bridge] Port ${BRIDGE_PORT} already in use. Chrome extension handoff is unavailable.`);
      if (bridgeServer === server) {
        bridgeServer = null;
      }
      return;
    }

    console.error(`[bridge] Server error: ${message}`);
  });

  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.log(`[bridge] Listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  });

  bridgeServer = server;
}

function stopBridgeServer() {
  if (!bridgeServer) {
    return;
  }

  const server = bridgeServer;
  bridgeServer = null;

  try {
    server.close();
  } catch {
    // ignore close errors
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  const appIcon = createAppIcon(256);

  isRendererReady = false;

  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#1a1a2e',
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    notifyDownloadsChanged();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isRendererReady = false;
  });
}

function createTrayIcon() {
  if (process.platform === 'darwin') {
    const templateIcon = createIconFromSvg(TRAY_TEMPLATE_ICON_SVG, 18);
    if (templateIcon && !templateIcon.isEmpty()) {
      templateIcon.setTemplateImage(true);
      return templateIcon;
    }
  }

  const appIcon = createAppIcon(20);
  if (appIcon && !appIcon.isEmpty()) {
    return appIcon;
  }

  const fallbackDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p4eEAAAAASUVORK5CYII=';
  return nativeImage.createFromDataURL(fallbackDataUrl);
}

function createTray() {
  const icon = createTrayIcon();
  if (!icon || icon.isEmpty()) {
    return;
  }

  try {
    tray = new Tray(icon);
  } catch {
    tray = null;
    return;
  }

  tray.setToolTip('Just Download');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    showMainWindow();
  });
}

async function initializeStore() {
  const module = await import('electron-store');
  const Store = module.default;

  store = new Store({ name: 'downloads' });
  downloads = store.get('downloads', []);

  normalizePersistedDownloads();
  persistDownloads();
}

function registerIpcHandlers() {
  ipcMain.handle('downloads:get', async () => publicDownloads());

  ipcMain.on('renderer:ready', () => {
    isRendererReady = true;
    flushPendingDraftRequests();
  });

  ipcMain.handle('download:start', async (_event, url) => startDownload(url));

  ipcMain.handle('download:pause', async (_event, id) => {
    await pauseDownload(id);
  });

  ipcMain.handle('download:resume', async (_event, id) => {
    await resumeDownload(id);
  });

  ipcMain.handle('download:cancel', async (_event, id) => {
    await cancelDownload(id);
  });

  ipcMain.handle('download:remove', async (_event, id) => {
    await removeDownload(id);
  });

  ipcMain.handle('download:delete', async (_event, id) => {
    await deleteDownload(id);
  });

  ipcMain.handle('download:open', async (_event, id) => {
    await openFile(id);
  });

  ipcMain.handle('download:open-folder', async (_event, id) => {
    await openFolder(id);
  });
}

app.whenReady().then(async () => {
  downloadsDir = app.getPath('downloads');
  partialsDir = path.join(app.getPath('userData'), 'partials');

  ensureDirectory(downloadsDir);
  ensureDirectory(partialsDir);

  registerProtocolClient();

  await initializeStore();
  registerIpcHandlers();
  startBridgeServer();

  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = createAppIcon(256);
    if (dockIcon && !dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  createWindow();
  createTray();

  const startupProtocolUrl = extractProtocolUrlFromArgv(process.argv);
  if (startupProtocolUrl) {
    queueProtocolUrl(startupProtocolUrl);
  }

  processPendingProtocolUrls();

  notifyDownloadsChanged();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBridgeServer();

  for (const [downloadId] of activeDownloads) {
    stopActiveDownload(downloadId, 'paused');
  }

  downloads = downloads.map((download) => {
    if (download.status === STATUS.DOWNLOADING) {
      return {
        ...download,
        status: STATUS.PAUSED
      };
    }

    return download;
  });

  persistDownloads();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showMainWindow();
});

app.on('second-instance', (_event, commandLine) => {
  showMainWindow();

  const protocolUrl = extractProtocolUrlFromArgv(commandLine);
  if (protocolUrl) {
    queueProtocolUrl(protocolUrl);
  }
});
