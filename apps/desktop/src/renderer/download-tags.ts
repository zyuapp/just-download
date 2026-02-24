import type { DownloadTagSettings } from '../shared/types';

interface DownloadTagOption {
  id: string;
  label: string;
}

function normalizeTagId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveSelectedTagId(settings: DownloadTagSettings, currentTagId: string | null): string | null {
  const requestedId = normalizeTagId(currentTagId);
  if (requestedId && settings.tags.some((tag) => tag.id === requestedId)) {
    return requestedId;
  }

  const rememberedId = normalizeTagId(settings.lastSelectedTagId);
  if (rememberedId && settings.tags.some((tag) => tag.id === rememberedId)) {
    return rememberedId;
  }

  return null;
}

export function findTagName(settings: DownloadTagSettings, tagId: string | null | undefined): string | null {
  const normalizedTagId = normalizeTagId(tagId || null);
  if (!normalizedTagId) {
    return null;
  }

  const found = settings.tags.find((tag) => tag.id === normalizedTagId);
  return found ? found.name : null;
}

export function getTagOptions(settings: DownloadTagSettings): DownloadTagOption[] {
  return settings.tags.map((tag) => ({
    id: tag.id,
    label: tag.name
  }));
}
