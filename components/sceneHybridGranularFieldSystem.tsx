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

type GranularProfile = {
  count: number;
  radius: number;
  height: number;
  settle: number;
  tumble: number;
  basin: number;
  halo: number;
  fracture: number;
  canopy: number;
  scale: number;
};

const DEFAULT_PROFILE: GranularProfile = {
  count: 180,
  radius: 0.84,
  height: 0.62,
  settle: 0.4,
  tumble: 0.24,
  basin: 0.22,
  halo: 0.12,
  fracture: 0.08,
  canopy: 0,
  scale: 1,
};

const MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<GranularProfile>>> = {
  crystal_aggregate: { count: 160, radius: 0.82, height: 0.56, settle: 0.34, tumble: 0.18 },
  sediment_stack: { count: 210, radius: 0.78, height: 0.34, settle: 0.82, basin: 0.64, scale: 0.86 },
  talus_heap: { count: 220, radius: 0.88, height: 0.48, settle: 0.72, basin: 0.58, fracture: 0.18 },
  avalanche_field: { count: 230, radius: 0.96, height: 0.44, settle: 0.54, tumble: 0.56, fracture: 0.22 },
  jammed_pack: { count: 240, radius: 0.72, height: 0.28, basin: 0.72, scale: 0.8 },
  granular_fall: { count: 200, radius: 0.74, height: 0.86, settle: 0.6, tumble: 0.34 },
  bloom_spores: { count: 180, radius: 0.96, height: 0.66, halo: 0.44, canopy: 0.26, scale: 0.76 },
  pollen_storm: { count: 170, radius: 1.02, height: 0.78, halo: 0.34, tumble: 0.44, canopy: 0.3, scale: 0.72 },
  fracture_bloom: { count: 190, radius: 0.9, height: 0.58, halo: 0.28, fracture: 0.32, canopy: 0.16 },
  orbit_fracture: { count: 184, radius: 1.0, height: 0.52, tumble: 0.48, halo: 0.3, fracture: 0.26 },
};

function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

function getLayerRuntimeVisuals(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeConfigSnapshot(config, layerIndex);
  return { source: runtime.source, color: runtime.color };
}

function mergeProfile(mode: ParticleConfig['layer2Type']): GranularProfile {
  return { ...DEFAULT_PROFILE, ...(MODE_PROFILES[mode] ?? {}) };
}

export const HybridGranularFieldSystem: React.FC<Props> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const mode = getLayerMode(config, layerIndex);
  const runtime = getLayerRuntimeVisuals(config, layerIndex);
  const source = runtime.source;
  const color = runtime.color;

  const { positions, scales, profile } = useMemo(() => {
    const base = mergeProfile(mode);
    const sourceFx = getHybridSourceInfluence(source);
    const audioDrive = getHybridAudioDrive(audioRef, isPlaying, { bass: 0.54, treble: 0.14, pulse: 0.32 });
    const count = Math.max(48, Math.min(320, Math.round(base.count * (0.86 + audioDrive * 0.12 + sourceFx.blob * 0.2))));
    const radius = config.sphereRadius * (base.radius + sourceFx.ring * 0.42 + sourceFx.blob * 0.18);
    const height = config.sphereRadius * (base.height + sourceFx.column * 0.42 + sourceFx.canopy * 0.28);
    const settle = base.settle + sourceFx.column * 0.44;
    const tumble = base.tumble + sourceFx.sweep * 0.4;
    const basin = base.basin + sourceFx.blob * 0.32;
    const halo = base.halo + sourceFx.ring * 0.26;
    const fracture = base.fracture + sourceFx.fracture * 0.62;
    const canopy = base.canopy + sourceFx.canopy * 0.44;

    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0 : i / (count - 1);
      const angle = t * Math.PI * 2.0 * (1.0 + tumble * 1.8) + (i % 7) * 0.23;
      const ringBias = halo * (0.65 + 0.35 * Math.sin(angle * 2.0));
      const heap = (1.0 - t) * settle;
      const rr = radius * (0.26 + t * 0.78 + ringBias * 0.28);
      const x = Math.cos(angle) * rr * (1.0 + fracture * 0.18 * Math.sign(Math.sin(angle * 5.0))) + sourceFx.tiltX * height * 0.16;
      const z = Math.sin(angle) * rr * (1.0 + canopy * 0.14) + sourceFx.tiltY * height * 0.12;
      const y = -height * (0.54 - heap * 0.34) + t * height * (0.7 + canopy * 0.22) - (x * x + z * z) / Math.max(1, radius * radius) * basin * height * 0.44;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      scales[i] = config.baseSize * (0.56 + base.scale * 0.5 + audioDrive * 0.12 + (i % 5) * 0.03);
    }

    return {
      positions,
      scales,
      profile: { ...base, count, radius, height, settle, tumble, basin, halo, fracture, canopy },
    };
  }, [audioRef, config.baseSize, config.sphereRadius, isPlaying, mode, source]);

  const meshRef = React.useRef<THREE.InstancedMesh>(null);
  const tempObject = React.useMemo(() => new THREE.Object3D(), []);

  React.useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < profile.count; i += 1) {
      tempObject.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const s = scales[i];
      tempObject.scale.setScalar(s);
      tempObject.rotation.set((i % 7) * 0.19, (i % 11) * 0.13, (i % 5) * 0.17);
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);
    }
    mesh.count = profile.count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions, profile.count, scales, tempObject]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, profile.count]} renderOrder={4}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={color} transparent opacity={0.82} roughness={0.62} metalness={0.08} />
    </instancedMesh>
  );
};

export default HybridGranularFieldSystem;
