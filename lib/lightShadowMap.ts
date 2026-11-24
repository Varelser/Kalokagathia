/**
 * True shadow map (Phase 22 stage 4, §3 design by #11 白丸 —
 * wiring stage 1: capture + terrain-mesh receiving).
 *
 * This is the ONLY feature in the app that may be called a
 * shadow map: the Phase T light object's viewpoint depth,
 * re-rendered per frame and sampled by receivers. The Phase Z
 * feature (lib/shadowOcclusion.ts) stays an occlusion-map
 * approximation under its own name.
 *
 * Structure copied from the proven Phase 16 depth base
 * (lib/sceneDepth.ts): a shared store published by a capture
 * component (components/LightShadowCapture.tsx) that AppScene
 * mounts ONLY while gpgpuShadowMapStrength > 0. At the default
 * 0 the capture never mounts, the store stays null, and no
 * receiver shader carries the chunk below — the identity
 * guarantee is the mount discipline plus conditional shader
 * assembly, never a uniform branch in a stock string.
 *
 * Casters (stage 1): depth-writing opaque geometry only
 * (terrain, OBJ, primitives, GEOM instances). Particles do NOT
 * cast — they are hidden during the capture, and per-system
 * depth passes for them are a later stage's work.
 */

import * as THREE from 'three';

/** Shadow map resolution, design-fixed for stage 1. */
export const SHADOW_MAP_SIZE = 2048;

/**
 * Light camera framing: an orthographic camera at the light
 * position looking at the scene centre, half-extent derived
 * from the bounce radius (the scene's working radius).
 */
export function shadowMapExtent(bounceRadius: number): number {
  return Math.max(50, bounceRadius * 1.25);
}

export interface LightShadowFrustum {
  position: THREE.Vector3;
  extent: number;
  near: number;
  far: number;
}

export function lightShadowFrustum(
  lightPos: { x: number; y: number; z: number },
  bounceRadius: number,
): LightShadowFrustum {
  const position = new THREE.Vector3(lightPos.x, lightPos.y, lightPos.z);
  const extent = shadowMapExtent(bounceRadius);
  const dist = Math.max(1, position.length());
  return {
    position,
    extent,
    near: Math.max(0.5, dist - extent * 2),
    far: dist + extent * 2,
  };
}

/** View-projection matrix of the light camera (TS twin of the
 *  matrix the capture publishes and the GLSL consumes). */
export function buildLightViewProj(
  lightPos: { x: number; y: number; z: number },
  bounceRadius: number,
): THREE.Matrix4 {
  const f = lightShadowFrustum(lightPos, bounceRadius);
  const cam = new THREE.OrthographicCamera(-f.extent, f.extent, f.extent, -f.extent, f.near, f.far);
  cam.position.copy(f.position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

/**
 * One depth comparison (TS twin of kaloShadowSample in the
 * GLSL chunk): 1 when the fragment is lit (its light-space
 * depth, minus bias, is not beyond the stored depth), else 0.
 */
export function shadowSampleLit(storedDepth: number, fragDepth: number, bias: number): number {
  return fragDepth - bias <= storedDepth ? 1 : 0;
}

/**
 * Project a world position into light NDC (TS twin of the
 * GLSL chunk's first steps), for tests and gate tooling.
 * Returns null when the point is outside the shadow frustum
 * (the GLSL returns fully lit there).
 */
export function projectToLightNdc(
  viewProj: THREE.Matrix4,
  worldPos: { x: number; y: number; z: number },
): { u: number; v: number; depth: number } | null {
  const v = new THREE.Vector4(worldPos.x, worldPos.y, worldPos.z, 1).applyMatrix4(viewProj);
  if (v.w === 0) return null;
  const nx = v.x / v.w;
  const ny = v.y / v.w;
  const nz = v.z / v.w;
  const u = nx * 0.5 + 0.5;
  const vv = ny * 0.5 + 0.5;
  const depth = nz * 0.5 + 0.5;
  if (u < 0 || u > 1 || vv < 0 || vv > 1 || depth > 1) return null;
  return { u, v: vv, depth };
}

// ---------------------------------------------------------------------------
// GLSL chunk (receivers splice this ONLY in their shadow-map
// variant; the stock strings never contain it)

export const LIGHT_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uShadowMapTex;
uniform mat4 uLightViewProj;
uniform float uShadowMapBias;
uniform float uShadowMapSoftness;
uniform float uShadowMapReady;
uniform float uShadowMapStrength;

float kaloShadowSample(vec2 uv, float fragZ) {
  float d = texture2D(uShadowMapTex, uv).r;
  return (fragZ - uShadowMapBias <= d) ? 1.0 : 0.0;
}

// Brightness multiplier in [0, 1] for a world position: 1
// outside the shadow frustum or before the first capture.
float kaloShadowFactor(vec3 worldPos) {
  if (uShadowMapReady < 0.5) return 1.0;
  vec4 lp = uLightViewProj * vec4(worldPos, 1.0);
  vec3 proj = lp.xyz / lp.w;
  vec2 uv = proj.xy * 0.5 + 0.5;
  float fragZ = proj.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || fragZ > 1.0) return 1.0;
  if (uShadowMapSoftness <= 0.01) return kaloShadowSample(uv, fragZ);
  float texel = uShadowMapSoftness / 2048.0;
  float sum = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      sum += kaloShadowSample(uv + vec2(float(dx), float(dy)) * texel, fragZ);
    }
  }
  return sum / 9.0;
}
`;

/**
 * Terrain receiving (stage 1): onBeforeCompile injections for
 * the terrain's MeshStandardMaterial. Pure string functions so
 * the test can pin the anchors against the stock chunks. The
 * material only receives these while gpgpuShadowMapStrength
 * > 0 (TerrainMesh sets onBeforeCompile conditionally and
 * keys the material), so the stock program is untouched at 0.
 */
export function injectTerrainShadowVertex(src: string): string {
  return src
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPosSmap;',
    )
    .replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWorldPosSmap = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
}

export function injectTerrainShadowFragment(src: string): string {
  return src
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPosSmap;\n' + LIGHT_SHADOW_GLSL,
    )
    .replace(
      '#include <opaque_fragment>',
      'outgoingLight *= mix(1.0, kaloShadowFactor(vWorldPosSmap), uShadowMapStrength);\n\t#include <opaque_fragment>',
    );
}

// ---------------------------------------------------------------------------
// Shared shadow-source store (capture publishes, receivers read)

export interface LightShadowSource {
  texture: THREE.Texture;
  viewProj: THREE.Matrix4;
}

let currentSource: LightShadowSource | null = null;

export function setLightShadowSource(next: LightShadowSource | null): void {
  currentSource = next;
}

export function getLightShadowSource(): LightShadowSource | null {
  return currentSource;
}
