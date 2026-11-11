import type { PresetRecord, PresetSequenceItem, ProjectUiState } from '../types';
import {
  normalizeConfig,
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthMode,
  normalizeSequenceDriveStrengthOverride,
  normalizeSequenceTransitionEasing,
} from './appStateConfig';


function createProjectSequenceItemId() {
  return `sequence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const PROJECT_STORAGE_KEY = 'monosphere-project-v3';
export const PROJECT_STORAGE_KEY_LEGACY = 'monosphere-project-v2';
export const PROJECT_FORMAT_ID = 'monosphere-project';
export const PROJECT_DATA_VERSION = 13;
export const PROJECT_MANIFEST_SCHEMA_VERSION = 11;
export const PROJECT_SERIALIZATION_SCHEMA_VERSION = 2;

export const DEFAULT_PROJECT_UI: ProjectUiState = {
  isPlaying: true,
  isPanelOpen: true,
  videoExportMode: 'sequence',
  videoDurationSeconds: 8,
  videoFps: 30,
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePresetRecord(item: Partial<PresetRecord> & { id: string; name: string }): PresetRecord {
  return {
    id: item.id,
    name: item.name,
    config: normalizeConfig(item.config),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
  };
}

export function normalizeSequenceItem(item: Partial<PresetSequenceItem> & { id: string; presetId: string }): PresetSequenceItem {
  return {
    id: item.id || createProjectSequenceItemId(),
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

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}
