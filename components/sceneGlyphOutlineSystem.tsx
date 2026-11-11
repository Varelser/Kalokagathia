import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { withCrossFamilyGlyphProfile, withSourceAwareGlyphProfile } from '../lib/sourceAwareShaping';
import { getLayerRuntimeGlyphOutlineSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';

type GlyphOutlineProfile = {
  copies: number;
  spread: number;
  dropout: number;
  jitter: number;
  shear: number;
  quantize: number;
  zJitter: number;
  drift: number;
  gateFreq: number;
  gateThreshold: number;
  opacityMul: number;
  widthMul: number;
  shimmerMul: number;
  motionMul: number;
  tintMix: number;
  blendMode: 'additive' | 'normal';
};

const DEFAULT_GLYPH_OUTLINE_PROFILE: GlyphOutlineProfile = {
  copies: 0,
  spread: 0.08,
  dropout: 0,
  jitter: 0.06,
  shear: 0,
  quantize: 0,
  zJitter: 0.04,
  drift: 0.12,
  gateFreq: 0.4,
  gateThreshold: 0,
  opacityMul: 1,
  widthMul: 1,
  shimmerMul: 1,
  motionMul: 1,
  tintMix: 0.18,
  blendMode: 'additive',
};

const GLYPH_MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<GlyphOutlineProfile>>> = {
  contour_echo: { copies: 2, spread: 0.62, jitter: 0.04, shear: 0.06, quantize: 0.22, zJitter: 0.08, drift: 0.14, gateFreq: 0.72, gateThreshold: 0.18, opacityMul: 0.92, widthMul: 1.08, shimmerMul: 0.92, motionMul: 0.78, tintMix: 0.24 },
  shell_script: { copies: 1, spread: 0.26, jitter: 0.08, shear: 0.12, quantize: 0.28, zJitter: 0.14, drift: 0.28, gateFreq: 1.08, gateThreshold: 0.28, opacityMul: 0.84, widthMul: 0.92, shimmerMul: 1.06, motionMul: 0.88, tintMix: 0.32 },
  ink_bleed: { copies: 2, spread: 0.38, jitter: 0.22, shear: 0.04, quantize: 0.06, zJitter: 0.18, drift: 0.18, gateFreq: 0.54, gateThreshold: 0.12, opacityMul: 0.88, widthMul: 1.14, shimmerMul: 0.96, motionMul: 0.86, tintMix: 0.2 },
  drift_glyph_dust: { copies: 0, spread: 0.14, dropout: 0.28, jitter: 0.28, shear: 0.02, quantize: 0.18, zJitter: 0.16, drift: 0.54, gateFreq: 1.16, gateThreshold: 0.42, opacityMul: 0.66, widthMul: 0.82, shimmerMul: 0.9, motionMul: 1.08, tintMix: 0.18 },
  sigil_dust: { copies: 1, spread: 0.2, dropout: 0.16, jitter: 0.12, shear: 0.08, quantize: 0.42, zJitter: 0.1, drift: 0.24, gateFreq: 1.28, gateThreshold: 0.46, opacityMul: 0.76, widthMul: 0.9, shimmerMul: 0.94, motionMul: 0.9, tintMix: 0.28 },
  glyph_weave: { copies: 1, spread: 0.22, dropout: 0.06, jitter: 0.1, shear: 0.18, quantize: 0.34, zJitter: 0.12, drift: 0.34, gateFreq: 0.88, gateThreshold: 0.2, opacityMul: 0.9, widthMul: 0.96, shimmerMul: 1.08, motionMul: 1.02, tintMix: 0.34 },
  mesh_weave: { copies: 1, spread: 0.16, jitter: 0.06, shear: 0.04, quantize: 0.1, zJitter: 0.08, drift: 0.16, gateFreq: 0.42, gateThreshold: 0.08, opacityMul: 0.88, widthMul: 0.9, shimmerMul: 0.98, motionMul: 0.88, tintMix: 0.22 },
  spectral_mesh: { copies: 1, spread: 0.18, jitter: 0.08, shear: 0.08, quantize: 0.12, zJitter: 0.1, drift: 0.2, gateFreq: 0.6, gateThreshold: 0.06, opacityMul: 0.92, widthMul: 0.9, shimmerMul: 1.14, motionMul: 1.04, tintMix: 0.38 },
};

function getGlyphOutlineProfile(mode: ParticleConfig['layer2Type']) {
  return { ...DEFAULT_GLYPH_OUTLINE_PROFILE, ...(GLYPH_MODE_PROFILES[mode] ?? {}) };
}

function getHash(valueA: number, valueB: number, seed: number) {
  const value = Math.sin(valueA * 12.9898 + valueB * 78.233 + seed * 47.137) * 43758.5453123;
  return value - Math.floor(value);
}

function blendTowardGrid(value: number, step: number, mix: number) {
  if (mix <= 0) return value;
  const snapped = Math.round(value / step) * step;
  return THREE.MathUtils.lerp(value, snapped, mix);
}

function buildGlyphOutlinePositions(config: ParticleConfig, layerIndex: 2 | 3, profile: GlyphOutlineProfile) {
  const runtime = getLayerRuntimeGlyphOutlineSnapshot(config, layerIndex);
  const mediaMap = runtime.mediaLumaMap;
  const mapWidth = runtime.mediaMapWidth;
  const mapHeight = runtime.mediaMapHeight;
  const threshold = runtime.mediaThreshold;
  const depth = runtime.mediaDepth;
  const depthBias = runtime.depthBias;
  const radiusScale = runtime.radiusScale;

  if (!mediaMap.length || mapWidth <= 1 || mapHeight <= 1) return new Float32Array();

  const spanX = Math.max(80, radiusScale * 180);
  const spanY = spanX * (mapHeight / Math.max(1, mapWidth));
  const depthScale = Math.max(20, spanX * 0.35) * depth;
  const gridStep = Math.max(spanX, spanY) / 90;
  const segments: number[] = [];

  const sample = (x: number, y: number) => {
    const ix = Math.min(mapWidth - 1, Math.max(0, x));
    const iy = Math.min(mapHeight - 1, Math.max(0, y));
    return mediaMap[iy * mapWidth + ix] ?? 0;
  };
  const inside = (x: number, y: number) => sample(x, y) >= threshold;
  const px = (x: number) => (x / mapWidth - 0.5) * spanX;
  const py = (y: number) => (0.5 - y / mapHeight) * spanY;
  const pz = (a: number, b: number) => ((a + b) * 0.5 - 0.5) * depthScale + depthBias;

  const emitSegment = (ax0: number, ay0: number, az0: number, bx0: number, by0: number, bz0: number) => {
    const midX = (ax0 + bx0) * 0.5;
    const midY = (ay0 + by0) * 0.5;
    const gate = Math.abs(Math.sin(midX * (0.038 + profile.gateFreq * 0.05) + midY * (0.026 + profile.gateFreq * 0.03)));
    if (gate < profile.gateThreshold) return;
    if (getHash(midX, midY, profile.gateFreq + profile.dropout) < profile.dropout) return;

    const dx = bx0 - ax0;
    const dy = by0 - ay0;
    const len = Math.max(Math.hypot(dx, dy), 1e-3);
    const nx = -dy / len;
    const ny = dx / len;

    for (let copyIndex = 0; copyIndex <= profile.copies; copyIndex += 1) {
      const centered = copyIndex - profile.copies * 0.5;
      const spreadAmount = centered * profile.spread * Math.max(spanX, spanY) * 0.008;
      const jitter = Math.sin(midX * 0.06 + midY * 0.04 + copyIndex * 1.7) * profile.jitter * spanX * 0.006;
      const shearOffset = profile.shear * midY * 0.03;
      const zOffset = centered * profile.zJitter * depthScale * 0.16 + jitter * 0.08;

      let ax = ax0 + nx * spreadAmount + shearOffset;
      let ay = ay0 + ny * spreadAmount;
      let bx = bx0 + nx * spreadAmount + shearOffset;
      let by = by0 + ny * spreadAmount;

      ax = blendTowardGrid(ax, gridStep, profile.quantize);
      ay = blendTowardGrid(ay, gridStep, profile.quantize);
      bx = blendTowardGrid(bx, gridStep, profile.quantize);
      by = blendTowardGrid(by, gridStep, profile.quantize);

      segments.push(
        ax, ay, az0 + zOffset,
        bx, by, bz0 + zOffset,
      );
    }
  };

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth - 1; x += 1) {
      const leftInside = inside(x, y);
      const rightInside = inside(x + 1, y);
      if (leftInside === rightInside) continue;
      const a = sample(x, y);
      const b = sample(x + 1, y);
      const xWorld = px(x + 1);
      emitSegment(xWorld, py(y), pz(a, b), xWorld, py(y + 1), pz(a, b));
    }
  }

  for (let y = 0; y < mapHeight - 1; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const topInside = inside(x, y);
      const bottomInside = inside(x, y + 1);
      if (topInside === bottomInside) continue;
      const a = sample(x, y);
      const b = sample(x, y + 1);
      const yWorld = py(y + 1);
      emitSegment(px(x), yWorld, pz(a, b), px(x + 1), yWorld, pz(a, b));
    }
  }

  return new Float32Array(segments);
}

export const GlyphOutlineSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
}> = ({ config, layerIndex, audioRef }) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const runtime = getLayerRuntimeGlyphOutlineSnapshot(config, layerIndex);
  const layerType = getLayerRuntimeMode(config, layerIndex, runtime.route);
  const layerSource = runtime.source;
  const profile = useMemo(() => withCrossFamilyGlyphProfile(withSourceAwareGlyphProfile(getGlyphOutlineProfile(layerType), layerSource), layerType, layerSource), [layerType, layerSource]);
  const positions = useMemo(() => buildGlyphOutlinePositions(config, layerIndex, profile), [config, layerIndex, profile]);
  const color = runtime.color;
  const opacity = runtime.opacity;
  const width = runtime.width;
  const audioReactive = runtime.audioReactive;
  const materialStyle = runtime.materialStyle;

  useFrame(({ clock }) => {
    const line = lineRef.current;
    if (!line) return;
    const material = line.material as THREE.LineBasicMaterial;
    const t = clock.getElapsedTime();
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const shimmer = 0.66 + Math.sin(t * (1.2 + bass * 0.8) * profile.shimmerMul) * 0.12;
    const styleBoost = materialStyle === 'hologram' ? 1.2 : materialStyle === 'chrome' ? 1.05 : materialStyle === 'glass' ? 0.92 : 1;
    material.opacity = THREE.MathUtils.clamp(opacity * profile.opacityMul * (1 + pulse * audioReactive * 0.8) * shimmer * styleBoost, 0.02, 1);
    if (materialStyle === 'hologram') {
      material.color.set(color).lerp(new THREE.Color('#66f5ff'), 0.34 + pulse * 0.22 + profile.tintMix * 0.18);
    } else if (materialStyle === 'chrome') {
      material.color.set(color).lerp(new THREE.Color('#ffffff'), 0.28 + bass * 0.2 + profile.tintMix * 0.12);
    } else if (materialStyle === 'glass') {
      material.color.set(color).lerp(new THREE.Color('#dff8ff'), 0.22 + profile.tintMix * 0.08);
    } else if (materialStyle === 'halftone') {
      material.color.set(color).multiplyScalar(0.88 + pulse * 0.14);
    } else {
      material.color.set(color);
    }
    line.position.x = Math.sin(t * 0.24 + layerIndex) * profile.drift * 0.4;
    line.position.y = Math.sin(t * 0.35 + layerIndex * 0.7) * profile.drift * 0.6;
    line.rotation.z = Math.sin(t * 0.18 + layerIndex * 0.4) * profile.shear * 0.22;
    const scale = 1 + pulse * 0.012 * profile.motionMul;
    line.scale.set(scale, scale, 1);
  });

  if (positions.length === 0) return null;

  const blending = profile.blendMode === 'normal'
    ? THREE.NormalBlending
    : materialStyle === 'hologram' || materialStyle === 'chrome'
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;

  return (
    <lineSegments ref={lineRef} renderOrder={7}>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" array={positions} count={positions.length / 3} itemSize={3} />
      </bufferGeometry>
      <lineBasicMaterial
        transparent
        depthWrite={false}
        depthTest={false}
        opacity={opacity * profile.opacityMul}
        color={color}
        blending={blending}
        linewidth={Math.max(1, width * profile.widthMul * 2.5)}
      />
    </lineSegments>
  );
};
