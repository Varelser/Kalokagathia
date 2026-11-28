/**
 * FLIP bake stepper (layer-2 bake solver, slice S1).
 *
 * Composes the existing flip3d CPU mirrors into a bake
 * stepper for bakeRunner: P2G -> gravity -> pressure
 * projection (free-surface BC) -> G2P -> advect.
 *
 * The transfer scheme is fixed to the sweep decision
 * (BAKE_SF1_RESULT_RECORD): scheme 'flip' with blend 0.95
 * (FLIP0.95) at strength 1. PIC and APIC stay available in
 * flip3d.ts for the live solver; the bake path does not
 * re-open the choice.
 *
 * Units: the runner state is world coordinates on a unit
 * domain [0, 1]^3 with y up. The flip3d mirrors work in grid
 * coordinates (cell centres at integers, domain
 * [-0.5, n - 0.5]) and velocities in cells/second; the
 * stepper converts at its boundary and nowhere else.
 *
 * Not yet measured (gate items when reached, per the sweep
 * record): free-surface reseeding / narrow-band restriction,
 * and the cost of the full Hybrido form (this stepper is the
 * collocated-grid CPU mirror, not a MAC/PCG solver).
 */
import {
  flip3dChiFromWeights,
  flip3dG2PTransfer,
  flip3dGridVelocityFromTransfer,
  flip3dP2GTransfer,
  flip3dPressureProject,
  type Flip3dParticles,
} from './flip3d';
import type { BakeParticleState, BakeStepper } from './bakeRunner';

export const BAKE_FLIP_BLEND = 0.95;

export interface BakeFlipOptions {
  /** Grid resolution per axis (n^3 cells). */
  n: number;
  /** Steps per second (matches the bake fps). */
  fps: number;
  /** Jacobi iterations for the pressure projection. */
  pressureIterations?: number;
  /** Gravity in world units (m/s^2), applied downward (-y). */
  gravity?: number;
}

export function createFlipBakeStepper(opts: BakeFlipOptions): BakeStepper {
  const n = opts.n;
  const dt = 1 / opts.fps;
  const pressureIterations = opts.pressureIterations ?? 40;
  const gravity = opts.gravity ?? 9.8;

  return (state: BakeParticleState) => {
    const count = state.ages.length;
    // World -> grid coordinates / cells-per-second velocities.
    const particles: Flip3dParticles = {
      pos: new Float32Array(count * 3),
      vel: new Float32Array(count * 3),
      affine: new Float32Array(count * 9),
    };
    for (let i = 0; i < count; i++) {
      particles.pos[i * 3] = state.positions[i * 3] * n - 0.5;
      particles.pos[i * 3 + 1] = state.positions[i * 3 + 1] * n - 0.5;
      particles.pos[i * 3 + 2] = state.positions[i * 3 + 2] * n - 0.5;
      particles.vel[i * 3] = state.velocities[i * 3] * n;
      particles.vel[i * 3 + 1] = state.velocities[i * 3 + 1] * n;
      particles.vel[i * 3 + 2] = state.velocities[i * 3 + 2] * n;
    }

    const { momentum, weights } = flip3dP2GTransfer(particles, n, 'flip');
    const baseVel = flip3dGridVelocityFromTransfer(momentum, weights);
    // Gravity on cells that hold liquid weight.
    for (let c = 0; c < weights.length; c++) {
      if (weights[c] > 1e-6) baseVel[c * 3 + 1] -= gravity * n * dt;
    }
    const chi = flip3dChiFromWeights(weights, n, count / (n * n * n));
    const projected = flip3dPressureProject(baseVel, chi, n, pressureIterations);
    const { vel: newVel } = flip3dG2PTransfer(projected.vel, baseVel, particles, n, 'flip', BAKE_FLIP_BLEND, 1);

    // Advect and convert back; clamp to the domain (solid
    // walls, velocity component killed on contact).
    for (let i = 0; i < count; i++) {
      let gx = particles.pos[i * 3] + newVel[i * 3] * dt;
      let gy = particles.pos[i * 3 + 1] + newVel[i * 3 + 1] * dt;
      let gz = particles.pos[i * 3 + 2] + newVel[i * 3 + 2] * dt;
      let vx = newVel[i * 3];
      let vy = newVel[i * 3 + 1];
      let vz = newVel[i * 3 + 2];
      const hi = n - 0.5 - 1e-4;
      const lo = -0.5 + 1e-4;
      if (gx < lo) { gx = lo; vx = Math.max(0, vx); }
      if (gx > hi) { gx = hi; vx = Math.min(0, vx); }
      if (gy < lo) { gy = lo; vy = Math.max(0, vy); }
      if (gy > hi) { gy = hi; vy = Math.min(0, vy); }
      if (gz < lo) { gz = lo; vz = Math.max(0, vz); }
      if (gz > hi) { gz = hi; vz = Math.min(0, vz); }
      state.positions[i * 3] = (gx + 0.5) / n;
      state.positions[i * 3 + 1] = (gy + 0.5) / n;
      state.positions[i * 3 + 2] = (gz + 0.5) / n;
      state.velocities[i * 3] = vx / n;
      state.velocities[i * 3 + 1] = vy / n;
      state.velocities[i * 3 + 2] = vz / n;
      state.ages[i] += dt;
    }
  };
}
