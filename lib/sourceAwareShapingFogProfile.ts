import type { Layer3Source } from '../types/scene';
import type { FogLike } from './sourceAwareShapingTypes';
import { clampUnit } from './sourceAwareShapingUtils';

export function withCrossFamilyFogProfile<T extends FogLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:rune_smoke':
      next.runeAmount += 0.22;
      next.ledgerAmount += 0.14;
      next.coreTightness += 0.12;
      next.scaleMul *= 0.94;
      next.blending = 'normal';
      break;
    case 'text:static_smoke':
      next.staticAmount += 0.12;
      next.runeAmount += 0.08;
      next.ledgerAmount += 0.08;
      next.scaleMul *= 0.9;
      next.blending = 'normal';
      break;
    case 'text:soot_veil':
      next.sootAmount += 0.12;
      next.ledgerAmount += 0.12;
      next.glowMul *= 0.94;
      next.blending = 'normal';
      break;
    case 'grid:static_smoke':
      next.staticAmount += 0.24;
      next.ledgerAmount += 0.14;
      next.grain += 0.1;
      next.scaleMul *= 0.92;
      next.edgeFade = Math.max(0.08, next.edgeFade - 0.05);
      next.blending = 'normal';
      break;
    case 'grid:soot_veil':
      next.sootAmount += 0.12;
      next.velvetAmount += 0.06;
      next.blending = 'normal';
      break;
    case 'ring:dust_plume':
      next.plumeAmount += 0.12;
      next.dustAmount += 0.12;
      next.edgeFade += 0.06;
      break;
    case 'ring:mirage_smoke':
      next.mirageAmount += 0.16;
      next.swirl += 0.08;
      next.glowMul *= 1.06;
      break;
    case 'ring:eclipse_halo':
      next.coreTightness += 0.1;
      next.mirageAmount += 0.08;
      next.edgeFade += 0.04;
      break;
    case 'plane:soot_veil':
      next.sootAmount += 0.18;
      next.ledgerAmount += 0.14;
      next.velvetAmount += 0.08;
      next.blending = 'normal';
      break;
    case 'plane:velvet_ash':
      next.velvetAmount += 0.18;
      next.coreTightness += 0.08;
      next.blending = 'normal';
      break;
    default:
      break;
  }
  next.coreTightness = clampUnit(next.coreTightness);
  next.plumeAmount = clampUnit(next.plumeAmount);
  next.mirageAmount = clampUnit(next.mirageAmount);
  next.staticAmount = clampUnit(next.staticAmount);
  next.dustAmount = clampUnit(next.dustAmount);
  next.sootAmount = clampUnit(next.sootAmount);
  next.runeAmount = clampUnit(next.runeAmount);
  next.velvetAmount = clampUnit(next.velvetAmount);
  next.ledgerAmount = clampUnit(next.ledgerAmount);
  return next as T;
}

export function withSourceAwareFogProfile<T extends FogLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.runeAmount += 0.28;
      next.ledgerAmount += 0.22;
      next.coreTightness += 0.12;
      next.scaleMul *= 0.88;
      next.planeScaleMul *= 0.9;
      next.glowMul *= 1.06;
      next.blending = 'normal';
      break;
    case 'grid':
      next.ledgerAmount += 0.32;
      next.staticAmount += 0.22;
      next.densityMul *= 1.08;
      next.scaleMul *= 0.92;
      next.planeScaleMul *= 0.94;
      next.grain += 0.08;
      next.coreTightness += 0.12;
      next.edgeFade -= 0.04;
      next.blending = 'normal';
      break;
    case 'ring':
      next.glowMul *= 1.12;
      next.anisotropyAdd += 0.12;
      next.depthMul *= 1.08;
      next.swirl += 0.12;
      next.mirageAmount += 0.16;
      next.plumeAmount += 0.08;
      next.edgeFade += 0.06;
      break;
    case 'cylinder':
      next.streak += 0.14;
      next.anisotropyAdd += 0.18;
      next.driftMul *= 1.06;
      next.scaleMul *= 0.96;
      next.depthMul *= 1.04;
      break;
    case 'plane':
      next.ledgerAmount += 0.28;
      next.sootAmount += 0.08;
      next.velvetAmount += 0.1;
      next.densityMul *= 1.1;
      next.scaleMul *= 0.88;
      next.verticalBias -= 0.08;
      next.edgeFade -= 0.04;
      next.blending = 'normal';
      break;
    case 'image':
      next.mirageAmount += 0.12;
      next.grain += 0.06;
      next.edgeFade += 0.04;
      break;
    case 'video':
      next.runeAmount += 0.08;
      next.pulseNoise += 0.14;
      next.mirageAmount += 0.14;
      next.staticAmount += 0.12;
      next.glowMul *= 1.08;
      break;
    case 'sphere':
      next.plumeAmount += 0.1;
      next.scaleMul *= 1.04;
      next.depthMul *= 1.04;
      next.verticalBias += 0.06;
      break;
    default:
      break;
  }
  next.coreTightness = clampUnit(next.coreTightness);
  next.pulseNoise = Math.min(1.2, Math.max(0, next.pulseNoise));
  next.plumeAmount = clampUnit(next.plumeAmount);
  next.fallAmount = clampUnit(next.fallAmount);
  next.mirageAmount = clampUnit(next.mirageAmount);
  next.staticAmount = clampUnit(next.staticAmount);
  next.dustAmount = clampUnit(next.dustAmount);
  next.sootAmount = clampUnit(next.sootAmount);
  next.runeAmount = clampUnit(next.runeAmount);
  next.velvetAmount = clampUnit(next.velvetAmount);
  next.ledgerAmount = clampUnit(next.ledgerAmount);
  next.edgeFade = Math.min(0.48, Math.max(0.08, next.edgeFade));
  return next as T;
}
