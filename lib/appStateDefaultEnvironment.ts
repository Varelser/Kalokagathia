import type { ParticleConfig } from '../types';

export const APP_STATE_DEFAULT_ENVIRONMENT: Partial<ParticleConfig> = {
  // Inter-Layer Collision
  interLayerCollisionEnabled: false,
  interLayerCollisionStrength: 55,
  interLayerCollisionPadding: 80,
  interLayerCollisionMode: 'layer-volume',
  interLayerAudioReactive: false,
  interLayerAudioBoost: 1.2,
  interLayerContactFxEnabled: false,
  interLayerContactGlowBoost: 0.5,
  interLayerContactSizeBoost: 0.35,
  interLayerContactLineBoost: 0.45,
  interLayerContactScreenBoost: 0.35,

  // Depth Fog & Export
  depthFogEnabled: false,
  depthFogNear: 500,
  depthFogFar: 2800,
  exportScale: 1,
  exportTransparent: false,
};
