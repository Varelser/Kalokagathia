// Scene generation counter: bumping it remounts the scene's layer systems
// (AppScene keys its layer content and camera rig by the generation), which
// resets every per-system ref — accumulated rotations, phases, GPGPU
// simulation state — back to its mount-time initial value. The
// deterministic renderer uses this to start each take from a pristine
// scene: freeze the frameloop, bump, wait for the remount to commit, then
// step the reset clock. Nothing else bumps the generation in normal use.

import React from 'react';

let generation = 0;
let mountedGeneration = 0;
const listeners = new Set<() => void>();

function notify(): void {

  for (const listener of listeners) listener();
}

export function bumpSceneGeneration(): number {
  generation += 1;
  notify();
  return generation;
}

export function getSceneGeneration(): number {
  return generation;
}

export function noteSceneGenerationMounted(value: number): void {
  if (value > mountedGeneration) {
    mountedGeneration = value;
    notify();
  }
}

export function getMountedSceneGeneration(): number {
  return mountedGeneration;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Scene composition: whether the mounted scene contains the GPGPU system,
// whose backend initialization is asynchronous (WebGPU adapter/device/
// pipeline setup). The deterministic renderer waits for both the remount
// and — when a GPGPU system is present — the backend settle, so no frame
// can switch execution path mid-take.
let compositionGeneration = -1;
let compositionHasGpgpu = false;
let gpgpuSettledGeneration = -1;

export function noteSceneComposition(value: number, hasGpgpu: boolean): void {
  if (value >= compositionGeneration) {
    compositionGeneration = value;
    compositionHasGpgpu = hasGpgpu;
    notify();
  }
}

export function getSceneComposition(): { generation: number; hasGpgpu: boolean } {
  return { generation: compositionGeneration, hasGpgpu: compositionHasGpgpu };
}

export function noteGpgpuBackendSettled(value: number): void {
  if (value > gpgpuSettledGeneration) {
    gpgpuSettledGeneration = value;
    notify();
  }
}

export function getGpgpuBackendSettledGeneration(): number {
  return gpgpuSettledGeneration;
}

export function useSceneGeneration(): number {
  return React.useSyncExternalStore(subscribe, getSceneGeneration, getSceneGeneration);
}
