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

type PatchProfile = {
  ring: number;
  interference: number;
  tremor: number;
  contour: number;
  crease: number;
  drift: number;
  veil: number;
  glow: number;
  tint: THREE.ColorRepresentation;
};

const DEFAULT_PROFILE: PatchProfile = {
  ring: 0.12,
  interference: 0.16,
  tremor: 0.12,
  contour: 0.16,
  crease: 0.12,
  drift: 0.18,
  veil: 0.12,
  glow: 0.18,
  tint: '#e8efff',
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<PatchProfile>>> = {
  surface_patch: { contour: 0.18, crease: 0.12, tint: '#dde8ff' },
  contour_echo: { contour: 0.76, crease: 0.28, drift: 0.12, tint: '#f5e6d8' },
  echo_rings: { ring: 0.88, contour: 0.22, drift: 0.14, tint: '#d8e8ff' },
  standing_interference: { interference: 0.92, crease: 0.18, veil: 0.18, tint: '#f0dfff' },
  tremor_lattice: { tremor: 0.84, crease: 0.22, contour: 0.18, tint: '#dff5ff' },
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
  uniform float uRing;
  uniform float uInterference;
  uniform float uTremor;
  uniform float uContour;
  uniform float uCrease;
  uniform float uDrift;
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
    float rings = sin(radius * (10.0 + uRing * 22.0 + uSourceRing * 12.0) - uTime * (0.5 + uDrift));
    float interference = sin((p.x + p.y) * (6.0 + uInterference * 10.0) + uTime * 0.7) * cos((p.x - p.y) * (6.0 + uInterference * 10.0) - uTime * 0.4);
    float tremor = sin(p.x * (14.0 + uTremor * 14.0) + uTime * (1.8 + uTremor * 2.8)) * sin(p.y * (14.0 + uTremor * 14.0) - uTime * (1.2 + uTremor * 2.2));
    float contour = floor((radius + noise(p * (4.0 + uContour * 5.0)) * 0.14) * (4.0 + uContour * 8.0)) / (4.0 + uContour * 8.0);
    float crease = pow(abs(sin(angle * (3.0 + uCrease * 9.0) + uTime * 0.25)), 2.0);
    float sweep = sin(angle * (2.0 + uSourceSweep * 8.0) + radius * 6.0 - uTime * (0.5 + uDrift * 0.8));
    float column = (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * uSourceColumn;
    float canopy = smoothstep(1.0, -0.1, p.y) * uSourceCanopy;
    float blob = (1.0 - smoothstep(0.0, 1.2, length(p - vec2(0.2, -0.15)))) * uSourceBlob;
    float fracture = noise(p * (8.0 + uSourceFracture * 12.0) + uTime * 0.08) * uSourceFracture;
    float height = rings * uRing * 0.12 + interference * uInterference * 0.1 + tremor * uTremor * 0.08;
    height += contour * uContour * 0.22 + crease * uCrease * 0.14 + sweep * uDrift * 0.08;
    height += column * 0.12 + canopy * 0.08 + blob * 0.14 - fracture * 0.1;
    height *= 1.0 + uAudio * 0.32;
    pos.z += height;
    pos.x += sin(p.y * 3.14159) * uVeil * 0.05;
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
  uniform float uGlow;
  uniform float uVeil;
  uniform float uAudio;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float edge = 1.0 - smoothstep(0.72, 1.08, length(p));
    float highlight = smoothstep(0.02, 0.2, vHeight + 0.14);
    vec3 color = uColor * (0.44 + highlight * 0.66);
    color += uColor * uGlow * (0.08 + uAudio * 0.16);
    color += vec3(1.0) * uVeil * edge * 0.08;
    float alpha = clamp(uOpacity * edge * (0.48 + highlight * 0.4 + uVeil * 0.14), 0.0, 1.0);
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export const HybridSurfacePatchSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const settings = React.useMemo(() => getSettings(config, layerIndex), [config, layerIndex]);
  const influence = React.useMemo(() => getHybridSourceInfluence(settings.source), [settings.source]);
  const profile = React.useMemo(() => {
    const merged = { ...DEFAULT_PROFILE, ...(MODE_PROFILES[settings.mode] ?? {}) };
    return {
      ring: Math.max(0, merged.ring + influence.ring),
      interference: Math.max(0, merged.interference + influence.sweep * 0.3),
      tremor: Math.max(0, merged.tremor + influence.fracture * 0.2),
      contour: Math.max(0, merged.contour + influence.column * 0.18),
      crease: Math.max(0, merged.crease + influence.fracture * 0.3),
      drift: Math.max(0, merged.drift + influence.sweep * 0.3),
      veil: Math.max(0, merged.veil + influence.veil),
      glow: Math.max(0, merged.glow + influence.canopy * 0.25),
      tint: merged.tint,
    };
  }, [settings.mode, influence]);

  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uAudio: { value: 0 },
    uColor: { value: new THREE.Color(settings.color || profile.tint) },
    uOpacity: { value: Math.max(0.08, settings.opacity ?? 0.55) },
    uRing: { value: profile.ring },
    uInterference: { value: profile.interference },
    uTremor: { value: profile.tremor },
    uContour: { value: profile.contour },
    uCrease: { value: profile.crease },
    uDrift: { value: profile.drift },
    uVeil: { value: profile.veil },
    uGlow: { value: profile.glow },
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
    uniforms.uRing.value = profile.ring;
    uniforms.uInterference.value = profile.interference;
    uniforms.uTremor.value = profile.tremor;
    uniforms.uContour.value = profile.contour;
    uniforms.uCrease.value = profile.crease;
    uniforms.uDrift.value = profile.drift;
    uniforms.uVeil.value = profile.veil;
    uniforms.uGlow.value = profile.glow;
    uniforms.uSourceRing.value = influence.ring;
    uniforms.uSourceSweep.value = influence.sweep;
    uniforms.uSourceColumn.value = influence.column;
    uniforms.uSourceCanopy.value = influence.canopy;
    uniforms.uSourceFracture.value = influence.fracture;
    uniforms.uSourceBlob.value = influence.blob;
  }, [influence, profile, settings.color, settings.opacity, uniforms]);

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uAudio.value = getHybridAudioDrive(audioRef, isPlaying);
    if (meshRef.current) {
      meshRef.current.rotation.x = influence.tiltX;
      meshRef.current.rotation.y = influence.tiltY + Math.sin(clock.getElapsedTime() * 0.18) * (0.05 + profile.drift * 0.06);
    }
  });

  const size = config.sphereRadius * Math.max(0.55, settings.radiusScale ?? 1) * 1.55;

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
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};
