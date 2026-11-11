import type { PresetRecord } from '../types';

/**
 * Impression tags for the preset shelf (shelf deepening): what a preset
 * *uses*, derived from its config on the fly — never stored, so tags can
 * never disagree with the preset itself. Ordered by distinctiveness;
 * tiles show at most four. The shelf also offers the frequent tags as a
 * one-tap filter.
 */

const DEPOSITION_TYPES = new Set([
  'deposition_field',
  'stipple_field',
  'capillary_sheet',
  'percolation_sheet',
  'ink_bleed',
  'drift_glyph_dust',
  'sigil_dust',
  'seep_fracture',
  'corrosion_front',
  'biofilm_skin',
]);

export function getPresetTags(preset: PresetRecord): string[] {
  const config = preset.config;
  const types = [config.layer2Type, config.layer3Type];
  const tags: string[] = [];
  if (types.includes('reaction_diffusion')) tags.push('Reaction');
  if (types.some((type) => DEPOSITION_TYPES.has(type))) tags.push('Deposition');
  if (config.gpgpuSphEnabled) tags.push('SPH');
  if (config.gpgpuFluidEnabled) tags.push('Fluid Sim');
  if (config.gpgpuEnabled) tags.push('GPGPU');
  if (config.gpgpuWebGPUEnabled) tags.push('WebGPU');
  if (config.postKaleidoscopeEnabled) tags.push('Kaleidoscope');
  if (config.postSlitScanEnabled) tags.push('Slit Scan');
  if (config.postFeedbackEnabled) tags.push('Feedback');
  if (config.layer2GhostTrailEnabled || config.layer3GhostTrailEnabled) tags.push('Ghost Trails');
  if (config.audioEnabled) tags.push('Audio');
  if (config.postBloomEnabled) tags.push('Bloom');
  return tags.slice(0, 4);
}

/** Tag frequencies across a library, most frequent first. */
export function getPresetTagCounts(presets: PresetRecord[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const preset of presets) {
    for (const tag of getPresetTags(preset)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
