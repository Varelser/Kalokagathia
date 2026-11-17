/**
 * Particle Life behaviour semantics (Phase AA1: Predator/Prey +
 * Meander).
 *
 * The species interaction matrix (lib/gpgpuParticleLife.ts) gives
 * every species pair a symmetric attraction/repulsion weight, but it
 * has no NOTION of chasing or fleeing, no vision, and no speed cap —
 * the three things that make Particular's Predator/Prey a behaviour
 * rather than a force field. This module adds that behaviour layer
 * as a separate, additive term:
 *
 *  - Pursue / Evade coefficients are PER SPECIES PAIR, defined by a
 *    cyclic predator chain (the same convention the 'snakes' matrix
 *    preset uses): species i pursues species (i+1) mod n (its prey)
 *    and evades species (i-1+n) mod n (its predator). The two new
 *    config keys scale the two terms independently, so a scene can
 *    have pursuit without flight or the reverse.
 *  - Vision: a neighbour only counts as a behaviour target when it
 *    is within `visionRange` AND inside the vision cone around the
 *    particle's velocity direction (angle <= visionAngle / 2). A
 *    particle at rest (speed ~ 0) has no facing, so the cone does
 *    not gate it. visionAngle >= 360 disables the cone.
 *  - Max speed: when > 0, the velocity AFTER the behaviour-bearing
 *    Particle Life block is clamped to this length. 0 = no cap
 *    (legacy). The cap is a single key (not per species): the
 *    per-species variation Particular exposes is carried by the
 *    pursue/evade chain above, and the report says so.
 *  - Meander: a per-particle wander term. Each particle owns a fixed
 *    phase (hash of its index, the same plHash family the shader
 *    uses for species) and samples three phase-shifted sines of its
 *    own position at `meanderScale`, so neighbours wander
 *    differently and a single particle's heading keeps drifting —
 *    a behaviour attached to the individual, not a global field
 *    modulation (the modulation.ts organic wander is a parameter
 *    LFO and is untouched).
 *
 * Everything here is a pure function (no RNG state, no clock — the
 * caller passes the simulation time), and the GLSL twin in
 * components/gpgpuShaderSimulationVelocity.ts implements the same
 * formulas so the CPU model used in tests and the GPU behaviour
 * agree. With pursue = evade = meanderAmount = 0 and maxSpeed = 0
 * every function here reduces to the identity and the shader block
 * is skipped term by term, keeping the legacy render bit-identical.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ParticleLifeBehaviorOptions {
  /** Pursuit strength toward the prey species (0 = off). */
  pursue: number;
  /** Flight strength away from the predator species (0 = off). */
  evade: number;
  /** Vision distance; <= 0 falls back to the interaction radius. */
  visionRange: number;
  /** Full vision cone angle in degrees; >= 360 = ungated. */
  visionAngleDeg: number;
  /** Wander strength (0 = off). */
  meanderAmount: number;
  /** Wander spatial scale (sine frequency factor). */
  meanderScale: number;
}

export const DEFAULT_PARTICLE_LIFE_BEHAVIOR: ParticleLifeBehaviorOptions = {
  pursue: 0,
  evade: 0,
  visionRange: 120,
  visionAngleDeg: 360,
  meanderAmount: 0,
  meanderScale: 1,
};

function clampNonNegative(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, v);
}

export function clampBehaviorPursue(v: number): number {
  return clampNonNegative(v, 0);
}
export function clampBehaviorEvade(v: number): number {
  return clampNonNegative(v, 0);
}
export function clampVisionRange(v: number): number {
  return clampNonNegative(v, 0);
}
export function clampVisionAngle(v: number): number {
  if (!Number.isFinite(v)) return 360;
  return Math.max(1, Math.min(360, v));
}
export function clampLifeMaxSpeed(v: number): number {
  return clampNonNegative(v, 0);
}
export function clampMeanderAmount(v: number): number {
  return clampNonNegative(v, 0);
}
export function clampMeanderScale(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  return v;
}

/** The prey species of `self` in the cyclic chain: (self + 1) mod n. */
export function preySpeciesOf(self: number, speciesCount: number): number {
  const n = Math.max(2, Math.floor(speciesCount) || 2);
  return (((self % n) + n) % n + 1) % n;
}

/** The predator species of `self` in the cyclic chain: (self - 1) mod n. */
export function predatorSpeciesOf(self: number, speciesCount: number): number {
  const n = Math.max(2, Math.floor(speciesCount) || 2);
  return (((self % n) + n) % n - 1 + n) % n;
}

/** Pursuit coefficient of the ordered pair (self -> other): 1 when
 *  `other` is self's prey species, else 0. */
export function pursueCoefficient(self: number, other: number, speciesCount: number): number {
  return other === preySpeciesOf(self, speciesCount) ? 1 : 0;
}

/** Evade coefficient of the ordered pair (self -> other): 1 when
 *  `other` is self's predator species, else 0. */
export function evadeCoefficient(self: number, other: number, speciesCount: number): number {
  return other === predatorSpeciesOf(self, speciesCount) ? 1 : 0;
}

/**
 * Vision gate: is a neighbour at offset `diff` (other - self) a
 * behaviour target for a particle moving with velocity `vel`?
 * Distance must be within the effective vision range (visionRange,
 * or `fallbackRange` when visionRange <= 0); the cone test compares
 * the cosine against cos(angle/2) and is skipped for a full circle
 * or a (near-)stationary particle.
 */
export function visionSees(
  diff: Vec3Like,
  vel: Vec3Like,
  visionRange: number,
  visionAngleDeg: number,
  fallbackRange: number,
): boolean {
  const d = Math.hypot(diff.x, diff.y, diff.z);
  const range = visionRange > 0 ? visionRange : fallbackRange;
  if (!(d > 0.001) || d > range) return false;
  const angle = clampVisionAngle(visionAngleDeg);
  if (angle >= 360) return true;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < 0.01) return true;
  const cos = (diff.x * vel.x + diff.y * vel.y + diff.z * vel.z) / (d * speed);
  return cos >= Math.cos((angle * Math.PI) / 360);
}

/**
 * Behaviour force on one particle from a set of neighbours, using
 * the same triangular band as the matrix force (beta = 0.3 of the
 * interaction radius, peak at r = (1 + beta) / 2): pursue pulls
 * toward visible prey, evade pushes away from visible predators.
 * Returns the zero vector when both coefficients are 0.
 */
export function particleLifeBehaviorForce(
  self: { pos: Vec3Like; vel: Vec3Like; species: number },
  others: ReadonlyArray<{ pos: Vec3Like; species: number }>,
  speciesCount: number,
  radius: number,
  opts: ParticleLifeBehaviorOptions,
): Vec3Like {
  const out = { x: 0, y: 0, z: 0 };
  const pursue = clampBehaviorPursue(opts.pursue);
  const evade = clampBehaviorEvade(opts.evade);
  if (pursue === 0 && evade === 0) return out;
  const plRadius = Math.max(1, radius);
  const beta = 0.3;
  for (const other of others) {
    const pc = pursueCoefficient(self.species, other.species, speciesCount);
    const ec = evadeCoefficient(self.species, other.species, speciesCount);
    if (pc === 0 && ec === 0) continue;
    const diff = {
      x: other.pos.x - self.pos.x,
      y: other.pos.y - self.pos.y,
      z: other.pos.z - self.pos.z,
    };
    const d = Math.hypot(diff.x, diff.y, diff.z);
    if (!(d > 0.001) || d >= plRadius) continue;
    if (!visionSees(diff, self.vel, opts.visionRange, opts.visionAngleDeg, plRadius)) continue;
    const r = d / plRadius;
    if (r < beta) continue;
    const band = 1 - Math.abs(2 * r - 1 - beta) / (1 - beta);
    const w = (pursue * pc - evade * ec) * band;
    out.x += (diff.x / d) * w;
    out.y += (diff.y / d) * w;
    out.z += (diff.z / d) * w;
  }
  return out;
}

/** Per-particle wander phase in [0, 2pi): the shader's plHash family. */
export function meanderPhaseForIndex(index: number): number {
  const h = Math.sin((index + 17.17) * 127.1 + 311.7) * 43758.5453123;
  const frac = h - Math.floor(h);
  return frac * Math.PI * 2;
}

/**
 * Meander wander vector for one particle: three phase-shifted sines
 * of the particle's own position. Pure in (pos, phase, scale, time);
 * the GLSL twin uses the identical expression.
 */
export function meanderVector(
  pos: Vec3Like,
  phase: number,
  scale: number,
  time: number,
): Vec3Like {
  const s = 0.02 * clampMeanderScale(scale);
  const t = time * 0.7;
  return {
    x: Math.sin(pos.y * s + phase + t),
    y: Math.sin(pos.z * s + phase * 1.7 + t),
    z: Math.sin(pos.x * s + phase * 2.3 + t),
  };
}

/** Clamp a velocity to `maxSpeed` (0 / non-finite = no clamp). */
export function clampVelocityToMaxSpeed(vel: Vec3Like, maxSpeed: number): Vec3Like {
  const cap = clampLifeMaxSpeed(maxSpeed);
  if (cap <= 0) return { ...vel };
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed <= cap || speed === 0) return { ...vel };
  const k = cap / speed;
  return { x: vel.x * k, y: vel.y * k, z: vel.z * k };
}

export interface BehaviorParticle {
  pos: Vec3Like;
  vel: Vec3Like;
  species: number;
}

/**
 * Deterministic CPU step of the behaviour layer alone (Euler,
 * friction, max-speed clamp) — the model the unit tests and the
 * gate statistics are built on. It deliberately excludes the matrix
 * force and every other subsystem: it measures what the BEHAVIOUR
 * terms do, in isolation, exactly as the shader adds them
 * (force * dt * 45, then friction retention, then the cap).
 */
export function stepParticleLifeBehavior(
  particles: BehaviorParticle[],
  speciesCount: number,
  radius: number,
  opts: ParticleLifeBehaviorOptions,
  maxSpeed: number,
  friction: number,
  time: number,
  dt: number,
): BehaviorParticle[] {
  const meander = clampMeanderAmount(opts.meanderAmount);
  return particles.map((p, i) => {
    const force = particleLifeBehaviorForce(p, particles.filter((_, j) => j !== i), speciesCount, radius, opts);
    let vx = p.vel.x + force.x * dt * 45;
    let vy = p.vel.y + force.y * dt * 45;
    let vz = p.vel.z + force.z * dt * 45;
    if (meander > 0) {
      const m = meanderVector(p.pos, meanderPhaseForIndex(i), opts.meanderScale, time);
      vx += m.x * meander * dt * 30;
      vy += m.y * meander * dt * 30;
      vz += m.z * meander * dt * 30;
    }
    const retention = Math.pow(Math.max(0, Math.min(1, friction)), dt * 60);
    vx *= retention;
    vy *= retention;
    vz *= retention;
    const capped = clampVelocityToMaxSpeed({ x: vx, y: vy, z: vz }, maxSpeed);
    return {
      species: p.species,
      vel: capped,
      pos: {
        x: p.pos.x + capped.x * dt,
        y: p.pos.y + capped.y * dt,
        z: p.pos.z + capped.z * dt,
      },
    };
  });
}

/** Mean pairwise distance between the centroids of two species. */
export function speciesCentroidDistance(
  particles: ReadonlyArray<BehaviorParticle>,
  speciesA: number,
  speciesB: number,
): number {
  const centroid = (sp: number): Vec3Like => {
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const p of particles) {
      if (p.species !== sp) continue;
      x += p.pos.x;
      y += p.pos.y;
      z += p.pos.z;
      n++;
    }
    if (n === 0) return { x: 0, y: 0, z: 0 };
    return { x: x / n, y: y / n, z: z / n };
  };
  const a = centroid(speciesA);
  const b = centroid(speciesB);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
