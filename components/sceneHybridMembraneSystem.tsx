import React from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getHybridAudioDrive, getHybridSourceInfluence } from '../lib/hybridRuntimeShared';
import { getLayerRuntimeConfigSnapshot } from '../lib/sceneRenderRouting';

type Props = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

type MembraneProfile = {
  sag: number;
  spring: number;
  creep: number;
  pocket: number;
  twist: number;
  veil: number;
  tint: THREE.ColorRepresentation;
};

const DEFAULT_PROFILE: MembraneProfile = {
  sag: 0.22,
  spring: 0.16,
  creep: 0.14,
  pocket: 0.12,
  twist: 0.08,
  veil: 0.1,
  tint: '#e4efff',
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<MembraneProfile>>> = {
  sheet: { sag: 0.16, spring: 0.18, pocket: 0.08, tint: '#e8efff' },
  cloth_membrane: { sag: 0.42, spring: 0.08, creep: 0.12, pocket: 0.28, veil: 0.18, tint: '#f2e7db' },
  elastic_sheet: { sag: 0.12, spring: 0.42, creep: 0.06, twist: 0.14, tint: '#dfe9ff' },
  viscoelastic_membrane: { sag: 0.18, spring: 0.16, creep: 0.34, pocket: 0.2, twist: 0.18, veil: 0.22, tint: '#f0dcff' },
};

function getSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex);
  return {
    mode: runtime.mode,
    source: runtime.source,
    color: runtime.color,
    radiusScale: runtime.radiusScale,
    opacity: layerIndex === 2 ? config.layer2SheetOpacity : config.layer3SheetOpacity,
  };
}

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying float vHeight;
  uniform float uTime;
  uniform float uAudio;
  uniform float uSag;
  uniform float uSpring;
  uniform float uCreep;
  uniform float uPocket;
  uniform float uTwist;
  uniform float uVeil;
  uniform float uSourceRing;
  uniform float uSourceSweep;
  uniform float uSourceColumn;
  uniform float uSourceCanopy;
  uniform float uSourceFracture;
  uniform float uSourceBlob;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    vec2 p = uv * 2.0 - 1.0;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float sagMask = 1.0 - smoothstep(0.0, 1.0, radius);
    float sag = -uSag * (0.14 + uSourceCanopy * 0.08) * sagMask * (0.7 + 0.3 * sin(uTime * 0.4));
    float spring = sin(radius * (10.0 + uSourceRing * 12.0) - uTime * (1.5 + uSpring * 2.2)) * uSpring * 0.06;
    float creep = noise(p * (6.0 + uCreep * 8.0) + uTime * 0.08) * uCreep * 0.12;
    float pocket = (1.0 - smoothstep(0.0, 0.9, length(p - vec2(0.18, -0.12)))) * uPocket * 0.18;
    float sweep = sin(angle * (2.0 + uSourceSweep * 8.0) + uTime * (0.4 + uTwist * 0.8)) * uTwist * 0.08;
    float column = (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * uSourceColumn * 0.1;
    float fracture = noise(p * (12.0 + uSourceFracture * 10.0)) * uSourceFracture * 0.08;
    float blob = (1.0 - smoothstep(0.0, 1.1, length(p + vec2(0.14, 0.08)))) * uSourceBlob * 0.14;
    float height = sag + spring + creep + pocket + sweep + column + blob - fracture;
    height *= 1.0 + uAudio * 0.28;
    pos.z += height;
    pos.x += sin(p.y * 3.14159) * uVeil * 0.05 + uTwist * p.y * 0.08;
    pos.y += sin(p.x * 3.14159) * uVeil * 0.05;
    vHeight = height;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying float vHeight;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uVeil;
  uniform float uAudio;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float edge = 1.0 - smoothstep(0.78, 1.08, length(p));
    float sheen = smoothstep(0.0, 0.18, vHeight + 0.08);
    vec3 color = uColor * (0.42 + sheen * 0.7);
    color += vec3(1.0) * uVeil * edge * 0.08;
    color += uColor * uAudio * 0.1;
    float alpha = clamp(uOpacity * edge * (0.52 + sheen * 0.34 + uVeil * 0.16), 0.0, 1.0);
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export const HybridMembraneSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const settings = React.useMemo(() => getSettings(config, layerIndex), [config, layerIndex]);
  const influence = React.useMemo(() => getHybridSourceInfluence(settings.source), [settings.source]);
  const profile = React.useMemo(() => {
    const base = { ...DEFAULT_PROFILE, ...(MODE_PROFILES[settings.mode] ?? {}) };
    return {
      sag: Math.max(0, base.sag + influence.canopy * 0.28 + influence.column * 0.08),
      spring: Math.max(0, base.spring + influence.ring * 0.24),
      creep: Math.max(0, base.creep + influence.fracture * 0.2 + influence.blob * 0.08),
      pocket: Math.max(0, base.pocket + influence.blob * 0.28),
      twist: Math.max(0, base.twist + influence.sweep * 0.26 + Math.abs(influence.tiltX) * 0.08),
      veil: Math.max(0, base.veil + influence.veil),
      tint: base.tint,
    };
  }, [settings.mode, influence]);

  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uAudio: { value: 0 },
    uColor: { value: new THREE.Color(settings.color || profile.tint) },
    uOpacity: { value: Math.max(0.08, settings.opacity ?? 0.55) },
    uSag: { value: profile.sag },
    uSpring: { value: profile.spring },
    uCreep: { value: profile.creep },
    uPocket: { value: profile.pocket },
    uTwist: { value: profile.twist },
    uVeil: { value: profile.veil },
    uSourceRing: { value: influence.ring },
    uSourceSweep: { value: influence.sweep },
    uSourceColumn: { value: influence.column },
    uSourceCanopy: { value: influence.canopy },
    uSourceFracture: { value: influence.fracture },
    uSourceBlob: { value: influence.blob },
  }), [influence, profile, settings.color, settings.opacity]);

  React.useEffect(() => {
    uniforms.uColor.value.set(settings.color || profile.tint);
    uniforms.uOpacity.value = Math.max(0.08, settings.opacity ?? 0.55);
    uniforms.uSag.value = profile.sag;
    uniforms.uSpring.value = profile.spring;
    uniforms.uCreep.value = profile.creep;
    uniforms.uPocket.value = profile.pocket;
    uniforms.uTwist.value = profile.twist;
    uniforms.uVeil.value = profile.veil;
    uniforms.uSourceRing.value = influence.ring;
    uniforms.uSourceSweep.value = influence.sweep;
    uniforms.uSourceColumn.value = influence.column;
    uniforms.uSourceCanopy.value = influence.canopy;
    uniforms.uSourceFracture.value = influence.fracture;
    uniforms.uSourceBlob.value = influence.blob;
  }, [influence, profile, settings.color, settings.opacity, uniforms]);

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uAudio.value = getHybridAudioDrive(audioRef, isPlaying, { bass: 0.42, treble: 0.22, pulse: 0.36 });
    if (meshRef.current) {
      meshRef.current.rotation.x = influence.tiltX * 0.6;
      meshRef.current.rotation.y = influence.tiltY * 0.7 + Math.sin(clock.getElapsedTime() * 0.3) * (0.04 + profile.twist * 0.06);
    }
  });

  const size = config.sphereRadius * Math.max(0.55, settings.radiusScale ?? 1) * 1.42;

  return (
    <mesh ref={meshRef} renderOrder={3}>
      <planeGeometry args={[size, size, 96, 96]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export default HybridMembraneSystem;
