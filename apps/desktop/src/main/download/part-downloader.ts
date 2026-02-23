import fs from 'fs';

import type { DownloadAuthState } from './auth';
import { fetchWithAuthRetry } from './http-client';
import { finalizeWritableStream, waitForWritableDrain } from './stream-lifecycle';
import { parsePositiveInt } from './url-utils';

export interface DownloadPartRecord {
  start: number;
  end: number | null;
  downloaded: number;
  tempPath: string;
}

export interface DownloadRecordWithParts {
  id: string;
  url: string;
  supportsRanges: boolean;
  totalBytes: number;
  downloadedBytes: number;
  parts: DownloadPartRecord[];
  authState: DownloadAuthState | null;
}

export interface DownloadRuntime {
  reason: string | null;
  controllers: Set<AbortController>;
  streams: Set<fs.WriteStream>;
}

export interface DownloadPartHelpers {
  safeUnlink: (filePath: string) => Promise<void>;
  scheduleProgressSync: (downloadId: string) => void;
  sumDownloadedBytes: (parts: DownloadPartRecord[]) => number;
}

function shouldResetPartProgress(download: DownloadRecordWithParts, part: DownloadPartRecord): boolean {
  return !download.supportsRanges && part.downloaded > 0;
}

async function resetPartProgress(download: DownloadRecordWithParts, part: DownloadPartRecord, safeUnlink: (filePath: string) => Promise<void>): Promise<void> {
  if (!shouldResetPartProgress(download, part)) {
    return;
  }

  part.downloaded = 0;
  await safeUnlink(part.tempPath);
}

function isPartComplete(startOffset: number, part: DownloadPartRecord): boolean {
  return Number.isFinite(part.end) && startOffset > Number(part.end);
}

function buildRangeHeaders(part: DownloadPartRecord, canResumeWithRange: boolean, startOffset: number): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!canResumeWithRange) {
    return headers;
  }

  if (Number.isFinite(part.end)) {
    headers.Range = `bytes=${startOffset}-${part.end}`;
  } else {
    headers.Range = `bytes=${startOffset}-`;
  }

  return headers;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as Error).name === 'AbortError');
}

async function fetchPartResponse(
  download: DownloadRecordWithParts,
  headers: Record<string, string>,
  controller: AbortController,
  runtime: DownloadRuntime
): Promise<Response> {
  try {
    return await fetchWithAuthRetry(download.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal
    }, download.authState || null);
  } catch (error) {
    runtime.controllers.delete(controller);

    if (runtime.reason && isAbortError(error)) {
      throw new Error('REQUEST_ABORTED');
    }

    throw error;
  }
}

async function ensureResponseCanResume(
  response: Response,
  part: DownloadPartRecord,
  canResumeWithRange: boolean
): Promise<void> {
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!(canResumeWithRange && part.downloaded > 0 && response.status !== 206)) {
    return;
  }

  if (response.body && typeof response.body.cancel === 'function') {
    await response.body.cancel();
  }

  throw new Error('Server does not support resuming this download.');
}

function updateDownloadTotalBytes(download: DownloadRecordWithParts, part: DownloadPartRecord, response: Response): void {
  const contentRange = response.headers.get('content-range');
  if (!download.totalBytes && contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match && match[1]) {
      download.totalBytes = parsePositiveInt(match[1]);
    }
  }

  if (download.totalBytes) {
    return;
  }

  const contentLength = parsePositiveInt(response.headers.get('content-length'));
  if (contentLength <= 0) {
    return;
  }

  download.totalBytes = response.status === 206 ? part.downloaded + contentLength : contentLength;
  if (!Number.isFinite(part.end) && Number.isFinite(download.totalBytes) && download.totalBytes > 0) {
    part.end = download.totalBytes - 1;
  }
}

async function writeResponseToPart(
  response: Response,
  download: DownloadRecordWithParts,
  part: DownloadPartRecord,
  runtime: DownloadRuntime,
  helpers: DownloadPartHelpers
): Promise<void> {
  if (!response.body) {
    throw new Error('Empty response body.');
  }

  const writeStream = fs.createWriteStream(part.tempPath, {
    flags: part.downloaded > 0 ? 'a' : 'w'
  });

  let streamError: Error | null = null;
  const onStreamError = (error: Error) => {
    streamError = error;
  };
  writeStream.on('error', onStreamError);
  runtime.streams.add(writeStream);

  try {
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }

      if (runtime.reason) {
        break;
      }

      if (streamError) {
        throw streamError;
      }

      if (!writeStream.write(value)) {
        await waitForWritableDrain(writeStream, () => Boolean(runtime.reason));
      }

      if (runtime.reason || writeStream.destroyed) {
        break;
      }

      part.downloaded += value.length;
      download.downloadedBytes = helpers.sumDownloadedBytes(download.parts);
      helpers.scheduleProgressSync(download.id);
    }

    if (streamError) {
      throw streamError;
    }
  } finally {
    writeStream.off('error', onStreamError);
    await finalizeWritableStream(writeStream);
    runtime.streams.delete(writeStream);
  }
}

export async function downloadPartWithHelpers(
  download: DownloadRecordWithParts,
  part: DownloadPartRecord,
  runtime: DownloadRuntime,
  helpers: DownloadPartHelpers
): Promise<void> {
  await resetPartProgress(download, part, helpers.safeUnlink);

  const canResumeWithRange = download.supportsRanges;
  const startOffset = part.start + part.downloaded;
  if (isPartComplete(startOffset, part)) {
    return;
  }

  const headers = buildRangeHeaders(part, canResumeWithRange, startOffset);
  const controller = new AbortController();
  runtime.controllers.add(controller);

  let response: Response;
  try {
    response = await fetchPartResponse(download, headers, controller, runtime);
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_ABORTED') {
      return;
    }

    throw error;
  }

  if (response.url && response.url !== download.url) {
    download.url = response.url;
  }

  await ensureResponseCanResume(response, part, canResumeWithRange);
  updateDownloadTotalBytes(download, part, response);

  try {
    await writeResponseToPart(response, download, part, runtime, helpers);
  } catch (error) {
    if (!(runtime.reason && isAbortError(error))) {
      throw error;
    }
  } finally {
    runtime.controllers.delete(controller);
  }
}
