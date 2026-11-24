import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getHorizonEquirectTexture, getHorizonGradientTexture, isValidHex } from './horizonBackground';

/**
 * Image-based lighting environment (Phase AL).
 *
 * The environment the instanced geometry samples for its diffuse
 * and reflection terms is the background the user already sees:
 * the equirect image when the Horizon background is an image with
 * a source, otherwise the horizon gradient baked into a small
 * equirect canvas (vertical blend of the two gradient colours).
 * No new asset and no PMREM chain — sampling is a single tap per
 * direction, an approximation recorded in the phase report.
 *
 * The direction -> UV mapping follows three.js' own equirect
 * convention (the same one scene.background uses), so reflections
 * line up with the visible panorama; the yaw offset matches
 * scene.backgroundRotation. The pure function below is the
 * reference for the GLSL twin in GEOM_FRAG and is pinned by the
 * unit tests.
 */

/** Direction (unit) -> equirect UV, three.js convention. */
export function equirectUvForDirection(x: number, y: number, z: number): [number, number] {
  const cy = Math.min(1, Math.max(-1, y));
  const v = Math.asin(cy) / Math.PI + 0.5;
  const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
  return [u, v];
}

/** Rotate a direction around +Y by the yaw (radians), matching
 *  scene.backgroundRotation.y for the equirect background. */
export function rotateDirectionYaw(
  x: number,
  y: number,
  z: number,
  yawRad: number,
): [number, number, number] {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return [c * x + s * z, y, -s * x + c * z];
}

export interface IblEnvironmentState {
  texture: THREE.Texture | null;
  ready: boolean;
}

const NOT_READY: IblEnvironmentState = { texture: null, ready: false };

// ---------------------------------------------------------------------------
// Gradient equirect bake (cached by the gradient colour pair)

const GRAD_EQ_WIDTH = 256;
const GRAD_EQ_HEIGHT = 128;

interface GradEqEntry {
  key: string;
  texture: THREE.CanvasTexture;
}

let gradEqEntry: GradEqEntry | null = null;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Bake the horizon gradient colours into an equirect canvas: each
 * row is a constant colour blending B (bottom, v=0) to A (top,
 * v=1) — a vertical environment, matching the gradient backdrop's
 * own top/bottom reading. sRGB output, same as the horizon bakes.
 */
export function getGradientEquirectTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const a = isValidHex(colorA) ? colorA : '#000000';
  const b = isValidHex(colorB) ? colorB : '#232830';
  const key = `${a}|${b}`;
  if (gradEqEntry && gradEqEntry.key === key) return gradEqEntry.texture;
  if (gradEqEntry) gradEqEntry.texture.dispose();
  const canvas = document.createElement('canvas');
  canvas.width = GRAD_EQ_WIDTH;
  canvas.height = GRAD_EQ_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const [ar, ag, ab] = hexToRgb(a);
    const [br, bg, bb] = hexToRgb(b);
    for (let row = 0; row < GRAD_EQ_HEIGHT; row++) {
      // Canvas row 0 is the texture's top (v = 1 after flipY).
      const t = 1 - row / (GRAD_EQ_HEIGHT - 1);
      const r = Math.round((br + (ar - br) * t) * 255);
      const g = Math.round((bg + (ag - bg) * t) * 255);
      const bl = Math.round((bb + (ab - bb) * t) * 255);
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(0, row, GRAD_EQ_WIDTH, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  gradEqEntry = { key, texture };
  return texture;
}

/**
 * Resolve the environment texture for a config. The image
 * background wins when it has a decoded equirect; until it is
 * ready (or when the background is not an image) the gradient
 * equirect stands in, so enabling IBL never pops from black.
 * `ready` reports whether the resolved texture is the image one.
 */
export function resolveIblEnvironment(config: ParticleConfig): IblEnvironmentState {
  if (config.backgroundMode === 'image' && config.backgroundImageSource) {
    const eq = getHorizonEquirectTexture(config.backgroundImageSource);
    if (eq.ready && eq.texture) return { texture: eq.texture, ready: true };
    // Fall through to the gradient stand-in while decoding.
  }
  if (typeof document === 'undefined') return NOT_READY;
  const texture = getGradientEquirectTexture(
    config.backgroundGradientColorA,
    config.backgroundGradientColorB,
  );
  return { texture, ready: false };
}

/** Re-exported so the geometry material updater can keep the flat
 *  horizon gradient path untouched (documentation anchor). */
export { getHorizonGradientTexture };

// ---------------------------------------------------------------------------
// Phase 16 stage 3 — PMREM scene environment (Standard family IBL, step 1)
//
// Step 1 only: the resolved equirect environment is converted with
// THREE.PMREMGenerator and assigned to scene.environment, and ONLY
// while the shared intensity key (gpgpuSceneEnvIntensity) is > 0.
// At intensity 0 the caller must not call the converter at all and
// must leave scene.environment null — the v1.97.0 state, verified by
// scripts/phase16-pbr-ibl.test.mjs via shouldApplySceneEnvironment
// (re-exported from lib/materialGrammar.ts, where the pure gate
// lives so tests can reach it without a renderer).
//
// Step 2 (porting the GEOM IBL triplet to the layer particles' 3D
// shape modes) landed in Phase 22 stage 3: the sphere branch of
// the layer point fragment, keys layer2IblIntensity /
// layer3IblIntensity, helpers shared via lib/iblGlsl.ts. The
// GEOM shader's own uIblIntensity path is unchanged.

export { shouldApplySceneEnvironment } from './materialGrammar';

export interface PmremEnvironmentHandle {
  texture: THREE.Texture;
  dispose: () => void;
}

/**
 * Convert an equirect texture to a PMREM environment render target.
 * The caller owns the returned handle and MUST call dispose() when
 * the source changes or the consumer unmounts (the render target is
 * GPU memory; leaking it per background swap was the recorded risk).
 * Returns null when there is no renderer texture to convert.
 */
export function createPmremEnvironmentFromEquirect(
  renderer: THREE.WebGLRenderer,
  equirect: THREE.Texture | null | undefined,
): PmremEnvironmentHandle | null {
  if (!renderer || !equirect) return null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    pmrem.compileEquirectangularShader();
    const renderTarget = pmrem.fromEquirectangular(equirect);
    let disposed = false;
    return {
      texture: renderTarget.texture,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        renderTarget.dispose();
      },
    };
  } finally {
    pmrem.dispose();
  }
}

/**
 * Apply the shared scene-environment intensity to every
 * MeshStandardMaterial in the scene graph. Materials created through
 * the shared PBR grammar carry envMapIntensity 1 (the three.js
 * default), so assigning the intensity directly is the scale the
 * grammar describes. ShaderMaterials are untouched (scene.environment
 * does not affect them automatically).
 */
export function applySceneEnvIntensityToMaterials(
  scene: THREE.Object3D,
  intensity: number,
): number {
  let count = 0;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const material = (mesh as { material?: unknown }).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const mat of list) {
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        (mat as THREE.MeshStandardMaterial).envMapIntensity = intensity;
        count += 1;
      }
    }
  });
  return count;
}
