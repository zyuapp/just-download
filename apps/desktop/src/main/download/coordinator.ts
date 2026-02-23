export interface DownloadRuntime {
  reason: string | null;
  controllers: Set<unknown>;
  streams: Set<unknown>;
}

export interface DownloadRecordLike {
  id: string;
  status: string;
  parts: Array<Record<string, unknown>>;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  completedAt: number | null;
}

export interface DownloadStatusMap {
  DOWNLOADING: string;
  COMPLETED: string;
  ERROR: string;
}

export interface RunDownloadDependencies {
  getDownloadById: (downloadId: string) => DownloadRecordLike | null;
  activeDownloads: Map<string, DownloadRuntime>;
  status: DownloadStatusMap;
  downloadPart: (
    download: DownloadRecordLike,
    part: Record<string, unknown>,
    runtime: DownloadRuntime
  ) => Promise<void>;
  assembleDownloadedFile: (download: DownloadRecordLike) => Promise<void>;
  sumDownloadedBytes: (parts: Array<Record<string, unknown>>) => number;
  flushProgressSync: (downloadId: string) => void;
  formatDownloadError: (error: unknown) => string;
}

const pendingRestartRequests = new Set<string>();

export async function runDownloadWithDependencies(
  downloadId: string,
  dependencies: RunDownloadDependencies
): Promise<void> {
  const download = dependencies.getDownloadById(downloadId);
  if (!download || download.status !== dependencies.status.DOWNLOADING) {
    return;
  }

  if (dependencies.activeDownloads.has(downloadId)) {
    pendingRestartRequests.add(downloadId);
    return;
  }

  const runtime: DownloadRuntime = {
    reason: null,
    controllers: new Set(),
    streams: new Set()
  };

  dependencies.activeDownloads.set(downloadId, runtime);

  try {
    await Promise.all(download.parts.map((part) => dependencies.downloadPart(download, part, runtime)));

    if (runtime.reason) {
      return;
    }

    await dependencies.assembleDownloadedFile(download);

    download.downloadedBytes = dependencies.sumDownloadedBytes(download.parts);
    if (!download.totalBytes) {
      download.totalBytes = download.downloadedBytes;
    }

    download.status = dependencies.status.COMPLETED;
    download.error = null;
    download.completedAt = Date.now();

    dependencies.flushProgressSync(download.id);
  } catch (error) {
    if (runtime.reason === 'paused' || runtime.reason === 'cancelled') {
      return;
    }

    download.status = dependencies.status.ERROR;
    download.error = dependencies.formatDownloadError(error);

    dependencies.flushProgressSync(download.id);
  } finally {
    dependencies.activeDownloads.delete(downloadId);

    const hadQueuedRestartRequest = pendingRestartRequests.delete(downloadId);
    const latest = dependencies.getDownloadById(downloadId);

    const shouldRestartAfterPause = runtime.reason === 'paused'
      && latest
      && (
        latest.status === dependencies.status.DOWNLOADING
        || hadQueuedRestartRequest
      );

    if (!shouldRestartAfterPause) {
      return;
    }

    if (latest.status !== dependencies.status.DOWNLOADING) {
      latest.status = dependencies.status.DOWNLOADING;
      latest.error = null;
      dependencies.flushProgressSync(latest.id);
    }

    await runDownloadWithDependencies(downloadId, dependencies);
  }
}
