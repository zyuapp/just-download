import {
  createDigestAuthorizationHeader,
  createPreemptiveDigestHeader,
  parseDigestChallenge,
  type DownloadAuthState
} from './auth';
import { filenameFromContentDisposition, parsePositiveInt } from './url-utils';

export interface FetchRequestOptions extends Omit<RequestInit, 'method' | 'headers' | 'redirect'> {
  method?: string;
  headers?: Record<string, string>;
  redirect?: RequestRedirect;
}

export interface DownloadMetadata {
  finalUrl: string;
  filename: string | null;
  totalBytes: number;
  supportsRanges: boolean;
  authorizationRejected: boolean;
}

type AuthorizedFetch = (url: string, authorizationHeader: string | null) => Promise<Response>;

function resolveRequestMethod(method: string | undefined): string {
  if (typeof method !== 'string' || !method) {
    return 'GET';
  }

  return method.toUpperCase();
}

function cloneHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return {
    ...(headers || {})
  };
}

function createAuthorizedFetcher(baseOptions: FetchRequestOptions, method: string): AuthorizedFetch {
  const baseHeaders = cloneHeaders(baseOptions.headers);

  return async (url: string, authorizationHeader: string | null) => {
    const headers = cloneHeaders(baseHeaders);

    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
    } else {
      delete headers.Authorization;
    }

    return fetch(url, {
      ...baseOptions,
      method,
      headers,
      redirect: baseOptions.redirect || 'follow'
    });
  };
}

export async function cancelResponseBody(response: Response | null | undefined): Promise<void> {
  if (!response || !response.body || typeof response.body.cancel !== 'function') {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // ignore body cancel errors
  }
}

function resolveInitialAuthorizationHeader(authState: DownloadAuthState | null, method: string, requestUrl: string): string | null {
  if (!authState) {
    return null;
  }

  const preemptiveHeader = createPreemptiveDigestHeader(authState, method, requestUrl);
  if (preemptiveHeader) {
    return preemptiveHeader;
  }

  return authState.authorizationHeader;
}

function shouldRetryWithFallback(response: Response, authState: DownloadAuthState | null, hasPreemptiveHeader: boolean): boolean {
  return Boolean(
    response.status === 401
    && authState
    && !hasPreemptiveHeader
    && authState.authorizationHeaderFallback
    && authState.authorizationHeaderFallback !== authState.authorizationHeader
  );
}

async function retryWithFallback(
  response: Response,
  requestUrl: string,
  performFetch: AuthorizedFetch,
  authState: DownloadAuthState | null,
  hasPreemptiveHeader: boolean
): Promise<Response> {
  if (!shouldRetryWithFallback(response, authState, hasPreemptiveHeader) || !authState) {
    return response;
  }

  await cancelResponseBody(response);

  const retryResponse = await performFetch(requestUrl, authState.authorizationHeaderFallback);
  if (retryResponse.status >= 400) {
    return retryResponse;
  }

  const previousPrimary = authState.authorizationHeader;
  authState.authorizationHeader = authState.authorizationHeaderFallback;
  authState.authorizationHeaderFallback = previousPrimary;

  return retryResponse;
}

function shouldRetryWithDigest(response: Response, authState: DownloadAuthState | null): boolean {
  return Boolean(response.status === 401 && authState && authState.credentials);
}

async function retryWithDigest(
  response: Response,
  requestUrl: string,
  method: string,
  performFetch: AuthorizedFetch,
  authState: DownloadAuthState | null
): Promise<Response> {
  if (!shouldRetryWithDigest(response, authState) || !authState || !authState.credentials) {
    return response;
  }

  const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
  if (!challenge) {
    return response;
  }

  const challengedUrl = response.url || requestUrl;
  await cancelResponseBody(response);

  const digestHeader = createDigestAuthorizationHeader({
    challenge,
    username: authState.credentials.username,
    password: authState.credentials.password,
    method,
    url: challengedUrl
  });

  if (!digestHeader) {
    return response;
  }

  const retryResponse = await performFetch(challengedUrl, digestHeader);
  if (retryResponse.status < 400) {
    authState.digestChallenge = challenge;
  }

  return retryResponse;
}

export async function fetchWithAuthRetry(
  requestUrl: string,
  requestOptions: FetchRequestOptions,
  authState: DownloadAuthState | null = null
): Promise<Response> {
  const method = resolveRequestMethod(requestOptions.method);
  const performFetch = createAuthorizedFetcher(requestOptions, method);
  const initialAuthHeader = resolveInitialAuthorizationHeader(authState, method, requestUrl);
  const hasPreemptiveHeader = Boolean(createPreemptiveDigestHeader(authState, method, requestUrl));

  let response = await performFetch(requestUrl, initialAuthHeader);
  response = await retryWithFallback(response, requestUrl, performFetch, authState, hasPreemptiveHeader);
  response = await retryWithDigest(response, requestUrl, method, performFetch, authState);

  return response;
}

function createInitialMetadata(rawUrl: string): DownloadMetadata {
  return {
    finalUrl: rawUrl,
    filename: null,
    totalBytes: 0,
    supportsRanges: false,
    authorizationRejected: false
  };
}

function canSkipRangeProbe(metadata: DownloadMetadata): boolean {
  return metadata.totalBytes > 0 && metadata.supportsRanges && Boolean(metadata.filename);
}

function updateMetadataFromHeadResponse(metadata: DownloadMetadata, rawUrl: string, response: Response): void {
  if (response.status === 401) {
    metadata.authorizationRejected = true;
  }

  metadata.finalUrl = response.url || rawUrl;
  metadata.filename = filenameFromContentDisposition(response.headers.get('content-disposition'));
  metadata.totalBytes = parsePositiveInt(response.headers.get('content-length'));
  metadata.supportsRanges = (response.headers.get('accept-ranges') || '').toLowerCase().includes('bytes');
}

function updateMetadataFromRangeResponse(metadata: DownloadMetadata, response: Response): void {
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
}

async function probeHeadMetadata(rawUrl: string, metadata: DownloadMetadata, authState: DownloadAuthState | null): Promise<void> {
  try {
    const response = await fetchWithAuthRetry(rawUrl, {
      method: 'HEAD',
      redirect: 'follow'
    }, authState);
    updateMetadataFromHeadResponse(metadata, rawUrl, response);
  } catch {
    // fall through to probe request below
  }
}

async function probeRangeMetadata(rawUrl: string, metadata: DownloadMetadata, authState: DownloadAuthState | null): Promise<void> {
  try {
    const response = await fetchWithAuthRetry(metadata.finalUrl || rawUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow'
    }, authState);

    updateMetadataFromRangeResponse(metadata, response);
    await cancelResponseBody(response);
  } catch {
    // keep best-effort metadata values
  }
}

export async function fetchMetadata(rawUrl: string, authState: DownloadAuthState | null = null): Promise<DownloadMetadata> {
  const metadata = createInitialMetadata(rawUrl);

  await probeHeadMetadata(rawUrl, metadata, authState);
  if (canSkipRangeProbe(metadata)) {
    return metadata;
  }

  await probeRangeMetadata(rawUrl, metadata, authState);
  return metadata;
}
