# Just Download - Design Document

**Date**: 2026-02-15  
**Project**: Electron Download Manager

## 1. Overview

Just Download is a simple, dark-themed download manager built with Electron that supports multipart downloading, pause/resume functionality, and system tray integration.

## 2. UI/UX Specification

### 2.1 Window Structure
- **Main Window**: Single window application (800x600 default, resizable, min 500x400)
- **Dialogs**: Native OS dialogs for file selection (if needed)

### 2.2 Layout
```
+------------------------------------------+
|  [+ Add URL]                    [_][□][X]|
+------------------------------------------+
|  +--------------------------------------+|
|  | filename.zip        50%   [⏸][✕]     ||
|  | ████████████░░░░░░░░  12.5 MB/25 MB  ||
|  +--------------------------------------+|
|  |                                      ||
|  |  ... more downloads ...             ||
|  |                                      ||
+------------------------------------------+
```

### 2.3 Visual Design

**Color Palette (Dark Theme)**
- Background: `#1a1a2e` (deep navy)
- Surface: `#16213e` (dark blue)
- Primary accent: `#0f3460` (medium blue)
- Highlight: `#e94560` (coral red)
- Text primary: `#eaeaea`
- Text secondary: `#a0a0a0`
- Success: `#4ecca3` (teal green)
- Error: `#ff6b6b` (soft red)
- Progress bar: `#e94560` → `#4ecca3` gradient

**Typography**
- Font family: System UI (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- Title: 18px, bold
- Body: 14px, regular
- Caption: 12px, regular

**Spacing**
- Base unit: 8px
- Padding: 16px (container), 8px (items)
- Border radius: 8px (cards), 4px (buttons)

### 2.4 Components

**Add Button**
- Circular button with "+" icon
- Position: Top-left of main content area
- Hover: Slight scale up (1.1x), brighter color

**Download Item Card**
- Shows: filename, progress bar, speed, size, status
- Actions: Pause/Resume button, Cancel button
- States: downloading, paused, completed, error
- Double-click (completed): Open file
- Right-click (completed): Context menu (Open, Open folder, Remove from list, Delete file)

**Progress Bar**
- Height: 6px
- Background: `#0f3460`
- Fill: Gradient from `#e94560` to `#4ecca3`
- Border radius: 3px

**System Tray**
- Icon: Simple download arrow icon
- Menu: Show window, Quit
- Double-click tray icon: Show window

## 3. Functional Specification

### 3.1 Core Features

**Add Download**
1. User clicks "+" button
2. Dialog/input appears for URL entry
3. Validate URL format
4. Extract filename from URL or Content-Disposition header
5. Check for duplicates, auto-rename if needed
6. Start multipart download (4 parts)

**Multipart Download**
- Split file into 4 equal parts (or closest approximation)
- Download each part concurrently using HTTP Range requests
- Combine parts when all complete
- Track progress per part, aggregate for total progress

**Pause/Resume**
- Pause: Abort active connections, save current byte positions
- Resume: Continue from saved byte positions using Range requests
- Persist state to electron-store

**Persistence**
- Save on: download start, pause, resume, complete, error
- Save data: URL, filename, savePath, totalBytes, downloadedBytes, parts[], status
- On app start: Load persisted downloads, restore state

**File Operations**
- Default save location: User's Downloads folder (`os.homedir()/Downloads`)
- Duplicate handling: Auto-rename `file.ext` → `file (1).ext` → `file (2).ext`
- Open file: `shell.openPath()`
- Open folder: `shell.showItemInFolder()`

### 3.2 Data Model

```javascript
// Download item
{
  id: string,              // UUID
  url: string,             // Download URL
  filename: string,        // Sanitized filename
  savePath: string,        // Full save path
  totalBytes: number,      // Total file size (0 if unknown)
  downloadedBytes: number, // Downloaded so far
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error',
  error: string | null,    // Error message if status is 'error'
  parts: [                 // Array of part info
    { start: number, end: number, downloaded: number, path: string }
  ],
  createdAt: number,       // Timestamp
  completedAt: number | null
}
```

### 3.3 IPC Communication

**Main Process**
- `download:start` - Start a new download
- `download:pause` - Pause a download
- `download:resume` - Resume a download
- `download:cancel` - Cancel and delete partial files
- `download:open` - Open downloaded file
- `download:open-folder` - Show file in folder
- `download:remove` - Remove from list
- `download:delete` - Remove and delete file
- `app:minimize-to-tray` - Minimize to system tray

### 3.4 Edge Cases

- **No Content-Length**: Show indeterminate progress, no pause/resume for that file
- **Server doesn't support Range**: Fall back to single-part download
- **Network error**: Mark as error, show error message
- **Disk full**: Show error, pause download
- **Invalid URL**: Show validation error before starting

## 4. Acceptance Criteria

### 4.1 Functional
- [ ] Can add download via URL
- [ ] Downloads start automatically after adding
- [ ] Progress shows correctly (percentage, downloaded/total)
- [ ] Pause stops the download
- [ ] Resume continues from where it left off
- [ ] Completed downloads show in list
- [ ] Double-click opens file
- [ ] Right-click shows context menu
- [ ] "Remove from list" removes only from UI/persistence
- [ ] "Delete file" removes from disk too
- [ ] App minimizes to tray
- [ ] Downloads persist across app restarts
- [ ] System tray icon shows, double-click restores window
- [ ] Downloads continue when minimized to tray

### 4.2 Visual
- [ ] Dark theme applied correctly
- [ ] Progress bars animate smoothly
- [ ] Hover states on interactive elements
- [ ] Clean, minimal layout

### 4.3 Error Handling
- [ ] Invalid URL shows error
- [ ] Network error shows error status
- [ ] No crashes on edge cases
