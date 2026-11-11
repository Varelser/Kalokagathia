import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import { applyCrystalMaterialStyle, getCrystalProfile, getCrystalSettings, type ClusterLayout } from './sceneCrystalAggregateSystemShared';

const tempPos = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const tangent = new THREE.Vector3();
const offset = new THREE.Vector3();
const radial = new THREE.Vector3();
const horizontal = new THREE.Vector3();
const position = new THREE.Vector3();
const direction = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const downAxis = new THREE.Vector3(0, -1, 0);
const quat = new THREE.Quaternion();
const spinQuat = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const scaleVec = new THREE.Vector3();
const color = new THREE.Color();

function fract(value: number) { return value - Math.floor(value); }
function hash(value: number) { return fract(Math.sin(value * 127.13 + 19.37) * 43758.5453123); }
function signedHash(value: number) { return hash(value) * 2 - 1; }

type UpdateCrystalAggregateFrameArgs = {
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  config: ParticleConfig;
  isPlaying: boolean;
  layerIndex: 2 | 3;
  layout: ClusterLayout;
  material: THREE.MeshStandardMaterial;
  mesh: THREE.InstancedMesh;
  time: number;
};

export function updateCrystalAggregateFrame({ audioRef, config, isPlaying, layerIndex, layout, material, mesh, time }: UpdateCrystalAggregateFrameArgs) {
  const settings = getCrystalSettings(config, layerIndex);
  const mode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
  const profile = getCrystalProfile(mode, settings.source, settings.materialStyle);
  const globalRadius = config.sphereRadius * settings.radiusScale;
  const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
  const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
  const audioDrive = isPlaying ? (pulse + bass * 0.6) * settings.audioReactive : 0;
  const baseColor = color.set(settings.color);
  const style = applyCrystalMaterialStyle(baseColor, settings.materialStyle, pulse + bass * 0.25);

  let instance = 0;
  for (let anchor = 0; anchor < layout.anchorIndices.length; anchor += 1) {
    const sourceIndex = layout.anchorIndices[anchor] ?? 0;
    const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time });
    const estimatedNext = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: time + 0.03 });
    tempPos.set(estimated.x, estimated.y, estimated.z);
    nextPos.set(estimatedNext.x, estimatedNext.y, estimatedNext.z);
    tangent.copy(nextPos).sub(tempPos);
    if (tangent.lengthSq() < 1e-5) tangent.set(signedHash(anchor + 0.1), signedHash(anchor + 0.2), signedHash(anchor + 0.3));
    tangent.normalize();

    for (let crystalIndex = 0; crystalIndex < layout.perAnchor; crystalIndex += 1) {
      const seed = anchor * 19.37 + crystalIndex * 11.19;
      const radius = (0.18 + hash(seed + 1.4) * 0.82) * globalRadius * 0.14 * (0.55 + settings.spread) * profile.radiusMul;
      radial.set(signedHash(seed + 2.1), signedHash(seed + 3.8), signedHash(seed + 5.2));
      if (radial.lengthSq() < 1e-5) radial.set(0.4, 1, -0.2);
      radial.normalize();
      if (profile.chainAmount > 0) radial.lerp(tangent, Math.min(0.88, profile.chainAmount * (0.34 + hash(seed + 21.4) * 0.38))).normalize();
      offset.copy(radial).multiplyScalar(radius);
      if (profile.sheetAmount > 0) { offset.y *= 1.0 - Math.min(0.92, profile.sheetAmount * 0.78); offset.x *= 1.0 + profile.sheetAmount * 0.4; offset.z *= 1.0 + profile.sheetAmount * 0.32; }
      position.copy(tempPos).add(offset);
      if (profile.basinBias > 0) { position.x = THREE.MathUtils.lerp(position.x, tempPos.x, Math.min(0.82, profile.basinBias * 0.34)); position.z = THREE.MathUtils.lerp(position.z, tempPos.z, Math.min(0.82, profile.basinBias * 0.34)); position.y -= globalRadius * profile.basinBias * (0.04 + hash(seed + 17.2) * 0.08); }
      if (profile.haloAmount > 0) position.addScaledVector(radial, globalRadius * 0.06 * profile.haloAmount * (0.55 + hash(seed + 16.8) * 0.6));
      if (profile.ringFlatten > 0) { position.y = tempPos.y + (position.y - tempPos.y) * (1 - profile.ringFlatten); horizontal.set(offset.x, 0, offset.z); if (horizontal.lengthSq() < 1e-5) horizontal.set(Math.cos(seed), 0, Math.sin(seed)); horizontal.normalize(); position.addScaledVector(horizontal, globalRadius * 0.06 * profile.orbitBias * (0.45 + hash(seed + 12.6) * 0.9)); }
      if (profile.verticalLift !== 0) position.y += globalRadius * profile.verticalLift * (0.08 + hash(seed + 4.4) * 0.22);
      if (profile.settleAmount > 0) position.y -= globalRadius * profile.settleAmount * (0.03 + hash(seed + 22.1) * 0.1);
      if (profile.bloomBias !== 0) { const bloomPulse = 0.45 + 0.55 * Math.sin(time * (0.7 + profile.bloomBias * 1.4) + seed * 0.12 + audioDrive * 2.6); position.addScaledVector(radial, globalRadius * 0.05 * profile.bloomBias * bloomPulse); }
      if (profile.gustBias !== 0) { const gust = Math.sin(time * 0.82 + seed * 0.14) * globalRadius * 0.08 * profile.gustBias; position.x += gust; position.z += Math.cos(time * 0.67 + seed * 0.11) * globalRadius * 0.06 * profile.gustBias; }

      direction.copy(tangent).addScaledVector(radial, 0.75 + profile.directionJitter * (0.4 + hash(seed + 7.8)));
      if (profile.sheetAmount > 0.001) direction.y *= 1.0 - Math.min(0.86, profile.sheetAmount * 0.68);
      if (profile.ringFlatten > 0.4) direction.y *= 0.32;
      if (profile.settleAmount > 0.001) direction.lerp(downAxis, Math.min(0.72, profile.settleAmount * 0.26));
      if (direction.lengthSq() < 1e-5) direction.copy(upAxis);
      direction.normalize();
      quat.setFromUnitVectors(upAxis, direction);
      const tumbleSpin = profile.tumbleAmount > 0 ? Math.sin(time * (0.8 + profile.tumbleAmount * 0.9) + seed * 0.13) * profile.tumbleAmount * 0.9 : 0;
      spinQuat.setFromAxisAngle(direction, time * profile.spin + seed * (0.08 + profile.spin * 0.16) + tumbleSpin);
      quat.multiply(spinQuat);

      const crystalScale = globalRadius * 0.02 * settings.scale * (0.8 + hash(seed + 8.3) * 1.6) * (1 + audioDrive * 0.45);
      scaleVec.set(crystalScale * profile.scaleX * (0.72 + hash(seed + 4.7) * 0.42), crystalScale * profile.scaleY * (0.8 + hash(seed + 9.1) * 0.86), crystalScale * profile.scaleZ * (0.68 + hash(seed + 7.3) * 0.38));
      matrix.compose(position, quat, scaleVec);
      mesh.setMatrixAt(instance, matrix);
      const lightness = profile.lightnessShift + signedHash(seed + 6.7) * ((mode === 'bloom_spores' || mode === 'pollen_storm') ? 0.12 : 0.08);
      mesh.setColorAt(instance, style.color.clone().offsetHSL(profile.hueShift, 0, lightness));
      instance += 1;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  material.opacity = THREE.MathUtils.clamp(settings.opacity * style.opacity * profile.opacityMul + profile.opacityAdd, 0.04, 1.28);
  material.emissive.copy(style.emissive);
  material.color.copy(style.color);
  material.roughness = profile.roughness + (settings.materialStyle === 'chrome' ? -0.12 : settings.materialStyle === 'glass' ? -0.08 : 0);
  material.metalness = THREE.MathUtils.clamp(profile.metalness + (settings.materialStyle === 'chrome' ? 0.44 : settings.materialStyle === 'glass' ? 0.1 : 0), 0, 1);
  material.wireframe = settings.wireframe;
}
