import type { Layer3Source } from '../types/scene';
import type { DepositionLike } from './sourceAwareShapingTypes';
import { clampUnit } from './sourceAwareShapingUtils';

export function withCrossFamilyDepositionProfile<T extends DepositionLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:ink_bleed':
      next.glyphGrid += 0.14;
      next.runeRetention += 0.16;
      next.bleedSpread += 0.12;
      next.velvetMatte += 0.08;
      next.normalBlend = true;
      break;
    case 'text:drift_glyph_dust':
      next.glyphGrid += 0.16;
      next.runeRetention += 0.16;
      next.opacityMul *= 0.92;
      next.vaporLift += 0.08;
      next.normalBlend = true;
      break;
    case 'grid:stipple_field':
      next.bandsMul *= 1.08;
      next.bandWarp += 0.22;
      next.glyphGrid += 0.14;
      next.contourMix += 0.14;
      next.sootStain += 0.08;
      next.velvetMatte += 0.06;
      next.normalBlend = true;
      break;
    case 'grid:deposition_field':
      next.bandsMul *= 1.1;
      next.bandWarp += 0.14;
      next.contourMix += 0.08;
      next.normalBlend = true;
      break;
    case 'ring:ink_bleed':
      next.contourMix += 0.12;
      next.vaporLift += 0.12;
      next.rotationMul *= 1.06;
      break;
    case 'ring:contour_echo':
      next.contourMix += 0.14;
      next.opacityMul *= 0.96;
      break;
    case 'plane:ink_bleed':
      next.sootStain += 0.14;
      next.velvetMatte += 0.14;
      next.bleedSpread += 0.12;
      next.normalBlend = true;
      break;
    case 'plane:deposition_field':
      next.sootStain += 0.1;
      next.velvetMatte += 0.08;
      next.bandWarp += 0.08;
      next.normalBlend = true;
      break;
    default:
      break;
  }
  next.bandWarp = clampUnit(next.bandWarp);
  next.bleedSpread = clampUnit(next.bleedSpread);
  next.glyphGrid = clampUnit(next.glyphGrid);
  next.contourMix = clampUnit(next.contourMix);
  next.sootStain = clampUnit(next.sootStain);
  next.runeRetention = clampUnit(next.runeRetention);
  next.velvetMatte = clampUnit(next.velvetMatte);
  next.vaporLift = clampUnit(next.vaporLift);
  return next as T;
}

export function withSourceAwareDepositionProfile<T extends DepositionLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.glyphGrid += 0.22;
      next.runeRetention += 0.22;
      next.contourMix += 0.18;
      next.bandWarp += 0.08;
      next.scaleMul *= 0.96;
      next.scaleYMul *= 0.86;
      next.dotSoftness *= 1.04;
      next.normalBlend = true;
      break;
    case 'grid':
      next.glyphGrid += 0.16;
      next.contourMix += 0.12;
      next.bandWarp += 0.16;
      next.bandsMul *= 1.08;
      next.bandsMin = Math.max(next.bandsMin, 4);
      next.dotField = Math.min(1, next.dotField + 0.06);
      next.scaleYMul *= 0.9;
      next.normalBlend = true;
      break;
    case 'ring':
      next.contourMix += 0.2;
      next.bleedSpread += 0.1;
      next.vaporLift += 0.18;
      next.rotationMul *= 1.08;
      next.pitchMul *= 0.92;
      next.opacityMul *= 0.96;
      break;
    case 'plane':
      next.sootStain += 0.12;
      next.velvetMatte += 0.14;
      next.bleedSpread += 0.12;
      next.scaleMul *= 1.02;
      next.scaleYMul *= 0.94;
      next.normalBlend = true;
      break;
    case 'cylinder':
      next.rotationMul *= 1.12;
      next.pitchMul *= 1.08;
      next.glyphGrid += 0.08;
      next.bandWarp += 0.12;
      break;
    case 'image':
      next.bleedSpread += 0.14;
      next.contourMix += 0.08;
      next.dotSoftness *= 1.08;
      next.scaleMul *= 1.04;
      break;
    case 'video':
      next.vaporLift += 0.18;
      next.bleedSpread += 0.1;
      next.rotationMul *= 1.04;
      next.opacityMul *= 0.98;
      break;
    case 'sphere':
      next.contourMix += 0.08;
      next.vaporLift += 0.08;
      next.scaleMul *= 1.06;
      break;
    default:
      break;
  }
  next.bandWarp = clampUnit(next.bandWarp);
  next.bleedSpread = clampUnit(next.bleedSpread);
  next.glyphGrid = clampUnit(next.glyphGrid);
  next.contourMix = clampUnit(next.contourMix);
  next.sootStain = clampUnit(next.sootStain);
  next.runeRetention = clampUnit(next.runeRetention);
  next.velvetMatte = clampUnit(next.velvetMatte);
  next.vaporLift = clampUnit(next.vaporLift);
  return next as T;
}
