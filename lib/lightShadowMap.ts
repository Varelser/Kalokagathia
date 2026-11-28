/**
 * True shadow map (Phase 22 stage 4, §3 design by #11 白丸 —
 * wiring stage 1: capture + terrain-mesh receiving;
 * Phase 23, wiring stage 2: GPGPU points receiving).
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
 *
 * Particle casting (limit plan stage 4, slice S4): behind
 * gpgpuShadowMapCastParticles (default false) the main pool
 * DOES cast, through a dedicated caster pass the capture runs
 * into the same target after the scene pass — see the caster
 * section below. At the default the pass never runs, the
 * marked objects follow exactly the stage-1 discipline above,
 * and the capture is byte-identical.
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
 * Combined brightness of the two shadow systems on a
 * shader-factor receiver (TS twin of the Phase 23 stage-2
 * points composition): with a = 1 - zBrightness (Phase Z
 * shadow amount) and b = 1 - smapLit (shadow-map amount,
 * strength-mixed), the union shadow amount is
 * 1 - (1-a)(1-b) and the combined brightness is 1 minus
 * that. In the shader the two halves are applied as separate
 * multiplies (the fragment's shadow-map chunk and the tail's
 * vShadowMul), whose product is exactly this value.
 */
export function combineShadowBrightness(
  zBrightness: number,
  smapFactor: number,
  strength: number,
): number {
  const s = Math.min(1, Math.max(0, strength));
  const smapLit = 1 + (smapFactor - 1) * s;
  const a = 1 - zBrightness;
  const b = 1 - smapLit;
  const unionShadow = 1 - (1 - a) * (1 - b);
  return 1 - unionShadow;
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
// Particle casters (limit plan stage 4, slice S4): the main pool
// casts into the SAME shadow target through a dedicated caster
// pass (components/LightShadowCapture.tsx runs it after the
// scene pass, with clearing off, while
// gpgpuShadowMapCastParticles is on). Receivers are untouched:
// they keep sampling uShadowMapTex — the caster pass only
// changes what is IN the map, so no receiver gains a sampler.
//
// How the capture finds the casters: the two draw sites mark
// their objects in userData (the main GPGPU points in
// components/gpgpuRenderOutputs.tsx, the geometry meshes in
// components/useGpgpuMeshAssets.ts) under the keys below, and
// the caster materials read the live uniforms (uPosTex, and
// uGeomScale for the instances) off the marked objects'
// materials each frame — no second copy of the simulation
// textures is kept anywhere.
//
// Geometry path: a caster Mesh shares each marked mesh's
// InstancedBufferGeometry and expands instances from uPosTex
// at uGeomScale — the same base transform the stock GEOM
// vertex applies before its rotations. The caster vertex
// deliberately omits the spin / orient / velocity-align /
// stretch rotations: the cast silhouette is the unrotated
// base shape at the true position and scale (a recorded
// approximation; the gate for this feature judges shadow
// presence and direction, not silhouette fidelity).
//
// Points path: a caster Points shares the draw geometry and
// draws round sprites (fragment discards outside the disc, so
// points never stamp squares) at a CPU-computed pixel size:
// the light camera is orthographic, so a world diameter maps
// to pixels by diameter * SHADOW_MAP_SIZE / (2 * extent). The
// world diameter itself is an approximation by construction —
// the main points draw is screen-space sized
// (uSize * min(4, 500 / dist)), which has no single world
// size — so the caster defines one: gpgpuSize in the same
// world unit the geometry path uses (bounceRadius * 0.02 per
// unit, the uGeomScale unit), times the resolved
// gpgpuShadowMapParticleSize multiplier. Two recorded
// consequences: the cast disc grows/shrinks with the key even
// though the visible sprite sizing is distance-based, and
// gl_PointSize hardware caps (often 1024–2048px, some
// platforms far less) clamp the disc when the light extent is
// small or the size is large — the shadow then under-covers
// rather than misplacing.

/** userData marker on the main GPGPU points object. */
export const SHADOW_CASTER_POINTS_USERDATA = 'kaloShadowCasterPoints';
/** userData marker on the GPGPU geometry meshes (single + species). */
export const SHADOW_CASTER_GEOM_USERDATA = 'kaloShadowCasterGeom';

/** The caster-pass predicate: only the literal true enables it. */
export function shadowCastParticlesOn(
  config: { gpgpuShadowMapCastParticles?: unknown },
): boolean {
  return config.gpgpuShadowMapCastParticles === true;
}

/**
 * Resolved points-caster diameter multiplier (TS twin of the
 * value the capture feeds the diameter formula): a finite
 * number clamped to [0.1, 8]; anything else resolves to the
 * key default 1.
 */
export function resolveShadowMapParticleSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.min(8, Math.max(0.1, raw));
}

/**
 * World diameter of one points caster sprite: gpgpuSize in
 * the geometry path's world unit (bounceRadius * 0.02),
 * times the resolved multiplier. Non-positive inputs give 0
 * (the capture skips the points caster at 0).
 */
export function shadowCasterPointDiameterWorld(
  gpgpuSize: number,
  bounceRadius: number,
  sizeRaw: unknown,
): number {
  const size = Number.isFinite(gpgpuSize) ? Math.max(0, gpgpuSize) : 0;
  const radius = Number.isFinite(bounceRadius) ? Math.max(0, bounceRadius) : 0;
  return size * radius * 0.02 * resolveShadowMapParticleSize(sizeRaw);
}

/**
 * Pixel diameter of a world diameter under the orthographic
 * light camera: the frustum spans 2 * extent world units
 * across SHADOW_MAP_SIZE pixels.
 */
export function shadowCasterPointSizePx(diameterWorld: number, extent: number): number {
  if (!(diameterWorld > 0) || !(extent > 0)) return 0;
  return (diameterWorld * SHADOW_MAP_SIZE) / (2 * extent);
}

// Caster shaders: plain depth draws (the renderer's depth
// buffer of the capture target is what becomes the shadow
// map; the colour output is never read). Both declare exactly
// one sampler (uPosTex, the simulation position texture) —
// they are caster-side programs, not receivers, so the
// receiver sampler budget is unaffected.

export const SHADOW_CASTER_POINTS_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform float uCasterPointSizePx;
void main() {
  vec3 pos = texture2D(uPosTex, aTexCoord).xyz;
  gl_PointSize = uCasterPointSizePx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const SHADOW_CASTER_POINTS_FRAG = /* glsl */ `
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(1.0);
}
`;

export const SHADOW_CASTER_GEOM_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform float uGeomScale;
void main() {
  vec3 pos = texture2D(uPosTex, aTexCoord).xyz;
  vec3 world = pos + position * uGeomScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

export const SHADOW_CASTER_GEOM_FRAG = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

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
