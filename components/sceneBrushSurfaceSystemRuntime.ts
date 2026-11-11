import type React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { ParticleData } from './particleData';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import {
  type BrushPlane,
  type BrushProfile,
  type BrushSettings,
  getBrushMaterialStyleValue,
  signedHash,
} from './sceneBrushSurfaceSystemShared';

export function createBrushPlanes(layerCount: number): BrushPlane[] {
  const count = Math.max(2, Math.min(20, Math.floor(layerCount)));
  return Array.from({ length: count }, (_, index) => ({
    key: `brush-${index}`,
    mix: count <= 1 ? 0 : index / (count - 1),
    seed: index * 1.173 + 0.37,
    rotX: (index - count / 2) * 0.032,
    rotY: Math.sin(index * 0.7) * 0.18,
    rotZ: Math.cos(index * 1.3) * 0.22,
    zOffset: (index - (count - 1) / 2) * 5.5,
    geometry: (() => {
      const geometry = new THREE.PlaneGeometry(1, 1, 24, 24);
      const countVertices = geometry.attributes.position.count;
      const layerMix = new Float32Array(countVertices);
      layerMix.fill(count <= 1 ? 0 : index / (count - 1));
      geometry.setAttribute('layerMix', new THREE.BufferAttribute(layerMix, 1));
      return geometry;
    })(),
  }));
}

export function disposeBrushPlanes(planes: BrushPlane[]) {
  planes.forEach((plane) => plane.geometry.dispose());
}

export function updateBrushSurfaceFrame(args: {
  group: THREE.Group;
  materialRefs: React.MutableRefObject<THREE.ShaderMaterial[]>;
  config: ParticleConfig;
  layerIndex: 2 | 3;
  particleData: ParticleData;
  brushProfile: BrushProfile;
  settings: BrushSettings;
  planes: BrushPlane[];
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
  time: number;
}) {
  const { group, materialRefs, config, layerIndex, particleData, brushProfile: profile, settings, planes, audioRef, isPlaying, time: t } = args;
  if (particleData.count === 0) return;

  const globalRadius = config.sphereRadius * (layerIndex === 2 ? config.layer2RadiusScale : config.layer3RadiusScale);
  const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
  const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
  const audioBoost = isPlaying ? (pulse + bass * 0.65) * settings.audioReactive : 0;

  const sampleCount = Math.min(18, particleData.count);
  const center = new THREE.Vector3();
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.floor((i / Math.max(1, sampleCount - 1)) * Math.max(0, particleData.count - 1));
    const estimated = estimateLayerPositionApprox({
      config,
      layerIndex,
      particleData,
      index,
      globalRadius,
      time: t,
    });
    center.add(estimated);
  }
  center.multiplyScalar(1 / Math.max(1, sampleCount));
  group.position.copy(center.multiplyScalar(0.35));

  group.rotation.x = Math.sin(t * 0.19 + layerIndex * 0.7) * profile.groupRotX;
  group.rotation.y = Math.cos(t * 0.17 + layerIndex * 1.1) * profile.groupRotY;
  group.rotation.z = Math.sin(t * 0.11 + layerIndex * 0.4) * profile.groupRotZ;

  const baseScale = globalRadius * profile.baseScale * settings.scale * (1 + audioBoost * 0.18);
  planes.forEach((plane, index) => {
    const mesh = group.children[index] as THREE.Mesh | undefined;
    const material = materialRefs.current[index];
    if (!mesh || !material) return;

    const layerPulse = (pulse * (0.35 + plane.mix * 0.65) + bass * 0.18) * profile.pulseMul;
    const jitterScale = profile.jitterMul;
    const ribbonDrift = profile.ribbonDrift * (1 + plane.mix * 0.18);
    const smearDrift = profile.smearDrift * (1 + (1 - plane.mix) * 0.08);

    const orbitT = t * (0.24 + profile.spiralAmount * 0.42) + plane.seed * 5.0;
    const curtainT = (plane.mix - 0.5) * globalRadius * (0.3 + profile.curtainAmount * 0.9);
    const advectShift = profile.advectAmount * globalRadius * 0.18 * Math.sin(t * 0.46 + plane.seed * 3.0 + plane.mix * 2.4);
    const spiralX = Math.cos(orbitT) * globalRadius * 0.12 * profile.spiralAmount * (0.35 + plane.mix);
    const spiralY = Math.sin(orbitT * 1.18) * globalRadius * 0.08 * profile.spiralAmount * (0.3 + plane.mix);
    const meltDrop = profile.meltAmount * globalRadius * (0.05 + plane.mix * 0.16) * (0.45 + 0.55 * Math.sin(t * 0.31 + plane.seed * 4.0));
    const evaporateLift = profile.evaporateAmount * globalRadius * (0.04 + plane.mix * 0.12) * (0.55 + 0.45 * Math.cos(t * 0.27 + plane.seed * 2.2));
    const fanSpread = signedHash(plane.seed * 9.0) * globalRadius * 0.12 * profile.fanAmount * (0.4 + plane.mix);
    const curlRot = Math.sin(t * 0.28 + plane.seed * 6.0) * profile.curlAmount * 0.42;

    mesh.position.set(
      Math.sin(t * 0.43 + plane.seed * 7.0) * settings.jitter * 10 * jitterScale * ribbonDrift + spiralX + advectShift + fanSpread,
      Math.cos(t * 0.38 + plane.seed * 5.0) * settings.jitter * 10 * jitterScale * smearDrift + curtainT - meltDrop + evaporateLift + spiralY,
      plane.zOffset * profile.zStretch + Math.sin(t * 0.34 + plane.seed * 3.0) * settings.jitter * 8 * jitterScale + Math.cos(orbitT) * globalRadius * 0.06 * profile.advectAmount,
    );
    mesh.rotation.set(
      plane.rotX + Math.sin(t * 0.3 + plane.seed) * settings.jitter * 0.15 * jitterScale * profile.rotXMul + profile.curtainAmount * 0.18 + curlRot * 0.4,
      plane.rotY + Math.cos(t * 0.27 + plane.seed * 2.0) * settings.jitter * 0.18 * profile.rotYMul + profile.advectAmount * 0.32 + Math.sin(orbitT) * profile.spiralAmount * 0.26,
      plane.rotZ + Math.sin(t * 0.22 + plane.seed * 3.0) * settings.jitter * 0.2 * profile.rotZMul + curlRot,
    );
    const squash = profile.squashBase + Math.sin(t * 0.31 + plane.seed * 4.0) * profile.squashOsc;
    const widthScale = profile.widthBase + plane.mix * profile.widthMix + profile.evaporateAmount * 0.18 + profile.fanAmount * (plane.mix - 0.5) * 0.12;
    const heightScale = squash * (profile.heightBase + plane.mix * profile.heightMix + profile.meltAmount * 0.12 - profile.evaporateAmount * 0.1 + profile.curtainAmount * 0.12);
    mesh.scale.set(baseScale * widthScale, baseScale * heightScale, 1);

    material.blending = profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uOpacity.value = settings.opacity;
    material.uniforms.uTime.value = t;
    material.uniforms.uJitter.value = settings.jitter;
    material.uniforms.uPulse.value = layerPulse;
    material.uniforms.uAudioReactive.value = settings.audioReactive;
    material.uniforms.uTrailShear.value = profile.trailShear;
    material.uniforms.uVeilCurve.value = profile.veilCurve;
    material.uniforms.uBleedWarp.value = profile.bleedWarp;
    material.uniforms.uEdgeSoftness.value = profile.edgeSoftness;
    material.uniforms.uStreakFreq.value = profile.streakFreq;
    material.uniforms.uTearFreq.value = profile.tearFreq;
    material.uniforms.uBandFreq.value = profile.bandFreq;
    material.uniforms.uAlphaMul.value = profile.alphaMul;
    material.uniforms.uMaterialStyle.value = getBrushMaterialStyleValue(settings.materialStyle);
  });
}
