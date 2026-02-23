import { createHash, randomUUID } from 'crypto';

import type { BasicAuth, NormalizedDownloadRequest } from './request-normalization';

export interface DigestChallenge {
  realm: string;
  nonce: string;
  opaque: string | null;
  algorithm: 'MD5' | 'MD5-SESS';
  qop: 'auth' | null;
}

export interface DownloadAuthState {
  credentials: Pick<BasicAuth, 'username' | 'password'> | null;
  authorizationHeader: string | null;
  authorizationHeaderFallback: string | null;
  digestChallenge: DigestChallenge | null;
}

export interface DigestAuthorizationOptions {
  challenge: DigestChallenge;
  username: string;
  password: string;
  method?: string;
  url: string;
}

function md5Hex(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function escapeDigestValue(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function chooseDigestQop(rawValue: string): 'auth' | null {
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

function parseDigestParams(digestPart: string): Record<string, string> {
  const params: Record<string, string> = {};
  const paramPattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g;

  let match: RegExpExecArray | null;
  while ((match = paramPattern.exec(digestPart)) !== null) {
    const key = match[1].toLowerCase();
    const quotedValue = typeof match[2] === 'string' ? match[2].replace(/\\(.)/g, '$1') : null;
    const tokenValue = typeof match[3] === 'string' ? match[3].trim() : null;
    const value = quotedValue !== null ? quotedValue : tokenValue;

    if (typeof value === 'string' && value) {
      params[key] = value;
    }
  }

  return params;
}

function resolveDigestAlgorithm(rawAlgorithm: string | undefined): DigestChallenge['algorithm'] | null {
  const algorithm = (rawAlgorithm || 'MD5').toUpperCase();
  if (algorithm === 'MD5' || algorithm === 'MD5-SESS') {
    return algorithm;
  }

  return null;
}

function resolveDigestUri(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return null;
  }
}

function buildDigestResponseValue(
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string,
  nonceCount: string,
  cnonce: string
): string {
  let ha1 = md5Hex(`${username}:${challenge.realm}:${password}`);
  if (challenge.algorithm === 'MD5-SESS') {
    ha1 = md5Hex(`${ha1}:${challenge.nonce}:${cnonce}`);
  }

  const ha2 = md5Hex(`${method}:${uri}`);
  if (!challenge.qop) {
    return md5Hex(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  return md5Hex(`${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${challenge.qop}:${ha2}`);
}

function buildDigestHeaderParts(
  challenge: DigestChallenge,
  username: string,
  uri: string,
  responseDigest: string,
  nonceCount: string,
  cnonce: string
): string[] {
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

  return parts;
}

export function parseDigestChallenge(headerValue: string | null | undefined): DigestChallenge | null {
  if (typeof headerValue !== 'string' || !headerValue) {
    return null;
  }

  const digestIndex = headerValue.toLowerCase().indexOf('digest ');
  if (digestIndex < 0) {
    return null;
  }

  const params = parseDigestParams(headerValue.slice(digestIndex + 7));

  if (!params.realm || !params.nonce) {
    return null;
  }

  const algorithm = resolveDigestAlgorithm(params.algorithm);
  if (!algorithm) {
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

export function createDigestAuthorizationHeader(options: DigestAuthorizationOptions | null | undefined): string | null {
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

  const uri = resolveDigestUri(targetUrl);
  if (!uri) {
    return null;
  }

  const cnonce = randomUUID().replace(/-/g, '');
  const nonceCount = '00000001';
  const responseDigest = buildDigestResponseValue(challenge, username, password, method, uri, nonceCount, cnonce);
  const parts = buildDigestHeaderParts(challenge, username, uri, responseDigest, nonceCount, cnonce);

  return parts.join(', ');
}

export function createDownloadAuthState(normalizedRequest: NormalizedDownloadRequest): DownloadAuthState {
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

export function createPreemptiveDigestHeader(
  authState: DownloadAuthState | null,
  method: string,
  requestUrl: string
): string | null {
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
