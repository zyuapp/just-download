import { describe, expect, it } from 'vitest';

import {
  findDestinationName,
  getDestinationOptions,
  normalizeDownloadDestinationSettings,
  resolveSelectedDestinationId,
  toLegacyDownloadTagSettings
} from './download-destinations';

const destinationSettings = {
  destinations: [
    {
      id: 'docs',
      name: 'Documents',
      directoryPath: '/Users/me/Documents',
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: 'media',
      name: 'Media',
      directoryPath: '/Users/me/Media',
      createdAt: 2,
      updatedAt: 2
    }
  ],
  lastSelectedDestinationId: 'media'
};

describe('normalizeDownloadDestinationSettings', () => {
  it('supports new destination-shaped settings', () => {
    const settings = normalizeDownloadDestinationSettings(destinationSettings);

    expect(settings.destinations).toHaveLength(2);
    expect(settings.lastSelectedDestinationId).toBe('media');
  });

  it('supports legacy tag-shaped settings', () => {
    const settings = normalizeDownloadDestinationSettings({
      tags: destinationSettings.destinations,
      lastSelectedTagId: 'docs'
    });

    expect(settings.destinations).toHaveLength(2);
    expect(settings.lastSelectedDestinationId).toBe('docs');
  });
});

describe('resolveSelectedDestinationId', () => {
  it('prefers explicit valid selection', () => {
    expect(resolveSelectedDestinationId(destinationSettings, 'docs')).toBe('docs');
  });

  it('falls back to remembered selection', () => {
    expect(resolveSelectedDestinationId(destinationSettings, 'missing')).toBe('media');
  });

  it('returns null when nothing is valid', () => {
    expect(resolveSelectedDestinationId({ destinations: [], lastSelectedDestinationId: null }, 'missing')).toBeNull();
  });
});

describe('findDestinationName', () => {
  it('returns a name for known destination id', () => {
    expect(findDestinationName(destinationSettings, 'media')).toBe('Media');
  });

  it('returns null for unknown destination id', () => {
    expect(findDestinationName(destinationSettings, 'unknown')).toBeNull();
  });
});

describe('getDestinationOptions', () => {
  it('maps destinations into options in source order', () => {
    expect(getDestinationOptions(destinationSettings)).toEqual([
      { id: 'docs', label: 'Documents' },
      { id: 'media', label: 'Media' }
    ]);
  });
});

describe('toLegacyDownloadTagSettings', () => {
  it('maps destination settings to legacy tag shape', () => {
    expect(toLegacyDownloadTagSettings(destinationSettings)).toEqual({
      tags: destinationSettings.destinations,
      lastSelectedTagId: 'media'
    });
  });
});
