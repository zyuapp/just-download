import { randomUUID } from 'crypto';

import type { DownloadTag, DownloadTagInput, DownloadTagSettings } from '../../shared/types';

const MAX_TAG_COUNT = 100;
const MAX_TAG_NAME_LENGTH = 80;
const MAX_DIRECTORY_PATH_LENGTH = 1024;

interface UpsertDownloadTagOptions {
  createId?: () => string;
  now?: () => number;
}

interface DownloadTargetResolution {
  directoryPath: string;
  tagId: string | null;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function normalizeTagId(value: unknown): string {
  return normalizeText(value, 120);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(Number(value));
  return normalized >= 0 ? normalized : fallback;
}

function normalizeTag(rawTag: unknown, fallbackTimestamp: number): DownloadTag | null {
  if (!rawTag || typeof rawTag !== 'object') {
    return null;
  }

  const item = rawTag as {
    id?: unknown;
    name?: unknown;
    directoryPath?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };

  const id = normalizeTagId(item.id);
  const name = normalizeText(item.name, MAX_TAG_NAME_LENGTH);
  const directoryPath = normalizeText(item.directoryPath, MAX_DIRECTORY_PATH_LENGTH);

  if (!id || !name || !directoryPath) {
    return null;
  }

  const createdAt = normalizeTimestamp(item.createdAt, fallbackTimestamp);
  const updatedAt = normalizeTimestamp(item.updatedAt, createdAt);

  return {
    id,
    name,
    directoryPath,
    createdAt,
    updatedAt: Math.max(updatedAt, createdAt)
  };
}

export function normalizeDownloadTagSettings(rawSettings: unknown): DownloadTagSettings {
  const timestamp = Date.now();
  const settings = rawSettings && typeof rawSettings === 'object'
    ? rawSettings as { tags?: unknown; lastSelectedTagId?: unknown }
    : {};

  const sourceTags = Array.isArray(settings.tags) ? settings.tags : [];
  const tags: DownloadTag[] = [];
  const seenIds = new Set<string>();

  for (const rawTag of sourceTags) {
    if (tags.length >= MAX_TAG_COUNT) {
      break;
    }

    const normalizedTag = normalizeTag(rawTag, timestamp);
    if (!normalizedTag || seenIds.has(normalizedTag.id)) {
      continue;
    }

    seenIds.add(normalizedTag.id);
    tags.push(normalizedTag);
  }

  const requestedLastSelectedTagId = normalizeTagId(settings.lastSelectedTagId);
  const hasLastSelectedTag = requestedLastSelectedTagId
    ? tags.some((tag) => tag.id === requestedLastSelectedTagId)
    : false;

  return {
    tags,
    lastSelectedTagId: hasLastSelectedTag ? requestedLastSelectedTagId : null
  };
}

export function upsertDownloadTag(
  currentSettings: DownloadTagSettings,
  input: DownloadTagInput,
  options: UpsertDownloadTagOptions = {}
): DownloadTagSettings {
  const now = options.now || Date.now;
  const createId = options.createId || randomUUID;
  const timestamp = now();

  const settings = normalizeDownloadTagSettings(currentSettings);
  const name = normalizeText(input.name, MAX_TAG_NAME_LENGTH);
  const directoryPath = normalizeText(input.directoryPath, MAX_DIRECTORY_PATH_LENGTH);

  if (!name) {
    throw new Error('Tag name is required.');
  }

  if (!directoryPath) {
    throw new Error('Directory path is required.');
  }

  const requestedId = normalizeTagId(input.id);
  const existingIndex = requestedId
    ? settings.tags.findIndex((tag) => tag.id === requestedId)
    : -1;

  if (existingIndex >= 0) {
    const previous = settings.tags[existingIndex];
    const updatedTag: DownloadTag = {
      ...previous,
      name,
      directoryPath,
      updatedAt: timestamp
    };

    const tags = settings.tags.map((tag, index) => (index === existingIndex ? updatedTag : tag));
    return {
      tags,
      lastSelectedTagId: settings.lastSelectedTagId
    };
  }

  if (settings.tags.length >= MAX_TAG_COUNT) {
    throw new Error(`You can only save up to ${MAX_TAG_COUNT} download tags.`);
  }

  const existingIds = new Set(settings.tags.map((tag) => tag.id));
  let id = requestedId || normalizeTagId(createId());

  while (!id || existingIds.has(id)) {
    id = normalizeTagId(createId());
  }

  const createdTag: DownloadTag = {
    id,
    name,
    directoryPath,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    tags: [...settings.tags, createdTag],
    lastSelectedTagId: settings.lastSelectedTagId
  };
}

export function deleteDownloadTag(currentSettings: DownloadTagSettings, tagId: string): DownloadTagSettings {
  const settings = normalizeDownloadTagSettings(currentSettings);
  const normalizedTagId = normalizeTagId(tagId);

  if (!normalizedTagId) {
    return settings;
  }

  const tags = settings.tags.filter((tag) => tag.id !== normalizedTagId);
  return {
    tags,
    lastSelectedTagId: settings.lastSelectedTagId === normalizedTagId ? null : settings.lastSelectedTagId
  };
}

export function setLastSelectedTag(currentSettings: DownloadTagSettings, tagId: string | null): DownloadTagSettings {
  const settings = normalizeDownloadTagSettings(currentSettings);
  const normalizedTagId = normalizeTagId(tagId);

  if (!normalizedTagId) {
    return {
      tags: settings.tags,
      lastSelectedTagId: null
    };
  }

  const hasTag = settings.tags.some((tag) => tag.id === normalizedTagId);
  return {
    tags: settings.tags,
    lastSelectedTagId: hasTag ? normalizedTagId : null
  };
}

export function resolveDownloadTarget(
  currentSettings: DownloadTagSettings,
  selectedTagId: string | null,
  fallbackDirectoryPath: string
): DownloadTargetResolution {
  const settings = normalizeDownloadTagSettings(currentSettings);
  const normalizedFallbackDirectoryPath = normalizeText(fallbackDirectoryPath, MAX_DIRECTORY_PATH_LENGTH);
  const normalizedSelectedTagId = normalizeTagId(selectedTagId);

  const selectedTag = normalizedSelectedTagId
    ? settings.tags.find((tag) => tag.id === normalizedSelectedTagId)
    : null;
  if (selectedTag) {
    return {
      directoryPath: selectedTag.directoryPath,
      tagId: selectedTag.id
    };
  }

  const rememberedTag = settings.lastSelectedTagId
    ? settings.tags.find((tag) => tag.id === settings.lastSelectedTagId)
    : null;
  if (rememberedTag) {
    return {
      directoryPath: rememberedTag.directoryPath,
      tagId: rememberedTag.id
    };
  }

  return {
    directoryPath: normalizedFallbackDirectoryPath,
    tagId: null
  };
}
