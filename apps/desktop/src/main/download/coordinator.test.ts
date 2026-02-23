import { describe, expect, it } from 'vitest';

import { runDownloadWithDependencies } from './coordinator';

const STATUS = {
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
} as const;

describe('runDownloadWithDependencies', () => {
  it('restarts when resume races with paused runtime cleanup', async () => {
    const download: {
      id: string;
      status: string;
      parts: Array<Record<string, unknown>>;
      downloadedBytes: number;
      totalBytes: number;
      error: string | null;
      completedAt: number | null;
    } = {
      id: 'download-1',
      status: STATUS.DOWNLOADING,
      parts: [{ index: 0 }],
      downloadedBytes: 0,
      totalBytes: 1024,
      error: null,
      completedAt: null
    };

    const activeDownloads = new Map();

    let releasePart: (() => void) | null = null;
    const firstPartGate = new Promise<void>((resolve) => {
      releasePart = resolve;
    });

    let downloadPartCalls = 0;

    const dependencies = {
      getDownloadById: (id: string) => (id === download.id ? download : null),
      activeDownloads,
      status: STATUS,
      downloadPart: async () => {
        downloadPartCalls += 1;
        if (downloadPartCalls === 1) {
          await firstPartGate;
        }
      },
      assembleDownloadedFile: async () => {},
      sumDownloadedBytes: () => 0,
      flushProgressSync: () => {},
      formatDownloadError: (error: unknown) => {
        if (error instanceof Error) {
          return error.message;
        }

        return 'Unknown error';
      }
    };

    const firstRun = runDownloadWithDependencies(download.id, dependencies);

    const runtime = activeDownloads.get(download.id);
    expect(runtime).toBeTruthy();

    if (!runtime) {
      throw new Error('Expected first runtime to be active.');
    }

    download.status = STATUS.PAUSED;
    runtime.reason = 'paused';

    download.status = STATUS.DOWNLOADING;
    await runDownloadWithDependencies(download.id, dependencies);

    if (!releasePart) {
      throw new Error('Expected test gate to be initialized.');
    }
    releasePart();

    await firstRun;

    expect(downloadPartCalls).toBe(2);
  });

  it('drops quick resume if resume is sent before pause settles', async () => {
    const download: {
      id: string;
      status: string;
      parts: Array<Record<string, unknown>>;
      downloadedBytes: number;
      totalBytes: number;
      error: string | null;
      completedAt: number | null;
    } = {
      id: 'download-2',
      status: STATUS.DOWNLOADING,
      parts: [{ index: 0 }],
      downloadedBytes: 0,
      totalBytes: 2048,
      error: null,
      completedAt: null
    };

    const activeDownloads = new Map();

    let releasePart: (() => void) | null = null;
    const firstPartGate = new Promise<void>((resolve) => {
      releasePart = resolve;
    });

    let downloadPartCalls = 0;

    const dependencies = {
      getDownloadById: (id: string) => (id === download.id ? download : null),
      activeDownloads,
      status: STATUS,
      downloadPart: async () => {
        downloadPartCalls += 1;
        if (downloadPartCalls === 1) {
          await firstPartGate;
        }
      },
      assembleDownloadedFile: async () => {},
      sumDownloadedBytes: () => 0,
      flushProgressSync: () => {},
      formatDownloadError: (error: unknown) => {
        if (error instanceof Error) {
          return error.message;
        }

        return 'Unknown error';
      }
    };

    const firstRun = runDownloadWithDependencies(download.id, dependencies);

    const runtime = activeDownloads.get(download.id);
    expect(runtime).toBeTruthy();

    if (!runtime) {
      throw new Error('Expected first runtime to be active.');
    }

    await runDownloadWithDependencies(download.id, dependencies);

    download.status = STATUS.PAUSED;
    runtime.reason = 'paused';

    if (!releasePart) {
      throw new Error('Expected test gate to be initialized.');
    }
    releasePart();

    await firstRun;

    expect(downloadPartCalls).toBe(2);
  });
});
