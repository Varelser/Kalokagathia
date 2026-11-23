// lib/materialGrammar.ts
// Phase 16 stage 2 — shared PBR material grammar (single source of truth).
//
// Before this module the Standard-family PBR numbers lived in four
// different forms (config-direct, per-mode profiles, style ternaries
// and fixed literals) across eight systems, and the materialStyle ->
// int conversion was copy-pasted into nine files. This module is now
// the ONLY place those numbers are written down. Every value here is
// copied verbatim from the pre-refactor code, so resolving through
// these helpers yields exactly the v1.97.0 effective values — that
// equivalence is pinned by scripts/phase16-pbr-ibl.test.mjs.
//
// envMapIntensity defaults to 1 everywhere below: that is three.js'
// own MeshStandardMaterial default, so carrying the field changes
// nothing until the Phase 16 stage-3 scene-environment sync scales it.

export type MaterialStyle = 'classic' | 'glass' | 'hologram' | 'chrome' | 'halftone';

export interface PbrMaterialParams {
  metalness: number;
  roughness: number;
  envMapIntensity: number;
}

export const MATERIAL_STYLES: readonly MaterialStyle[] = [
  'classic', 'glass', 'hologram', 'chrome', 'halftone',
] as const;

/** materialStyle -> int, identical to the legacy ternaries:
 *  classic 0 / glass 1 / hologram 2 / chrome 3 / halftone 4.
 *  Unknown / undefined values fall back to 0 (classic), exactly as
 *  the ternaries did (their final `: 0` branch). */
export function materialStyleToInt(style: string | null | undefined): number {
  return style === 'glass' ? 1
    : style === 'hologram' ? 2
    : style === 'chrome' ? 3
    : style === 'halftone' ? 4
    : 0;
}

/** Absolute PBR set per materialStyle. This is the set the
 *  CrystalDeposition crystal material used as its style ternary
 *  (chrome 0.92/0.16, glass 0.24/0.08, everything else 0.12/0.46);
 *  hologram and halftone intentionally share the classic numbers,
 *  exactly as the legacy `else` branch gave them. */
export const MATERIAL_STYLE_PBR_TABLE: Record<MaterialStyle, PbrMaterialParams> = {
  classic:  { metalness: 0.12, roughness: 0.46, envMapIntensity: 1 },
  glass:    { metalness: 0.24, roughness: 0.08, envMapIntensity: 1 },
  hologram: { metalness: 0.12, roughness: 0.46, envMapIntensity: 1 },
  chrome:   { metalness: 0.92, roughness: 0.16, envMapIntensity: 1 },
  halftone: { metalness: 0.12, roughness: 0.46, envMapIntensity: 1 },
};

export function getMaterialStylePbr(style: string | null | undefined): PbrMaterialParams {
  const key = (MATERIAL_STYLES as readonly string[]).includes(style ?? '')
    ? (style as MaterialStyle)
    : 'classic';
  return MATERIAL_STYLE_PBR_TABLE[key];
}

/** Fixed PBR sets for the Standard systems that never varied by
 *  style. Values are the pre-refactor literals, verbatim:
 *  SmoothTube roughness 0.4 / metalness 0.2 (its material literal
 *  lists roughness first), TerrainMesh and ObjMesh both
 *  roughness 0.92 / metalness 0.0 (the "matte" reference), and
 *  HybridGranular roughness 0.62 / metalness 0.08. */
export const STANDARD_FIXED_PBR = {
  smoothTube:      { metalness: 0.2,  roughness: 0.4,  envMapIntensity: 1 },
  terrain:         { metalness: 0.0,  roughness: 0.92, envMapIntensity: 1 },
  obj:             { metalness: 0.0,  roughness: 0.92, envMapIntensity: 1 },
  hybridGranular:  { metalness: 0.08, roughness: 0.62, envMapIntensity: 1 },
  /** Metaball defaults (config defaults gpgpuMetaballMetalness /
   *  Roughness). The live values still come from config; this entry
   *  records the default pair in the shared table. */
  metaballDefault: { metalness: 0.5,  roughness: 0.2,  envMapIntensity: 1 },
} as const satisfies Record<string, PbrMaterialParams>;

/** Metaball: the live pair is config-driven; routing it through here
 *  keeps the shape (and the envMapIntensity default) in one place
 *  without changing any value. */
export function resolveMetaballPbr(metalness: number, roughness: number): PbrMaterialParams {
  return { metalness, roughness, envMapIntensity: 1 };
}

export interface PbrDelta { metalnessDelta: number; roughnessDelta: number }

const NO_DELTA: PbrDelta = { metalnessDelta: 0, roughnessDelta: 0 };

/** Per-system style deltas applied on top of a per-mode profile.
 *  VoxelLattice legacy: chrome -0.08/+0.42, glass -0.06/+0.12.
 *  CrystalAggregate legacy: chrome -0.12/+0.44, glass -0.08/+0.10.
 *  (roughnessDelta / metalnessDelta order in the comments above is
 *  roughness / metalness, matching the legacy assignment order.) */
export const PROFILE_PBR_STYLE_DELTAS: Record<'voxel' | 'crystalAggregate', Record<MaterialStyle, PbrDelta>> = {
  voxel: {
    classic: NO_DELTA,
    glass:    { metalnessDelta: 0.12, roughnessDelta: -0.06 },
    hologram: NO_DELTA,
    chrome:   { metalnessDelta: 0.42, roughnessDelta: -0.08 },
    halftone: NO_DELTA,
  },
  crystalAggregate: {
    classic: NO_DELTA,
    glass:    { metalnessDelta: 0.1,  roughnessDelta: -0.08 },
    hologram: NO_DELTA,
    chrome:   { metalnessDelta: 0.44, roughnessDelta: -0.12 },
    halftone: NO_DELTA,
  },
};

function deltaFor(system: 'voxel' | 'crystalAggregate', style: string | null | undefined): PbrDelta {
  const key = (MATERIAL_STYLES as readonly string[]).includes(style ?? '')
    ? (style as MaterialStyle)
    : 'classic';
  return PROFILE_PBR_STYLE_DELTAS[system][key];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** VoxelLattice legacy application: roughness clamped to [0.04, 1],
 *  metalness clamped to [0, 1] (THREE.MathUtils.clamp in the old code). */
export function applyVoxelProfilePbr(
  profile: { metalness: number; roughness: number },
  style: string | null | undefined,
): PbrMaterialParams {
  const d = deltaFor('voxel', style);
  return {
    roughness: clamp(profile.roughness + d.roughnessDelta, 0.04, 1),
    metalness: clamp(profile.metalness + d.metalnessDelta, 0, 1),
    envMapIntensity: 1,
  };
}

/** CrystalAggregate legacy application: roughness was NOT clamped
 *  (plain addition), metalness clamped to [0, 1]. Preserved exactly. */
export function applyCrystalProfilePbr(
  profile: { metalness: number; roughness: number },
  style: string | null | undefined,
): PbrMaterialParams {
  const d = deltaFor('crystalAggregate', style);
  return {
    roughness: profile.roughness + d.roughnessDelta,
    metalness: clamp(profile.metalness + d.metalnessDelta, 0, 1),
    envMapIntensity: 1,
  };
}

// ---------------------------------------------------------------------------
// GEOM (instanced geometry shader) PBR — TS twin of the GEOM_FRAG code
// in components/gpgpuShaderVolumes.ts. Defaults metalness 0 /
// roughness 1 reproduce the legacy specular pow(ndh, 24) * 0.35
// exactly: the shader keeps an explicit legacy fallback branch for
// the default pair, and the formula below degenerates to the same
// numbers (exponent 24 / (1*1) = 24, F0 = 0.04, F0 / 0.04 = 1).

export const GEOM_PBR_DEFAULTS: PbrMaterialParams = {
  metalness: 0,
  roughness: 1,
  envMapIntensity: 1,
};

export function geomF0(
  color: readonly [number, number, number],
  metalness: number,
): [number, number, number] {
  const m = clamp(metalness, 0, 1);
  return [
    0.04 + (color[0] - 0.04) * m,
    0.04 + (color[1] - 0.04) * m,
    0.04 + (color[2] - 0.04) * m,
  ];
}

/** Specular exponent for a roughness: 24 at roughness 1 (legacy),
 *  sharper as roughness drops, capped at 256 like the GLSL. */
export function geomSpecularExponent(roughness: number): number {
  const r = clamp(roughness, 0.05, 1);
  return Math.min(24 / (r * r), 256);
}

/** RGB specular contribution for NdotH. At the defaults
 *  (metalness 0, roughness 1) every channel equals the legacy
 *  pow(ndh, 24) * 0.35 exactly. */
export function geomSpecular(
  ndh: number,
  color: readonly [number, number, number],
  metalness: number,
  roughness: number,
): [number, number, number] {
  if (metalness <= 0.001 && roughness >= 0.999) {
    const s = Math.pow(Math.max(ndh, 0), 24) * 0.35;
    return [s, s, s];
  }
  const f0 = geomF0(color, metalness);
  const p = Math.pow(Math.max(ndh, 0), geomSpecularExponent(roughness));
  return [p * 0.35 * (f0[0] / 0.04), p * 0.35 * (f0[1] / 0.04), p * 0.35 * (f0[2] / 0.04)];
}

/** Phase 16 stage 3 gate: scene.environment is only wired when the
 *  shared intensity is strictly positive. At 0 (default) the caller
 *  must leave scene.environment null — the v1.97.0 state. */
export function shouldApplySceneEnvironment(intensity: number): boolean {
  return Number.isFinite(intensity) && intensity > 0;
}
