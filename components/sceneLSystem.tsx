import React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import type { SceneAudioRef } from './AppSceneTypes';
import { generateLSystem, type LSystemPresetId } from '../lib/lSystem';

// L-system recursive generation (Lindenmayer), after Prusinkiewicz &
// Lindenmayer. Structure is generated on the CPU by lib/lSystem.ts
// (string rewriting + turtle interpretation, seeded and deterministic)
// and drawn as THREE.LineSegments with monochrome vertex colours tinted
// by the layer colour. Generation is static: geometry is rebuilt only
// when a structural parameter changes. The only per-frame work is the
// wind sway — a small rotation of the whole group around its base
// (z-axis), so the generated structure itself never changes at runtime.
// Placement mirrors the DLA/Physarum sheets for this layer
// (sphereRadius-based size, per-layer z offset); sheet-only by design.

type LSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef?: SceneAudioRef;
  isPlaying?: boolean;
};

const clampN = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? v : fallback));

const PRESET_IDS: readonly LSystemPresetId[] = ['plant', 'fern', 'tree', 'coral', 'lightning'];

export const LSystem: React.FC<LSystemProps> = ({ config, layerIndex, isPlaying }) => {
  const raw = layerIndex === 2 ? {
    color: config.layer2Color,
    preset: config.layer2LsysPreset,
    depth: config.layer2LsysDepth,
    angle: config.layer2LsysAngle,
    lengthDecay: config.layer2LsysLengthDecay,
    seed: config.layer2LsysSeed,
    wind: config.layer2LsysWind,
    curvature: config.layer2LsysCurvature,
    opacity: config.layer2LsysOpacity,
  } : {
    color: config.layer3Color,
    preset: config.layer3LsysPreset,
    depth: config.layer3LsysDepth,
    angle: config.layer3LsysAngle,
    lengthDecay: config.layer3LsysLengthDecay,
    seed: config.layer3LsysSeed,
    wind: config.layer3LsysWind,
    curvature: config.layer3LsysCurvature,
    opacity: config.layer3LsysOpacity,
  };
  const preset: LSystemPresetId = PRESET_IDS.includes(raw.preset as LSystemPresetId)
    ? (raw.preset as LSystemPresetId)
    : 'plant';
  const depth = Math.round(clampN(raw.depth, 5, 1, 8));
  const angle = clampN(raw.angle, 25, 5, 60);
  const lengthDecay = clampN(raw.lengthDecay, 0.78, 0.5, 0.95);
  const seed = Math.round(clampN(raw.seed, 1, 0, 999999));
  const wind = clampN(raw.wind, 0.15, 0, 1);
  const curvature = clampN(raw.curvature, 0, -15, 15);
  const opacity = clampN(raw.opacity, 0.9, 0, 1);

  const generated = React.useMemo(
    () => generateLSystem({ preset, depth, angleDeg: angle, lengthDecay, seed, curvatureDeg: curvature }),
    [preset, depth, angle, lengthDecay, seed, curvature],
  );

  const geometry = React.useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(generated.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(generated.colors, 3));
    return geo;
  }, [generated]);
  React.useEffect(() => () => geometry.dispose(), [geometry]);

  const material = React.useMemo(() => new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }), []);
  React.useEffect(() => () => material.dispose(), [material]);

  // Sheet placement mirrors the DLA/Physarum sheets for this layer.
  const planeSize = Math.min(Math.max(config.sphereRadius * 3.1, 160), 900);
  const zOffset = config.sphereRadius * (layerIndex === 2 ? -0.58 : 0.58);
  const anchorY = generated.anchor === 'top'
    ? planeSize / 2 - planeSize * 0.04
    : -planeSize / 2 + planeSize * 0.04;

  const swayRef = React.useRef<THREE.Group>(null);
  const swayTimeRef = React.useRef(0);
  useFrame((_, delta) => {
    material.color.set(raw.color);
    material.opacity = opacity;
    if (isPlaying !== false) swayTimeRef.current += Math.min(delta, 0.1);
    if (swayRef.current) {
      // Wind sway: +-wind * 0.07 rad around the base pivot (z-axis).
      swayRef.current.rotation.z = Math.sin(swayTimeRef.current * 1.15) * wind * 0.07;
    }
  });

  return (
    <group position={[0, 0, zOffset]}>
      <group ref={swayRef} position={[0, anchorY, 0]}>
        <lineSegments geometry={geometry} material={material} scale={[planeSize, planeSize, 1]} frustumCulled={false} />
      </group>
    </group>
  );
};
