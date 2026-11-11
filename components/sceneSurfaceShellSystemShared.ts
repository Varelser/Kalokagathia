import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { ParticleConfig } from '../types';
import { generateParticleData, type ParticleData } from './particleData';
import { withCrossFamilyShellProfile, withSourceAwareShellProfile } from '../lib/sourceAwareShaping';
import { getLayerParticleLayoutDeps, getLayerRuntimeHullSnapshot, getLayerRuntimeMode, getLayerRuntimeSource } from '../lib/sceneRenderRouting';

export type HullLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  usedCount: number;
};

export type ShellMode = ParticleConfig['layer2Type'];

export type ShellProfile = {
  jitterMul: number;
  opacityMul: number;
  opacityAdd: number;
  fresnelAdd: number;
  wireframe: boolean | null;
  wireOpacity: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  radialLift: number;
  ringLift: number;
  spikeStrength: number;
  quantize: number;
  droop: number;
  mirrorWarp: number;
  scriptWarp: number;
  ridgeAmount: number;
  ridgeFreq: number;
  seamAmount: number;
  petalAmount: number;
  frostAmount: number;
  crownAmount: number;
  riftAmount: number;
  creaseAmount: number;
  scanScale: number;
  bandStrength: number;
  grainStrength: number;
  haloSpread: number;
  haloSharpness: number;
  edgeTint: number;
  etchStrength: number;
  equatorBias: number;
  poreAmount: number;
  sporeAmount: number;
  bloomAmount: number;
  centerDarkness: number;
  auraAmount: number;
  diskAmount: number;
  lacquerAmount: number;
  flowAmount: number;
  blendMode: 'additive' | 'normal';
};

export const DEFAULT_SHELL_PROFILE: ShellProfile = {
  jitterMul: 1,
  opacityMul: 1,
  opacityAdd: 0,
  fresnelAdd: 0,
  wireframe: null,
  wireOpacity: 0.28,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  radialLift: 0,
  ringLift: 0,
  spikeStrength: 0,
  quantize: 0,
  droop: 0,
  mirrorWarp: 0,
  scriptWarp: 0,
  ridgeAmount: 0,
  ridgeFreq: 3.2,
  seamAmount: 0,
  petalAmount: 0,
  frostAmount: 0,
  crownAmount: 0,
  riftAmount: 0,
  creaseAmount: 0,
  scanScale: 0.16,
  bandStrength: 0.18,
  grainStrength: 0.08,
  haloSpread: 0.14,
  haloSharpness: 0.18,
  edgeTint: 0.18,
  etchStrength: 0.08,
  equatorBias: 0,
  poreAmount: 0,
  sporeAmount: 0,
  bloomAmount: 0,
  centerDarkness: 0,
  auraAmount: 0,
  diskAmount: 0,
  lacquerAmount: 0,
  flowAmount: 0,
  blendMode: 'additive',
};

const SHELL_PROFILES: Partial<Record<ShellMode, Partial<ShellProfile>>> = {
  aura_shell: { crownAmount: 0.48, creaseAmount: 0.08, jitterMul: 0.5, opacityMul: 0.86, fresnelAdd: 0.24, scaleX: 1.08, scaleY: 0.92, scaleZ: 1.08, radialLift: 0.08, ridgeAmount: 0.14, ridgeFreq: 4.2, petalAmount: 0.22, haloSpread: 0.7, haloSharpness: 0.42, scanScale: 0.28, edgeTint: 0.52, bloomAmount: 0.34, auraAmount: 0.92, diskAmount: 0.12, wireframe: false },
  halo_bloom: { crownAmount: 0.34, creaseAmount: 0.12, jitterMul: 0.72, opacityMul: 1.22, fresnelAdd: 0.34, scaleX: 1.16, scaleY: 0.74, scaleZ: 1.16, radialLift: 0.1, ringLift: 0.2, ridgeAmount: 0.08, ridgeFreq: 6.0, petalAmount: 0.36, haloSpread: 1.08, haloSharpness: 0.94, edgeTint: 0.96, bloomAmount: 0.92, equatorBias: 0.18, centerDarkness: 0.24, wireframe: false },
  mirror_skin: { riftAmount: 0.22, creaseAmount: 0.2, jitterMul: 0.34, opacityMul: 0.86, fresnelAdd: 0.22, scaleX: 1.22, scaleY: 0.92, scaleZ: 0.76, mirrorWarp: 0.18, seamAmount: 0.78, ridgeAmount: 0.12, ridgeFreq: 2.0, scanScale: 0.84, bandStrength: 0.66, grainStrength: 0.04, haloSpread: 0.24, haloSharpness: 0.16, edgeTint: 0.54, etchStrength: 0.22, wireframe: false },
  membrane_pollen: { crownAmount: 0.14, riftAmount: 0.08, jitterMul: 0.54, opacityMul: 1.08, fresnelAdd: 0.28, scaleX: 1.04, scaleY: 0.96, scaleZ: 1.04, spikeStrength: 0.1, ridgeAmount: 0.18, ridgeFreq: 7.0, petalAmount: 0.12, scanScale: 0.36, bandStrength: 0.32, grainStrength: 0.28, haloSpread: 0.42, haloSharpness: 0.28, edgeTint: 0.42, poreAmount: 0.78, sporeAmount: 0.24, bloomAmount: 0.16, equatorBias: 0.04, blendMode: 'normal' },
  spore_halo: { crownAmount: 0.26, riftAmount: 0.12, jitterMul: 0.72, opacityMul: 1.06, fresnelAdd: 0.36, radialLift: 0.06, ringLift: 0.16, ridgeAmount: 0.16, ridgeFreq: 8.0, petalAmount: 0.18, scanScale: 0.24, bandStrength: 0.26, grainStrength: 0.38, haloSpread: 0.94, haloSharpness: 0.82, edgeTint: 0.76, sporeAmount: 0.84, bloomAmount: 0.42, equatorBias: 0.1, centerDarkness: 0.18, wireframe: false },
  calcified_skin: { riftAmount: 0.28, creaseAmount: 0.32, jitterMul: 0.16, opacityMul: 0.82, fresnelAdd: 0.08, wireframe: true, wireOpacity: 0.48, quantize: 0.17, ridgeAmount: 0.48, ridgeFreq: 5.0, seamAmount: 0.22, frostAmount: 0.14, scanScale: 0.12, bandStrength: 0.14, grainStrength: 0.56, haloSpread: 0.16, haloSharpness: 0.18, edgeTint: 0.12, etchStrength: 0.04 },
  residue_skin: { riftAmount: 0.18, creaseAmount: 0.22, jitterMul: 0.22, opacityMul: 0.62, fresnelAdd: 0.1, wireframe: true, wireOpacity: 0.34, quantize: 0.08, droop: 0.18, seamAmount: 0.34, ridgeAmount: 0.2, ridgeFreq: 2.4, scanScale: 0.22, bandStrength: 0.3, grainStrength: 0.42, haloSpread: 0.12, haloSharpness: 0.12, edgeTint: 0.12, etchStrength: 0.12 },
  shell_script: { creaseAmount: 0.44, riftAmount: 0.12, jitterMul: 0.24, opacityMul: 0.88, fresnelAdd: 0.28, wireframe: true, wireOpacity: 0.24, scaleX: 1.12, scaleY: 0.9, scaleZ: 1.16, radialLift: 0.02, scriptWarp: 0.28, ridgeAmount: 0.26, ridgeFreq: 9.0, seamAmount: 0.48, scanScale: 1.08, bandStrength: 1.02, grainStrength: 0.1, haloSpread: 0.26, haloSharpness: 0.24, edgeTint: 0.46, etchStrength: 0.96, blendMode: 'normal' },
  eclipse_halo: { crownAmount: 0.12, creaseAmount: 0.2, jitterMul: 0.16, opacityMul: 0.9, fresnelAdd: 0.46, wireframe: false, scaleX: 1.26, scaleY: 0.5, scaleZ: 1.26, radialLift: 0.02, ringLift: 0.3, petalAmount: 0.18, ridgeAmount: 0.12, ridgeFreq: 6.0, scanScale: 0.16, bandStrength: 0.28, haloSpread: 1.08, haloSharpness: 1, edgeTint: 1, etchStrength: 0.04, equatorBias: 0.2, bloomAmount: 0.3, centerDarkness: 0.72, diskAmount: 0.94 },
  resin_shell: { crownAmount: 0.08, creaseAmount: 0.14, jitterMul: 0.1, opacityMul: 1.02, opacityAdd: 0.04, fresnelAdd: 0.14, wireframe: false, scaleX: 1.08, scaleY: 0.88, scaleZ: 1.1, droop: 0.16, ridgeAmount: 0.1, ridgeFreq: 3.0, scanScale: 0.1, bandStrength: 0.16, grainStrength: 0.03, haloSpread: 0.08, haloSharpness: 0.1, edgeTint: 0.18, etchStrength: 0.02, lacquerAmount: 0.92, flowAmount: 0.48, blendMode: 'normal' },
  freeze_skin: { riftAmount: 0.16, creaseAmount: 0.24, jitterMul: 0.08, opacityMul: 0.9, opacityAdd: -0.02, fresnelAdd: 0.34, wireframe: false, scaleX: 1.04, scaleY: 0.94, scaleZ: 1.04, radialLift: 0.02, ringLift: 0.08, quantize: 0.14, ridgeAmount: 0.34, ridgeFreq: 7.0, seamAmount: 0.18, frostAmount: 0.92, scanScale: 0.08, bandStrength: 0.24, grainStrength: 0.16, haloSpread: 0.22, haloSharpness: 0.74, edgeTint: 0.62, etchStrength: 0.18, poreAmount: 0.04, sporeAmount: 0.02, bloomAmount: 0.1, centerDarkness: 0.06, diskAmount: 0.18, blendMode: 'normal' },
};

export const SHELL_VERTEX_SHADER = `
  varying vec3 vNormalView;
  varying vec3 vWorldPos;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const SHELL_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uFresnel;
  uniform float uMaterialStyle;
  uniform float uScanScale;
  uniform float uBandStrength;
  uniform float uGrainStrength;
  uniform float uHaloSpread;
  uniform float uHaloSharpness;
  uniform float uEdgeTint;
  uniform float uEtchStrength;
  uniform float uPoreAmount;
  uniform float uSporeAmount;
  uniform float uBloomAmount;
  uniform float uCenterDarkness;
  uniform float uAuraAmount;
  uniform float uDiskAmount;
  uniform float uLacquerAmount;
  uniform float uFlowAmount;
  uniform float uRidgeAmount;
  uniform float uSeamAmount;
  uniform float uFrostAmount;
  uniform float uCrownAmount;
  uniform float uRiftAmount;
  uniform float uCreaseAmount;
  varying vec3 vNormalView;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  void main() {
    vec3 n = normalize(vNormalView);
    float facing = clamp(abs(n.z), 0.0, 1.0);
    float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), mix(1.2, 4.8, clamp(uFresnel, 0.0, 1.0)));
    float scan = 0.5 + 0.5 * sin(vWorldPos.y * (0.06 + uScanScale * 0.18) + vWorldPos.x * (0.03 + uBandStrength * 0.09) + uPulse * (4.0 + uEtchStrength * 3.6));
    float etch = 0.5 + 0.5 * sin((vWorldPos.x * 0.08 + vWorldPos.z * 0.06) * (2.0 + uBandStrength * 4.6) + vWorldPos.y * (0.03 + uEtchStrength * 0.12));
    vec3 dir = normalize(vWorldPos + vec3(1e-5));
    float equator = 1.0 - abs(dir.y);
    float halo = pow(clamp(1.0 - facing, 0.0, 1.0), 0.85 + uHaloSpread * 4.25);
    float ring = pow(clamp(equator, 0.0, 1.0), 1.1 + uHaloSharpness * 4.6);
    float bloom = smoothstep(0.18, 0.92, equator) * (0.45 + 0.55 * scan);
    float grain = hash(floor(vWorldPos * 0.24));
    float poreCell = hash(floor(vWorldPos * (0.12 + uPoreAmount * 0.26)) + vec3(7.0, 19.0, 31.0));
    float poreMask = (1.0 - smoothstep(0.46, 0.78, poreCell)) * uPoreAmount * ring;
    float sporeCell = hash(floor(vWorldPos * (0.08 + uSporeAmount * 0.22)) + vec3(17.0, 29.0, 11.0));
    float sporeMask = smoothstep(0.72, 0.96, sporeCell) * (0.2 + ring * 0.8) * uSporeAmount;
    float centerShade = facing * (1.0 - ring) * uCenterDarkness;
    float auraGlow = pow(clamp(1.0 - facing, 0.0, 1.0), 0.48 + uAuraAmount * 2.2) * (0.35 + 0.65 * scan);
    float diskMask = mix(1.0, smoothstep(0.08, 0.96, ring), clamp(uDiskAmount, 0.0, 1.0));
    float lacquerSpec = pow(max(0.0, dot(normalize(vec3(0.34, 0.72, 0.58)), n)), 4.0 + uLacquerAmount * 22.0);
    float flowWave = 0.5 + 0.5 * sin(vWorldPos.y * (0.1 + uFlowAmount * 0.28) - vWorldPos.z * 0.08 + uPulse * (2.8 + uFlowAmount * 2.2));
    float azimuth = atan(vWorldPos.z, vWorldPos.x);
    float ridgeWave = 0.5 + 0.5 * sin(azimuth * (3.0 + uRidgeAmount * 9.0) + vWorldPos.y * 0.04 + uPulse * 2.4);
    float seamMask = 1.0 - smoothstep(0.08, 0.34 + uSeamAmount * 0.26, abs(sin(azimuth * 0.5)));
    float frostNoise = hash(floor(vWorldPos * (0.12 + uFrostAmount * 0.34)) + vec3(23.0, 5.0, 17.0));
    float frostMask = smoothstep(0.58, 0.94, frostNoise) * (0.24 + ring * 0.76) * uFrostAmount;
    vec3 base = uColor * (0.16 + facing * 0.46 + scan * 0.1 + etch * uEtchStrength * 0.16 + bloom * uBloomAmount * 0.08 + auraGlow * uAuraAmount * 0.1 + lacquerSpec * uLacquerAmount * 0.12);
    base *= 0.92 + mix(-0.16, 0.18, grain) * uGrainStrength;
    base *= 1.0 - centerShade * (0.52 + uDiskAmount * 0.2);
    base *= 1.0 - poreMask * 0.24;
    base = mix(base, base * (0.88 + flowWave * 0.2), uFlowAmount * 0.55);
    base = mix(base, base * (0.84 + ridgeWave * 0.28), uRidgeAmount * 0.46);
    base = mix(base, mix(base, vec3(1.0), 0.22 + ridgeWave * 0.18), frostMask * 0.72);
    vec3 edgeColor = mix(uColor, vec3(1.0), 0.18 + uEdgeTint * 0.36 + sporeMask * 0.2 + uBloomAmount * 0.08 + uAuraAmount * 0.12 + uLacquerAmount * 0.08 + frostMask * 0.22);
    vec3 edge = edgeColor * (fresnel * (0.82 + uPulse * 1.28) + halo * (0.18 + uHaloSpread * 0.64) + ring * uBloomAmount * (0.38 + uDiskAmount * 0.24) + sporeMask * 0.22 + auraGlow * uAuraAmount * 0.54 + lacquerSpec * uLacquerAmount * 0.28 + seamMask * uSeamAmount * 0.24 + frostMask * 0.18);
    float alpha = uOpacity * clamp((0.16 + facing * 0.4 + fresnel * 0.58 + halo * 0.28 + etch * uEtchStrength * 0.1 + ring * uBloomAmount * 0.14 + ridgeWave * uRidgeAmount * 0.12) * mix(1.0, diskMask, 0.42 * uDiskAmount) + auraGlow * uAuraAmount * 0.2 + lacquerSpec * uLacquerAmount * 0.08, 0.0, 1.0);
    alpha *= clamp(1.0 - poreMask * 0.42 + sporeMask * 0.12 - centerShade * (0.28 + uDiskAmount * 0.12) + flowWave * uFlowAmount * 0.06 + seamMask * uSeamAmount * 0.08 + frostMask * 0.1, 0.05, 1.2);
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      base = mix(base, vec3(1.0), 0.12 + fresnel * 0.18);
      edge += vec3(0.12, 0.18, 0.26) * 0.28;
      alpha *= 0.78;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      float holo = 0.5 + 0.5 * sin(vWorldPos.y * 0.12 + uPulse * 10.0 + uScanScale * 6.0);
      base = mix(base, vec3(0.3, 0.92, 1.0), 0.42);
      edge += vec3(0.1, 0.8, 1.0) * holo * 0.28;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float band = 0.5 + 0.5 * sin(vWorldPos.y * 0.06 - vWorldPos.x * (0.04 + uBandStrength * 0.05));
      base = mix(vec3(0.16, 0.17, 0.2), vec3(0.95), band * 0.8);
      base *= mix(uColor, vec3(1.0), 0.4);
    } else if (uMaterialStyle > 3.5) {
      vec2 dotsUv = fract(vWorldPos.xy * 0.06) - 0.5;
      float dots = 1.0 - smoothstep(0.08, 0.28, length(dotsUv));
      alpha *= mix(0.42, 1.0, dots);
      base *= 0.5 + dots * 0.7;
    }
    gl_FragColor = vec4(base + edge, alpha);
  }
`;

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

export function getShellProfile(mode: ShellMode): ShellProfile {
  return { ...DEFAULT_SHELL_PROFILE, ...(SHELL_PROFILES[mode] ?? {}) };
}

export type ShellSourceGeometryProfile = {
  ledger: number;
  canopy: number;
  ring: number;
  orbit: number;
  column: number;
  fracture: number;
  veil: number;
  bloom: number;
  lacquer: number;
};

export function getSourceShellGeometryProfile(source: ParticleConfig['layer2Source']): ShellSourceGeometryProfile {
  switch (source) {
    case 'text':
      return { ledger: 0.86, canopy: 0.08, ring: 0.04, orbit: 0.06, column: 0.18, fracture: 0.42, veil: 0.1, bloom: 0.04, lacquer: 0.04 };
    case 'grid':
      return { ledger: 0.64, canopy: 0.08, ring: 0.06, orbit: 0.04, column: 0.28, fracture: 0.34, veil: 0.08, bloom: 0.04, lacquer: 0.04 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ledger: 0.04, canopy: 0.08, ring: 0.84, orbit: 0.52, column: 0.04, fracture: 0.08, veil: 0.12, bloom: 0.24, lacquer: 0.08 };
    case 'spiral':
    case 'galaxy':
      return { ledger: 0.06, canopy: 0.12, ring: 0.24, orbit: 0.82, column: 0.08, fracture: 0.12, veil: 0.28, bloom: 0.18, lacquer: 0.06 };
    case 'image':
    case 'video':
      return { ledger: 0.08, canopy: 0.58, ring: 0.1, orbit: 0.14, column: 0.08, fracture: 0.1, veil: 0.34, bloom: 0.46, lacquer: 0.14 };
    case 'plane':
      return { ledger: 0.34, canopy: 0.26, ring: 0.08, orbit: 0.08, column: 0.12, fracture: 0.18, veil: 0.18, bloom: 0.12, lacquer: 0.08 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ledger: 0.16, canopy: 0.12, ring: 0.04, orbit: 0.06, column: 0.82, fracture: 0.56, veil: 0.1, bloom: 0.08, lacquer: 0.12 };
    case 'sphere':
    case 'center':
    case 'random':
    default:
      return { ledger: 0.08, canopy: 0.18, ring: 0.12, orbit: 0.08, column: 0.12, fracture: 0.08, veil: 0.12, bloom: 0.24, lacquer: 0.08 };
  }
}

export function getLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeHullSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.pointBudget]);
}

export function buildHullLayout(config: ParticleConfig, layerIndex: 2 | 3): HullLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 12) return null;
  const pointBudget = getLayerRuntimeHullSnapshot(config, layerIndex).pointBudget;
  const usedCount = Math.max(12, Math.min(particleData.count, Math.floor(pointBudget)));
  const sampledIndices = new Uint32Array(usedCount);
  for (let i = 0; i < usedCount; i += 1) {
    sampledIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, usedCount - 1)) * Math.max(0, particleData.count - 1)));
  }
  return { particleData, sampledIndices, usedCount };
}

export function resolveShellProfile(config: ParticleConfig, layerIndex: 2 | 3) {
  const layerMode = getLayerMode(config, layerIndex);
  const layerSource = getLayerRuntimeSource(config, layerIndex);
  return withCrossFamilyShellProfile(withSourceAwareShellProfile(getShellProfile(layerMode), layerSource), layerMode, layerSource);
}

export function createConvexHullGeometry(points: THREE.Vector3[]) {
  const geometry = new ConvexGeometry(points);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createShellUniforms(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeHullSnapshot(config, layerIndex);
  return {
    uColor: { value: new THREE.Color(runtime.color) },
    uOpacity: { value: runtime.opacity },
    uPulse: { value: 0 },
    uFresnel: { value: runtime.fresnel },
    uMaterialStyle: { value: 0 },
    uScanScale: { value: DEFAULT_SHELL_PROFILE.scanScale },
    uBandStrength: { value: DEFAULT_SHELL_PROFILE.bandStrength },
    uGrainStrength: { value: DEFAULT_SHELL_PROFILE.grainStrength },
    uHaloSpread: { value: DEFAULT_SHELL_PROFILE.haloSpread },
    uHaloSharpness: { value: DEFAULT_SHELL_PROFILE.haloSharpness },
    uEdgeTint: { value: DEFAULT_SHELL_PROFILE.edgeTint },
    uEtchStrength: { value: DEFAULT_SHELL_PROFILE.etchStrength },
    uPoreAmount: { value: DEFAULT_SHELL_PROFILE.poreAmount },
    uSporeAmount: { value: DEFAULT_SHELL_PROFILE.sporeAmount },
    uBloomAmount: { value: DEFAULT_SHELL_PROFILE.bloomAmount },
    uCenterDarkness: { value: DEFAULT_SHELL_PROFILE.centerDarkness },
    uAuraAmount: { value: DEFAULT_SHELL_PROFILE.auraAmount },
    uDiskAmount: { value: DEFAULT_SHELL_PROFILE.diskAmount },
    uLacquerAmount: { value: DEFAULT_SHELL_PROFILE.lacquerAmount },
    uFlowAmount: { value: DEFAULT_SHELL_PROFILE.flowAmount },
    uRidgeAmount: { value: DEFAULT_SHELL_PROFILE.ridgeAmount },
    uSeamAmount: { value: DEFAULT_SHELL_PROFILE.seamAmount },
    uFrostAmount: { value: DEFAULT_SHELL_PROFILE.frostAmount },
    uCrownAmount: { value: DEFAULT_SHELL_PROFILE.crownAmount },
    uRiftAmount: { value: DEFAULT_SHELL_PROFILE.riftAmount },
    uCreaseAmount: { value: DEFAULT_SHELL_PROFILE.creaseAmount },
  };
}
