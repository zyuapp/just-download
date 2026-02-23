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
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Please enter a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  let auth = parseBridgeAuth(authPayload, maxAuthFieldLength);
  const authHeaderCandidates: string[] = [];

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
