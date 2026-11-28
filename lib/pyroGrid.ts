// Phase CA: Pyro grid solver foundation (sub-phases 1-3 of the
// grid plan, #6 round-4/round-5 briefs). A second, grid-based
// solver alongside the particle-side Pyro solver: the 3D grid is
// packed into a 2D texture atlas (one z slice per tile) and stepped
// with the classic stable-fluids pipeline (semi-Lagrangian
// advection, buoyancy, explicit scalar diffusion, pressure
// projection). Everything here is pure data — layouts, tier
// resolution, solver constants — so the node test-suite can pin the
// arithmetic without a GPU. The GLSL lives in
// components/gpgpuShaderPyroGrid.ts, the pass orchestration in
// components/gpgpuPyroGridPasses.ts.
//
// Discretisation follows the FLIP precedent exactly (the MAC-
// consistent pair): divergence uses backward differences, the
// gradient subtraction uses forward differences, so their
// composition is the compact 7-point Laplacian and no
// checkerboard mode appears. Sampling uses cell-centre convention:
// cell i's centre is at grid position i, the valid sample range is
// [0, N-1] per axis, and out-of-range reads clamp to the edge cell
// (ClampToEdge; Repeat would bleed neighbouring slices across tile
// borders).

import { GPGPU_TEX_SIZE_CAPS, type GpuTier } from './gpuTier';

// Atlas layouts (round-2 section 1.1, fixed): cols x rows tiles of
// N x N pixels each. 96^3 uses 100 tiles for 96 slices (4 unused).
export const PYRO_GRID_LAYOUTS: Readonly<Record<number, { cols: number; rows: number }>> = {
  32: { cols: 8, rows: 4 },
  48: { cols: 8, rows: 6 },
  64: { cols: 8, rows: 8 },
  96: { cols: 10, rows: 10 },
};

export const PYRO_GRID_RESOLUTIONS: readonly number[] = [32, 48, 64, 96];

// Performance-tier defaults (Sugi's decision, plan A): entry 32^3,
// standard 48^3, high / flagship 64^3. 96^3 is a manual override
// on flagship only (its 960x960 atlas exceeds the lower tiers'
// texture caps anyway — see resolvePyroGridResolution).
export const PYRO_GRID_TIER_DEFAULTS: Readonly<Record<GpuTier, number>> = {
  entry: 32,
  standard: 48,
  high: 64,
  flagship: 64,
};

// FLIP WebGL atlas merge (案B): the merged layout packs the
// velocity field and its pre-projection base into ONE atlas —
// same column count as the single layout, twice the rows. The
// Vel tiles occupy the first half, the Base tiles start at tile
// offset cols*rows (the single layout's tile capacity — NOT the
// resolution: at 96 the capacity is 100, and offsetting by 96
// would collide with Vel's spare tiles). The velocity shader
// (S2/S3) reads the merged atlas through the dead uFlipBaseTex
// slot; this helper is the single JS home of the arithmetic.
export type PyroGridMergedLayout = {
  cols: number;
  rows: number;
  mergedRows: number;
  baseOffset: number;
  width: number;
  height: number;
  mergedWidth: number;
  mergedHeight: number;
};

export function pyroGridMergedLayout(n: number): PyroGridMergedLayout | null {
  const layout = PYRO_GRID_LAYOUTS[n];
  const size = pyroGridAtlasSize(n);
  if (!layout || !size) return null;
  return {
    cols: layout.cols,
    rows: layout.rows,
    mergedRows: layout.rows * 2,
    baseOffset: layout.cols * layout.rows,
    width: size.width,
    height: size.height,
    mergedWidth: size.width,
    mergedHeight: size.height * 2,
  };
}

export function pyroGridAtlasSize(n: number): { width: number; height: number } | null {
  const layout = PYRO_GRID_LAYOUTS[n];
  if (!layout) return null;
  return { width: layout.cols * n, height: layout.rows * n };
}

// Resolves the effective grid resolution. override 0 = auto (tier
// default); a manual override is honoured only when its atlas fits
// the tier's GPGPU texture cap — an oversized request falls back
// to the tier default rather than allocating past the cap (96^3 on
// a 512-cap tier would need a 960px atlas). Unknown overrides also
// fall back to the tier default.
export function resolvePyroGridResolution(tier: GpuTier, override: number): number {
  const fallback = PYRO_GRID_TIER_DEFAULTS[tier];
  if (!override || !PYRO_GRID_LAYOUTS[override]) return fallback;
  const size = pyroGridAtlasSize(override);
  const cap = GPGPU_TEX_SIZE_CAPS[tier];
  if (!size || size.width > cap || size.height > cap) return fallback;
  return override;
}

// Atlas uv of a cell's centre texel (mirrors pyroUvOfCell in the
// GLSL common chunk; the test-suite round-trips the pair).
export function pyroGridCellUv(
  n: number,
  cell: { x: number; y: number; z: number },
): { u: number; v: number } | null {
  const layout = PYRO_GRID_LAYOUTS[n];
  const size = pyroGridAtlasSize(n);
  if (!layout || !size) return null;
  const tileX = cell.z % layout.cols;
  const tileY = Math.floor(cell.z / layout.cols);
  return {
    u: (tileX * n + cell.x + 0.5) / size.width,
    v: (tileY * n + cell.y + 0.5) / size.height,
  };
}

// Solver pass count per step: 2 advection + 1 buoyancy/walls +
// 1 scalar update + 1 divergence + N Jacobi + 1 gradient
// subtraction = 6 + N. Jacobi 20 -> 26 passes (the plan's full
// solver figure), the FLIP-matching default 16 -> 22. The two
// pressure clears per step follow the FLIP accounting convention
// and are not counted (same as FLIP's clearInto calls).
// Phase CB: vorticity confinement (sub-phase 7) inserts two more
// passes (curl + confinement force) ahead of the projection, but
// only on steps where epsilon > 0 — the count follows the step.
export function pyroGridPassCount(jacobiIterations: number, vorticity = false): number {
  return 6 + Math.max(0, Math.floor(jacobiIterations)) + (vorticity ? 2 : 0);
}

export const PYRO_GRID_JACOBI_DEFAULT = 16;
export const PYRO_GRID_JACOBI_MAX = 32;

// Solver constants (cell units: velocities are cells/second,
// positions are cell indices). Buoyancy works in cell space, not
// the particle solver's world-space gravity: the grid domain is
// N cells across the same world extent the particles treat as
// ~450 units, so the world-space 9.8-based acceleration would be
// two orders of magnitude too weak in cells/second. The values
// are calibrated so the plume regime matches the round-1 CPU
// spike (32^3, Jacobi 20, 60 steps): total density 1262 (spike
// 1166.7), centroid y 0.214 (spike 0.249), spread 4.90 cells
// (spike 4.94), max speed 0.80 cells/step (spike 0.73) — the
// phaseca test-suite's CPU mirror pins these statistics.
export const PYRO_GRID_BUOY_ACCEL = 250.0; // cells/s^2 per unit (alpha * T)
export const PYRO_GRID_TEMP_COOL_RATE = 0.22; // 1/s at cooling key 1.0
export const PYRO_GRID_DENSITY_DECAY_RATE = 0.03; // 1/s
export const PYRO_GRID_SCALAR_DIFFUSE = 0.05; // explicit, per step (stable <= 1/6)
export const PYRO_GRID_EMIT_DENSITY = 80.0; // density/s at falloff 1
export const PYRO_GRID_EMIT_TEMP_RATE = 8.0; // 1/s relaxation toward emit temp
export const PYRO_GRID_SOURCE_Y = 2.0; // cells above the floor
export const PYRO_GRID_MAX_SPEED_CELLS = 4.0; // x N, cells/s clamp

export function pyroGridSourceRadius(n: number): number {
  return Math.max(2.0, n / 12);
}

// Combustion constants (Phase CB, sub-phase 8). The fuel field
// rides the scalar atlas's spare b channel — no extra field.
// The reaction is folded into the scalar-update pass: where the
// temperature crosses the ignition window, fuel burns at a rate
// proportional to the fuel present (so the burn is bounded by
// the fuel itself), releases PYRO_GRID_FUEL_HEAT of temperature
// per unit fuel, and the temperature is capped at
// PYRO_GRID_TEMP_MAX — the reaction cannot run away. The fuel
// key (gpgpuPyroFuelRate) scales both the source emission and
// the reaction rate; at key 0 nothing is emitted and nothing
// burns, so the channel stays zero by construction.
export const PYRO_GRID_FUEL_EMIT = 60.0; // fuel/s at falloff 1, at fuel key 1
export const PYRO_GRID_FUEL_REACTION_K = 2.5; // 1/s at fuel key 1 and full ignition
export const PYRO_GRID_FUEL_HEAT = 3.0; // temperature per unit fuel burned
// Ignition window, calibrated to the solver's measured field
// temperatures (Phase CA gate probe: the 32^3 field peaks at
// ~0.56 after 60 steps — the emit temperature is a relaxation
// target the field itself never reaches). A window at 0.45-0.8
// would sit above almost the whole field and combustion would
// never ignite; 0.15-0.35 puts full ignition on the hot source
// cells and partial ignition down the plume core.
export const PYRO_GRID_FUEL_IGNITE_LO = 0.15; // ignition smoothstep window (temperature)
export const PYRO_GRID_FUEL_IGNITE_HI = 0.35;
export const PYRO_GRID_TEMP_MAX = 4.0; // combustion temperature cap

// World <-> grid mapping (Phase CB, shared by the fog feed and
// the particle coupling). The grid domain is the cube centred on
// the origin with half-extent = the particle bounce radius: cell
// coordinates are continuous, cell i's centre sits at coordinate
// i, and the cube's faces sit at cell -0.5 and N - 0.5. The GLSL
// twin is PYRO_GRID_WORLD in components/gpgpuShaderPyroGrid.ts;
// the test-suite round-trips the pair.
export function pyroGridCellOfWorld(
  world: { x: number; y: number; z: number },
  halfExtent: number,
  n: number,
): { x: number; y: number; z: number } {
  const s = n / (2 * halfExtent);
  return {
    x: (world.x + halfExtent) * s - 0.5,
    y: (world.y + halfExtent) * s - 0.5,
    z: (world.z + halfExtent) * s - 0.5,
  };
}

// Grid velocity (cells/second) -> particle velocity unit. The
// position pass integrates pos += vel * dt * speed * 60, so one
// particle-velocity unit is 60 world units/second; one cell is
// 2 * halfExtent / N world units. The scale is therefore
// (2 * halfExtent / N) / 60 — decided in Phase CB (the round-7
// brief's open item) from the position pass's own integration.
export function pyroGridVelScale(halfExtent: number, n: number): number {
  return (2 * halfExtent) / n / 60;
}

// Fog feed (Phase CB, sub-phase 5): the GPGPU system publishes
// the scalar atlas's current read texture here every frame it
// steps the grid; the volume-fog layers sample it. A null
// texture means no grid has stepped (disabled, unsupported, or
// WebGPU session) and the fog amounts must resolve to no-ops.
export type PyroGridFogFeed = {
  texture: import('three').Texture | null;
  resolution: number;
  floatLinear: boolean;
};

export const EMPTY_PYRO_GRID_FOG_FEED: PyroGridFogFeed = {
  texture: null,
  resolution: 0,
  floatLinear: false,
};

// Runtime status for the passes -> diagnostics consumers (same
// store shape as the custom-force status). Written by the pass
// runner each stepped frame; read by the gate via the app (and by
// later UI phases). Never written when the grid is disabled.
export type PyroGridRuntimeStatus = {
  active: boolean;
  resolution: number;
  passesPerStep: number;
  framesStepped: number;
};

let pyroGridStatus: PyroGridRuntimeStatus = {
  active: false,
  resolution: 0,
  passesPerStep: 0,
  framesStepped: 0,
};

export function setPyroGridRuntimeStatus(next: PyroGridRuntimeStatus): void {
  pyroGridStatus = next;
}

export function getPyroGridRuntimeStatus(): PyroGridRuntimeStatus {
  return pyroGridStatus;
}

// ---------------------------------------------------------------------------
// Layer 1 WP6 (phase B2): pyro grammar extensions — the lib-side
// pure models for the temperature/buoyancy authoring (V4), the
// radiative cooling (V5) and the species combustion model (V3).
// Everything below is additive: the shipped solver's arithmetic
// still lives in the GLSL forces / scalar-update passes, and these
// functions are the twins and grammar definitions the authoring
// surface and the test-suite pin. No config keys are added — the
// gpgpuPyro* keys keep scaling the rates exactly as before, and at
// the shipped parameter values every twin below reproduces the
// GLSL arithmetic bit-for-bit in form.
// ---------------------------------------------------------------------------

// GLSL smoothstep twin (the scalar-update pass's ignition window
// uses the GPU builtin; the CPU mirror needs the same curve,
// including the clamped plateaus outside [edge0, edge1]).
export function pyroGridSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// --- V4: temperature field and buoyancy ---------------------------
// The forces pass computes
//   vel.y += dt * (buoyancy * T - densityWeight * rho) * BUOY_ACCEL.
// Two authoring gaps: the formula had no lib twin, and the density
// weight is wired to 0 in the pass runner ("density weight is 0
// this round"), so density-coupled buoyancy could not be authored
// at all. The buoyancy is also absolute-temperature: it is
// referenced to the implicit ambient temperature 0 (the cooling
// below decays T toward 0). The relative form authors buoyancy on
// the thermal excess (T - T_amb); at the shipped ambient 0 it is
// identical to the absolute form.
export const PYRO_GRID_TEMP_AMBIENT = 0.0; // implicit ambient of the shipped model

// Buoyant acceleration in cells/s^2 (before the dt integration) —
// the exact twin of the forces-pass term. densityWeight defaults
// to the shipped 0, where the density term vanishes.
export function pyroGridBuoyancyAccel(
  temperature: number,
  density: number,
  buoyancyKey: number,
  densityWeight = 0,
): number {
  return (buoyancyKey * temperature - densityWeight * density) * PYRO_GRID_BUOY_ACCEL;
}

export function pyroGridThermalExcess(
  temperature: number,
  ambient: number = PYRO_GRID_TEMP_AMBIENT,
): number {
  return temperature - ambient;
}

// Ambient-referenced buoyancy: only the excess over the ambient
// temperature drives the thermal term (the density term is not
// shifted). Reduces to pyroGridBuoyancyAccel at ambient 0.
export function pyroGridBuoyancyAccelRelative(
  temperature: number,
  density: number,
  buoyancyKey: number,
  ambient: number = PYRO_GRID_TEMP_AMBIENT,
  densityWeight = 0,
): number {
  return pyroGridBuoyancyAccel(temperature - ambient, density, buoyancyKey, densityWeight);
}

// --- V5: cooling — exponential twins and radiative cooling --------
// The shipped cooling is a single exponential toward 0:
//   T *= exp(-coolingKey * TEMP_COOL_RATE * dt)
//   rho *= exp(-DENSITY_DECAY_RATE * dt)
// Radiative cooling (the Stefan-Boltzmann shape) is absent: a hot
// cell should shed heat at a rate proportional to T^4 - T_amb^4,
// so the fractional loss grows steeply with temperature instead of
// staying constant. The radiative rate is calibrated so that at
// T = 1, ambient 0, its initial fractional rate equals the
// exponential's at cooling key 1 (TEMP_COOL_RATE per second).
export const PYRO_GRID_RADIATIVE_COOL_RATE = PYRO_GRID_TEMP_COOL_RATE; // 1/s at T = 1

// Exact twin of the shipped temperature cooling.
export function pyroGridCoolTemperature(temperature: number, dt: number, coolingKey = 1): number {
  return temperature * Math.exp(-coolingKey * PYRO_GRID_TEMP_COOL_RATE * dt);
}

// Exact twin of the shipped density decay.
export function pyroGridDecayDensity(density: number, dt: number): number {
  return density * Math.exp(-PYRO_GRID_DENSITY_DECAY_RATE * dt);
}

// Radiative cooling step: dT/dt = -rate * (T^4 - ambient^4),
// cooling-only (a cell at or below the ambient is left unchanged —
// the operator never heats). At ambient 0 the closed form
// T(t) = T0 / (1 + 3 * rate * T0^3 * dt)^(1/3) is used; above an
// ambient floor the step is substepped explicitly (the substep
// count keeps h * rate * T^3 far inside the stable region) and
// clamped at the floor.
export function pyroGridRadiativeCoolTemperature(
  temperature: number,
  dt: number,
  rate: number = PYRO_GRID_RADIATIVE_COOL_RATE,
  ambient: number = PYRO_GRID_TEMP_AMBIENT,
): number {
  if (!(dt > 0) || !(rate > 0) || temperature <= ambient) return temperature;
  if (ambient === 0) {
    return temperature / Math.cbrt(1 + 3 * rate * temperature ** 3 * dt);
  }
  const steps = Math.min(1024, Math.max(1, Math.ceil(48 * rate * temperature ** 3 * dt)));
  const h = dt / steps;
  const ambient4 = ambient ** 4;
  let t = temperature;
  for (let i = 0; i < steps; i += 1) {
    t -= rate * (t ** 4 - ambient4) * h;
    if (t < ambient) return ambient;
  }
  return t;
}

export type PyroCoolingParams = {
  // gpgpuPyroCooling-style scalar scaling the exponential rate.
  coolingKey?: number;
  // Radiative rate (1/s at T = 1); 0 disables the radiative term.
  radiativeRate?: number;
  // Ambient floor both terms relax toward.
  ambient?: number;
};

// Combined cooling grammar: the radiative step, then the
// exponential relaxation toward the ambient floor. With
// radiativeRate 0 and ambient 0 this reduces exactly to the
// shipped exponential (pyroGridCoolTemperature).
export function pyroGridCoolTemperatureCombined(
  temperature: number,
  dt: number,
  params: PyroCoolingParams = {},
): number {
  const ambient = params.ambient ?? PYRO_GRID_TEMP_AMBIENT;
  const radiativeRate = params.radiativeRate ?? PYRO_GRID_RADIATIVE_COOL_RATE;
  const coolingKey = params.coolingKey ?? 1;
  const t = pyroGridRadiativeCoolTemperature(temperature, dt, radiativeRate, ambient);
  return ambient + (t - ambient) * Math.exp(-coolingKey * PYRO_GRID_TEMP_COOL_RATE * dt);
}

// --- V3: combustion with species ----------------------------------
// The shipped reaction (scalar-update pass) is fuel-only:
//   burn = min(fuel, fuelRate * REACTION_K * ignite(T) * fuel * dt)
//   T = min(T + burn * FUEL_HEAT, TEMP_MAX)
// It has no oxidizer (the reaction implicitly assumes unlimited
// oxygen and never starves), no product species (burning generates
// no product field), and no lib-side law at all. The model below
// keeps the shipped reaction as its fuel term and adds the missing
// species:
//   fuel + stoich * oxidizer -> productYield * product  (+ heat)
// The authoring shape follows the gpgpuPyro* convention: scalar
// rates scaled by key-like parameters (fuelRate is the
// gpgpuPyroFuelRate value). The species have no atlas channel yet
// — the shipped fuel rides the scalar atlas's b channel; oxidizer
// and product exist here as the lib-side grammar definition, and
// the GPU connection is out of scope for this phase.

// Ignition factor of a temperature — the scalar-update pass's
// smoothstep window as a lib twin.
export function pyroGridIgnitionFactor(temperature: number): number {
  return pyroGridSmoothstep(PYRO_GRID_FUEL_IGNITE_LO, PYRO_GRID_FUEL_IGNITE_HI, temperature);
}

// Exact twin of the shipped fuel-only burn amount.
export function pyroGridFuelBurn(
  fuel: number,
  temperature: number,
  dt: number,
  fuelRate: number,
): number {
  if (!(fuelRate > 0) || !(fuel > 0) || !(dt > 0)) return 0;
  const ignite = pyroGridIgnitionFactor(temperature);
  return Math.min(fuel, fuelRate * PYRO_GRID_FUEL_REACTION_K * ignite * fuel * dt);
}

export const PYRO_GRID_OXIDIZER_AMBIENT = 1.0; // oxidizer level of unburned air (field units)
// Stoichiometry in normalized field units: oxidizer units consumed
// per fuel unit burned. The product yield defaults to exact mass
// closure (fuel + oxidizer in = product out), so the species mass
// fuel + oxidizer + product is conserved by the reaction itself.
export const PYRO_GRID_COMBUSTION_STOICH = 1.0;
export const PYRO_GRID_COMBUSTION_PRODUCT_YIELD = 1 + PYRO_GRID_COMBUSTION_STOICH;

export type PyroCombustionSpecies = {
  fuel: number;
  oxidizer: number;
  product: number;
  temperature: number;
};

export type PyroCombustionParams = {
  fuelRate: number;
  reactionK: number;
  fuelHeat: number;
  igniteLo: number;
  igniteHi: number;
  tempMax: number;
  stoich: number;
  productYield: number;
  // 1/s relaxation of the oxidizer back toward the ambient level
  // (air inflow). 0 = closed cell: burned-out oxidizer stays gone.
  oxidizerReplenish: number;
};

export const PYRO_GRID_COMBUSTION_DEFAULTS: PyroCombustionParams = {
  fuelRate: 1,
  reactionK: PYRO_GRID_FUEL_REACTION_K,
  fuelHeat: PYRO_GRID_FUEL_HEAT,
  igniteLo: PYRO_GRID_FUEL_IGNITE_LO,
  igniteHi: PYRO_GRID_FUEL_IGNITE_HI,
  tempMax: PYRO_GRID_TEMP_MAX,
  stoich: PYRO_GRID_COMBUSTION_STOICH,
  productYield: PYRO_GRID_COMBUSTION_PRODUCT_YIELD,
  oxidizerReplenish: 0,
};

export function pyroCombustionInitialSpecies(fuel = 0, temperature = 0): PyroCombustionSpecies {
  return { fuel, oxidizer: PYRO_GRID_OXIDIZER_AMBIENT, product: 0, temperature };
}

export function pyroCombustionSpeciesMass(s: PyroCombustionSpecies): number {
  return s.fuel + s.oxidizer + s.product;
}

// One reaction step. Bookkeeping: species mass is conserved
// exactly when productYield = 1 + stoich (the default); the heat
// released is burn * fuelHeat, except the tempMax cap acts as a
// bounded sink — above the cap the excess heat is discarded, the
// same runaway guard as the shipped pass. The oxidizer limits the
// burn (burn <= oxidizer / stoich): with the oxidizer exhausted
// the reaction stops even with fuel and ignition temperature
// present, and with the fuel exhausted it stops likewise. When
// the oxidizer is abundant, the fuel/temperature updates reduce
// exactly to the shipped fuel-only form (pyroGridFuelBurn with
// the same rates).
export function pyroCombustionStep(
  s: PyroCombustionSpecies,
  dt: number,
  params: PyroCombustionParams = PYRO_GRID_COMBUSTION_DEFAULTS,
): PyroCombustionSpecies {
  let fuel = Math.max(0, s.fuel);
  let oxidizer = Math.max(0, s.oxidizer);
  let product = Math.max(0, s.product);
  let temperature = Math.max(0, s.temperature);
  if (dt > 0) {
    const ignite = pyroGridSmoothstep(params.igniteLo, params.igniteHi, temperature);
    let burn = 0;
    if (params.fuelRate > 0 && fuel > 0 && ignite > 0) {
      burn = Math.min(fuel, params.fuelRate * params.reactionK * ignite * fuel * dt);
      if (params.stoich > 0) burn = Math.min(burn, oxidizer / params.stoich);
    }
    if (burn > 0) {
      fuel -= burn;
      oxidizer -= burn * params.stoich;
      product += burn * params.productYield;
      temperature = Math.min(temperature + burn * params.fuelHeat, params.tempMax);
    }
    if (params.oxidizerReplenish > 0 && oxidizer < PYRO_GRID_OXIDIZER_AMBIENT) {
      oxidizer +=
        (PYRO_GRID_OXIDIZER_AMBIENT - oxidizer) * Math.min(1, params.oxidizerReplenish * dt);
    }
  }
  return { fuel, oxidizer, product, temperature };
}
