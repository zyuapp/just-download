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
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadStatus;
  error: string | null;
  supportsRanges: boolean;
  parts: DownloadPart[];
  createdAt: number;
  completedAt: number | null;
}

export interface ElectronAPI {
  startDownload: (url: string) => Promise<DownloadRecord>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  deleteDownload: (id: string) => Promise<void>;
  openFile: (id: string) => Promise<void>;
  openFolder: (id: string) => Promise<void>;
  getDownloads: () => Promise<DownloadRecord[]>;
  onDownloadsChanged: (callback: (downloads: DownloadRecord[]) => void) => () => void;
}
