import type { ProductPackBundle } from './productPackLibrary';

export const TARGET_PHYSICAL_FAMILIES = [
  'feedback-field',
  'vector-force',
  'particle-emission',
  'volumetric-fluid',
  'cloth-softbody',
  'granular-material',
  'viscoplastic-mpm',
  'fracture-destruction',
  'sdf-contact',
  'reaction-diffusion',
  'audio-modulation',
  'growth-branching',
] as const;

export const TARGET_GEOMETRY_FAMILIES = [
  'particle-sprites',
  'line-ribbon',
  'tube-curve',
  'grid-lattice',
  'surface-patch',
  'shell-volume',
  'metaball-implicit',
  'voxel-structure',
  'instanced-objects',
  'screen-composite',
  'volumetric-cloud',
  'sdf-surface',
] as const;

export const TARGET_TEMPORAL_FAMILIES = [
  'persistent-feedback',
  'burst-impulse',
  'oscillation-cycle',
  'iterative-growth',
  'accumulative-deposition',
  'step-simulation',
  'audio-driven',
  'orbital-loop',
  'rewrite-resample',
  'advection-flow',
] as const;

export type ProductPackSubfamilyProfile = {
  physicalFamilies: string[];
  geometryFamilies: string[];
  temporalFamilies: string[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

const PRODUCT_PACK_SUBFAMILIES: Record<string, ProductPackSubfamilyProfile> = {
  'product-pack-touch-feedback-topology': {
    physicalFamilies: ['feedback-field', 'vector-force'],
    geometryFamilies: ['screen-composite', 'line-ribbon'],
    temporalFamilies: ['persistent-feedback', 'rewrite-resample'],
  },
  'product-pack-touch-pop-force-cloud': {
    physicalFamilies: ['vector-force', 'particle-emission'],
    geometryFamilies: ['instanced-objects', 'particle-sprites'],
    temporalFamilies: ['step-simulation', 'advection-flow'],
  },
  'product-pack-touch-curve-relief-feedback': {
    physicalFamilies: ['feedback-field'],
    geometryFamilies: ['surface-patch', 'line-ribbon', 'screen-composite'],
    temporalFamilies: ['persistent-feedback', 'rewrite-resample', 'oscillation-cycle'],
  },
  'product-pack-trapcode-particular-noir': {
    physicalFamilies: ['particle-emission', 'audio-modulation', 'vector-force'],
    geometryFamilies: ['particle-sprites', 'line-ribbon'],
    temporalFamilies: ['burst-impulse', 'audio-driven', 'advection-flow'],
  },
  'product-pack-trapcode-particular-audio-sparks': {
    physicalFamilies: ['particle-emission', 'audio-modulation'],
    geometryFamilies: ['particle-sprites', 'line-ribbon'],
    temporalFamilies: ['burst-impulse', 'audio-driven'],
  },
  'product-pack-trapcode-form-lattice': {
    physicalFamilies: ['vector-force'],
    geometryFamilies: ['grid-lattice', 'instanced-objects'],
    temporalFamilies: ['step-simulation'],
  },
  'product-pack-trapcode-form-sdf-swarm': {
    physicalFamilies: ['particle-emission', 'sdf-contact', 'vector-force'],
    geometryFamilies: ['grid-lattice', 'sdf-surface', 'instanced-objects'],
    temporalFamilies: ['step-simulation', 'orbital-loop'],
  },
  'product-pack-universe-retro-feedback': {
    physicalFamilies: ['feedback-field'],
    geometryFamilies: ['screen-composite'],
    temporalFamilies: ['persistent-feedback', 'rewrite-resample'],
  },
  'product-pack-universe-broadcast-ghost': {
    physicalFamilies: ['feedback-field'],
    geometryFamilies: ['screen-composite', 'volumetric-cloud'],
    temporalFamilies: ['persistent-feedback', 'oscillation-cycle'],
  },
  'product-pack-hybrid-audio-operator-stack': {
    physicalFamilies: ['audio-modulation', 'feedback-field', 'particle-emission'],
    geometryFamilies: ['screen-composite', 'particle-sprites', 'line-ribbon'],
    temporalFamilies: ['audio-driven', 'persistent-feedback', 'burst-impulse'],
  },
  'product-pack-houdini-pyro-vortex-column': {
    physicalFamilies: ['volumetric-fluid', 'vector-force'],
    geometryFamilies: ['volumetric-cloud'],
    temporalFamilies: ['advection-flow', 'step-simulation'],
  },
  'product-pack-houdini-vellum-granular-drape': {
    physicalFamilies: ['cloth-softbody', 'granular-material'],
    geometryFamilies: ['surface-patch', 'particle-sprites'],
    temporalFamilies: ['step-simulation', 'accumulative-deposition'],
  },
  'product-pack-houdini-growth-arbor': {
    physicalFamilies: ['growth-branching'],
    geometryFamilies: ['line-ribbon', 'surface-patch'],
    temporalFamilies: ['iterative-growth'],
  },
  'product-pack-niagara-stateless-orbit-mesh': {
    physicalFamilies: ['particle-emission', 'vector-force'],
    geometryFamilies: ['instanced-objects'],
    temporalFamilies: ['orbital-loop', 'step-simulation'],
  },
  'product-pack-niagara-collision-burst-field': {
    physicalFamilies: ['particle-emission', 'sdf-contact', 'vector-force'],
    geometryFamilies: ['particle-sprites', 'line-ribbon'],
    temporalFamilies: ['burst-impulse', 'step-simulation'],
  },
  'product-pack-geometrynodes-simulation-lattice': {
    physicalFamilies: ['vector-force'],
    geometryFamilies: ['grid-lattice', 'voxel-structure'],
    temporalFamilies: ['step-simulation'],
  },
  'product-pack-geometrynodes-reaction-growth-plate': {
    physicalFamilies: ['reaction-diffusion', 'growth-branching'],
    geometryFamilies: ['surface-patch', 'grid-lattice'],
    temporalFamilies: ['iterative-growth', 'accumulative-deposition'],
  },
  'product-pack-unity-vfx-gpu-sheet': {
    physicalFamilies: ['particle-emission', 'vector-force'],
    geometryFamilies: ['surface-patch', 'instanced-objects'],
    temporalFamilies: ['step-simulation', 'advection-flow'],
  },
  'product-pack-houdini-mpm-slurry-stack': {
    physicalFamilies: ['viscoplastic-mpm', 'granular-material', 'volumetric-fluid'],
    geometryFamilies: ['surface-patch', 'volumetric-cloud'],
    temporalFamilies: ['accumulative-deposition', 'step-simulation', 'advection-flow'],
  },
  'product-pack-houdini-destruction-fracture-debris': {
    physicalFamilies: ['fracture-destruction', 'granular-material'],
    geometryFamilies: ['voxel-structure', 'particle-sprites', 'instanced-objects'],
    temporalFamilies: ['burst-impulse', 'step-simulation'],
  },
  'product-pack-touch-top-cop-signal-field': {
    physicalFamilies: ['feedback-field', 'audio-modulation'],
    geometryFamilies: ['screen-composite', 'surface-patch'],
    temporalFamilies: ['persistent-feedback', 'audio-driven', 'rewrite-resample'],
  },
  'product-pack-hybrid-pdg-variant-sweep': {
    physicalFamilies: ['growth-branching', 'reaction-diffusion'],
    geometryFamilies: ['screen-composite', 'surface-patch'],
    temporalFamilies: ['iterative-growth', 'rewrite-resample'],
  },
  'product-pack-niagara-chaos-magnetic-tubes': {
    physicalFamilies: ['particle-emission', 'vector-force', 'sdf-contact'],
    geometryFamilies: ['tube-curve', 'instanced-objects', 'particle-sprites'],
    temporalFamilies: ['orbital-loop', 'step-simulation', 'burst-impulse'],
  },
  'product-pack-houdini-shell-metaball-volume': {
    physicalFamilies: ['volumetric-fluid'],
    geometryFamilies: ['shell-volume', 'metaball-implicit', 'volumetric-cloud'],
    temporalFamilies: ['step-simulation', 'advection-flow'],
  },
  'product-pack-hybrid-contact-sdf-scatter': {
    physicalFamilies: ['sdf-contact', 'particle-emission'],
    geometryFamilies: ['sdf-surface', 'particle-sprites', 'instanced-objects'],
    temporalFamilies: ['burst-impulse', 'rewrite-resample'],
  },
};

export function getProductPackSubfamilyProfile(bundleOrId: ProductPackBundle | string | null | undefined): ProductPackSubfamilyProfile {
  const id = typeof bundleOrId === 'string'
    ? bundleOrId
    : bundleOrId?.id;
  if (!id || !PRODUCT_PACK_SUBFAMILIES[id]) {
    return {
      physicalFamilies: [],
      geometryFamilies: [],
      temporalFamilies: [],
    };
  }
  const profile = PRODUCT_PACK_SUBFAMILIES[id];
  return {
    physicalFamilies: uniqueNonEmpty(profile.physicalFamilies),
    geometryFamilies: uniqueNonEmpty(profile.geometryFamilies),
    temporalFamilies: uniqueNonEmpty(profile.temporalFamilies),
  };
}
