import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import {
  getGrowthProfile,
  getLayerGrowthSettings,
  getLayerMode,
  getLayerSource,
  getSourceGrowthProfile,
  type GrowthFieldAudioState,
  type GrowthLayout,
} from './sceneGrowthFieldSystemShared';

const tempPos = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const tangent = new THREE.Vector3();
const normal = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const branchDir = new THREE.Vector3();
const twigDir = new THREE.Vector3();
const trunkEnd = new THREE.Vector3();
const branchStart = new THREE.Vector3();
const branchEnd = new THREE.Vector3();
const twigStart = new THREE.Vector3();
const twigEnd = new THREE.Vector3();
const stableX = new THREE.Vector3(1, 0, 0);
const stableY = new THREE.Vector3(0, 1, 0);
const orbitVec = new THREE.Vector3();
const swirlVec = new THREE.Vector3();

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 91.173 + 17.137) * 43758.5453123);
}

function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

export function useGrowthFieldRuntime({
  config,
  layerIndex,
  audioRef,
  isPlaying,
  lineRef,
  geometryRef,
  materialRef,
  layout,
}: {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<GrowthFieldAudioState>;
  isPlaying: boolean;
  lineRef: React.MutableRefObject<THREE.LineSegments | null>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  layout: GrowthLayout | null;
}) {
  useFrame(({ clock }) => {
    const line = lineRef.current;
    const material = materialRef.current;
    if (!line || !material || !layout) return;

    const settings = getLayerGrowthSettings(config, layerIndex);
    const profile = getGrowthProfile(getLayerMode(config, layerIndex));
    const sourceProfile = getSourceGrowthProfile(getLayerSource(config, layerIndex));
    const globalRadius = config.sphereRadius * settings.radiusScale;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioBoost = isPlaying ? (pulse + bass * 0.55) * settings.audioReactive : 0;
    const t = clock.getElapsedTime();

    if (!geometryRef.current) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(layout.maxStrandCount * 2 * 3), 3));
      geometry.setAttribute('growthMix', new THREE.BufferAttribute(new Float32Array(layout.maxStrandCount * 2), 1));
      geometryRef.current = geometry;
      line.geometry = geometry;
    }

    const geometry = geometryRef.current;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const mixAttr = geometry.getAttribute('growthMix') as THREE.BufferAttribute;
    let strandIndex = 0;

    for (let i = 0; i < layout.sampledIndices.length; i += 1) {
      const sourceIndex = layout.sampledIndices[i] ?? 0;
      const estimated = estimateLayerPositionApprox({
        config,
        layerIndex,
        particleData: layout.particleData,
        index: sourceIndex,
        globalRadius,
        time: t,
      });
      const estimatedNext = estimateLayerPositionApprox({
        config,
        layerIndex,
        particleData: layout.particleData,
        index: sourceIndex,
        globalRadius,
        time: t + 0.02,
      });

      tempPos.set(estimated.x, estimated.y, estimated.z);
      nextPos.set(estimatedNext.x, estimatedNext.y, estimatedNext.z);
      tangent.copy(nextPos).sub(tempPos);
      if (tangent.lengthSq() < 1e-5) {
        tangent.set(signedHash(i + 0.1), signedHash(i + 0.2), signedHash(i + 0.3));
      }
      tangent.normalize();
      normal.crossVectors(tangent, Math.abs(tangent.y) > 0.9 ? stableX : stableY).normalize();
      if (normal.lengthSq() < 1e-5) normal.set(1, 0, 0);
      bitangent.crossVectors(tangent, normal).normalize();

      orbitVec.copy(tempPos).setY(0);
      if (orbitVec.lengthSq() < 1e-5) orbitVec.set(1, 0, 0);
      orbitVec.normalize();
      swirlVec.set(-orbitVec.z, 0, orbitVec.x).normalize();
      const trunkLength = settings.length * profile.trunkMul * (1 + audioBoost * 0.9 + hash(i + 1.4) * 0.18);
      trunkEnd.copy(nextPos)
        .addScaledVector(tangent, trunkLength)
        .addScaledVector(normal, signedHash(i + 2.7) * settings.spread * globalRadius * (profile.jitter * 0.08 + sourceProfile.fan * 0.1))
        .addScaledVector(bitangent, signedHash(i + 4.2) * settings.spread * globalRadius * (profile.jitter * 0.06 + sourceProfile.sweep * 0.08))
        .addScaledVector(swirlVec, sourceProfile.orbit * globalRadius * 0.16 * Math.sin(t * 0.55 + i * 0.37))
        .setY(
          nextPos.y
          + tangent.y * trunkLength
          + globalRadius * (profile.verticalLift + sourceProfile.canopy * 0.14 + sourceProfile.column * 0.08)
          - globalRadius * (profile.droop + sourceProfile.droop * 0.08) * hash(i + 6.1)
          + signedHash(i + 6.7) * globalRadius * profile.jitter * 0.04,
        );
      if (sourceProfile.terrace > 0) {
        trunkEnd.y = Math.round(trunkEnd.y / (globalRadius * 0.08)) * (globalRadius * 0.08 * (1 - sourceProfile.terrace * 0.4));
      }

      let baseIndex = strandIndex * 2;
      positionAttr.setXYZ(baseIndex + 0, tempPos.x, tempPos.y, tempPos.z);
      positionAttr.setXYZ(baseIndex + 1, trunkEnd.x, trunkEnd.y, trunkEnd.z);
      mixAttr.setX(baseIndex + 0, 0);
      mixAttr.setX(baseIndex + 1, 0.42);
      strandIndex += 1;

      for (let branch = 0; branch < layout.branchCount; branch += 1) {
        const seed = i * 13.731 + branch * 17.123;
        const angle = ((branch / Math.max(1, layout.branchCount)) - 0.5) * settings.spread * profile.spreadMul * Math.PI * 1.35 + signedHash(seed + 3.7) * 0.35;
        branchDir.copy(tangent)
          .multiplyScalar(profile.tangentMix + sourceProfile.sweep * 0.12)
          .addScaledVector(normal, Math.sin(angle) * (profile.normalMix + settings.spread * (0.6 + sourceProfile.fan * 0.25)))
          .addScaledVector(bitangent, Math.cos(angle) * (profile.bitangentMix + settings.spread * (0.4 + sourceProfile.orbit * 0.35)))
          .addScaledVector(swirlVec, sourceProfile.orbit * Math.sin(angle * 1.2 + t * 0.4))
          .normalize();
        branchStart.copy(tempPos).lerp(trunkEnd, profile.startMin + hash(seed + 1.8) * profile.startRange);
        if (sourceProfile.ledger > 0) {
          const ledgerStep = globalRadius * (0.05 + sourceProfile.ledger * 0.08);
          branchStart.x = Math.round(branchStart.x / ledgerStep) * ledgerStep;
        }
        const branchLength = settings.length * profile.branchMul * (0.3 + hash(seed + 5.1) * 0.45) * (1 + audioBoost * 0.8 + sourceProfile.canopy * 0.16);
        branchEnd.copy(branchStart)
          .addScaledVector(branchDir, branchLength)
          .addScaledVector(normal, signedHash(seed + 7.3) * globalRadius * settings.spread * (profile.jitter * 0.12 + sourceProfile.fracture * 0.08))
          .addScaledVector(bitangent, signedHash(seed + 8.9) * globalRadius * settings.spread * (profile.jitter * 0.08 + sourceProfile.sweep * 0.08))
          .addScaledVector(swirlVec, sourceProfile.orbit * globalRadius * 0.08 * Math.cos(seed + t * 0.6))
          .setY(
            branchStart.y
            + branchDir.y * branchLength
            + globalRadius * (profile.verticalLift * 0.4 + sourceProfile.canopy * 0.08)
            - globalRadius * (profile.droop + sourceProfile.droop * 0.14) * hash(seed + 9.7),
          );
        if (sourceProfile.fracture > 0) {
          const fractureStep = globalRadius * (0.04 + sourceProfile.fracture * 0.06);
          branchEnd.x = Math.round(branchEnd.x / fractureStep) * fractureStep;
          branchEnd.z = Math.round(branchEnd.z / fractureStep) * fractureStep;
        }
        if (sourceProfile.terrace > 0) {
          branchEnd.y = Math.round(branchEnd.y / (globalRadius * 0.06)) * (globalRadius * 0.06 * (1 - sourceProfile.terrace * 0.35));
        }

        baseIndex = strandIndex * 2;
        positionAttr.setXYZ(baseIndex + 0, branchStart.x, branchStart.y, branchStart.z);
        positionAttr.setXYZ(baseIndex + 1, branchEnd.x, branchEnd.y, branchEnd.z);
        mixAttr.setX(baseIndex + 0, 0.45);
        mixAttr.setX(baseIndex + 1, 1);
        strandIndex += 1;

        if (hash(seed + 12.4) < profile.twigRate + sourceProfile.canopy * 0.08) {
          twigDir.copy(branchDir)
            .multiplyScalar(0.62)
            .addScaledVector(normal, Math.sin(angle * 1.7 + 0.8) * (profile.twigSpread + sourceProfile.fan * 0.18))
            .addScaledVector(bitangent, Math.cos(angle * 1.5 - 0.4) * (profile.twigSpread * 0.82 + sourceProfile.sweep * 0.16))
            .addScaledVector(swirlVec, sourceProfile.orbit * 0.18)
            .normalize();
          twigStart.copy(branchStart).lerp(branchEnd, 0.4 + hash(seed + 13.9) * 0.38);
          const twigLength = branchLength * profile.twigMul * (0.72 + hash(seed + 14.3) * 0.24 + sourceProfile.column * 0.12);
          twigEnd.copy(twigStart)
            .addScaledVector(twigDir, twigLength)
            .setY(twigStart.y + twigDir.y * twigLength + globalRadius * (profile.verticalLift * 0.18 + sourceProfile.canopy * 0.04));
          if (sourceProfile.fracture > 0.18) {
            twigEnd.x = Math.round(twigEnd.x / (globalRadius * 0.035)) * (globalRadius * 0.035);
            twigEnd.z = Math.round(twigEnd.z / (globalRadius * 0.035)) * (globalRadius * 0.035);
          }

          baseIndex = strandIndex * 2;
          positionAttr.setXYZ(baseIndex + 0, twigStart.x, twigStart.y, twigStart.z);
          positionAttr.setXYZ(baseIndex + 1, twigEnd.x, twigEnd.y, twigEnd.z);
          mixAttr.setX(baseIndex + 0, 0.72);
          mixAttr.setX(baseIndex + 1, 1);
          strandIndex += 1;
        }
      }
    }

    positionAttr.needsUpdate = true;
    mixAttr.needsUpdate = true;
    geometry.setDrawRange(0, strandIndex * 2);
    geometry.computeBoundingSphere();

    const styleIndex = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uOpacity.value = settings.opacity;
    material.uniforms.uPulse.value = (pulse + bass * 0.25) * profile.pulseMul;
    material.uniforms.uMaterialStyle.value = styleIndex;
    material.uniforms.uTipGlow.value = profile.tipGlow;
    material.uniforms.uBarkBands.value = profile.bandFreq;
    material.uniforms.uGateFreq.value = profile.gateFreq;
    material.uniforms.uAlphaMul.value = profile.alphaMul;
  });
}
