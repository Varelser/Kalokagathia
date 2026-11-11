import publicLibrarySeed from '../public-library.json';
import type { ParticleConfig, PresetLibraryData, PresetRecord, PresetSequenceItem } from '../types';
import { STARTER_PRESET_LIBRARY } from './starterLibrary';
import {
  normalizeConfig,
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthMode,
  normalizeSequenceDriveStrengthOverride,
  normalizeSequenceTransitionEasing,
} from './appStateConfig';

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

export function loadPresetRecords(): PresetRecord[] {
  if (typeof window === 'undefined') return [];

  const parsed = readLocalStorageJson(PRESET_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return dedupePresetRecords(STARTER_PRESET_LIBRARY.presets);
  }

  return dedupePresetRecords(
    parsed
      .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string'))
      .map(normalizePersistedPreset),
  );
}

export function hasPersistedPresetRecords(): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = readLocalStorageJson(PRESET_STORAGE_KEY);
  return Array.isArray(parsed) && parsed.length > 0;
}

export function loadInitialPrivateConfig(): ParticleConfig {
  return normalizeConfig(STARTER_PRESET_LIBRARY.currentConfig);
}

export function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSequenceItemId() {
  return `sequence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadPresetSequence(validPresetIds: Set<string>): PresetSequenceItem[] {
  if (typeof window === 'undefined') return [];

  const parsed = readLocalStorageJson(PRESET_SEQUENCE_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return dedupePresetSequence(STARTER_PRESET_LIBRARY.presetSequence.filter((item) => validPresetIds.has(item.presetId)));
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
