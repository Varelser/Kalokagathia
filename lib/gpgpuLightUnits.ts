/**
 * Light unit list (Grammar 2.0 stage 2, slice E4).
 *
 * Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E4 — the single
 * Phase T light becomes a LIST of units, replicated the way the
 * strange-attractor units 2-4 were replicated in Phase 27/29
 * (per-unit key families + per-unit uniform families + variant-
 * gated derived GLSL), NOT through a new data-texture supply:
 * the existing single light is already uniform-supplied, the
 * consumers live in the draw vertex shader (no sampler pressure
 * there), and the design's data-texture unification (§1 ruling
 * 2) stays with slices B1/B2, whose consumers sit in the
 * velocity pass where samplers are actually scarce.
 *
 * Unit 1 IS the legacy light: it reads the original
 * gpgpuLight* keys verbatim, so every existing config resolves
 * exactly as before. Units 2-4 carry their own key families
 * (gpgpuLight2* … gpgpuLight4*), each holding position / radius
 * (range) / intensity per the design; they are point lights
 * without a cone (the cone stays a unit-1 feature).
 *
 * This module is the single resolution point. Its consumers:
 *   - the bake + both sim routes (via resolveEmitLightPos):
 *     the 'light' emit shape places around the unit named by
 *     gpgpuEmitLightUnit (default 1 = legacy position). The
 *     selection resolves on the CPU BEFORE supply, so the
 *     WebGL and WGSL passes receive the same single position
 *     value they always did — no shader string changes, no
 *     capability feature, no route divergence.
 *   - the points draw (via extraLightUnitsActive + the GLSL
 *     segment builders below): while any of units 2-4 is
 *     enabled, the draw vertex assembles a variant that
 *     multiplies each extra unit's kaloLightMultiplier into
 *     vLightMul. The draw shader is WebGL on every route, so
 *     no capability entry is needed (the same reasoning the
 *     foundation documents for draw-side attribute drives).
 *   - the Phase Z occlusion bake (via
 *     resolveShadowExtraLightPositions): the enabled extra
 *     units' positions join the bake's light list and their
 *     occlusion unions with unit 1's (lib/shadowOcclusion.ts).
 *     With no extra unit enabled the list is empty and the
 *     bake is byte-identical to the single-light one.
 *
 * Identity discipline: every new key defaults to the value
 * that reproduces the legacy behaviour (units 2-4 disabled,
 * emit unit 1), and while they sit at those defaults no
 * shader string, bake output or shadow bake changes by a bit.
 */

export const LIGHT_UNIT_COUNT = 4;
export const EXTRA_LIGHT_UNITS = [2, 3, 4] as const;

export interface LightUnitPos {
  x: number;
  y: number;
  z: number;
}

export interface LightUnit {
  /** 1-based unit index. */
  index: number;
  enabled: boolean;
  pos: LightUnitPos;
  /** Brightness added at the unit's centre (multiplier 1 + this). */
  intensity: number;
  /** Falloff radius in world units. */
  radius: number;
}

/**
 * Structural view of the config's light keys. Every field is
 * optional so partial configs (tests, older presets) resolve
 * through the same defaults the app state ships.
 */
export interface LightUnitConfigLike {
  gpgpuLightEnabled?: boolean;
  gpgpuLightPosX?: number;
  gpgpuLightPosY?: number;
  gpgpuLightPosZ?: number;
  gpgpuLightIntensity?: number;
  gpgpuLightRadius?: number;
  gpgpuLight2Enabled?: boolean;
  gpgpuLight2PosX?: number;
  gpgpuLight2PosY?: number;
  gpgpuLight2PosZ?: number;
  gpgpuLight2Intensity?: number;
  gpgpuLight2Radius?: number;
  gpgpuLight3Enabled?: boolean;
  gpgpuLight3PosX?: number;
  gpgpuLight3PosY?: number;
  gpgpuLight3PosZ?: number;
  gpgpuLight3Intensity?: number;
  gpgpuLight3Radius?: number;
  gpgpuLight4Enabled?: boolean;
  gpgpuLight4PosX?: number;
  gpgpuLight4PosY?: number;
  gpgpuLight4PosZ?: number;
  gpgpuLight4Intensity?: number;
  gpgpuLight4Radius?: number;
  gpgpuEmitLightUnit?: number;
}

/** Unit-1 mirror defaults for units 2-4 (appStateDefaultGpgpu). */
const UNIT_POS_DEFAULT = 0;
const UNIT_INTENSITY_DEFAULT = 1;
const UNIT_RADIUS_DEFAULT = 3;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp a unit index into [1, LIGHT_UNIT_COUNT]; junk → 1. */
export function clampLightUnitIndex(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(LIGHT_UNIT_COUNT, Math.round(value)));
}

function readUnit(cfg: LightUnitConfigLike, index: number): LightUnit {
  if (index === 1) {
    return {
      index: 1,
      enabled: cfg.gpgpuLightEnabled === true,
      pos: {
        x: finiteOr(cfg.gpgpuLightPosX, UNIT_POS_DEFAULT),
        y: finiteOr(cfg.gpgpuLightPosY, UNIT_POS_DEFAULT),
        z: finiteOr(cfg.gpgpuLightPosZ, UNIT_POS_DEFAULT),
      },
      intensity: finiteOr(cfg.gpgpuLightIntensity, UNIT_INTENSITY_DEFAULT),
      radius: finiteOr(cfg.gpgpuLightRadius, UNIT_RADIUS_DEFAULT),
    };
  }
  const p = `gpgpuLight${index}` as 'gpgpuLight2' | 'gpgpuLight3' | 'gpgpuLight4';
  const rec = cfg as Record<string, unknown>;
  return {
    index,
    enabled: rec[`${p}Enabled`] === true,
    pos: {
      x: finiteOr(rec[`${p}PosX`] as number | undefined, UNIT_POS_DEFAULT),
      y: finiteOr(rec[`${p}PosY`] as number | undefined, UNIT_POS_DEFAULT),
      z: finiteOr(rec[`${p}PosZ`] as number | undefined, UNIT_POS_DEFAULT),
    },
    intensity: finiteOr(rec[`${p}Intensity`] as number | undefined, UNIT_INTENSITY_DEFAULT),
    radius: finiteOr(rec[`${p}Radius`] as number | undefined, UNIT_RADIUS_DEFAULT),
  };
}

/** The full unit list, unit 1 first. Pure and allocation-light. */
export function resolveLightUnits(cfg: LightUnitConfigLike): LightUnit[] {
  const units: LightUnit[] = [];
  for (let i = 1; i <= LIGHT_UNIT_COUNT; i++) units.push(readUnit(cfg, i));
  return units;
}

/** One unit by 1-based index (clamped). */
export function resolveLightUnit(cfg: LightUnitConfigLike, index: number): LightUnit {
  return readUnit(cfg, clampLightUnitIndex(index));
}

/**
 * True while any extra unit (2-4) is enabled. This is the draw
 * variant gate: while false the points vertex string is the
 * stock one byte for byte.
 */
export function extraLightUnitsActive(cfg: LightUnitConfigLike): boolean {
  return EXTRA_LIGHT_UNITS.some((i) => readUnit(cfg, i).enabled);
}

/** The unit the 'light' emit shape draws from (default 1). */
export function resolveEmitLightUnit(cfg: LightUnitConfigLike): number {
  return clampLightUnitIndex(cfg.gpgpuEmitLightUnit);
}

/**
 * True while the emit selection names an extra unit. The bake
 * and the respawn both consume resolveEmitLightPos, so this is
 * only a reporting / dependency predicate, never a gate on the
 * position itself.
 */
export function emitLightUnitSelectionActive(cfg: LightUnitConfigLike): boolean {
  return resolveEmitLightUnit(cfg) !== 1;
}

/**
 * The position the 'light' emit shape places around: the
 * selected unit's position, whether or not that unit's draw
 * light is enabled (the legacy rule — the emit shape reads the
 * light position as a pure reference, on or off). At the
 * default selection this is exactly the legacy light position.
 */
export function resolveEmitLightPos(cfg: LightUnitConfigLike): LightUnitPos {
  return resolveLightUnit(cfg, resolveEmitLightUnit(cfg)).pos;
}

/**
 * Positions of the enabled extra units, for the Phase Z
 * occlusion bake's light list. Empty at the defaults, which is
 * what keeps the single-light bake byte-identical.
 */
export function resolveShadowExtraLightPositions(cfg: LightUnitConfigLike): LightUnitPos[] {
  return resolveLightUnits(cfg)
    .filter((u) => u.index > 1 && u.enabled)
    .map((u) => u.pos);
}

// ── GLSL segments for the points draw variant ─────────────────

/**
 * Uniform declarations for one extra unit, in the draw
 * vertex's declaration style. Spliced in only by the
 * light-units variant of buildDrawVert; the stock string
 * declares none of them.
 */
export function lightUnitUniformsGlsl(unit: number): string {
  const n = clampLightUnitIndex(unit);
  return /* glsl */ `  // 3D light unit ${n} (stage 2, E4): an extra point light
  // from the unit list (lib/gpgpuLightUnits.ts). Point-only:
  // the cone stays a unit-1 feature.
  uniform bool  uLight${n}Enabled;
  uniform vec3  uLight${n}Pos;
  uniform float uLight${n}Intensity;
  uniform float uLight${n}Radius;
`;
}

/**
 * The compute segment for one extra unit: multiply the unit's
 * own kaloLightMultiplier into vLightMul (the units compose
 * multiplicatively, exactly like the Phase Z / shadow-map
 * brightness union on the same varying's neighbours). Runs
 * after the legacy unit-1 assignment inside main; a disabled
 * unit contributes exactly 1.0.
 */
export function lightUnitComputeGlsl(unit: number): string {
  const n = clampLightUnitIndex(unit);
  return /* glsl */ `    // 3D light unit ${n} (stage 2, E4): compose multiplicatively
    // over the unit-1 multiplier resolved above.
    if (uLight${n}Enabled) {
      vLightMul *= kaloLightMultiplier(worldPos, uLight${n}Pos, uLight${n}Intensity, uLight${n}Radius, false, 0.0, vec3(0.0, -1.0, 0.0));
    }
`;
}
