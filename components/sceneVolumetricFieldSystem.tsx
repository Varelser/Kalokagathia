import React from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimeConfigSnapshot, getLayerRuntimeSource } from '../lib/sceneRenderRouting';

type Props = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

type VolumeProfile = {
  swirl: number;
  plume: number;
  ring: number;
  cell: number;
  dissolve: number;
  ember: number;
  veil: number;
  anisotropy: number;
  pulseNoise: number;
  shellBias: number;
  cavity: number;
  tint: THREE.ColorRepresentation;
};

const DEFAULT_PROFILE: VolumeProfile = {
  swirl: 0.18,
  plume: 0.18,
  ring: 0,
  cell: 0,
  dissolve: 0,
  ember: 0,
  veil: 0.2,
  anisotropy: 0.24,
  pulseNoise: 0.18,
  shellBias: 0.1,
  cavity: 0.08,
  tint: '#ffffff',
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<VolumeProfile>>> = {
  volume_fog: { veil: 0.32, anisotropy: 0.18, tint: '#d8e6ff' },
  dust_plume: { plume: 0.86, dissolve: 0.12, veil: 0.14, tint: '#d8c9aa' },
  ashfall: { plume: 0.2, dissolve: 0.36, anisotropy: 0.12, tint: '#c1bcc4' },
  vapor_canopy: { plume: 0.42, shellBias: 0.28, cavity: 0.12, tint: '#d9f7ff' },
  ember_swarm: { ember: 0.82, swirl: 0.34, tint: '#ffba68' },
  soot_veil: { veil: 0.72, dissolve: 0.24, tint: '#8a8480' },
  foam_drift: { veil: 0.42, cavity: 0.18, plume: 0.28, tint: '#eaf8ff' },
  charge_veil: { veil: 0.48, anisotropy: 0.62, pulseNoise: 0.44, tint: '#9ee6ff' },
  prism_smoke: { swirl: 0.28, veil: 0.4, tint: '#ffd8ff' },
  rune_smoke: { cell: 0.32, veil: 0.28, pulseNoise: 0.38, tint: '#c9d6ff' },
  mirage_smoke: { dissolve: 0.2, anisotropy: 0.54, swirl: 0.42, tint: '#ffe8c8' },
  ion_rain: { anisotropy: 0.82, dissolve: 0.16, pulseNoise: 0.46, tint: '#b0dfff' },
  velvet_ash: { veil: 0.58, shellBias: 0.22, tint: '#d6d0da' },
  static_smoke: { cell: 0.48, pulseNoise: 0.88, anisotropy: 0.12, tint: '#d7ecff' },
  ember_drift: { ember: 0.62, swirl: 0.22, plume: 0.24, tint: '#ffc47d' },
  vortex_transport: { swirl: 0.9, plume: 0.34, ring: 0.18, anisotropy: 0.44, tint: '#c6f0ff' },
  pressure_cells: { cell: 0.92, cavity: 0.2, veil: 0.12, tint: '#d8efff' },
  condense_field: { cavity: 0.22, shellBias: 0.34, veil: 0.2, tint: '#dff6ff' },
  sublimate_cloud: { dissolve: 0.86, cavity: 0.4, ring: 0.18, veil: 0.24, tint: '#eef8ff' },
};

function getSourceAdjustments(source: ParticleConfig['layer2Source']) {
  switch (source) {
    case 'text':
      return { cell: 0.18, shellBias: 0.08, ring: 0.02, veil: -0.04 };
    case 'grid':
      return { cell: 0.28, shellBias: 0.12, veil: -0.06 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ring: 0.38, swirl: 0.12, shellBias: 0.1 };
    case 'spiral':
    case 'galaxy':
      return { swirl: 0.24, plume: 0.08, anisotropy: 0.08 };
    case 'image':
    case 'video':
      return { veil: 0.1, cavity: 0.08, shellBias: 0.06 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { plume: 0.12, shellBias: 0.18, dissolve: 0.08 };
    case 'plane':
      return { veil: 0.08, shellBias: 0.12 };
    default:
      return {};
  }
}

function getSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex);
  return {
    mode: runtime.mode,
    source: runtime.source,
    color: runtime.color,
    radiusScale: runtime.radiusScale,
    opacity: layerIndex === 2 ? config.layer2FogOpacity : config.layer3FogOpacity,
    density: layerIndex === 2 ? config.layer2FogDensity : config.layer3FogDensity,
    depth: layerIndex === 2 ? config.layer2FogDepth : config.layer3FogDepth,
    scale: layerIndex === 2 ? config.layer2FogScale : config.layer3FogScale,
    drift: layerIndex === 2 ? config.layer2FogDrift : config.layer3FogDrift,
    glow: layerIndex === 2 ? config.layer2FogGlow : config.layer3FogGlow,
    anisotropy: layerIndex === 2 ? config.layer2FogAnisotropy : config.layer3FogAnisotropy,
    audioReactive: layerIndex === 2 ? config.layer2FogAudioReactive : config.layer3FogAudioReactive,
    materialStyle: runtime.materialStyle,
  };
}

const VERTEX_SHADER = `
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  void main() {
    vLocalPos = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vLocalPos;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDensity;
  uniform float uAudio;
  uniform float uGlow;
  uniform float uSwirl;
  uniform float uPlume;
  uniform float uRing;
  uniform float uCell;
  uniform float uDissolve;
  uniform float uEmber;
  uniform float uVeil;
  uniform float uAnisotropy;
  uniform float uPulseNoise;
  uniform float uShellBias;
  uniform float uCavity;
  uniform float uMaterialStyle;
  uniform vec3 uCamLocal;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 191.3))) * 43758.5453123);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * amp;
      p = p * 2.03 + vec3(13.4, 8.1, 5.7);
      amp *= 0.5;
    }
    return value;
  }

  float sampleDensity(vec3 p) {
    float radius = length(p);
    float shell = smoothstep(1.18, 0.18 + uShellBias * 0.22, radius);
    float cavity = smoothstep(0.12, 0.42 + uCavity * 0.22, radius);
    float theta = atan(p.y, p.x);
    float ringWave = sin(theta * (4.0 + uRing * 10.0) + p.z * (2.0 + uRing * 6.0));
    float plume = smoothstep(1.1, 0.12, abs(p.x) * (1.0 + uPlume * 2.2) + max(0.0, -p.y) * 0.4);
    float cell = 1.0 - smoothstep(0.18, 0.44, abs(fract((p + 1.0) * (1.8 + uCell * 4.8)) - 0.5).x + abs(fract((p + 1.0) * (1.8 + uCell * 4.8)) - 0.5).y);
    float swirl = sin(theta * (2.0 + uSwirl * 10.0) + radius * (3.0 + uSwirl * 6.0) - uTime * (0.35 + uSwirl * 0.9));
    vec3 drift = vec3(uTime * 0.12, -uTime * 0.07, uTime * 0.05);
    float field = fbm(p * (1.8 + uVeil * 1.2) + drift + vec3(swirl * 0.16, plume * 0.1, ringWave * 0.12));
    float pulse = fbm(p * (2.4 + uPulseNoise * 2.2) - drift * 1.2);
    float dissolve = smoothstep(0.16, 0.86, fbm(p * (2.8 + uDissolve * 4.0) + 3.7));
    float density = shell * (0.42 + field * 0.9);
    density += plume * uPlume * 0.48;
    density += cell * uCell * 0.22;
    density += ringWave * uRing * 0.14;
    density += swirl * uSwirl * 0.12;
    density *= mix(1.0, cavity, 0.35 + uCavity * 0.4);
    density *= 1.0 - dissolve * uDissolve * 0.64;
    density += pulse * uPulseNoise * 0.18;
    return max(0.0, density);
  }

  void main() {
    vec3 camLocal = uCamLocal;
    vec3 rayDir = normalize(vLocalPos - camLocal);
    vec3 pos = vLocalPos;
    float alpha = 0.0;
    vec3 accum = vec3(0.0);
    const int STEPS = 24;
    float stepSize = 0.08;
    for (int i = 0; i < STEPS; i++) {
      if (max(abs(pos.x), max(abs(pos.y), abs(pos.z))) > 1.35) break;
      float d = sampleDensity(pos);
      float localAlpha = d * uDensity * 0.07;
      float ember = smoothstep(0.72, 0.96, fbm(pos * 5.8 + uTime * 0.4)) * uEmber;
      vec3 color = uColor;
      color += vec3(1.0, 0.42, 0.08) * ember * 0.6;
      float forward = pow(max(0.0, dot(normalize(camLocal - pos), rayDir * -1.0)), 1.0 + uAnisotropy * 2.0);
      color += uColor * uGlow * forward * 0.28;
      if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
        color += vec3(0.16, 0.18, 0.22) * forward;
      } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
        color += vec3(0.12, 0.06, 0.18) * (0.4 + fbm(pos * (2.4 + uPulseNoise * 2.2)) * 0.6);
      }
      accum += (1.0 - alpha) * color * localAlpha;
      alpha += (1.0 - alpha) * localAlpha;
      pos += rayDir * stepSize;
    }
    alpha *= uOpacity * (0.78 + uAudio * 0.36);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(accum, clamp(alpha, 0.0, 1.0));
  }
`;

export const VolumetricFieldSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const settings = getSettings(config, layerIndex);
  const source = getLayerRuntimeSource(config, layerIndex);
  const profile = React.useMemo(() => {
    const base = { ...DEFAULT_PROFILE, ...(MODE_PROFILES[settings.mode] ?? {}) } as VolumeProfile;
    const sourceAdjustments = getSourceAdjustments(source);
    return {
      ...base,
      swirl: base.swirl + (sourceAdjustments.swirl ?? 0),
      plume: base.plume + (sourceAdjustments.plume ?? 0),
      ring: base.ring + (sourceAdjustments.ring ?? 0),
      cell: base.cell + (sourceAdjustments.cell ?? 0),
      dissolve: base.dissolve + (sourceAdjustments.dissolve ?? 0),
      veil: base.veil + (sourceAdjustments.veil ?? 0),
      shellBias: base.shellBias + (sourceAdjustments.shellBias ?? 0),
      cavity: base.cavity + (sourceAdjustments.cavity ?? 0),
      anisotropy: base.anisotropy + (sourceAdjustments.anisotropy ?? 0),
    };
  }, [settings.mode, source]);

  const materialRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const meshRef = React.useRef<THREE.Mesh | null>(null);
  const color = React.useMemo(() => new THREE.Color(settings.color), [settings.color]);
  const tint = React.useMemo(() => new THREE.Color(profile.tint), [profile.tint]);
  const materialStyleIndex = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
  const scaleBase = config.sphereRadius * settings.radiusScale * (0.9 + settings.scale * 0.6);
  const depthScale = scaleBase * (0.78 + settings.depth * 0.42);

  useFrame(({ clock, camera }) => {
    const mat = materialRef.current;
    if (!mat) return;
    const mesh = meshRef.current;
    if (mesh) {
      (mat.uniforms.uCamLocal.value as THREE.Vector3).copy(mesh.worldToLocal(camera.position.clone()));
    }
    const t = clock.getElapsedTime();
    const audioMix = config.audioEnabled
      ? (audioRef.current.bass * 0.5 + audioRef.current.treble * 0.25 + audioRef.current.pulse * 0.25) * settings.audioReactive
      : 0;
    mat.uniforms.uTime.value = t * (isPlaying ? 1 : 0.2);
    mat.uniforms.uAudio.value = audioMix;
    mat.uniforms.uOpacity.value = settings.opacity;
    mat.uniforms.uDensity.value = settings.density * (1.0 + audioMix * 0.18);
    mat.uniforms.uGlow.value = settings.glow + audioMix * 0.1;
    mat.uniforms.uAnisotropy.value = Math.max(0, settings.anisotropy + profile.anisotropy);
  });

  return (
    <mesh ref={meshRef} scale={[scaleBase, scaleBase, depthScale]} renderOrder={3}>
      <boxGeometry args={[2.4, 2.4, 2.4, 1, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        side={THREE.FrontSide}
        blending={settings.materialStyle === 'halftone' ? THREE.NormalBlending : THREE.AdditiveBlending}
        uniforms={{
          uTime: { value: 0 },
          uColor: { value: color.lerp(tint, 0.26) },
          uOpacity: { value: settings.opacity },
          uDensity: { value: settings.density },
          uAudio: { value: 0 },
          uGlow: { value: settings.glow },
          uSwirl: { value: profile.swirl },
          uPlume: { value: profile.plume },
          uRing: { value: profile.ring },
          uCell: { value: profile.cell },
          uDissolve: { value: profile.dissolve },
          uEmber: { value: profile.ember },
          uVeil: { value: profile.veil },
          uAnisotropy: { value: settings.anisotropy + profile.anisotropy },
          uPulseNoise: { value: profile.pulseNoise },
          uShellBias: { value: profile.shellBias },
          uCavity: { value: profile.cavity },
          uMaterialStyle: { value: materialStyleIndex },
          uCamLocal: { value: new THREE.Vector3(0, 0, 5) },
        }}
      />
    </mesh>
  );
};
