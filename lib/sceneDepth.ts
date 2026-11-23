// Scene depth foundation (Phase 16 stage 1, candidate A — the
// minimal / safe depth base; shadow maps (candidate B) and the
// Shine density texture (candidate C) are NOT built here and stay
// recorded as a precision wall: the main draws are custom
// ShaderMaterials, so three's standard shadows would not fall on
// them automatically, and Shine's texture-isation sits behind
// this depth base).
//
// What lives here:
//  1. Pure depth math (TS) + its GLSL twin: reconstructing a
//     view-space depth from a depth-buffer value, and the soft
//     depth fade factor consumers multiply by. Both halves are
//     unit-testable / unit-tested (scripts/phase16-depth-geom-
//     foliage.test.mjs) and must never drift apart.
//  2. A tiny shared store holding the captured depth source
//     (texture + camera near/far). It follows the established
//     lib/attrPointCloud.ts precedent: the capture component
//     (components/SceneDepthCapture.tsx) publishes, consumers
//     (LightVolume, the LightFx Lux cone) read. The store is
//     null whenever gpgpuDepthOcclusion is 0 — the capture never
//     mounts then — and every consumer treats null as "legacy
//     formula verbatim", so the default render is unchanged.

import React from 'react';
import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// Pure depth math

/**
 * View-space distance (positive, camera-forward) reconstructed
 * from a raw depth-buffer value in [0, 1] for a perspective
 * camera with the given near/far planes. Standard three.js
 * perspectiveDepthToViewZ inverted:
 *   viewZ = (near * far) / ((far - near) * depth - far)
 * and the distance is -viewZ. depth 0 (near plane) -> near,
 * depth 1 (far plane) -> far.
 */
export function viewDepthFromDepthBuffer(depth01: number, near: number, far: number): number {
  const d = Math.min(1, Math.max(0, depth01));
  const viewZ = (near * far) / ((far - near) * d - far);
  return -viewZ;
}

/**
 * Soft occlusion fade between a scene surface and the fragment
 * being shaded, both expressed as view-space distances:
 *  - scene at or behind the fragment (+ softness) -> 1 (visible)
 *  - scene in front of the fragment                -> 0 (occluded)
 *  - in between                                     -> linear ramp
 * softness <= 0 is the hard step: sceneDepth > fragDepth -> 1,
 * otherwise 0 (equality counts as occluded — the surface IS the
 * fragment's plane). Non-finite inputs degrade to 1 (never hide
 * a fragment on bad data).
 */
export function depthFadeFactor(sceneDepth: number, fragDepth: number, softness: number): number {
  if (!Number.isFinite(sceneDepth) || !Number.isFinite(fragDepth)) return 1;
  if (!(softness > 0)) return sceneDepth > fragDepth ? 1 : 0;
  const f = (sceneDepth - fragDepth) / softness;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** GLSL twin of the two functions above (same formulas, same
 *  edge rules). Consumers splice this chunk into their fragment
 *  shaders; it declares no uniforms of its own. */
export const SCENE_DEPTH_GLSL = /* glsl */ `
float kaloViewDepthFromBuffer(float depth01, float nearPlane, float farPlane) {
  float d = clamp(depth01, 0.0, 1.0);
  float viewZ = (nearPlane * farPlane) / ((farPlane - nearPlane) * d - farPlane);
  return -viewZ;
}
float kaloDepthFadeFactor(float sceneDepth, float fragDepth, float softness) {
  if (softness <= 0.0) return sceneDepth > fragDepth ? 1.0 : 0.0;
  return clamp((sceneDepth - fragDepth) / softness, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Shared depth-source store (capture publishes, consumers read)

export interface SceneDepthSource {
  /** Depth texture of the opaque scene (THREE.DepthTexture). */
  texture: THREE.Texture;
  /** Camera planes the depth was captured with. */
  near: number;
  far: number;
}

let currentSource: SceneDepthSource | null = null;
const listeners = new Set<() => void>();

export function setSceneDepthSource(next: SceneDepthSource | null): void {
  const prev = currentSource;
  if (
    prev === next ||
    (prev !== null && next !== null && prev.texture === next.texture && prev.near === next.near && prev.far === next.far)
  ) {
    return;
  }
  currentSource = next;
  for (const listener of listeners) listener();
}

export function getSceneDepthSource(): SceneDepthSource | null {
  return currentSource;
}

function subscribeSceneDepthSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSceneDepthSource(): SceneDepthSource | null {
  return React.useSyncExternalStore(subscribeSceneDepthSource, getSceneDepthSource, getSceneDepthSource);
}
