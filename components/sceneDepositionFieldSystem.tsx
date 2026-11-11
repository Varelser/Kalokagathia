import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { generateParticleData } from './particleData';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import { withCrossFamilyDepositionProfile, withSourceAwareDepositionProfile } from '../lib/sourceAwareShaping';
import { getLayerRuntimeDepositionSnapshot } from '../lib/sceneRenderRouting';

type DepositionMode = ParticleConfig['layer2Type'];

type DepositionProfile = {
  dotField: number;
  reliefMul: number;
  reliefAdd: number;
  erosionMul: number;
  erosionAdd: number;
  bandsMul: number;
  bandsMin: number;
  opacityMul: number;
  opacityAdd: number;
  scaleMul: number;
  scaleYMul: number;
  rotationMul: number;
  pitchMul: number;
  dotScale: number;
  dotSoftness: number;
  bandWarp: number;
  bleedSpread: number;
  glyphGrid: number;
  contourMix: number;
  sootStain: number;
  runeRetention: number;
  velvetMatte: number;
  vaporLift: number;
  normalBlend: boolean;
};

const DEFAULT_DEPOSITION_PROFILE: DepositionProfile = {
  dotField: 0,
  reliefMul: 1,
  reliefAdd: 0,
  erosionMul: 1,
  erosionAdd: 0,
  bandsMul: 1,
  bandsMin: 2,
  opacityMul: 1,
  opacityAdd: 0,
  scaleMul: 1,
  scaleYMul: 1,
  rotationMul: 1,
  pitchMul: 1,
  dotScale: 1,
  dotSoftness: 0.5,
  bandWarp: 0,
  bleedSpread: 0,
  glyphGrid: 0,
  contourMix: 0,
  sootStain: 0,
  runeRetention: 0,
  velvetMatte: 0,
  vaporLift: 0,
  normalBlend: false,
};

const DEPOSITION_PROFILES: Partial<Record<DepositionMode, Partial<DepositionProfile>>> = {
  deposition_field: { dotField: 0.06, reliefMul: 1.08, bandsMul: 1.06, bandsMin: 3, scaleMul: 1.02, scaleYMul: 0.94, dotScale: 0.88, dotSoftness: 0.42, bandWarp: 0.12, contourMix: 0.08, sootStain: 0.08, vaporLift: 0.12 },
  stipple_field: { dotField: 0.92, reliefMul: 0.55, bandsMul: 1.6, bandsMin: 5, opacityMul: 0.94, scaleMul: 0.92, scaleYMul: 0.88, rotationMul: 0.5, dotScale: 1.24, dotSoftness: 0.34, bandWarp: 0.22, glyphGrid: 0.12, sootStain: 0.1, normalBlend: true },
  capillary_sheet: { dotField: 0.12, reliefMul: 1.22, reliefAdd: 0.04, erosionMul: 0.82, bandsMul: 1.42, bandsMin: 5, opacityMul: 0.96, scaleMul: 1.04, scaleYMul: 0.98, rotationMul: 1, pitchMul: 1, dotScale: 0.82, dotSoftness: 0.58, bandWarp: 0.22, bleedSpread: 0.38, glyphGrid: 0.2, contourMix: 0.14, sootStain: 0.08, runeRetention: 0.18, velvetMatte: 0.22, vaporLift: 0.22, normalBlend: true },
  percolation_sheet: { dotField: 0.18, reliefMul: 1.28, reliefAdd: 0.05, erosionMul: 0.74, erosionAdd: -0.02, bandsMul: 1.56, bandsMin: 6, opacityMul: 0.98, scaleMul: 1.06, scaleYMul: 0.94, rotationMul: 1, pitchMul: 1, dotScale: 0.86, dotSoftness: 0.62, bandWarp: 0.34, bleedSpread: 0.42, glyphGrid: 0.28, contourMix: 0.12, sootStain: 0.06, runeRetention: 0.14, velvetMatte: 0.18, vaporLift: 0.28, normalBlend: true },
  ink_bleed: { dotField: 0.18, reliefMul: 0.72, erosionMul: 1.18, erosionAdd: 0.06, bandsMul: 1.35, bandsMin: 3, opacityMul: 1.08, scaleMul: 1.02, scaleYMul: 0.92, rotationMul: 1.08, pitchMul: 1.08, dotScale: 0.72, dotSoftness: 0.7, bandWarp: 0.58, bleedSpread: 0.92, glyphGrid: 0.18, contourMix: 0.1, sootStain: 0.34, runeRetention: 0.42, velvetMatte: 0.48, vaporLift: 0.54, normalBlend: true },
  drift_glyph_dust: { dotField: 0.82, reliefMul: 0.5, erosionMul: 1.36, erosionAdd: 0.14, bandsMul: 1.82, bandsMin: 6, opacityMul: 0.78, scaleMul: 0.9, scaleYMul: 0.84, rotationMul: 0.9, pitchMul: 0.94, dotScale: 1.18, dotSoftness: 0.28, bandWarp: 0.34, bleedSpread: 0.18, glyphGrid: 0.76, contourMix: 0.18, runeRetention: 0.66, vaporLift: 0.16, normalBlend: true },
  sigil_dust: { dotField: 0.96, reliefMul: 0.42, erosionMul: 1.48, erosionAdd: 0.2, bandsMul: 2.08, bandsMin: 7, opacityMul: 0.72, scaleMul: 0.96, scaleYMul: 0.8, rotationMul: 0.72, pitchMul: 0.86, dotScale: 1.42, dotSoftness: 0.18, bandWarp: 0.46, bleedSpread: 0.1, glyphGrid: 1, contourMix: 0.32, runeRetention: 0.88, vaporLift: 0.12, normalBlend: true },
  seep_fracture: { dotField: 0.14, reliefMul: 0.86, erosionMul: 1.3, erosionAdd: 0.08, bandsMul: 1.42, bandsMin: 4, opacityMul: 0.88, scaleMul: 0.98, scaleYMul: 0.9, bandWarp: 0.64, bleedSpread: 0.76, contourMix: 0.14, sootStain: 0.18, vaporLift: 0.22, normalBlend: true },
};

function getDepositionProfile(mode: DepositionMode): DepositionProfile {
  return { ...DEFAULT_DEPOSITION_PROFILE, ...(DEPOSITION_PROFILES[mode] ?? {}) };
}

const VERT = `
  uniform float uTime;
  uniform float uRelief;
  uniform float uErosion;
  uniform float uPulse;
  uniform float uAudioReactive;
  uniform float uBandWarp;
  uniform float uBleedSpread;
  uniform float uGlyphGrid;
  uniform float uContourMix;
  uniform float uSootStain;
  uniform float uRuneRetention;
  uniform float uVelvetMatte;
  uniform float uVaporLift;
  varying vec2 vUv;
  varying float vHeight;
  varying float vSediment;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += noise(p) * amp;
      p = p * 2.03 + vec2(17.2, -11.8);
      amp *= 0.5;
    }
    return value;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    vec2 swirl = vec2(sin(uv.y * (6.0 + uBandWarp * 18.0) + uTime * 0.2), cos(uv.x * (7.0 + uBandWarp * 15.0) - uTime * 0.17));
    vec2 flowUv = uv * mix(2.0, 6.5 + uBandWarp * 2.4, uRelief) + vec2(uTime * 0.035, -uTime * 0.02) + swirl * (0.06 + uBandWarp * 0.12);
    float base = fbm(flowUv);
    float cut = fbm(flowUv * (1.8 + uBleedSpread * 0.7) + vec2(4.2, -3.1));
    float ridges = abs(base * 2.0 - 1.0);
    float sediment = smoothstep(0.18, 0.92, ridges);
    float erosion = smoothstep(0.2, 0.85, cut) * uErosion;
    float glyphMask = 0.5 + 0.5 * sin((uv.x + uv.y) * (22.0 + uGlyphGrid * 90.0) + uTime * 0.28);
    glyphMask *= 0.5 + 0.5 * sin((uv.x - uv.y) * (14.0 + uGlyphGrid * 64.0) - uTime * 0.22);
    float contour = 0.5 + 0.5 * sin((uv.y + ridges * 0.18) * (10.0 + uContourMix * 42.0) + uTime * (0.4 + uContourMix * 0.5));
    float bleed = fbm(flowUv * (1.2 + uBleedSpread * 1.8) + vec2(-uTime * 0.03, uTime * 0.05));
    float soot = smoothstep(0.32, 0.92, bleed + sediment * 0.22);
    float rune = glyphMask * (0.6 + 0.4 * contour);
    float velvet = smoothstep(0.12, 0.9, fbm(flowUv * 0.8 + vec2(3.2, -5.4)));
    float vapor = smoothstep(1.1, 0.08, length(uv * vec2(1.0, 0.82))) * (0.6 + contour * 0.4);
    float height = sediment * (1.0 - erosion);
    height += (bleed - 0.5) * uBleedSpread * 0.28;
    height += (glyphMask - 0.5) * uGlyphGrid * 0.18;
    height += (contour - 0.5) * uContourMix * 0.3;
    height += (soot - 0.5) * uSootStain * 0.16;
    height += (rune - 0.5) * uRuneRetention * 0.14;
    height += (velvet - 0.5) * uVelvetMatte * 0.1;
    height += vapor * uVaporLift * 0.18;
    height = clamp(height, 0.0, 1.0);
    sediment = clamp(mix(sediment, sediment * 0.74 + glyphMask * 0.26 + contour * 0.14 + soot * uSootStain * 0.12 + rune * uRuneRetention * 0.12, clamp(uGlyphGrid + uContourMix + uSootStain * 0.3 + uRuneRetention * 0.3, 0.0, 1.0)), 0.0, 1.0);
    float audioLift = uPulse * uAudioReactive * (0.35 + sediment * 0.65 + vapor * uVaporLift * 0.2);
    pos.z += (height - 0.5) * 120.0 * uRelief + (contour - 0.5) * 28.0 * uContourMix + (bleed - 0.5) * 24.0 * uBleedSpread + audioLift * 26.0;
    pos.x += (cut - 0.5) * 22.0 * uErosion + (glyphMask - 0.5) * 16.0 * uGlyphGrid + (rune - 0.5) * 9.0 * uRuneRetention;
    pos.y += (sediment - 0.5) * 18.0 * uRelief + (contour - 0.5) * 12.0 * uContourMix + vapor * uVaporLift * 8.0;
    vHeight = height;
    vSediment = sediment;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uBands;
  uniform float uPulse;
  uniform float uMaterialStyle;
  uniform float uDotField;
  uniform float uDotScale;
  uniform float uDotSoftness;
  uniform float uBandWarp;
  uniform float uBleedSpread;
  uniform float uGlyphGrid;
  uniform float uContourMix;
  uniform float uSootStain;
  uniform float uRuneRetention;
  uniform float uVelvetMatte;
  uniform float uVaporLift;
  varying vec2 vUv;
  varying float vHeight;
  varying float vSediment;

  void main() {
    float bands = floor(vHeight * max(2.0, uBands)) / max(2.0, uBands - 1.0);
    float cut = smoothstep(0.08, 0.92, bands);
    float contourLines = abs(sin(vUv.y * (10.0 + uContourMix * 54.0) + vHeight * (8.0 + uBandWarp * 10.0) + uPulse * 3.0));
    float contourMask = 1.0 - smoothstep(0.2, 0.82 - uContourMix * 0.28, contourLines);
    float glyphMask = 0.5 + 0.5 * sin((vUv.x + vUv.y) * (18.0 + uGlyphGrid * 82.0));
    glyphMask *= 0.5 + 0.5 * sin((vUv.x - vUv.y) * (12.0 + uGlyphGrid * 58.0));
    float bleedDark = smoothstep(0.24, 0.92, vSediment + uBleedSpread * 0.18);
    float sootMask = smoothstep(0.28, 0.94, vSediment + uSootStain * 0.18 + uBleedSpread * 0.1);
    float runeMask = glyphMask * (0.65 + contourMask * 0.35);
    float velvetMask = smoothstep(0.12, 0.92, vHeight * 0.76 + vSediment * 0.24);
    vec3 color = mix(uColor * 0.4, uColor, cut);
    color *= 0.72 + vSediment * 0.5;
    color = mix(color, color * (0.74 + bleedDark * 0.22), uBleedSpread * 0.7);
    color = mix(color, color * (0.48 + sootMask * 0.18) + vec3(0.12, 0.09, 0.07) * 0.24, clamp(uSootStain, 0.0, 1.0));
    color += vec3(1.0) * uPulse * 0.05;
    color += mix(vec3(0.0), vec3(1.0), contourMask) * uContourMix * 0.1;
    color += vec3(0.72, 0.86, 0.96) * runeMask * uRuneRetention * 0.1;
    color = mix(color, color * (0.8 + velvetMask * 0.12) + vec3(dot(color, vec3(0.299, 0.587, 0.114))) * 0.16, clamp(uVelvetMatte, 0.0, 1.0));
    color *= 0.92 + glyphMask * uGlyphGrid * 0.12;
    float alpha = uOpacity * (0.35 + cut * 0.75 + contourMask * uContourMix * 0.2 + sootMask * uSootStain * 0.1 + runeMask * uRuneRetention * 0.08 + uVaporLift * 0.06);
    if (uDotField > 0.001) {
      vec2 cell = fract(vUv * mix(28.0, 56.0, uDotField) * mix(0.72, 1.48, clamp(uDotScale, 0.0, 1.5))) - 0.5;
      float dotMask = 1.0 - smoothstep(0.08 + uDotSoftness * 0.04, mix(0.36, 0.14, uDotField) + uDotSoftness * 0.08, length(cell));
      alpha *= mix(0.2, 1.0, dotMask);
      color *= 0.56 + dotMask * 0.74;
      color = mix(color, color * (0.82 + glyphMask * 0.26), uGlyphGrid * 0.68);
    }

    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.95, 0.97, 1.0), 0.26);
      alpha *= 0.82;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      float scan = 0.5 + 0.5 * sin(vUv.y * 130.0 + vHeight * 12.0);
      color = mix(color, vec3(0.12, 0.95, 1.0), 0.44) + vec3(0.08, 0.35, 0.42) * scan * 0.18;
      alpha *= 1.04;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float band = 0.5 + 0.5 * sin(vUv.y * 24.0 + vHeight * 8.0);
      color = mix(vec3(0.15), vec3(1.0), band) * mix(uColor, vec3(1.0), 0.4);
    } else if (uMaterialStyle > 3.5) {
      vec2 cell = fract(vUv * 20.0) - 0.5;
      float dots = 1.0 - smoothstep(0.12, 0.34, length(cell));
      alpha *= mix(0.42, 1.0, dots);
      color *= 0.46 + dots * 0.72;
    }

    gl_FragColor = vec4(color, alpha);
  }
`;


export const DepositionFieldSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const settings = getLayerRuntimeDepositionSnapshot(config, layerIndex);
  const particleData = useMemo(() => generateParticleData(config, layerIndex, false, 'aux'), [config, layerIndex]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1, 72, 72), []);
  const layerMode = settings.mode;
  const layerSource = settings.source;
  const depositionProfile = useMemo(() => withCrossFamilyDepositionProfile(withSourceAwareDepositionProfile(getDepositionProfile(layerMode), layerSource), layerMode, layerSource), [layerMode, layerSource]);

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material || !particleData || particleData.count === 0) return;

    const profile = depositionProfile;
    const globalRadius = config.sphereRadius * settings.radiusScale;
    const sampleCount = Math.min(28, particleData.count);
    const center = new THREE.Vector3();
    const t = clock.getElapsedTime();
    for (let i = 0; i < sampleCount; i += 1) {
      const index = Math.floor((i / Math.max(1, sampleCount - 1)) * Math.max(0, particleData.count - 1));
      center.add(estimateLayerPositionApprox({ config, layerIndex, particleData, index, globalRadius, time: t }));
    }
    center.multiplyScalar(1 / Math.max(1, sampleCount));
    group.position.copy(center.multiplyScalar(0.32));
    group.rotation.x = -Math.PI / 2 + Math.sin(t * 0.11 + layerIndex) * 0.18 * profile.pitchMul;
    group.rotation.z = Math.cos(t * 0.09 + layerIndex * 0.4) * 0.24 * profile.rotationMul;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioDrive = isPlaying ? (pulse + bass * 0.65) * settings.audioReactive : 0;
    const dotField = profile.dotField;
    const relief = Math.min(1.7, Math.max(0.04, settings.relief * profile.reliefMul + profile.reliefAdd));
    const erosion = Math.min(1.9, Math.max(0, settings.erosion * profile.erosionMul + profile.erosionAdd));
    const bands = Math.max(profile.bandsMin, settings.bands * profile.bandsMul);
    const opacity = Math.min(1.3, Math.max(0.04, settings.opacity * profile.opacityMul + profile.opacityAdd));
    const scale = globalRadius * (1.1 + relief * 0.22 + audioDrive * 0.08) * profile.scaleMul;
    group.scale.set(scale, scale * (0.82 + erosion * 0.12) * profile.scaleYMul, 1);

    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uOpacity.value = opacity;
    material.uniforms.uRelief.value = relief;
    material.uniforms.uErosion.value = erosion;
    material.uniforms.uBands.value = bands;
    material.uniforms.uPulse.value = pulse + bass * 0.25;
    material.uniforms.uAudioReactive.value = settings.audioReactive;
    material.uniforms.uTime.value = t;
    material.uniforms.uMaterialStyle.value = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
    material.uniforms.uDotField.value = dotField;
    material.uniforms.uDotScale.value = profile.dotScale;
    material.uniforms.uDotSoftness.value = profile.dotSoftness;
    material.uniforms.uBandWarp.value = profile.bandWarp;
    material.uniforms.uBleedSpread.value = profile.bleedSpread;
    material.uniforms.uGlyphGrid.value = profile.glyphGrid;
    material.uniforms.uContourMix.value = profile.contourMix;
    material.uniforms.uSootStain.value = profile.sootStain;
    material.uniforms.uRuneRetention.value = profile.runeRetention;
    material.uniforms.uVelvetMatte.value = profile.velvetMatte;
    material.uniforms.uVaporLift.value = profile.vaporLift;
    material.wireframe = settings.wireframe;
    material.blending = profile.normalBlend ? THREE.NormalBlending : THREE.AdditiveBlending;
  });

  if (!particleData || particleData.count === 0) return null;

  return (
    <group ref={groupRef} renderOrder={1}>
      <mesh geometry={geometry}>
        <shaderMaterial
          ref={materialRef}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          vertexShader={VERT}
          fragmentShader={FRAG}
          uniforms={{
            uColor: { value: new THREE.Color(settings.color) },
            uOpacity: { value: settings.opacity },
            uRelief: { value: settings.relief },
            uErosion: { value: settings.erosion },
            uBands: { value: settings.bands },
            uPulse: { value: 0 },
            uAudioReactive: { value: settings.audioReactive },
            uTime: { value: 0 },
            uMaterialStyle: { value: 0 },
            uDotField: { value: 0 },
            uDotScale: { value: 1 },
            uDotSoftness: { value: 0.5 },
            uBandWarp: { value: 0 },
            uBleedSpread: { value: 0 },
            uGlyphGrid: { value: 0 },
            uContourMix: { value: 0 },
            uSootStain: { value: 0 },
            uRuneRetention: { value: 0 },
            uVelvetMatte: { value: 0 },
            uVaporLift: { value: 0 },
          }}
        />
      </mesh>
    </group>
  );
};
