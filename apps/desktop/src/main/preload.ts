import { contextBridge, ipcRenderer } from 'electron';

import type {
  DraftDownloadRequest,
  DownloadRecord,
  DownloadTagInput,
  DownloadTagSettings,
  ElectronAPI,
  StartDownloadOptions
} from '../shared/types';

const electronAPI: ElectronAPI = {
  startDownload: (url: string, options?: StartDownloadOptions) => ipcRenderer.invoke('download:start', url, options),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('download:remove', id),
  deleteDownload: (id) => ipcRenderer.invoke('download:delete', id),
  openFile: (id) => ipcRenderer.invoke('download:open', id),
  openFolder: (id) => ipcRenderer.invoke('download:open-folder', id),
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  getDownloadTagSettings: (): Promise<DownloadTagSettings> => ipcRenderer.invoke('settings:download-tags:get'),
  upsertDownloadTag: (input: DownloadTagInput): Promise<DownloadTagSettings> => ipcRenderer.invoke('settings:download-tags:upsert', input),
  deleteDownloadTag: (tagId: string): Promise<DownloadTagSettings> => ipcRenderer.invoke('settings:download-tags:delete', tagId),
  pickDownloadDirectory: (): Promise<string | null> => ipcRenderer.invoke('settings:download-tags:pick-directory'),
  onDraftRequested: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DraftDownloadRequest) => {
      callback(payload);
    };

    ipcRenderer.on('download:draft', listener);

    return () => {
      ipcRenderer.removeListener('download:draft', listener);
    };
  },
  notifyRendererReady: () => {
    ipcRenderer.send('renderer:ready');
  },
  onDownloadsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadRecord[]) => {
      callback(payload);
    };

    ipcRenderer.on('downloads:changed', listener);

    return () => {
      ipcRenderer.removeListener('downloads:changed', listener);
    };
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
