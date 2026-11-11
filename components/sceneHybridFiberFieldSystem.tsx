import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimeConfigSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';
import { getHybridAudioDrive, getHybridSourceInfluence } from '../lib/hybridRuntimeShared';

type Props = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

type FiberModeProfile = {
  strandCount: number;
  radius: number;
  height: number;
  curl: number;
  canopy: number;
  fracture: number;
  braid: number;
  fan: number;
  glow: number;
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<FiberModeProfile>>> = {
  fiber_field: { strandCount: 72, radius: 0.92, height: 1.0, curl: 0.32, glow: 0.82 },
  mesh_weave: { strandCount: 88, radius: 0.82, height: 0.86, curl: 0.22, braid: 0.2, fracture: 0.14 },
  plasma_thread: { strandCount: 68, radius: 0.88, height: 1.08, curl: 0.44, glow: 1.18 },
  branch_propagation: { strandCount: 92, radius: 0.9, height: 1.14, canopy: 0.42, fan: 0.22 },
  nerve_web: { strandCount: 84, radius: 0.84, height: 0.9, curl: 0.28, fracture: 0.18 },
  static_lace: { strandCount: 108, radius: 0.76, height: 0.72, braid: 0.18, fracture: 0.42 },
  signal_braid: { strandCount: 84, radius: 0.88, height: 1.0, braid: 0.82, curl: 0.26, glow: 1.08 },
  cinder_web: { strandCount: 76, radius: 0.84, height: 0.7, fracture: 0.36, fan: 0.16 },
  spectral_mesh: { strandCount: 74, radius: 0.86, height: 1.02, glow: 1.16, curl: 0.34 },
  ember_lace: { strandCount: 78, radius: 0.82, height: 0.78, fracture: 0.24, glow: 0.92 },
  aurora_threads: { strandCount: 66, radius: 0.96, height: 1.22, canopy: 0.46, curl: 0.42, glow: 1.24 },
  prism_threads: { strandCount: 72, radius: 0.9, height: 1.08, fan: 0.42, glow: 1.18 },
  glyph_weave: { strandCount: 90, radius: 0.84, height: 0.82, braid: 0.24, fracture: 0.28 },
};

const DEFAULT_PROFILE: FiberModeProfile = {
  strandCount: 72,
  radius: 0.9,
  height: 1,
  curl: 0.28,
  canopy: 0,
  fracture: 0,
  braid: 0,
  fan: 0,
  glow: 1,
};

function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

function getLayerRuntimeVisuals(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex);
  return { source: runtime.source, color: runtime.color };
}

function getLayerFiberSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2
    ? { density: config.layer2FiberDensity, opacity: config.layer2FiberOpacity, length: config.layer2FiberLength, audioReactive: config.layer2FiberAudioReactive }
    : { density: config.layer3FiberDensity, opacity: config.layer3FiberOpacity, length: config.layer3FiberLength, audioReactive: config.layer3FiberAudioReactive };
}

function mergeProfile(mode: ParticleConfig['layer2Type']): FiberModeProfile {
  return { ...DEFAULT_PROFILE, ...(MODE_PROFILES[mode] ?? {}) };
}

export const HybridFiberFieldSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const mode = getLayerMode(config, layerIndex);
  const runtime = getLayerRuntimeVisuals(config, layerIndex);
  const source = runtime.source;
  const color = runtime.color;
  const settings = getLayerFiberSettings(config, layerIndex);

  const { positions } = useMemo(() => {
    const base = mergeProfile(mode);
    const sourceFx = getHybridSourceInfluence(source);
    const audioDrive = getHybridAudioDrive(audioRef, isPlaying, { bass: 0.5, treble: 0.3, pulse: 0.2 }) * settings.audioReactive;
    const strandCount = Math.max(24, Math.min(180, Math.round(base.strandCount * (0.72 + settings.density * 0.9))));
    const radius = config.sphereRadius * (base.radius + sourceFx.ring * 0.9 + sourceFx.blob * 0.18);
    const height = config.sphereRadius * (base.height * (0.42 + settings.length * 0.92) + sourceFx.column * 0.9 + sourceFx.canopy * 0.4);
    const positions = new Float32Array(strandCount * 6);
    for (let i = 0; i < strandCount; i += 1) {
      const t = strandCount <= 1 ? 0 : i / (strandCount - 1);
      const angle = t * Math.PI * 2 * (1 + base.braid * 0.8 + sourceFx.sweep * 1.2);
      const radial = radius * (0.4 + 0.6 * Math.sin(t * Math.PI)) * (1 + sourceFx.ring * 0.4 + base.fan * Math.cos(angle * 0.5) * 0.18);
      const curl = base.curl + sourceFx.sweep * 0.6 + audioDrive * 0.22;
      const fracture = base.fracture + sourceFx.fracture;
      const canopy = base.canopy + sourceFx.canopy;
      const x0 = Math.cos(angle) * radial * (1 + fracture * 0.08 * Math.sign(Math.sin(angle * 4.0)));
      const z0 = Math.sin(angle) * radial;
      const y0 = -height * 0.5 + t * height * 0.16;
      const x1 = Math.cos(angle + curl) * radial * (0.86 + canopy * 0.18 + audioDrive * 0.08) + sourceFx.tiltX * height * 0.2;
      const z1 = Math.sin(angle + curl) * radial * (0.86 + base.fan * 0.12) + sourceFx.tiltY * height * 0.16;
      const y1 = y0 + height * (0.44 + canopy * 0.36 + sourceFx.column * 0.32 + audioDrive * 0.08);
      const idx = i * 6;
      positions[idx] = x0;
      positions[idx + 1] = y0;
      positions[idx + 2] = z0;
      positions[idx + 3] = x1;
      positions[idx + 4] = y1;
      positions[idx + 5] = z1;
    }
    return { positions, profile: { ...base, glow: base.glow + audioDrive * 0.18 } };
  }, [audioRef, config.sphereRadius, isPlaying, mode, settings.audioReactive, settings.density, settings.length, source]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  const opacity = Math.max(0.08, Math.min(1, settings.opacity * 0.9));

  return (
    <lineSegments geometry={geometry} renderOrder={4}>
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
};

export default HybridFiberFieldSystem;
