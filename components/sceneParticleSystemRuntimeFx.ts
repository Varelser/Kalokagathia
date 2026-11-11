import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerRuntimeGhostTrailSnapshot, getLayerRuntimeSdfSnapshot } from '../lib/sceneRenderRouting';
import type { ParticleSystemAudioRef, ParticleSystemCollider } from './sceneParticleSystemRuntimeTypes';

export function applyParticleCollisionUniforms(
  mat: THREE.ShaderMaterial,
  config: ParticleConfig,
  audioRef: ParticleSystemAudioRef,
  layerIndex: 1 | 2 | 3 | 4,
  isAux: boolean,
  interLayerColliders: ParticleSystemCollider[],
  activeInterLayerColliderCount: number,
) {
  const bassInputForCollision = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
  const collisionAudioBoost = config.interLayerAudioReactive && config.audioEnabled
    ? 1 + (bassInputForCollision * config.interLayerAudioBoost)
    : 1;
  mat.uniforms.uInterLayerEnabled.value = config.interLayerCollisionEnabled && layerIndex <= 3 && !isAux ? 1 : 0;
  mat.uniforms.uInterLayerColliderCount.value = activeInterLayerColliderCount;
  if (activeInterLayerColliderCount > 0) {
    for (let i = 0; i < activeInterLayerColliderCount; i++) {
      const collider = interLayerColliders[i];
      if (!collider) continue;
      const uniformCollider = mat.uniforms.uInterLayerColliders.value[i] as THREE.Vector4;
      uniformCollider.set(collider.center.x, collider.center.y, collider.center.z, collider.radius);
    }
  }
  mat.uniforms.uInterLayerStrength.value = config.interLayerCollisionStrength * collisionAudioBoost;
  mat.uniforms.uInterLayerPadding.value = config.interLayerCollisionPadding;
}

export function applyParticleSdfUniforms(
  mat: THREE.ShaderMaterial,
  config: ParticleConfig,
  layerIndex: 1 | 2 | 3 | 4,
) {
  const sdfSnapshot = layerIndex === 2 || layerIndex === 3 ? getLayerRuntimeSdfSnapshot(config, layerIndex) : null;
  const sdfOn = layerIndex === 1 ? config.layer1SdfEnabled : sdfSnapshot ? sdfSnapshot.enabled : config.sdfShapeEnabled;
  const sdfShape = layerIndex === 1 ? config.layer1SdfShape : sdfSnapshot ? sdfSnapshot.shape : config.sdfShape;
  const sdfLX = layerIndex === 1 ? config.layer1SdfLightX : sdfSnapshot ? sdfSnapshot.lightX : config.sdfLightX;
  const sdfLY = layerIndex === 1 ? config.layer1SdfLightY : sdfSnapshot ? sdfSnapshot.lightY : config.sdfLightY;
  const sdfSpec = layerIndex === 1 ? config.layer1SdfSpecular : sdfSnapshot ? sdfSnapshot.specular : config.sdfSpecularIntensity;
  const sdfShin = layerIndex === 1 ? config.layer1SdfShininess : sdfSnapshot ? sdfSnapshot.shininess : config.sdfSpecularShininess;
  const sdfAmb = layerIndex === 1 ? config.layer1SdfAmbient : sdfSnapshot ? sdfSnapshot.ambient : config.sdfAmbientLight;
  mat.uniforms.uSdfEnabled.value = sdfOn ? 1 : 0;
  mat.uniforms.uSdfShape.value = sdfShape === 'ring' ? 1 : sdfShape === 'star' ? 2 : sdfShape === 'hexagon' ? 3 : 0;
  mat.uniforms.uSdfLight.value.set(sdfLX, sdfLY);
  mat.uniforms.uSdfSpecular.value = sdfSpec;
  mat.uniforms.uSdfShininess.value = sdfShin;
  mat.uniforms.uSdfAmbient.value = sdfAmb;
}

export function applyParticleGhostUniforms(
  mat: THREE.ShaderMaterial,
  config: ParticleConfig,
  layerIndex: 2 | 3,
  ghostMats: THREE.ShaderMaterial[],
  maxGhost: number,
) {
  if (ghostMats.length <= 0) return;
  const ghostTrail = getLayerRuntimeGhostTrailSnapshot(config, layerIndex);
  const ghostEnabled = ghostTrail.enabled;
  const ghostCount = ghostTrail.count;
  const ghostDt = ghostTrail.dt;
  const ghostFade = ghostTrail.fade;
  const mainTime = mat.uniforms.uTime.value;
  const mainOpacity = mat.uniforms.uOpacity.value;
  for (let i = 0; i < maxGhost; i++) {
    const gm = ghostMats[i];
    if (!gm) continue;
    if (ghostEnabled && i < ghostCount) {
      gm.uniforms.uAudioBass.value = mat.uniforms.uAudioBass.value;
      gm.uniforms.uAudioTreble.value = mat.uniforms.uAudioTreble.value;
      gm.uniforms.uAudioPulse.value = mat.uniforms.uAudioPulse.value;
      gm.uniforms.uAudioBassMotion.value = mat.uniforms.uAudioBassMotion.value;
      gm.uniforms.uAudioTrebleMotion.value = mat.uniforms.uAudioTrebleMotion.value;
      gm.uniforms.uTime.value = mainTime - (i + 1) * ghostDt;
      gm.uniforms.uOpacity.value = mainOpacity * Math.pow(ghostFade, i + 1);
    } else {
      gm.uniforms.uOpacity.value = 0;
    }
  }
}
