import { randomUUID } from 'crypto';

import type {
  DownloadDestination,
  DownloadDestinationInput,
  DownloadDestinationSettings,
  DownloadTag,
  DownloadTagInput,
  DownloadTagSettings
} from '../../shared/types';

const MAX_DESTINATION_COUNT = 100;
const MAX_DESTINATION_NAME_LENGTH = 80;
const MAX_DIRECTORY_PATH_LENGTH = 1024;

interface UpsertDownloadDestinationOptions {
  createId?: () => string;
  now?: () => number;
}

interface DownloadDestinationTargetResolution {
  directoryPath: string;
  destinationId: string | null;
}

interface DownloadTagTargetResolution {
  directoryPath: string;
  tagId: string | null;
}

interface DestinationSettingsRecord {
  destinations: unknown[];
  lastSelectedDestinationId: unknown;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function normalizeDestinationId(value: unknown): string {
  return normalizeText(value, 120);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(Number(value));
  return normalized >= 0 ? normalized : fallback;
}

function normalizeDestination(rawDestination: unknown, fallbackTimestamp: number): DownloadDestination | null {
  if (!rawDestination || typeof rawDestination !== 'object') {
    return null;
  }

  const item = rawDestination as {
    id?: unknown;
    name?: unknown;
    directoryPath?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };

  const id = normalizeDestinationId(item.id);
  const name = normalizeText(item.name, MAX_DESTINATION_NAME_LENGTH);
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

function toDestinationSettingsRecord(rawSettings: unknown): DestinationSettingsRecord {
  const settings = rawSettings && typeof rawSettings === 'object'
    ? rawSettings as {
      destinations?: unknown;
      lastSelectedDestinationId?: unknown;
      tags?: unknown;
      lastSelectedTagId?: unknown;
    }
    : {};

  const destinations = Array.isArray(settings.destinations)
    ? settings.destinations
    : (Array.isArray(settings.tags) ? settings.tags : []);

  const lastSelectedDestinationId = settings.lastSelectedDestinationId ?? settings.lastSelectedTagId;

  return {
    destinations,
    lastSelectedDestinationId
  };
}

export function normalizeDownloadDestinationSettings(rawSettings: unknown): DownloadDestinationSettings {
  const timestamp = Date.now();
  const normalizedRecord = toDestinationSettingsRecord(rawSettings);
  const destinations: DownloadDestination[] = [];
  const seenIds = new Set<string>();

  for (const rawDestination of normalizedRecord.destinations) {
    if (destinations.length >= MAX_DESTINATION_COUNT) {
      break;
    }

    const normalizedDestination = normalizeDestination(rawDestination, timestamp);
    if (!normalizedDestination || seenIds.has(normalizedDestination.id)) {
      continue;
    }

    seenIds.add(normalizedDestination.id);
    destinations.push(normalizedDestination);
  }

  const requestedLastSelectedDestinationId = normalizeDestinationId(normalizedRecord.lastSelectedDestinationId);
  const hasLastSelectedDestination = requestedLastSelectedDestinationId
    ? destinations.some((destination) => destination.id === requestedLastSelectedDestinationId)
    : false;

  return {
    destinations,
    lastSelectedDestinationId: hasLastSelectedDestination ? requestedLastSelectedDestinationId : null
  };
}

export function upsertDownloadDestination(
  currentSettings: DownloadDestinationSettings,
  input: DownloadDestinationInput,
  options: UpsertDownloadDestinationOptions = {}
): DownloadDestinationSettings {
  const now = options.now || Date.now;
  const createId = options.createId || randomUUID;
  const timestamp = now();

  const settings = normalizeDownloadDestinationSettings(currentSettings);
  const name = normalizeText(input.name, MAX_DESTINATION_NAME_LENGTH);
  const directoryPath = normalizeText(input.directoryPath, MAX_DIRECTORY_PATH_LENGTH);

  if (!name) {
    throw new Error('Destination name is required.');
  }

  if (!directoryPath) {
    throw new Error('Directory path is required.');
  }

  const requestedId = normalizeDestinationId(input.id);
  const existingIndex = requestedId
    ? settings.destinations.findIndex((destination) => destination.id === requestedId)
    : -1;

  if (existingIndex >= 0) {
    const previous = settings.destinations[existingIndex];
    const updatedDestination: DownloadDestination = {
      ...previous,
      name,
      directoryPath,
      updatedAt: timestamp
    };

    const destinations = settings.destinations.map((destination, index) => (index === existingIndex ? updatedDestination : destination));
    return {
      destinations,
      lastSelectedDestinationId: settings.lastSelectedDestinationId
    };
  }

  if (settings.destinations.length >= MAX_DESTINATION_COUNT) {
    throw new Error(`You can only save up to ${MAX_DESTINATION_COUNT} destinations.`);
  }

  const existingIds = new Set(settings.destinations.map((destination) => destination.id));
  let id = requestedId || normalizeDestinationId(createId());

  while (!id || existingIds.has(id)) {
    id = normalizeDestinationId(createId());
  }

  const createdDestination: DownloadDestination = {
    id,
    name,
    directoryPath,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    destinations: [...settings.destinations, createdDestination],
    lastSelectedDestinationId: settings.lastSelectedDestinationId
  };
}

export function deleteDownloadDestination(currentSettings: DownloadDestinationSettings, destinationId: string): DownloadDestinationSettings {
  const settings = normalizeDownloadDestinationSettings(currentSettings);
  const normalizedDestinationId = normalizeDestinationId(destinationId);

  if (!normalizedDestinationId) {
    return settings;
  }

  const destinations = settings.destinations.filter((destination) => destination.id !== normalizedDestinationId);
  return {
    destinations,
    lastSelectedDestinationId: settings.lastSelectedDestinationId === normalizedDestinationId
      ? null
      : settings.lastSelectedDestinationId
  };
}

export function setLastSelectedDestination(
  currentSettings: DownloadDestinationSettings,
  destinationId: string | null
): DownloadDestinationSettings {
  const settings = normalizeDownloadDestinationSettings(currentSettings);
  const normalizedDestinationId = normalizeDestinationId(destinationId);

  if (!normalizedDestinationId) {
    return {
      destinations: settings.destinations,
      lastSelectedDestinationId: null
    };
  }

  const hasDestination = settings.destinations.some((destination) => destination.id === normalizedDestinationId);
  return {
    destinations: settings.destinations,
    lastSelectedDestinationId: hasDestination ? normalizedDestinationId : null
  };
}

export function resolveDownloadDestinationTarget(
  currentSettings: DownloadDestinationSettings,
  selectedDestinationId: string | null,
  fallbackDirectoryPath: string
): DownloadDestinationTargetResolution {
  const settings = normalizeDownloadDestinationSettings(currentSettings);
  const normalizedFallbackDirectoryPath = normalizeText(fallbackDirectoryPath, MAX_DIRECTORY_PATH_LENGTH);
  const normalizedSelectedDestinationId = normalizeDestinationId(selectedDestinationId);

  const selectedDestination = normalizedSelectedDestinationId
    ? settings.destinations.find((destination) => destination.id === normalizedSelectedDestinationId)
    : null;

  if (selectedDestination) {
    return {
      directoryPath: selectedDestination.directoryPath,
      destinationId: selectedDestination.id
    };
  }

  const rememberedDestination = settings.lastSelectedDestinationId
    ? settings.destinations.find((destination) => destination.id === settings.lastSelectedDestinationId)
    : null;

  if (rememberedDestination) {
    return {
      directoryPath: rememberedDestination.directoryPath,
      destinationId: rememberedDestination.id
    };
  }

  return {
    directoryPath: normalizedFallbackDirectoryPath,
    destinationId: null
  };
}

export function toLegacyDownloadTagSettings(settings: DownloadDestinationSettings): DownloadTagSettings {
  const normalized = normalizeDownloadDestinationSettings(settings);
  return {
    tags: normalized.destinations.map((destination) => ({ ...destination } as DownloadTag)),
    lastSelectedTagId: normalized.lastSelectedDestinationId
  };
}

export function toDownloadDestinationSettings(settings: DownloadTagSettings | DownloadDestinationSettings): DownloadDestinationSettings {
  return normalizeDownloadDestinationSettings(settings);
}

export function normalizeDownloadTagSettings(rawSettings: unknown): DownloadTagSettings {
  return toLegacyDownloadTagSettings(normalizeDownloadDestinationSettings(rawSettings));
}

export function upsertDownloadTag(
  currentSettings: DownloadTagSettings,
  input: DownloadTagInput,
  options: UpsertDownloadDestinationOptions = {}
): DownloadTagSettings {
  const normalizedSettings = normalizeDownloadDestinationSettings(currentSettings);
  const next = upsertDownloadDestination(normalizedSettings, input, options);
  return toLegacyDownloadTagSettings(next);
}

export function deleteDownloadTag(currentSettings: DownloadTagSettings, tagId: string): DownloadTagSettings {
  const normalizedSettings = normalizeDownloadDestinationSettings(currentSettings);
  const next = deleteDownloadDestination(normalizedSettings, tagId);
  return toLegacyDownloadTagSettings(next);
}

export function setLastSelectedTag(currentSettings: DownloadTagSettings, tagId: string | null): DownloadTagSettings {
  const normalizedSettings = normalizeDownloadDestinationSettings(currentSettings);
  const next = setLastSelectedDestination(normalizedSettings, tagId);
  return toLegacyDownloadTagSettings(next);
}

export function resolveDownloadTarget(
  currentSettings: DownloadTagSettings,
  selectedTagId: string | null,
  fallbackDirectoryPath: string
): DownloadTagTargetResolution {
  const resolved = resolveDownloadDestinationTarget(
    normalizeDownloadDestinationSettings(currentSettings),
    selectedTagId,
    fallbackDirectoryPath
  );

  return {
    directoryPath: resolved.directoryPath,
    tagId: resolved.destinationId
  };
}
