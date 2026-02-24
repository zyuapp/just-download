import { describe, expect, it } from 'vitest';

import {
  deleteDownloadTag,
  normalizeDownloadTagSettings,
  resolveDownloadTarget,
  setLastSelectedTag,
  upsertDownloadTag
} from './download-tags';

describe('normalizeDownloadTagSettings', () => {
  it('keeps only valid tags and clears stale last selected ids', () => {
    const settings = normalizeDownloadTagSettings({
      tags: [
        {
          id: 'docs',
          name: 'Documents',
          directoryPath: '/Users/me/Documents',
          createdAt: 10,
          updatedAt: 11
        },
        {
          id: 'docs',
          name: 'Duplicate',
          directoryPath: '/tmp/duplicate',
          createdAt: 12,
          updatedAt: 13
        },
        {
          id: '',
          name: 'Missing ID',
          directoryPath: '/tmp/missing-id'
        }
      ],
      lastSelectedTagId: 'missing'
    });

    expect(settings.tags).toHaveLength(1);
    expect(settings.tags[0]).toMatchObject({
      id: 'docs',
      name: 'Documents',
      directoryPath: '/Users/me/Documents'
    });
    expect(settings.lastSelectedTagId).toBeNull();
  });
});

describe('upsertDownloadTag', () => {
  it('adds a tag when id does not exist', () => {
    const next = upsertDownloadTag(
      { tags: [], lastSelectedTagId: null },
      { id: null, name: 'Movies', directoryPath: '/Users/me/Movies' },
      {
        createId: () => 'tag-1',
        now: () => 100
      }
    );

    expect(next.tags).toHaveLength(1);
    expect(next.tags[0]).toEqual({
      id: 'tag-1',
      name: 'Movies',
      directoryPath: '/Users/me/Movies',
      createdAt: 100,
      updatedAt: 100
    });
  });

  it('updates an existing tag while preserving created timestamp', () => {
    const next = upsertDownloadTag(
      {
        tags: [
          {
            id: 'tag-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedTagId: 'tag-1'
      },
      { id: 'tag-1', name: 'Films', directoryPath: '/Users/me/Films' },
      {
        createId: () => 'unused',
        now: () => 150
      }
    );

    expect(next.tags).toHaveLength(1);
    expect(next.tags[0]).toEqual({
      id: 'tag-1',
      name: 'Films',
      directoryPath: '/Users/me/Films',
      createdAt: 100,
      updatedAt: 150
    });
    expect(next.lastSelectedTagId).toBe('tag-1');
  });
});

describe('deleteDownloadTag', () => {
  it('removes tag and clears last selected when it was deleted', () => {
    const next = deleteDownloadTag(
      {
        tags: [
          {
            id: 'tag-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedTagId: 'tag-1'
      },
      'tag-1'
    );

    expect(next.tags).toEqual([]);
    expect(next.lastSelectedTagId).toBeNull();
  });
});

describe('setLastSelectedTag', () => {
  it('keeps only valid selected id', () => {
    const withSelection = setLastSelectedTag(
      {
        tags: [
          {
            id: 'tag-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedTagId: null
      },
      'tag-1'
    );

    const clearedSelection = setLastSelectedTag(withSelection, 'missing');

    expect(withSelection.lastSelectedTagId).toBe('tag-1');
    expect(clearedSelection.lastSelectedTagId).toBeNull();
  });
});

describe('resolveDownloadTarget', () => {
  it('prefers selected tag and falls back to default directory', () => {
    const settings = {
      tags: [
        {
          id: 'tag-1',
          name: 'Movies',
          directoryPath: '/Users/me/Movies',
          createdAt: 100,
          updatedAt: 100
        }
      ],
      lastSelectedTagId: 'tag-1'
    };

    expect(resolveDownloadTarget(settings, 'tag-1', '/Users/me/Downloads')).toEqual({
      directoryPath: '/Users/me/Movies',
      tagId: 'tag-1'
    });

    expect(resolveDownloadTarget(settings, 'missing', '/Users/me/Downloads')).toEqual({
      directoryPath: '/Users/me/Movies',
      tagId: 'tag-1'
    });

    expect(resolveDownloadTarget(
      { tags: [], lastSelectedTagId: null },
      null,
      '/Users/me/Downloads'
    )).toEqual({
      directoryPath: '/Users/me/Downloads',
      tagId: null
    });
  });
});
