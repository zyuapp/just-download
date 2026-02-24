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
  destinationId?: string | null;
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

export interface DownloadDestination {
  id: string;
  name: string;
  directoryPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadTag extends DownloadDestination {}

export interface DownloadDestinationSettings {
  destinations: DownloadDestination[];
  lastSelectedDestinationId: string | null;
}

export interface DownloadTagSettings {
  tags: DownloadTag[];
  lastSelectedTagId: string | null;
}

export interface StartDownloadOptions {
  auth?: unknown;
  destinationId?: string | null;
  tagId?: string | null;
}

export interface DownloadDestinationInput {
  id?: string | null;
  name?: string;
  directoryPath?: string;
}

export type DownloadTagInput = DownloadDestinationInput;

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
  getDownloadDestinationSettings: () => Promise<DownloadDestinationSettings>;
  upsertDownloadDestination: (input: DownloadDestinationInput) => Promise<DownloadDestinationSettings>;
  deleteDownloadDestination: (destinationId: string) => Promise<DownloadDestinationSettings>;
  getDownloadTagSettings: () => Promise<DownloadTagSettings>;
  upsertDownloadTag: (input: DownloadTagInput) => Promise<DownloadTagSettings>;
  deleteDownloadTag: (tagId: string) => Promise<DownloadTagSettings>;
  pickDownloadDirectory: () => Promise<string | null>;
  onDraftRequested: (callback: (draft: DraftDownloadRequest) => void) => () => void;
  notifyRendererReady: () => void;
  onDownloadsChanged: (callback: (downloads: DownloadRecord[]) => void) => () => void;
}
