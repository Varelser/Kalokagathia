import type { ParticleConfig, PresetRecord } from '../types';
import { createPresetId, normalizeConfig } from './appState';
import { getSavedUserParameters, sanitizeUserParameters } from './userParameters';

export function createPresetRecord(
  config: ParticleConfig,
  name: string,
  presetCount: number,
) {
  const trimmedName = name.trim() || `Preset ${presetCount + 1}`;
  const now = new Date().toISOString();

  const preset: PresetRecord = {
    id: createPresetId(),
    name: trimmedName,
    config: normalizeConfig(config),
    createdAt: now,
    updatedAt: now,
  };

  // Phase 21 stage 1 (#p= propagation): a newly saved preset captures
  // the author's saved User Parameter declarations so a #p= link to
  // it can restore them as the session overlay. With zero saved
  // declarations the field stays absent — the record is exactly the
  // legacy shape.
  const captured = sanitizeUserParameters(getSavedUserParameters());
  if (captured.length > 0) preset.userParameters = captured;

  return preset;
}

export function duplicatePresetRecord(sourcePreset: PresetRecord) {
  const now = new Date().toISOString();

  const duplicate: PresetRecord = {
    id: createPresetId(),
    name: `${sourcePreset.name} Copy`,
    config: normalizeConfig(sourcePreset.config),
    createdAt: now,
    updatedAt: now,
  };

  // Phase 21 stage 1: a duplicate carries the source's bundled
  // declarations (sanitised); a source without any yields a legacy
  // shape duplicate.
  if (sourcePreset.userParameters !== undefined) {
    const carried = sanitizeUserParameters(sourcePreset.userParameters);
    if (carried.length > 0) duplicate.userParameters = carried;
  }

  return duplicate;
}
