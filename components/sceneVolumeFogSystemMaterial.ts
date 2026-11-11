import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { VolumeFogUniformParams } from './sceneVolumeFogSystemTypes';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './sceneVolumeFogSystemShaders';

export function getVolumeFogPlaneScale(config: ParticleConfig, fogDepth: number) {
  return 140 + Math.max(config.layer2RadiusScale, config.layer3RadiusScale) * 6.5 + fogDepth * 0.45;
}

export function applyVolumeFogMaterialUniforms(
  material: THREE.ShaderMaterial,
  params: VolumeFogUniformParams & { audio: number; time: number; sliceIndex: number },
) {
  const { sharedColor, fogOpacity, fogDensity, fogScale, fogDrift, fogGlow, fogAnisotropy, materialStyleIndex, sliceCount, profile, audio, time, sliceIndex } = params;
  material.uniforms.uTime.value = time;
  material.uniforms.uColor.value.copy(sharedColor);
  material.uniforms.uOpacity.value = Math.min(1.56, Math.max(0.04, fogOpacity * profile.opacityMul + profile.opacityAdd));
  material.uniforms.uDensity.value = Math.min(2, Math.max(0.02, fogDensity * profile.densityMul));
  material.uniforms.uScale.value = Math.max(0.1, fogScale * profile.scaleMul);
  material.uniforms.uDrift.value = fogDrift * profile.driftMul + profile.driftAdd;
  material.uniforms.uAudio.value = audio;
  material.uniforms.uSliceIndex.value = sliceIndex;
  material.uniforms.uSliceCount.value = sliceCount;
  material.uniforms.uMaterialStyle.value = materialStyleIndex;
  material.uniforms.uGlow.value = Math.min(2, Math.max(0, fogGlow * profile.glowMul + profile.glowAdd));
  material.uniforms.uAnisotropy.value = Math.min(2, Math.max(0, fogAnisotropy + profile.anisotropyAdd));
  material.uniforms.uStreak.value = profile.streak;
  material.uniforms.uGrain.value = profile.grain;
  material.uniforms.uSwirl.value = profile.swirl;
  material.uniforms.uVerticalBias.value = profile.verticalBias;
  material.uniforms.uCoreTightness.value = profile.coreTightness;
  material.uniforms.uPulseNoise.value = profile.pulseNoise;
  material.uniforms.uEmber.value = profile.ember;
  material.uniforms.uPlumeAmount.value = profile.plumeAmount;
  material.uniforms.uFallAmount.value = profile.fallAmount;
  material.uniforms.uMirageAmount.value = profile.mirageAmount;
  material.uniforms.uStaticAmount.value = profile.staticAmount;
  material.uniforms.uDustAmount.value = profile.dustAmount;
  material.uniforms.uSootAmount.value = profile.sootAmount;
  material.uniforms.uRuneAmount.value = profile.runeAmount;
  material.uniforms.uVelvetAmount.value = profile.velvetAmount;
  material.uniforms.uLedgerAmount.value = profile.ledgerAmount;
  material.uniforms.uEdgeFade.value = profile.edgeFade;
  material.blending = profile.blending === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
}

export function createVolumeFogMaterial(params: VolumeFogUniformParams & { sliceIndex: number }) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: params.profile.blending === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: params.sharedColor.clone() },
      uOpacity: { value: Math.min(1.56, Math.max(0.04, params.fogOpacity * params.profile.opacityMul + params.profile.opacityAdd)) },
      uDensity: { value: Math.min(2, Math.max(0.02, params.fogDensity * params.profile.densityMul)) },
      uScale: { value: Math.max(0.1, params.fogScale * params.profile.scaleMul) },
      uDrift: { value: params.fogDrift * params.profile.driftMul + params.profile.driftAdd },
      uAudio: { value: 0 },
      uSliceIndex: { value: params.sliceIndex },
      uSliceCount: { value: params.sliceCount },
      uMaterialStyle: { value: params.materialStyleIndex },
      uGlow: { value: Math.min(2, Math.max(0, params.fogGlow * params.profile.glowMul + params.profile.glowAdd)) },
      uAnisotropy: { value: Math.min(2, Math.max(0, params.fogAnisotropy + params.profile.anisotropyAdd)) },
      uStreak: { value: params.profile.streak },
      uGrain: { value: params.profile.grain },
      uSwirl: { value: params.profile.swirl },
      uVerticalBias: { value: params.profile.verticalBias },
      uCoreTightness: { value: params.profile.coreTightness },
      uPulseNoise: { value: params.profile.pulseNoise },
      uEmber: { value: params.profile.ember },
      uPlumeAmount: { value: params.profile.plumeAmount },
      uFallAmount: { value: params.profile.fallAmount },
      uMirageAmount: { value: params.profile.mirageAmount },
      uStaticAmount: { value: params.profile.staticAmount },
      uDustAmount: { value: params.profile.dustAmount },
      uSootAmount: { value: params.profile.sootAmount },
      uRuneAmount: { value: params.profile.runeAmount },
      uVelvetAmount: { value: params.profile.velvetAmount },
      uLedgerAmount: { value: params.profile.ledgerAmount },
      uEdgeFade: { value: params.profile.edgeFade },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  return material;
}
