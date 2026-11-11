import * as THREE from 'three';
import type { ReactionMode, ReactionProfile, ReactionSource } from './sceneReactionDiffusionProfiles';

function fract(v: number) {
  return v - Math.floor(v);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function buildSeedTexture(size: number, mode: ReactionMode, source: ReactionSource, profile: ReactionProfile, model: 'gray-scott' | 'fhn' | 'lenia' = 'gray-scott') {
  const data = new Float32Array(size * size * 4);
  const biofilm = mode === 'biofilm_skin';
  const front = mode === 'cellular_front';
  const corrosion = mode === 'corrosion_front';
  // Lenia seed: ~40 random soft blobs in channel A (value 0.4-1.0), B=0.
  // Deterministic PRNG so reseeds are reproducible.
  const leniaBlobs: { cx: number; cy: number; r: number; amp: number }[] = [];
  if (model === 'lenia') {
    let s = 1234567;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 40; i += 1) {
      leniaBlobs.push({ cx: rnd() - 0.5, cy: rnd() - 0.5, r: 0.03 + rnd() * 0.07, amp: 0.4 + rnd() * 0.6 });
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const r = Math.sqrt(nx * nx + ny * ny);
      const angle = Math.atan2(ny, nx);
      const grain = fract(Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233) * 43758.5453123);
      let spot = Math.exp(-r * 18.0) + 0.55 * Math.exp(-Math.pow(r - 0.18, 2) * 480.0) * (0.6 + 0.4 * Math.sin(angle * 6.0));
      if (biofilm) {
        const blobs = 0.58 + 0.42 * Math.sin((nx * 5.2 + ny * 3.6) * 9.0) * Math.cos((ny * 5.8 - nx * 3.2) * 7.0);
        const rim = Math.exp(-Math.pow(r - 0.24, 2) * 220.0);
        const trails = 0.5 + 0.5 * Math.sin(angle * 8.0 + r * 28.0);
        spot = Math.max(0, blobs * 0.42 + rim * (0.6 + trails * 0.4) + Math.exp(-r * 7.0) * 0.32 + (grain - 0.5) * 0.08);
      } else if (corrosion) {
        const pits = 0.5 + 0.5 * Math.sin((nx * 6.0 - ny * 4.8) * 11.0) * Math.cos((ny * 5.4 + nx * 2.7) * 9.0);
        const edge = Math.exp(-Math.pow(r - 0.22, 2) * 180.0);
        const etch = 0.5 + 0.5 * Math.sin(angle * 10.0 + r * 22.0);
        spot = Math.max(0, pits * 0.34 + edge * (0.45 + etch * 0.35) + Math.exp(-r * 5.5) * 0.18 + (grain - 0.5) * 0.1);
      }
      const ringSeed = Math.exp(-Math.pow(r - (0.18 + profile.seedRing * 0.18), 2) * (180.0 + profile.seedRing * 180.0));
      const ledgerSeed = (0.5 + 0.5 * Math.sin((ny + nx * 0.1) * (18.0 + profile.seedLedger * 56.0))) * profile.seedLedger;
      const sweepSeed = (0.5 + 0.5 * Math.sin(angle * (4.0 + profile.seedSweep * 8.0) + r * (12.0 + profile.seedSweep * 18.0))) * profile.seedSweep;
      const canopySeed = smoothstep(0.42, -0.48, ny + Math.sin(nx * 8.0) * 0.08) * profile.seedCanopy;
      const columnSeed = smoothstep(0.32, 0.02, Math.abs(nx + Math.sin(ny * 10.0) * 0.04)) * profile.seedColumn;
      const terraceSeed = (0.5 + 0.5 * Math.sin((ny * (8.0 + profile.seedTerrace * 16.0)) + Math.floor(nx * 8.0) * 0.4)) * profile.seedTerrace;
      const blobSeed = (0.5 + 0.5 * Math.sin((nx * 7.0 + ny * 5.0) * 6.0) * Math.cos((ny * 6.0 - nx * 3.0) * 5.0)) * profile.seedBlob;
      const frontSweep = front ? smoothstep(-0.5, 0.6, nx + ny * 0.15 + sweepSeed * 0.18) : 0;
      const sourceMix = ringSeed * 0.24 + ledgerSeed * 0.18 + sweepSeed * 0.2 + canopySeed * 0.18 + columnSeed * 0.18 + terraceSeed * 0.16 + blobSeed * 0.18;
      if (source === 'text') {
        spot += ledgerSeed * 0.24 + terraceSeed * 0.18;
      }
      if (source === 'grid' || source === 'plane') {
        spot += terraceSeed * 0.24 + columnSeed * 0.12;
      }
      if (source === 'ring' || source === 'disc' || source === 'torus') {
        spot += ringSeed * 0.26 + sweepSeed * 0.12;
      }
      if (source === 'spiral' || source === 'galaxy') {
        spot += sweepSeed * 0.28 + ringSeed * 0.1;
      }
      if (source === 'image' || source === 'video') {
        spot += blobSeed * 0.24 + canopySeed * 0.14;
      }
      if (source === 'cube' || source === 'cylinder' || source === 'cone') {
        spot += columnSeed * 0.24 + terraceSeed * 0.1;
      }
      if (front) {
        spot += frontSweep * 0.2;
      }
      const b = THREE.MathUtils.clamp(spot + sourceMix + (grain - 0.5) * (biofilm ? 0.05 : 0.08), 0, 1);
      if (model === 'lenia') {
        let a = 0;
        for (const bl of leniaBlobs) {
          const ddx = nx - bl.cx;
          const ddy = ny - bl.cy;
          const d2 = ddx * ddx + ddy * ddy;
          a = Math.max(a, bl.amp * Math.exp(-d2 / (bl.r * bl.r)));
        }
        data[i + 0] = THREE.MathUtils.clamp(a, 0, 1);
        data[i + 1] = 0;
      } else if (model === 'fhn') {
        // FHN state space: u,v in [-1.5, 1.5] stored as (s + 1.5) / 3.
        // Rest state u ~ -1.2 (stored 0.1), v ~ -0.63 (stored 0.29);
        // seed spots become activator excitations.
        data[i + 0] = 0.1 + b * 0.75;
        data[i + 1] = 0.29;
      } else {
        data[i + 0] = 1;
        data[i + 1] = b;
      }
      data[i + 2] = 0;
      data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return tex;
}
