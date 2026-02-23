export type BasicAuth = {
  type: 'basic';
  username: string;
  password: string;
};

export interface NormalizedDownloadRequest {
  url: string;
  auth: BasicAuth | null;
  authorizationHeader: string | null;
  authorizationHeaderFallback: string | null;
}

interface ParsedUrlAuth {
  auth: BasicAuth;
  rawUsername: string;
  rawPassword: string;
}

interface ResolvedAuthPayload {
  auth: BasicAuth | null;
  authHeaderCandidates: string[];
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildBasicAuthorization(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function pushUniqueAuthHeader(headers: string[], header: string | null): void {
  if (typeof header !== 'string' || !header) {
    return;
  }

  if (!headers.includes(header)) {
    headers.push(header);
  }
}

function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Please enter a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  return parsed;
}

function parseAuthFromUrl(parsedUrl: URL): ParsedUrlAuth | null {
  if (!parsedUrl.username && !parsedUrl.password) {
    return null;
  }

  const rawUsername = parsedUrl.username || '';
  const rawPassword = parsedUrl.password || '';

  return {
    auth: {
      type: 'basic',
      username: decodeURIComponentSafe(rawUsername),
      password: decodeURIComponentSafe(rawPassword)
    },
    rawUsername,
    rawPassword
  };
}

function collectAuthHeaderCandidates(auth: BasicAuth | null, parsedUrl: URL): string[] {
  const authHeaderCandidates: string[] = [];

  if (auth) {
    pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(auth.username, auth.password));
    return authHeaderCandidates;
  }

  const urlAuth = parseAuthFromUrl(parsedUrl);
  if (!urlAuth) {
    return authHeaderCandidates;
  }

  pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(urlAuth.auth.username, urlAuth.auth.password));

  if (urlAuth.rawUsername !== urlAuth.auth.username || urlAuth.rawPassword !== urlAuth.auth.password) {
    pushUniqueAuthHeader(authHeaderCandidates, buildBasicAuthorization(urlAuth.rawUsername, urlAuth.rawPassword));
  }

  return authHeaderCandidates;
}

function resolveAuthFromPayload(authPayload: unknown, parsedUrl: URL, maxAuthFieldLength: number): ResolvedAuthPayload {
  const auth = parseBridgeAuth(authPayload, maxAuthFieldLength);
  if (auth) {
    return {
      auth,
      authHeaderCandidates: collectAuthHeaderCandidates(auth, parsedUrl)
    };
  }

  const parsedUrlAuth = parseAuthFromUrl(parsedUrl);
  return {
    auth: parsedUrlAuth ? parsedUrlAuth.auth : null,
    authHeaderCandidates: collectAuthHeaderCandidates(null, parsedUrl)
  };
}

export function normalizeBridgeRequestId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, 200);
}

export function parseBridgeAuth(authPayload: unknown, maxAuthFieldLength = 1024): BasicAuth | null {
  if (!authPayload) {
    return null;
  }

  if (typeof authPayload !== 'object') {
    throw new Error('Invalid auth payload.');
  }

  const rawAuth = authPayload as {
    type?: unknown;
    username?: unknown;
    password?: unknown;
  };

  const type = typeof rawAuth.type === 'string' ? rawAuth.type.trim().toLowerCase() : '';
  if (type !== 'basic') {
    throw new Error('Only basic auth is supported.');
  }

  const username = typeof rawAuth.username === 'string' ? rawAuth.username : '';
  const password = typeof rawAuth.password === 'string' ? rawAuth.password : '';

  if (!username && !password) {
    throw new Error('Basic auth credentials are missing.');
  }

  if (username.length > maxAuthFieldLength || password.length > maxAuthFieldLength) {
    throw new Error('Auth credentials are too long.');
  }

  return {
    type: 'basic',
    username,
    password
  };
}

export function normalizeDownloadRequest(rawUrl: string, authPayload: unknown = null, maxAuthFieldLength = 1024): NormalizedDownloadRequest {
  const parsed = parseHttpUrl(rawUrl);
  const { auth, authHeaderCandidates } = resolveAuthFromPayload(authPayload, parsed, maxAuthFieldLength);

  parsed.username = '';
  parsed.password = '';

  return {
    url: parsed.toString(),
    auth,
    authorizationHeader: authHeaderCandidates[0] || null,
    authorizationHeaderFallback: authHeaderCandidates[1] || null
  };
}
