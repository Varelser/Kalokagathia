/**
 * Seeded initial state for the GPGPU particle system.
 *
 * The position/velocity arrays used to seed both the WebGL and the
 * WebGPU backends are built here, as a pure function of
 * (texSize, bounceRadius, emitShape, seed). Before this module
 * existed the runtime filled the arrays with Math.random(), so the
 * same preset produced a different initial cloud on every load.
 * With a seed stored in the config (gpgpuSeed), the same preset now
 * starts from exactly the same cloud on every load and machine.
 *
 * The distribution math is the original runtime code verbatim —
 * only the random source changed (Math.random -> mulberry32).
 */

export type GpgpuEmitShape = 'sphere' | 'disc' | 'ring' | 'box' | 'shell' | 'cone';

/** mulberry32: small, fast, seedable PRNG with a uniform [0, 1) output.
 * The implementation lives in lib/seededRng.ts (2026-11-14 perf stage-2
 * split) and is re-exported here for existing importers. */
import { createSeededRng } from './seededRng';
export { createSeededRng };

export interface GpgpuInitialData {
  posData: Float32Array;
  velData: Float32Array;
}

export function buildGpgpuInitialData(
  texSize: number,
  bounceRadius: number,
  emitShape: GpgpuEmitShape,
  seed: number,
): GpgpuInitialData {
  const random = createSeededRng(seed);
  const count = texSize * texSize;
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  const r = bounceRadius;
  const shape = emitShape;
  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2;
    let px: number;
    let py: number;
    let pz: number;
    if (shape === 'disc') {
      const rad = r * Math.sqrt(random());
      px = rad * Math.cos(theta);
      py = 0;
      pz = rad * Math.sin(theta);
    } else if (shape === 'ring') {
      const rad = r * (0.85 + random() * 0.15);
      px = rad * Math.cos(theta);
      py = (random() - 0.5) * r * 0.08;
      pz = rad * Math.sin(theta);
    } else if (shape === 'box') {
      px = (random() - 0.5) * 2 * r;
      py = (random() - 0.5) * 2 * r;
      pz = (random() - 0.5) * 2 * r;
    } else if (shape === 'shell') {
      const phi = Math.acos(2 * random() - 1);
      px = r * Math.sin(phi) * Math.cos(theta);
      py = r * Math.sin(phi) * Math.sin(theta);
      pz = r * Math.cos(phi);
    } else if (shape === 'cone') {
      const h = random() * r;
      const cr = (h / r) * r;
      px = cr * Math.cos(theta);
      py = h - r * 0.5;
      pz = cr * Math.sin(theta);
    } else {
      const phi = Math.acos(2 * random() - 1);
      const rad = r * (0.1 + random() * 0.9);
      px = rad * Math.sin(phi) * Math.cos(theta);
      py = rad * Math.sin(phi) * Math.sin(theta);
      pz = rad * Math.cos(phi);
    }
    posData[i * 4] = px;
    posData[i * 4 + 1] = py;
    posData[i * 4 + 2] = pz;
    posData[i * 4 + 3] = 1;
    velData[i * 4] = (random() - 0.5) * 4;
    velData[i * 4 + 1] = (random() - 0.5) * 4;
    velData[i * 4 + 2] = (random() - 0.5) * 4;
  }
  return { posData, velData };
}
