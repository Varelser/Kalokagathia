import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import type { HullLayout, ShellProfile, ShellSourceGeometryProfile } from './sceneSurfaceShellSystemShared';
import { createConvexHullGeometry } from './sceneSurfaceShellSystemShared';
import { getLayerRuntimeHullSnapshot } from '../lib/sceneRenderRouting';

const tempPos = new THREE.Vector3();
const scratchVec = new THREE.Vector3();
const shellTarget = new THREE.Vector3();

type SurfaceShellRuntimeParams = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
  layout: HullLayout | null;
  shellProfile: ShellProfile;
  sourceProfile: ShellSourceGeometryProfile;
  shellMaterialRef: RefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: RefObject<THREE.MeshBasicMaterial | null>;
  shellMeshRef: RefObject<THREE.Mesh | null>;
  wireMeshRef: RefObject<THREE.Mesh | null>;
};

export function useSurfaceShellSystemRuntime({
  config,
  layerIndex,
  audioRef,
  isPlaying,
  layout,
  shellProfile,
  sourceProfile,
  shellMaterialRef,
  wireMaterialRef,
  shellMeshRef,
  wireMeshRef,
}: SurfaceShellRuntimeParams) {
  const frameCounterRef = useRef(0);
  const pointPoolRef = useRef<THREE.Vector3[]>([]);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => () => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, []);

  useFrame(({ clock }) => {
    const shellMaterial = shellMaterialRef.current;
    const wireMaterial = wireMaterialRef.current;
    const shellMesh = shellMeshRef.current;
    const wireMesh = wireMeshRef.current;
    if (!layout || !shellMaterial || !wireMaterial || !shellMesh || !wireMesh) return;

    const profile = shellProfile;
    const sourceShape = sourceProfile;
    const runtime = getLayerRuntimeHullSnapshot(config, layerIndex);
    const globalRadius = config.sphereRadius * runtime.radiusScale;
    const jitter = runtime.jitter * profile.jitterMul;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioReactive = runtime.audioReactive;
    const t = clock.getElapsedTime();

    const pointCount = layout.usedCount;
    while (pointPoolRef.current.length < pointCount) pointPoolRef.current.push(new THREE.Vector3());
    for (let i = 0; i < pointCount; i += 1) {
      const sourceIndex = layout.sampledIndices[i] ?? 0;
      const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t });
      const noisePhase = i * 0.37 + t * 0.8;
      scratchVec.set(Math.sin(noisePhase), Math.cos(noisePhase * 1.13), Math.sin(noisePhase * 0.71));
      scratchVec.multiplyScalar(globalRadius * jitter * (0.35 + pulse * audioReactive * 0.9));
      tempPos.copy(estimated).add(scratchVec);

      tempPos.x *= profile.scaleX;
      tempPos.y *= profile.scaleY;
      tempPos.z *= profile.scaleZ;

      const baseLength = Math.max(1e-5, tempPos.length());
      scratchVec.copy(tempPos).multiplyScalar(1 / baseLength);
      const equator = 1 - Math.min(1, Math.abs(scratchVec.y));
      const azimuth = Math.atan2(scratchVec.z, scratchVec.x);
      const shellWave = Math.sin(
        scratchVec.x * (2.8 + profile.bandStrength * 4.2)
        + scratchVec.z * (2.1 + profile.scanScale * 3.4)
        + t * (0.45 + profile.etchStrength * 1.7)
        + i * 0.09,
      );
      const ridgeWave = Math.sin(azimuth * Math.max(1.0, profile.ridgeFreq) + scratchVec.y * (1.6 + profile.bandStrength * 2.4) + t * (0.28 + profile.ridgeAmount * 0.72));
      const petalWave = Math.cos(azimuth * (4.0 + profile.petalAmount * 6.0) - t * 0.22 + equator * 2.4);
      const seamWave = 1 - Math.min(1, Math.abs(Math.sin(azimuth * 0.5)));
      const haloRing = Math.pow(Math.max(0, equator), 1.1 + profile.haloSharpness * 3.8);
      const shellNoise = 0.5 + 0.5 * Math.sin(i * 1.91 + t * 0.82 + scratchVec.x * 4.2 + scratchVec.z * 3.1);
      const poreCut = profile.poreAmount > 0 ? Math.max(0, shellNoise - 0.58) * profile.poreAmount * haloRing : 0;
      const auraLift = profile.auraAmount * (0.02 + haloRing * 0.1 + (0.5 + 0.5 * shellWave) * 0.04);
      const diskLift = profile.diskAmount * haloRing * (0.03 + shellNoise * 0.07);
      const radialOffset = globalRadius * (
        profile.radialLift * equator
        + profile.ringLift * Math.pow(equator, 2.2)
        + profile.equatorBias * haloRing
        + profile.spikeStrength * Math.max(0, shellWave) * (0.35 + equator * 0.65)
        + profile.ridgeAmount * ridgeWave * (0.02 + equator * 0.08)
        + profile.petalAmount * petalWave * (0.015 + haloRing * 0.06)
        + profile.frostAmount * Math.max(0, ridgeWave) * haloRing * 0.05
        + profile.crownAmount * Math.max(0, scratchVec.y) * (0.03 + haloRing * 0.03)
        + profile.riftAmount * -Math.pow(seamWave, 1.6) * (0.01 + equator * 0.04)
        + profile.bloomAmount * haloRing * (0.02 + shellNoise * 0.05)
        + profile.sporeAmount * (shellNoise - 0.5) * haloRing * 0.06
        + sourceShape.canopy * Math.max(0, scratchVec.y) * (0.015 + equator * 0.05)
        + sourceShape.ring * haloRing * (0.018 + Math.max(0, ridgeWave) * 0.028)
        + sourceShape.bloom * (shellNoise - 0.35) * haloRing * 0.05
        + auraLift
        + diskLift
        - poreCut * 0.06
      );
      if (radialOffset !== 0) tempPos.addScaledVector(scratchVec, radialOffset);

      if (profile.mirrorWarp > 0) {
        tempPos.x = Math.sign(tempPos.x || 1) * Math.pow(Math.abs(tempPos.x), Math.max(0.72, 0.95 - profile.mirrorWarp * 0.25));
        tempPos.z *= 1 - profile.mirrorWarp * 0.24 + equator * profile.mirrorWarp * 0.18;
      }
      if (profile.seamAmount > 0) {
        tempPos.addScaledVector(scratchVec, -globalRadius * profile.seamAmount * 0.06 * seamWave);
        tempPos.y += globalRadius * profile.seamAmount * 0.03 * (seamWave - 0.35);
      }
      if (profile.creaseAmount > 0) {
        tempPos.x += Math.sin(azimuth * (5.0 + profile.creaseAmount * 7.0) + t * 0.34) * globalRadius * profile.creaseAmount * 0.02;
        tempPos.z += Math.cos(azimuth * (4.0 + profile.creaseAmount * 6.0) - t * 0.29) * globalRadius * profile.creaseAmount * 0.02;
      }
      if (sourceShape.ledger > 0) {
        const ledgerWave = Math.sin(tempPos.y * (0.22 + sourceShape.ledger * 0.16) + azimuth * (0.42 + sourceShape.ledger * 0.64) + t * 0.12);
        tempPos.x += ledgerWave * globalRadius * sourceShape.ledger * 0.012;
        tempPos.z -= ledgerWave * globalRadius * sourceShape.ledger * 0.01;
        const ledgerStep = Math.max(globalRadius * 0.045, 1e-4);
        tempPos.y = THREE.MathUtils.lerp(tempPos.y, Math.round(tempPos.y / ledgerStep) * ledgerStep, Math.min(0.16, sourceShape.ledger * 0.1));
      }
      if (sourceShape.column > 0) {
        const axial = 1 - equator;
        tempPos.y *= 1 + sourceShape.column * 0.08;
        tempPos.x *= 1 - sourceShape.column * 0.035 * axial;
        tempPos.z *= 1 - sourceShape.column * 0.035 * axial;
      }
      if (sourceShape.orbit > 0) {
        const orbitAngle = sourceShape.orbit * (0.1 + haloRing * 0.14) * Math.sin(t * 0.34 + azimuth * 0.52 + i * 0.01);
        const cosA = Math.cos(orbitAngle);
        const sinA = Math.sin(orbitAngle);
        const ox = tempPos.x;
        const oz = tempPos.z;
        tempPos.x = ox * cosA - oz * sinA;
        tempPos.z = ox * sinA + oz * cosA;
      }
      if (sourceShape.fracture > 0) {
        const fractureWave = Math.sign(Math.sin(azimuth * (3.0 + sourceShape.fracture * 5.0) + t * 0.18));
        tempPos.addScaledVector(scratchVec, globalRadius * sourceShape.fracture * 0.01 * fractureWave);
        tempPos.y += fractureWave * globalRadius * sourceShape.fracture * 0.008 * (0.3 + equator);
      }
      if (sourceShape.veil > 0) {
        tempPos.y += Math.sin(tempPos.x * 0.06 + t * 0.46 + i * 0.03) * globalRadius * sourceShape.veil * 0.018;
      }
      if (profile.scriptWarp > 0) {
        tempPos.addScaledVector(scratchVec, globalRadius * profile.scriptWarp * 0.04 * Math.sin(tempPos.y * 0.18 + tempPos.x * 0.07 + t * 0.7 + i * 0.2));
      }
      if (profile.diskAmount > 0) {
        tempPos.y *= 1 - profile.diskAmount * (0.18 + haloRing * 0.22);
        tempPos.x *= 1 + profile.diskAmount * (0.04 + haloRing * 0.06);
        tempPos.z *= 1 + profile.diskAmount * (0.04 + haloRing * 0.06);
      }
      if (profile.auraAmount > 0) {
        tempPos.addScaledVector(scratchVec, globalRadius * profile.auraAmount * 0.025 * Math.sin(t * 0.72 + i * 0.13 + equator * 2.0));
      }
      if (profile.centerDarkness > 0) {
        tempPos.y *= 1 - profile.centerDarkness * 0.08 * equator;
      }
      if (profile.droop > 0 || profile.flowAmount > 0) {
        tempPos.y -= globalRadius * (profile.droop * 0.12 * (0.55 + Math.max(0, -scratchVec.y)) + profile.flowAmount * 0.05 * (0.5 + shellNoise));
        tempPos.x += Math.sin(tempPos.y * 0.12 + i * 0.08 + t * 0.6) * globalRadius * profile.flowAmount * 0.018;
      }
      if (profile.lacquerAmount > 0 || sourceShape.lacquer > 0) {
        shellTarget.copy(scratchVec).multiplyScalar(baseLength * (1 + haloRing * (0.04 + sourceShape.lacquer * 0.02)));
        tempPos.lerp(shellTarget, profile.lacquerAmount * 0.08 + sourceShape.lacquer * 0.04);
        tempPos.multiplyScalar(1 - profile.lacquerAmount * 0.018 + shellNoise * profile.flowAmount * 0.004 + sourceShape.lacquer * 0.002);
      }
      if (profile.frostAmount > 0) {
        tempPos.x += ridgeWave * globalRadius * profile.frostAmount * 0.012;
        tempPos.z += petalWave * globalRadius * profile.frostAmount * 0.012;
      }
      if (profile.quantize > 0) {
        const step = Math.max(0.06, globalRadius * profile.quantize * 0.045);
        tempPos.set(
          Math.round(tempPos.x / step) * step,
          Math.round(tempPos.y / step) * step,
          Math.round(tempPos.z / step) * step,
        );
      }
      if (audioReactive > 0 && isPlaying) {
        tempPos.multiplyScalar(1 + (pulse + bass * 0.45) * audioReactive * 0.08);
      }
      pointPoolRef.current[i].copy(tempPos);
    }

    if (frameCounterRef.current % 4 === 0) {
      const newGeometry = createConvexHullGeometry(pointPoolRef.current.slice(0, pointCount));
      geometryRef.current?.dispose();
      geometryRef.current = newGeometry;
      shellMesh.geometry = newGeometry;
      wireMesh.geometry = newGeometry;
    }
    frameCounterRef.current += 1;

    const opacityBase = runtime.opacity;
    const fresnelBase = runtime.fresnel;
    const wireframeBase = runtime.wireframe;
    const opacity = Math.min(1.48, Math.max(0.04, opacityBase * profile.opacityMul + profile.opacityAdd));
    const fresnel = Math.min(2, Math.max(0, fresnelBase + profile.fresnelAdd + pulse * profile.haloSpread * 0.08));
    const wireframe = profile.wireframe ?? wireframeBase;
    const color = runtime.color;
    const materialStyle = runtime.materialStyle;
    const materialStyleIndex = materialStyle === 'glass' ? 1 : materialStyle === 'hologram' ? 2 : materialStyle === 'chrome' ? 3 : materialStyle === 'halftone' ? 4 : 0;
    shellMaterial.uniforms.uColor.value.set(color);
    shellMaterial.uniforms.uOpacity.value = opacity;
    shellMaterial.uniforms.uPulse.value = pulse + bass * 0.3;
    shellMaterial.uniforms.uFresnel.value = fresnel;
    shellMaterial.uniforms.uMaterialStyle.value = materialStyleIndex;
    shellMaterial.uniforms.uScanScale.value = profile.scanScale;
    shellMaterial.uniforms.uBandStrength.value = profile.bandStrength;
    shellMaterial.uniforms.uGrainStrength.value = profile.grainStrength;
    shellMaterial.uniforms.uHaloSpread.value = profile.haloSpread;
    shellMaterial.uniforms.uHaloSharpness.value = profile.haloSharpness;
    shellMaterial.uniforms.uEdgeTint.value = profile.edgeTint;
    shellMaterial.uniforms.uEtchStrength.value = profile.etchStrength;
    shellMaterial.uniforms.uPoreAmount.value = profile.poreAmount;
    shellMaterial.uniforms.uSporeAmount.value = profile.sporeAmount;
    shellMaterial.uniforms.uBloomAmount.value = profile.bloomAmount;
    shellMaterial.uniforms.uCenterDarkness.value = profile.centerDarkness;
    shellMaterial.uniforms.uAuraAmount.value = profile.auraAmount;
    shellMaterial.uniforms.uDiskAmount.value = profile.diskAmount;
    shellMaterial.uniforms.uLacquerAmount.value = profile.lacquerAmount;
    shellMaterial.uniforms.uFlowAmount.value = profile.flowAmount;
    shellMaterial.uniforms.uRidgeAmount.value = profile.ridgeAmount;
    shellMaterial.uniforms.uSeamAmount.value = profile.seamAmount;
    shellMaterial.uniforms.uFrostAmount.value = profile.frostAmount;
    shellMaterial.uniforms.uCrownAmount.value = profile.crownAmount;
    shellMaterial.uniforms.uRiftAmount.value = profile.riftAmount;
    shellMaterial.uniforms.uCreaseAmount.value = profile.creaseAmount;
    shellMaterial.blending = profile.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
    wireMaterial.color.set(color);
    wireMaterial.opacity = Math.min(1, opacity * profile.wireOpacity);
    wireMaterial.visible = wireframe;
  });
}
