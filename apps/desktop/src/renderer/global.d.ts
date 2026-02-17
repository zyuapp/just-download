declare global {
  type DownloadRecord = import('../shared/types').DownloadRecord;
  type ElectronAPI = import('../shared/types').ElectronAPI;

  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
