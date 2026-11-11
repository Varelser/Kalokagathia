import type { Layer3Source } from '../types/scene';
import type { ShellLike } from './sourceAwareShapingTypes';
import { clampUnit } from './sourceAwareShapingUtils';

export function withCrossFamilyShellProfile<T extends ShellLike>(profile: T, mode: string, source: Layer3Source): T {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case 'text:shell_script':
      next.scriptWarp += 0.22;
      next.scanScale *= 1.18;
      next.etchStrength += 0.24;
      next.bandStrength += 0.12;
      next.grainStrength += 0.04;
      next.blendMode = 'normal';
      break;
    case 'text:mirror_skin':
      next.grainStrength += 0.08;
      next.etchStrength += 0.08;
      next.lacquerAmount += 0.04;
      break;
    case 'grid:calcified_skin':
      next.quantize += 0.18;
      next.bandStrength += 0.22;
      next.grainStrength += 0.16;
      next.haloSpread *= 0.82;
      next.haloSharpness += 0.08;
      next.blendMode = 'normal';
      break;
    case 'grid:residue_skin':
      next.droop += 0.06;
      next.grainStrength += 0.16;
      next.flowAmount += 0.08;
      next.blendMode = 'normal';
      break;
    case 'ring:eclipse_halo':
      next.diskAmount += 0.14;
      next.haloSharpness += 0.16;
      next.centerDarkness += 0.1;
      break;
    case 'ring:halo_bloom':
      next.haloSpread += 0.12;
      next.bloomAmount += 0.14;
      next.auraAmount += 0.06;
      break;
    case 'ring:aura_shell':
      next.auraAmount += 0.14;
      next.haloSpread += 0.08;
      next.diskAmount += 0.04;
      break;
    case 'plane:resin_shell':
      next.lacquerAmount += 0.14;
      next.flowAmount += 0.14;
      next.grainStrength += 0.06;
      next.blendMode = 'normal';
      break;
    case 'plane:ink_bleed':
      next.grainStrength += 0.08;
      next.droop += 0.06;
      next.blendMode = 'normal';
      break;
    default:
      break;
  }
  next.quantize = Math.min(0.6, Math.max(0, next.quantize));
  next.haloSharpness = clampUnit(next.haloSharpness);
  next.auraAmount = clampUnit(next.auraAmount);
  next.diskAmount = clampUnit(next.diskAmount);
  next.lacquerAmount = clampUnit(next.lacquerAmount);
  next.flowAmount = clampUnit(next.flowAmount);
  return next as T;
}

export function withSourceAwareShellProfile<T extends ShellLike>(profile: T, source: Layer3Source): T {
  const next = { ...profile };
  switch (source) {
    case 'text':
      next.scaleX *= 1.04;
      next.scaleY *= 0.84;
      next.scaleZ *= 1.08;
      next.scriptWarp += 0.18;
      next.scanScale *= 1.22;
      next.bandStrength += 0.14;
      next.etchStrength += 0.22;
      next.opacityMul *= 0.96;
      next.blendMode = 'normal';
      break;
    case 'grid':
      next.scaleY *= 0.9;
      next.quantize += 0.14;
      next.scanScale *= 1.1;
      next.bandStrength += 0.18;
      next.grainStrength += 0.12;
      next.haloSharpness += 0.08;
      next.opacityMul *= 0.95;
      next.blendMode = 'normal';
      break;
    case 'ring':
      next.radialLift += 0.08;
      next.ringLift += 0.18;
      next.haloSpread += 0.22;
      next.haloSharpness += 0.18;
      next.equatorBias += 0.12;
      next.diskAmount += 0.12;
      next.auraAmount += 0.08;
      next.bloomAmount += 0.08;
      next.centerDarkness += 0.06;
      break;
    case 'cylinder':
      next.scaleX *= 0.96;
      next.scaleZ *= 1.14;
      next.scriptWarp += 0.06;
      next.flowAmount += 0.08;
      next.lacquerAmount += 0.08;
      break;
    case 'plane':
      next.scaleX *= 1.08;
      next.scaleY *= 0.78;
      next.scaleZ *= 1.08;
      next.droop += 0.08;
      next.bandStrength += 0.12;
      next.grainStrength += 0.08;
      next.haloSpread *= 0.88;
      next.blendMode = 'normal';
      break;
    case 'image':
      next.grainStrength += 0.12;
      next.poreAmount += 0.08;
      next.bloomAmount += 0.06;
      next.lacquerAmount += 0.04;
      break;
    case 'video':
      next.auraAmount += 0.12;
      next.bloomAmount += 0.12;
      next.scanScale *= 1.18;
      next.bandStrength += 0.08;
      break;
    case 'sphere':
      next.scaleX *= 1.04;
      next.scaleY *= 1.04;
      next.scaleZ *= 1.04;
      next.auraAmount += 0.08;
      next.radialLift += 0.06;
      break;
    default:
      break;
  }
  next.quantize = Math.min(0.52, Math.max(0, next.quantize));
  next.poreAmount = clampUnit(next.poreAmount);
  next.sporeAmount = clampUnit(next.sporeAmount);
  next.bloomAmount = clampUnit(next.bloomAmount);
  next.centerDarkness = clampUnit(next.centerDarkness);
  next.auraAmount = clampUnit(next.auraAmount);
  next.diskAmount = clampUnit(next.diskAmount);
  next.lacquerAmount = clampUnit(next.lacquerAmount);
  next.flowAmount = clampUnit(next.flowAmount);
  return next as T;
}
