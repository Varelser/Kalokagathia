import { TARGET_GEOMETRY_FAMILIES, TARGET_PHYSICAL_FAMILIES, TARGET_TEMPORAL_FAMILIES } from './productPackSubfamilies';

export type CoverageProfile = {
  depictionMethods: string[];
  motionFamilies: string[];
  computeBackends: string[];
  sourceFamilies: string[];
  renderFamilies: string[];
  postFamilies: string[];
  solverFamilies: string[];
  specialistFamilies: string[];
  physicalFamilies: string[];
  geometryFamilies: string[];
  temporalFamilies: string[];
  gpgpuFeatures: string[];
  gapTargets: string[];
};

export const TARGET_SOURCE_FAMILIES = [
  'radial-primitives',
  'box-volume',
  'curve-solids',
  'planar-field',
  'image-map',
  'video-map',
  'text-glyph',
  'random-scatter',
  'shell-volume',
  'audio-control',
  'curve-path',
  'surface-map',
  'brush-field',
  'glyph-mask',
] as const;

export const TARGET_RENDER_FAMILIES = [
  'point-sprite',
  'linework',
  'surface-mesh',
  'instanced-solids',
  'volumetric-slices',
  'connections',
  'ghost-trails',
  'glyph-outline',
  'aux-particles',
  'spark-emission',
  'sdf-lighting',
  'instanced-geometry',
  'halftone-material',
  'mapped-surface',
  'brush-sheet',
  'path-lines',
  'curve-ribbons',
  'instanced-object-swarm',
  'gpu-trails',
  'gpu-ribbons',
  'gpu-tubes',
  'gpu-smooth-tubes',
  'gpu-metaballs',
  'gpu-volumetric',
] as const;

export const TARGET_POST_FAMILIES = [
  'scanlines',
  'screen-noise',
  'vignette',
  'pulse-flash',
  'impact-flash',
  'burst-drive',
  'interference',
  'screen-sweep',
  'depth-fog',
  'bloom',
  'chromatic-aberration',
  'depth-of-field',
  'noise-grain',
  'vignette-darken',
  'brightness-contrast',
  'contact-fx',
  'sdf-shading',
  'kaleidoscope-fold',
  'slit-scan',
  'feedback-echo',
  'retro-crt',
  'channel-split',
] as const;

export const TARGET_COMPUTE_BACKENDS = [
  'cpu-particle-layers',
  'procedural-geometry',
  'instanced-mesh-pipeline',
  'media-map-sampler',
  'feedback-buffer',
  'webgl-gpgpu',
  'webgpu-compute',
] as const;

export const TARGET_MOTION_FAMILIES = [
  'particles',
  'fluid',
  'vortex',
  'chaos',
  'field',
  'elastic',
  'magnetic',
  'collision',
  'volumetric',
  'n-body',
  'swarm',
  'growth',
  'deposition',
  'structure',
  'oscillation',
  'transform',
  'orbit',
] as const;

export const TARGET_SOLVER_FAMILIES = [
  'operator-graph',
  'system-emitter',
  'simulation-zone',
  'gpu-vfx-graph',
  'volumetric-solver',
  'pbd-solver',
  'mpm-material',
  'destruction-fracture',
  'signal-image-field',
  'task-graph',
] as const;

/**
 * Honesty note (roadmap 8E): these three "solver" families are
 * look-classifications, not literal solvers. They are resolved in
 * depictionCoverageFamilyResolvers.ts from shader modes —
 * pbd-solver from cloth/elastic/granular modes, mpm-material from
 * sediment/viscous/melt modes, destruction-fracture from fracture
 * modes. There is no position-based-dynamics constraint solver, no
 * material-point simulation, and no destruction physics in the
 * engine; the names describe the *appearance* a config evokes.
 * UI surfaces should present them as shader emulations.
 */
export const SHADER_EMULATED_SOLVER_FAMILIES = [
  'pbd-solver',
  'mpm-material',
  'destruction-fracture',
] as const;

export const TARGET_SPECIALIST_FAMILIES = [
  'touch-feedback-topology',
  'touch-pop-force-cloud',
  'touch-curve-relief-feedback',
  'touch-top-cop-signal-field',
  'trapcode-particular-noir',
  'trapcode-particular-audio-sparks',
  'trapcode-form-lattice',
  'trapcode-form-sdf-swarm',
  'universe-retro-feedback',
  'universe-broadcast-ghost',
  'hybrid-audio-operator-stack',
  'hybrid-pdg-variant-sweep',
  'hybrid-contact-sdf-scatter',
  'houdini-pyro-vortex-column',
  'houdini-vellum-granular-drape',
  'houdini-growth-arbor',
  'houdini-mpm-slurry-stack',
  'houdini-destruction-fracture-debris',
  'houdini-shell-metaball-volume',
  'niagara-stateless-orbit-mesh',
  'niagara-collision-burst-field',
  'niagara-chaos-magnetic-tubes',
  'geometrynodes-simulation-lattice',
  'geometrynodes-reaction-growth-plate',
  'unity-vfx-gpu-sheet',
] as const;
export const TARGET_PHYSICAL_SUBFAMILIES = [...TARGET_PHYSICAL_FAMILIES] as const;

export const TARGET_GEOMETRY_SUBFAMILIES = [...TARGET_GEOMETRY_FAMILIES] as const;

export const TARGET_TEMPORAL_SUBFAMILIES = [...TARGET_TEMPORAL_FAMILIES] as const;


export const COVERAGE_TARGETS = {
  sourceFamilies: [...TARGET_SOURCE_FAMILIES],
  renderFamilies: [...TARGET_RENDER_FAMILIES],
  postFamilies: [...TARGET_POST_FAMILIES],
  computeBackends: [...TARGET_COMPUTE_BACKENDS],
  motionFamilies: [...TARGET_MOTION_FAMILIES],
  solverFamilies: [...TARGET_SOLVER_FAMILIES],
  specialistFamilies: [...TARGET_SPECIALIST_FAMILIES],
  physicalFamilies: [...TARGET_PHYSICAL_SUBFAMILIES],
  geometryFamilies: [...TARGET_GEOMETRY_SUBFAMILIES],
  temporalFamilies: [...TARGET_TEMPORAL_SUBFAMILIES],
} as const;
