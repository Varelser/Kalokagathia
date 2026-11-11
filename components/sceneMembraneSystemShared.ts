import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { generateParticleData, type ParticleData } from './particleData';
import { getLayerRuntimeMode } from '../lib/sceneRenderRouting';

export type MembraneMode = ParticleConfig['layer2Type'];

export type MembraneAudioState = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
};

export type MembraneSourceProfile = {
  ledger: number;
  canopy: number;
  orbit: number;
  droop: number;
  shear: number;
  pocket: number;
  veil: number;
  column: number;
  fracture: number;
};

const DEFAULT_MEMBRANE_SOURCE_PROFILE: MembraneSourceProfile = {
  ledger: 0,
  canopy: 0,
  orbit: 0,
  droop: 0,
  shear: 0,
  pocket: 0,
  veil: 0,
  column: 0,
  fracture: 0,
};

export type MembraneProfile = {
  sag: number;
  fold: number;
  seam: number;
  wind: number;
  drape: number;
  twist: number;
  anisotropy: number;
  pocket: number;
  creep: number;
  spring: number;
  veil: number;
  alphaMul: number;
  additive: boolean;
};

const DEFAULT_MEMBRANE_PROFILE: MembraneProfile = {
  sag: 0.04,
  fold: 0.08,
  seam: 0.12,
  wind: 0.08,
  drape: 0.06,
  twist: 0.04,
  anisotropy: 0.04,
  pocket: 0,
  creep: 0,
  spring: 0,
  veil: 0,
  alphaMul: 1,
  additive: true,
};

const MEMBRANE_PROFILES: Partial<Record<MembraneMode, Partial<MembraneProfile>>> = {
  sheet: {
    fold: 0.1,
    twist: 0.06,
    anisotropy: 0.08,
    spring: 0.1,
    veil: 0.04,
  },
  cloth_membrane: {
    sag: 0.18,
    fold: 0.24,
    seam: 0.32,
    wind: 0.22,
    drape: 0.28,
    twist: 0.12,
    anisotropy: 0.26,
    pocket: 0.18,
    creep: 0.08,
    spring: 0.16,
    veil: 0.18,
    alphaMul: 0.92,
    additive: false,
  },
  elastic_sheet: {
    sag: 0.08,
    fold: 0.18,
    seam: 0.26,
    wind: 0.16,
    drape: 0.08,
    twist: 0.2,
    anisotropy: 0.42,
    pocket: 0.06,
    creep: 0.04,
    spring: 0.92,
    veil: 0.1,
    alphaMul: 0.96,
    additive: false,
  },
  viscoelastic_membrane: {
    sag: 0.14,
    fold: 0.21,
    seam: 0.34,
    wind: 0.12,
    drape: 0.16,
    twist: 0.32,
    anisotropy: 0.28,
    pocket: 0.26,
    creep: 0.74,
    spring: 0.42,
    veil: 0.24,
    alphaMul: 0.94,
    additive: false,
  },
};

export type MembraneLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  usedCount: number;
  indexArray: Uint32Array;
  uvArray: Float32Array;
};

export const MAX_MEMBRANE_VERTICES = 4096;

export const MEMBRANE_VERTEX_SHADER = `
  varying vec3 vNormalView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const MEMBRANE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uFresnel;
  uniform float uSeam;
  uniform float uFold;
  uniform float uPocket;
  uniform float uTwist;
  uniform float uVeil;
  varying vec3 vNormalView;
  varying vec2 vUv;

  void main() {
    vec3 n = normalize(vNormalView);
    float facing = clamp(abs(n.z), 0.0, 1.0);
    float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), mix(1.2, 4.0, clamp(uFresnel, 0.0, 1.0)));
    float scan = 0.5 + 0.5 * sin(vUv.y * (70.0 + uVeil * 18.0) + vUv.x * (16.0 + uTwist * 18.0) + uSeam * 9.0);
    float folds = 0.5 + 0.5 * sin(vUv.x * (16.0 + uTwist * 22.0) + vUv.y * (9.0 + uPocket * 16.0) + uFold * 7.0);
    float pocket = smoothstep(0.52, 0.02, length(vUv - 0.5));
    float veil = 0.5 + 0.5 * sin(vUv.y * (12.0 + uVeil * 24.0) - vUv.x * 6.0 + uPulse * (5.0 + uTwist * 3.0));
    vec3 base = uColor * (0.24 + facing * 0.56 + scan * 0.05 + folds * 0.08 * uFold);
    base *= 1.0 - pocket * uPocket * 0.18;
    vec3 glow = mix(uColor, vec3(1.0), 0.18 + uVeil * 0.08) * fresnel * (0.58 + uPulse * 0.82 + veil * uVeil * 0.18);
    float alpha = uOpacity * clamp(0.2 + facing * 0.56 + fresnel * 0.56 + veil * uVeil * 0.1 - pocket * uPocket * 0.12, 0.0, 1.0);
    gl_FragColor = vec4(base + glow, alpha);
  }
`;

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3): MembraneMode {
  return getLayerRuntimeMode(config, layerIndex) as MembraneMode;
}

export function getMembraneProfile(mode: MembraneMode): MembraneProfile {
  return { ...DEFAULT_MEMBRANE_PROFILE, ...(MEMBRANE_PROFILES[mode] ?? {}) };
}

export function getSourceMembraneProfile(source: ParticleConfig['layer2Source']): MembraneSourceProfile {
  switch (source) {
    case 'text':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, ledger: 0.86, pocket: 0.22, shear: 0.34, fracture: 0.24 };
    case 'image':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, canopy: 0.28, veil: 0.36, pocket: 0.18, shear: 0.12 };
    case 'video':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, canopy: 0.34, veil: 0.48, orbit: 0.1, shear: 0.18 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, orbit: 0.82, pocket: 0.16, veil: 0.12 };
    case 'spiral':
    case 'galaxy':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, orbit: 0.62, shear: 0.26, veil: 0.14 };
    case 'grid':
    case 'plane':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, ledger: 0.42, shear: 0.18, column: 0.08, fracture: 0.12 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, column: 0.44, droop: 0.22, fracture: 0.18, pocket: 0.1 };
    case 'sphere':
      return { ...DEFAULT_MEMBRANE_SOURCE_PROFILE, canopy: 0.18, orbit: 0.2, veil: 0.16 };
    default:
      return DEFAULT_MEMBRANE_SOURCE_PROFILE;
  }
}

export function withSourceAwareMembraneProfile(profile: MembraneProfile, source: ParticleConfig['layer2Source']): MembraneProfile {
  const sourceProfile = getSourceMembraneProfile(source);
  return {
    ...profile,
    sag: profile.sag + sourceProfile.droop * 0.1 + sourceProfile.column * 0.04,
    fold: profile.fold + sourceProfile.fracture * 0.12 + sourceProfile.ledger * 0.08,
    seam: profile.seam + sourceProfile.ledger * 0.1 + sourceProfile.fracture * 0.08,
    wind: profile.wind + sourceProfile.canopy * 0.08 + sourceProfile.veil * 0.12,
    drape: profile.drape + sourceProfile.droop * 0.12 + sourceProfile.canopy * 0.06,
    twist: profile.twist + sourceProfile.orbit * 0.16 + sourceProfile.shear * 0.08,
    anisotropy: profile.anisotropy + sourceProfile.ledger * 0.06 + sourceProfile.column * 0.12,
    pocket: profile.pocket + sourceProfile.pocket * 0.22,
    creep: profile.creep + sourceProfile.droop * 0.08 + sourceProfile.ledger * 0.05,
    spring: profile.spring + sourceProfile.column * 0.06,
    veil: profile.veil + sourceProfile.veil * 0.2,
  };
}

export function getLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  if (layerIndex === 2) {
    return [
      layerIndex,
      config.layer2Count,
      config.layer2Source,
      config.layer2SourceCount,
      config.layer2SourceSpread,
      config.layer2Counts,
      config.layer2MediaLumaMap,
      config.layer2MediaMapWidth,
      config.layer2MediaMapHeight,
      config.layer2MediaThreshold,
      config.layer2MediaDepth,
      config.layer2MediaInvert,
      config.layer2SourcePositions,
      config.layer2MotionMix,
      config.layer2Motions,
      config.layer2Type,
      config.layer2RadiusScales,
      config.layer2FlowSpeeds,
      config.layer2FlowAmps,
      config.layer2FlowFreqs,
      config.layer2Sizes,
    ] as const;
  }

  return [
    layerIndex,
    config.layer3Count,
    config.layer3Source,
    config.layer3SourceCount,
    config.layer3SourceSpread,
    config.layer3Counts,
    config.layer3MediaLumaMap,
    config.layer3MediaMapWidth,
    config.layer3MediaMapHeight,
    config.layer3MediaThreshold,
    config.layer3MediaDepth,
    config.layer3MediaInvert,
    config.layer3SourcePositions,
    config.layer3MotionMix,
    config.layer3Motions,
    config.layer3Type,
    config.layer3RadiusScales,
    config.layer3FlowSpeeds,
    config.layer3FlowAmps,
    config.layer3FlowFreqs,
    config.layer3Sizes,
  ] as const;
}

export function buildMembraneLayout(config: ParticleConfig, layerIndex: 2 | 3): MembraneLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 9) return null;

  const desired = Math.min(MAX_MEMBRANE_VERTICES, particleData.count);
  const cols = Math.max(3, Math.floor(Math.sqrt(desired)));
  const rows = Math.max(3, Math.floor(desired / cols));
  const usedCount = cols * rows;
  if (usedCount < 9) return null;

  const sampledIndices = new Uint32Array(usedCount);
  for (let i = 0; i < usedCount; i += 1) {
    sampledIndices[i] = Math.min(
      particleData.count - 1,
      Math.floor((i / Math.max(1, usedCount - 1)) * Math.max(0, particleData.count - 1)),
    );
  }

  const indexArray = new Uint32Array((cols - 1) * (rows - 1) * 6);
  const uvArray = new Float32Array(usedCount * 2);
  let ptr = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x;
      uvArray[i * 2 + 0] = cols <= 1 ? 0 : x / (cols - 1);
      uvArray[i * 2 + 1] = rows <= 1 ? 0 : y / (rows - 1);
      if (x < cols - 1 && y < rows - 1) {
        const a = i;
        const b = i + 1;
        const c = i + cols;
        const d = i + cols + 1;
        indexArray[ptr++] = a;
        indexArray[ptr++] = c;
        indexArray[ptr++] = b;
        indexArray[ptr++] = b;
        indexArray[ptr++] = c;
        indexArray[ptr++] = d;
      }
    }
  }

  return { particleData, sampledIndices, usedCount, indexArray, uvArray };
}

export function createMembraneUniforms(config: ParticleConfig, layerIndex: 2 | 3) {
  return {
    uColor: { value: new THREE.Color(layerIndex === 2 ? config.layer2Color : config.layer3Color) },
    uOpacity: { value: layerIndex === 2 ? config.layer2SheetOpacity : config.layer3SheetOpacity },
    uPulse: { value: 0 },
    uFresnel: { value: layerIndex === 2 ? config.layer2SheetFresnel : config.layer3SheetFresnel },
    uSeam: { value: 0 },
    uFold: { value: 0 },
    uPocket: { value: 0 },
    uTwist: { value: 0 },
    uVeil: { value: 0 },
  };
}
