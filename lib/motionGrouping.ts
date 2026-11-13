import type { Layer2Type } from '../types';
import { MOTION_MAP } from '../components/sceneMotionMap';

export type MotionGroupName = 'Fluid' | 'Chaos' | 'Orbit' | 'Pattern' | 'Structure' | 'Pulse' | 'Transform';

export const MOTION_GROUPS: { label: MotionGroupName; ids: Layer2Type[] }[] = [
  {
    label: 'Fluid',
    ids: ['flow', 'field', 'curl', 'liquid', 'smoke', 'noise', 'ridged_mf', 'crosscurrent', 'tidal', 'caustic', 'eddy', 'nebula', 'cyclone', 'aero', 'wind', 'liquid_smear', 'dust_plume', 'ashfall', 'flock_drift', 'vapor_canopy', 'foam_drift', 'soot_veil', 'charge_veil', 'prism_smoke', 'rune_smoke', 'mirage_smoke', 'ion_rain', 'velvet_ash', 'static_smoke', 'viscous_flow', 'capillary_sheet', 'percolation_sheet', 'advection_flow', 'vortex_transport', 'pressure_cells', 'condense_field', 'sublimate_cloud'],
  },
  { label: 'Chaos', ids: ['lorenz', 'aizawa', 'rossler', 'thomas', 'euler', 'clifford', 'hopalong', 'halvorsen', 'chen', 'lu', 'sprott', 'rabinovich', 'dejong', 'ikeda', 'chua'] },
  { label: 'Orbit', ids: ['orbit', 'orbit_swarm', 'spiral_motion', 'helix', 'pendulum', 'epicycle', 'toroidal', 'torus_knot', 'hopf', 'helio', 'coil', 'gyro', 'braid', 'braidshell', 'pinwheel', 'braid_stream', 'vortex_sheet', 'tidal_lock'] },
  { label: 'Pattern', ids: ['lissajous', 'rose_curve', 'mandala', 'petals', 'kaleidoscope', 'prism', 'starburst', 'radial_steps', 'fronds', 'gyroflower', 'runes', 'phyllotaxis', 'gyre', 'crystal', 'quasicrystal', 'interference_wave', 'stipple_field', 'contour_echo', 'echo_rings', 'standing_interference', 'resonance_flux', 'lattice_surge'] },
  { label: 'Structure', ids: ['lattice', 'cellular', 'tessellate', 'web', 'grid_wave', 'pulse_grid', 'sheet', 'filament', 'labyrinth', 'monolith', 'surface_shell', 'surface_patch', 'brush_surface', 'fiber_field', 'growth_field', 'deposition_field', 'crystal_aggregate', 'erosion_trail', 'voxel_lattice', 'crystal_deposition', 'reaction_diffusion', 'physarum', 'dla', 'l-system', 'raymarch', 'volume_fog', 'shard_debris', 'aura_shell', 'mesh_weave', 'halo_bloom', 'ink_bleed', 'plasma_thread', 'skin_lattice', 'branch_propagation', 'biofilm_skin', 'static_lace', 'fracture_pollen', 'tremor_lattice', 'nerve_web', 'mirror_skin', 'cinder_web', 'membrane_pollen', 'spectral_mesh', 'ember_lace', 'spore_halo', 'calcified_skin', 'aurora_threads', 'residue_skin', 'sigil_dust', 'frost_lattice', 'shell_script', 'prism_threads', 'pollen_lattice', 'eclipse_halo', 'resin_shell', 'cloth_membrane', 'granular_fall', 'growth_grammar', 'elastic_sheet', 'sediment_stack', 'cellular_front', 'elastic_lattice', 'viscoelastic_membrane', 'talus_heap', 'corrosion_front', 'creep_lattice', 'avalanche_field', 'jammed_pack', 'freeze_skin'] },
  { label: 'Pulse', ids: ['ripple_ring', 'shockwave', 'pulse_shell', 'pulse_breathing', 'beacon', 'breathing', 'wave', 'arc_wave', 'nova', 'echo_ring', 'flare'] },
  { label: 'Transform', ids: ['morph', 'fold', 'collapse_fracture', 'mirror_fold', 'shear', 'spokes', 'uniform', 'gaussian', 'brownian', 'gravity', 'spring', 'explosion', 'linear', 'aux', 'crawl_seep', 'attractor', 'swirl', 'vortex', 'ribbon', 'fanout', 'zigzag', 'harmonic', 'moebius', 'ribbon_veil', 'mist_ribbon', 'seep_fracture', 'ember_swarm', 'bloom_torrent', 'orbit_fracture', 'signal_braid', 'bloom_spores', 'pollen_storm', 'drift_glyph_dust', 'fracture_bloom', 'ember_drift', 'glyph_weave', 'fracture_grammar', 'melt_front', 'evaporative_sheet'] },
];

export const MOTION_GROUP_INDEX: Record<MotionGroupName, number> = {
  Fluid: 0,
  Chaos: 1,
  Orbit: 2,
  Pattern: 3,
  Structure: 4,
  Pulse: 5,
  Transform: 6,
};

const MOTION_CATEGORY_MAP = new Map<Layer2Type, MotionGroupName>();
for (const group of MOTION_GROUPS) for (const id of group.ids) MOTION_CATEGORY_MAP.set(id, group.label);

const MOTION_NUMERIC_GROUP_MAP = new Map<number, MotionGroupName>();
for (const [key, value] of Object.entries(MOTION_MAP)) {
  const category = MOTION_CATEGORY_MAP.get(key as Layer2Type);
  if (category) MOTION_NUMERIC_GROUP_MAP.set(value, category);
}

export function getMotionGroupName(motion: Layer2Type): MotionGroupName {
  return MOTION_CATEGORY_MAP.get(motion) ?? 'Transform';
}

export function getMotionGroupNameByValue(motionType: number): MotionGroupName {
  return MOTION_NUMERIC_GROUP_MAP.get(motionType) ?? 'Transform';
}

export function getMotionGroupIndexByValue(motionType: number) {
  return MOTION_GROUP_INDEX[getMotionGroupNameByValue(motionType)];
}

export function buildMotionFamilyGlsl() {
  // ANGLE Metal expression-complexity fix (2026-11-13): emit at most 10
  // checks per if statement. The largest group previously produced a single
  // if with 66 '||' terms. Checks stay in the original group/id order, so
  // first-match semantics are unchanged.
  const CHECKS_PER_IF = 10;
  const branches = MOTION_GROUPS.flatMap((group) => {
    const checks = group.ids.map((id) => {
      const value = MOTION_MAP[id];
      return `abs(motionType - ${value.toFixed(1)}) < 0.5`;
    });
    const lines: string[] = [];
    for (let i = 0; i < checks.length; i += CHECKS_PER_IF) {
      const chunk = checks.slice(i, i + CHECKS_PER_IF).join(' || ');
      lines.push(`    if (${chunk}) return ${MOTION_GROUP_INDEX[group.label].toFixed(1)};`);
    }
    return lines;
  }).join('\n');

  return `\n  float getMotionFamily(float motionType) {\n${branches}\n    return ${MOTION_GROUP_INDEX.Transform.toFixed(1)};\n  }\n`;
}
