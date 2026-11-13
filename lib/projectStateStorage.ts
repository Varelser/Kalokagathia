import type { ParticleConfig, PresetRecord, PresetSequenceItem, ProjectData, ProjectExportSchema, ProjectUiState } from '../types';
import {
  normalizeConfig,
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthMode,
  normalizeSequenceDriveStrengthOverride,
  normalizeSequenceTransitionEasing,
} from './appStateConfig';
import {
  DEFAULT_PROJECT_UI,
  PROJECT_DATA_VERSION,
  PROJECT_FORMAT_ID,
  PROJECT_MANIFEST_SCHEMA_VERSION,
  PROJECT_SERIALIZATION_SCHEMA_VERSION,
  PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY_LEGACY,
  isPlainObject,
  normalizePresetRecord,
  normalizeSequenceItem,
} from './projectStateShared';
import { buildProjectManifest, normalizeProjectManifest } from './projectStateManifest';
import { buildProjectSerializationSnapshot, normalizeProjectSerializationSnapshot } from './projectSerializationSnapshot';
import { getHydratedPayload, isIndexedDbAvailable, isStorageHydrationSettled, putStoragePayload } from './storageDb';


const PRESET_STORAGE_KEY = 'monosphere-presets-v1';
const PRESET_SEQUENCE_STORAGE_KEY = 'monosphere-preset-sequence-v1';
const MAX_LOCAL_STORAGE_PAYLOAD_CHARS = 4_000_000;

function safelySetLocalStorageItem(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_LOCAL_STORAGE_PAYLOAD_CHARS) {
      console.warn(`Skipping oversized localStorage payload for ${key}.`);
      return false;
    }
    window.localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.warn(`Failed to persist ${key}:`, error);
    return false;
  }
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

/**
 * Reads a payload as parsed JSON, preferring the IndexedDB copy once
 * hydration has settled (Phase 1 renewal): the IndexedDB string has no
 * length cap, while the localStorage read below keeps the legacy
 * 4,000,000-char guard for the fallback path. Returns null when neither
 * backend yields a payload.
 */
function readPayloadJson(key: string): unknown {
  const idbRaw = getHydratedPayload(key);
  if (typeof idbRaw === 'string') {
    try {
      return JSON.parse(idbRaw);
    } catch (error) {
      console.warn(`Failed to parse IndexedDB payload for ${key}:`, error);
    }
  }
  return readLocalStorageJson(key);
}

function parseRawArray(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
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

function buildReducedProjectPayload(project: ProjectData): Record<string, unknown> {
  return {
    version: project.version,
    schema: project.schema,
    exportedAt: project.exportedAt,
    name: project.name,
    currentConfig: project.currentConfig,
    activePresetId: project.activePresetId,
    presetBlendDuration: project.presetBlendDuration,
    sequenceLoopEnabled: project.sequenceLoopEnabled,
    presets: project.presets,
    presetSequence: project.presetSequence,
    ui: project.ui,
  };
}

function buildMinimalProjectPayload(project: ProjectData): Record<string, unknown> {
  const activePreset = project.presets.find((preset) => preset.id === project.activePresetId) ?? project.presets[0] ?? null;
  const minimalPresets = activePreset ? [activePreset] : [];
  const minimalPresetIds = new Set(minimalPresets.map((preset) => preset.id));
  return {
    version: project.version,
    schema: project.schema,
    exportedAt: project.exportedAt,
    name: project.name,
    currentConfig: project.currentConfig,
    activePresetId: activePreset?.id ?? null,
    presetBlendDuration: project.presetBlendDuration,
    sequenceLoopEnabled: project.sequenceLoopEnabled,
    presets: minimalPresets,
    presetSequence: project.presetSequence.filter((item) => minimalPresetIds.has(item.presetId)).slice(0, 1),
    ui: project.ui,
  };
}


function loadPersistedPresetRecords(): PresetRecord[] {
  if (typeof window === 'undefined') return [];

  const idbRaw = getHydratedPayload(PRESET_STORAGE_KEY);
  const idbParsed = typeof idbRaw === 'string' ? parseRawArray(idbRaw) : null;
  const parsed = idbParsed ?? readLocalStorageJson(PRESET_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  return dedupePresetRecords(
    parsed
      .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string'))
      .map(normalizePresetRecord),
  );
}

function loadPersistedPresetSequence(validPresetIds: Set<string>): PresetSequenceItem[] {
  if (typeof window === 'undefined') return [];

  const idbRaw = getHydratedPayload(PRESET_SEQUENCE_STORAGE_KEY);
  const idbParsed = typeof idbRaw === 'string' ? parseRawArray(idbRaw) : null;
  const parsed = idbParsed ?? readLocalStorageJson(PRESET_SEQUENCE_STORAGE_KEY);
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  return dedupePresetSequence(
    parsed
      .filter((item): item is Partial<PresetSequenceItem> & { id: string; presetId: string } => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.presetId === 'string'))
      .filter((item) => validPresetIds.has(item.presetId))
      .map((item) => ({
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
      })),
  );
}

function buildProjectExportSchema(options?: {
  migrationState?: ProjectExportSchema['migrationState'];
  migratedFromProjectDataVersion?: number | null;
  projectDataVersion?: number;
  manifestSchemaVersion?: number;
  serializationSchemaVersion?: number;
}): ProjectExportSchema {
  return {
    format: PROJECT_FORMAT_ID,
    projectDataVersion: options?.projectDataVersion ?? PROJECT_DATA_VERSION,
    manifestSchemaVersion: options?.manifestSchemaVersion ?? PROJECT_MANIFEST_SCHEMA_VERSION,
    serializationSchemaVersion: options?.serializationSchemaVersion ?? PROJECT_SERIALIZATION_SCHEMA_VERSION,
    migrationState: options?.migrationState ?? 'native',
    migratedFromProjectDataVersion: options?.migratedFromProjectDataVersion ?? null,
  };
}

export function parseProjectData(payload: unknown): ProjectData | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.presets) || !Array.isArray(payload.presetSequence)) {
    return null;
  }

  const projectPayload = payload as Record<string, unknown>;

  // parseProjectData is intentionally lossless about duplicate ids and
  // orphan sequence references: import preparation
  // (prepareImportedProjectData) is the stage that repairs them, and the
  // Phase 5 fixtures assert that the raw input survives parse.
  const presets = (projectPayload.presets as unknown[])
    .filter((item): item is Partial<PresetRecord> & { id: string; name: string } => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { name?: unknown }).name === 'string'))
    .map(normalizePresetRecord);

  const presetSequence = (projectPayload.presetSequence as unknown[])
    .filter((item): item is Partial<PresetSequenceItem> & { id: string; presetId: string } => Boolean(item && typeof item === 'object' && typeof (item as { presetId?: unknown }).presetId === 'string'))
    .map(normalizeSequenceItem);

  const uiPayload = isPlainObject(projectPayload.ui) ? projectPayload.ui : {};
  const ui: ProjectUiState = {
    isPlaying: typeof uiPayload.isPlaying === 'boolean' ? uiPayload.isPlaying : DEFAULT_PROJECT_UI.isPlaying,
    isPanelOpen: typeof uiPayload.isPanelOpen === 'boolean' ? uiPayload.isPanelOpen : DEFAULT_PROJECT_UI.isPanelOpen,
    videoExportMode: uiPayload.videoExportMode === 'current' ? 'current' : DEFAULT_PROJECT_UI.videoExportMode,
    videoDurationSeconds: typeof uiPayload.videoDurationSeconds === 'number' ? Math.max(1, uiPayload.videoDurationSeconds) : DEFAULT_PROJECT_UI.videoDurationSeconds,
    videoFps: typeof uiPayload.videoFps === 'number' ? Math.max(12, Math.min(60, uiPayload.videoFps)) : DEFAULT_PROJECT_UI.videoFps,
  };

  const currentConfig = normalizeConfig(projectPayload.currentConfig as Partial<ParticleConfig> | undefined);
  const manifest = normalizeProjectManifest(projectPayload.manifest, currentConfig, presets, presetSequence);
  const existingVersion = typeof projectPayload.version === 'number' ? projectPayload.version : null;
  const schemaPayload = isPlainObject(projectPayload.schema) ? projectPayload.schema : null;
  const schema = buildProjectExportSchema({
    projectDataVersion: typeof schemaPayload?.projectDataVersion === 'number' ? schemaPayload.projectDataVersion : (existingVersion ?? PROJECT_DATA_VERSION),
    manifestSchemaVersion: typeof schemaPayload?.manifestSchemaVersion === 'number' ? schemaPayload.manifestSchemaVersion : manifest.schemaVersion,
    serializationSchemaVersion: typeof schemaPayload?.serializationSchemaVersion === 'number' ? schemaPayload.serializationSchemaVersion : (typeof manifest.serializationSchemaVersion === 'number' ? manifest.serializationSchemaVersion : PROJECT_SERIALIZATION_SCHEMA_VERSION),
    migrationState: schemaPayload?.format === PROJECT_FORMAT_ID && existingVersion === PROJECT_DATA_VERSION ? 'native' : 'migrated',
    migratedFromProjectDataVersion: schemaPayload?.format === PROJECT_FORMAT_ID && existingVersion === PROJECT_DATA_VERSION ? null : existingVersion,
  });

  const serialization = normalizeProjectSerializationSnapshot(
    projectPayload.serialization,
    currentConfig,
    schema.serializationSchemaVersion,
  );

  return {
    version: schema.projectDataVersion,
    schema,
    exportedAt: typeof projectPayload.exportedAt === 'string' ? projectPayload.exportedAt : new Date().toISOString(),
    name: typeof projectPayload.name === 'string' && projectPayload.name.trim().length > 0 ? projectPayload.name.trim() : 'Untitled Project',
    currentConfig,
    activePresetId: typeof projectPayload.activePresetId === 'string' ? projectPayload.activePresetId : null,
    presetBlendDuration: typeof projectPayload.presetBlendDuration === 'number' ? Math.max(0.2, projectPayload.presetBlendDuration) : 1.5,
    sequenceLoopEnabled: typeof projectPayload.sequenceLoopEnabled === 'boolean' ? projectPayload.sequenceLoopEnabled : true,
    presets,
    presetSequence,
    ui,
    serialization,
    manifest,
  };
}

export function buildProjectData(input: {
  name?: string;
  config: ParticleConfig;
  activePresetId: string | null;
  presetBlendDuration: number;
  sequenceLoopEnabled: boolean;
  presets: PresetRecord[];
  presetSequence: PresetSequenceItem[];
  ui?: Partial<ProjectUiState>;
}): ProjectData {
  const normalizedConfig = normalizeConfig(input.config);
  const normalizedPresets = input.presets.map(normalizePresetRecord);
  const normalizedSequence = input.presetSequence.map(normalizeSequenceItem);
  const manifest = buildProjectManifest(normalizedConfig, normalizedPresets, normalizedSequence);
  const schema = buildProjectExportSchema({
    projectDataVersion: PROJECT_DATA_VERSION,
    manifestSchemaVersion: manifest.schemaVersion,
    serializationSchemaVersion: manifest.serializationSchemaVersion,
    migrationState: 'native',
    migratedFromProjectDataVersion: null,
  });
  return {
    version: PROJECT_DATA_VERSION,
    schema,
    exportedAt: new Date().toISOString(),
    name: input.name?.trim() || 'Untitled Project',
    currentConfig: normalizedConfig,
    activePresetId: input.activePresetId,
    presetBlendDuration: Math.max(0.2, input.presetBlendDuration),
    sequenceLoopEnabled: input.sequenceLoopEnabled,
    presets: normalizedPresets,
    presetSequence: normalizedSequence,
    ui: {
      ...DEFAULT_PROJECT_UI,
      ...input.ui,
    },
    serialization: buildProjectSerializationSnapshot(normalizedConfig, schema.serializationSchemaVersion),
    manifest,
  };
}

export function loadProjectData(): ProjectData | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsedPayload = readPayloadJson(PROJECT_STORAGE_KEY) ?? readLocalStorageJson(PROJECT_STORAGE_KEY_LEGACY);
    if (parsedPayload) {
      const parsed = parseProjectData(parsedPayload);
      if (parsed) {
        // The persisted snapshot is consumed directly by the UI without an
        // import-preparation pass, so keep the defensive cleanup that
        // parseProjectData used to apply here instead.
        const presets = dedupePresetRecords(parsed.presets);
        const validPresetIds = new Set(presets.map((preset) => preset.id));
        return {
          ...parsed,
          presets,
          presetSequence: dedupePresetSequence(parsed.presetSequence)
            .filter((item) => validPresetIds.has(item.presetId)),
        };
      }
    }
  } catch (error) {
    console.warn('Failed to load project snapshot:', error);
  }

  try {
    const presets = loadPersistedPresetRecords();
    const presetIds = new Set(presets.map((preset) => preset.id));
    const presetSequence = loadPersistedPresetSequence(presetIds);
    return buildProjectData({
      name: 'Recovered Project',
      config: normalizeConfig({}),
      activePresetId: null,
      presetBlendDuration: 1.5,
      sequenceLoopEnabled: true,
      presets,
      presetSequence,
      ui: DEFAULT_PROJECT_UI,
    });
  } catch (error) {
    console.warn('Failed to build legacy project snapshot:', error);
    return null;
  }
}

export function saveProjectData(project: ProjectData) {
  if (typeof window === 'undefined') return;

  // IndexedDB is the primary store (Phase 1 renewal): the full payload is
  // written through storageDb, whose write queue itself waits for
  // hydration to settle, so an autosave fired during the first render can
  // never race the migration copy. Oversized projects now persist instead
  // of being silently reduced. storageDb also mirrors the payload into
  // localStorage while it fits the legacy cap.
  if (!isStorageHydrationSettled() || isIndexedDbAvailable()) {
    putStoragePayload(PROJECT_STORAGE_KEY, JSON.stringify(project));
    return;
  }

  // Hydration settled without IndexedDB (private mode, old browser, …):
  // the legacy tiered localStorage saves, unchanged.
  if (safelySetLocalStorageItem(PROJECT_STORAGE_KEY, project)) {
    return;
  }

  const reducedPayload = buildReducedProjectPayload(project);
  if (safelySetLocalStorageItem(PROJECT_STORAGE_KEY, reducedPayload)) {
    return;
  }

  safelySetLocalStorageItem(PROJECT_STORAGE_KEY, buildMinimalProjectPayload(project));
}
