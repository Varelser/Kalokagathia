import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import {
  getLayerMode,
  getMembraneProfile,
  getSourceMembraneProfile,
  type MembraneAudioState,
  type MembraneLayout,
  withSourceAwareMembraneProfile,
} from './sceneMembraneSystemShared';

const tempPos = new THREE.Vector3();

export function useMembraneGeometryBindings(geometry: THREE.BufferGeometry, layout: MembraneLayout | null) {
  useEffect(() => {
    if (!layout) return;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(layout.usedCount * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(layout.uvArray, 2));
    geometry.setIndex(new THREE.BufferAttribute(layout.indexArray, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return () => {
      geometry.deleteAttribute('position');
      geometry.deleteAttribute('uv');
      geometry.setIndex(null);
    };
  }, [geometry, layout]);

  useEffect(() => () => geometry.dispose(), [geometry]);
}

export function useMembraneRuntime({
  config,
  layerIndex,
  audioRef,
  isPlaying,
  layout,
  geometry,
  surfaceMaterialRef,
  wireMaterialRef,
  frameCounterRef,
}: {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: MutableRefObject<MembraneAudioState>;
  isPlaying: boolean;
  layout: MembraneLayout | null;
  geometry: THREE.BufferGeometry;
  surfaceMaterialRef: MutableRefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: MutableRefObject<THREE.MeshBasicMaterial | null>;
  frameCounterRef: MutableRefObject<number>;
}) {
  useFrame(({ clock }) => {
    const surfaceMaterial = surfaceMaterialRef.current;
    const wireMaterial = wireMaterialRef.current;
    if (!layout || !surfaceMaterial || !wireMaterial) return;

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const mode = getLayerMode(config, layerIndex);
    const source = layerIndex === 2 ? config.layer2Source : config.layer3Source;
    const sourceProfile = getSourceMembraneProfile(source);
    const profile = withSourceAwareMembraneProfile(getMembraneProfile(mode), source);
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const treble = config.audioEnabled ? audioRef.current.treble * config.audioTrebleMotionScale : 0;
    const t = clock.getElapsedTime();
    const globalRadius = config.sphereRadius * (layerIndex === 2 ? config.layer2RadiusScale : config.layer3RadiusScale);
    const rippleAmount = layerIndex === 2 ? config.layer2SheetAudioReactive : config.layer3SheetAudioReactive;
    const audioReactive = isPlaying ? (pulse + bass * 0.7 + treble * 0.35) * rippleAmount : 0;

    for (let i = 0; i < layout.usedCount; i += 1) {
      const sourceIndex = layout.sampledIndices[i] ?? 0;
      const estimated = estimateLayerPositionApprox({
        config,
        layerIndex,
        particleData: layout.particleData,
        index: sourceIndex,
        globalRadius,
        time: t,
      });
      const uvx = layout.uvArray[i * 2 + 0] - 0.5;
      const uvy = layout.uvArray[i * 2 + 1] - 0.5;
      const radial = Math.sqrt(uvx * uvx + uvy * uvy);
      const theta = Math.atan2(uvy, uvx);
      const radialFalloff = Math.max(0, 1 - radial * 1.8);

      const ripple = Math.sin((uvx * 8.0 + uvy * 6.5) + t * 2.4) * (0.15 + audioReactive) * globalRadius * 0.03;
      const clothFold = Math.sin(uvx * 10.0 + uvy * 14.0 + t * (0.9 + profile.wind)) * globalRadius * profile.fold * 0.08;
      const clothSag = (uvy + 0.18 * Math.abs(uvx)) * globalRadius * profile.sag * -0.6;
      const clothDrape = Math.sin(uvx * 4.0 + t * (0.5 + profile.wind * 0.7)) * globalRadius * profile.drape * 0.07;
      const twist = Math.sin(theta * (2.0 + profile.twist * 5.0) + t * (0.32 + profile.twist * 0.68)) * (0.2 + radial) * globalRadius * profile.twist * 0.12;
      const anisotropic = Math.sin(uvx * Math.PI * (3.0 + profile.anisotropy * 6.0) - t * (0.44 + profile.wind * 0.3)) * globalRadius * profile.anisotropy * 0.06;
      const pocket = -Math.pow(radialFalloff, 1.6) * globalRadius * (profile.pocket + sourceProfile.pocket * 0.22) * (0.08 + 0.04 * Math.sin(t * 0.7 + uvx * 5.0));
      const creepShear = Math.sin(uvy * 7.0 + t * (0.22 + profile.creep * 0.28 + sourceProfile.shear * 0.22) + uvx * 4.0) * (0.3 + radial) * globalRadius * (profile.creep + sourceProfile.shear * 0.22) * 0.08;
      const springLift = Math.sin((uvx * 4.0 - uvy * 3.0) + t * (1.3 + profile.spring * 1.8 + sourceProfile.column * 0.7)) * globalRadius * profile.spring * (0.015 + 0.05 * audioReactive);
      const veilDrift = Math.cos(uvy * 8.0 - t * (0.48 + profile.veil * 0.92 + sourceProfile.veil * 0.8) + uvx * 2.4) * globalRadius * (profile.veil + sourceProfile.veil * 0.22) * 0.05;
      const seamPinch = (1 - Math.min(1, Math.abs(uvx) * 2.0)) * (profile.seam + sourceProfile.ledger * 0.16) * globalRadius * -0.02;
      const orbitBend = Math.sin(theta * (2.0 + sourceProfile.orbit * 6.0) + t * (0.42 + sourceProfile.orbit * 0.8)) * globalRadius * sourceProfile.orbit * 0.06;
      const ledgerSnap = sourceProfile.ledger > 0 ? Math.round((estimated.y + clothSag) / (globalRadius * 0.06)) * (globalRadius * 0.06 * (1 - sourceProfile.ledger * 0.28)) - estimated.y : 0;
      const fractureSnap = sourceProfile.fracture > 0 ? Math.round((estimated.x + anisotropic) / (globalRadius * 0.05)) * (globalRadius * 0.05 * (1 - sourceProfile.fracture * 0.24)) - estimated.x : 0;

      tempPos.copy(estimated).normalize().multiplyScalar(ripple + clothFold + springLift + pocket + orbitBend * 0.35);
      estimated.add(tempPos);
      estimated.y += clothSag + clothDrape + veilDrift * 0.7 + ledgerSnap * 0.5;
      estimated.x += anisotropic + creepShear + twist * uvy * 0.6 + fractureSnap * 0.7;
      estimated.z += veilDrift + twist + seamPinch + orbitBend;
      if (profile.anisotropy > 0 || sourceProfile.column > 0) {
        estimated.x += uvx * globalRadius * (profile.anisotropy * 0.08 + sourceProfile.column * 0.04);
        estimated.z -= uvy * globalRadius * (profile.anisotropy * 0.04 - sourceProfile.column * 0.02);
      }
      posAttr.setXYZ(i, estimated.x, estimated.y, estimated.z);
    }

    posAttr.needsUpdate = true;
    if (frameCounterRef.current % 3 === 0) {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
    frameCounterRef.current += 1;

    const opacity = layerIndex === 2 ? config.layer2SheetOpacity : config.layer3SheetOpacity;
    const fresnel = layerIndex === 2 ? config.layer2SheetFresnel : config.layer3SheetFresnel;
    const wireframe = layerIndex === 2 ? config.layer2SheetWireframe : config.layer3SheetWireframe;
    const color = layerIndex === 2 ? config.layer2Color : config.layer3Color;

    surfaceMaterial.uniforms.uColor.value.set(color);
    surfaceMaterial.uniforms.uOpacity.value = opacity * profile.alphaMul;
    surfaceMaterial.uniforms.uPulse.value = pulse + bass * 0.35;
    surfaceMaterial.uniforms.uFresnel.value = fresnel;
    surfaceMaterial.uniforms.uSeam.value = profile.seam;
    surfaceMaterial.uniforms.uFold.value = profile.fold;
    surfaceMaterial.uniforms.uPocket.value = profile.pocket;
    surfaceMaterial.uniforms.uTwist.value = profile.twist;
    surfaceMaterial.uniforms.uVeil.value = profile.veil;
    wireMaterial.color.set(color);
    wireMaterial.opacity = Math.min(1, opacity * 0.9);
    wireMaterial.visible = wireframe;
    surfaceMaterial.blending = profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  });
}
