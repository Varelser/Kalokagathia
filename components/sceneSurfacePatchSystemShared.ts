import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimePatchSnapshot } from '../lib/sceneRenderRouting';
import { generateParticleData, type ParticleData } from './particleData';

export type PatchLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  resolution: number;
  vertexCount: number;
};

export type SurfacePatchSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

export const PATCH_VERTEX_SHADER = `
  varying vec3 vNormalView;
  varying vec3 vWorldPos;
  varying vec2 vUvCoord;
  void main() {
    vUvCoord = uv;
    vNormalView = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const PATCH_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uFresnel;
  uniform float uMaterialStyle;
  uniform float uContourBands;
  uniform float uContourSharpness;
  uniform float uPlateMix;
  uniform float uEchoMix;
  uniform float uShearMix;
  uniform float uRingAmount;
  uniform float uInterferenceAmount;
  uniform float uTremorAmount;
  uniform float uTerraceAmount;
  uniform float uCellAmount;
  uniform float uCreaseAmount;
  uniform float uSpokeAmount;
  varying vec3 vNormalView;
  varying vec3 vWorldPos;
  varying vec2 vUvCoord;

  void main() {
    vec3 n = normalize(vNormalView);
    float facing = clamp(abs(n.z), 0.0, 1.0);
    float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), mix(1.1, 5.2, clamp(uFresnel, 0.0, 1.0)));
    float grid = 0.5 + 0.5 * sin(vUvCoord.x * (24.0 + uContourBands * 18.0) + vUvCoord.y * (14.0 + uShearMix * 24.0) + uPulse * 8.0);
    float contour = abs(sin(vUvCoord.y * (10.0 + uContourBands * 54.0) + vUvCoord.x * (4.0 + uEchoMix * 20.0) + vWorldPos.y * 0.02));
    float contourMask = 1.0 - smoothstep(0.18, 0.82 - uContourSharpness * 0.34, contour);
    float echo = 0.5 + 0.5 * sin(length(vUvCoord - 0.5) * (12.0 + uEchoMix * 42.0) - uPulse * (3.0 + uEchoMix * 4.0));
    float rings = 0.5 + 0.5 * sin(length(vUvCoord - 0.5) * (18.0 + uRingAmount * 64.0) - uPulse * (4.0 + uRingAmount * 5.0));
    float interference = 0.5 + 0.5 * sin(vUvCoord.x * (22.0 + uInterferenceAmount * 42.0) + uPulse * 4.0) * sin(vUvCoord.y * (18.0 + uInterferenceAmount * 36.0) - uPulse * 3.0);
    float cellGrid = abs(fract(vUvCoord.x * (6.0 + uCellAmount * 14.0)) - 0.5) + abs(fract(vUvCoord.y * (6.0 + uCellAmount * 14.0)) - 0.5);
    float cellMask = 1.0 - smoothstep(0.14, 0.34, cellGrid);
    float terrace = smoothstep(0.15, 0.92, contour) * uTerraceAmount;
    vec3 base = uColor * (0.2 + facing * 0.5 + grid * 0.08);
    base = mix(base, mix(uColor * 0.42, uColor, contourMask), uPlateMix * 0.82);
    base = mix(base, base * (0.82 + rings * 0.28), uRingAmount * 0.48);
    base = mix(base, base * (0.78 + interference * 0.34), uInterferenceAmount * 0.52);
    base = mix(base, mix(base, vec3(1.0), 0.12), cellMask * uCellAmount * 0.54);
    base *= 1.0 - terrace * 0.18;
    base += vec3(1.0) * contourMask * uContourSharpness * 0.05;
    vec3 edge = mix(uColor, vec3(1.0), 0.36) * fresnel * (0.8 + uPulse * 1.2);
    edge += mix(uColor, vec3(1.0), 0.2) * echo * uEchoMix * 0.18;
    edge += mix(uColor, vec3(1.0), 0.28) * rings * uRingAmount * 0.14;
    edge += vec3(1.0) * interference * uInterferenceAmount * 0.08;
    edge += vec3(1.0) * cellMask * uCellAmount * 0.05;
    float alpha = uOpacity * clamp(0.2 + facing * 0.45 + fresnel * 0.8 + contourMask * uPlateMix * 0.18 + rings * uRingAmount * 0.08 + interference * uInterferenceAmount * 0.08, 0.0, 1.0);
    alpha *= clamp(1.0 - terrace * 0.16 + cellMask * uCellAmount * 0.08, 0.05, 1.2);

    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      base = mix(base, vec3(1.0), 0.15 + fresnel * 0.2);
      alpha *= 0.78;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      float scan = 0.5 + 0.5 * sin(vWorldPos.y * 0.1 + uPulse * 9.0);
      base = mix(base, vec3(0.25, 0.92, 1.0), 0.44);
      edge += vec3(0.08, 0.84, 1.0) * scan * 0.25;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float band = 0.5 + 0.5 * sin(vWorldPos.y * 0.08 - vWorldPos.x * 0.05);
      base = mix(vec3(0.16, 0.17, 0.2), vec3(0.95), band * 0.82);
      base *= mix(uColor, vec3(1.0), 0.42);
    } else if (uMaterialStyle > 3.5) {
      vec2 dotsUv = fract(vUvCoord * 18.0) - 0.5;
      float dots = 1.0 - smoothstep(0.1, 0.28, length(dotsUv));
      alpha *= mix(0.42, 1.0, dots);
      base *= 0.48 + dots * 0.72;
    }

    gl_FragColor = vec4(base + edge, alpha);
  }
`;

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimePatchSnapshot(config, layerIndex).mode;
}

export function getLayerPatchSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimePatchSnapshot(config, layerIndex);
}

export type PatchMode = ParticleConfig['layer2Type'];

export type PatchProfile = {
  rippleMul: number;
  opacityMul: number;
  opacityAdd: number;
  fresnelAdd: number;
  contourBands: number;
  contourSharpness: number;
  plateMix: number;
  echoMix: number;
  shearMix: number;
  planarPull: number;
  ringAmount: number;
  interferenceAmount: number;
  tremorAmount: number;
  terraceAmount: number;
  warpAmount: number;
  cellAmount: number;
  creaseAmount: number;
  edgeLift: number;
  spokeAmount: number;
  driftAmount: number;
  rotationMul: number;
  blendMode: 'additive' | 'normal';
};

const DEFAULT_PATCH_PROFILE: PatchProfile = {
  rippleMul: 1,
  opacityMul: 1,
  opacityAdd: 0,
  fresnelAdd: 0,
  contourBands: 0.18,
  contourSharpness: 0.18,
  plateMix: 0.08,
  echoMix: 0.08,
  shearMix: 0,
  planarPull: 0,
  ringAmount: 0,
  interferenceAmount: 0,
  tremorAmount: 0,
  terraceAmount: 0,
  warpAmount: 0,
  cellAmount: 0,
  creaseAmount: 0,
  edgeLift: 0,
  spokeAmount: 0,
  driftAmount: 0,
  rotationMul: 1,
  blendMode: 'additive',
};

const PATCH_PROFILES: Partial<Record<PatchMode, Partial<PatchProfile>>> = {
  surface_patch: { rippleMul: 0.9, contourBands: 0.18, contourSharpness: 0.18, plateMix: 0.16, echoMix: 0.08, planarPull: 0.12, warpAmount: 0.08, edgeLift: 0.08 },
  contour_echo: { rippleMul: 0.82, opacityMul: 0.92, fresnelAdd: 0.22, contourBands: 0.94, contourSharpness: 0.84, plateMix: 0.72, echoMix: 0.48, shearMix: 0.08, planarPull: 0.38, ringAmount: 0.24, terraceAmount: 0.82, warpAmount: 0.18, creaseAmount: 0.22, edgeLift: 0.28, rotationMul: 0.7 },
  echo_rings: { rippleMul: 1.2, opacityMul: 0.84, fresnelAdd: 0.36, contourBands: 0.86, contourSharpness: 0.62, plateMix: 0.26, echoMix: 0.92, shearMix: 0.06, planarPull: 0.18, ringAmount: 0.96, terraceAmount: 0.18, warpAmount: 0.1, edgeLift: 0.16, spokeAmount: 0.56, rotationMul: 1.12 },
  standing_interference: { rippleMul: 1.08, opacityMul: 0.88, fresnelAdd: 0.28, contourBands: 0.78, contourSharpness: 0.78, plateMix: 0.22, echoMix: 0.72, shearMix: 0.34, planarPull: 0.14, interferenceAmount: 0.96, warpAmount: 0.22, cellAmount: 0.14, creaseAmount: 0.16, driftAmount: 0.44, rotationMul: 1.04 },
  tremor_lattice: { rippleMul: 1.26, opacityMul: 0.86, fresnelAdd: 0.18, contourBands: 0.58, contourSharpness: 0.66, plateMix: 0.38, echoMix: 0.44, shearMix: 0.26, planarPull: 0.28, tremorAmount: 0.94, cellAmount: 0.82, terraceAmount: 0.24, warpAmount: 0.34, creaseAmount: 0.26, edgeLift: 0.1, driftAmount: 0.24, rotationMul: 1.08 },
};

export function getPatchProfile(mode: PatchMode): PatchProfile {
  return { ...DEFAULT_PATCH_PROFILE, ...(PATCH_PROFILES[mode] ?? {}) };
}

export type PatchSourceProfile = {
  ledger: number;
  canopy: number;
  ring: number;
  sweep: number;
  column: number;
  blob: number;
  fracture: number;
  veil: number;
};

export function getPatchSourceProfile(source: ParticleConfig['layer2Source']): PatchSourceProfile {
  switch (source) {
    case 'text':
      return { ledger: 0.9, canopy: 0.06, ring: 0.04, sweep: 0.08, column: 0.16, blob: 0.04, fracture: 0.42, veil: 0.08 };
    case 'grid':
      return { ledger: 0.72, canopy: 0.08, ring: 0.06, sweep: 0.08, column: 0.24, blob: 0.04, fracture: 0.3, veil: 0.06 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ledger: 0.04, canopy: 0.08, ring: 0.86, sweep: 0.28, column: 0.06, blob: 0.08, fracture: 0.08, veil: 0.12 };
    case 'spiral':
    case 'galaxy':
      return { ledger: 0.06, canopy: 0.1, ring: 0.22, sweep: 0.84, column: 0.08, blob: 0.08, fracture: 0.12, veil: 0.18 };
    case 'image':
    case 'video':
      return { ledger: 0.08, canopy: 0.62, ring: 0.12, sweep: 0.18, column: 0.08, blob: 0.46, fracture: 0.1, veil: 0.34 };
    case 'plane':
      return { ledger: 0.34, canopy: 0.34, ring: 0.08, sweep: 0.12, column: 0.12, blob: 0.12, fracture: 0.16, veil: 0.18 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ledger: 0.12, canopy: 0.14, ring: 0.04, sweep: 0.08, column: 0.82, blob: 0.08, fracture: 0.56, veil: 0.08 };
    case 'sphere':
    case 'center':
    case 'random':
    default:
      return { ledger: 0.08, canopy: 0.18, ring: 0.12, sweep: 0.1, column: 0.1, blob: 0.24, fracture: 0.08, veil: 0.12 };
  }
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
      config.layer2PatchResolution,
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
    config.layer3PatchResolution,
  ] as const;
}

export function buildPatchLayout(config: ParticleConfig, layerIndex: 2 | 3): PatchLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 16) return null;
  const { resolution } = getLayerPatchSettings(config, layerIndex);
  const clampedResolution = Math.max(8, Math.min(64, Math.floor(resolution)));
  const vertexCount = clampedResolution * clampedResolution;
  const sampledIndices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    sampledIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, vertexCount - 1)) * Math.max(0, particleData.count - 1)));
  }
  return { particleData, sampledIndices, resolution: clampedResolution, vertexCount };
}

export function createPatchUniforms(config: ParticleConfig, layerIndex: 2 | 3) {
  const settings = getLayerPatchSettings(config, layerIndex);
  return {
    uColor: { value: new THREE.Color(settings.color) },
    uOpacity: { value: settings.opacity },
    uPulse: { value: 0 },
    uFresnel: { value: settings.fresnel },
    uMaterialStyle: { value: 0 },
    uContourBands: { value: 0.18 },
    uContourSharpness: { value: 0.18 },
    uPlateMix: { value: 0.08 },
    uEchoMix: { value: 0.08 },
    uShearMix: { value: 0 },
    uRingAmount: { value: 0 },
    uInterferenceAmount: { value: 0 },
    uTremorAmount: { value: 0 },
    uTerraceAmount: { value: 0 },
    uCellAmount: { value: 0 },
    uCreaseAmount: { value: 0 },
    uSpokeAmount: { value: 0 },
  };
}
