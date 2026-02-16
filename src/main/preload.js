const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDownload: (url) => ipcRenderer.invoke('download:start', url),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  openFile: (id) => ipcRenderer.invoke('download:open', id),
  openFolder: (id) => ipcRenderer.invoke('download:open-folder', id),
  removeDownload: (id) => ipcRenderer.invoke('download:remove', id),
  deleteDownload: (id) => ipcRenderer.invoke('download:delete', id),
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  onDownloadUpdate: (callback) => {
    ipcRenderer.on('download:update', (event, data) => callback(data));
  }
});
