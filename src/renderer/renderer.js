const { electronAPI } = window;

let downloads = [];
let contextMenuTarget = null;

const addBtn = document.getElementById('add-btn');
const urlDialog = document.getElementById('url-dialog');
const urlInput = document.getElementById('url-input');
const startDownloadBtn = document.getElementById('start-download');
const cancelDialogBtn = document.getElementById('cancel-dialog');
const downloadList = document.getElementById('download-list');
const emptyState = document.getElementById('empty-state');
const contextMenu = document.getElementById('context-menu');

addBtn.addEventListener('click', () => {
  urlDialog.classList.remove('hidden');
  urlInput.focus();
});

cancelDialogBtn.addEventListener('click', () => {
  urlDialog.classList.add('hidden');
  urlInput.value = '';
});

startDownloadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (url) {
    try {
      await electronAPI.startDownload(url);
      urlDialog.classList.add('hidden');
      urlInput.value = '';
    } catch (error) {
      alert('Failed to start download: ' + error.message);
    }
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    startDownloadBtn.click();
  } else if (e.key === 'Escape') {
    cancelDialogBtn.click();
  }
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.classList.add('hidden');
  }
});

contextMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !contextMenuTarget) return;

  const id = contextMenuTarget;

  switch (action) {
    case 'open':
      await electronAPI.openFile(id);
      break;
    case 'open-folder':
      await electronAPI.openFolder(id);
      break;
    case 'remove':
      await electronAPI.removeDownload(id);
      break;
    case 'delete':
      await electronAPI.deleteDownload(id);
      break;
  }

  contextMenu.classList.add('hidden');
  contextMenuTarget = null;
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function createDownloadItem(download) {
  const item = document.createElement('div');
  item.className = 'download-item';
  item.dataset.id = download.id;

  const progress = download.totalBytes > 0
    ? Math.round((download.downloadedBytes / download.totalBytes) * 100)
    : 0;

  const statusClass = download.status === 'error' ? 'error' : download.status === 'completed' ? 'completed' : '';

  item.innerHTML = `
    <div class="download-info">
      <span class="filename">${escapeHtml(download.filename)}</span>
      <span class="status ${statusClass}">${download.status}</span>
    </div>
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="progress-text">
        ${formatBytes(download.downloadedBytes)} / ${download.totalBytes > 0 ? formatBytes(download.totalBytes) : 'Unknown'}
      </div>
    </div>
    <div class="download-actions">
      ${download.status === 'downloading' ? `
        <button class="action-btn pause-btn" data-action="pause" title="Pause">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
      ` : ''}
      ${download.status === 'paused' ? `
        <button class="action-btn resume-btn" data-action="resume" title="Resume">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>
      ` : ''}
      <button class="action-btn cancel-btn" data-action="cancel" title="Cancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  item.addEventListener('dblclick', async () => {
    if (download.status === 'completed') {
      await electronAPI.openFile(download.id);
    }
  });

  item.addEventListener('contextmenu', (e) => {
    if (download.status === 'completed') {
      e.preventDefault();
      contextMenuTarget = download.id;
      contextMenu.style.left = e.clientX + 'px';
      contextMenu.style.top = e.clientY + 'px';
      contextMenu.classList.remove('hidden');
    }
  });

  item.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'pause') {
        await electronAPI.pauseDownload(download.id);
      } else if (action === 'resume') {
        await electronAPI.resumeDownload(download.id);
      } else if (action === 'cancel') {
        await electronAPI.cancelDownload(download.id);
      }
    });
  });

  return item;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderDownloads() {
  const existingItems = downloadList.querySelectorAll('.download-item');
  existingItems.forEach(item => item.remove());

  if (downloads.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
    downloads.forEach(download => {
      downloadList.appendChild(createDownloadItem(download));
    });
  }
}

async function loadDownloads() {
  downloads = await electronAPI.getDownloads();
  renderDownloads();
}

electronAPI.onDownloadUpdate((updatedDownload) => {
  const index = downloads.findIndex(d => d.id === updatedDownload.id);
  if (index >= 0) {
    downloads[index] = updatedDownload;
  } else {
    downloads.push(updatedDownload);
  }
  renderDownloads();
});

loadDownloads();
