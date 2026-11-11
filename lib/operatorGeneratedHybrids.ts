import type { Layer3Source } from '../types';
import type { HybridExpressionRecipe } from './hybridExpressions';
import type { HybridTemporalVariant } from './hybridTemporalVariants';
import { OPERATOR_PROMOTED_DEDICATED_AXES, OPERATOR_PROMOTED_DEDICATED_AXIS_SUMMARY, OPERATOR_PROMOTED_DEDICATED_SUBAXES, OPERATOR_PROMOTED_DEDICATED_SUBAXIS_SUMMARY, OPERATOR_RECIPE_LIBRARY } from './operatorMatrix';

const MANUAL_OPERATOR_HYBRID_RECIPES: HybridExpressionRecipe[] = [
  {
    id: 'operator-fluid-ledger',
    name: 'Operator Fluid + Ledger',
    summary: 'Capillary / advection sheets paired with inscription-aware deposition and weave.',
    layer2Modes: ['capillary_sheet', 'advection_flow', 'melt_front'],
    layer3Modes: ['ink_bleed', 'glyph_weave', 'percolation_sheet'],
    emphasis: ['wick channels', 'advection lanes', 'ledger retention'],
  },
  {
    id: 'operator-granular-lock',
    name: 'Operator Granular + Lock',
    summary: 'Avalanche and jam systems contrasted with talus and creep structures.',
    layer2Modes: ['avalanche_field', 'jammed_pack', 'talus_heap'],
    layer3Modes: ['creep_lattice', 'calcified_skin', 'pressure_cells'],
    emphasis: ['runout', 'packing lock', 'creep span'],
  },
  {
    id: 'operator-membrane-inscription',
    name: 'Operator Membrane + Inscription',
    summary: 'Viscoelastic and frozen membranes paired with glyphic shell / outline systems.',
    layer2Modes: ['viscoelastic_membrane', 'freeze_skin', 'cloth_membrane'],
    layer3Modes: ['shell_script', 'glyph_weave', 'contour_echo'],
    emphasis: ['rebound lag', 'ice lock', 'glyph adhesion'],
  },
  {
    id: 'operator-vapor-rune',
    name: 'Operator Vapor + Rune',
    summary: 'Rune-bearing fog and vortex bodies paired with deposition and halo systems.',
    layer2Modes: ['vortex_transport', 'pressure_cells', 'rune_smoke'],
    layer3Modes: ['ink_bleed', 'eclipse_halo', 'static_smoke'],
    emphasis: ['spiral lift', 'pressure basin', 'rune gate'],
  },
  {
    id: 'operator-corrosion-bio',
    name: 'Operator Corrosion + Biofilm',
    summary: 'Corrosion fronts and biofilm skins paired with creep or lattice support.',
    layer2Modes: ['corrosion_front', 'biofilm_skin', 'cellular_front'],
    layer3Modes: ['creep_lattice', 'elastic_lattice', 'stipple_field'],
    emphasis: ['etch front', 'colony drift', 'support sag'],
  },
  {
    id: 'operator-phase-cycle',
    name: 'Operator Phase Cycle',
    summary: 'Melt / condense / sublimate systems cross-faded with shells and fog.',
    layer2Modes: ['melt_front', 'condense_field', 'sublimate_cloud'],
    layer3Modes: ['freeze_skin', 'halo_bloom', 'velvet_ash'],
    emphasis: ['edge retreat', 'droplet cores', 'hollow lift'],
  },
  {
    id: 'operator-resin-trace',
    name: 'Operator Resin + Trace',
    summary: 'Resin and palimpsest shells with deposition and fog trace systems.',
    layer2Modes: ['resin_shell', 'mirror_skin', 'residue_skin'],
    layer3Modes: ['ink_bleed', 'soot_veil', 'drift_glyph_dust'],
    emphasis: ['lacquer sheen', 'trace residue', 'absorption'],
  },
  {
    id: 'operator-grid-architectonic',
    name: 'Operator Grid Architectonic',
    summary: 'Grid-biased shell, lattice, and static smoke systems reviewed together.',
    layer2Modes: ['creep_lattice', 'static_smoke', 'calcified_skin'],
    layer3Modes: ['stipple_field', 'mesh_weave', 'pressure_cells'],
    emphasis: ['grid lock', 'slab density', 'plate relief'],
  },
  {
    id: 'operator-erosion-wear-spectrum',
    name: 'Operator Erosion / Dissolution / Wear',
    summary: 'Erosion trails, seep dissolution, residue wear, and calcified pitting reviewed together.',
    layer2Modes: ['erosion_trail', 'seep_fracture', 'residue_skin', 'calcified_skin'],
    layer3Modes: ['corrosion_front', 'ink_bleed', 'stipple_field', 'residue_skin'],
    emphasis: ['trail cut', 'seep retreat', 'surface wear', 'pitting memory'],
  },
];

const SOURCE_REVIEW_TARGETS: Layer3Source[] = ['text', 'grid', 'ring', 'plane', 'image', 'video'];

const SOURCE_LABELS: Partial<Record<Layer3Source, string>> = {
  text: 'Text',
  grid: 'Grid',
  ring: 'Ring',
  plane: 'Plane',
  image: 'Image',
  video: 'Video',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cube: 'Cube',
};

const SOURCE_TEMPORALS: Partial<Record<Layer3Source, [string, string]>> = {
  text: ['rewrite', 'unravel'],
  grid: ['hysteresis', 'ossify'],
  ring: ['oscillate', 'inhale'],
  plane: ['accrete', 'shed'],
  image: ['recur', 'collapse'],
  video: ['intermittent', 'erupt'],
  sphere: ['inhale', 'oscillate'],
  cylinder: ['resonate', 'rebound'],
  cube: ['ossify', 'collapse'],
};

function uniqueModesForSource(source: Layer3Source) {
  return Array.from(new Set(OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.source === source).map((recipe) => recipe.mode)));
}

const AUTO_SOURCE_HYBRID_RECIPES: HybridExpressionRecipe[] = SOURCE_REVIEW_TARGETS.map((source) => {
  const modes = uniqueModesForSource(source);
  const layer2Modes = modes.slice(0, 4);
  const layer3Modes = modes.slice(4, 8).length > 0 ? modes.slice(4, 8) : modes.slice(0, 4);
  return {
    id: `operator-source-${source}-review`,
    name: `Operator ${SOURCE_LABELS[source] ?? source} Source Review`,
    summary: `Auto-generated review grouping for ${source} anchored operator recipes.`,
    layer2Modes,
    layer3Modes,
    emphasis: [`${source} anchoring`, 'source-aware weighting', 'batch-grown recipes'],
  };
});

const MANUAL_OPERATOR_HYBRID_TEMPORAL_VARIANTS: HybridTemporalVariant[] = [
  { id: 'operator-fluid-ledger-cycle', label: 'Wick / Rewrite Cycle', summary: 'Fluid sheets percolate while inscription surfaces rewrite themselves.', requiredHybridId: 'operator-fluid-ledger', layer2Temporal: 'percolate', layer3Temporal: 'rewrite' },
  { id: 'operator-granular-lock-fatigue', label: 'Slope Fatigue Lock', summary: 'Avalanche systems fatigue while lattice supports rebound and harden.', requiredHybridId: 'operator-granular-lock', layer2Temporal: 'fatigue', layer3Temporal: 'rebound' },
  { id: 'operator-membrane-inscription-rebound', label: 'Inscribed Rebound', summary: 'Membranes rebound while inscription shells slowly unravel.', requiredHybridId: 'operator-membrane-inscription', layer2Temporal: 'rebound', layer3Temporal: 'unravel' },
  { id: 'operator-vapor-rune-erupt', label: 'Rune Transport Eruption', summary: 'Rune-bearing fog erupts while halo and static supports oscillate.', requiredHybridId: 'operator-vapor-rune', layer2Temporal: 'erupt', layer3Temporal: 'oscillate' },
  { id: 'operator-corrosion-bio-regrow', label: 'Etch / Regrow Loop', summary: 'Corrosion fissures forward while biofilm surfaces regrow into them.', requiredHybridId: 'operator-corrosion-bio', layer2Temporal: 'fissure', layer3Temporal: 'regrow' },
  { id: 'operator-phase-cycle-collapse', label: 'Phase Collapse Cycle', summary: 'Melt and condensation collapse into inversion and regrowth.', requiredHybridId: 'operator-phase-cycle', layer2Temporal: 'collapse', layer3Temporal: 'invert' },
  { id: 'operator-resin-trace-recur', label: 'Resin Trace Recur', summary: 'Resin shells recur while trace-bearing fields keep rewriting.', requiredHybridId: 'operator-resin-trace', layer2Temporal: 'recur', layer3Temporal: 'rewrite' },
  { id: 'operator-grid-architectonic-hysteresis', label: 'Architectonic Hysteresis', summary: 'Grid systems hold memory and lag under repeated static pulses.', requiredHybridId: 'operator-grid-architectonic', layer2Temporal: 'hysteresis', layer3Temporal: 'oscillate' },
  { id: 'operator-erosion-wear-fatigue', label: 'Erosion / Wear Fatigue', summary: 'Eroded lines fatigue while residue shells and seep fields keep collapsing and hardening.', requiredHybridId: 'operator-erosion-wear-spectrum', layer2Temporal: 'fatigue', layer3Temporal: 'collapse' },
];

const AUTO_SOURCE_HYBRID_TEMPORAL_VARIANTS: HybridTemporalVariant[] = SOURCE_REVIEW_TARGETS.map((source) => ({
  id: `operator-source-${source}-review-temporal`,
  label: `${SOURCE_LABELS[source] ?? source} Source Temporal Review`,
  summary: `Auto-generated temporal review for ${source} anchored operator recipes.`,
  requiredHybridId: `operator-source-${source}-review`,
  layer2Temporal: (SOURCE_TEMPORALS[source] ?? ['oscillate', 'rewrite'])[0],
  layer3Temporal: (SOURCE_TEMPORALS[source] ?? ['oscillate', 'rewrite'])[1],
}));

const DEDICATED_AXIS_HYBRIDS: HybridExpressionRecipe[] = OPERATOR_PROMOTED_DEDICATED_AXES.map((axis) => {
  const modes = Array.from(new Set(OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.dedicatedAxis === axis).map((recipe) => recipe.mode)));
  return {
    id: `operator-dedicated-${axis}-review`,
    name: `Dedicated ${axis} Review`,
    summary: OPERATOR_PROMOTED_DEDICATED_AXIS_SUMMARY[axis],
    layer2Modes: modes.slice(0, 4),
    layer3Modes: modes.slice(4, 8).length > 0 ? modes.slice(4, 8) : modes.slice(0, 4),
    emphasis: [axis, 'dedicated-axis', 'operator-promotion'],
  };
});

const DEDICATED_AXIS_TEMPORALS: HybridTemporalVariant[] = OPERATOR_PROMOTED_DEDICATED_AXES.map((axis) => ({
  id: `operator-dedicated-${axis}-temporal`,
  label: `Dedicated ${axis} Temporal Review`,
  summary: `Temporal review for promoted dedicated axis ${axis}.`,
  requiredHybridId: `operator-dedicated-${axis}-review`,
  layer2Temporal: axis === 'erosion-wear' ? 'fatigue' : axis === 'phase-transition' ? 'invert' : axis === 'ring-orbit' ? 'oscillate' : axis === 'plane-ledger' ? 'accrete' : 'rewrite',
  layer3Temporal: axis === 'erosion-wear' ? 'collapse' : axis === 'phase-transition' ? 'emerge' : axis === 'ring-orbit' ? 'inhale' : axis === 'plane-ledger' ? 'shed' : 'unravel',
}));


const DEDICATED_SUBAXIS_HYBRIDS: HybridExpressionRecipe[] = OPERATOR_PROMOTED_DEDICATED_SUBAXES.map((axis) => {
  const modes = Array.from(new Set(OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.dedicatedSubAxis === axis).map((recipe) => recipe.mode)));
  return {
    id: `operator-dedicated-sub-${axis}-review`,
    name: `Dedicated ${axis} Review`,
    summary: OPERATOR_PROMOTED_DEDICATED_SUBAXIS_SUMMARY[axis],
    layer2Modes: modes.slice(0, 4),
    layer3Modes: modes.slice(4, 8).length > 0 ? modes.slice(4, 8) : modes.slice(0, 4),
    emphasis: [axis, 'dedicated-sub-axis', 'operator-refinement'],
  };
});

const DEDICATED_SUBAXIS_TEMPORALS: HybridTemporalVariant[] = OPERATOR_PROMOTED_DEDICATED_SUBAXES.map((axis) => ({
  id: `operator-dedicated-sub-${axis}-temporal`,
  label: `Dedicated ${axis} Temporal Review`,
  summary: `Temporal review for promoted dedicated sub-axis ${axis}.`,
  requiredHybridId: `operator-dedicated-sub-${axis}-review`,
  layer2Temporal:
    axis === 'erosion-cut' ? 'fatigue' :
    axis === 'wear-pitted' ? 'hysteresis' :
    axis === 'phase-freeze' ? 'invert' :
    axis === 'phase-melt' ? 'collapse' :
    axis === 'ring-vortex' ? 'erupt' :
    axis === 'ring-halo' ? 'oscillate' :
    axis === 'grid-lattice' ? 'rebound' :
    axis === 'grid-static' ? 'ossify' :
    axis === 'plane-soot' ? 'shed' :
    axis === 'plane-ink' ? 'rewrite' :
    axis === 'text-glyphic' ? 'unravel' : 'rewrite',
  layer3Temporal:
    axis === 'erosion-cut' ? 'collapse' :
    axis === 'wear-pitted' ? 'ossify' :
    axis === 'phase-freeze' ? 'emerge' :
    axis === 'phase-melt' ? 'recur' :
    axis === 'ring-vortex' ? 'resonate' :
    axis === 'ring-halo' ? 'inhale' :
    axis === 'grid-lattice' ? 'anneal' :
    axis === 'grid-static' ? 'oscillate' :
    axis === 'plane-soot' ? 'accrete' :
    axis === 'plane-ink' ? 'percolate' :
    axis === 'text-glyphic' ? 'resonate' : 'rewrite',
}));

export const OPERATOR_HYBRID_RECIPES: HybridExpressionRecipe[] = [
  ...MANUAL_OPERATOR_HYBRID_RECIPES,
  ...AUTO_SOURCE_HYBRID_RECIPES,
  ...DEDICATED_AXIS_HYBRIDS,
  ...DEDICATED_SUBAXIS_HYBRIDS,
];

export const OPERATOR_HYBRID_TEMPORAL_VARIANTS: HybridTemporalVariant[] = [
  ...MANUAL_OPERATOR_HYBRID_TEMPORAL_VARIANTS,
  ...AUTO_SOURCE_HYBRID_TEMPORAL_VARIANTS,
  ...DEDICATED_AXIS_TEMPORALS,
  ...DEDICATED_SUBAXIS_TEMPORALS,
];
