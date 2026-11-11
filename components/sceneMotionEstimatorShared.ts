import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { ParticleData } from './particleData';

function fract(value: number) {
  return value - Math.floor(value);
}

function pseudoNoise3(x: number, y: number, z: number) {
  return fract(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453);
}

function signedNoise3(x: number, y: number, z: number) {
  return pseudoNoise3(x, y, z) * 2 - 1;
}

export function noiseVec3(target: THREE.Vector3, seed: THREE.Vector3) {
  target.set(
    signedNoise3(seed.x + 13.4, seed.y + 7.1, seed.z + 3.7),
    signedNoise3(seed.x + 2.8, seed.y + 17.5, seed.z + 11.9),
    signedNoise3(seed.x + 19.2, seed.y + 5.3, seed.z + 23.1),
  );
  return target;
}

export type LayerEstimateArgs = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  particleData: ParticleData;
  index: number;
  globalRadius: number;
  time: number;
};

/** Layer parameters shared by every stage of a motion-chain estimate. */
export type MotionEstimateContext = {
  timePhase: number;
  amp: number;
  freq: number;
  speed: number;
  phase: number;
  rnd: number;
  variant: number;
  lifeJitter: number;
  noiseScale: number;
  evolution: number;
  complexity: number;
  fluidForce: number;
  fidelity: number;
  octaveMult: number;
  wind: THREE.Vector3;
};

export const tempSeed = new THREE.Vector3();
export const tempStageSeed = new THREE.Vector3();
export const tempChainA = new THREE.Vector3();
export const tempChainB = new THREE.Vector3();
export const tempGraphMain = new THREE.Vector3();
export const tempGraphBranch = new THREE.Vector3();
export const tempGraphOut = new THREE.Vector3();
export const tempDagRegs: THREE.Vector3[] = Array.from({ length: 18 }, () => new THREE.Vector3());
export const tempDagOut = new THREE.Vector3();
export const tempNoise = new THREE.Vector3();
export const tempDir = new THREE.Vector3();
export const tempMotion = new THREE.Vector3();
export const tempWindDir = new THREE.Vector3();
export const upAxis = new THREE.Vector3(0, 1, 0);
export const xAxis = new THREE.Vector3(1, 0, 0);
export const yAxis = new THREE.Vector3(0, 1, 0);
export const zAxis = new THREE.Vector3(0, 0, 1);
