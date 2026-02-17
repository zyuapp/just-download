const { randomUUID } = require('crypto');
const { once } = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
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

const PART_COUNT = 4;
const PROGRESS_SYNC_INTERVAL_MS = 250;

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

let mainWindow = null;
let tray = null;
let isQuitting = false;

let store = null;
let downloads = [];

let downloadsDir = '';
let partialsDir = '';

const activeDownloads = new Map();
const progressTimers = new Map();

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'download';
  }

  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.length > 0 ? sanitized : 'download';
}

function filenameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = decodeURIComponent(parsed.pathname || '');
    const name = path.basename(pathname);
    return sanitizeFilename(name || 'download');
  } catch {
    return 'download';
  }
}

function filenameFromContentDisposition(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(utfMatch[1]));
    } catch {
      return sanitizeFilename(utfMatch[1]);
    }
  }

  const simpleMatch = headerValue.match(/filename="?([^";]+)"?/i);
  if (simpleMatch && simpleMatch[1]) {
    return sanitizeFilename(simpleMatch[1]);
  }

  return null;
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

async function fetchMetadata(rawUrl) {
  const metadata = {
    finalUrl: rawUrl,
    filename: null,
    totalBytes: 0,
    supportsRanges: false
  };

  try {
    const response = await fetch(rawUrl, {
      method: 'HEAD',
      redirect: 'follow'
    });

    metadata.finalUrl = response.url || rawUrl;
    metadata.filename = filenameFromContentDisposition(response.headers.get('content-disposition'));
    metadata.totalBytes = parsePositiveInt(response.headers.get('content-length'));
    metadata.supportsRanges = (response.headers.get('accept-ranges') || '').toLowerCase().includes('bytes');
  } catch {
    // fall through to probe request below
  }

  if (metadata.totalBytes > 0 && metadata.supportsRanges && metadata.filename) {
    return metadata;
  }

  try {
    const response = await fetch(metadata.finalUrl || rawUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow'
    });

    metadata.finalUrl = response.url || metadata.finalUrl;

    if (!metadata.filename) {
      metadata.filename = filenameFromContentDisposition(response.headers.get('content-disposition'));
    }

    if (response.status === 206) {
      metadata.supportsRanges = true;
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match && match[1]) {
        metadata.totalBytes = parsePositiveInt(match[1]);
      }
    }

    if (!metadata.totalBytes) {
      metadata.totalBytes = parsePositiveInt(response.headers.get('content-length'));
    }

    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // keep best-effort metadata values
  }

  return metadata;
}

function assertValidDownloadUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Please enter a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  return parsed.toString();
}

function normalizePersistedDownloads() {
  downloads = (Array.isArray(downloads) ? downloads : [])
    .filter((item) => item && typeof item.id === 'string' && typeof item.url === 'string')
    .map((item) => {
      const id = item.id;
      const filename = sanitizeFilename(item.filename || filenameFromUrl(item.url));

      let parts = Array.isArray(item.parts) && item.parts.length > 0
        ? item.parts.map((part, index) => {
          const normalized = serializePart({ ...part, index });
          normalized.tempPath = normalized.tempPath || part.path || makePartPath(id, index);
          return normalized;
        })
        : [createSinglePart(id, item.totalBytes || 0, item.downloadedBytes || 0)];

      if (item.totalBytes > 0) {
        parts = parts.map((part) => ({
          ...part,
          end: Number.isFinite(part.end) ? part.end : item.totalBytes - 1
        }));
      }

      const normalized = {
        id,
        url: item.url,
        filename,
        savePath: typeof item.savePath === 'string' && item.savePath
          ? item.savePath
          : path.join(downloadsDir, filename),
        totalBytes: Number.isFinite(item.totalBytes) ? item.totalBytes : 0,
        downloadedBytes: sumDownloadedBytes(parts),
        status: [STATUS.DOWNLOADING, STATUS.PAUSED, STATUS.COMPLETED, STATUS.ERROR].includes(item.status)
          ? item.status
          : STATUS.ERROR,
        error: item.error || null,
        supportsRanges: Boolean(item.supportsRanges || (Array.isArray(item.parts) && item.parts.length > 1)),
        parts,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        completedAt: Number.isFinite(item.completedAt) ? item.completedAt : null
      };

      if (normalized.status === STATUS.DOWNLOADING) {
        normalized.status = STATUS.PAUSED;
      }

      return normalized;
    });
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
  const canResumeWithRange = download.supportsRanges;

  if (!canResumeWithRange && part.downloaded > 0) {
    part.downloaded = 0;
    await safeUnlink(part.tempPath);
  }

  const startOffset = part.start + part.downloaded;
  const hasBoundedEnd = Number.isFinite(part.end);

  if (hasBoundedEnd && startOffset > part.end) {
    return;
  }

  const headers = {} as Record<string, string>;
  if (canResumeWithRange) {
    if (hasBoundedEnd) {
      headers.Range = `bytes=${startOffset}-${part.end}`;
    } else {
      headers.Range = `bytes=${startOffset}-`;
    }
  }

  const controller = new AbortController();
  runtime.controllers.add(controller);

  let response;

  try {
    response = await fetch(download.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (error) {
    runtime.controllers.delete(controller);

    if (runtime.reason && error && error.name === 'AbortError') {
      return;
    }

    throw error;
  }

  if (response.url && response.url !== download.url) {
    download.url = response.url;
  }

  if (response.status >= 400) {
    runtime.controllers.delete(controller);
    throw new Error(`HTTP ${response.status}`);
  }

  if (canResumeWithRange && part.downloaded > 0 && response.status !== 206) {
    runtime.controllers.delete(controller);
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
    throw new Error('Server does not support resuming this download.');
  }

  const contentRange = response.headers.get('content-range');
  if (!download.totalBytes && contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match && match[1]) {
      download.totalBytes = parsePositiveInt(match[1]);
    }
  }

  if (!download.totalBytes) {
    const contentLength = parsePositiveInt(response.headers.get('content-length'));
    if (contentLength > 0) {
      download.totalBytes = response.status === 206 ? part.downloaded + contentLength : contentLength;
      if (!hasBoundedEnd && Number.isFinite(download.totalBytes) && download.totalBytes > 0) {
        part.end = download.totalBytes - 1;
      }
    }
  }

  if (!response.body) {
    runtime.controllers.delete(controller);
    throw new Error('Empty response body.');
  }

  const writeStream = fs.createWriteStream(part.tempPath, {
    flags: part.downloaded > 0 ? 'a' : 'w'
  });

  let streamError = null;
  const onStreamError = (error) => {
    streamError = error;
  };
  writeStream.on('error', onStreamError);

  runtime.streams.add(writeStream);

  try {
    for await (const chunk of response.body) {
      if (runtime.reason) {
        break;
      }

      if (streamError) {
        throw streamError;
      }

      if (!writeStream.write(chunk)) {
        await once(writeStream, 'drain');
      }

      part.downloaded += chunk.length;
      download.downloadedBytes = sumDownloadedBytes(download.parts);
      scheduleProgressSync(download.id);
    }

    if (streamError) {
      throw streamError;
    }
  } catch (error) {
    if (!(runtime.reason && error && error.name === 'AbortError')) {
      throw error;
    }
  } finally {
    writeStream.off('error', onStreamError);
    await new Promise((resolve) => {
      writeStream.end(resolve);
    });
    runtime.streams.delete(writeStream);
    runtime.controllers.delete(controller);
  }
}

async function runDownload(downloadId) {
  const download = getDownloadById(downloadId);
  if (!download || download.status !== STATUS.DOWNLOADING || activeDownloads.has(downloadId)) {
    return;
  }

  const runtime = {
    reason: null,
    controllers: new Set(),
    streams: new Set()
  };

  activeDownloads.set(downloadId, runtime);

  try {
    await Promise.all(download.parts.map((part) => downloadPart(download, part, runtime)));

    if (runtime.reason) {
      return;
    }

    await assembleDownloadedFile(download);

    download.downloadedBytes = sumDownloadedBytes(download.parts);
    if (!download.totalBytes) {
      download.totalBytes = download.downloadedBytes;
    }

    download.status = STATUS.COMPLETED;
    download.error = null;
    download.completedAt = Date.now();

    flushProgressSync(download.id);
  } catch (error) {
    if (runtime.reason === 'paused' || runtime.reason === 'cancelled') {
      return;
    }

    download.status = STATUS.ERROR;
    download.error = error && error.message ? error.message : 'Download failed.';

    flushProgressSync(download.id);
  } finally {
    activeDownloads.delete(downloadId);
  }
}

async function startDownload(rawUrl) {
  const normalizedUrl = assertValidDownloadUrl(rawUrl.trim());
  const metadata = await fetchMetadata(normalizedUrl);

  const sourceUrl = metadata.finalUrl || normalizedUrl;
  const sourceFilename = metadata.filename || filenameFromUrl(sourceUrl);
  const filename = makeUniqueFilename(sourceFilename || 'download');

  const downloadId = randomUUID();
  const totalBytes = Number.isFinite(metadata.totalBytes) ? metadata.totalBytes : 0;
  const supportsRanges = Boolean(metadata.supportsRanges);

  const record = {
    id: downloadId,
    url: sourceUrl,
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
  if (!download || (download.status !== STATUS.PAUSED && download.status !== STATUS.ERROR)) {
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

function createWindow() {
  const appIcon = createAppIcon(256);

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
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.show();
        mainWindow.focus();
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
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

  await initializeStore();
  registerIpcHandlers();

  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = createAppIcon(256);
    if (dockIcon && !dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  createWindow();
  createTray();

  notifyDownloadsChanged();
});

app.on('before-quit', () => {
  isQuitting = true;

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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
