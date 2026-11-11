import type { Layer2Type, Layer3Source, ParticleConfig } from '../types';
import { MOTION_MAP } from '../components/scenePrimitives';

const RANDOM_SOURCE_KEYS: Layer3Source[] = [
  'sphere',
  'center',
  'ring',
  'disc',
  'cube',
  'cylinder',
  'random',
  'cone',
  'torus',
  'spiral',
  'galaxy',
  'grid',
  'plane',
];

export function buildRandomizedPresetConfig(prev: ParticleConfig): ParticleConfig {
  const motionKeys = Object.keys(MOTION_MAP) as Layer2Type[];

  return {
    ...prev,
    renderQuality: 'draft',
    interLayerCollisionEnabled: false,
    layer2ConnectionEnabled: false,
    layer3ConnectionEnabled: false,
    layer2AuxEnabled: false,
    layer3AuxEnabled: false,
    layer2SparkEnabled: false,
    layer3SparkEnabled: false,
    screenPersistenceIntensity: Math.min(prev.screenPersistenceIntensity, 0.08),
    screenPersistenceLayers: Math.min(prev.screenPersistenceLayers, 2),
    layer1Count: Math.floor(Math.random() * 2400) + 600,
    layer2Count: Math.floor(Math.random() * 4200) + 1200,
    layer3Count: Math.floor(Math.random() * 1400) + 300,
    ambientCount: Math.floor(Math.random() * 320) + 80,
    baseSize: Math.random() * 0.8 + 0.35,
    sphereRadius: Math.random() * 140 + 90,
    layer2Type: motionKeys[Math.floor(Math.random() * motionKeys.length)] ?? prev.layer2Type,
    layer3Type: motionKeys[Math.floor(Math.random() * motionKeys.length)] ?? prev.layer3Type,
    layer2Source: RANDOM_SOURCE_KEYS[Math.floor(Math.random() * RANDOM_SOURCE_KEYS.length)] ?? prev.layer2Source,
    layer3Source: RANDOM_SOURCE_KEYS[Math.floor(Math.random() * RANDOM_SOURCE_KEYS.length)] ?? prev.layer3Source,
    particleColor: Math.random() > 0.5 ? 'white' : 'black',
    backgroundColor: Math.random() > 0.5 ? 'black' : 'white',
    rotationSpeedX: (Math.random() - 0.5) * 0.02,
    rotationSpeedY: (Math.random() - 0.5) * 0.02,
  };
}
