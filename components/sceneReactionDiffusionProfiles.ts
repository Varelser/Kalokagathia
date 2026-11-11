export type {
  ReactionAudioRef,
  ReactionDiffusionSystemProps,
  ReactionLayerIndex,
  ReactionMode,
  ReactionProfile,
  ReactionSource,
  ReactionSourceProfile,
} from "./sceneReactionDiffusionProfilesShared";
export { getLayerSource, getReactionMode, getReactionProfile, resolveReactionParams } from "./sceneReactionDiffusionProfilesShared";

import type { ReactionMode, ReactionSource } from "./sceneReactionDiffusionProfilesShared";
import { getReactionProfile } from "./sceneReactionDiffusionProfilesShared";
import { withCrossFamilyReactionProfile, withReactionSourceProfile } from "./sceneReactionDiffusionProfilesCross";

export function buildResolvedReactionProfile(mode: ReactionMode, source: ReactionSource) {
  return withCrossFamilyReactionProfile(withReactionSourceProfile(getReactionProfile(mode), source), mode, source);
}
