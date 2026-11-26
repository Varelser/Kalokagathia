export type {
  ParticleSystemAudioRef,
  ParticleSystemCollider,
  UpdateParticleSystemFrameArgs,
} from './sceneParticleSystemRuntimeTypes';

import * as THREE from 'three';
import { scaleFrameDelta } from '../lib/playbackTime';
import type { UpdateParticleSystemFrameArgs } from './sceneParticleSystemRuntimeTypes';
import { getLayerRuntimeParticleVisualSnapshot } from '../lib/sceneRenderRouting';
import { fillGradientLutData, getKinetixGradientPreset } from '../lib/kinetixGradients';
import { applyParticleAudioUniforms } from './sceneParticleSystemRuntimeAudio';
import { audioSceneOutputValue } from '../lib/audioSceneGraph';
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
  // Global time scale (B3): layer clocks advance by the scaled delta in
  // realtime playback (negative values run the layer motion backwards);
  // the deterministic renderer locks the scale to 1 during exports.
  if (isPlaying) mat.uniforms.uTime.value += scaleFrameDelta(delta, config);

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
  const hueSceneValue = audioSceneOutputValue(config, audioRef.current, 'hue');
  mat.uniforms.uHueShift.value = config.audioEnabled && config.audioHueShiftScale > 0.001
    ? hueSceneValue.sum * config.audioHueShiftScale * hueSceneValue.coefficient
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

  // Layer gradient (Phase M): layer 2/3 points only (layer 1 and
  // ambient keep the flag at 0). The LUT is rebaked only when the
  // preset actually changes (key cached on the material), mirroring
  // the GPGPU gradient's per-frame sync.
  if (mat.uniforms.uLayerGradEnabled) {
    const gradOn = !isAux && (layerIndex === 2 || layerIndex === 3)
      ? (layerIndex === 2 ? config.layer2GradEnabled : config.layer3GradEnabled)
      : false;
    mat.uniforms.uLayerGradEnabled.value = gradOn ? 1 : 0;
    if (gradOn && mat.uniforms.uLayerGradLut) {
      const presetId = layerIndex === 2 ? config.layer2GradPreset : config.layer3GradPreset;
      const preset = getKinetixGradientPreset(presetId) ?? getKinetixGradientPreset('sumie');
      if (preset && mat.userData.layerGradKey !== preset.id) {
        mat.userData.layerGradKey = preset.id;
        const lut = mat.uniforms.uLayerGradLut.value as THREE.DataTexture | null;
        if (lut) {
          fillGradientLutData(lut.image.data as Uint8Array, preset.start, preset.mid, preset.end);
          lut.needsUpdate = true;
        }
      }
    }
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
