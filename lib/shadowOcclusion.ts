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
  type GpgpuMorphTerrainKind,
  type GpgpuMorphTerrainOptions,
} from './gpgpuMorphTargets';
import {
  buildObjMeshGeometryData,
  objMeshRepeatOffsets,
  objMeshWorldScale,
} from './objMesh';

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
  sourceTerrain: boolean;
  sourceObj: boolean;
  /** OBJ bounding sphere in world units, or null when absent. */
  objSphere: ObjSphereOccluder | null;
  /** Additional repeat copies of the OBJ sphere (repeat > 1). */
  objSpheres?: ObjSphereOccluder[];
  /** Penumbra softness in [0, 1]. */
  softness: number;
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
 * Total occlusion in [0, 1] at a world point: 0 = fully lit,
 * 1 = fully blocked from the Phase T light by terrain and/or the
 * OBJ sphere. Pure and deterministic.
 */
export function occlusionAtPoint(
  px: number,
  py: number,
  pz: number,
  scene: ShadowScene,
  marchSteps = 8,
): number {
  let occ = 0;
  if (scene.sourceTerrain && scene.terrain.amplitude > 0 && scene.worldScale > 0) {
    const ratio = terrainHorizonRatio(px, py, pz, scene, marchSteps);
    // A slope ratio of ~0.55 (about 29 degrees of blockage) already
    // reads as a full shadow; below that the occlusion ramps in.
    const terrainOcc = Math.max(0, Math.min(1, ratio / 0.55));
    occ = 1 - (1 - occ) * (1 - terrainOcc);
  }
  if (scene.sourceObj && scene.objSphere) {
    const objOcc = sphereOcclusionAt(px, py, pz, scene);
    occ = 1 - (1 - occ) * (1 - objOcc);
  }
  return soften(occ, scene.softness);
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
  return { resolution: res, extent: E, data, heightScale };
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
  gpgpuMorphTerrainErosionMaskMode: 'off' | 'height' | 'slope' | 'curvature' | 'image';
  gpgpuMorphTerrainErosionMaskImageGrid: number[];
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
        },
        wrapX: config.gpgpuTerrainMeshTunnel,
      },
    },
    seed: config.gpgpuSeed,
    worldScale,
    lightPos: { x: config.gpgpuLightPosX, y: config.gpgpuLightPosY, z: config.gpgpuLightPosZ },
    sourceTerrain: config.gpgpuShadowSourceTerrain,
    sourceObj: config.gpgpuShadowSourceObj,
    objSphere,
    objSpheres,
    softness: config.gpgpuShadowSoftness,
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
