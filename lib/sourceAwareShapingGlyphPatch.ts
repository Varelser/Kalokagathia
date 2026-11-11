import type { Layer3Source } from '../types/scene';
import type { GlyphLike, PatchLike } from './sourceAwareShapingTypes';
import { clampUnit } from './sourceAwareShapingUtils';

export function withSourceAwareGlyphProfile<T extends GlyphLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.copies += 1;
      next.spread += 0.08;
      next.quantize += 0.16;
      next.gateFreq += 0.18;
      next.gateThreshold += 0.06;
      next.widthMul *= 0.96;
      next.motionMul *= 0.9;
      next.tintMix += 0.08;
      next.blendMode = 'normal';
      break;
    case 'grid':
      next.spread += 0.06;
      next.jitter *= 0.84;
      next.shear += 0.08;
      next.quantize += 0.24;
      next.gateFreq += 0.14;
      next.gateThreshold += 0.08;
      next.widthMul *= 0.94;
      next.shimmerMul *= 0.94;
      next.blendMode = 'normal';
      break;
    case 'ring':
      next.spread += 0.12;
      next.drift += 0.08;
      next.shimmerMul *= 1.08;
      next.tintMix += 0.06;
      break;
    case 'plane':
      next.spread += 0.1;
      next.jitter += 0.04;
      next.opacityMul *= 0.94;
      next.widthMul *= 1.06;
      next.blendMode = 'normal';
      break;
    default:
      break;
  }
  next.quantize = clampUnit(next.quantize);
  next.gateThreshold = Math.min(0.8, Math.max(0, next.gateThreshold));
  next.tintMix = clampUnit(next.tintMix);
  return next as T;
}

export function withCrossFamilyGlyphProfile<T extends GlyphLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:contour_echo':
      next.copies += 1;
      next.spread += 0.18;
      next.quantize += 0.12;
      next.widthMul *= 1.08;
      next.motionMul *= 0.82;
      next.tintMix += 0.06;
      next.blendMode = 'normal';
      break;
    case 'text:shell_script':
      next.spread += 0.08;
      next.shear += 0.1;
      next.quantize += 0.1;
      next.gateFreq += 0.22;
      next.gateThreshold += 0.08;
      next.opacityMul *= 0.9;
      next.blendMode = 'normal';
      break;
    case 'text:glyph_weave':
      next.copies += 1;
      next.spread += 0.12;
      next.quantize += 0.14;
      next.shimmerMul *= 1.08;
      next.tintMix += 0.12;
      next.blendMode = 'normal';
      break;
    case 'text:ink_bleed':
      next.spread += 0.14;
      next.jitter += 0.08;
      next.zJitter += 0.08;
      next.opacityMul *= 0.92;
      next.widthMul *= 1.08;
      next.blendMode = 'normal';
      break;
    case 'text:drift_glyph_dust':
      next.dropout += 0.06;
      next.jitter += 0.06;
      next.gateThreshold += 0.08;
      next.widthMul *= 0.92;
      next.motionMul *= 1.06;
      next.blendMode = 'normal';
      break;
    case 'grid:contour_echo':
      next.spread += 0.08;
      next.quantize += 0.16;
      next.widthMul *= 1.06;
      next.motionMul *= 0.86;
      next.blendMode = 'normal';
      break;
    case 'grid:standing_interference':
      next.shear += 0.14;
      next.gateFreq += 0.12;
      next.gateThreshold += 0.06;
      next.zJitter += 0.06;
      next.blendMode = 'normal';
      break;
    case 'grid:tremor_lattice':
      next.jitter += 0.08;
      next.zJitter += 0.08;
      next.gateFreq += 0.1;
      next.quantize += 0.08;
      next.blendMode = 'normal';
      break;
    default:
      break;
  }
  next.dropout = clampUnit(next.dropout);
  next.quantize = clampUnit(next.quantize);
  next.gateThreshold = Math.min(0.86, Math.max(0, next.gateThreshold));
  next.tintMix = clampUnit(next.tintMix);
  return next as T;
}

export function withSourceAwarePatchProfile<T extends PatchLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.rippleMul *= 0.88;
      next.contourBands += 0.12;
      next.contourSharpness += 0.14;
      next.plateMix += 0.18;
      next.echoMix += 0.04;
      next.planarPull += 0.16;
      next.rotationMul *= 0.84;
      next.blendMode = 'normal';
      break;
    case 'grid':
      next.rippleMul *= 0.94;
      next.contourBands += 0.18;
      next.contourSharpness += 0.1;
      next.plateMix += 0.12;
      next.echoMix += 0.1;
      next.shearMix += 0.18;
      next.planarPull += 0.12;
      next.opacityMul *= 0.95;
      next.blendMode = 'normal';
      break;
    case 'ring':
      next.echoMix += 0.22;
      next.fresnelAdd += 0.12;
      next.rotationMul *= 1.08;
      break;
    case 'plane':
      next.plateMix += 0.12;
      next.planarPull += 0.2;
      next.contourSharpness += 0.08;
      next.blendMode = 'normal';
      break;
    default:
      break;
  }
  next.contourBands = clampUnit(next.contourBands);
  next.contourSharpness = clampUnit(next.contourSharpness);
  next.plateMix = clampUnit(next.plateMix);
  next.echoMix = clampUnit(next.echoMix);
  next.shearMix = clampUnit(next.shearMix);
  next.planarPull = clampUnit(next.planarPull);
  return next as T;
}

export function withCrossFamilyPatchProfile<T extends PatchLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:surface_patch':
      next.plateMix += 0.14;
      next.planarPull += 0.1;
      next.rotationMul *= 0.9;
      next.blendMode = 'normal';
      break;
    case 'text:contour_echo':
      next.contourBands += 0.18;
      next.contourSharpness += 0.16;
      next.plateMix += 0.18;
      next.echoMix += 0.08;
      next.planarPull += 0.18;
      next.rotationMul *= 0.74;
      next.blendMode = 'normal';
      break;
    case 'text:standing_interference':
      next.shearMix += 0.1;
      next.echoMix += 0.08;
      next.planarPull += 0.08;
      next.blendMode = 'normal';
      break;
    case 'grid:contour_echo':
      next.contourBands += 0.12;
      next.contourSharpness += 0.12;
      next.plateMix += 0.12;
      next.shearMix += 0.08;
      next.planarPull += 0.12;
      next.rotationMul *= 0.86;
      next.blendMode = 'normal';
      break;
    case 'grid:standing_interference':
      next.echoMix += 0.12;
      next.shearMix += 0.18;
      next.planarPull += 0.06;
      next.rotationMul *= 1.04;
      next.blendMode = 'normal';
      break;
    case 'grid:tremor_lattice':
      next.rippleMul *= 1.08;
      next.contourBands += 0.08;
      next.shearMix += 0.14;
      next.planarPull += 0.08;
      next.rotationMul *= 1.08;
      next.blendMode = 'normal';
      break;
    case 'ring:echo_rings':
      next.echoMix += 0.16;
      next.fresnelAdd += 0.08;
      next.rotationMul *= 1.12;
      break;
    default:
      break;
  }
  next.contourBands = clampUnit(next.contourBands);
  next.contourSharpness = clampUnit(next.contourSharpness);
  next.plateMix = clampUnit(next.plateMix);
  next.echoMix = clampUnit(next.echoMix);
  next.shearMix = clampUnit(next.shearMix);
  next.planarPull = clampUnit(next.planarPull);
  return next as T;
}
