import type { PresetLibraryData, PresetRecord, PresetSequenceItem } from '../types';
import { DEFAULT_CONFIG, normalizeConfig } from './appStateConfig';
import {
  OPERATOR_ATLAS_STACK_PRESETS,
  OPERATOR_ATLAS_STACK_SEQUENCES,
  OPERATOR_COLLISION_REVIEW_PRESETS,
  OPERATOR_COLLISION_REVIEW_SEQUENCES,
  OPERATOR_COMBO_PRESETS,
  OPERATOR_COMBO_SEQUENCES,
  OPERATOR_DEDICATED_AXIS_PRESETS,
  OPERATOR_DEDICATED_AXIS_SEQUENCES,
  OPERATOR_DEDICATED_SUBAXIS_PRESETS,
  OPERATOR_DEDICATED_SUBAXIS_SEQUENCES,
  OPERATOR_STARTER_PRESETS,
  OPERATOR_STARTER_SEQUENCES,
} from './operatorGeneratedStarters';
import { PRODUCT_PACK_BUNDLES, buildProductPackPatch } from './productPackLibrary';
import { STARTER_TIMESTAMP, createStarterPreset } from './starterLibraryCore';
import { STARTER_PRESET_BASE } from './starterLibraryPresetBase';
import { STARTER_PRESET_EXTENSIONS } from './starterLibraryPresetExtensions';
import { STARTER_PRESET_SEQUENCE_BASE } from './starterLibrarySequenceBase';
import { STARTER_PRESET_SEQUENCE_EXTENSIONS } from './starterLibrarySequenceExtensions';

const PRODUCT_PACK_STARTER_PRESETS: PresetRecord[] = PRODUCT_PACK_BUNDLES.map((bundle) => createStarterPreset(
  `starter-${bundle.id.replace(/^product-pack-/, 'pack-')}`,
  `Pack ${bundle.label}`,
  buildProductPackPatch(bundle.id),
));

const PRODUCT_PACK_STARTER_SEQUENCES: PresetSequenceItem[] = PRODUCT_PACK_BUNDLES.map((bundle): PresetSequenceItem => ({
  id: `starter-sequence-${bundle.id.replace(/^product-pack-/, 'pack-')}`,
  presetId: `starter-${bundle.id.replace(/^product-pack-/, 'pack-')}`,
  label: `Pack ${bundle.label}`,
  holdSeconds: 3.28,
  transitionSeconds: 1.18,
  transitionEasing: 'ease-in-out',
  screenSequenceDriveMode: 'inherit',
  screenSequenceDriveStrengthMode: 'inherit',
  screenSequenceDriveStrengthOverride: null,
  screenSequenceDriveMultiplier: 1.06,
  keyframeConfig: null,
}));

function dedupePresets(records: Array<PresetRecord | undefined | null>): PresetRecord[] {
  const seen = new Set<string>();
  const deduped: PresetRecord[] = [];
  for (const record of records) {
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    deduped.push(record);
  }
  return deduped;
}

function dedupeSequence(items: PresetSequenceItem[], validPresetIds: Set<string>): PresetSequenceItem[] {
  const seen = new Set<string>();
  const deduped: PresetSequenceItem[] = [];
  for (const item of items) {
    if (!validPresetIds.has(item.presetId)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

export const STARTER_PRESETS: PresetRecord[] = dedupePresets([
  ...STARTER_PRESET_BASE,
  ...STARTER_PRESET_EXTENSIONS,
  ...PRODUCT_PACK_STARTER_PRESETS,
  ...OPERATOR_STARTER_PRESETS,
  ...OPERATOR_COMBO_PRESETS,
  ...OPERATOR_DEDICATED_AXIS_PRESETS,
  ...OPERATOR_DEDICATED_SUBAXIS_PRESETS,
  ...OPERATOR_COLLISION_REVIEW_PRESETS,
  ...OPERATOR_ATLAS_STACK_PRESETS,
] as Array<PresetRecord | undefined | null>);

const STARTER_PRESET_IDS = new Set(STARTER_PRESETS.map((preset) => preset.id));

export const STARTER_PRESET_SEQUENCE: PresetSequenceItem[] = dedupeSequence([
  ...STARTER_PRESET_SEQUENCE_BASE,
  ...STARTER_PRESET_SEQUENCE_EXTENSIONS,
  ...PRODUCT_PACK_STARTER_SEQUENCES,
  ...OPERATOR_STARTER_SEQUENCES,
  ...OPERATOR_COMBO_SEQUENCES,
  ...OPERATOR_DEDICATED_AXIS_SEQUENCES,
  ...OPERATOR_DEDICATED_SUBAXIS_SEQUENCES,
  ...OPERATOR_COLLISION_REVIEW_SEQUENCES,
  ...OPERATOR_ATLAS_STACK_SEQUENCES,
], STARTER_PRESET_IDS);

export const STARTER_PRESET_LIBRARY: PresetLibraryData = {
  version: 1,
  exportedAt: STARTER_TIMESTAMP,
  currentConfig: STARTER_PRESETS[0]?.config ?? normalizeConfig(DEFAULT_CONFIG),
  activePresetId: STARTER_PRESETS[0]?.id ?? null,
  presetBlendDuration: 1.4,
  sequenceLoopEnabled: true,
  presets: STARTER_PRESETS,
  presetSequence: STARTER_PRESET_SEQUENCE,
};
