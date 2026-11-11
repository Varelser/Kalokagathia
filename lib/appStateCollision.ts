import * as THREE from 'three';
import type { ParticleConfig } from '../types';

type LayerColliderSummary = {
  enabled: boolean;
  center: THREE.Vector3;
  radius: number;
};

type LayerCollider = {
  center: THREE.Vector3;
  radius: number;
};

export const MAX_INTER_LAYER_COLLIDERS = 8;

function getConfiguredSourceOffset(config: ParticleConfig, layerIndex: 1 | 2 | 3, srcId: number) {
  let manual: { x: number; y: number; z: number } | null;
  let sourceCount: number;
  let spread: number;

  if (layerIndex === 1) {
    manual = config.layer1SourcePositions?.[srcId] ?? null;
    sourceCount = config.layer1SourceCount || 1;
    spread = config.layer1SourceSpread || 0;
  } else if (layerIndex === 2) {
    manual = config.layer2SourcePositions?.[srcId] ?? null;
    sourceCount = config.layer2SourceCount || 1;
    spread = config.layer2SourceSpread || 0;
  } else {
    manual = config.layer3SourcePositions?.[srcId] ?? null;
    sourceCount = config.layer3SourceCount || 1;
    spread = config.layer3SourceSpread || 0;
  }

  let x = manual?.x ?? 0;
  const y = manual?.y ?? 0;
  let z = manual?.z ?? 0;

  if (spread > 0 && sourceCount > 1) {
    const angle = (srcId / sourceCount) * Math.PI * 2;
    x += Math.cos(angle) * spread;
    z += Math.sin(angle) * spread;
  }

  return new THREE.Vector3(x, y, z);
}

function getLayerSourceColliders(config: ParticleConfig, layerIndex: 1 | 2 | 3): LayerCollider[] {
  const enabled = layerIndex === 1
    ? config.layer1Enabled
    : layerIndex === 2
      ? config.layer2Enabled
      : config.layer3Enabled;

  if (!enabled) {
    return [];
  }

  const sourceCount = layerIndex === 1
    ? Math.max(1, config.layer1SourceCount || 1)
    : layerIndex === 2
      ? Math.max(1, config.layer2SourceCount || 1)
      : Math.max(1, config.layer3SourceCount || 1);

  const baseRadius = layerIndex === 1
    ? config.sphereRadius
    : layerIndex === 2
      ? config.sphereRadius * config.layer2RadiusScale
      : config.sphereRadius * config.layer3RadiusScale;

  const radiusScales = layerIndex === 1
    ? config.layer1Radii
    : layerIndex === 2
      ? config.layer2RadiusScales
      : config.layer3RadiusScales;

  return Array.from({ length: sourceCount }, (_, sourceIndex) => ({
    center: getConfiguredSourceOffset(config, layerIndex, sourceIndex),
    radius: baseRadius * Math.max(0.2, radiusScales?.[sourceIndex] ?? 1),
  }));
}

function getLayerColliderSummary(config: ParticleConfig, layerIndex: 1 | 2 | 3): LayerColliderSummary {
  const colliders = getLayerSourceColliders(config, layerIndex);

  if (colliders.length === 0) {
    return { enabled: false, center: new THREE.Vector3(), radius: 0 };
  }

  const centers = colliders.map((collider) => collider.center);
  const center = centers.reduce((acc, point) => acc.add(point), new THREE.Vector3()).multiplyScalar(1 / centers.length);

  let radius = 0;
  colliders.forEach((collider) => {
    radius = Math.max(radius, collider.center.distanceTo(center) + collider.radius);
  });

  return { enabled: true, center, radius };
}

export function getInterLayerCollidersForLayer(config: ParticleConfig, layerIndex: 1 | 2 | 3): Array<{ center: THREE.Vector3; radius: number }> {
  if (!config.interLayerCollisionEnabled) {
    return [];
  }

  const otherLayers = ([1, 2, 3] as const).filter((candidate) => candidate !== layerIndex);

  if (config.interLayerCollisionMode === 'source-volume') {
    return otherLayers
      .flatMap((candidate) => getLayerSourceColliders(config, candidate))
      .filter((collider) => collider.radius > 0)
      .slice(0, MAX_INTER_LAYER_COLLIDERS);
  }

  return otherLayers
    .map((candidate) => getLayerColliderSummary(config, candidate))
    .filter((entry) => entry.enabled && entry.radius > 0)
    .map((entry) => ({ center: entry.center, radius: entry.radius }))
    .slice(0, MAX_INTER_LAYER_COLLIDERS);
}

function getColliderOverlapAmount(primary: LayerCollider, secondary: LayerCollider, padding: number) {
  const reach = primary.radius + secondary.radius + padding;
  if (reach <= 0) return 0;
  const distance = primary.center.distanceTo(secondary.center);
  return THREE.MathUtils.clamp((reach - distance) / reach, 0, 1);
}

export function getInterLayerContactAmount(config: ParticleConfig) {
  if (!config.interLayerCollisionEnabled) {
    return 0;
  }

  const layerPairs: Array<[1 | 2 | 3, 1 | 2 | 3]> = [[1, 2], [1, 3], [2, 3]];
  const contactAmounts = layerPairs.map(([layerA, layerB]) => {
    const collidersA = config.interLayerCollisionMode === 'source-volume'
      ? getLayerSourceColliders(config, layerA)
      : (() => {
        const summary = getLayerColliderSummary(config, layerA);
        return summary.enabled ? [{ center: summary.center, radius: summary.radius }] : [];
      })();
    const collidersB = config.interLayerCollisionMode === 'source-volume'
      ? getLayerSourceColliders(config, layerB)
      : (() => {
        const summary = getLayerColliderSummary(config, layerB);
        return summary.enabled ? [{ center: summary.center, radius: summary.radius }] : [];
      })();

    let pairContact = 0;
    collidersA.forEach((colliderA) => {
      collidersB.forEach((colliderB) => {
        pairContact = Math.max(pairContact, getColliderOverlapAmount(colliderA, colliderB, config.interLayerCollisionPadding));
      });
    });

    return pairContact;
  });

  return contactAmounts.length > 0 ? Math.max(...contactAmounts) : 0;
}
