export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadPart {
  index: number;
  start: number;
  end: number | null;
  downloaded: number;
  tempPath: string;
}

export interface DownloadRecord {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  tagId?: string | null;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  error: string | null;
  supportsRanges: boolean;
  parts: DownloadPart[];
  createdAt: number;
  completedAt: number | null;
}

export interface DraftDownloadRequest {
  url: string;
  source: string | null;
  requestId: string | null;
  createdAt: number;
}

export interface DownloadTag {
  id: string;
  name: string;
  directoryPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadTagSettings {
  tags: DownloadTag[];
  lastSelectedTagId: string | null;
}

export interface StartDownloadOptions {
  auth?: unknown;
  tagId?: string | null;
}

export interface DownloadTagInput {
  id?: string | null;
  name?: string;
  directoryPath?: string;
}

export interface ElectronAPI {
  startDownload: (url: string, options?: StartDownloadOptions) => Promise<DownloadRecord>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  deleteDownload: (id: string) => Promise<void>;
  openFile: (id: string) => Promise<void>;
  openFolder: (id: string) => Promise<void>;
  getDownloads: () => Promise<DownloadRecord[]>;
  getDownloadTagSettings: () => Promise<DownloadTagSettings>;
  upsertDownloadTag: (input: DownloadTagInput) => Promise<DownloadTagSettings>;
  deleteDownloadTag: (tagId: string) => Promise<DownloadTagSettings>;
  pickDownloadDirectory: () => Promise<string | null>;
  onDraftRequested: (callback: (draft: DraftDownloadRequest) => void) => () => void;
  notifyRendererReady: () => void;
  onDownloadsChanged: (callback: (downloads: DownloadRecord[]) => void) => () => void;
}
