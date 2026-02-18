const { randomUUID, createHash } = require('crypto');
const { once } = require('events');
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

const PART_COUNT = 4;
const PROGRESS_SYNC_INTERVAL_MS = 250;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 17839;
const BRIDGE_DOWNLOADS_PATH = '/v1/downloads';
const BRIDGE_HEALTH_PATH = '/v1/health';
const BRIDGE_MAX_BODY_BYTES = 32 * 1024;
const BRIDGE_REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_AUTH_FIELD_LENGTH = 1024;
const APP_PROTOCOL_SCHEME = 'justdownload';
const BRIDGE_MODE_START = 'start';
const BRIDGE_MODE_DRAFT = 'draft';
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
const bridgeRequestCache = new Map();
const pendingDraftRequests = [];
const pendingProtocolUrls = [];

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

function queueDraftRequest(url, metadata: { source?: string | null; requestId?: string | null } = {}) {
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

function setBridgeResponseHeaders(response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Just-Download-Source, X-Just-Download-Request-Id');
  response.setHeader('Cache-Control', 'no-store');
}

function sendBridgeJson(response, statusCode, payload) {
  setBridgeResponseHeaders(response);
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
}

function normalizeBridgeRequestId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, 200);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildBasicAuthorization(username, password) {
  const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function md5Hex(value) {
  return createHash('md5').update(value).digest('hex');
}

function escapeDigestValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function chooseDigestQop(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  const candidates = rawValue
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (candidates.includes('auth')) {
    return 'auth';
  }

  return null;
}

function parseDigestChallenge(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue) {
    return null;
  }

  const digestIndex = headerValue.toLowerCase().indexOf('digest ');
  if (digestIndex < 0) {
    return null;
  }

  const digestPart = headerValue.slice(digestIndex + 7);
  const params = {} as Record<string, string>;
  const paramPattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g;

  let match;
  while ((match = paramPattern.exec(digestPart)) !== null) {
    const key = match[1].toLowerCase();
    const quotedValue = typeof match[2] === 'string' ? match[2].replace(/\\(.)/g, '$1') : null;
    const tokenValue = typeof match[3] === 'string' ? match[3].trim() : null;
    const value = quotedValue !== null ? quotedValue : tokenValue;

    if (typeof value === 'string' && value) {
      params[key] = value;
    }
  }

  if (!params.realm || !params.nonce) {
    return null;
  }

  const algorithm = (params.algorithm || 'MD5').toUpperCase();
  if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') {
    return null;
  }

  const qop = chooseDigestQop(params.qop || '');
  if (params.qop && !qop) {
    return null;
  }

  return {
    realm: params.realm,
    nonce: params.nonce,
    opaque: params.opaque || null,
    algorithm,
    qop
  };
}

function createDigestAuthorizationHeader(options) {
  if (!options || typeof options !== 'object') {
    return null;
  }

  const challenge = options.challenge;
  const username = typeof options.username === 'string' ? options.username : '';
  const password = typeof options.password === 'string' ? options.password : '';
  const method = typeof options.method === 'string' && options.method ? options.method.toUpperCase() : 'GET';
  const targetUrl = typeof options.url === 'string' ? options.url : '';

  if (!challenge || !challenge.realm || !challenge.nonce) {
    return null;
  }

  let uri = '/';
  try {
    const parsed = new URL(targetUrl);
    uri = `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return null;
  }

  const cnonce = randomUUID().replace(/-/g, '');
  const nonceCount = '00000001';

  let ha1 = md5Hex(`${username}:${challenge.realm}:${password}`);
  if (challenge.algorithm === 'MD5-SESS') {
    ha1 = md5Hex(`${ha1}:${challenge.nonce}:${cnonce}`);
  }

  const ha2 = md5Hex(`${method}:${uri}`);

  let responseDigest = '';
  if (challenge.qop) {
    responseDigest = md5Hex(`${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${challenge.qop}:${ha2}`);
  } else {
    responseDigest = md5Hex(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const parts = [
    `Digest username="${escapeDigestValue(username)}"`,
    `realm="${escapeDigestValue(challenge.realm)}"`,
    `nonce="${escapeDigestValue(challenge.nonce)}"`,
    `uri="${escapeDigestValue(uri)}"`,
    `response="${responseDigest}"`,
    `algorithm=${challenge.algorithm || 'MD5'}`
  ];

  if (challenge.opaque) {
    parts.push(`opaque="${escapeDigestValue(challenge.opaque)}"`);
  }

  if (challenge.qop) {
    parts.push(`qop=${challenge.qop}`);
    parts.push(`nc=${nonceCount}`);
    parts.push(`cnonce="${cnonce}"`);
  }

  return parts.join(', ');
}

async function cancelResponseBody(response) {
  if (!response || !response.body || typeof response.body.cancel !== 'function') {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // ignore body cancel errors
  }
}

function createDownloadAuthState(normalizedRequest) {
  const auth = normalizedRequest && normalizedRequest.auth ? normalizedRequest.auth : null;
  const credentials = auth && auth.type === 'basic'
    ? {
      username: auth.username,
      password: auth.password
    }
    : null;

  return {
    credentials,
    authorizationHeader: normalizedRequest.authorizationHeader || null,
    authorizationHeaderFallback: normalizedRequest.authorizationHeaderFallback || null,
    digestChallenge: null
  };
}

function createPreemptiveDigestHeader(authState, method, requestUrl) {
  if (!authState || !authState.digestChallenge || !authState.credentials) {
    return null;
  }

  return createDigestAuthorizationHeader({
    challenge: authState.digestChallenge,
    username: authState.credentials.username,
    password: authState.credentials.password,
    method,
    url: requestUrl
  });
}

async function fetchWithAuthRetry(requestUrl, requestOptions, authState = null) {
  const method = typeof requestOptions?.method === 'string' && requestOptions.method
    ? requestOptions.method.toUpperCase()
    : 'GET';

  const baseHeaders = {
    ...(requestOptions?.headers || {})
  };

  const performFetch = async (url, authorizationHeader) => {
    const headers = {
      ...baseHeaders
    };

    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
    } else {
      delete headers.Authorization;
    }

    return fetch(url, {
      ...requestOptions,
      method,
      headers,
      redirect: requestOptions?.redirect || 'follow'
    });
  };

  const preemptiveDigestHeader = createPreemptiveDigestHeader(authState, method, requestUrl);
  let response = await performFetch(requestUrl, preemptiveDigestHeader || (authState ? authState.authorizationHeader : null));

  if (
    response.status === 401
    && authState
    && !preemptiveDigestHeader
    && authState.authorizationHeaderFallback
    && authState.authorizationHeaderFallback !== authState.authorizationHeader
  ) {
    await cancelResponseBody(response);

    response = await performFetch(requestUrl, authState.authorizationHeaderFallback);

    if (response.status < 400) {
      const previousPrimary = authState.authorizationHeader;
      authState.authorizationHeader = authState.authorizationHeaderFallback;
      authState.authorizationHeaderFallback = previousPrimary;
      return response;
    }
  }

  if (response.status === 401 && authState && authState.credentials) {
    const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
    if (challenge) {
      const challengedUrl = response.url || requestUrl;
      await cancelResponseBody(response);

      const digestHeader = createDigestAuthorizationHeader({
        challenge,
        username: authState.credentials.username,
        password: authState.credentials.password,
        method,
        url: challengedUrl
      });

      if (digestHeader) {
        response = await performFetch(challengedUrl, digestHeader);
        if (response.status < 400) {
          authState.digestChallenge = challenge;
        }
      }
    }
  }

  return response;
}

function pushUniqueAuthHeader(headers, header) {
  if (typeof header !== 'string' || !header) {
    return;
  }

  if (!headers.includes(header)) {
    headers.push(header);
  }
}

function parseBridgeAuth(authPayload) {
  if (!authPayload) {
    return null;
  }

  if (typeof authPayload !== 'object') {
    throw new Error('Invalid auth payload.');
  }

  const type = typeof authPayload.type === 'string' ? authPayload.type.trim().toLowerCase() : '';
  if (type !== 'basic') {
    throw new Error('Only basic auth is supported.');
  }

  const username = typeof authPayload.username === 'string' ? authPayload.username : '';
  const password = typeof authPayload.password === 'string' ? authPayload.password : '';

  if (!username && !password) {
    throw new Error('Basic auth credentials are missing.');
  }

  if (username.length > MAX_AUTH_FIELD_LENGTH || password.length > MAX_AUTH_FIELD_LENGTH) {
    throw new Error('Auth credentials are too long.');
  }

  return {
    type: 'basic',
    username,
    password
  };
}

function normalizeDownloadRequest(rawUrl, authPayload = null) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Please enter a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  let auth = parseBridgeAuth(authPayload);
  const authHeaderCandidates = [];

  if (auth) {
    pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(auth.username, auth.password));
  }

  if (!auth && (parsed.username || parsed.password)) {
    const rawUsername = parsed.username || '';
    const rawPassword = parsed.password || '';
    const decodedUsername = decodeURIComponentSafe(rawUsername);
    const decodedPassword = decodeURIComponentSafe(rawPassword);

    auth = {
      type: 'basic',
      username: decodedUsername,
      password: decodedPassword
    };

    pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(decodedUsername, decodedPassword));

    if (rawUsername !== decodedUsername || rawPassword !== decodedPassword) {
      pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(rawUsername, rawPassword));
    }
  }

  parsed.username = '';
  parsed.password = '';

  return {
    url: parsed.toString(),
    auth,
    authorizationHeader: authHeaderCandidates[0] || null,
    authorizationHeaderFallback: authHeaderCandidates[1] || null
  };
}

function redactCredentialUrls(message) {
  if (typeof message !== 'string' || !message) {
    return '';
  }

  return message.replace(/(https?:\/\/)([^\s/:@]+)(?::[^\s@/]*)?@/gi, '$1[redacted]@');
}

function formatDownloadError(error) {
  const rawMessage = error && error.message ? String(error.message) : '';
  if (!rawMessage) {
    return 'Download failed.';
  }

  const message = rawMessage.trim();
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('includes credentials')) {
    return 'This download URL includes credentials. The app now strips credentials from the URL, but this request could not be prepared. Please retry.';
  }

  if (/^HTTP\s+401\b/i.test(message)) {
    return 'Authentication failed (401). The app retried alternate auth strategies (including Digest), but the server still rejected the login.';
  }

  if (/^HTTP\s+403\b/i.test(message)) {
    return 'Access denied by server (403).';
  }

  if (/^HTTP\s+404\b/i.test(message)) {
    return 'File not found on server (404).';
  }

  if (lowerMessage.includes('fetch failed')) {
    return 'Network request failed. Check your connection and retry.';
  }

  const sanitized = redactCredentialUrls(message).replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return 'Download failed.';
  }

  return sanitized.length > 220 ? `${sanitized.slice(0, 217)}...` : sanitized;
}

function pruneBridgeRequestCache() {
  const cutoff = Date.now() - BRIDGE_REQUEST_TTL_MS;

  for (const [requestId, entry] of bridgeRequestCache.entries()) {
    if (!entry || !Number.isFinite(entry.createdAt) || entry.createdAt < cutoff) {
      bridgeRequestCache.delete(requestId);
    }
  }
}

function normalizeBridgeMode(value) {
  if (typeof value !== 'string') {
    return BRIDGE_MODE_START;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === BRIDGE_MODE_DRAFT ? BRIDGE_MODE_DRAFT : BRIDGE_MODE_START;
}

function parseBridgePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload.');
  }

  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  const requestId = normalizeBridgeRequestId(payload.requestId);
  const source = typeof payload.source === 'string' ? payload.source.trim().slice(0, 100) : '';
  const referrer = typeof payload.referrer === 'string' ? payload.referrer.trim() : null;
  const filenameHint = typeof payload.filenameHint === 'string' ? payload.filenameHint.trim() : null;
  const mode = normalizeBridgeMode(payload.mode);
  const auth = parseBridgeAuth(payload.auth);

  return {
    url,
    requestId,
    source,
    referrer,
    filenameHint,
    mode,
    auth
  };
}

function readBridgeRequestBody(request): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    let body = '';

    request.setEncoding('utf8');

    request.on('data', (chunk) => {
      if (overflow) {
        return;
      }

      size += Buffer.byteLength(chunk, 'utf8');
      if (size > BRIDGE_MAX_BODY_BYTES) {
        overflow = true;
        return;
      }

      body += chunk;
    });

    request.on('end', () => {
      if (overflow) {
        reject(new Error('Payload too large.'));
        return;
      }

      resolve(body);
    });

    request.on('error', reject);
  });
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

async function fetchMetadata(rawUrl, authState = null) {
  const metadata = {
    finalUrl: rawUrl,
    filename: null,
    totalBytes: 0,
    supportsRanges: false,
    authorizationRejected: false
  };

  try {
    const response = await fetchWithAuthRetry(rawUrl, {
      method: 'HEAD',
      redirect: 'follow'
    }, authState);

    if (response.status === 401) {
      metadata.authorizationRejected = true;
    }

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
    const response = await fetchWithAuthRetry(metadata.finalUrl || rawUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow'
    }, authState);

    if (response.status === 401) {
      metadata.authorizationRejected = true;
    }

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

    await cancelResponseBody(response);
  } catch {
    // keep best-effort metadata values
  }

  return metadata;
}

function assertValidDownloadUrl(rawUrl) {
  return normalizeDownloadRequest(rawUrl).url;
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
        error: item.error ? formatDownloadError({ message: item.error }) : null,
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
    response = await fetchWithAuthRetry(download.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal
    }, download.authState || null);
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
    download.error = formatDownloadError(error);

    flushProgressSync(download.id);
  } finally {
    activeDownloads.delete(downloadId);
  }
}

async function startDownload(rawUrl, options: any = {}) {
  const authPayload = options && typeof options === 'object' ? options.auth || null : null;
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

async function handleBridgeRequest(request, response) {
  if (!request || !response) {
    return;
  }

  if (request.method === 'OPTIONS') {
    setBridgeResponseHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  } catch {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: 'Invalid request URL.'
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === BRIDGE_HEALTH_PATH) {
    sendBridgeJson(response, 200, {
      ok: true,
      appVersion: app.getVersion(),
      bridge: {
        host: BRIDGE_HOST,
        port: BRIDGE_PORT
      }
    });
    return;
  }

  if (request.method !== 'POST' || requestUrl.pathname !== BRIDGE_DOWNLOADS_PATH) {
    sendBridgeJson(response, 404, {
      accepted: false,
      error: 'Not found.'
    });
    return;
  }

  let rawBody = '';
  try {
    rawBody = await readBridgeRequestBody(request);
  } catch (error) {
    sendBridgeJson(response, 413, {
      accepted: false,
      error: error && error.message ? error.message : 'Payload too large.'
    });
    return;
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(rawBody || '{}');
  } catch {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: 'Invalid JSON payload.'
    });
    return;
  }

  let payload;
  try {
    payload = parseBridgePayload(parsedPayload);
  } catch (error) {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: error && error.message ? error.message : 'Invalid payload.'
    });
    return;
  }

  let normalizedRequest;
  try {
    normalizedRequest = normalizeDownloadRequest(payload.url, payload.auth || null);
  } catch (error) {
    sendBridgeJson(response, 400, {
      accepted: false,
      error: error && error.message ? error.message : 'Invalid URL.'
    });
    return;
  }

  pruneBridgeRequestCache();

  if (payload.requestId && bridgeRequestCache.has(payload.requestId)) {
    const cached = bridgeRequestCache.get(payload.requestId);

    sendBridgeJson(response, 200, {
      accepted: true,
      duplicate: true,
      mode: cached && cached.mode ? cached.mode : BRIDGE_MODE_START,
      downloadId: cached ? cached.downloadId : null
    });
    return;
  }

  if (payload.mode === BRIDGE_MODE_DRAFT) {
    queueDraftRequest(normalizedRequest.url, {
      source: payload.source || 'bridge',
      requestId: payload.requestId || null
    });

    if (payload.requestId) {
      bridgeRequestCache.set(payload.requestId, {
        mode: BRIDGE_MODE_DRAFT,
        downloadId: null,
        createdAt: Date.now()
      });
    }

    sendBridgeJson(response, 202, {
      accepted: true,
      duplicate: false,
      mode: BRIDGE_MODE_DRAFT,
      queued: true,
      downloadId: null
    });
    return;
  }

  try {
    const record = await startDownload(normalizedRequest.url, {
      auth: normalizedRequest.auth || null
    });

    if (payload.requestId) {
      bridgeRequestCache.set(payload.requestId, {
        mode: BRIDGE_MODE_START,
        downloadId: record.id,
        createdAt: Date.now()
      });
    }

    sendBridgeJson(response, 202, {
      accepted: true,
      duplicate: false,
      mode: BRIDGE_MODE_START,
      downloadId: record.id
    });
  } catch (error) {
    sendBridgeJson(response, 500, {
      accepted: false,
      error: error && error.message ? error.message : 'Failed to start download.'
    });
  }
}

function startBridgeServer() {
  if (bridgeServer) {
    return;
  }

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

  processPendingProtocolUrls();

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
