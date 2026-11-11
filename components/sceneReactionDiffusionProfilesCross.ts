import * as THREE from "three";
import type { ReactionMode, ReactionProfile, ReactionSource } from "./sceneReactionDiffusionProfilesShared";
import { getSourceReactionProfile } from "./sceneReactionDiffusionProfilesSource";

export function withReactionSourceProfile(profile: ReactionProfile, source: ReactionSource) {
  const sourceProfile = getSourceReactionProfile(source);
  return {
    ...profile,
    bulge: profile.bulge + sourceProfile.bulgeAdd,
    rimPinch: profile.rimPinch + sourceProfile.rimPinchAdd,
    shear: profile.shear + sourceProfile.shearAdd,
    tiltX: profile.tiltX + sourceProfile.tiltXAdd,
    tiltY: profile.tiltY + sourceProfile.tiltYAdd,
    curl: profile.curl + sourceProfile.curlAdd,
    depthBands: profile.depthBands + sourceProfile.depthBandsAdd,
    frontBias: profile.frontBias + sourceProfile.frontBiasAdd,
    seedRing: profile.seedRing + sourceProfile.seedRingAdd,
    seedLedger: profile.seedLedger + sourceProfile.seedLedgerAdd,
    seedSweep: profile.seedSweep + sourceProfile.seedSweepAdd,
    seedCanopy: profile.seedCanopy + sourceProfile.seedCanopyAdd,
    seedColumn: profile.seedColumn + sourceProfile.seedColumnAdd,
    seedTerrace: profile.seedTerrace + sourceProfile.seedTerraceAdd,
    seedBlob: profile.seedBlob + sourceProfile.seedBlobAdd,
    hueShift: profile.hueShift + sourceProfile.hueShiftAdd,
    lightnessShift: profile.lightnessShift + sourceProfile.lightnessShiftAdd,
    opacityMul: profile.opacityMul * sourceProfile.opacityMul,
  };
}

export function withCrossFamilyReactionProfile(profile: ReactionProfile, mode: ReactionMode, source: ReactionSource) {
  const next = { ...profile };
  switch (`${source}:${mode}`) {
    case "text:cellular_front":
      next.shear += 0.08;
      next.depthBands += 0.12;
      next.frontBias += 0.12;
      next.seedLedger += 0.18;
      next.seedTerrace += 0.08;
      break;
    case "text:corrosion_front":
      next.rimPinch += 0.08;
      next.seedLedger += 0.14;
      next.seedTerrace += 0.14;
      next.lightnessShift -= 0.02;
      break;
    case "grid:reaction_diffusion":
      next.depthBands += 0.12;
      next.seedTerrace += 0.16;
      next.seedColumn += 0.08;
      break;
    case "ring:corrosion_front":
    case "torus:corrosion_front":
      next.rimPinch += 0.12;
      next.curl += 0.08;
      next.seedRing += 0.18;
      break;
    case "disc:biofilm_skin":
    case "ring:biofilm_skin":
      next.bulge += 0.12;
      next.seedRing += 0.14;
      next.seedCanopy += 0.1;
      break;
    case "spiral:cellular_front":
    case "galaxy:cellular_front":
      next.curl += 0.1;
      next.shear += 0.08;
      next.seedSweep += 0.18;
      break;
    case "image:biofilm_skin":
    case "video:biofilm_skin":
      next.bulge += 0.1;
      next.seedBlob += 0.16;
      next.seedCanopy += 0.12;
      break;
    case "plane:corrosion_front":
      next.shear += 0.06;
      next.seedTerrace += 0.16;
      next.frontBias += 0.08;
      break;
    case "cylinder:cellular_front":
    case "cone:cellular_front":
      next.seedColumn += 0.16;
      next.frontBias += 0.1;
      next.tiltY += 0.04;
      break;
    default:
      break;
  }
  next.bulge = THREE.MathUtils.clamp(next.bulge, 0, 0.72);
  next.rimPinch = THREE.MathUtils.clamp(next.rimPinch, 0, 0.72);
  next.shear = THREE.MathUtils.clamp(next.shear, -0.6, 0.6);
  next.tiltX = THREE.MathUtils.clamp(next.tiltX, -0.5, 0.5);
  next.tiltY = THREE.MathUtils.clamp(next.tiltY, -0.5, 0.5);
  next.curl = THREE.MathUtils.clamp(next.curl, -0.8, 0.8);
  next.depthBands = THREE.MathUtils.clamp(next.depthBands, 0, 0.9);
  next.frontBias = THREE.MathUtils.clamp(next.frontBias, -0.2, 0.7);
  next.seedRing = THREE.MathUtils.clamp(next.seedRing, 0, 1);
  next.seedLedger = THREE.MathUtils.clamp(next.seedLedger, 0, 1);
  next.seedSweep = THREE.MathUtils.clamp(next.seedSweep, 0, 1);
  next.seedCanopy = THREE.MathUtils.clamp(next.seedCanopy, 0, 1);
  next.seedColumn = THREE.MathUtils.clamp(next.seedColumn, 0, 1);
  next.seedTerrace = THREE.MathUtils.clamp(next.seedTerrace, 0, 1);
  next.seedBlob = THREE.MathUtils.clamp(next.seedBlob, 0, 1);
  return next;
}
