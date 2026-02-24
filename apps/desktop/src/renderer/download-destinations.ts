import type {
  DownloadDestinationSettings,
  DownloadTagSettings
} from '../shared/types';

interface DownloadDestinationOption {
  id: string;
  label: string;
}

function normalizeDestinationId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeDownloadDestinationSettings(rawSettings: unknown): DownloadDestinationSettings {
  if (!rawSettings || typeof rawSettings !== 'object') {
    return {
      destinations: [],
      lastSelectedDestinationId: null
    };
  }

  const settings = rawSettings as {
    destinations?: unknown;
    lastSelectedDestinationId?: unknown;
    tags?: unknown;
    lastSelectedTagId?: unknown;
  };

  const destinations = Array.isArray(settings.destinations)
    ? settings.destinations
    : (Array.isArray(settings.tags) ? settings.tags : []);

  const lastSelectedDestinationId = typeof settings.lastSelectedDestinationId === 'string'
    ? settings.lastSelectedDestinationId
    : (typeof settings.lastSelectedTagId === 'string' ? settings.lastSelectedTagId : null);

  return {
    destinations,
    lastSelectedDestinationId
  } as DownloadDestinationSettings;
}

export function toLegacyDownloadTagSettings(settings: DownloadDestinationSettings): DownloadTagSettings {
  return {
    tags: settings.destinations,
    lastSelectedTagId: settings.lastSelectedDestinationId
  };
}

export function resolveSelectedDestinationId(
  settings: DownloadDestinationSettings,
  currentDestinationId: string | null
): string | null {
  const requestedId = normalizeDestinationId(currentDestinationId);
  if (requestedId && settings.destinations.some((destination) => destination.id === requestedId)) {
    return requestedId;
  }

  const rememberedId = normalizeDestinationId(settings.lastSelectedDestinationId);
  if (rememberedId && settings.destinations.some((destination) => destination.id === rememberedId)) {
    return rememberedId;
  }

  return null;
}

export function findDestinationName(
  settings: DownloadDestinationSettings,
  destinationId: string | null | undefined
): string | null {
  const normalizedDestinationId = normalizeDestinationId(destinationId || null);
  if (!normalizedDestinationId) {
    return null;
  }

  const found = settings.destinations.find((destination) => destination.id === normalizedDestinationId);
  return found ? found.name : null;
}

export function getDestinationOptions(settings: DownloadDestinationSettings): DownloadDestinationOption[] {
  return settings.destinations.map((destination) => ({
    id: destination.id,
    label: destination.name
  }));
}

export function resolveSelectedTagId(settings: DownloadTagSettings, currentTagId: string | null): string | null {
  return resolveSelectedDestinationId(normalizeDownloadDestinationSettings(settings), currentTagId);
}

export function findTagName(settings: DownloadTagSettings, tagId: string | null | undefined): string | null {
  return findDestinationName(normalizeDownloadDestinationSettings(settings), tagId);
}

export function getTagOptions(settings: DownloadTagSettings): DownloadDestinationOption[] {
  return getDestinationOptions(normalizeDownloadDestinationSettings(settings));
}
