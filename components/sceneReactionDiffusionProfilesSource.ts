import type { ReactionSource, ReactionSourceProfile } from "./sceneReactionDiffusionProfilesShared";
import { DEFAULT_SOURCE_PROFILE } from "./sceneReactionDiffusionProfilesShared";

export function getSourceReactionProfile(source: ReactionSource): ReactionSourceProfile {
  switch (source) {
    case "text":
      return { ...DEFAULT_SOURCE_PROFILE, shearAdd: 0.16, tiltYAdd: 0.04, depthBandsAdd: 0.18, frontBiasAdd: 0.1, seedLedgerAdd: 0.72, seedTerraceAdd: 0.18, hueShiftAdd: 0.01, opacityMul: 0.98 };
    case "grid":
      return { ...DEFAULT_SOURCE_PROFILE, rimPinchAdd: 0.08, shearAdd: 0.12, depthBandsAdd: 0.2, seedLedgerAdd: 0.26, seedColumnAdd: 0.16, seedTerraceAdd: 0.32, opacityMul: 0.99 };
    case "plane":
      return { ...DEFAULT_SOURCE_PROFILE, bulgeAdd: 0.04, shearAdd: 0.08, depthBandsAdd: 0.12, seedTerraceAdd: 0.2, seedCanopyAdd: 0.12, lightnessShiftAdd: 0.02 };
    case "ring":
    case "disc":
    case "torus":
      return { ...DEFAULT_SOURCE_PROFILE, rimPinchAdd: 0.14, curlAdd: 0.1, frontBiasAdd: 0.06, seedRingAdd: 0.52, seedSweepAdd: 0.14, hueShiftAdd: 0.01 };
    case "spiral":
    case "galaxy":
      return { ...DEFAULT_SOURCE_PROFILE, shearAdd: 0.12, curlAdd: 0.22, tiltXAdd: 0.06, frontBiasAdd: 0.08, seedSweepAdd: 0.44, seedRingAdd: 0.18, lightnessShiftAdd: 0.02 };
    case "image":
    case "video":
      return { ...DEFAULT_SOURCE_PROFILE, bulgeAdd: 0.08, tiltXAdd: 0.04, curlAdd: 0.06, seedBlobAdd: 0.42, seedCanopyAdd: 0.22, lightnessShiftAdd: 0.03, opacityMul: 1.02 };
    case "cube":
    case "cylinder":
    case "cone":
      return { ...DEFAULT_SOURCE_PROFILE, rimPinchAdd: 0.08, shearAdd: 0.1, tiltYAdd: 0.06, depthBandsAdd: 0.12, seedColumnAdd: 0.44, seedTerraceAdd: 0.12, opacityMul: 0.98 };
    case "center":
    case "sphere":
      return { ...DEFAULT_SOURCE_PROFILE, bulgeAdd: 0.1, seedBlobAdd: 0.18, lightnessShiftAdd: 0.02 };
    default:
      return DEFAULT_SOURCE_PROFILE;
  }
}
