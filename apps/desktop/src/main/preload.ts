import { contextBridge, ipcRenderer } from 'electron';

import type { DownloadRecord, ElectronAPI } from '../shared/types';

const electronAPI: ElectronAPI = {
  startDownload: (url) => ipcRenderer.invoke('download:start', url),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('download:remove', id),
  deleteDownload: (id) => ipcRenderer.invoke('download:delete', id),
  openFile: (id) => ipcRenderer.invoke('download:open', id),
  openFolder: (id) => ipcRenderer.invoke('download:open-folder', id),
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
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
