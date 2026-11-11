import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import type { PatchLayout, PatchProfile, PatchSourceProfile } from './sceneSurfacePatchSystemShared';
import { getLayerPatchSettings } from './sceneSurfacePatchSystemShared';

const tempPos = new THREE.Vector3();
const accumPos = new THREE.Vector3();
const scratchPos = new THREE.Vector3();

type AudioRef = React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;

type SurfacePatchRuntimeArgs = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: AudioRef;
  isPlaying: boolean;
  layout: PatchLayout | null;
  patchProfile: PatchProfile;
  sourceProfile: PatchSourceProfile;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  wireMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: React.MutableRefObject<THREE.MeshBasicMaterial | null>;
  geometryRef: React.MutableRefObject<THREE.PlaneGeometry | null>;
};

export function useSurfacePatchRuntime({
  config,
  layerIndex,
  audioRef,
  isPlaying,
  layout,
  patchProfile,
  sourceProfile,
  meshRef,
  wireMeshRef,
  materialRef,
  wireMaterialRef,
  geometryRef,
}: SurfacePatchRuntimeArgs) {
  const previousPositionsRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
    previousPositionsRef.current = null;
  }, [geometryRef, layout?.resolution]);

  useEffect(() => () => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, [geometryRef]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const wireMesh = wireMeshRef.current;
    const material = materialRef.current;
    const wireMaterial = wireMaterialRef.current;
    if (!mesh || !wireMesh || !material || !wireMaterial || !layout) return;

    const settings = getLayerPatchSettings(config, layerIndex);
    const profile = patchProfile;
    const sourceShape = sourceProfile;
    const globalRadius = config.sphereRadius * (layerIndex === 2 ? config.layer2RadiusScale : config.layer3RadiusScale);
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioBoost = isPlaying ? (pulse + bass * 0.5) * settings.audioReactive : 0;
    const t = clock.getElapsedTime();

    if (!geometryRef.current) {
      geometryRef.current = new THREE.PlaneGeometry(globalRadius * 2, globalRadius * 2, layout.resolution - 1, layout.resolution - 1);
      mesh.geometry = geometryRef.current;
      wireMesh.geometry = geometryRef.current;
      previousPositionsRef.current = new Float32Array(layout.vertexCount * 3);
    }

    const geometry = geometryRef.current;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const previous = previousPositionsRef.current ?? new Float32Array(layout.vertexCount * 3);
    previousPositionsRef.current = previous;

    for (let y = 0; y < layout.resolution; y += 1) {
      for (let x = 0; x < layout.resolution; x += 1) {
        const index = y * layout.resolution + x;
        const sourceIndex = layout.sampledIndices[index] ?? 0;
        const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t });
        accumPos.set(estimated.x, estimated.y, estimated.z);
        let weight = 1;

        if (x > 0) {
          const leftIndex = layout.sampledIndices[index - 1] ?? sourceIndex;
          scratchPos.copy(estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: leftIndex, globalRadius, time: t }));
          accumPos.addScaledVector(scratchPos, 0.45);
          weight += 0.45;
        }
        if (y > 0) {
          const upIndex = layout.sampledIndices[index - layout.resolution] ?? sourceIndex;
          scratchPos.copy(estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: upIndex, globalRadius, time: t }));
          accumPos.addScaledVector(scratchPos, 0.45);
          weight += 0.45;
        }
        if (x > 0 && y > 0) {
          const diagIndex = layout.sampledIndices[index - layout.resolution - 1] ?? sourceIndex;
          scratchPos.copy(estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: diagIndex, globalRadius, time: t }));
          accumPos.addScaledVector(scratchPos, 0.2);
          weight += 0.2;
        }

        accumPos.multiplyScalar(1 / weight);
        const relax = settings.relax;
        const px = previous[index * 3 + 0];
        const py = previous[index * 3 + 1];
        const pz = previous[index * 3 + 2];
        const hasPrevious = index > 0 || px !== 0 || py !== 0 || pz !== 0;
        if (hasPrevious) {
          accumPos.x = THREE.MathUtils.lerp(accumPos.x, px, relax);
          accumPos.y = THREE.MathUtils.lerp(accumPos.y, py, relax);
          accumPos.z = THREE.MathUtils.lerp(accumPos.z, pz, relax);
        }

        const layerMode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
        const rippleBase = layerMode === 'contour_echo' ? 0.02 : layerMode === 'echo_rings' ? 0.032 : layerMode === 'standing_interference' ? 0.026 : layerMode === 'tremor_lattice' ? 0.034 : 0.012;
        const ripple = Math.sin((x / Math.max(1, layout.resolution - 1)) * Math.PI * 2.0 + t * 1.1 + y * 0.08) * globalRadius * rippleBase * profile.rippleMul * audioBoost;
        const ux = x / Math.max(1, layout.resolution - 1) - 0.5;
        const uy = y / Math.max(1, layout.resolution - 1) - 0.5;
        const radial = Math.sqrt(ux * ux + uy * uy);
        const theta = Math.atan2(uy, ux);
        const contourLift = Math.sin(radial * Math.PI * (4.0 + profile.contourBands * 10.0) + t * (0.35 + profile.echoMix * 0.55) + (ux - uy) * profile.shearMix * 10.0) * globalRadius * 0.04 * profile.contourSharpness * (0.4 + audioBoost);
        const ringLift = Math.sin(radial * Math.PI * (6.0 + profile.ringAmount * 18.0) - t * (0.8 + profile.echoMix * 0.9)) * globalRadius * 0.045 * profile.ringAmount;
        const interference = Math.sin((ux + uy) * (8.0 + profile.interferenceAmount * 14.0) + t * 0.82) * Math.cos((ux - uy) * (7.0 + profile.interferenceAmount * 12.0) - t * 0.66);
        const interferenceLift = interference * globalRadius * 0.04 * profile.interferenceAmount * (0.45 + audioBoost);
        const cellX = Math.sin(ux * Math.PI * (6.0 + profile.cellAmount * 10.0));
        const cellY = Math.sin(uy * Math.PI * (6.0 + profile.cellAmount * 10.0));
        const cellLift = (cellX * cellY) * globalRadius * 0.026 * profile.cellAmount;
        const tremorNoise = Math.sin(theta * (4.0 + profile.cellAmount * 3.0) + t * (2.4 + profile.tremorAmount * 1.8) + radial * 18.0);
        const tremorLift = tremorNoise * globalRadius * 0.028 * profile.tremorAmount * (0.5 + audioBoost);
        const creaseLift = Math.sin((ux - uy) * Math.PI * (3.0 + profile.creaseAmount * 6.0) + t * 0.34) * globalRadius * 0.024 * profile.creaseAmount;
        const edgeLift = Math.max(0, radial - 0.22) * globalRadius * 0.16 * profile.edgeLift;
        const spokeLift = Math.cos(theta * (4.0 + profile.spokeAmount * 10.0) - t * 0.26) * globalRadius * 0.024 * profile.spokeAmount * (0.2 + radial);
        const driftLift = Math.sin((ux + uy) * (4.0 + profile.driftAmount * 8.0) + t * (0.52 + profile.driftAmount * 0.6)) * globalRadius * 0.026 * profile.driftAmount;
        const terraceStep = profile.terraceAmount > 0 ? Math.round((radial + contourLift / Math.max(globalRadius, 1e-4)) * (4.0 + profile.terraceAmount * 8.0)) / (4.0 + profile.terraceAmount * 8.0) - radial : 0;
        const terraceLift = terraceStep * globalRadius * 0.26 * profile.terraceAmount;
        const ledgerLift = Math.sin((ux + 0.5) * (12.0 + sourceShape.ledger * 18.0) + t * 0.22) * globalRadius * 0.018 * sourceShape.ledger;
        const canopyLift = Math.max(0, uy + 0.2) * globalRadius * 0.08 * sourceShape.canopy;
        const sourceRingLift = Math.sin(radial * Math.PI * (4.0 + sourceShape.ring * 12.0) - t * 0.44) * globalRadius * 0.024 * sourceShape.ring;
        const sweepLift = Math.sin(theta * (2.0 + sourceShape.sweep * 4.0) + radial * (8.0 + sourceShape.sweep * 10.0) - t * 0.6) * globalRadius * 0.024 * sourceShape.sweep;
        const columnLift = (1.0 - Math.min(1.0, Math.abs(ux) * 1.8)) * globalRadius * 0.03 * sourceShape.column;
        const blobLift = Math.exp(-radial * 6.0) * globalRadius * 0.06 * sourceShape.blob;
        const fractureLift = Math.sign(Math.sin((ux - uy) * (10.0 + sourceShape.fracture * 14.0) + t * 0.18)) * globalRadius * 0.016 * sourceShape.fracture * (0.2 + radial);
        const veilLift = Math.sin((ux + uy) * (5.0 + sourceShape.veil * 8.0) + t * 0.4) * globalRadius * 0.014 * sourceShape.veil;
        tempPos.copy(accumPos).normalize();
        accumPos.addScaledVector(tempPos, ripple + contourLift + ringLift + interferenceLift + cellLift + tremorLift + creaseLift + edgeLift + spokeLift + driftLift + terraceLift + ledgerLift + canopyLift + sourceRingLift + columnLift + blobLift);
        if (profile.warpAmount > 0) {
          accumPos.x += Math.sin(theta * (2.0 + profile.warpAmount * 5.0) + t * 0.42) * globalRadius * profile.warpAmount * 0.06;
          accumPos.y += Math.cos(theta * (3.0 + profile.warpAmount * 4.0) - t * 0.36) * globalRadius * profile.warpAmount * 0.05;
          accumPos.z += Math.sin((ux - uy) * (8.0 + profile.warpAmount * 14.0) + t * 0.58) * globalRadius * profile.warpAmount * 0.04;
        }
        accumPos.x += sweepLift * 0.6 + fractureLift * 0.45;
        accumPos.y += veilLift + sweepLift * 0.18;
        accumPos.z += sourceRingLift * 0.42 - ledgerLift * 0.28;
        if (sourceShape.ledger > 0) {
          const ledgerStep = Math.max(globalRadius * 0.05, 1e-4);
          accumPos.y = THREE.MathUtils.lerp(accumPos.y, Math.round(accumPos.y / ledgerStep) * ledgerStep, Math.min(0.16, sourceShape.ledger * 0.1));
        }
        if (profile.planarPull > 0) {
          accumPos.z *= 1 - profile.planarPull * 0.22;
        }

        previous[index * 3 + 0] = accumPos.x;
        previous[index * 3 + 1] = accumPos.y;
        previous[index * 3 + 2] = accumPos.z;
        positionAttr.setXYZ(index, accumPos.x, accumPos.y, accumPos.z);
      }
    }

    positionAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    normalAttr.needsUpdate = true;
    geometry.computeBoundingSphere();

    const materialStyleIndex = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uOpacity.value = Math.min(1.3, Math.max(0.04, settings.opacity * profile.opacityMul + profile.opacityAdd));
    material.uniforms.uPulse.value = pulse + bass * 0.25;
    material.uniforms.uFresnel.value = Math.min(2, settings.fresnel + profile.fresnelAdd);
    material.uniforms.uMaterialStyle.value = materialStyleIndex;
    material.uniforms.uContourBands.value = profile.contourBands;
    material.uniforms.uContourSharpness.value = profile.contourSharpness;
    material.uniforms.uPlateMix.value = profile.plateMix;
    material.uniforms.uEchoMix.value = profile.echoMix;
    material.uniforms.uShearMix.value = profile.shearMix;
    material.uniforms.uRingAmount.value = profile.ringAmount;
    material.uniforms.uInterferenceAmount.value = profile.interferenceAmount;
    material.uniforms.uTremorAmount.value = profile.tremorAmount;
    material.uniforms.uTerraceAmount.value = profile.terraceAmount;
    material.uniforms.uCellAmount.value = profile.cellAmount;
    material.uniforms.uCreaseAmount.value = profile.creaseAmount;
    material.uniforms.uSpokeAmount.value = profile.spokeAmount;
    material.blending = profile.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
    mesh.rotation.z = Math.sin(t * 0.1 + layerIndex) * 0.08 * profile.rotationMul + sourceShape.sweep * 0.06;
    mesh.rotation.x = sourceShape.canopy * 0.08 - sourceShape.column * 0.04;
    wireMesh.rotation.copy(mesh.rotation);
    wireMaterial.color.set(settings.color);
    wireMaterial.opacity = Math.min(1, settings.opacity * 0.9);
    wireMaterial.visible = settings.wireframe;
  });
}
