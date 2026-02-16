const { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

let Store;
try {
  Store = require('electron-store').default;
} catch (e) {
  Store = require('electron-store');
}

const store = new Store({ name: 'downloads' });
const downloadsDir = path.join(app.getPath('home'), 'Downloads', 'JustDownload');

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

let mainWindow = null;
let tray = null;
const activeDownloads = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Just Download');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function getDownloads() {
  return store.get('downloads', []);
}

function saveDownloads(downloads) {
  store.set('downloads', downloads);
}

function getUniqueFilename(filename) {
  let uniqueFilename = filename;
  let counter = 1;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  while (fs.existsSync(path.join(downloadsDir, uniqueFilename))) {
    uniqueFilename = `${base} (${counter})${ext}`;
    counter++;
  }

  return uniqueFilename;
}

function sanitizeFilename(url) {
  try {
    const urlObj = new URL(url);
    let filename = path.basename(urlObj.pathname);
    if (!filename || filename === '/') {
      filename = 'download';
    }
    filename = filename.replace(/[<>:"/\\|?*]/g, '_');
    return filename || 'download';
  } catch (e) {
    return 'download';
  }
}

async function getFileSize(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.request(url, { method: 'HEAD' }, (response) => {
      const contentLength = parseInt(response.headers['content-length'], 10);
      resolve(isNaN(contentLength) ? 0 : contentLength);
    });
    request.on('error', () => resolve(0));
    request.end();
  });
}

function downloadPart(url, part, downloadItem, resolve, reject) {
  const protocol = url.startsWith('https') ? https : http;

  const options = {
    headers: {
      'Range': `bytes=${part.start}-${part.end}`
    }
  };

  const request = protocol.get(url, options, (response) => {
    if (response.statusCode >= 400) {
      reject(new Error(`HTTP ${response.statusCode}`));
      return;
    }

    const filePath = path.join(downloadsDir, `${downloadItem.id}_part${part.index}`);
    const fileStream = fs.createWriteStream(filePath);

    response.pipe(fileStream);

    response.on('data', (chunk) => {
      part.downloaded += chunk.length;
      downloadItem.downloadedBytes = downloadItem.parts.reduce((sum, p) => sum + p.downloaded, 0);
      broadcastUpdate(downloadItem);
    });

    fileStream.on('finish', () => {
      part.path = filePath;
      resolve();
    });

    fileStream.on('error', (err) => {
      reject(err);
    });
  });

  request.on('error', (err) => {
    reject(err);
  });

  downloadItem.activeRequests = downloadItem.activeRequests || [];
  downloadItem.activeRequests.push(request);
}

async function startMultipartDownload(downloadItem) {
  const { url, id, totalBytes, parts } = downloadItem;

  try {
    const promises = parts.map((part, index) => {
      part.index = index;
      return downloadPart(url, part, downloadItem);
    });

    await Promise.all(promises);

    const finalPath = path.join(downloadsDir, downloadItem.filename);
    const writeStream = fs.createWriteStream(finalPath);

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts[i].path;
      const partData = fs.readFileSync(partPath);
      writeStream.write(partData);
      fs.unlinkSync(partPath);
    }

    writeStream.end();

    downloadItem.status = 'completed';
    downloadItem.completedAt = Date.now();
    downloadItem.savePath = finalPath;
    downloadItem.downloadedBytes = totalBytes;

    saveDownload(downloadItem);
    broadcastUpdate(downloadItem);
  } catch (error) {
    if (downloadItem.status !== 'paused') {
      downloadItem.status = 'error';
      downloadItem.error = error.message;
      saveDownload(downloadItem);
      broadcastUpdate(downloadItem);
    }
  } finally {
    activeDownloads.delete(id);
  }
}

async function startSinglePartDownload(downloadItem) {
  const { url, id } = downloadItem;
  const protocol = url.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    const request = protocol.get(url, (response) => {
      if (response.statusCode >= 400) {
        downloadItem.status = 'error';
        downloadItem.error = `HTTP ${response.statusCode}`;
        saveDownload(downloadItem);
        broadcastUpdate(downloadItem);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const filePath = path.join(downloadsDir, downloadItem.filename);
      const fileStream = fs.createWriteStream(filePath);

      response.pipe(fileStream);

      response.on('data', (chunk) => {
        downloadItem.downloadedBytes += chunk.length;
        if (downloadItem.totalBytes > 0) {
          broadcastUpdate(downloadItem);
        }
      });

      fileStream.on('finish', () => {
        downloadItem.status = 'completed';
        downloadItem.completedAt = Date.now();
        downloadItem.savePath = filePath;
        downloadItem.totalBytes = downloadItem.downloadedBytes;
        saveDownload(downloadItem);
        broadcastUpdate(downloadItem);
        activeDownloads.delete(id);
        resolve();
      });

      fileStream.on('error', (err) => {
        downloadItem.status = 'error';
        downloadItem.error = err.message;
        saveDownload(downloadItem);
        broadcastUpdate(downloadItem);
        activeDownloads.delete(id);
        reject(err);
      });

      downloadItem.activeRequests = [request];
    });

    request.on('error', (err) => {
      if (downloadItem.status !== 'paused') {
        downloadItem.status = 'error';
        downloadItem.error = err.message;
        saveDownload(downloadItem);
        broadcastUpdate(downloadItem);
      }
      activeDownloads.delete(id);
      reject(err);
    });
  });
}

function saveDownload(downloadItem) {
  const downloads = getDownloads();
  const index = downloads.findIndex(d => d.id === downloadItem.id);
  if (index >= 0) {
    downloads[index] = downloadItem;
  } else {
    downloads.push(downloadItem);
  }
  saveDownloads(downloads);
}

function broadcastUpdate(downloadItem) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download:update', downloadItem);
  }
}

async function handleStartDownload(url) {
  const filename = sanitizeFilename(url);
  const uniqueFilename = getUniqueFilename(filename);
  const id = uuidv4();

  const totalBytes = await getFileSize(url);

  const downloadItem = {
    id,
    url,
    filename: uniqueFilename,
    savePath: path.join(downloadsDir, uniqueFilename),
    totalBytes,
    downloadedBytes: 0,
    status: 'downloading',
    error: null,
    parts: [],
    createdAt: Date.now(),
    completedAt: null,
    activeRequests: []
  };

  if (totalBytes > 0 && totalBytes > 1024 * 1024) {
    const numParts = 4;
    const partSize = Math.floor(totalBytes / numParts);

    for (let i = 0; i < numParts; i++) {
      const start = i * partSize;
      const end = i === numParts - 1 ? totalBytes - 1 : (i + 1) * partSize - 1;
      downloadItem.parts.push({
        start,
        end,
        downloaded: 0,
        path: null
      });
    }
  }

  saveDownload(downloadItem);
  broadcastUpdate(downloadItem);

  if (downloadItem.parts.length > 0) {
    activeDownloads.set(id, { item: downloadItem, type: 'multipart' });
    startMultipartDownload(downloadItem);
  } else {
    activeDownloads.set(id, { item: downloadItem, type: 'single' });
    startSinglePartDownload(downloadItem);
  }

  return downloadItem;
}

async function handlePauseDownload(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (!downloadItem || downloadItem.status !== 'downloading') return;

  if (downloadItem.activeRequests) {
    downloadItem.activeRequests.forEach(req => {
      try { req.abort(); } catch (e) {}
    });
  }

  downloadItem.parts.forEach(part => {
    if (part.path && fs.existsSync(part.path)) {
      const stats = fs.statSync(part.path);
      part.downloaded = stats.size;
    }
  });

  downloadItem.downloadedBytes = downloadItem.parts.reduce((sum, p) => sum + (p.downloaded || 0), 0);
  downloadItem.status = 'paused';

  saveDownload(downloadItem);
  broadcastUpdate(downloadItem);
}

async function handleResumeDownload(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (!downloadItem || downloadItem.status !== 'paused') return;

  downloadItem.status = 'downloading';
  downloadItem.error = null;

  if (downloadItem.parts.length > 0) {
    activeDownloads.set(id, { item: downloadItem, type: 'multipart' });
    startMultipartDownload(downloadItem);
  } else {
    activeDownloads.set(id, { item: downloadItem, type: 'single' });
    startSinglePartDownload(downloadItem);
  }
}

async function handleCancelDownload(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (!downloadItem) return;

  if (downloadItem.activeRequests) {
    downloadItem.activeRequests.forEach(req => {
      try { req.abort(); } catch (e) {}
    });
  }

  if (downloadItem.parts) {
    downloadItem.parts.forEach(part => {
      if (part.path && fs.existsSync(part.path)) {
        try { fs.unlinkSync(part.path); } catch (e) {}
      }
    });
  }

  const finalPath = path.join(downloadsDir, downloadItem.filename);
  if (fs.existsSync(finalPath)) {
    try { fs.unlinkSync(finalPath); } catch (e) {}
  }

  const updatedDownloads = downloads.filter(d => d.id !== id);
  saveDownloads(updatedDownloads);
  broadcastUpdate(downloadItem);
}

async function handleOpenFile(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (downloadItem && downloadItem.status === 'completed' && downloadItem.savePath) {
    await shell.openPath(downloadItem.savePath);
  }
}

async function handleOpenFolder(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (downloadItem && downloadItem.savePath) {
    shell.showItemInFolder(downloadItem.savePath);
  }
}

async function handleRemoveDownload(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (!downloadItem) return;

  const updatedDownloads = downloads.filter(d => d.id !== id);
  saveDownloads(updatedDownloads);
  broadcastUpdate({ ...downloadItem, status: 'removed' });
}

async function handleDeleteDownload(id) {
  const downloads = getDownloads();
  const downloadItem = downloads.find(d => d.id === id);

  if (!downloadItem) return;

  if (downloadItem.savePath && fs.existsSync(downloadItem.savePath)) {
    try { fs.unlinkSync(downloadItem.savePath); } catch (e) {}
  }

  const updatedDownloads = downloads.filter(d => d.id !== id);
  saveDownloads(updatedDownloads);
  broadcastUpdate({ ...downloadItem, status: 'removed' });
}

function resumePersistedDownloads() {
  const downloads = getDownloads();
  downloads.forEach(download => {
    if (download.status === 'downloading') {
      download.status = 'paused';
      saveDownload(download);
      broadcastUpdate(download);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  resumePersistedDownloads();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

ipcMain.handle('download:start', async (event, url) => {
  return handleStartDownload(url);
});

ipcMain.handle('download:pause', async (event, id) => {
  return handlePauseDownload(id);
});

ipcMain.handle('download:resume', async (event, id) => {
  return handleResumeDownload(id);
});

ipcMain.handle('download:cancel', async (event, id) => {
  return handleCancelDownload(id);
});

ipcMain.handle('download:open', async (event, id) => {
  return handleOpenFile(id);
});

ipcMain.handle('download:open-folder', async (event, id) => {
  return handleOpenFolder(id);
});

ipcMain.handle('download:remove', async (event, id) => {
  return handleRemoveDownload(id);
});

ipcMain.handle('download:delete', async (event, id) => {
  return handleDeleteDownload(id);
});

ipcMain.handle('downloads:get', async () => {
  return getDownloads();
});
