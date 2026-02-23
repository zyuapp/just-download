import { describe, expect, it } from 'vitest';

import {
  runDownloadWithDependencies,
  type DownloadRuntime,
  type DownloadRecordLike,
  type RunDownloadDependencies
} from './coordinator';

const STATUS = {
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
} as const;

interface TestContext {
  dependencies: RunDownloadDependencies;
  activeDownloads: Map<string, DownloadRuntime>;
  releasePart: (() => void) | null;
  downloadPartCalls: () => number;
}

function createDownload(id: string, totalBytes: number): DownloadRecordLike {
  return {
    id,
    status: STATUS.DOWNLOADING,
    parts: [{ index: 0 }],
    downloadedBytes: 0,
    totalBytes,
    error: null,
    completedAt: null
  };
}

function createTestContext(download: DownloadRecordLike): TestContext {
  const activeDownloads = new Map<string, DownloadRuntime>();
  let releasePart: (() => void) | null = null;
  let callCount = 0;

  const firstPartGate = new Promise<void>((resolve) => {
    releasePart = resolve;
  });

  const dependencies: RunDownloadDependencies = {
    getDownloadById: (id: string) => (id === download.id ? download : null),
    activeDownloads,
    status: STATUS,
    downloadPart: async () => {
      callCount += 1;
      if (callCount === 1) {
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

  return {
    dependencies,
    activeDownloads,
    releasePart,
    downloadPartCalls: () => callCount
  };
}

describe('runDownloadWithDependencies', () => {
  it('restarts when resume races with paused runtime cleanup', async () => {
    const download = createDownload('download-1', 1024);
    const context = createTestContext(download);

    const firstRun = runDownloadWithDependencies(download.id, context.dependencies);

    const runtime = context.activeDownloads.get(download.id);
    expect(runtime).toBeTruthy();

    if (!runtime) {
      throw new Error('Expected first runtime to be active.');
    }

    download.status = STATUS.PAUSED;
    runtime.reason = 'paused';

    download.status = STATUS.DOWNLOADING;
    await runDownloadWithDependencies(download.id, context.dependencies);

    if (!context.releasePart) {
      throw new Error('Expected test gate to be initialized.');
    }
    context.releasePart();

    await firstRun;

    expect(context.downloadPartCalls()).toBe(2);
  });

  it('drops quick resume if resume is sent before pause settles', async () => {
    const download = createDownload('download-2', 2048);
    const context = createTestContext(download);

    const firstRun = runDownloadWithDependencies(download.id, context.dependencies);

    const runtime = context.activeDownloads.get(download.id);
    expect(runtime).toBeTruthy();

    if (!runtime) {
      throw new Error('Expected first runtime to be active.');
    }

    await runDownloadWithDependencies(download.id, context.dependencies);

    download.status = STATUS.PAUSED;
    runtime.reason = 'paused';

    if (!context.releasePart) {
      throw new Error('Expected test gate to be initialized.');
    }
    context.releasePart();

    await firstRun;

    expect(context.downloadPartCalls()).toBe(2);
  });
});
