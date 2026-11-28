/**
 * Occlusion-map shadows + fog self-shadowing (Phase Z).
 *
 * Until now the scene had shading WITHOUT occlusion: the geometry
 * fragment Lambert + the Phase T light object give the *feel* of
 * light, but nothing ever cast a shadow — no object could block
 * the light and darken what sits behind it. This module is the
 * missing piece, in the deliberately honest form the Phase Z
 * brief fixes: an OCCLUSION MAP approximation, not a full shadow
 * map. The UI and the reports call it 「シャドウ（遮蔽マップ近似）」
 * and never claim real shadow mapping.
 *
 * Method:
 *  - Occluders are the two things in the scene that own surfaces:
 *    the terrain height field (Phase P/L, `terrainHeightAt`) and
 *    the OBJ mesh (Phase V), the latter approximated by its
 *    bounding sphere (centre + radius from the same normalisation
 *    the mesh builder uses). Everything else (points, volumes)
 *    receives but never casts.
 *  - `occlusionAtPoint` marches from the shaded point toward the
 *    Phase T light position. Terrain occlusion is the classic
 *    horizon test: at each march step the terrain height ahead is
 *    compared with the ray's height there; the largest positive
 *    excess, normalised by step distance, becomes the occlusion.
 *    The OBJ sphere is tested analytically (ray–sphere distance
 *    along the segment to the light). The two combine as
 *    1 - (1 - a)(1 - b). `softness` widens the penumbra: it lowers
 *    the peak and spreads the falloff (implemented as a power on
 *    the raw occlusion plus a scale — see below).
 *  - `bakeShadowOcclusionMap` evaluates the occlusion on the
 *    terrain surface over the terrain's world XZ extent into a
 *    regular grid. The grid is a pure function of its inputs (no
 *    RNG, no clock), so the same config bakes bit-identically —
 *    the gate pins that. Receivers sample the SAME bake:
 *    GPGPU points (vertex texture fetch, attenuated by height
 *    above the baked surface height stored in the G channel),
 *    the terrain mesh (per-vertex colours from the same pure
 *    function at the vertex positions), and the Phase Y light
 *    volume (fragment sample by world XZ). One occlusion
 *    function, three receivers — no per-receiver reimplementation.
 *  - Fog self-shadow (`fogSampleTransmittance`): a volumetric
 *    sample's brightness is attenuated by the density integrated
 *    from the sample toward the light through the same analytic
 *    sphere density the volumetric sprite shader marches
 *    (exp(-d^2 * 4)). `fogShadowSteps` keys the secondary march
 *    count. Strength 0 skips the march entirely in the shader,
 *    so the legacy fog render is bit-identical.
 *
 * Fixed-direction lights are NOT shadowed: occlusion applies
 * only against the Phase T light OBJECT (position), exactly as
 * the brief requires, so the two light meanings never mix.
 * (Stage 2 E4: the object is now a unit list — the enabled
 * extra units 2-4 join via scene.extraLightPosList and their
 * occlusion unions with unit 1's; see occlusionAtPoint.)
 *
 * Flame colour / temperature are out of scope by design (the
 * monochrome policy); nothing here touches colour, only
 * brightness multipliers in [0, 1].
 */

import {
  getErodedTerrainField,
  sampleErodedField,
  terrainFieldSeedFor,
  terrainHeightAt,
  tiledTerrainHeightAt,
  type GpgpuMorphTerrainKind,
  type GpgpuMorphTerrainOptions,
} from './gpgpuMorphTargets';
import {
  buildObjMeshGeometryData,
  objMeshRepeatOffsets,
  objMeshWorldScale,
} from './objMesh';
import { resolveShadowExtraLightPositions } from './gpgpuLightUnits';

export interface ShadowVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ObjSphereOccluder {
  center: ShadowVec3;
  radius: number;
}

export interface ShadowScene {
  /** Terrain field parameters (the gpgpuMorphTerrain* keys). */
  terrain: GpgpuMorphTerrainOptions;
  /** Bake seed (config gpgpuSeed), mixed like the terrain bake. */
  seed: number;
  /**
   * World-units multiplier of the terrain field: world position =
   * normalized * worldScale, world height = terrainHeightAt *
   * worldScale (the terrain mesh's own worldScale).
   */
  worldScale: number;
  /** Phase T light object position (world). */
  lightPos: ShadowVec3;
  /**
   * Extra light positions (Grammar 2.0 stage 2, E4): the
   * enabled units 2-4 of the light unit list
   * (lib/gpgpuLightUnits.ts). When present and non-empty,
   * occlusionAtPoint evaluates the occlusion toward EACH
   * light and unions them (a point is lit only if no light
   * is blocked). Absent / empty = the single-light behaviour
   * byte for byte.
   */
  extraLightPosList?: ShadowVec3[];
  sourceTerrain: boolean;
  sourceObj: boolean;
  /** OBJ bounding sphere in world units, or null when absent. */
  objSphere: ObjSphereOccluder | null;
  /** Additional repeat copies of the OBJ sphere (repeat > 1). */
  objSpheres?: ObjSphereOccluder[];
  /** Penumbra softness in [0, 1]. */
  softness: number;
  /**
   * Tunnel presentation (Round 83/84 gap 7): when the terrain
   * mesh wraps the field into a tube, the terrain occluder is
   * the tube wall instead of the plane height field. Radius =
   * 1.05 * worldScale (identical to the bake extent), length =
   * 2.1 * worldScale, axis = Z. Derived from the existing
   * gpgpuTerrainMeshTunnel key — no new config key.
   */
  tunnel: boolean;
  tunnelRadius: number;
  tunnelLength: number;
}

export function clampShadowSoftness(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

export function clampShadowStrength(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampFogSelfShadow(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(2, v));
}

export function clampFogShadowSteps(v: number): number {
  if (!Number.isFinite(v)) return 4;
  return Math.max(1, Math.min(16, Math.round(v)));
}

/** Terrain height in world units at a world XZ position. */
export function terrainWorldHeightAt(wx: number, wz: number, scene: ShadowScene): number {
  if (!(scene.worldScale > 0)) return 0;
  const fieldSeed = terrainFieldSeedFor(scene.seed, scene.terrain.seed);
  // Terrain erosion (Phase AP): the occluder is the carved
  // landscape while erosion is active (the field cache makes
  // this one resolution per scene state, then plain sampling).
  const field = getErodedTerrainField(scene.terrain, fieldSeed);
  const fx = wx / scene.worldScale;
  const fz = wz / scene.worldScale;
  const h = field
    ? sampleErodedField(field, fx, fz)
    : terrainHeightAt(fx, fz, scene.terrain, fieldSeed);
  return h * scene.worldScale;
}

/**
 * Terrain horizon occlusion for one march: the largest amount by
 * which the terrain ahead (toward the light) rises above the ray
 * from the point to the light, as a slope-like ratio. Exported
 * for the unit tests; `occlusionAtPoint` is the public entry.
 */
export function terrainHorizonRatio(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  marchSteps = 8,
): number {
  const dx = scene.lightPos.x - px;
  const dy = scene.lightPos.y - py;
  const dz = scene.lightPos.z - pz;
  const horiz = Math.hypot(dx, dz);
  if (!(horiz > 1e-6)) return 0; // light directly overhead: no horizon blocker sampled
  const dist = Math.hypot(dx, dy, dz);
  let worst = 0;
  for (let i = 1; i <= marchSteps; i++) {
    const t = i / (marchSteps + 1);
    const sx = px + dx * t;
    const sz = pz + dz * t;
    const rayY = py + dy * t;
    const h = terrainWorldHeightAt(sx, sz, scene);
    const stepDist = dist * t;
    const ratio = (h - rayY) / Math.max(stepDist, 1e-6);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/**
 * Tunnel field height (normalised, field units) at angle
 * `theta` in [0, 2*pi) and world z: the SAME sampler the tunnel
 * mesh reads (lib/terrainMesh.ts) — the eroded grid when it was
 * baked for the tunnel (wrapX), otherwise the cross-fade tiled
 * analytic field (tiledTerrainHeightAt is the exported twin of
 * the mesh builder's local tiledHeightAt with both wraps on).
 * fx spans the wrapped circumference [-1.05, 1.05), fz is the
 * field z (world z / worldScale).
 */
export function tunnelFieldHeightAt(theta: number, wz: number, scene: ShadowScene): number {
  if (!(scene.worldScale > 0)) return 0;
  const fieldSeed = terrainFieldSeedFor(scene.seed, scene.terrain.seed);
  const fx = (theta / (Math.PI * 2)) * 2.1 - 1.05;
  const fz = wz / scene.worldScale;
  const field = getErodedTerrainField(scene.terrain, fieldSeed);
  if (field && scene.terrain.erosion?.wrapX === true) {
    return sampleErodedField(field, fx, fz);
  }
  return tiledTerrainHeightAt(fx, fz, scene.terrain, fieldSeed);
}

/** World radius of the tunnel wall surface at (theta, world z). */
export function tunnelSurfaceRadiusAt(theta: number, wz: number, scene: ShadowScene): number {
  return scene.tunnelRadius - tunnelFieldHeightAt(theta, wz, scene) * scene.worldScale;
}

/**
 * Tunnel horizon occlusion (Plan A2, Round 84 gap 7 design):
 * the plane horizon test mapped onto the radial direction.
 * Marches from the point toward the light; at each step the
 * ray's radial distance is compared with the wall surface
 * radius at that step's (theta, z); the largest positive excess
 * normalised by step distance is the ratio. Steps that leave
 * the tube through an open end (|z| > extent) stop the march —
 * beyond the opening there is no wall. A light inside the tube
 * yields 0 naturally (the ray never crosses the wall radius).
 */
export function tunnelHorizonRatio(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  marchSteps = 8,
): number {
  const dx = scene.lightPos.x - px;
  const dy = scene.lightPos.y - py;
  const dz = scene.lightPos.z - pz;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-6)) return 0;
  const E = scene.tunnelRadius; // == bake extent == half length
  let worst = 0;
  // Arming: an excess counts only once the ray has travelled
  // through open space (radially inside the wall surface). A
  // point ON the wall whose light sits outside on its own side
  // exits through its own surface immediately — that exit is
  // not a blocker (the plane test likewise never samples the
  // shaded point's own ground), while a ray that crosses the
  // tube and enters the far wall IS blocked.
  let armed = false;
  for (let i = 1; i <= marchSteps; i++) {
    const t = i / (marchSteps + 1);
    const qx = px + dx * t;
    const qy = py + dy * t;
    const qz = pz + dz * t;
    if (Math.abs(qz) > E) break; // left through an open end
    let theta = Math.atan2(qy, qx);
    if (theta < 0) theta += Math.PI * 2;
    const rs = tunnelSurfaceRadiusAt(theta, qz, scene);
    const rho = Math.hypot(qx, qy);
    if (rho < rs - 1e-9) {
      armed = true;
    } else if (armed && rho > rs) {
      const ratio = (rho - rs) / Math.max(dist * t, 1e-6);
      if (ratio > worst) worst = ratio;
    }
  }
  return worst;
}

/**
 * Analytic plain-cylinder occlusion (Plan A1, the stepping
 * stone kept for tests): 1 when the segment point -> light
 * crosses the bare cylinder wall (radius R, |z| <= E) before
 * reaching the light, else 0. Points outside the cylinder are
 * outside this approximation's domain and return 0 — the known
 * A1 limit that A2 removes (a deep valley point sits at r > R).
 */
export function tunnelCylinderOcclusion(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
): number {
  const R = scene.tunnelRadius;
  const E = R;
  if (Math.hypot(px, py) > R) return 0;
  const dx = scene.lightPos.x - px;
  const dy = scene.lightPos.y - py;
  const dz = scene.lightPos.z - pz;
  const a = dx * dx + dy * dy;
  if (!(a > 1e-12)) return 0; // ray parallel to the axis stays inside
  const b = 2 * (px * dx + py * dy);
  const c = px * px + py * py - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t > 1e-6 && t < 1 && Math.abs(pz + dz * t) <= E) return 1;
  }
  return 0;
}

function sphereOcclusionOne(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  s: ObjSphereOccluder,
): number {
  if (!(s.radius > 0)) return 0;
  const dx = scene.lightPos.x - px;
  const dy = scene.lightPos.y - py;
  const dz = scene.lightPos.z - pz;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6)) return 0;
  const ux = dx / len;
  const uy = dy / len;
  const uz = dz / len;
  const cx = s.center.x - px;
  const cy = s.center.y - py;
  const cz = s.center.z - pz;
  const tca = cx * ux + cy * uy + cz * uz;
  if (tca <= 0 || tca >= len) return 0; // sphere behind the point or beyond the light
  const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
  const r2 = s.radius * s.radius;
  if (d2 >= r2) return 0;
  // Inside the sphere itself there is nothing to shade.
  if (cx * cx + cy * cy + cz * cz < r2) return 0;
  const penetration = 1 - Math.sqrt(Math.max(0, d2) / r2); // 1 at a central hit
  return Math.max(0, Math.min(1, penetration * 1.6));
}

/** Ray–sphere occlusion in [0, 1] for the segment point -> light. */
export function sphereOcclusionAt(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
): number {
  let occ = 0;
  if (scene.objSphere) occ = Math.max(occ, sphereOcclusionOne(px, py, pz, scene, scene.objSphere));
  if (scene.objSpheres) {
    for (const s of scene.objSpheres) occ = Math.max(occ, sphereOcclusionOne(px, py, pz, scene, s));
  }
  return occ;
}

function soften(raw: number, softness: number): number {
  const s = clampShadowSoftness(softness);
  const clamped = Math.max(0, Math.min(1, raw));
  // Softness 0 keeps the raw value; softness 1 lowers the peak
  // (x^1.8 <= x on [0,1]) and relatively lifts faint occlusion —
  // the penumbra reads wider and gentler.
  return Math.pow(clamped, 1 + 0.8 * s) * (1 - 0.25 * s) + clamped * 0.25 * s * (1 - clamped);
}

/**
 * Raw (pre-soften) occlusion toward the scene's lightPos: the
 * historical single-light body of occlusionAtPoint, verbatim.
 */
function rawOcclusionTowardLight(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  marchSteps: number,
): number {
  let occ = 0;
  if (scene.sourceTerrain && scene.terrain.amplitude > 0 && scene.worldScale > 0) {
    // Tunnel presentation: the occluder is the tube wall, so the
    // horizon test runs in the radial frame (Plan A2). Plane mode
    // keeps the original test verbatim.
    const ratio = scene.tunnel
      ? tunnelHorizonRatio(px, py, pz, scene, marchSteps)
      : terrainHorizonRatio(px, py, pz, scene, marchSteps);
    // A slope ratio of ~0.55 (about 29 degrees of blockage) already
    // reads as a full shadow; below that the occlusion ramps in.
    const terrainOcc = Math.max(0, Math.min(1, ratio / 0.55));
    occ = 1 - (1 - occ) * (1 - terrainOcc);
  }
  if (scene.sourceObj && scene.objSphere) {
    const objOcc = sphereOcclusionAt(px, py, pz, scene);
    occ = 1 - (1 - occ) * (1 - objOcc);
  }
  return occ;
}

/**
 * Total occlusion in [0, 1] at a world point: 0 = fully lit,
 * 1 = fully blocked from the Phase T light by terrain and/or the
 * OBJ sphere. Pure and deterministic.
 *
 * Light units (stage 2, E4): while scene.extraLightPosList is
 * non-empty, the occlusion is evaluated toward every light in
 * the list (unit 1 first), each softened on its own, and the
 * results union as 1 - Π(1 - occ_i) — the same composition the
 * two shadow systems already use with each other. With no
 * extra lights the single-light value is returned untouched.
 */
export function occlusionAtPoint(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  marchSteps = 8,
): number {
  const extras = scene.extraLightPosList;
  if (!extras || extras.length === 0) {
    return soften(rawOcclusionTowardLight(px, py, pz, scene, marchSteps), scene.softness);
  }
  let lit = 1 - soften(rawOcclusionTowardLight(px, py, pz, scene, marchSteps), scene.softness);
  for (const extra of extras) {
    const sub: ShadowScene = { ...scene, lightPos: extra, extraLightPosList: undefined };
    lit *= 1 - soften(rawOcclusionTowardLight(px, py, pz, sub, marchSteps), scene.softness);
  }
  return 1 - lit;
}

/** Brightness multiplier for a point: exactly 1 when strength is 0. */
export function shadowMultiplierAt(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  strength: number,
): number {
  const s = clampShadowStrength(strength);
  if (s <= 0) return 1;
  return 1 - s * occlusionAtPoint(px, py, pz, scene);
}

export interface ShadowOcclusionBake {
  resolution: number;
  /** Which evaluation surface the grid was baked on. */
  mode: 'plane' | 'tunnel';
  /** World half-extent covered by the grid (XZ square [-E, E]^2). */
  extent: number;
  /** R = occlusion at the terrain surface, G = surface height
   *  normalised by heightScale into [0, 1] around 0.5. */
  data: Uint8Array;
  /** World height that G = 1 represents (2 * amplitude * worldScale). */
  heightScale: number;
}

/**
 * Bake the occlusion grid over the terrain extent. Deterministic:
 * the same scene bakes byte-identically (pinned by the tests).
 */
export function bakeShadowOcclusionMap(
  scene: ShadowScene,
  resolution = 64,
  extent?: number,
): ShadowOcclusionBake {
  const res = Math.max(8, Math.min(128, Math.floor(resolution)));
  const E = extent && extent > 0 ? extent : Math.max(1, scene.worldScale * 1.05);
  const heightScale = Math.max(1e-6, 2 * Math.max(0, scene.terrain.amplitude) * Math.max(0, scene.worldScale));
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const wz = -E + (j / (res - 1)) * 2 * E;
    for (let i = 0; i < res; i++) {
      const wx = -E + (i / (res - 1)) * 2 * E;
      const h = terrainWorldHeightAt(wx, wz, scene);
      const occ = occlusionAtPoint(wx, h, wz, scene);
      const o = (j * res + i) * 4;
      data[o] = Math.round(Math.max(0, Math.min(1, occ)) * 255);
      data[o + 1] = Math.round(Math.max(0, Math.min(1, h / heightScale + 0.5)) * 255);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return { mode: 'plane', resolution: res, extent: E, data, heightScale };
}

/**
 * Bake the occlusion grid over the TUNNEL surface (Round 83/84
 * gap 7): the grid's u axis is the wrapped circumference
 * (theta = u * 2*pi, res distinct columns — no duplicated seam
 * column), v is the tube length (z in [-E, E], closed like the
 * plane bake's rows). Each cell evaluates the occlusion at the
 * wall surface point built with the mesh's own transform, and
 * encodes R = occlusion, G = field height normalised exactly
 * like the plane bake. The plane bake above is untouched, so
 * plane mode stays byte-identical. Deterministic, like the
 * plane bake.
 */
export function bakeTunnelShadowOcclusionMap(
  scene: ShadowScene,
  resolution = 64,
): ShadowOcclusionBake {
  const res = Math.max(8, Math.min(128, Math.floor(resolution)));
  const E = Math.max(1, scene.worldScale * 1.05); // == tunnel radius
  const heightScale = Math.max(1e-6, 2 * Math.max(0, scene.terrain.amplitude) * Math.max(0, scene.worldScale));
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const wz = -E + (j / (res - 1)) * 2 * E;
    for (let i = 0; i < res; i++) {
      const theta = (i / res) * Math.PI * 2;
      const h = tunnelFieldHeightAt(theta, wz, scene);
      const r = scene.tunnelRadius - h * scene.worldScale;
      const wx = Math.cos(theta) * r;
      const wy = Math.sin(theta) * r;
      const occ = occlusionAtPoint(wx, wy, wz, scene);
      const o = (j * res + i) * 4;
      data[o] = Math.round(Math.max(0, Math.min(1, occ)) * 255);
      data[o + 1] = Math.round(Math.max(0, Math.min(1, (h * scene.worldScale) / heightScale + 0.5)) * 255);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return { mode: 'tunnel', resolution: res, extent: E, data, heightScale };
}

/**
 * Height attenuation for baked-map receivers above the surface:
 * a point far above the terrain is out of the terrain's shadow
 * volume in this approximation. 1 at the surface, decaying with
 * height above it (scale = 0.35 * extent). The GLSL receivers
 * implement this same formula.
 */
export function shadowHeightAttenuation(heightAbove: number, extent: number): number {
  if (!(heightAbove > 0)) return 1;
  const scale = Math.max(1, extent * 0.35);
  return Math.exp(-heightAbove / scale);
}

/** Multiplier a baked-map receiver applies at a world position. */
export function bakedShadowMultiplier(
  bake: ShadowOcclusionBake,
  wx: number,
  wy: number,
  wz: number,
  strength: number,
): number {
  const s = clampShadowStrength(strength);
  if (s <= 0) return 1;
  const res = bake.resolution;
  const E = bake.extent;
  const u = Math.max(0, Math.min(1, wx / (2 * E) + 0.5));
  const v = Math.max(0, Math.min(1, wz / (2 * E) + 0.5));
  const i = Math.min(res - 1, Math.floor(u * res));
  const j = Math.min(res - 1, Math.floor(v * res));
  const o = (j * res + i) * 4;
  const occ = bake.data[o] / 255;
  const surfaceH = (bake.data[o + 1] / 255 - 0.5) * bake.heightScale;
  const atten = shadowHeightAttenuation(wy - surfaceH, E);
  return 1 - s * occ * atten;
}

/**
 * Multiplier a baked-map receiver applies at a world position
 * while the tunnel presentation is on (the TS twin of the GLSL
 * receivers' tunnel branch). Inside the tube region (radial
 * distance <= R + amplitude*worldScale, |z| <= E) the TUNNEL
 * bake is sampled by the inverse transform (theta, z) and the
 * height attenuation runs radially outward from the baked wall
 * surface; outside the region the plane bake applies exactly as
 * before. The inverse u is theta normalised into [0, 1) — the
 * bake's theta = u * 2*pi, so u = theta / (2*pi) with theta in
 * [0, 2*pi).
 */
export function bakedTunnelShadowMultiplier(
  tunnelBake: ShadowOcclusionBake,
  planeBake: ShadowOcclusionBake | null,
  wx: number,
  wy: number,
  wz: number,
  strength: number,
): number {
  const s = clampShadowStrength(strength);
  if (s <= 0) return 1;
  const E = tunnelBake.extent;
  const rho = Math.hypot(wx, wy);
  const inside = rho <= E + tunnelBake.heightScale / 2 && Math.abs(wz) <= E;
  if (!inside) {
    return planeBake ? bakedShadowMultiplier(planeBake, wx, wy, wz, strength) : 1;
  }
  const res = tunnelBake.resolution;
  let theta = Math.atan2(wy, wx);
  if (theta < 0) theta += Math.PI * 2;
  const u = theta / (Math.PI * 2);
  const v = Math.max(0, Math.min(1, wz / (2 * E) + 0.5));
  const i = Math.min(res - 1, Math.floor(u * res));
  const j = Math.min(res - 1, Math.floor(v * res));
  const o = (j * res + i) * 4;
  const occ = tunnelBake.data[o] / 255;
  const surfaceH = (tunnelBake.data[o + 1] / 255 - 0.5) * tunnelBake.heightScale;
  const rSurface = E - surfaceH;
  const atten = shadowHeightAttenuation(Math.max(0, rho - rSurface), E);
  return 1 - s * occ * atten;
}

// ── Scene assembly from config ──────────────────────────────────

/** The config fields the shadow scene is built from (structural). */
export interface ShadowSceneConfig {
  gpgpuMorphTerrainAmplitude: number;
  gpgpuMorphTerrainFrequency: number;
  gpgpuMorphTerrainOctaves: number;
  gpgpuMorphTerrainSeed: number;
  gpgpuMorphTerrainKind: GpgpuMorphTerrainKind;
  gpgpuMorphTerrainTerraceSteps: number;
  // Terrain erosion (Phase AP) + the tunnel gate that strips it.
  gpgpuMorphTerrainErosionWater: number;
  gpgpuMorphTerrainErosionDroplets: number;
  gpgpuMorphTerrainErosionDeposit: number;
  gpgpuMorphTerrainErosionThermal: number;
  gpgpuMorphTerrainErosionTalus: number;
  gpgpuMorphTerrainErosionThermalPasses: number;
  gpgpuMorphTerrainErosionSeed: number;
  // Erosion mask (Phase 20 stage 3).
  gpgpuMorphTerrainErosionMaskMode: 'off' | 'height' | 'slope' | 'curvature' | 'image' | 'drawn';
  gpgpuMorphTerrainErosionMaskImageGrid: number[];
  gpgpuMorphTerrainErosionMaskDrawnGrid: number[];
  gpgpuMorphTerrainErosionMaskStrength: number;
  gpgpuMorphTerrainErosionMaskInvert: boolean;
  gpgpuMorphTerrainErosionMaskLow: number;
  gpgpuMorphTerrainErosionMaskHigh: number;
  gpgpuTerrainMeshTunnel: boolean;
  gpgpuSeed: number;
  gpgpuMorphScale: number;
  gpgpuBounceRadius: number;
  gpgpuTerrainMeshScale: number;
  gpgpuLightPosX: number;
  gpgpuLightPosY: number;
  gpgpuLightPosZ: number;
  // Light units 2-4 (stage 2, E4): optional so partial config
  // literals keep compiling; absent = no extra lights.
  gpgpuLight2Enabled?: boolean;
  gpgpuLight2PosX?: number;
  gpgpuLight2PosY?: number;
  gpgpuLight2PosZ?: number;
  gpgpuLight3Enabled?: boolean;
  gpgpuLight3PosX?: number;
  gpgpuLight3PosY?: number;
  gpgpuLight3PosZ?: number;
  gpgpuLight4Enabled?: boolean;
  gpgpuLight4PosX?: number;
  gpgpuLight4PosY?: number;
  gpgpuLight4PosZ?: number;
  gpgpuShadowSourceTerrain: boolean;
  gpgpuShadowSourceObj: boolean;
  gpgpuShadowSoftness: number;
  gpgpuObjMeshEnabled: boolean;
  gpgpuObjMeshScale: number;
  gpgpuObjMeshRepeat: number;
  gpgpuObjMeshPosX: number;
  gpgpuObjMeshPosY: number;
  gpgpuObjMeshPosZ: number;
  gpgpuMorphObjSource: string;
}

/**
 * Assemble the shadow scene from a config. The world scale is the
 * terrain mesh's own (morph world scale x terrain mesh scale), so
 * the bake covers exactly the terrain mesh's footprint. The OBJ
 * occluder exists only when the OBJ mesh is enabled AND its source
 * parses (the same gate ObjMesh itself mounts on); each repeat
 * copy contributes its own bounding sphere (normalised radius 1 x
 * the OBJ world scale, centred on the copy's world position —
 * the mesh group's Y rotation is ignored by the sphere, which is
 * rotation-invariant anyway).
 */
export function buildShadowScene(config: ShadowSceneConfig): ShadowScene {
  const worldScale = config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48 * config.gpgpuTerrainMeshScale;
  let objSphere: ObjSphereOccluder | null = null;
  let objSpheres: ObjSphereOccluder[] | undefined;
  if (config.gpgpuShadowSourceObj && config.gpgpuObjMeshEnabled && config.gpgpuMorphObjSource) {
    const data = buildObjMeshGeometryData(config.gpgpuMorphObjSource);
    if (data) {
      const ws = objMeshWorldScale(config.gpgpuMorphScale, config.gpgpuBounceRadius, config.gpgpuObjMeshScale);
      const offsets = objMeshRepeatOffsets(config.gpgpuObjMeshRepeat);
      const spheres: ObjSphereOccluder[] = [];
      for (let i = 0; i + 2 < offsets.length; i += 3) {
        spheres.push({
          center: {
            x: config.gpgpuObjMeshPosX + offsets[i] * ws,
            y: config.gpgpuObjMeshPosY + offsets[i + 1] * ws,
            z: config.gpgpuObjMeshPosZ + offsets[i + 2] * ws,
          },
          radius: ws,
        });
      }
      if (spheres.length > 0) {
        objSphere = spheres[0];
        if (spheres.length > 1) objSpheres = spheres.slice(1);
      }
    }
  }
  return {
    terrain: {
      amplitude: config.gpgpuMorphTerrainAmplitude,
      frequency: config.gpgpuMorphTerrainFrequency,
      octaves: config.gpgpuMorphTerrainOctaves,
      seed: config.gpgpuMorphTerrainSeed,
      // Terrain recipes (Phase AI): the occluder follows the
      // selected recipe like every other consumer.
      kind: config.gpgpuMorphTerrainKind,
      terraceSteps: config.gpgpuMorphTerrainTerraceSteps,
      // Terrain erosion (Phase AP): the occluder follows the
      // carved field; stripped in tunnel mode (plane only).
      erosion: {
      // Tunnel wrap (Phase 30): erosion is no longer stripped
      // in tunnel mode — the droplet sim wraps in x (wrapX)
      // and the consumers tile the eroded field like the
      // analytic one. Plane mode passes wrapX false and keeps
      // the Phase AP behaviour verbatim.
        water: config.gpgpuMorphTerrainErosionWater,
        droplets: config.gpgpuMorphTerrainErosionDroplets,
        deposit: config.gpgpuMorphTerrainErosionDeposit,
        thermal: config.gpgpuMorphTerrainErosionThermal,
        talus: config.gpgpuMorphTerrainErosionTalus,
        thermalPasses: config.gpgpuMorphTerrainErosionThermalPasses,
        seed: config.gpgpuMorphTerrainErosionSeed,
        // Erosion mask (Phase 20 stage 3): the occluder follows
        // the masked field like every other consumer.
        mask: {
          mode: config.gpgpuMorphTerrainErosionMaskMode,
          strength: config.gpgpuMorphTerrainErosionMaskStrength,
          invert: config.gpgpuMorphTerrainErosionMaskInvert,
          low: config.gpgpuMorphTerrainErosionMaskLow,
          high: config.gpgpuMorphTerrainErosionMaskHigh,
        imageGrid: config.gpgpuMorphTerrainErosionMaskImageGrid,
        drawnGrid: config.gpgpuMorphTerrainErosionMaskDrawnGrid,
        },
        wrapX: config.gpgpuTerrainMeshTunnel,
      },
    },
    seed: config.gpgpuSeed,
    worldScale,
    lightPos: { x: config.gpgpuLightPosX, y: config.gpgpuLightPosY, z: config.gpgpuLightPosZ },
    // Light units (stage 2, E4): the enabled extra units join
    // the bake's light list through the single resolution
    // point; the field stays undefined while none is enabled,
    // so the single-light bake is byte-identical.
    extraLightPosList: (() => {
      const extras = resolveShadowExtraLightPositions(config);
      return extras.length > 0 ? extras : undefined;
    })(),
    sourceTerrain: config.gpgpuShadowSourceTerrain,
    sourceObj: config.gpgpuShadowSourceObj,
    objSphere,
    objSpheres,
    softness: config.gpgpuShadowSoftness,
    // Tunnel presentation (Round 83/84 gap 7): geometry follows
    // lib/terrainMesh.ts — radius = extent (1.05) * worldScale,
    // length = 2 * extent * worldScale, axis Z.
    tunnel: config.gpgpuTerrainMeshTunnel === true,
    tunnelRadius: Math.max(0, worldScale * 1.05),
    tunnelLength: Math.max(0, worldScale * 2.1),
  };
}

// ── Fog self-shadow ─────────────────────────────────────────────

/**
 * Transmittance of the light reaching a volumetric sample at
 * normalized offset `sample` (relative to the fog sphere centre,
 * in units of the radius) when the light sits in direction
 * `toLight` (unit, pointing from the centre toward the light):
 * the analytic density exp(-d^2 * 4) integrated from the sample
 * toward the light in `steps` secondary samples over one radius.
 * This is the exact twin of the loop in VOLUMETRIC_FRAG
 * (components/gpgpuShaderVolumes.ts). Returns 1 when there is no
 * intervening density along the light path.
 */
export function fogSampleTransmittance(
  sample: ShadowVec3,
  toLight: ShadowVec3,
  density: number,
  steps: number,
): number {
  const n = clampFogShadowSteps(steps);
  const seg = 1 / n;
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const t = (j + 0.5) * seg;
    const qx = sample.x + toLight.x * t;
    const qy = sample.y + toLight.y * t;
    const qz = sample.z + toLight.z * t;
    const d2 = qx * qx + qy * qy + qz * qz;
    acc += Math.exp(-d2 * 4) * seg;
  }
  return Math.exp(-acc * Math.max(0, density));
}

/**
 * Cube-domain variant (Phase 19 stage 4): transmittance of the
 * light reaching a sample inside the Pyro grid's cube domain,
 * where the density is NOT the analytic sphere falloff above
 * but an arbitrary field supplied by the caller (in the app:
 * the grid's scalar atlas, sampled in the fragment shader; the
 * GLSL twin lives in components/gpgpuShaderPyroVolume.ts).
 * Marches `steps` equal steps from `from` along the unit
 * direction `toLight` for `segmentLength` world units and
 * applies Beer-Lambert per step. Returns 1 when steps or the
 * segment length are 0 (self-shadow off = identity).
 */
export function cubeSampleTransmittance(
  sampleDensity: (p: ShadowVec3) => number,
  from: ShadowVec3,
  toLight: ShadowVec3,
  segmentLength: number,
  steps: number,
  densityScale: number,
): number {
  const n = Math.min(8, Math.max(0, Math.floor(steps)));
  if (n <= 0 || !(segmentLength > 0)) return 1;
  const segLen = segmentLength / n;
  let transmittance = 1;
  for (let j = 0; j < n; j++) {
    const t = (j + 0.5) * segLen;
    const d = sampleDensity({
      x: from.x + toLight.x * t,
      y: from.y + toLight.y * t,
      z: from.z + toLight.z * t,
    });
    transmittance *= Math.exp(-Math.max(0, d) * Math.max(0, densityScale) * segLen);
  }
  return transmittance;
}

/**
 * Brightness factor for one fog sample: 1 when self-shadow is 0
 * (the legacy identity), otherwise a mix toward the transmittance
 * by the (clamped) strength. Lit-side samples keep a factor near
 * 1; samples behind the fog body are dimmed.
 */
export function fogSelfShadowFactor(
  sample: ShadowVec3,
  toLight: ShadowVec3,
  density: number,
  strength: number,
  steps: number,
): number {
  const s = clampFogSelfShadow(strength);
  if (s <= 0) return 1;
  const tr = fogSampleTransmittance(sample, toLight, density, steps);
  // Strength 1 mixes fully to the transmittance; beyond 1 the
  // transmittance is applied again (squared falloff) for a
  // stronger self-shadow without ever going negative.
  const mixed = 1 - Math.min(1, s) * (1 - tr);
  return s > 1 ? mixed * Math.pow(tr, s - 1) : mixed;
}
