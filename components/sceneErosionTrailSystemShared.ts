import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { generateParticleData, type ParticleData } from './particleData';
import { getLayerParticleLayoutDeps, getLayerRuntimeErosionTrailSnapshot } from '../lib/sceneRenderRouting';

export type TrailLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  trailCount: number;
  segmentsPerTrail: number;
};

export type ErosionProfile = {
  meander: number;
  braid: number;
  fan: number;
  notch: number;
  slump: number;
  orbit: number;
  fracture: number;
  terrace: number;
  curl: number;
};

export type ErosionTrailAudioState = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
};

export type ErosionTrailProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<ErosionTrailAudioState>;
  isPlaying: boolean;
};

export type ErosionTrailSettings = {
  trailCount: number;
  opacity: number;
  length: number;
  drift: number;
  audioReactive: number;
  color: string;
  materialStyle: ParticleConfig['layer2MaterialStyle'];
  source: ParticleConfig['layer2Source'];
  sourceSpread: number;
  sourceCount: number;
  radiusScale: number;
};

export function getErosionTrailSettings(config: ParticleConfig, layerIndex: 2 | 3): ErosionTrailSettings {
  const runtime = getLayerRuntimeErosionTrailSnapshot(config, layerIndex);
  return {
    trailCount: runtime.trailCount,
    opacity: runtime.opacity,
    length: runtime.length,
    drift: runtime.drift,
    audioReactive: runtime.audioReactive,
    color: runtime.color,
    materialStyle: runtime.materialStyle,
    source: runtime.source,
    sourceSpread: runtime.sourceSpread,
    sourceCount: runtime.sourceCount,
    radiusScale: runtime.radiusScale,
  };
}

export function getErosionProfile(config: ParticleConfig, layerIndex: 2 | 3): ErosionProfile {
  const settings = getErosionTrailSettings(config, layerIndex);
  const profile: ErosionProfile = {
    meander: 0.24,
    braid: 0.18,
    fan: 0.18,
    notch: 0.16,
    slump: 0.44,
    orbit: 0.08,
    fracture: 0.14,
    terrace: 0.18,
    curl: 0.16,
  };

  if (settings.source === 'text') {
    profile.braid += 0.26;
    profile.notch += 0.22;
    profile.fracture += 0.12;
    profile.terrace += 0.18;
  } else if (settings.source === 'image' || settings.source === 'video') {
    profile.meander += 0.22;
    profile.fan += 0.12;
    profile.curl += 0.12;
  } else if (settings.source === 'ring' || settings.source === 'disc' || settings.source === 'torus') {
    profile.orbit += 0.3;
    profile.fan += 0.2;
    profile.meander += 0.08;
  } else if (settings.source === 'spiral' || settings.source === 'galaxy') {
    profile.orbit += 0.38;
    profile.curl += 0.28;
    profile.braid += 0.08;
  } else if (settings.source === 'grid' || settings.source === 'plane') {
    profile.terrace += 0.28;
    profile.fracture += 0.22;
    profile.notch += 0.12;
  } else if (settings.source === 'cube' || settings.source === 'cylinder' || settings.source === 'cone') {
    profile.slump += 0.12;
    profile.fracture += 0.18;
    profile.fan += 0.16;
  } else {
    profile.meander += 0.1;
    profile.slump += 0.08;
    profile.curl += 0.06;
  }

  if (settings.materialStyle === 'glass') {
    profile.meander += 0.1;
    profile.curl += 0.12;
    profile.terrace -= 0.08;
  } else if (settings.materialStyle === 'hologram') {
    profile.orbit += 0.16;
    profile.braid += 0.14;
    profile.curl += 0.18;
  } else if (settings.materialStyle === 'chrome') {
    profile.fracture += 0.24;
    profile.notch += 0.14;
    profile.slump += 0.06;
  } else if (settings.materialStyle === 'halftone') {
    profile.terrace += 0.22;
    profile.notch += 0.12;
    profile.braid += 0.08;
  }

  const spreadNorm = Math.min(1.3, Math.max(0, settings.sourceSpread / 320));
  const countNorm = Math.min(1.2, Math.max(0, settings.sourceCount / 10));
  profile.fan += spreadNorm * 0.08;
  profile.braid += countNorm * 0.04;
  profile.meander += Math.min(0.24, settings.drift * 0.22);
  profile.slump += Math.min(0.2, settings.length * 0.12);
  profile.terrace = Math.max(0, profile.terrace);
  return profile;
}

export function buildErosionTrailLayout(config: ParticleConfig, layerIndex: 2 | 3): TrailLayout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 4) return null;
  const settings = getErosionTrailSettings(config, layerIndex);
  const trailCount = Math.max(8, Math.min(256, Math.floor(settings.trailCount)));
  const dynamicSegments = Math.round(4 + settings.length * 7 + settings.drift * 5 + Math.min(2, settings.sourceCount * 0.2));
  const segmentsPerTrail = Math.max(5, Math.min(18, dynamicSegments));
  const sampledIndices = new Uint32Array(trailCount);
  for (let i = 0; i < trailCount; i += 1) {
    sampledIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, trailCount - 1)) * Math.max(0, particleData.count - 1)));
  }
  return { particleData, sampledIndices, trailCount, segmentsPerTrail };
}

export function getErosionTrailLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeErosionTrailSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.trailCount, runtime.length, runtime.drift]);
}

export const EROSION_TRAIL_VERTEX_SHADER = `
  attribute float trailMix;
  varying float vTrailMix;
  varying vec3 vWorldPos;
  void main() {
    vTrailMix = trailMix;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const EROSION_TRAIL_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uMaterialStyle;
  uniform float uTime;
  uniform float uBraid;
  uniform float uFracture;
  uniform float uTerrace;
  uniform float uOrbit;
  varying float vTrailMix;
  varying vec3 vWorldPos;
  void main() {
    float fade = 1.0 - smoothstep(0.0, 1.0, vTrailMix);
    float sediment = 0.5 + 0.5 * sin(vWorldPos.y * (0.08 + uTerrace * 0.05) - vWorldPos.x * 0.05 + uTime * 0.4);
    float braid = 0.5 + 0.5 * sin(vWorldPos.x * 0.09 + vWorldPos.z * 0.07 + uTime * (0.35 + uBraid * 0.5));
    float fracture = smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(vWorldPos.x * 0.18 - vWorldPos.y * 0.06 + uTime * 0.22));
    float orbit = 0.5 + 0.5 * sin(length(vWorldPos.xz) * 0.05 - uTime * (0.28 + uOrbit * 0.44));
    vec3 color = uColor * mix(0.42, 1.02, sediment);
    color *= mix(0.88, 1.14, braid * uBraid + orbit * uOrbit * 0.4);
    float alpha = uOpacity * mix(0.08, 1.0, fade);
    alpha *= mix(0.82, 1.18, fracture * uFracture + (1.0 - sediment) * uTerrace * 0.45);
    color += vec3(1.0) * uPulse * 0.04 * fade;
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.92, 0.97, 1.0), 0.22);
      alpha *= 0.82;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      color = mix(color, vec3(0.18, 0.96, 1.0), 0.52);
      alpha *= 1.08;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float band = 0.5 + 0.5 * sin(vWorldPos.y * 0.18 - vWorldPos.x * 0.08 + fracture * 1.6);
      color = mix(vec3(0.2), vec3(1.0), band) * mix(uColor, vec3(1.0), 0.42);
    } else if (uMaterialStyle > 3.5) {
      float gate = step(0.3, fract(vWorldPos.y * (0.06 + uTerrace * 0.04) + vWorldPos.x * 0.03));
      alpha *= mix(0.34, 1.0, gate);
      color *= 0.46 + gate * 0.54;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createErosionTrailUniforms() {
  return {
    uColor: { value: new THREE.Color('#ffffff') },
    uOpacity: { value: 0.35 },
    uPulse: { value: 0 },
    uMaterialStyle: { value: 0 },
    uTime: { value: 0 },
    uBraid: { value: 0 },
    uFracture: { value: 0 },
    uTerrace: { value: 0 },
    uOrbit: { value: 0 },
  };
}
