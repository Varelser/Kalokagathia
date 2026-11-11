import React from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimeConfigSnapshot } from '../lib/sceneRenderRouting';

type Props = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

type ShellProfile = {
  ring: number;
  fracture: number;
  bloom: number;
  veil: number;
  cavity: number;
  lacquer: number;
  orbit: number;
  thickness: number;
  tint: THREE.ColorRepresentation;
};

const DEFAULT_PROFILE: ShellProfile = {
  ring: 0.08,
  fracture: 0.1,
  bloom: 0.14,
  veil: 0.12,
  cavity: 0.08,
  lacquer: 0.16,
  orbit: 0.1,
  thickness: 0.12,
  tint: '#dfe8ff',
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<ShellProfile>>> = {
  surface_shell: { lacquer: 0.18, tint: '#dfe8ff' },
  aura_shell: { bloom: 0.52, veil: 0.22, tint: '#bfe2ff' },
  halo_bloom: { bloom: 0.78, ring: 0.34, tint: '#ffe3f6' },
  spore_halo: { bloom: 0.66, cavity: 0.22, tint: '#dfffcf' },
  eclipse_halo: { ring: 0.48, cavity: 0.38, veil: 0.18, tint: '#f1f4ff' },
  mirror_skin: { lacquer: 0.64, ring: 0.18, tint: '#f0f5ff' },
  calcified_skin: { fracture: 0.62, cavity: 0.2, tint: '#f1eadc' },
  freeze_skin: { fracture: 0.48, veil: 0.24, tint: '#d8f2ff' },
  residue_skin: { fracture: 0.38, cavity: 0.3, tint: '#d7d2cb' },
  shell_script: { fracture: 0.28, orbit: 0.26, tint: '#d8d8ff' },
  resin_shell: { lacquer: 0.72, bloom: 0.18, tint: '#ffd7b5' },
};

function getSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex);
  return {
    mode: runtime.mode,
    source: runtime.source,
    color: runtime.color,
    radiusScale: runtime.radiusScale,
    opacity: layerIndex === 2 ? config.layer2SheetOpacity : config.layer3SheetOpacity,
    glow: layerIndex === 2 ? config.layer2FlowAmplitude : config.layer3FlowAmplitude,
    shellGlow: layerIndex === 2 ? config.layer2FlowAmplitude : config.layer3FlowAmplitude,
    shellFresnel: layerIndex === 2 ? config.layer2HullFresnel : config.layer3HullFresnel,
  };
}

function getSourceAdjustments(source: ParticleConfig['layer2Source']) {
  switch (source) {
    case 'text':
    case 'grid':
      return { fracture: 0.16, ring: 0.04, bloom: -0.04 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ring: 0.34, orbit: 0.22, cavity: 0.06 };
    case 'spiral':
    case 'galaxy':
      return { orbit: 0.28, veil: 0.08, bloom: 0.06 };
    case 'image':
    case 'video':
      return { bloom: 0.18, veil: 0.12, lacquer: 0.06 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { fracture: 0.12, cavity: 0.12, ring: -0.02 };
    case 'plane':
      return { veil: 0.1, bloom: 0.08 };
    default:
      return {};
  }
}

const VERTEX_SHADER = `
  varying vec3 vLocalPos;
  varying vec3 vViewDir;
  uniform vec3 uLocalCamera;
  void main() {
    vLocalPos = position;
    vViewDir = normalize(position - uLocalCamera);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 vLocalPos;
  varying vec3 vViewDir;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uAudio;
  uniform float uRing;
  uniform float uFracture;
  uniform float uBloom;
  uniform float uVeil;
  uniform float uCavity;
  uniform float uLacquer;
  uniform float uOrbit;
  uniform float uThickness;
  uniform float uGlow;
  uniform float uFresnel;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 191.3))) * 43758.5453123); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i + vec3(0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0));
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
      p = p * 2.02 + vec3(13.4, 7.1, 5.3);
      amp *= 0.5;
    }
    return value;
  }
  float sdfShell(vec3 p) {
    float radius = length(p);
    float theta = atan(p.y, p.x);
    float orbit = sin(theta * (3.0 + uOrbit * 10.0) + p.z * (2.0 + uOrbit * 6.0) - uTime * (0.22 + uOrbit * 0.4));
    float ring = sin(theta * (4.0 + uRing * 12.0));
    float fracture = fbm(p * (3.2 + uFracture * 2.8) + 2.8) * uFracture;
    float bloom = smoothstep(0.55, -0.15, p.y) * uBloom;
    float veil = fbm(p * (1.8 + uVeil * 1.2) + vec3(0.0, uTime * 0.08, 0.0)) * uVeil;
    float cavity = smoothstep(0.14, 0.42 + uCavity * 0.2, radius) * uCavity;
    float shellRadius = 0.62 + ring * 0.03 + orbit * 0.04 + bloom * 0.05 + veil * 0.04 - fracture * 0.08;
    float thickness = 0.08 + uThickness * 0.12 + fracture * 0.03;
    return abs(radius - shellRadius) - thickness + cavity * 0.06;
  }
  vec3 estimateNormal(vec3 p) {
    float e = 0.004;
    return normalize(vec3(
      sdfShell(p + vec3(e, 0.0, 0.0)) - sdfShell(p - vec3(e, 0.0, 0.0)),
      sdfShell(p + vec3(0.0, e, 0.0)) - sdfShell(p - vec3(0.0, e, 0.0)),
      sdfShell(p + vec3(0.0, 0.0, e)) - sdfShell(p - vec3(0.0, 0.0, e))
    ));
  }
  void main() {
    vec3 ro = vLocalPos;
    vec3 rd = normalize(vViewDir);
    float t = 0.0;
    float hit = -1.0;
    vec3 p = ro;
    for (int i = 0; i < 48; i++) {
      p = ro + rd * t;
      float d = sdfShell(p);
      if (d < 0.003) { hit = t; break; }
      t += clamp(d * 0.85, 0.01, 0.08);
      if (t > 2.6) break;
    }
    if (hit < 0.0) discard;
    vec3 normal = estimateNormal(p);
    vec3 lightDir = normalize(vec3(0.45, 0.7, 0.55));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float fresnel = pow(1.0 - max(dot(normalize(-rd), normal), 0.0), 2.0 + uFresnel * 4.0);
    float lacquer = pow(max(dot(reflect(-lightDir, normal), normalize(-rd)), 0.0), 8.0 + uLacquer * 32.0) * (0.18 + uLacquer * 0.72);
    float glow = fresnel * (0.2 + uGlow * 0.8) + uAudio * 0.12;
    vec3 color = uColor * (0.28 + diffuse * 0.72);
    color += vec3(1.0) * lacquer;
    color += uColor * glow;
    float alpha = clamp(uOpacity * (0.42 + fresnel * 0.5 + diffuse * 0.2), 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

export const SdfSurfaceShellSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const settings = React.useMemo(() => getSettings(config, layerIndex), [config, layerIndex]);
  const profile = React.useMemo(() => {
    const merged = { ...DEFAULT_PROFILE, ...(MODE_PROFILES[settings.mode] ?? {}) };
    const sourceAdjust = getSourceAdjustments(settings.source);
    return {
      ring: Math.max(0, merged.ring + (sourceAdjust.ring ?? 0)),
      fracture: Math.max(0, merged.fracture + (sourceAdjust.fracture ?? 0)),
      bloom: Math.max(0, merged.bloom + (sourceAdjust.bloom ?? 0)),
      veil: Math.max(0, merged.veil + (sourceAdjust.veil ?? 0)),
      cavity: Math.max(0, merged.cavity + (sourceAdjust.cavity ?? 0)),
      lacquer: Math.max(0, merged.lacquer + (sourceAdjust.lacquer ?? 0)),
      orbit: Math.max(0, merged.orbit + (sourceAdjust.orbit ?? 0)),
      thickness: merged.thickness,
      tint: merged.tint,
    };
  }, [settings.mode, settings.source]);

  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(settings.color || profile.tint) },
    uOpacity: { value: Math.max(0.08, settings.opacity ?? 0.55) },
    uAudio: { value: 0 },
    uRing: { value: profile.ring },
    uFracture: { value: profile.fracture },
    uBloom: { value: profile.bloom },
    uVeil: { value: profile.veil },
    uCavity: { value: profile.cavity },
    uLacquer: { value: profile.lacquer },
    uOrbit: { value: profile.orbit },
    uThickness: { value: profile.thickness },
    uGlow: { value: Math.max(0, settings.shellGlow ?? settings.glow ?? 0) },
    uFresnel: { value: Math.max(0.1, settings.shellFresnel ?? 0.5) },
    uLocalCamera: { value: new THREE.Vector3(0, 0, 2) },
  }), [profile, settings.color, settings.opacity, settings.glow, settings.shellGlow, settings.shellFresnel]);

  React.useEffect(() => {
    uniforms.uColor.value.set(settings.color || profile.tint);
    uniforms.uOpacity.value = Math.max(0.08, settings.opacity ?? 0.55);
    uniforms.uRing.value = profile.ring;
    uniforms.uFracture.value = profile.fracture;
    uniforms.uBloom.value = profile.bloom;
    uniforms.uVeil.value = profile.veil;
    uniforms.uCavity.value = profile.cavity;
    uniforms.uLacquer.value = profile.lacquer;
    uniforms.uOrbit.value = profile.orbit;
    uniforms.uThickness.value = profile.thickness;
    uniforms.uGlow.value = Math.max(0, settings.shellGlow ?? settings.glow ?? 0);
    uniforms.uFresnel.value = Math.max(0.1, settings.shellFresnel ?? 0.5);
  }, [profile, settings.color, settings.opacity, settings.glow, settings.shellGlow, settings.shellFresnel, uniforms]);

  useFrame(({ clock, camera }) => {
    const bass = audioRef.current?.bass ?? 0;
    const treble = audioRef.current?.treble ?? 0;
    const pulse = audioRef.current?.pulse ?? 0;
    const audioDrive = isPlaying ? bass * 0.55 + treble * 0.25 + pulse * 0.2 : 0;
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uAudio.value = audioDrive;
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0018 + profile.orbit * 0.003 + audioDrive * 0.0012;
      meshRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.17) * 0.16 + profile.veil * 0.18;
      const inverse = new THREE.Matrix4().copy(meshRef.current.matrixWorld).invert();
      uniforms.uLocalCamera.value.copy(camera.position).applyMatrix4(inverse);
    }
  });

  const radius = config.sphereRadius * Math.max(0.5, settings.radiusScale ?? 1) * 1.2;

  return (
    <mesh ref={meshRef} renderOrder={3}>
      <boxGeometry args={[radius * 2, radius * 2, radius * 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};
