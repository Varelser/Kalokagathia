/**
 * Daemon field laws (Layer 1 WP5, phase B — LAWS ONLY).
 *
 * RealFlow §3's daemon family names four forces the grammar
 * did not have as placeable parts: a Drag daemon (drag as a
 * field with a Falloff, not one global rate), a Crown daemon
 * (the dedicated law that shapes a splash crown), a Sheeter
 * daemon (the membrane-forming force), and the k daemons
 * (placed kill volumes with age / density conditions). This
 * module defines the LAWS for all four as pure functions, in
 * the shape the placed-field grammar already uses, and
 * nothing else:
 *
 *   - NO config keys are added and nothing here is wired to a
 *     shader. Phase D connects the drag and crown laws as new
 *     field-instance kinds (their defs below deliberately
 *     carry the FieldInstanceDef parameter shape — pos /
 *     radius / strength plus kind-specific extras — so the
 *     column-data supply, falloff, layers and the
 *     'field-instances' force chunk can carry them unchanged).
 *   - The Sheeter law is defined against an explicit
 *     NEIGHBOURHOOD SUPPLY type: the aggregated neighbour
 *     statistics (mean velocity / mean position / surface
 *     normal / count) are produced by the solver side's
 *     neighbour pass (SPH / liquid), which this module does
 *     not own. Until that supply is plumbed, the sheeter law
 *     is a definition, not a running force.
 *   - The k-daemon section is the AUTHORING FORM only: a
 *     placed definition with age / density conditions, its
 *     tolerant parse, and the twin judgement (does this
 *     particle match?). Execution — feeding a match into the
 *     existing kill grammar (the lifecycle / live-rule kill
 *     paths) — is a later connection, not part of this phase.
 *
 * Everything is inert by construction: with no defs there is
 * nothing to evaluate, and each law returns an exact zero
 * outside its region, so a future wiring can add these kinds
 * without changing the legacy fields' behaviour.
 */
import { windVolumeFalloff } from './gpgpuWindVolume';

export type DaemonVec3 = [number, number, number];

const ZERO3: DaemonVec3 = [0, 0, 0];

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vec3Or(value: unknown, fallback: DaemonVec3): DaemonVec3 {
  if (!Array.isArray(value)) return [...fallback];
  return [
    finiteOr(value[0], fallback[0]),
    finiteOr(value[1], fallback[1]),
    finiteOr(value[2], fallback[2]),
  ];
}

function distanceTo(pos: DaemonVec3, center: DaemonVec3): number {
  return Math.hypot(pos[0] - center[0], pos[1] - center[1], pos[2] - center[2]);
}

// ── Placed drag daemon ───────────────────────────────────────
//
// The rel-drag law (lib/gpgpuSpeedDragSpin.ts) localised: the
// particle relaxes toward a TARGET velocity — still air
// ([0, 0, 0]) or a wind velocity — at the def's rate, with
// the wind volume's falloff scaling the rate (the house way
// to localise: the B3 law's slot factor sits in the same
// place in the exponent). At the centre the law is exactly
// applyRelDrag at the def's rate; at and beyond the radius
// it is exactly zero.

export interface DaemonDragDef {
  /** Field-instance shape: centre of the placed volume. */
  pos: DaemonVec3;
  /** Field-instance shape: range of the volume. */
  radius: number;
  /** Field-instance shape: relaxation rate at the centre,
   *  in 1/seconds (clamped to the rel-drag range [0, 100]). */
  strength: number;
  /** The velocity the drag relaxes toward: a wind velocity,
   *  or [0, 0, 0] for still air (the classic Drag daemon). */
  target: DaemonVec3;
}

/** Drag rate clamp — the rel-drag range, non-finite → 0. */
export function clampDaemonDragRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * The localising weight at one position: the shared falloff
 * (1 at the centre, 0 at / beyond the radius). This is the
 * factor the rate is scaled by before entering the exponent.
 */
export function daemonDragWeight(def: DaemonDragDef, pos: DaemonVec3): number {
  return windVolumeFalloff(distanceTo(pos, def.pos), def.radius);
}

/**
 * One step of the placed drag law: the Δv that relaxes `vel`
 * toward the def's target velocity. Term for term the
 * rel-drag law with the falloff as the rate factor:
 *   k = 1 − exp(−rate · falloff · dt),  Δv = (target − vel) · k
 * Exactly zero outside the radius, at rate 0, or at dt 0.
 */
export function daemonDragDeltaV(
  def: DaemonDragDef,
  pos: DaemonVec3,
  vel: DaemonVec3,
  delta: number,
): DaemonVec3 {
  const fall = daemonDragWeight(def, pos);
  const rate = clampDaemonDragRate(def.strength);
  const dt = Math.max(delta, 0);
  if (fall <= 0 || rate <= 0 || dt <= 0) return [...ZERO3];
  const k = 1 - Math.exp(-rate * fall * dt);
  return [
    (def.target[0] - vel[0]) * k,
    (def.target[1] - vel[1]) * k,
    (def.target[2] - vel[2]) * k,
  ];
}

// ── Crown daemon ─────────────────────────────────────────────
//
// The splash crown is an annular SHEET: water rises in a
// ring and tips outward. The morph target of the same name
// (lib/gpgpuMorphTargets.ts, 'crown') is an outline — a
// cosine-lobed ring of points — not a force, so the force
// law is shaped from the physics instead:
//
//   - Radial profile: a Gaussian annulus, exp(−((ρ−R)/w)²).
//     It peaks EXACTLY at the ring radius and decays
//     smoothly on both sides. The house falloff (1−(d/R)²)²
//     is a filled-disc profile (peak at the centre) and
//     cannot make a ring; the Gaussian is the smooth bump
//     with no kink at the peak.
//   - Vertical envelope: the shared house falloff over the
//     height above the base plane (pos.y) — full strength at
//     the base, zero at `height`, and exactly zero BELOW
//     the base plane (a crown has no underside).
//   - Direction: radially outward plus up (the DAEMON_CROWN_
//     UP_BIAS), normalised; on the axis itself (ρ = 0) the
//     radial part vanishes and the push is straight up.
//   - Gain: 30, the wind instance's legacy gain — a directed
//     push delivered as Δv over the step, like wind.

/** Legacy gain of the crown push (the wind instance's 30). */
export const DAEMON_CROWN_GAIN = 30;
/** Upward component of the crown direction before
 *  normalisation (1 = 45° between radial and up). */
export const DAEMON_CROWN_UP_BIAS = 1;

export interface DaemonCrownDef {
  /** Field-instance shape: centre of the ring, on the base
   *  plane (the splash origin). */
  pos: DaemonVec3;
  /** Field-instance shape: the ring radius — the radial
   *  distance at which the impulse peaks. */
  radius: number;
  /** Field-instance shape: peak strength multiplier. */
  strength: number;
  /** Vertical reach above the base plane: the impulse
   *  decays by the house falloff and is zero at / beyond
   *  this height, and zero below the base plane. */
  height: number;
  /** Radial thickness of the ring band (the Gaussian's w).
   *  0 or negative reads as radius / 2. */
  width: number;
}

/**
 * The annulus profile in [0, 1]: 1 exactly at the ring
 * radius, Gaussian decay on both sides. A non-positive ring
 * radius has no ring and yields 0 everywhere.
 */
export function daemonCrownRingProfile(radial: number, radius: number, width: number): number {
  if (!(radius > 0)) return 0;
  const w = width > 0 ? width : radius / 2;
  const q = (radial - radius) / w;
  return Math.exp(-q * q);
}

/**
 * The crown's scalar weight at one position: ring profile ×
 * vertical envelope. Exactly zero below the base plane, at /
 * beyond the height, and for a degenerate def.
 */
export function daemonCrownWeight(def: DaemonCrownDef, pos: DaemonVec3): number {
  const y = pos[1] - def.pos[1];
  if (y < 0) return 0;
  const rho = Math.hypot(pos[0] - def.pos[0], pos[2] - def.pos[2]);
  return daemonCrownRingProfile(rho, def.radius, def.width) * windVolumeFalloff(y, def.height);
}

/**
 * One step of the crown law: the Δv pushing the particle up
 * and outward along the sheet. Exactly zero wherever the
 * weight is zero.
 */
export function daemonCrownForce(def: DaemonCrownDef, pos: DaemonVec3, delta: number): DaemonVec3 {
  const w = daemonCrownWeight(def, pos);
  const dt = Math.max(delta, 0);
  if (w <= 0 || dt <= 0 || !Number.isFinite(def.strength)) return [...ZERO3];
  const rx = pos[0] - def.pos[0];
  const rz = pos[2] - def.pos[2];
  const rho = Math.hypot(rx, rz);
  let dx = 0;
  let dz = 0;
  if (rho > 1e-9) { dx = rx / rho; dz = rz / rho; }
  const len = Math.hypot(dx, DAEMON_CROWN_UP_BIAS, dz) || 1;
  const s = (def.strength * w * dt * DAEMON_CROWN_GAIN) / len;
  return [dx * s, DAEMON_CROWN_UP_BIAS * s, dz * s];
}

// ── Sheeter daemon (law only — solver-supplied input) ───────
//
// Membrane formation ("sheeting") is a NEIGHBOURHOOD law: a
// particle sheets when it moves WITH its neighbours and lies
// IN their common plane. The aggregates it needs — the
// neighbourhood's mean velocity, mean position and surface
// normal — are produced by the solver side's neighbour pass
// (the SPH / liquid density-and-neighbour machinery), which
// this module deliberately does not own:
//
//   SUPPLY BOUNDARY: `SheeterNeighbourhoodSupply` is the
//   contract the solver pass must fill per particle. WP5
//   defines the law against that contract only; there is no
//   GPU connection and no supply implementation here.
//
// The law has exactly two terms:
//   1. Coherence: exponential relaxation of the particle's
//      velocity toward the neighbourhood mean velocity (the
//      rel-drag form) — neighbours move together, so a sheet
//      does not tear.
//   2. Flattening: a Δv that removes the OUT-OF-PLANE offset
//      (the signed distance from the neighbourhood mean
//      plane) at the sheet rate — the sheet becomes a
//      membrane. In-plane redistribution is deliberately NOT
//      part of the law: pulling particles toward the mean
//      position inside the plane would fight cohesion /
//      surface tension, which stay the solver's business.

/**
 * The per-particle neighbourhood aggregates the SOLVER
 * side's neighbour pass must supply (see the supply
 * boundary note above). `count` is the number of neighbours
 * backing the aggregates; 0 means "no supply" and the law
 * is exactly zero.
 */
export interface SheeterNeighbourhoodSupply {
  /** Neighbourhood mean velocity (solver-supplied). */
  meanVel: DaemonVec3;
  /** Neighbourhood mean position (solver-supplied). */
  meanPos: DaemonVec3;
  /** Neighbourhood surface normal estimate (solver-
   *  supplied); need not be unit length — the law
   *  normalises it. A zero vector means the plane is
   *  unknown and only the coherence term applies. */
  normal: DaemonVec3;
  /** Neighbours backing the aggregates (0 = no supply). */
  count: number;
}

export interface SheeterParams {
  /** Coherence relaxation rate in 1/seconds, [0, 100]. */
  rate: number;
  /** Flattening rate in 1/seconds, [0, 100]: the out-of-
   *  plane offset is removed at this rate. */
  sheetRate: number;
}

/** Sheeter rate clamp — the rel-drag range, non-finite → 0. */
export function clampSheeterRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * One step of the sheeter law: the Δv from the coherence and
 * flattening terms. Exactly zero with no supply (count 0),
 * at dt 0, or with both rates at 0. The flattening term is
 * skipped when the supplied normal is (near-)zero.
 */
export function sheeterDeltaV(
  params: SheeterParams,
  supply: SheeterNeighbourhoodSupply,
  pos: DaemonVec3,
  vel: DaemonVec3,
  delta: number,
): DaemonVec3 {
  const dt = Math.max(delta, 0);
  if (!supply || !(supply.count > 0) || dt <= 0) return [...ZERO3];
  const rate = clampSheeterRate(params.rate);
  const sheetRate = clampSheeterRate(params.sheetRate);
  const out: DaemonVec3 = [0, 0, 0];
  if (rate > 0) {
    const k = 1 - Math.exp(-rate * dt);
    out[0] += (supply.meanVel[0] - vel[0]) * k;
    out[1] += (supply.meanVel[1] - vel[1]) * k;
    out[2] += (supply.meanVel[2] - vel[2]) * k;
  }
  if (sheetRate > 0) {
    const nl = Math.hypot(supply.normal[0], supply.normal[1], supply.normal[2]);
    if (nl > 1e-9) {
      const nx = supply.normal[0] / nl;
      const ny = supply.normal[1] / nl;
      const nz = supply.normal[2] / nl;
      const offset = (pos[0] - supply.meanPos[0]) * nx
        + (pos[1] - supply.meanPos[1]) * ny
        + (pos[2] - supply.meanPos[2]) * nz;
      const s = -offset * sheetRate * dt;
      out[0] += nx * s;
      out[1] += ny * s;
      out[2] += nz * s;
    }
  }
  return out;
}

// ── k daemons (authoring form + twin judgement only) ────────
//
// RealFlow's k family (k Age / k Volume / k Isolated) kills
// particles by CONDITION rather than by place. The authoring
// form below places the condition: a region (pos / radius)
// plus an age range and a density range (the density is the
// neighbourhood-density proxy for volume / isolation — the
// same `den` quantity the live rules already read). A
// particle matches when it is inside the region AND its age
// AND its density are inside their ranges.
//
// This section is the definition and the judgement ONLY.
// Feeding a match into the existing kill grammar is a later
// connection; nothing here kills anything.
//
// Authoring surface (when wired): one JSON string key in
// the gpgpuGroupsData / gpgpuFieldInstances discipline —
// parsed tolerantly, malformed data resolves to "no
// daemons", never a throw. An omitted range end is OPEN
// (ageMax / densityMax default to +Infinity, the mins to 0).

/** Cap on placed k-daemons (the field-instance cap). */
export const DAEMON_KILL_MAX = 16;

export interface DaemonKillDef {
  /** Centre of the placed region. */
  pos: DaemonVec3;
  /** Region radius: a particle matches only inside it. */
  radius: number;
  /** Age range in seconds, inclusive. ageMax may be
   *  +Infinity (open). */
  ageMin: number;
  ageMax: number;
  /** Neighbourhood-density range, inclusive. densityMax
   *  may be +Infinity (open). */
  densityMin: number;
  densityMax: number;
}

/** The per-particle quantities a k-daemon judges. */
export interface DaemonKillSample {
  /** Particle age in seconds. */
  age: number;
  /** Neighbourhood density (the live rules' `den`). */
  density: number;
}

function parseJsonArray(data: string | undefined): unknown[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

/** An authored range end: a finite number stays, an omitted
 *  or non-finite value reads as the open end. */
function openEndOr(value: unknown, open: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : open;
}

/**
 * Tolerant parse of the k-daemon list (groups discipline:
 * non-objects are skipped, bad numbers fall back per field,
 * the list is capped). An inverted range (min > max) is
 * kept as authored — it simply never matches.
 */
export function parseDaemonKillDefs(data: string | undefined): DaemonKillDef[] {
  const out: DaemonKillDef[] = [];
  for (const item of parseJsonArray(data)) {
    if (out.length >= DAEMON_KILL_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    out.push({
      pos: vec3Or(d.pos, [0, 0, 0]),
      radius: Math.max(0, finiteOr(d.radius, 60)),
      ageMin: Math.max(0, finiteOr(d.ageMin, 0)),
      ageMax: openEndOr(d.ageMax, Infinity),
      densityMin: Math.max(0, finiteOr(d.densityMin, 0)),
      densityMax: openEndOr(d.densityMax, Infinity),
    });
  }
  return out;
}

/**
 * Serialise back to the authoring JSON (open ends are
 * omitted, so a parse → serialize → parse round trip is
 * stable). Null for an empty list (the unset value).
 */
export function serializeDaemonKillDefs(defs: readonly DaemonKillDef[]): string | null {
  if (defs.length === 0) return null;
  const items = defs.map((d) => {
    const o: Record<string, unknown> = {
      pos: [d.pos[0], d.pos[1], d.pos[2]],
      radius: d.radius,
      ageMin: d.ageMin,
      densityMin: d.densityMin,
    };
    if (Number.isFinite(d.ageMax)) o.ageMax = d.ageMax;
    if (Number.isFinite(d.densityMax)) o.densityMax = d.densityMax;
    return o;
  });
  return JSON.stringify(items);
}

/**
 * The twin judgement: does this particle match this daemon?
 * Inside the region (strictly — the boundary is the
 * falloff's zero) AND age in range AND density in range,
 * all ranges inclusive. A non-finite sample never matches.
 */
export function daemonKillMatches(def: DaemonKillDef, pos: DaemonVec3, sample: DaemonKillSample): boolean {
  if (!(def.radius > 0)) return false;
  if (!Number.isFinite(sample.age) || !Number.isFinite(sample.density)) return false;
  if (distanceTo(pos, def.pos) >= def.radius) return false;
  if (sample.age < def.ageMin || sample.age > def.ageMax) return false;
  if (sample.density < def.densityMin || sample.density > def.densityMax) return false;
  return true;
}

/** True when any daemon in the list matches. */
export function daemonKillMatchesAny(
  defs: readonly DaemonKillDef[],
  pos: DaemonVec3,
  sample: DaemonKillSample,
): boolean {
  return defs.some((d) => daemonKillMatches(d, pos, sample));
}
