export interface ReconcileListContainer<TItem> {
  getChildAt: (index: number) => TItem | null;
  insertBefore: (item: TItem, referenceItem: TItem | null) => void;
}

export interface ReconcileDownloadItemsOptions<TDownload extends { id: string }, TItem extends { remove: () => void }> {
  sortedDownloads: readonly TDownload[];
  itemsById: Map<string, TItem>;
  list: ReconcileListContainer<TItem>;
  createItem: (download: TDownload) => TItem;
  updateItem: (item: TItem, download: TDownload) => void;
}

export function reconcileDownloadItems<TDownload extends { id: string }, TItem extends { remove: () => void }>(
  options: ReconcileDownloadItemsOptions<TDownload, TItem>
): void {
  const { sortedDownloads, itemsById, list, createItem, updateItem } = options;
  const sortedIds = new Set(sortedDownloads.map((download) => download.id));

  for (const [downloadId, item] of itemsById) {
    if (sortedIds.has(downloadId)) {
      continue;
    }

    item.remove();
    itemsById.delete(downloadId);
  }

  for (let index = 0; index < sortedDownloads.length; index += 1) {
    const download = sortedDownloads[index];
    const existingItem = itemsById.get(download.id);
    const item = existingItem || createItem(download);

    if (!existingItem) {
      itemsById.set(download.id, item);
    } else {
      updateItem(item, download);
    }

    const referenceItem = list.getChildAt(index);
    if (referenceItem === item) {
      continue;
    }

    list.insertBefore(item, referenceItem);
  }
}
