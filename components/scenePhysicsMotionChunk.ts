import { buildMotionFamilyGlsl } from './motionCatalog';
import { PHYSICS_MOTION_BRANCH_A } from './scenePhysicsMotionBranchA';
import { PHYSICS_MOTION_BRANCH_B } from './scenePhysicsMotionBranchB';
import { PHYSICS_MOTION_BRANCH_C } from './scenePhysicsMotionBranchC';
import { PHYSICS_MOTION_PRELUDE } from './scenePhysicsMotionPrelude';
import { PHYSICS_MOTION_TAIL } from './scenePhysicsMotionTail';

// ANGLE Metal expression-complexity fix (2026-11-13): the branch chains live
// in their own GLSL functions (PHYSICS_MOTION_BRANCH_A/B/C, defined before
// applyMotion) and PHYSICS_MOTION_TAIL dispatches to them from applyMotion.
export const PHYSICS_MOTION_LOGIC = `
  ${buildMotionFamilyGlsl()}
${PHYSICS_MOTION_BRANCH_A}${PHYSICS_MOTION_BRANCH_B}${PHYSICS_MOTION_BRANCH_C}${PHYSICS_MOTION_PRELUDE}${PHYSICS_MOTION_TAIL}`;
