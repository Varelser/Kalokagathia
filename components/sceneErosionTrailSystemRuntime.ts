import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import {
  getErosionProfile,
  getErosionTrailSettings,
  type ErosionTrailAudioState,
  type TrailLayout,
} from './sceneErosionTrailSystemShared';

const tempPos = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const tangent = new THREE.Vector3();
const downhill = new THREE.Vector3();
const lateral = new THREE.Vector3();
const radial = new THREE.Vector3();
const orbitAxis = new THREE.Vector3();
const flow = new THREE.Vector3();
const pointA = new THREE.Vector3();
const pointB = new THREE.Vector3();
const refUp = new THREE.Vector3(0, 1, 0);
const refRight = new THREE.Vector3(1, 0, 0);
const refForward = new THREE.Vector3(0, 0, 1);

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 127.13 + 19.19) * 43758.5453123);
}

function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

function stepSmooth(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-5, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function useErosionTrailRuntime({
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
  audioRef: React.MutableRefObject<ErosionTrailAudioState>;
  isPlaying: boolean;
  lineRef: React.MutableRefObject<THREE.LineSegments | null>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  layout: TrailLayout | null;
}) {
  useFrame(({ clock }) => {
    const line = lineRef.current;
    const material = materialRef.current;
    if (!line || !material || !layout) return;

    const settings = getErosionTrailSettings(config, layerIndex);
    const profile = getErosionProfile(config, layerIndex);
    const globalRadius = config.sphereRadius * settings.radiusScale;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const treble = config.audioEnabled ? audioRef.current.treble * config.audioTrebleMotionScale : 0;
    const audioBoost = isPlaying ? (pulse + bass * 0.7 + treble * 0.25) * settings.audioReactive : 0;
    const t = clock.getElapsedTime();

    if (!geometryRef.current) {
      const segmentPairs = layout.trailCount * layout.segmentsPerTrail;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segmentPairs * 2 * 3), 3));
      geometry.setAttribute('trailMix', new THREE.BufferAttribute(new Float32Array(segmentPairs * 2), 1));
      geometryRef.current = geometry;
      line.geometry = geometry;
    }

    const geometry = geometryRef.current;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const mixAttr = geometry.getAttribute('trailMix') as THREE.BufferAttribute;

    for (let i = 0; i < layout.trailCount; i += 1) {
      const sourceIndex = layout.sampledIndices[i] ?? 0;
      const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t });
      const estimatedNext = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t + 0.016 });

      tempPos.set(estimated.x, estimated.y, estimated.z);
      nextPos.set(estimatedNext.x, estimatedNext.y, estimatedNext.z);
      tangent.copy(nextPos).sub(tempPos);
      if (tangent.lengthSq() < 1e-5) {
        tangent.set(signedHash(i + 0.2), signedHash(i + 0.7), signedHash(i + 1.3));
      }
      tangent.normalize();

      radial.copy(tempPos);
      if (radial.lengthSq() < 1e-5) radial.set(0.001, 1, 0);
      radial.normalize();
      orbitAxis.crossVectors(radial, refUp);
      if (orbitAxis.lengthSq() < 1e-5) orbitAxis.crossVectors(radial, refForward);
      orbitAxis.normalize();

      downhill.copy(refUp)
        .multiplyScalar(-1)
        .addScaledVector(radial, 0.18 + profile.fan * 0.22)
        .addScaledVector(tangent, 0.12 + profile.meander * 0.18)
        .normalize();
      lateral.crossVectors(downhill, Math.abs(downhill.z) > 0.9 ? refRight : refForward).normalize();
      if (lateral.lengthSq() < 1e-5) lateral.set(1, 0, 0);

      pointA.copy(tempPos);
      const baseSeed = i * 17.37;
      const totalLength = settings.length * (0.66 + hash(baseSeed + 0.4) * 0.82) * (1 + audioBoost * 0.6);
      const driftScale = settings.drift * globalRadius * 0.052;
      const fanSign = signedHash(baseSeed + 8.2);
      const meanderPhase = hash(baseSeed + 1.2) * Math.PI * 2;

      for (let segment = 0; segment < layout.segmentsPerTrail; segment += 1) {
        const trailMix = segment / Math.max(1, layout.segmentsPerTrail - 1);
        const headMix = 1 - trailMix;
        const segmentLength = totalLength / layout.segmentsPerTrail * (0.7 + hash(baseSeed + segment * 0.91) * 0.72);
        const wave = Math.sin(meanderPhase + segment * (0.74 + profile.meander * 0.8) + t * (0.35 + profile.curl * 0.3));
        const braidWave = Math.sin(baseSeed * 0.4 + segment * 1.6 + t * 0.8) * profile.braid;
        const orbitWave = Math.cos(baseSeed * 0.23 + segment * 0.66 + t * 0.45) * profile.orbit;
        const notchGate = stepSmooth(0.45, 0.72, fract(segment * 0.37 + hash(baseSeed + 4.1))) * profile.notch;
        const fractureSnap = Math.round((wave * (1 + profile.fracture * 3)) * (1 + profile.fracture * 2)) / Math.max(1, 2 + Math.round(profile.fracture * 5));
        const terraceDrop = Math.floor((trailMix + hash(baseSeed + segment * 2.1) * 0.3) * (1 + profile.terrace * 6)) / Math.max(1, 1 + Math.round(profile.terrace * 6));

        flow.copy(downhill)
          .addScaledVector(lateral, wave * driftScale * (0.42 + profile.meander) * headMix)
          .addScaledVector(orbitAxis, orbitWave * driftScale * (0.28 + profile.orbit * 0.7) * headMix)
          .addScaledVector(radial, fanSign * profile.fan * 0.18 * headMix + (terraceDrop - 0.5) * profile.terrace * 0.08)
          .addScaledVector(tangent, fractureSnap * driftScale * (0.08 + profile.fracture * 0.2) + braidWave * driftScale * 0.16)
          .normalize();

        const slump = (0.18 + profile.slump * 0.48) * segmentLength * (0.7 + trailMix * 0.8);
        const wobble = wave * driftScale * (0.42 + profile.meander * 0.7) * headMix;
        const braidOffset = braidWave * driftScale * 0.42 * headMix;
        const orbitOffset = orbitWave * driftScale * 0.32 * headMix;
        const carve = fractureSnap * driftScale * (0.18 + profile.fracture * 0.35);
        const notch = notchGate * driftScale * 0.3;

        pointB.copy(pointA)
          .addScaledVector(flow, segmentLength)
          .addScaledVector(refUp, -slump)
          .addScaledVector(lateral, wobble + braidOffset)
          .addScaledVector(orbitAxis, orbitOffset)
          .addScaledVector(tangent, carve)
          .addScaledVector(radial, notch - profile.fan * trailMix * globalRadius * 0.003)
          .addScaledVector(refUp, -(terraceDrop - 0.5) * profile.terrace * segmentLength * 0.3);

        const baseIndex = (i * layout.segmentsPerTrail + segment) * 2;
        positionAttr.setXYZ(baseIndex + 0, pointA.x, pointA.y, pointA.z);
        positionAttr.setXYZ(baseIndex + 1, pointB.x, pointB.y, pointB.z);
        mixAttr.setX(baseIndex + 0, trailMix);
        mixAttr.setX(baseIndex + 1, Math.min(1, trailMix + 1 / layout.segmentsPerTrail));
        pointA.copy(pointB);
      }
    }

    positionAttr.needsUpdate = true;
    mixAttr.needsUpdate = true;
    geometry.computeBoundingSphere();

    const styleIndex = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uOpacity.value = settings.opacity;
    material.uniforms.uPulse.value = pulse + bass * 0.25;
    material.uniforms.uMaterialStyle.value = styleIndex;
    material.uniforms.uTime.value = t;
    material.uniforms.uBraid.value = profile.braid;
    material.uniforms.uFracture.value = profile.fracture;
    material.uniforms.uTerrace.value = profile.terrace;
    material.uniforms.uOrbit.value = profile.orbit;
  });
}
