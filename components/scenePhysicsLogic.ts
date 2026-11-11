import { MAX_INTER_LAYER_COLLIDERS } from '../lib/appState';
import { PHYSICS_LAYER_POSITION_LOGIC } from './scenePhysicsLayerPosition';
import { PHYSICS_MOTION_LOGIC } from './scenePhysicsMotionChunk';
import { PHYSICS_NOISE_LOGIC } from './scenePhysicsNoise';

export const PHYSICS_LOGIC = `
  #define MAX_INTER_LAYER_COLLIDERS ${MAX_INTER_LAYER_COLLIDERS}
  ${PHYSICS_NOISE_LOGIC}
  ${PHYSICS_MOTION_LOGIC}
  ${PHYSICS_LAYER_POSITION_LOGIC}
`;
