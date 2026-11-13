import publicLibrarySeed from '../public-library.json';
import type { ParticleConfig, PresetLibraryData, PresetRecord, PresetSequenceItem } from '../types';
import {
  normalizeConfig,
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthMode,
  normalizeSequenceDriveStrengthOverride,
  normalizeSequenceTransitionEasing,
} from './appStateConfig';
import { getHydratedPayload } from './storageDb';

declare const __LIBRARY_SCOPE__: string | undefined;

export const PRESET_STORAGE_KEY = 'monosphere-presets-v1';
export const PRESET_SEQUENCE_STORAGE_KEY = 'monosphere-preset-sequence-v1';
export const PRESET_LIBRARY_VERSION = 1;
export const QUERY_LIBRARY_SCOPE = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('libraryScope')
  : undefined;
export const LIBRARY_SCOPE = (QUERY_LIBRARY_SCOPE ?? __LIBRARY_SCOPE__) === 'public' ? 'public' : 'private';

const MAX_LOCAL_STORAGE_PAYLOAD_CHARS = 4_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLocalStorageJson(key: string): unknown {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_LOCAL_STORAGE_PAYLOAD_CHARS) {
      console.warn(`Ignoring oversized localStorage payload for ${key}.`);
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to read ${key}:`, error);
    return null;
  }
}

function dedupePresetRecords(records: PresetRecord[]): PresetRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function dedupePresetSequence(items: PresetSequenceItem[]): PresetSequenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizePersistedPreset(item: Partial<PresetRecord> & { id: string; name: string }): PresetRecord {
  return {
    id: item.id,
    name: item.name,
    config: normalizeConfig(item.config),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
  };
}

function normalizePersistedSequenceItem(item: Partial<PresetSequenceItem> & { id: string; presetId: string }): PresetSequenceItem {
  return {
    id: item.id,
    presetId: item.presetId,
    label: typeof item.label === 'string' && item.label.trim().length > 0 ? item.label : 'Keyframe',
    holdSeconds: typeof item.holdSeconds === 'number' ? Math.max(0.2, item.holdSeconds) : 2,
    transitionSeconds: typeof item.transitionSeconds === 'number' ? Math.max(0.05, item.transitionSeconds) : 1.5,
    transitionEasing: normalizeSequenceTransitionEasing(item.transitionEasing),
    screenSequenceDriveMode: normalizeSequenceDriveMode(item.screenSequenceDriveMode),
    screenSequenceDriveStrengthMode: normalizeSequenceDriveStrengthMode(item.screenSequenceDriveStrengthMode),
    screenSequenceDriveStrengthOverride: normalizeSequenceDriveStrengthOverride(item.screenSequenceDriveStrengthOverride),
    screenSequenceDriveMultiplier: normalizeSequenceDriveMultiplier(item.screenSequenceDriveMultiplier),
    keyframeConfig: item.keyframeConfig ? normalizeConfig(item.keyframeConfig) : null,
  };
}

/**
 * Parses a raw persisted preset payload (the exact JSON string stored for
 * PRESET_STORAGE_KEY, from either storage backend) into records. Returns
 * null when the payload is absent, unparseable, not an array, or an empty
 * array — the cases every reader treats as "no persisted library". A
 * non-empty array whose items are all invalid yields an empty list, not
 * null, matching the historical localStorage read semantics.
 */
export function parsePersistedPresetRecords(raw: string | null): PresetRecord[] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return dedupePresetRecords(
    parsed
      .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string'))
      .map(normalizePersistedPreset),
  );
}

/**
 * Parses a raw persisted sequence payload into items filtered by the
 * valid preset ids. Returns null under the same "absent" conditions as
 * parsePersistedPresetRecords; a non-empty payload whose items are all
 * filtered out yields an empty list.
 */
export function parsePersistedPresetSequence(raw: string | null, validPresetIds: Set<string>): PresetSequenceItem[] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return dedupePresetSequence(
    parsed
      .filter((item): item is Partial<PresetSequenceItem> & { id: string; presetId: string } => (
        Boolean(item && typeof item.id === 'string' && typeof item.presetId === 'string')
      ))
      .filter((item) => validPresetIds.has(item.presetId))
      .map(normalizePersistedSequenceItem),
  );
}

export function loadPresetRecords(starterLibrary?: PresetLibraryData | null): PresetRecord[] {
  if (typeof window === 'undefined') return [];

  // IndexedDB is the primary store once hydration has settled (Phase 1
  // renewal): its payload has no length cap, unlike the localStorage read
  // below. Before hydration (or when IndexedDB is unavailable) the
  // localStorage path runs exactly as before.
  const idbRaw = getHydratedPayload(PRESET_STORAGE_KEY);
  if (typeof idbRaw === 'string') {
    const fromIdb = parsePersistedPresetRecords(idbRaw);
    if (fromIdb) return fromIdb;
  }

  const parsed = readLocalStorageJson(PRESET_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    // Starter fallback needs the lazily loaded starter library; without it
    // the caller renders an empty placeholder and fills in on arrival.
    return starterLibrary ? dedupePresetRecords(starterLibrary.presets) : [];
  }

  return dedupePresetRecords(
    parsed
      .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string'))
      .map(normalizePersistedPreset),
  );
}

export function hasPersistedPresetRecords(): boolean {
  if (typeof window === 'undefined') return false;
  const idbRaw = getHydratedPayload(PRESET_STORAGE_KEY);
  if (typeof idbRaw === 'string') {
    return parsePersistedPresetRecords(idbRaw) !== null;
  }
  const parsed = readLocalStorageJson(PRESET_STORAGE_KEY);
  return Array.isArray(parsed) && parsed.length > 0;
}

export function loadInitialPrivateConfig(starterLibrary?: PresetLibraryData | null): ParticleConfig {
  // Without the starter library this is the default config placeholder; the
  // starter currentConfig replaces it on arrival (see App.tsx).
  return starterLibrary ? normalizeConfig(starterLibrary.currentConfig) : normalizeConfig({});
}

export function hasPersistedPresetSequence(): boolean {
  if (typeof window === 'undefined') return false;
  const idbRaw = getHydratedPayload(PRESET_SEQUENCE_STORAGE_KEY);
  if (typeof idbRaw === 'string') {
    try {
      const parsedIdb: unknown = JSON.parse(idbRaw);
      if (Array.isArray(parsedIdb) && parsedIdb.length > 0) return true;
    } catch {
      // Fall through to the localStorage check.
    }
  }
  const parsed = readLocalStorageJson(PRESET_SEQUENCE_STORAGE_KEY);
  return Array.isArray(parsed) && parsed.length > 0;
}

export function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSequenceItemId() {
  return `sequence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPresetSequence(validPresetIds: Set<string>, starterLibrary?: PresetLibraryData | null): PresetSequenceItem[] {
  if (typeof window === 'undefined') return [];

  // Same IndexedDB-first discipline as loadPresetRecords: once hydration
  // has settled, the IndexedDB payload (no length cap) is authoritative;
  // a payload that parses as a non-empty array is used even when every
  // item is filtered out, mirroring the localStorage branch below.
  const idbRaw = getHydratedPayload(PRESET_SEQUENCE_STORAGE_KEY);
  if (typeof idbRaw === 'string') {
    const fromIdb = parsePersistedPresetSequence(idbRaw, validPresetIds);
    if (fromIdb) return fromIdb;
  }

  const parsed = readLocalStorageJson(PRESET_SEQUENCE_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    // Starter fallback needs the lazily loaded starter library; without it
    // the caller renders an empty placeholder and fills in on arrival.
    return starterLibrary
      ? dedupePresetSequence(starterLibrary.presetSequence.filter((item) => validPresetIds.has(item.presetId)))
      : [];
  }

  return dedupePresetSequence(
    parsed
      .filter((item): item is Partial<PresetSequenceItem> & { id: string; presetId: string } => (
        Boolean(item && typeof item.id === 'string' && typeof item.presetId === 'string')
      ))
      .filter((item) => validPresetIds.has(item.presetId))
      .map(normalizePersistedSequenceItem),
  );
}

export function parsePresetLibraryData(payload: unknown): PresetLibraryData | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.presets) || !Array.isArray(payload.presetSequence)) {
    return null;
  }

  const presets = dedupePresetRecords(
    payload.presets
      .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string'))
      .map(normalizePersistedPreset),
  );

  const presetIds = new Set(presets.map((preset) => preset.id));
  const presetSequence = dedupePresetSequence(
    payload.presetSequence
      .filter((item): item is Partial<PresetSequenceItem> & { id: string; presetId: string } => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.presetId === 'string'))
      .filter((item) => presetIds.has(item.presetId))
      .map(normalizePersistedSequenceItem),
  );

  return {
    version: typeof payload.version === 'number' ? payload.version : PRESET_LIBRARY_VERSION,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date().toISOString(),
    currentConfig: normalizeConfig(payload.currentConfig as Partial<ParticleConfig> | undefined),
    activePresetId: typeof payload.activePresetId === 'string' ? payload.activePresetId : null,
    presetBlendDuration: typeof payload.presetBlendDuration === 'number' ? Math.max(0.2, payload.presetBlendDuration) : 1.5,
    sequenceLoopEnabled: typeof payload.sequenceLoopEnabled === 'boolean' ? payload.sequenceLoopEnabled : true,
    presets,
    presetSequence,
  };
}

function getFallbackPresetLibraryData(): PresetLibraryData {
  return {
    version: PRESET_LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    currentConfig: normalizeConfig({}),
    activePresetId: null,
    presetBlendDuration: 1.5,
    sequenceLoopEnabled: true,
    presets: [],
    presetSequence: [],
  };
}

function getPublicPresetLibraryData(): PresetLibraryData {
  return parsePresetLibraryData(publicLibrarySeed) ?? getFallbackPresetLibraryData();
}

export const PUBLIC_PRESET_LIBRARY = getPublicPresetLibraryData();
