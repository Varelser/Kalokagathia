// Preset hierarchy metadata (limit plan stage 4, slice S8:
// template / preset hierarchy, QuickTools style).
// Design: STAGE4_DESIGN_MATERIALS.md §6 案A — hierarchy metadata
// is created new, in its own file, and the existing presets are
// placed on it WITHOUT changing any preset key or value. The
// hierarchy is three levels: lineage (系統) > family (家族) >
// preset. UI: tree + cards side by side (the preset panel
// filters its existing card list by the selected node).
//
// Where the classification comes from (nothing is invented):
// - Lineages are the composition groups of lib/starterLibrary.ts
//   itself: Starter Base, Starter Extensions, Product Packs,
//   Operator Generated — plus one Designer Templates lineage
//   whose only family is the receptacle for Designer block
//   compositions saved as templates (see below).
// - Families are the leaf chunk names of the starter library
//   (Foundational, Structural, …, Weather Relics), the
//   ProductPackBundle.family values for packs, and the operator
//   starter arrays for operator presets.
// - Preset ids are DERIVED from the actual record arrays of
//   those chunks, never hand-listed, so a chunk gaining a preset
//   places it automatically. The S8 test pins the invariants
//   against STARTER_PRESETS: every referenced id exists, no id
//   is placed twice, and every starter preset is placed.
//
// Kind (種別): every entry carries 'preset' | 'template', the
// same vocabulary as DesignerBlockRecordKind in
// lib/designerBlocks.ts (STAGE4_DECISIONS.md 決定3: templates
// are, in their primary form, saved Designer block
// compositions). All starter entries are 'preset'. The Designer
// Templates family is the receptacle that accepts 'template'
// entries; it intentionally holds no preset ids, because a
// template is not a finished preset record — the compositions
// themselves live in the Designer storage
// (monosphere-designer-blocks-v1) and are listed in the
// Designer section. No config keys are added by this module:
// the hierarchy is library-side metadata, versioned here
// (PRESET_HIERARCHY_VERSION) and checked by
// validatePresetHierarchy, following the version + validation
// practice of lib/presetLibraryPersist.ts.

import type { PresetRecord } from '../types';
import type { DesignerBlockRecordKind } from './designerBlocks';
import { STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL } from './starterLibraryPresetBaseChunk01Foundational';
import { STARTER_PRESET_BASE_CHUNK_01_STRUCTURAL } from './starterLibraryPresetBaseChunk01Structural';
import { STARTER_PRESET_BASE_CHUNK_01_CINEMATIC } from './starterLibraryPresetBaseChunk01Cinematic';
import { STARTER_PRESET_BASE_CHUNK_02_MOTION } from './starterLibraryPresetBaseChunk02Motion';
import { STARTER_PRESET_BASE_CHUNK_02_PROCEDURAL } from './starterLibraryPresetBaseChunk02Procedural';
import { STARTER_PRESET_BASE_CHUNK_02_HYBRID } from './starterLibraryPresetBaseChunk02Hybrid';
import { STARTER_PRESET_BASE_CHUNK_03_EVENT_STUDIES } from './starterLibraryPresetBaseChunk03EventStudies';
import { STARTER_PRESET_BASE_CHUNK_03_FIELD_STUDIES } from './starterLibraryPresetBaseChunk03FieldStudies';
import { STARTER_PRESET_BASE_CHUNK_03_HYBRID_STUDIES } from './starterLibraryPresetBaseChunk03HybridStudies';
import { STARTER_PRESET_BASE_CHUNK_04_CORE_RELICS } from './starterLibraryPresetBaseChunk04CoreRelics';
import { STARTER_PRESET_BASE_CHUNK_04_RITUAL_RELICS } from './starterLibraryPresetBaseChunk04RitualRelics';
import { STARTER_PRESET_BASE_CHUNK_04_WEATHER_RELICS } from './starterLibraryPresetBaseChunk04WeatherRelics';
import { STARTER_PRESET_EXTENSION_CHUNK_01_ATLAS } from './starterLibraryPresetExtensionChunk01Atlas';
import { STARTER_PRESET_EXTENSION_CHUNK_01_ATMOSPHERIC } from './starterLibraryPresetExtensionChunk01Atmospheric';
import { STARTER_PRESET_EXTENSION_CHUNK_01_OUTLINE_BIOLOGIC } from './starterLibraryPresetExtensionChunk01OutlineBiologic';
import { STARTER_PRESET_EXTENSION_CHUNK_02_CODEX_STUDIES } from './starterLibraryPresetExtensionChunk02CodexStudies';
import { STARTER_PRESET_EXTENSION_CHUNK_02_SOURCE_CONTRASTS } from './starterLibraryPresetExtensionChunk02SourceContrasts';
import { STARTER_PRESET_EXTENSION_CHUNK_02_SURFACE_STUDIES } from './starterLibraryPresetExtensionChunk02SurfaceStudies';
import { STARTER_PRESET_EXTENSION_CHUNK_02_TEXT_VIDEO_STUDIES } from './starterLibraryPresetExtensionChunk02TextVideoStudies';
import { STARTER_PRESET_EXTENSION_CHUNK_03_EXPRESSION } from './starterLibraryPresetExtensionChunk03Expression';
import { STARTER_PRESET_EXTENSION_CHUNK_03_REVIEW_SPLIT } from './starterLibraryPresetExtensionChunk03ReviewSplit';
import { STARTER_PRESET_EXTENSION_CHUNK_03_SOURCE_CONTRAST } from './starterLibraryPresetExtensionChunk03SourceContrast';
import { STARTER_PRESET_EXTENSION_CHUNK_04 } from './starterLibraryPresetExtensionChunk04';
import { STARTER_PRESET_EXTENSION_CHUNK_05_GPGPU } from './starterLibraryPresetExtensionChunk05Gpgpu';
import { STARTER_PRESET_EXTENSION_CHUNK_05_KINETIX } from './starterLibraryPresetExtensionChunk05Kinetix';
import { STARTER_PRESET_EXTENSION_CHUNK_05_PHASE42 } from './starterLibraryPresetExtensionChunk05Phase42';
import { STARTER_PRESET_EXTENSION_CHUNK_05_PHASE_CHANGE } from './starterLibraryPresetExtensionChunk05PhaseChange';
import { STARTER_PRESET_EXTENSION_CHUNK_05_POST_FX } from './starterLibraryPresetExtensionChunk05PostFx';
import { STARTER_PRESET_EXTENSION_CHUNK_05_REFERENCE } from './starterLibraryPresetExtensionChunk05Reference';
import {
  OPERATOR_ATLAS_STACK_PRESETS,
  OPERATOR_COLLISION_REVIEW_PRESETS,
  OPERATOR_COMBO_PRESETS,
  OPERATOR_DEDICATED_AXIS_PRESETS,
  OPERATOR_DEDICATED_SUBAXIS_PRESETS,
  OPERATOR_STARTER_PRESETS,
} from './operatorGeneratedStarters';
import { PRODUCT_PACK_BUNDLES } from './productPackLibrary';

export const PRESET_HIERARCHY_VERSION = 1;

/** Entry kind (種別). Same vocabulary as the Designer records. */
export type PresetHierarchyEntryKind = DesignerBlockRecordKind;

export const PRESET_HIERARCHY_ENTRY_KINDS: readonly PresetHierarchyEntryKind[] = ['preset', 'template'];

export interface PresetHierarchyFamily {
  id: string;
  label: string;
  kind: PresetHierarchyEntryKind;
  presetIds: string[];
}

export interface PresetHierarchyLineage {
  id: string;
  label: string;
  families: PresetHierarchyFamily[];
}

export interface PresetHierarchy {
  version: number;
  lineages: PresetHierarchyLineage[];
}

/** One flattened placement: a preset id and where it sits. */
export interface PresetHierarchyPlacement {
  presetId: string;
  lineageId: string;
  familyId: string;
  kind: PresetHierarchyEntryKind;
}

type IdCarrier = Pick<PresetRecord, 'id'>;

function family(id: string, label: string, records: readonly IdCarrier[], kind: PresetHierarchyEntryKind = 'preset'): PresetHierarchyFamily {
  return { id, label, kind, presetIds: records.map((record) => record.id) };
}

// Product pack starter records are built inside
// lib/starterLibrary.ts from PRODUCT_PACK_BUNDLES with this id
// formula; the hierarchy derives the same ids from the bundles
// (grouped by the bundle's own `family` field) instead of
// importing the assembled starter list, which would be circular
// in spirit (the hierarchy describes the library's sources).
// The S8 test pins these ids against STARTER_PRESETS, so a
// formula drift fails loudly instead of silently misplacing.
function productPackFamilies(): PresetHierarchyFamily[] {
  const byFamily = new Map<string, IdCarrier[]>();
  for (const bundle of PRODUCT_PACK_BUNDLES) {
    const starterId = `starter-${bundle.id.replace(/^product-pack-/, 'pack-')}`;
    const list = byFamily.get(bundle.family) ?? [];
    list.push({ id: starterId });
    byFamily.set(bundle.family, list);
  }
  return [...byFamily.entries()].map(([familyId, records]) => family(
    `packs-${familyId}`,
    familyId.charAt(0).toUpperCase() + familyId.slice(1),
    records,
  ));
}

const PRESET_HIERARCHY_RAW: PresetHierarchy = {
  version: PRESET_HIERARCHY_VERSION,
  lineages: [
    {
      id: 'starter-base',
      label: 'Starter Base',
      families: [
        family('base-foundational', 'Foundational', STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL),
        family('base-structural', 'Structural', STARTER_PRESET_BASE_CHUNK_01_STRUCTURAL),
        family('base-cinematic', 'Cinematic', STARTER_PRESET_BASE_CHUNK_01_CINEMATIC),
        family('base-procedural', 'Procedural', STARTER_PRESET_BASE_CHUNK_02_PROCEDURAL),
        family('base-motion', 'Motion', STARTER_PRESET_BASE_CHUNK_02_MOTION),
        family('base-hybrid', 'Hybrid', STARTER_PRESET_BASE_CHUNK_02_HYBRID),
        family('base-event-studies', 'Event Studies', STARTER_PRESET_BASE_CHUNK_03_EVENT_STUDIES),
        family('base-field-studies', 'Field Studies', STARTER_PRESET_BASE_CHUNK_03_FIELD_STUDIES),
        family('base-hybrid-studies', 'Hybrid Studies', STARTER_PRESET_BASE_CHUNK_03_HYBRID_STUDIES),
        family('base-core-relics', 'Core Relics', STARTER_PRESET_BASE_CHUNK_04_CORE_RELICS),
        family('base-ritual-relics', 'Ritual Relics', STARTER_PRESET_BASE_CHUNK_04_RITUAL_RELICS),
        family('base-weather-relics', 'Weather Relics', STARTER_PRESET_BASE_CHUNK_04_WEATHER_RELICS),
      ],
    },
    {
      id: 'starter-extensions',
      label: 'Starter Extensions',
      families: [
        family('ext-atmospheric', 'Atmospheric', STARTER_PRESET_EXTENSION_CHUNK_01_ATMOSPHERIC),
        family('ext-atlas', 'Atlas', STARTER_PRESET_EXTENSION_CHUNK_01_ATLAS),
        family('ext-outline-biologic', 'Outline Biologic', STARTER_PRESET_EXTENSION_CHUNK_01_OUTLINE_BIOLOGIC),
        family('ext-surface-studies', 'Surface Studies', STARTER_PRESET_EXTENSION_CHUNK_02_SURFACE_STUDIES),
        family('ext-source-contrasts', 'Source Contrasts', STARTER_PRESET_EXTENSION_CHUNK_02_SOURCE_CONTRASTS),
        family('ext-text-video-studies', 'Text Video Studies', STARTER_PRESET_EXTENSION_CHUNK_02_TEXT_VIDEO_STUDIES),
        family('ext-codex-studies', 'Codex Studies', STARTER_PRESET_EXTENSION_CHUNK_02_CODEX_STUDIES),
        family('ext-expression', 'Expression', STARTER_PRESET_EXTENSION_CHUNK_03_EXPRESSION),
        family('ext-source-contrast', 'Source Contrast', STARTER_PRESET_EXTENSION_CHUNK_03_SOURCE_CONTRAST),
        family('ext-review-split', 'Review Split', STARTER_PRESET_EXTENSION_CHUNK_03_REVIEW_SPLIT),
        // Chunk 04 has no named leaf chunks in the source; the
        // family keeps the file's own name instead of an
        // invented theme label.
        family('ext-chunk-04', 'Extension Chunk 04', STARTER_PRESET_EXTENSION_CHUNK_04),
        family('ext-phase-change', 'Phase Change', STARTER_PRESET_EXTENSION_CHUNK_05_PHASE_CHANGE),
        family('ext-gpgpu', 'GPGPU', STARTER_PRESET_EXTENSION_CHUNK_05_GPGPU),
        family('ext-reference', 'Reference', STARTER_PRESET_EXTENSION_CHUNK_05_REFERENCE),
        family('ext-phase42', 'Phase 42', STARTER_PRESET_EXTENSION_CHUNK_05_PHASE42),
        family('ext-post-fx', 'Post FX', STARTER_PRESET_EXTENSION_CHUNK_05_POST_FX),
        family('ext-kinetix', 'Kinetix', STARTER_PRESET_EXTENSION_CHUNK_05_KINETIX),
      ],
    },
    {
      id: 'product-packs',
      label: 'Product Packs',
      families: productPackFamilies(),
    },
    {
      id: 'operator-generated',
      label: 'Operator Generated',
      families: [
        family('operator-starter', 'Operator Starter', OPERATOR_STARTER_PRESETS),
        family('operator-combo', 'Operator Combo', OPERATOR_COMBO_PRESETS),
        family('operator-dedicated-axis', 'Dedicated Axis', OPERATOR_DEDICATED_AXIS_PRESETS),
        family('operator-dedicated-subaxis', 'Dedicated Subaxis', OPERATOR_DEDICATED_SUBAXIS_PRESETS),
        family('operator-collision-review', 'Collision Review', OPERATOR_COLLISION_REVIEW_PRESETS),
        family('operator-atlas-stack', 'Atlas Stack', OPERATOR_ATLAS_STACK_PRESETS),
      ],
    },
    {
      id: 'designer-templates',
      label: 'Designer Templates',
      families: [
        // Receptacle for 'template' entries (Designer block
        // compositions). Holds no preset ids on purpose: a
        // template is a skeleton, not a finished preset record.
        family('designer-template-blocks', 'Designer Block Templates', [], 'template'),
      ],
    },
  ],
};

// First-wins dedupe, mirroring the starter library itself:
// lib/starterLibrary.ts dedupePresets keeps the FIRST record of
// each id, and the source chunks do contain repeated ids
// (23 extra appearances at the time of this slice: several
// Extension Chunk 02 presets reappear in Chunk 03, and the
// operator Atlas Stack re-lists Extension Atlas presets).
// Family order above follows the aggregators' spread order, so
// the first placement here is the same occurrence the library
// itself keeps. Later appearances are dropped from the
// hierarchy (the preset still exists exactly once, in its
// first family).
function dedupePlacements(hierarchy: PresetHierarchy): PresetHierarchy {
  const seen = new Set<string>();
  return {
    version: hierarchy.version,
    lineages: hierarchy.lineages.map((lineage) => ({
      ...lineage,
      families: lineage.families.map((fam) => ({
        ...fam,
        presetIds: fam.presetIds.filter((presetId) => {
          if (seen.has(presetId)) return false;
          seen.add(presetId);
          return true;
        }),
      })),
    })),
  };
}

export const PRESET_HIERARCHY: PresetHierarchy = dedupePlacements(PRESET_HIERARCHY_RAW);

/** Flatten the hierarchy into placements, in metadata order. */
export function flattenPresetHierarchy(hierarchy: PresetHierarchy = PRESET_HIERARCHY): PresetHierarchyPlacement[] {
  const placements: PresetHierarchyPlacement[] = [];
  for (const lineage of hierarchy.lineages) {
    for (const fam of lineage.families) {
      for (const presetId of fam.presetIds) {
        placements.push({ presetId, lineageId: lineage.id, familyId: fam.id, kind: fam.kind });
      }
    }
  }
  return placements;
}

const PLACEMENT_BY_PRESET_ID = new Map<string, PresetHierarchyPlacement>(
  flattenPresetHierarchy().map((placement) => [placement.presetId, placement]),
);

/** Placement of one preset, or null when it is not a placed
 *  starter preset (e.g. a user-saved preset). Null never hides a
 *  preset by itself: the panel only narrows when the user picks
 *  a hierarchy node. */
export function getPresetHierarchyPlacement(presetId: string): PresetHierarchyPlacement | null {
  return PLACEMENT_BY_PRESET_ID.get(presetId) ?? null;
}

export interface PresetHierarchySelection {
  lineageId?: string | null;
  familyId?: string | null;
  kind?: PresetHierarchyEntryKind | null;
}

/** Deterministic narrowing by hierarchy selection. Input order
 *  is preserved (the panel's existing ordering is untouched),
 *  and an empty selection returns the input as-is. Pure: the
 *  same arguments always produce the same result. */
export function filterPresetsByHierarchy<T extends IdCarrier>(
  presets: readonly T[],
  selection: PresetHierarchySelection = {},
): T[] {
  const { lineageId = null, familyId = null, kind = null } = selection;
  if (!lineageId && !familyId && !kind) return [...presets];
  return presets.filter((preset) => {
    const placement = getPresetHierarchyPlacement(preset.id);
    if (!placement) return false;
    if (lineageId && placement.lineageId !== lineageId) return false;
    if (familyId && placement.familyId !== familyId) return false;
    if (kind && placement.kind !== kind) return false;
    return true;
  });
}

export type PresetHierarchyValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** Refusal-style validation of a hierarchy-shaped value: bad
 *  version, duplicate lineage / family ids, an entry kind
 *  outside 'preset' | 'template', or a preset id placed more
 *  than once are all refused with a reason string. */
export function validatePresetHierarchy(raw: unknown): PresetHierarchyValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };
  const hierarchy = raw as PresetHierarchy;
  if (hierarchy.version !== PRESET_HIERARCHY_VERSION) return { ok: false, reason: 'version' };
  if (!Array.isArray(hierarchy.lineages)) return { ok: false, reason: 'lineages' };
  const lineageIds = new Set<string>();
  const familyIds = new Set<string>();
  const placedPresetIds = new Set<string>();
  for (const lineage of hierarchy.lineages) {
    if (!lineage || typeof lineage.id !== 'string' || !Array.isArray(lineage.families)) {
      return { ok: false, reason: 'lineage-shape' };
    }
    if (lineageIds.has(lineage.id)) return { ok: false, reason: `duplicate-lineage:${lineage.id}` };
    lineageIds.add(lineage.id);
    for (const fam of lineage.families) {
      if (!fam || typeof fam.id !== 'string' || !Array.isArray(fam.presetIds)) {
        return { ok: false, reason: 'family-shape' };
      }
      if (familyIds.has(fam.id)) return { ok: false, reason: `duplicate-family:${fam.id}` };
      familyIds.add(fam.id);
      if (!PRESET_HIERARCHY_ENTRY_KINDS.includes(fam.kind)) {
        return { ok: false, reason: `invalid-kind:${fam.id}:${String(fam.kind)}` };
      }
      for (const presetId of fam.presetIds) {
        if (typeof presetId !== 'string' || presetId.length === 0) {
          return { ok: false, reason: `invalid-preset-id:${fam.id}` };
        }
        if (placedPresetIds.has(presetId)) return { ok: false, reason: `duplicate-preset:${presetId}` };
        placedPresetIds.add(presetId);
      }
    }
  }
  return { ok: true };
}
