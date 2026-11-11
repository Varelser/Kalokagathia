import type { Layer2Type } from '../types';

export type ProceduralSystemId =
  | 'membrane'
  | 'surface-shell'
  | 'surface-patch'
  | 'brush-surface'
  | 'fiber-field'
  | 'growth-field'
  | 'deposition-field'
  | 'reaction-diffusion'
  | 'volume-fog'
  | 'crystal-aggregate'
  | 'voxel-lattice'
  | 'crystal-deposition'
  | 'erosion-trail'
  | 'physarum'
  | 'dla'
  | 'l-system'
  | 'raymarch';

export const PROCEDURAL_SYSTEM_MODE_IDS: Record<ProceduralSystemId, readonly Layer2Type[]> = {
  membrane: ['sheet', 'cloth_membrane', 'elastic_sheet', 'viscoelastic_membrane'],
  'surface-shell': ['surface_shell', 'aura_shell', 'halo_bloom', 'mirror_skin', 'membrane_pollen', 'spore_halo', 'calcified_skin', 'residue_skin', 'shell_script', 'eclipse_halo', 'resin_shell', 'freeze_skin'],
  'surface-patch': ['surface_patch', 'contour_echo', 'echo_rings', 'standing_interference', 'tremor_lattice'],
  'brush-surface': ['brush_surface', 'vortex_sheet', 'ribbon_veil', 'liquid_smear', 'mist_ribbon', 'viscous_flow', 'advection_flow', 'melt_front', 'evaporative_sheet'],
  'fiber-field': ['fiber_field', 'mesh_weave', 'plasma_thread', 'branch_propagation', 'static_lace', 'nerve_web', 'signal_braid', 'cinder_web', 'spectral_mesh', 'ember_lace', 'aurora_threads', 'prism_threads', 'glyph_weave'],
  'growth-field': ['growth_field', 'fracture_grammar', 'growth_grammar'],
  'deposition-field': ['deposition_field', 'stipple_field', 'ink_bleed', 'seep_fracture', 'drift_glyph_dust', 'capillary_sheet', 'percolation_sheet'],
  'reaction-diffusion': ['reaction_diffusion', 'biofilm_skin', 'cellular_front', 'corrosion_front'],
  'volume-fog': ['volume_fog', 'dust_plume', 'ashfall', 'vapor_canopy', 'ember_swarm', 'soot_veil', 'foam_drift', 'charge_veil', 'prism_smoke', 'rune_smoke', 'mirage_smoke', 'ion_rain', 'velvet_ash', 'static_smoke', 'ember_drift', 'vortex_transport', 'pressure_cells', 'condense_field', 'sublimate_cloud'],
  'crystal-aggregate': ['crystal_aggregate', 'shard_debris', 'fracture_pollen', 'bloom_spores', 'pollen_storm', 'orbit_fracture', 'fracture_bloom', 'granular_fall', 'sediment_stack', 'talus_heap', 'avalanche_field', 'jammed_pack'],
  'voxel-lattice': ['voxel_lattice', 'skin_lattice', 'frost_lattice', 'pollen_lattice', 'lattice_surge', 'elastic_lattice', 'creep_lattice'],
  'crystal-deposition': ['crystal_deposition'],
  'erosion-trail': ['erosion_trail'],
  physarum: ['physarum'],
  dla: ['dla'],
  'l-system': ['l-system'],
  raymarch: ['raymarch'],
};

export const PROCEDURAL_FEATURE_TAGS: Partial<Record<Layer2Type, string>> = {
  sheet: 'membrane',
  cloth_membrane: 'membrane',
  elastic_sheet: 'membrane',
  viscoelastic_membrane: 'membrane',
  surface_shell: 'surface-shell',
  aura_shell: 'surface-shell',
  halo_bloom: 'surface-shell',
  mirror_skin: 'surface-shell',
  membrane_pollen: 'surface-shell',
  spore_halo: 'surface-shell',
  calcified_skin: 'surface-shell',
  residue_skin: 'surface-shell',
  shell_script: 'surface-shell',
  eclipse_halo: 'surface-shell',
  resin_shell: 'surface-shell',
  surface_patch: 'surface-patch',
  contour_echo: 'surface-patch',
  echo_rings: 'surface-patch',
  standing_interference: 'surface-patch',
  tremor_lattice: 'surface-patch',
  brush_surface: 'brush-surface',
  vortex_sheet: 'brush-surface',
  ribbon_veil: 'brush-surface',
  liquid_smear: 'brush-surface',
  mist_ribbon: 'brush-surface',
  viscous_flow: 'brush-surface',
  melt_front: 'brush-surface',
  evaporative_sheet: 'brush-surface',
  fiber_field: 'fiber-field',
  mesh_weave: 'fiber-field',
  plasma_thread: 'fiber-field',
  branch_propagation: 'fiber-field',
  static_lace: 'fiber-field',
  nerve_web: 'fiber-field',
  signal_braid: 'fiber-field',
  cinder_web: 'fiber-field',
  spectral_mesh: 'fiber-field',
  ember_lace: 'fiber-field',
  aurora_threads: 'fiber-field',
  prism_threads: 'fiber-field',
  glyph_weave: 'fiber-field',
  growth_field: 'growth-field',
  fracture_grammar: 'growth-field',
  growth_grammar: 'growth-field',
  deposition_field: 'deposition-field',
  capillary_sheet: 'deposition-field',
  percolation_sheet: 'deposition-field',
  stipple_field: 'deposition-field',
  ink_bleed: 'deposition-field',
  seep_fracture: 'deposition-field',
  drift_glyph_dust: 'deposition-field',
  reaction_diffusion: 'reaction-diffusion',
  physarum: 'physarum',
  dla: 'dla',
  'l-system': 'l-system',
  raymarch: 'raymarch',
  cellular_front: 'reaction-diffusion',
  corrosion_front: 'reaction-diffusion',
  biofilm_skin: 'reaction-diffusion',
  volume_fog: 'volume-fog',
  dust_plume: 'volume-fog',
  ashfall: 'volume-fog',
  vapor_canopy: 'volume-fog',
  ember_swarm: 'volume-fog',
  soot_veil: 'volume-fog',
  foam_drift: 'volume-fog',
  charge_veil: 'volume-fog',
  prism_smoke: 'volume-fog',
  rune_smoke: 'volume-fog',
  mirage_smoke: 'volume-fog',
  ion_rain: 'volume-fog',
  velvet_ash: 'volume-fog',
  static_smoke: 'volume-fog',
  ember_drift: 'volume-fog',
  crystal_aggregate: 'crystal-aggregate',
  shard_debris: 'crystal-aggregate',
  fracture_pollen: 'crystal-aggregate',
  bloom_spores: 'crystal-aggregate',
  pollen_storm: 'crystal-aggregate',
  orbit_fracture: 'crystal-aggregate',
  fracture_bloom: 'crystal-aggregate',
  granular_fall: 'crystal-aggregate',
  sediment_stack: 'crystal-aggregate',
  talus_heap: 'crystal-aggregate',
  voxel_lattice: 'voxel-lattice',
  skin_lattice: 'voxel-lattice',
  frost_lattice: 'voxel-lattice',
  pollen_lattice: 'voxel-lattice',
  lattice_surge: 'voxel-lattice',
  elastic_lattice: 'voxel-lattice',
  creep_lattice: 'voxel-lattice',
  advection_flow: 'brush-surface',
  vortex_transport: 'volume-fog',
  pressure_cells: 'volume-fog',
  condense_field: 'volume-fog',
  sublimate_cloud: 'volume-fog',
  freeze_skin: 'surface-shell',
  avalanche_field: 'crystal-aggregate',
  jammed_pack: 'crystal-aggregate',
  crystal_deposition: 'crystal-deposition',
  erosion_trail: 'erosion-trail',
};

const PROCEDURAL_SYSTEM_SETS = Object.fromEntries(
  Object.entries(PROCEDURAL_SYSTEM_MODE_IDS).map(([system, ids]) => [system, new Set(ids)]),
) as Record<ProceduralSystemId, Set<Layer2Type>>;

export function isModeInProceduralSystem(mode: Layer2Type, system: ProceduralSystemId) {
  return PROCEDURAL_SYSTEM_SETS[system].has(mode);
}

export function getProceduralSystemId(mode: Layer2Type): ProceduralSystemId | null {
  for (const [system, ids] of Object.entries(PROCEDURAL_SYSTEM_MODE_IDS) as [ProceduralSystemId, readonly Layer2Type[]][]) {
    if (ids.includes(mode)) {
      return system;
    }
  }
  return null;
}

export function getProceduralFeatureTag(mode: Layer2Type) {
  return PROCEDURAL_FEATURE_TAGS[mode] ?? null;
}
