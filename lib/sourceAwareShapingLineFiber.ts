import type { Layer3Source } from '../types/scene';
import type { FiberLike, LineLike } from './sourceAwareShapingTypes';
import { clampZero } from './sourceAwareShapingUtils';

export function withSourceAwareLineProfile<T extends LineLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.planarBias += 0.22;
      next.radialBias += 0.08;
      next.gateFreq += 0.26;
      next.gateThreshold += 0.08;
      next.budgetMul *= 0.96;
      next.widthMul *= 0.92;
      next.shimmerMul *= 1.08;
      next.flickerMul *= 1.04;
      next.hueShiftAdd += 0.01;
      break;
    case 'grid':
      next.searchMul *= 0.94;
      next.planarBias += 0.34;
      next.radialBias = clampZero(next.radialBias - 0.04);
      next.gateFreq += 0.18;
      next.gateThreshold += 0.04;
      next.widthMul *= 0.9;
      next.softnessMul *= 0.92;
      next.flickerMul *= 0.94;
      break;
    case 'ring':
      next.searchMul *= 1.08;
      next.planarBias = clampZero(next.planarBias - 0.08);
      next.radialBias += 0.34;
      next.glowMul *= 1.08;
      next.alphaMul *= 1.02;
      next.pulseMul *= 1.08;
      break;
    case 'cylinder':
      next.searchMul *= 1.06;
      next.budgetMul *= 1.04;
      next.radialBias += 0.16;
      next.shimmerMul *= 1.06;
      next.widthMul *= 0.96;
      break;
    case 'plane':
      next.searchMul *= 0.94;
      next.planarBias += 0.38;
      next.budgetMul *= 0.94;
      next.opacityMul *= 0.94;
      next.softnessMul *= 1.08;
      break;
    case 'image':
      next.planarBias += 0.24;
      next.dropout = Math.min(0.32, next.dropout + 0.03);
      next.alphaMul *= 0.96;
      next.shimmerMul *= 0.98;
      break;
    case 'video':
      next.glowMul *= 1.08;
      next.pulseMul *= 1.12;
      next.flickerMul *= 1.16;
      break;
    case 'sphere':
      next.searchMul *= 1.04;
      next.budgetMul *= 1.04;
      next.radialBias += 0.14;
      break;
    default:
      break;
  }
  return next as T;
}

export function withSourceAwareFiberProfile<T extends FiberLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.lengthBase *= 0.92;
      next.planarPull += 0.18;
      next.quantize += 0.18;
      next.bandMix += 0.1;
      next.gateAmount += 0.24;
      next.alphaMul *= 0.94;
      break;
    case 'grid':
      next.lengthBase *= 0.96;
      next.tangentStretch *= 0.9;
      next.planarPull += 0.24;
      next.quantize += 0.22;
      next.bandFrequency *= 1.24;
      next.bandMix += 0.12;
      next.shimmerScale *= 0.96;
      break;
    case 'ring':
      next.verticalBias += 0.04;
      next.radialLift += 0.22;
      next.radialPull += 0.06;
      next.curtainAmount += 0.08;
      next.waveAmplitude += 0.08;
      next.waveFrequency *= 1.08;
      next.glow *= 1.06;
      break;
    case 'cylinder':
      next.lengthBase *= 1.08;
      next.tangentStretch *= 1.16;
      next.braidAmount += 0.12;
      next.shimmerScale *= 1.04;
      break;
    case 'plane':
      next.lengthBase *= 0.94;
      next.planarPull += 0.28;
      next.curtainAmount += 0.04;
      next.alphaMul *= 0.95;
      break;
    case 'image':
      next.planarPull += 0.1;
      next.seedBias += 0.08;
      next.bandMix += 0.06;
      next.charAmount += 0.04;
      break;
    case 'video':
      next.waveAmplitude += 0.06;
      next.phaseSpeed *= 1.12;
      next.glow *= 1.05;
      next.pulseMix *= 1.08;
      break;
    case 'sphere':
      next.verticalBias += 0.06;
      next.radialLift += 0.14;
      break;
    default:
      break;
  }
  next.quantize = Math.min(0.68, next.quantize);
  next.bandMix = Math.min(0.88, next.bandMix);
  next.gateAmount = Math.min(0.92, next.gateAmount);
  return next as T;
}


export function withCrossFamilyLineProfile<T extends LineLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:shell_script':
      next.planarBias += 0.22;
      next.gateFreq += 0.28;
      next.gateThreshold += 0.1;
      next.widthMul *= 0.88;
      next.opacityMul *= 0.92;
      next.shimmerMul *= 0.96;
      break;
    case 'text:ink_bleed':
      next.planarBias += 0.14;
      next.dropout = Math.min(0.36, next.dropout + 0.08);
      next.softnessMul *= 1.12;
      next.glowMul *= 0.9;
      next.flickerMul *= 0.9;
      break;
    case 'text:drift_glyph_dust':
      next.dropout = Math.min(0.38, next.dropout + 0.08);
      next.softnessMul *= 1.08;
      next.alphaMul *= 0.9;
      next.glowMul *= 0.94;
      break;
    case 'text:glyph_weave':
      next.budgetMul *= 1.12;
      next.planarBias += 0.2;
      next.gateFreq += 0.2;
      next.gateThreshold += 0.06;
      next.widthMul *= 0.92;
      next.shimmerMul *= 1.12;
      next.flickerMul *= 0.96;
      break;
    case 'text:rune_smoke':
      next.searchMul *= 0.94;
      next.planarBias += 0.12;
      next.gateFreq += 0.18;
      next.widthMul *= 0.9;
      next.glowMul *= 1.08;
      break;
    case 'grid:static_lace':
      next.planarBias += 0.18;
      next.gateFreq += 0.24;
      next.gateThreshold += 0.08;
      next.widthMul *= 0.88;
      next.flickerMul *= 1.16;
      break;
    case 'grid:mesh_weave':
      next.planarBias += 0.14;
      next.widthMul *= 0.9;
      next.softnessMul *= 0.94;
      next.flickerMul *= 0.92;
      break;
    case 'ring:eclipse_halo':
      next.radialBias += 0.22;
      next.glowMul *= 1.12;
      next.pulseMul *= 1.08;
      break;
    case 'ring:spectral_mesh':
      next.searchMul *= 1.06;
      next.shimmerMul *= 1.12;
      next.widthMul *= 0.92;
      break;
    case 'ring:signal_braid':
      next.radialBias += 0.16;
      next.pulseMul *= 1.12;
      next.flickerMul *= 1.08;
      break;
    case 'plane:soot_veil':
      next.planarBias += 0.18;
      next.opacityMul *= 0.92;
      next.softnessMul *= 1.08;
      break;
    case 'plane:ink_bleed':
      next.planarBias += 0.16;
      next.gateThreshold += 0.05;
      next.softnessMul *= 1.06;
      break;
    default:
      break;
  }
  return next as T;
}

export function withCrossFamilyFiberProfile<T extends FiberLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:glyph_weave':
      next.planarPull += 0.26;
      next.quantize += 0.18;
      next.bandMix += 0.08;
      next.gateAmount += 0.24;
      next.alphaMul *= 0.94;
      next.shimmerScale *= 0.96;
      break;
    case 'text:shell_script':
      next.planarPull += 0.14;
      next.bandMix += 0.1;
      next.gateAmount += 0.22;
      next.alphaMul *= 0.92;
      break;
    case 'grid:static_lace':
      next.quantize += 0.18;
      next.bandFrequency *= 1.12;
      next.bandMix += 0.1;
      next.gateAmount += 0.08;
      next.shimmerScale *= 0.94;
      break;
    case 'grid:mesh_weave':
      next.planarPull += 0.14;
      next.quantize += 0.1;
      next.bandMix += 0.08;
      break;
    case 'ring:spectral_mesh':
      next.radialLift += 0.12;
      next.waveAmplitude += 0.08;
      next.prismAmount += 0.08;
      break;
    case 'ring:signal_braid':
      next.radialLift += 0.14;
      next.braidAmount += 0.12;
      next.pulseMix *= 1.08;
      break;
    case 'plane:cinder_web':
      next.planarPull += 0.12;
      next.charAmount += 0.12;
      next.alphaMul *= 0.94;
      break;
    default:
      break;
  }
  next.quantize = Math.min(0.74, next.quantize);
  next.bandMix = Math.min(0.92, next.bandMix);
  next.gateAmount = Math.min(0.96, next.gateAmount);
  return next as T;
}
