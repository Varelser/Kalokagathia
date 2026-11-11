import type { MotionArchitecture } from './motionArchitectureTypes';
import type { MotionGroupName } from '../components/motionCatalog';

export const DEFAULTS_BY_GROUP: Record<MotionGroupName, Omit<MotionArchitecture, 'id' | 'family'>> = {
  Fluid: {
    driver: 'field',
    temporalBehavior: 'steady',
    editingProfile: 'explore',
    depictionHint: 'flow field',
    recommendedSources: ['sphere', 'ring', 'plane'],
    editingFocus: ['amplitude', 'turbulence', 'drift'],
  },
  Chaos: {
    driver: 'chaos',
    temporalBehavior: 'oscillatory',
    editingProfile: 'explore',
    depictionHint: 'chaotic orbit',
    recommendedSources: ['sphere', 'ring', 'cube'],
    editingFocus: ['phase', 'spread', 'stability'],
  },
  Orbit: {
    driver: 'orbit',
    temporalBehavior: 'steady',
    editingProfile: 'weave',
    depictionHint: 'orbital path',
    recommendedSources: ['ring', 'spiral', 'torus'],
    editingFocus: ['radius', 'phase', 'frequency'],
  },
  Pattern: {
    driver: 'oscillation',
    temporalBehavior: 'oscillatory',
    editingProfile: 'shape',
    depictionHint: 'pattern scaffold',
    recommendedSources: ['plane', 'grid', 'text'],
    editingFocus: ['symmetry', 'phase', 'density'],
  },
  Structure: {
    driver: 'structural',
    temporalBehavior: 'emergent',
    editingProfile: 'shape',
    depictionHint: 'structural body',
    recommendedSources: ['plane', 'cube', 'text'],
    editingFocus: ['density', 'scale', 'surface'],
  },
  Pulse: {
    driver: 'oscillation',
    temporalBehavior: 'pulsed',
    editingProfile: 'shape',
    depictionHint: 'pulse envelope',
    recommendedSources: ['sphere', 'ring', 'text'],
    editingFocus: ['frequency', 'burst', 'phase'],
  },
  Transform: {
    driver: 'transform',
    temporalBehavior: 'steady',
    editingProfile: 'explore',
    depictionHint: 'transform field',
    recommendedSources: ['sphere', 'plane', 'cube'],
    editingFocus: ['blend', 'offset', 'deformation'],
  },
};
