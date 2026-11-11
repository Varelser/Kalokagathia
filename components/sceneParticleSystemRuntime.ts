export type {
  ParticleSystemAudioRef,
  ParticleSystemCollider,
  UpdateParticleSystemFrameArgs,
} from './sceneParticleSystemRuntimeTypes';

import * as THREE from 'three';
import type { UpdateParticleSystemFrameArgs } from './sceneParticleSystemRuntimeTypes';
import { getLayerRuntimeParticleVisualSnapshot } from '../lib/sceneRenderRouting';
import { applyParticleAudioUniforms } from './sceneParticleSystemRuntimeAudio';
import { applyParticleCollisionUniforms, applyParticleGhostUniforms, applyParticleSdfUniforms } from './sceneParticleSystemRuntimeFx';
import { applyParticleLayerUniforms, buildParticleLayerKey, resolveParticleLayerUniformState } from './sceneParticleSystemRuntimeLayer';

export const updateParticleSystemFrame = ({
  config,
  layerIndex,
  isAux,
  auxMode,
  audioRef,
  isPlaying,
  contactAmount,
  state,
  meshRef,
  windRef,
  spinRef,
  prevAudioEnabledRef,
  prevLayerKeyRef,
  interLayerColliders,
  activeInterLayerColliderCount,
  ghostMats,
  maxGhost,
  delta,
}: UpdateParticleSystemFrameArgs) => {
  if (!meshRef.current) return;

  const mat = meshRef.current.material as THREE.ShaderMaterial;
  if (isPlaying) mat.uniforms.uTime.value += delta;

  applyParticleAudioUniforms(mat, config, audioRef, prevAudioEnabledRef);

  mat.uniforms.uMouse.value.set(state.pointer.x, state.pointer.y);
  mat.uniforms.uOpacity.value = config.opacity * (isAux ? (auxMode === 'spark' ? 0.85 : 0.7) : 1.0);
  const layerHex = layerIndex === 1
    ? config.layer1Color
    : (layerIndex === 2 || layerIndex === 3
      ? getLayerRuntimeParticleVisualSnapshot(config, layerIndex).color
      : (config.ambientColor ?? '#888888'));
  mat.uniforms.uColor.value.setStyle(layerHex);
  mat.uniforms.uContrast.value = config.contrast;
  mat.uniforms.uInkMode.value = config.particleColor === 'black' ? 1 : 0;
  mat.uniforms.uHueShift.value = config.audioEnabled && config.audioHueShiftScale > 0.001
    ? (audioRef.current.bass * 0.35 + audioRef.current.treble * 0.2 + audioRef.current.pulse * 0.45) * config.audioHueShiftScale * 0.3
    : 0;
  mat.uniforms.uSoftness.value = config.particleSoftness;
  const impactGlowBoost = config.interLayerContactFxEnabled && config.interLayerCollisionEnabled
    ? contactAmount * config.interLayerContactGlowBoost
    : 0;
  mat.uniforms.uGlow.value = Math.min(3, config.particleGlow + impactGlowBoost);
  mat.uniforms.uIsOrthographic.value = config.viewMode === 'orthographic' ? 1 : 0;

  const layerVisual = layerIndex === 2 || layerIndex === 3 ? getLayerRuntimeParticleVisualSnapshot(config, layerIndex) : null;
  const layerSource = layerVisual?.source ?? null;
  const layerMediaMap = layerVisual?.mediaLumaMap ?? [];
  const layerMediaDepth = layerVisual?.mediaDepth ?? 0;
  const geomMode3D = layerVisual?.geomMode3D ?? 'billboard';
  const mediaReactive = !isAux && (layerSource === 'image' || layerSource === 'video' || layerSource === 'text') && layerMediaMap.length > 0;
  mat.uniforms.uMediaReactive.value = mediaReactive ? 1 : 0;
  mat.uniforms.uMediaSizeBoost.value = mediaReactive
    ? Math.min(1.35, (layerSource === 'video' ? 0.82 : layerSource === 'text' ? 0.64 : 0.56) + layerMediaDepth * 0.32)
    : 0;
  mat.uniforms.uMediaAlphaBoost.value = mediaReactive
    ? Math.min(1.1, (layerSource === 'video' ? 0.74 : layerSource === 'text' ? 0.58 : 0.5) + layerMediaDepth * 0.18)
    : 0;
  const glyphInstancingActive = mediaReactive && layerSource === 'text' && geomMode3D !== 'billboard';
  mat.uniforms.uMediaGlyphInstancing.value = glyphInstancingActive ? 1 : 0;
  mat.uniforms.uMediaGlyphDepthBoost.value = glyphInstancingActive ? Math.min(1.8, 0.6 + layerMediaDepth * 1.2) : 0;
  mat.uniforms.uMediaGlyphTwist.value = glyphInstancingActive ? Math.min(2.2, 0.45 + layerMediaDepth * 1.35) : 0;
  mat.uniforms.uMediaGlyphQuantize.value = glyphInstancingActive ? 5 : 0;

  const uniformState = resolveParticleLayerUniformState(config, layerIndex, isAux, auxMode, windRef.current, spinRef.current);
  const layerKey = buildParticleLayerKey(uniformState);
  if (layerKey !== prevLayerKeyRef.current) {
    prevLayerKeyRef.current = layerKey;
    applyParticleLayerUniforms(mat, config, uniformState, contactAmount, isAux);
  }

  applyParticleCollisionUniforms(mat, config, audioRef, layerIndex, isAux, interLayerColliders, activeInterLayerColliderCount);
  applyParticleSdfUniforms(mat, config, layerIndex);

  const geomScale3D = layerVisual?.geomScale3D ?? 1.0;
  mat.uniforms.uInstanced3D.value = geomMode3D !== 'billboard' ? 1 : 0;
  mat.uniforms.uInstanced3DScale.value = geomScale3D;

  if (!isAux && (layerIndex === 2 || layerIndex === 3)) {
    applyParticleGhostUniforms(mat, config, layerIndex, ghostMats, maxGhost);
  }
};
