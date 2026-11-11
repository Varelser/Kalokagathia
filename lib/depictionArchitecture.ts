import type { Layer2Type, Layer3Source } from '../types';
import { getMotionArchitecture } from './motionArchitecture';

export type DepictionClass =
  | 'point-cloud'
  | 'line-field'
  | 'surface'
  | 'shell'
  | 'brush-sheet'
  | 'aggregate'
  | 'voxel'
  | 'volumetric'
  | 'ribbon'
  | 'debris'
  | 'stipple'
  | 'mesh'
  | 'halo';

export interface DepictionArchitecture {
  depictionClass: DepictionClass;
  renderPrimitive: 'points' | 'lines' | 'surface mesh' | 'instanced solids' | 'fog slices';
  editBias: 'particles' | 'structure' | 'hybrid';
  spatialSignature: string;
  shapingFocus: string[];
  bestSources: Layer3Source[];
  contrastAxis: string;
}

function depiction(
  depictionClass: DepictionClass,
  renderPrimitive: DepictionArchitecture['renderPrimitive'],
  editBias: DepictionArchitecture['editBias'],
  spatialSignature: string,
  shapingFocus: string[],
  bestSources: Layer3Source[],
  contrastAxis: string,
): DepictionArchitecture {
  return { depictionClass, renderPrimitive, editBias, spatialSignature, shapingFocus, bestSources, contrastAxis };
}

const PROCEDURAL_DEPICTIONS: Partial<Record<Layer2Type, DepictionArchitecture>> = {
  sheet: depiction('surface', 'surface mesh', 'structure', 'continuous membrane', ['fresnel rim', 'wireframe density', 'surface continuity'], ['plane', 'grid', 'text'], 'flat sheet ↔ volumetric membrane'),
  cloth_membrane: depiction('surface', 'surface mesh', 'structure', 'draped cloth membrane', ['drape sag', 'fold amplitude', 'wind ripple'], ['plane', 'text', 'cylinder'], 'taut membrane ↔ hanging cloth'),
  surface_shell: depiction('shell', 'surface mesh', 'structure', 'convex outer hull', ['hull opacity', 'fresnel edge', 'shell continuity'], ['sphere', 'cube'], 'smooth hull ↔ faceted shell'),
  surface_patch: depiction('surface', 'surface mesh', 'structure', 'segmented patches', ['panel seams', 'patch relaxation', 'tile continuity'], ['plane', 'text'], 'continuous skin ↔ broken panel field'),
  brush_surface: depiction('brush-sheet', 'surface mesh', 'hybrid', 'painted sheet volume', ['layered brush jitter', 'sheet overlap', 'directional smear'], ['plane', 'image', 'text'], 'graphic paint ↔ soft membrane'),
  viscous_flow: depiction('brush-sheet', 'surface mesh', 'hybrid', 'viscous pooled flow sheet', ['drag pooling', 'edge bleed', 'surface drag'], ['plane', 'image', 'video'], 'thin smear ↔ heavy viscous flow'),
  fiber_field: depiction('line-field', 'lines', 'structure', 'bundled strands', ['strand density', 'curl bias', 'bundle length'], ['cylinder', 'sphere'], 'organized fibers ↔ noisy threads'),
  growth_field: depiction('line-field', 'lines', 'structure', 'branching propagation scaffold', ['trunk lift', 'twig rate', 'tip glow'], ['sphere', 'plane'], 'rooted scaffold ↔ fine arbor propagation'),
  fracture_grammar: depiction('line-field', 'lines', 'structure', 'angular fracture grammar scaffold', ['crack gating', 'plate bias', 'shatter branching'], ['plane', 'text', 'grid'], 'continuous arbor ↔ brittle fracture syntax'),
  growth_grammar: depiction('line-field', 'lines', 'structure', 'rule-driven growth grammar scaffold', ['grammar depth', 'tip recursion', 'branch cadence'], ['sphere', 'plane', 'text'], 'single branch field ↔ recursive growth script'),
  elastic_sheet: depiction('surface', 'surface mesh', 'structure', 'tensioned elastic rebound sheet', ['rebound tension', 'surface snap', 'edge sag'], ['plane', 'cylinder', 'text'], 'draped cloth ↔ elastic rebound sheet'),
  capillary_sheet: depiction('stipple', 'surface mesh', 'hybrid', 'wicking capillary receiving sheet', ['wick lift', 'band soak', 'matte absorption'], ['text', 'image', 'plane'], 'ink bleed ↔ capillary wicking sheet'),
  sediment_stack: depiction('aggregate', 'instanced solids', 'structure', 'layered sediment stack body', ['strata compression', 'slip planes', 'pile lamination'], ['plane', 'sphere', 'grid'], 'granular fall ↔ layered sediment stack'),
  cellular_front: depiction('surface', 'surface mesh', 'structure', 'advancing cellular automata front', ['front edge', 'cell split', 'edge branching'], ['grid', 'text', 'plane'], 'reaction diffusion ↔ advancing cellular front'),
  elastic_lattice: depiction('voxel', 'instanced solids', 'structure', 'tensioned elastic lattice scaffold', ['span tension', 'snap recoil', 'beam flex'], ['grid', 'cube', 'cylinder'], 'rigid lattice ↔ elastic scaffold'),
  deposition_field: depiction('surface', 'surface mesh', 'structure', 'layered relief field', ['relief depth', 'erosion cut', 'band count'], ['plane', 'image'], 'flat deposit ↔ eroded terrain'),
  crystal_aggregate: depiction('aggregate', 'instanced solids', 'structure', 'clustered crystal bodies', ['shard scale', 'cluster spread', 'facet density'], ['sphere', 'cube'], 'tight crystal mass ↔ dispersed shards'),
  granular_fall: depiction('debris', 'instanced solids', 'hybrid', 'grain-like falling particulate body', ['grain scale', 'fall bias', 'pile spread'], ['sphere', 'plane', 'video'], 'coherent aggregate ↔ loose granular fall'),
  erosion_trail: depiction('line-field', 'lines', 'structure', 'dragged residue lines', ['trail length', 'drift amount', 'segment taper'], ['plane', 'text'], 'graphic trails ↔ sediment drift'),
  voxel_lattice: depiction('voxel', 'instanced solids', 'structure', 'cellular lattice volume', ['cell scale', 'void ratio', 'structural rhythm'], ['cube', 'plane'], 'solid scaffold ↔ porous lattice'),
  crystal_deposition: depiction('aggregate', 'instanced solids', 'structure', 'deposited crystal shell', ['growth bias', 'shell packing', 'crystal relief'], ['plane', 'image'], 'surface crust ↔ crystal bloom'),
  reaction_diffusion: depiction('surface', 'surface mesh', 'structure', 'chemical membrane', ['feed-kill balance', 'reaction scale', 'warp amount'], ['plane', 'text'], 'smooth membrane ↔ spotted reaction plate'),
  volume_fog: depiction('volumetric', 'fog slices', 'structure', 'soft atmospheric volume', ['slice depth', 'density core', 'drift field'], ['sphere', 'cube'], 'even haze ↔ shaped cloud body'),
  orbit_swarm: depiction('point-cloud', 'points', 'particles', 'orbital point cluster', ['swarm radius', 'orbit coherence', 'trail pulse'], ['sphere', 'ring'], 'disciplined orbit ↔ noisy swarm'),
  braid_stream: depiction('line-field', 'lines', 'hybrid', 'braided flow ribbons', ['strand count', 'crossing cadence', 'weave tension'], ['cylinder', 'ring'], 'clean braid ↔ turbulent stream'),
  pulse_breathing: depiction('point-cloud', 'points', 'particles', 'breathing pulse cloud', ['pulse amplitude', 'center compression', 'release timing'], ['sphere', 'center'], 'slow inhale ↔ sharp pulse'),
  collapse_fracture: depiction('point-cloud', 'points', 'particles', 'imploding fracture field', ['collapse center', 'crack spread', 'debris echo'], ['sphere', 'cube'], 'radial collapse ↔ broken rupture'),
  crawl_seep: depiction('point-cloud', 'points', 'particles', 'seeping crawl field', ['edge creep', 'surface cling', 'flow persistence'], ['plane', 'image'], 'slow seep ↔ fast crawl'),
  interference_wave: depiction('point-cloud', 'points', 'particles', 'interference node cloud', ['wave overlap', 'ring contrast', 'node spacing'], ['ring', 'plane'], 'smooth banding ↔ hard standing nodes'),
  ribbon_veil: depiction('ribbon', 'surface mesh', 'hybrid', 'thin flowing ribbon veil', ['veil taper', 'layer offset', 'twist softness'], ['plane', 'text', 'ring'], 'sheet-like veil ↔ suspended calligraphic ribbon'),
  shard_debris: depiction('debris', 'instanced solids', 'structure', 'fragment debris plume', ['shard elongation', 'burst spread', 'rotation chaos'], ['sphere', 'cube'], 'tight fragments ↔ scattered debris'),
  stipple_field: depiction('stipple', 'points', 'hybrid', 'dotted relief field', ['dot density', 'stipple erosion', 'band logic'], ['plane', 'image', 'text'], 'inked stipple ↔ dense particulate field'),
  aura_shell: depiction('shell', 'surface mesh', 'structure', 'diffuse luminous reliquary shell', ['aura bloom', 'rim softness', 'shell inflation'], ['sphere', 'ring'], 'calm aura ↔ rigid shell'),
  liquid_smear: depiction('brush-sheet', 'surface mesh', 'hybrid', 'liquid smeared sheet', ['drag direction', 'bleed pooling', 'sheet layering'], ['plane', 'image'], 'graphic smear ↔ pooled fluid paint'),
  mesh_weave: depiction('mesh', 'lines', 'structure', 'woven line mesh', ['weave spacing', 'cross tension', 'strand rhythm'], ['cylinder', 'grid'], 'ordered weave ↔ tangled network'),
  halo_bloom: depiction('halo', 'surface mesh', 'structure', 'compressed equinox halo shell', ['equator bloom', 'center dimming', 'outer rim charge'], ['ring', 'sphere'], 'thin ring halo ↔ compressed bloom disk'),
  dust_plume: depiction('volumetric', 'fog slices', 'structure', 'dusty convective plume', ['column lift', 'mote density', 'matte desaturation'], ['sphere', 'video'], 'soft haze ↔ rising dust column'),
  ink_bleed: depiction('surface', 'surface mesh', 'hybrid', 'soot-fed palimpsest receiving sheet', ['bleed perimeter', 'soot staining', 'capillary lift'], ['plane', 'text', 'image'], 'crisp mark ↔ smoke-fed flooded manuscript'),
  contour_echo: depiction('surface', 'surface mesh', 'structure', 'stacked contour plate', ['plate flattening', 'contour cadence', 'echo lift'], ['plane', 'ring', 'text'], 'flat patch ↔ resonant topographic plate'),
  plasma_thread: depiction('line-field', 'lines', 'hybrid', 'charged plasma strands', ['thread glow', 'curl tension', 'spark spacing'], ['cylinder', 'ring'], 'clean filaments ↔ electrical braid'),
  ashfall: depiction('volumetric', 'fog slices', 'hybrid', 'downward ash curtain', ['gravity streaks', 'grain load', 'ledger-like falloff'], ['plane', 'video'], 'calm haze ↔ ash ledger curtain'),
  echo_rings: depiction('surface', 'surface mesh', 'structure', 'ringed echo membrane', ['ring contrast', 'spacing logic', 'edge attenuation'], ['ring', 'plane'], 'broad waves ↔ tightly stacked rings'),
  skin_lattice: depiction('voxel', 'instanced solids', 'structure', 'skin-like voxel shell', ['cell packing', 'shell thickness', 'lattice relief'], ['sphere', 'cube'], 'soft skin ↔ rigid scaffold'),
  mist_ribbon: depiction('ribbon', 'surface mesh', 'hybrid', 'mist-loaded ribbon', ['veil softness', 'ribbon width', 'fade overlap'], ['plane', 'video'], 'graphic ribbon ↔ vapor veil'),
  flock_drift: depiction('point-cloud', 'points', 'particles', 'drifting flock cloud', ['cohesion', 'scatter drift', 'flow direction'], ['sphere', 'video'], 'cohesive swarm ↔ dispersed flock'),
  vortex_sheet: depiction('surface', 'surface mesh', 'hybrid', 'rotating vortex sheet', ['sheet spin', 'spiral tension', 'surface drag'], ['disc', 'ring'], 'stable sheet ↔ vortex membrane'),
  branch_propagation: depiction('line-field', 'lines', 'structure', 'propagating branch web', ['armature depth', 'spread bias', 'twig density'], ['sphere', 'text'], 'controlled arbor ↔ tangled propagation'),
  seep_fracture: depiction('surface', 'surface mesh', 'hybrid', 'seeping fracture plate', ['crack depth', 'bleed into seams', 'plate displacement'], ['plane', 'image'], 'clean relief ↔ seeped fracture'),
  standing_interference: depiction('surface', 'surface mesh', 'hybrid', 'standing band membrane', ['band resonance', 'node spacing', 'warp amplitude'], ['ring', 'plane'], 'soft oscillation ↔ hard interference grid'),
  ember_swarm: depiction('debris', 'instanced solids', 'hybrid', 'ember shard volume', ['ember lift', 'spark density', 'heat bloom'], ['sphere', 'video'], 'soft embers ↔ sharp debris'),
  ember_drift: depiction('volumetric', 'fog slices', 'hybrid', 'ember-loaded atmospheric drift', ['ember density', 'vertical bias', 'pulse noise'], ['sphere', 'video', 'ring'], 'calm haze ↔ ember-loaded drift'),
  biofilm_skin: depiction('surface', 'surface mesh', 'structure', 'living biofilm skin', ['colony pooling', 'cellular bands', 'reaction creep'], ['plane', 'image'], 'sterile membrane ↔ living surface colony'),
  static_lace: depiction('mesh', 'lines', 'structure', 'quantized static lace grid', ['grid quantization', 'lace frequency', 'signal breakups'], ['text', 'grid'], 'clean lace ↔ quantized static signal fabric'),
  vapor_canopy: depiction('volumetric', 'fog slices', 'structure', 'canopy-like vapor cap', ['top bias', 'broad scale', 'soft ceiling'], ['plane', 'cube'], 'floating canopy ↔ centered cloud'),
  fracture_pollen: depiction('debris', 'instanced solids', 'hybrid', 'pollen fracture scatter', ['particle scale', 'break density', 'dust edge'], ['image', 'plane'], 'soft pollen ↔ broken shards'),
  tremor_lattice: depiction('surface', 'surface mesh', 'hybrid', 'tremoring lattice plate', ['lattice pulse', 'plate tension', 'tremor amplitude'], ['plane', 'grid'], 'stable panel ↔ vibrating grid'),
  bloom_torrent: depiction('point-cloud', 'points', 'particles', 'blooming torrent spray', ['outward burst', 'particle drag', 'stream density'], ['sphere', 'video'], 'gentle bloom ↔ fast torrent'),
  orbit_fracture: depiction('debris', 'instanced solids', 'hybrid', 'orbital fragment field', ['ring scatter', 'fragment orbit', 'shatter pacing'], ['ring', 'sphere'], 'clean orbit ↔ fractured ring'),
  foam_drift: depiction('volumetric', 'fog slices', 'hybrid', 'foamy atmospheric drift', ['bubble softness', 'lift amount', 'slice fullness'], ['video', 'sphere'], 'misty cloud ↔ foamy drift'),
  signal_braid: depiction('line-field', 'lines', 'hybrid', 'pulse-gated braided signal threads', ['braid crossings', 'signal cadence', 'gate glow'], ['cylinder', 'text'], 'clean weave ↔ pulse-gated signal braid'),
  soot_veil: depiction('volumetric', 'fog slices', 'hybrid', 'ledger-banded matte soot veil', ['grain load', 'ledger stratification', 'char veil drift'], ['plane', 'image'], 'bright fog ↔ charred soot ledger'),
  nerve_web: depiction('line-field', 'lines', 'hybrid', 'neural web strands', ['branching knots', 'tension lines', 'bundle clustering'], ['sphere', 'image'], 'ordered fibers ↔ living nerve web'),
  bloom_spores: depiction('debris', 'instanced solids', 'hybrid', 'spore bloom scatter', ['spore spread', 'cluster spacing', 'halo dust'], ['sphere', 'video'], 'tight spores ↔ broad bloom'),
  mirror_skin: depiction('shell', 'surface mesh', 'hybrid', 'flattened reflective shell', ['mirror stretch', 'scan bands', 'controlled rim'], ['sphere', 'cube'], 'curved shell ↔ mirrored plate'),
  pollen_storm: depiction('debris', 'instanced solids', 'hybrid', 'storm of pollen shards', ['storm spread', 'particle count', 'gust rhythm'], ['video', 'sphere'], 'quiet spores ↔ violent pollen storm'),
  charge_veil: depiction('volumetric', 'fog slices', 'hybrid', 'electrified charge curtain', ['vertical streaks', 'anisotropic lift', 'electric glow'], ['video', 'text'], 'soft smoke ↔ charged veil'),
  cinder_web: depiction('mesh', 'lines', 'hybrid', 'charred cinder web mesh', ['ember seams', 'web looseness', 'char breakup'], ['grid', 'text'], 'cold mesh ↔ charred ember web'),
  membrane_pollen: depiction('shell', 'surface mesh', 'hybrid', 'porous membrane herbarium shell', ['pore breakup', 'pollen pockets', 'membrane sealing'], ['sphere', 'image'], 'sealed membrane ↔ porous pollen herbarium'),
  drift_glyph_dust: depiction('stipple', 'surface mesh', 'hybrid', 'drifting glyph residue field', ['glyph breakup', 'dust advection', 'cluster fade'], ['text', 'plane'], 'legible script ↔ drifting residue'),
  prism_smoke: depiction('volumetric', 'fog slices', 'hybrid', 'chromatic prism smoke', ['sheared slices', 'glow bloom', 'spectral drift'], ['video', 'ring'], 'neutral fog ↔ prism flare smoke'),
  spectral_mesh: depiction('mesh', 'lines', 'hybrid', 'prismatic spectral woven mesh', ['line glow', 'weave spacing', 'phase drift'], ['cylinder', 'ring'], 'solid weave ↔ prismatic spectral mesh'),
  ember_lace: depiction('mesh', 'lines', 'hybrid', 'ember lace structure', ['lace density', 'ember highlights', 'mesh fragility'], ['text', 'grid'], 'quiet lace ↔ heated net'),
  spore_halo: depiction('halo', 'surface mesh', 'hybrid', 'grain halo with suspended spores', ['rim bloom', 'spore grain', 'outer halo drift'], ['ring', 'sphere'], 'clean halo ↔ suspended spore halo'),
  calcified_skin: depiction('shell', 'surface mesh', 'hybrid', 'calcified faceted skin', ['facet quantization', 'wire exposure', 'rigid shell'], ['sphere', 'cube'], 'soft shell ↔ calcified crust'),
  rune_smoke: depiction('volumetric', 'fog slices', 'hybrid', 'glyph-gated rune smoke body', ['rune gating', 'symbol pulse', 'inscribed drift'], ['text', 'plane'], 'plain smoke ↔ coded inscribed fog'),
  aurora_threads: depiction('mesh', 'lines', 'hybrid', 'aurora-like thread mesh', ['thread glow', 'curtain wave', 'woven drift'], ['ring', 'cylinder'], 'tight weave ↔ flowing aurora'),
  residue_skin: depiction('shell', 'surface mesh', 'hybrid', 'residual sediment shell', ['downward droop', 'surface residue', 'broken wire'], ['cube', 'image'], 'clean shell ↔ leftover crust'),
  sigil_dust: depiction('stipple', 'surface mesh', 'hybrid', 'sigil-coded particulate plate', ['sigil density', 'dot grid quantization', 'relief incision'], ['text', 'image'], 'neutral dust ↔ encoded ritual plate'),
  frost_lattice: depiction('voxel', 'instanced solids', 'structure', 'frosted lattice crust', ['cell sharpness', 'void spacing', 'crystal edge'], ['cube', 'plane'], 'warm scaffold ↔ icy lattice'),
  mirage_smoke: depiction('volumetric', 'fog slices', 'hybrid', 'heat-haze mirage smoke', ['optical shimmer', 'refraction bands', 'horizon swell'], ['video', 'sphere'], 'stable fog ↔ heat-mirage distortion'),
  ion_rain: depiction('volumetric', 'fog slices', 'hybrid', 'downward ion streak field', ['rain streaks', 'electrical edge', 'compressed scale'], ['video', 'text'], 'cloud body ↔ falling ion veil'),
  velvet_ash: depiction('volumetric', 'fog slices', 'hybrid', 'dense velvet ash receiving cloud', ['matte density', 'velvet core', 'slow soot shed'], ['plane', 'image'], 'airy smoke ↔ dense velvet soot mantle'),
  shell_script: depiction('shell', 'surface mesh', 'hybrid', 'inscribed manuscript shell', ['etch cadence', 'band scan', 'flattened shell silhouette'], ['text', 'grid'], 'plain shell ↔ encoded manuscript shell'),
  prism_threads: depiction('mesh', 'lines', 'hybrid', 'prism-sheared threads', ['thread split', 'phase shift', 'spectral spacing'], ['cylinder', 'video'], 'single weave ↔ prism thread bundle'),
  glyph_weave: depiction('mesh', 'lines', 'hybrid', 'glyph-coded woven threads', ['outline gating', 'weave quantization', 'trace drift'], ['text', 'grid'], 'free strands ↔ coded glyph weave'),
  pollen_lattice: depiction('voxel', 'instanced solids', 'hybrid', 'pollen-loaded lattice', ['cell fill', 'porous rhythm', 'dust packing'], ['image', 'plane'], 'open lattice ↔ pollen-packed scaffold'),
  lattice_surge: depiction('voxel', 'instanced solids', 'hybrid', 'surging lattice corridor', ['wave amplitude', 'cell stretch', 'charge spacing'], ['grid', 'video'], 'static scaffold ↔ charged lattice surge'),
  fracture_bloom: depiction('aggregate', 'instanced solids', 'hybrid', 'blooming fracture cluster', ['bloom radius', 'shard lift', 'fragment pulse'], ['sphere', 'ring'], 'tight fracture ↔ blooming mineral burst'),
  eclipse_halo: depiction('halo', 'surface mesh', 'hybrid', 'compressed eclipse reliquary disk', ['disk compression', 'umbra center', 'equator bloom ring'], ['ring', 'sphere'], 'open halo ↔ eclipsed disk shell'),
  static_smoke: depiction('volumetric', 'fog slices', 'hybrid', 'electronic static smoke slab', ['scan flicker', 'block noise', 'flat density'], ['video', 'grid'], 'organic smoke ↔ electronic static slab'),
  resin_shell: depiction('shell', 'surface mesh', 'hybrid', 'lacquered amber shell with pooled resin', ['lacquer sheen', 'flow sag', 'amber edge pooling'], ['image', 'sphere'], 'dry shell ↔ resin-lacquered amber coat'),

  viscoelastic_membrane: depiction('surface', 'surface mesh', 'structure', 'memory-loaded viscoelastic membrane', ['memory sag', 'rebound lag', 'wind damping'], ['plane', 'cylinder', 'text'], 'cloth drape ↔ springy viscoelastic skin'),
  percolation_sheet: depiction('stipple', 'surface mesh', 'hybrid', 'channeling percolation receiving sheet', ['wick channels', 'percolation paths', 'soak retention'], ['text', 'image', 'plane'], 'capillary soak ↔ channelized percolation plate'),
  talus_heap: depiction('aggregate', 'instanced solids', 'structure', 'slope-driven talus heap body', ['slope spread', 'fragment slip', 'heap layering'], ['plane', 'sphere', 'grid'], 'granular fall ↔ stable talus heap'),
  corrosion_front: depiction('surface', 'surface mesh', 'structure', 'etching corrosion front plate', ['etch contour', 'pit density', 'front crawl'], ['grid', 'text', 'plane'], 'cellular growth ↔ corrosive etch front'),
  creep_lattice: depiction('voxel', 'instanced solids', 'structure', 'slow-creeping lattice scaffold', ['beam creep', 'span sag', 'snap drag'], ['grid', 'cube', 'cylinder'], 'elastic rebound lattice ↔ slow creeping scaffold'),
  advection_flow: depiction('brush-sheet', 'surface mesh', 'hybrid', 'advected laminar flow sheet', ['directional shear', 'flow lanes', 'transport drag'], ['plane', 'image', 'video'], 'pooled viscous smear ↔ organized advected flow'),
  vortex_transport: depiction('volumetric', 'fog slices', 'hybrid', 'spiraling transport column', ['vortex lift', 'spiral conveyance', 'column drift'], ['sphere', 'video', 'ring'], 'gentle fog drift ↔ transported vortex column'),
  pressure_cells: depiction('volumetric', 'fog slices', 'structure', 'compressed pressure-cell fog field', ['cell compression', 'basin spacing', 'pulse fronts'], ['grid', 'plane', 'sphere'], 'soft haze ↔ compartmentalized pressure basins'),
  avalanche_field: depiction('debris', 'instanced solids', 'hybrid', 'slope-breaking avalanche debris field', ['slip cascade', 'runout spread', 'slope collapse'], ['plane', 'sphere', 'grid'], 'stable talus heap ↔ active avalanche field'),
  jammed_pack: depiction('aggregate', 'instanced solids', 'structure', 'jammed packed body with locked voids', ['packing lock', 'void ratio', 'rigid compression'], ['cube', 'plane', 'sphere'], 'loose debris ↔ tightly jammed packing'),
  melt_front: depiction('brush-sheet', 'surface mesh', 'hybrid', 'softening melt front with thermal bleed', ['front softening', 'drip shear', 'heat smear'], ['plane', 'image', 'text'], 'stable plate ↔ melting front sheet'),
  freeze_skin: depiction('shell', 'surface mesh', 'structure', 'frozen shell skin with frost lock', ['ice crust', 'frost rings', 'locked shell'], ['sphere', 'plane', 'cube'], 'warm shell ↔ frozen skin lock'),
  condense_field: depiction('volumetric', 'fog slices', 'hybrid', 'condensing droplet fog field', ['droplet cores', 'sinking bands', 'fog thickening'], ['plane', 'sphere', 'video'], 'diffuse vapor ↔ condensing fog body'),
  evaporative_sheet: depiction('brush-sheet', 'surface mesh', 'hybrid', 'evaporating sheet with retreating edge', ['edge retreat', 'salt fringe', 'thin film breakup'], ['plane', 'text', 'image'], 'wet sheet ↔ evaporative retreat'),
  sublimate_cloud: depiction('volumetric', 'fog slices', 'hybrid', 'sublimating crystal cloud with hollow lift', ['hollow core', 'crystal haze', 'lifted loss'], ['sphere', 'ring', 'video'], 'dense condensed cloud ↔ sublimating haze'),
};

export function isProceduralLayerMode(mode: Layer2Type) {
  return Boolean(PROCEDURAL_DEPICTIONS[mode]);
}

export function getDepictionArchitecture(mode: Layer2Type): DepictionArchitecture {
  return PROCEDURAL_DEPICTIONS[mode] ?? depiction(
    'point-cloud',
    'points',
    getMotionArchitecture(mode).family === 'Structure' ? 'hybrid' : 'particles',
    'particle cloud',
    ['count', 'radius', 'opacity'],
    ['sphere', 'random'],
    'ordered field ↔ particle spray',
  );
}
