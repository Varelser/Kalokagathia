import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimeGrowthSnapshot } from '../lib/sceneRenderRouting';
import { generateParticleData, type ParticleData } from './particleData';

export type GrowthLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  branchCount: number;
  maxStrandCount: number;
};

export type GrowthProfile = {
  trunkMul: number;
  branchMul: number;
  spreadMul: number;
  startMin: number;
  startRange: number;
  tangentMix: number;
  normalMix: number;
  bitangentMix: number;
  verticalLift: number;
  droop: number;
  twigRate: number;
  twigMul: number;
  twigSpread: number;
  jitter: number;
  pulseMul: number;
  bandFreq: number;
  tipGlow: number;
  gateFreq: number;
  alphaMul: number;
};

export type SourceGrowthProfile = {
  canopy: number;
  orbit: number;
  fracture: number;
  fan: number;
  sweep: number;
  ledger: number;
  terrace: number;
  column: number;
  droop: number;
};

export type GrowthFieldAudioState = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
};

export type GrowthFieldProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<GrowthFieldAudioState>;
  isPlaying: boolean;
};

export type GrowthMode = ParticleConfig['layer2Type'];

const DEFAULT_GROWTH_PROFILE: GrowthProfile = {
  trunkMul: 1,
  branchMul: 1,
  spreadMul: 1,
  startMin: 0.34,
  startRange: 0.42,
  tangentMix: 0.65,
  normalMix: 0.6,
  bitangentMix: 0.35,
  verticalLift: 0.06,
  droop: 0.04,
  twigRate: 0.42,
  twigMul: 0.42,
  twigSpread: 0.56,
  jitter: 0.18,
  pulseMul: 1,
  bandFreq: 0.12,
  tipGlow: 0.64,
  gateFreq: 0.05,
  alphaMul: 1,
};

const DEFAULT_SOURCE_GROWTH_PROFILE: SourceGrowthProfile = {
  canopy: 0.18,
  orbit: 0,
  fracture: 0,
  fan: 0.12,
  sweep: 0.1,
  ledger: 0,
  terrace: 0,
  column: 0.18,
  droop: 0.08,
};

const GROWTH_PROFILES: Partial<Record<GrowthMode, Partial<GrowthProfile>>> = {
  growth_field: {},
  growth_grammar: {
    trunkMul: 1.08,
    branchMul: 1.2,
    spreadMul: 1.06,
    tangentMix: 0.72,
    normalMix: 0.68,
    bitangentMix: 0.28,
    verticalLift: 0.14,
    droop: 0.02,
    twigRate: 0.62,
    twigMul: 0.56,
    twigSpread: 0.72,
    jitter: 0.1,
    pulseMul: 1.08,
    bandFreq: 0.08,
    tipGlow: 0.82,
    gateFreq: 0.04,
    alphaMul: 1.04,
  },
  fracture_grammar: {
    trunkMul: 0.92,
    branchMul: 1.28,
    spreadMul: 0.84,
    startMin: 0.18,
    startRange: 0.28,
    tangentMix: 0.42,
    normalMix: 0.86,
    bitangentMix: 0.62,
    verticalLift: 0.01,
    droop: 0.0,
    twigRate: 0.22,
    twigMul: 0.28,
    twigSpread: 0.34,
    jitter: 0.08,
    pulseMul: 0.88,
    bandFreq: 0.22,
    tipGlow: 0.46,
    gateFreq: 0.14,
    alphaMul: 0.92,
  },
};

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3): GrowthMode {
  return getLayerRuntimeGrowthSnapshot(config, layerIndex).mode;
}

export function getGrowthProfile(mode: GrowthMode): GrowthProfile {
  return { ...DEFAULT_GROWTH_PROFILE, ...(GROWTH_PROFILES[mode] ?? {}) };
}

export function getLayerSource(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeGrowthSnapshot(config, layerIndex).source;
}

export function getSourceGrowthProfile(source: ParticleConfig['layer2Source']): SourceGrowthProfile {
  switch (source) {
    case 'text':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, fracture: 0.34, ledger: 0.38, terrace: 0.24, fan: 0.06, canopy: 0.08, column: 0.08 };
    case 'image':
    case 'video':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, canopy: 0.34, sweep: 0.28, droop: 0.12, fan: 0.2, column: 0.14 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, orbit: 0.42, fan: 0.3, sweep: 0.14, canopy: 0.1, column: 0.06 };
    case 'spiral':
    case 'galaxy':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, orbit: 0.34, sweep: 0.36, fan: 0.18, canopy: 0.16, column: 0.1 };
    case 'grid':
    case 'plane':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, ledger: 0.28, terrace: 0.32, fracture: 0.14, fan: 0.08, column: 0.2 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, column: 0.34, fracture: 0.28, fan: 0.14, sweep: 0.08, canopy: 0.12 };
    case 'center':
    case 'random':
      return { ...DEFAULT_SOURCE_GROWTH_PROFILE, canopy: 0.22, fan: 0.18, sweep: 0.16, droop: 0.12, column: 0.16 };
    case 'sphere':
    default:
      return DEFAULT_SOURCE_GROWTH_PROFILE;
  }
}

export function getLayerGrowthSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeGrowthSnapshot(config, layerIndex);
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
      config.layer2GrowthBranches,
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
    config.layer3GrowthBranches,
  ] as const;
}

export function buildGrowthLayout(config: ParticleConfig, layerIndex: 2 | 3): GrowthLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 4) return null;
  const settings = getLayerGrowthSettings(config, layerIndex);
  const branchCount = Math.max(1, Math.min(8, Math.floor(settings.branches)));
  const baseCount = Math.max(10, Math.min(96, Math.floor(particleData.count / Math.max(6, branchCount * 2))));
  const sampledIndices = new Uint32Array(baseCount);
  for (let i = 0; i < baseCount; i += 1) {
    sampledIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, baseCount - 1)) * Math.max(0, particleData.count - 1)));
  }
  return { particleData, sampledIndices, branchCount, maxStrandCount: baseCount * (1 + branchCount * 3) };
}

export const GROWTH_VERTEX_SHADER = `
  attribute float growthMix;
  varying float vGrowthMix;
  varying vec3 vWorldPos;
  void main() {
    vGrowthMix = growthMix;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const GROWTH_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uMaterialStyle;
  uniform float uTipGlow;
  uniform float uBarkBands;
  uniform float uGateFreq;
  uniform float uAlphaMul;
  varying float vGrowthMix;
  varying vec3 vWorldPos;
  void main() {
    float tip = smoothstep(0.0, 1.0, vGrowthMix);
    vec3 color = uColor;
    float alpha = uOpacity * uAlphaMul * mix(1.0, 0.14, tip);
    float shimmer = 0.55 + 0.45 * sin(vWorldPos.y * 0.07 + vWorldPos.x * 0.04 + uPulse * 8.0);
    float bark = 0.5 + 0.5 * sin(vWorldPos.y * uBarkBands - vWorldPos.x * uBarkBands * 0.6);
    float gate = step(0.25, fract(vWorldPos.y * uGateFreq + vWorldPos.x * uGateFreq * 0.6));
    color *= 0.48 + shimmer * 0.34 + bark * 0.18;
    color += vec3(1.0) * tip * uTipGlow * (0.08 + uPulse * 0.06);
    alpha *= mix(1.0, 0.72 + gate * 0.28, tip * 0.4);
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.9, 0.97, 1.0), 0.25);
      alpha *= 0.82;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      color = mix(color, vec3(0.2, 1.0, 0.88), 0.42);
      alpha *= 1.08;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      color = mix(vec3(0.18), vec3(1.0), bark) * mix(uColor, vec3(1.0), 0.42);
    } else if (uMaterialStyle > 3.5) {
      alpha *= mix(0.42, 1.0, gate);
      color *= 0.48 + gate * 0.52;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createGrowthUniforms() {
  return {
    uColor: { value: new THREE.Color('#ffffff') },
    uOpacity: { value: 0.4 },
    uPulse: { value: 0 },
    uMaterialStyle: { value: 0 },
    uTipGlow: { value: 0.64 },
    uBarkBands: { value: 0.12 },
    uGateFreq: { value: 0.05 },
    uAlphaMul: { value: 1 },
  };
}
