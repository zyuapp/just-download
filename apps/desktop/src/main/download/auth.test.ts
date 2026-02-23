import { describe, expect, it } from 'vitest';

import {
  createDigestAuthorizationHeader,
  createDownloadAuthState,
  createPreemptiveDigestHeader,
  parseDigestChallenge
} from './auth';

describe('parseDigestChallenge', () => {
  it('parses a valid digest challenge', () => {
    const challenge = parseDigestChallenge('Digest realm="files", nonce="abc", qop="auth"');
    expect(challenge).toEqual({
      realm: 'files',
      nonce: 'abc',
      opaque: null,
      algorithm: 'MD5',
      qop: 'auth'
    });
  });

  it('returns null for unsupported algorithms', () => {
    expect(parseDigestChallenge('Digest realm="files", nonce="abc", algorithm="SHA-256"')).toBeNull();
  });
});

describe('createDigestAuthorizationHeader', () => {
  it('creates a digest authorization header', () => {
    const header = createDigestAuthorizationHeader({
      challenge: {
        realm: 'files',
        nonce: 'abc',
        opaque: null,
        algorithm: 'MD5',
        qop: 'auth'
      },
      username: 'alice',
      password: 'secret',
      method: 'GET',
      url: 'https://example.com/archive.zip'
    });

    expect(header).toContain('Digest username="alice"');
    expect(header).toContain('realm="files"');
    expect(header).toContain('uri="/archive.zip"');
  });
});

describe('createDownloadAuthState', () => {
  it('creates state with credentials for basic auth requests', () => {
    const state = createDownloadAuthState({
      url: 'https://example.com/file',
      auth: { type: 'basic', username: 'u', password: 'p' },
      authorizationHeader: 'Basic abc',
      authorizationHeaderFallback: null
    });

    expect(state.credentials).toEqual({ username: 'u', password: 'p' });
  });
});

describe('createPreemptiveDigestHeader', () => {
  it('returns null when challenge is not known yet', () => {
    const state = createDownloadAuthState({
      url: 'https://example.com/file',
      auth: { type: 'basic', username: 'u', password: 'p' },
      authorizationHeader: 'Basic abc',
      authorizationHeaderFallback: null
    });

    expect(createPreemptiveDigestHeader(state, 'GET', 'https://example.com/file')).toBeNull();
  });
});
