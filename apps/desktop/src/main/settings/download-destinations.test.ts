import { describe, expect, it } from 'vitest';

import {
  deleteDownloadDestination,
  normalizeDownloadDestinationSettings,
  resolveDownloadDestinationTarget,
  setLastSelectedDestination,
  toLegacyDownloadTagSettings,
  upsertDownloadDestination
} from './download-destinations';

describe('normalizeDownloadDestinationSettings', () => {
  it('normalizes destination settings from destination-shaped input', () => {
    const settings = normalizeDownloadDestinationSettings({
      destinations: [
        {
          id: 'work',
          name: 'Work',
          directoryPath: '/Users/me/Work',
          createdAt: 10,
          updatedAt: 11
        }
      ],
      lastSelectedDestinationId: 'work'
    });

    expect(settings.destinations).toHaveLength(1);
    expect(settings.lastSelectedDestinationId).toBe('work');
  });

  it('normalizes destination settings from legacy tag-shaped input', () => {
    const settings = normalizeDownloadDestinationSettings({
      tags: [
        {
          id: 'media',
          name: 'Media',
          directoryPath: '/Users/me/Media',
          createdAt: 1,
          updatedAt: 1
        }
      ],
      lastSelectedTagId: 'media'
    });

    expect(settings.destinations).toHaveLength(1);
    expect(settings.destinations[0]?.id).toBe('media');
    expect(settings.lastSelectedDestinationId).toBe('media');
  });
});

describe('upsertDownloadDestination', () => {
  it('adds a destination when id does not exist', () => {
    const next = upsertDownloadDestination(
      { destinations: [], lastSelectedDestinationId: null },
      { id: null, name: 'Movies', directoryPath: '/Users/me/Movies' },
      {
        createId: () => 'dest-1',
        now: () => 100
      }
    );

    expect(next.destinations).toHaveLength(1);
    expect(next.destinations[0]).toEqual({
      id: 'dest-1',
      name: 'Movies',
      directoryPath: '/Users/me/Movies',
      createdAt: 100,
      updatedAt: 100
    });
  });

  it('updates existing destination and keeps createdAt', () => {
    const next = upsertDownloadDestination(
      {
        destinations: [
          {
            id: 'dest-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedDestinationId: 'dest-1'
      },
      { id: 'dest-1', name: 'Films', directoryPath: '/Users/me/Films' },
      {
        now: () => 150,
        createId: () => 'unused'
      }
    );

    expect(next.destinations[0]).toEqual({
      id: 'dest-1',
      name: 'Films',
      directoryPath: '/Users/me/Films',
      createdAt: 100,
      updatedAt: 150
    });
    expect(next.lastSelectedDestinationId).toBe('dest-1');
  });
});

describe('deleteDownloadDestination', () => {
  it('removes destination and clears remembered selection', () => {
    const next = deleteDownloadDestination(
      {
        destinations: [
          {
            id: 'dest-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedDestinationId: 'dest-1'
      },
      'dest-1'
    );

    expect(next.destinations).toEqual([]);
    expect(next.lastSelectedDestinationId).toBeNull();
  });
});

describe('setLastSelectedDestination', () => {
  it('stores only valid selected destination ids', () => {
    const withSelection = setLastSelectedDestination(
      {
        destinations: [
          {
            id: 'dest-1',
            name: 'Movies',
            directoryPath: '/Users/me/Movies',
            createdAt: 100,
            updatedAt: 100
          }
        ],
        lastSelectedDestinationId: null
      },
      'dest-1'
    );

    const cleared = setLastSelectedDestination(withSelection, 'missing');

    expect(withSelection.lastSelectedDestinationId).toBe('dest-1');
    expect(cleared.lastSelectedDestinationId).toBeNull();
  });
});

describe('resolveDownloadDestinationTarget', () => {
  it('prefers explicit destination then remembered then fallback', () => {
    const settings = {
      destinations: [
        {
          id: 'dest-1',
          name: 'Movies',
          directoryPath: '/Users/me/Movies',
          createdAt: 100,
          updatedAt: 100
        }
      ],
      lastSelectedDestinationId: 'dest-1'
    };

    expect(resolveDownloadDestinationTarget(settings, 'dest-1', '/Users/me/Downloads')).toEqual({
      directoryPath: '/Users/me/Movies',
      destinationId: 'dest-1'
    });

    expect(resolveDownloadDestinationTarget(settings, 'missing', '/Users/me/Downloads')).toEqual({
      directoryPath: '/Users/me/Movies',
      destinationId: 'dest-1'
    });

    expect(resolveDownloadDestinationTarget(
      { destinations: [], lastSelectedDestinationId: null },
      null,
      '/Users/me/Downloads'
    )).toEqual({
      directoryPath: '/Users/me/Downloads',
      destinationId: null
    });
  });
});

describe('toLegacyDownloadTagSettings', () => {
  it('maps destination settings into legacy tag settings', () => {
    const legacy = toLegacyDownloadTagSettings({
      destinations: [
        {
          id: 'dest-1',
          name: 'Movies',
          directoryPath: '/Users/me/Movies',
          createdAt: 100,
          updatedAt: 100
        }
      ],
      lastSelectedDestinationId: 'dest-1'
    });

    expect(legacy).toEqual({
      tags: [
        {
          id: 'dest-1',
          name: 'Movies',
          directoryPath: '/Users/me/Movies',
          createdAt: 100,
          updatedAt: 100
        }
      ],
      lastSelectedTagId: 'dest-1'
    });
  });
});
