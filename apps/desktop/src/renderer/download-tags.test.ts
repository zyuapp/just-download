import { describe, expect, it } from 'vitest';

import {
  findTagName,
  getTagOptions,
  resolveSelectedTagId
} from './download-tags';

const settings = {
  tags: [
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
  lastSelectedTagId: 'media'
};

describe('resolveSelectedTagId', () => {
  it('prefers explicit current selection when valid', () => {
    expect(resolveSelectedTagId(settings, 'docs')).toBe('docs');
  });

  it('falls back to remembered selection when current selection is invalid', () => {
    expect(resolveSelectedTagId(settings, 'missing')).toBe('media');
  });

  it('returns null when no valid selection exists', () => {
    expect(resolveSelectedTagId({ tags: [], lastSelectedTagId: null }, 'missing')).toBeNull();
  });
});

describe('findTagName', () => {
  it('returns the current tag name for known id', () => {
    expect(findTagName(settings, 'media')).toBe('Media');
  });

  it('returns null for unknown tag id', () => {
    expect(findTagName(settings, 'unknown')).toBeNull();
  });
});

describe('getTagOptions', () => {
  it('maps tags into select options in source order', () => {
    expect(getTagOptions(settings)).toEqual([
      { id: 'docs', label: 'Documents' },
      { id: 'media', label: 'Media' }
    ]);
  });
});
