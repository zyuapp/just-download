import { describe, expect, it } from 'vitest';

import { reconcileDownloadItems } from './download-list-reconciler';

interface FakeDownload {
  id: string;
}

class FakeItem {
  id: string;
  parent: FakeList | null;

  constructor(id: string) {
    this.id = id;
    this.parent = null;
  }

  remove(): void {
    if (!this.parent) {
      return;
    }

    this.parent.detach(this);
  }
}

class FakeList {
  private readonly children: FakeItem[] = [];
  insertCallCount = 0;

  getChildAt(index: number): FakeItem | null {
    return this.children[index] || null;
  }

  insertBefore(item: FakeItem, referenceItem: FakeItem | null): void {
    this.insertCallCount += 1;

    if (item.parent) {
      item.parent.detach(item);
    }

    const referenceIndex = referenceItem ? this.children.indexOf(referenceItem) : this.children.length;
    if (referenceItem && referenceIndex < 0) {
      throw new Error('Reference item was not found in list.');
    }

    this.children.splice(referenceIndex, 0, item);
    item.parent = this;
  }

  seed(items: FakeItem[]): void {
    this.children.splice(0, this.children.length, ...items);
    for (const item of items) {
      item.parent = this;
    }
  }

  detach(item: FakeItem): void {
    const index = this.children.indexOf(item);
    if (index < 0) {
      return;
    }

    this.children.splice(index, 1);
    item.parent = null;
  }

  ids(): string[] {
    return this.children.map((item) => item.id);
  }
}

function createOptions(
  sortedDownloads: FakeDownload[],
  itemsById: Map<string, FakeItem>,
  list: FakeList,
  createItem: (download: FakeDownload) => FakeItem,
  updateItem: (item: FakeItem, download: FakeDownload) => void
) {
  return {
    sortedDownloads,
    itemsById,
    list: {
      getChildAt: (index: number) => list.getChildAt(index),
      insertBefore: (item: FakeItem, referenceItem: FakeItem | null) => {
        list.insertBefore(item, referenceItem);
      }
    },
    createItem,
    updateItem
  };
}

describe('reconcileDownloadItems', () => {
  it('keeps stable rows mounted between progress updates', () => {
    const list = new FakeList();
    const itemA = new FakeItem('a');
    const itemB = new FakeItem('b');
    list.seed([itemA, itemB]);

    const itemsById = new Map<string, FakeItem>([
      ['a', itemA],
      ['b', itemB]
    ]);
    const sortedDownloads: FakeDownload[] = [{ id: 'a' }, { id: 'b' }];

    let createCount = 0;
    let updateCount = 0;

    reconcileDownloadItems(createOptions(
      sortedDownloads,
      itemsById,
      list,
      () => {
        createCount += 1;
        throw new Error('Should not create an item when one already exists.');
      },
      () => {
        updateCount += 1;
      }
    ));

    expect(list.insertCallCount).toBe(0);
    expect(createCount).toBe(0);
    expect(updateCount).toBe(2);
    expect(list.ids()).toEqual(['a', 'b']);
  });

  it('only inserts new rows without re-inserting stable siblings', () => {
    const list = new FakeList();
    const itemA = new FakeItem('a');
    const itemB = new FakeItem('b');
    list.seed([itemA, itemB]);

    const itemsById = new Map<string, FakeItem>([
      ['a', itemA],
      ['b', itemB]
    ]);
    const sortedDownloads: FakeDownload[] = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];

    const createdIds: string[] = [];
    reconcileDownloadItems(createOptions(
      sortedDownloads,
      itemsById,
      list,
      (download) => {
        const item = new FakeItem(download.id);
        createdIds.push(download.id);
        return item;
      },
      () => {}
    ));

    expect(createdIds).toEqual(['c']);
    expect(list.insertCallCount).toBe(1);
    expect(list.ids()).toEqual(['c', 'a', 'b']);
  });
});
