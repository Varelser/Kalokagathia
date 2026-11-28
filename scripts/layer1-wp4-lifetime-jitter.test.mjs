#!/usr/bin/env node
// layer1-wp4-lifetime-jitter.test.mjs — Layer 1 WP4 phase A:
// per-particle lifetime spread (the lifetime-jitter section of
// lib/gpgpuLifecycle.ts + the gpgpuAgeMaxJitter config key).
//
// Until this phase the age ceiling was one number for the
// whole pool (gpgpuAgeMax): a cohort born together died
// together. The jitter gives each particle an effective age
// max of gpgpuAgeMax x m, where m is a deterministic-hash
// multiplier uniform in [1 - j, 1 + j] (mean 1). This phase
// ships the pure functions and the key only; the position
// pass applies the multiplier in phase C (the GLSL
// transcription is written out in the module header).
//
// Pins:
// (a) legacy identity: at j = 0 every multiplier is EXACTLY 1
//     and particleAgeMax returns gpgpuAgeMax untouched, for
//     whole pools at two texture sizes — the default render
//     stays bit-identical.
// (b) distribution: at j = 0.5 a full 128 pool's multipliers
//     stay inside [0.5, 1.5], actually reach both ends of the
//     interval, and average to 1 within tolerance; at j = 1
//     the range is [0, 2].
// (c) determinism: the hash draws are pinned to exact values
//     for representative indices / UVs (the constants are the
//     contract phase C's GLSL twin must reproduce), repeated
//     calls agree, and the index form equals the UV form at
//     the texel centre.
// (d) clamp discipline: out-of-range / non-finite jitter
//     collapses to the legacy behaviour (multiplier 1), a
//     non-finite hash yields 1, and an out-of-range hash is
//     clamped before use.
// (e) key registration: gpgpuAgeMaxJitter is in the recorded
//     fingerprint key set, DEFAULT_CONFIG carries it as 0,
//     and normalizeConfig round-trips it (default fill +
//     authored value preserved).
//
// Run: node scripts/layer1-wp4-lifetime-jitter.test.mjs

import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const L = await load('lib/gpgpuLifecycle.ts');

// ---- (a) legacy identity at j = 0 ------------------------------------
for (const size of [128, 256]) {
  let allOne = true;
  for (let i = 0; i < size * size; i++) {
    if (L.lifetimeMultiplierForIndex(i, size, 0) !== 1) { allOne = false; break; }
  }
  check(`j=0: every multiplier is exactly 1 (size ${size})`, allOne);
}
check('j=0: particleAgeMax returns ageMax untouched',
  L.particleAgeMax(8, 42, 128, 0) === 8 && L.particleAgeMax(3.5, 7, 256, 0) === 3.5);
check('j=0: UV form is exactly 1',
  L.lifetimeMultiplierForUv(0.5, 0.5, 0) === 1 && L.lifetimeMultiplierForUv(0.001, 0.999, 0) === 1);

// ---- (b) distribution -------------------------------------------------
{
  const size = 128;
  let mn = Infinity;
  let mx = -Infinity;
  let sum = 0;
  for (let i = 0; i < size * size; i++) {
    const m = L.lifetimeMultiplierForIndex(i, size, 0.5);
    if (m < mn) mn = m;
    if (m > mx) mx = m;
    sum += m;
  }
  const mean = sum / (size * size);
  check('j=0.5: all multipliers inside [0.5, 1.5]', mn >= 0.5 && mx <= 1.5);
  check('j=0.5: distribution reaches both ends', mn < 0.51 && mx > 1.49);
  check('j=0.5: pool mean is 1 within 0.01', Math.abs(mean - 1) < 0.01);
}
{
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < 128 * 128; i++) {
    const m = L.lifetimeMultiplierForIndex(i, 128, 1);
    if (m < mn) mn = m;
    if (m > mx) mx = m;
  }
  check('j=1: all multipliers inside [0, 2]', mn >= 0 && mx <= 2);
}

// ---- (c) determinism / pinned draws -----------------------------------
check('hash pin: index 0 @128', L.ageJitterHashForIndex(0, 128) === 0.9377833514408849);
check('hash pin: index 1 @128', L.ageJitterHashForIndex(1, 128) === 0.479536569209813);
check('hash pin: index 42 @128', L.ageJitterHashForIndex(42, 128) === 0.3534383125479508);
check('hash pin: index 12345 @128', L.ageJitterHashForIndex(12345, 128) === 0.7398612124025021);
check('hash pin: index 0 @256', L.ageJitterHashForIndex(0, 256) === 0.24206499409410753);
check('hash pin: index 999 @256', L.ageJitterHashForIndex(999, 256) === 0.6833814893061572);
check('hash pin: uv (0.5, 0.5)', L.ageJitterHashForUv(0.5, 0.5) === 0.11225664251560374);
check('multiplier pin: index 0 @128, j=0.5',
  L.lifetimeMultiplierForIndex(0, 128, 0.5) === 1.4377833514408849);
check('multiplier pin: index 42 @128, j=1',
  L.lifetimeMultiplierForIndex(42, 128, 1) === 0.7068766250959015);
check('particleAgeMax pin: (8, 42, 128, j=1)',
  L.particleAgeMax(8, 42, 128, 1) === 5.655013000767212);
check('repeated calls agree',
  L.ageJitterHashForIndex(777, 128) === L.ageJitterHashForIndex(777, 128)
  && L.lifetimeMultiplierForIndex(777, 128, 0.3) === L.lifetimeMultiplierForIndex(777, 128, 0.3));
{
  // The index form IS the UV form at the texel centre.
  const size = 128;
  const idx = 1234;
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  check('index form equals UV form at texel centre',
    L.lifetimeMultiplierForIndex(idx, size, 0.7) === L.lifetimeMultiplierForUv(u, v, 0.7));
}
check('lifetime draw is decorrelated from the spawn draw',
  L.ageJitterHashForIndex(42, 128) !== L.spawnHashForIndex(42, 128)
  && L.ageJitterHashForIndex(42, 128) !== L.spawnEventHashForIndex(42, 128));

// ---- (d) clamp discipline ----------------------------------------------
check('clampAgeMaxJitter: range and non-finite',
  L.clampAgeMaxJitter(-0.5) === 0 && L.clampAgeMaxJitter(2) === 1
  && L.clampAgeMaxJitter(0.25) === 0.25 && L.clampAgeMaxJitter(NaN) === 0
  && L.clampAgeMaxJitter(Infinity) === 0);
check('negative jitter collapses to legacy', L.lifetimeMultiplierForIndex(5, 128, -1) === 1);
check('NaN jitter collapses to legacy', L.lifetimeMultiplierForIndex(5, 128, NaN) === 1);
check('jitter above 1 behaves as 1',
  L.lifetimeMultiplierForIndex(5, 128, 7) === L.lifetimeMultiplierForIndex(5, 128, 1));
check('non-finite hash yields multiplier 1',
  L.lifetimeMultiplierFromHash(NaN, 0.5) === 1 && L.lifetimeMultiplierFromHash(Infinity, 0.5) === 1);
check('out-of-range hash is clamped',
  near(L.lifetimeMultiplierFromHash(1.4, 0.5), 1.5) && near(L.lifetimeMultiplierFromHash(-0.2, 0.5), 0.5));

// ---- (e) key registration ----------------------------------------------
{
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts', 'validate-keys.fingerprint.json'), 'utf8'));
  check('fingerprint record contains gpgpuAgeMaxJitter', record.keys.includes('gpgpuAgeMaxJitter'));
  check('fingerprint record keyCount matches its key list', record.keyCount === record.keys.length);
}
{
  const D = await load('lib/appStateConfigDefaults.ts');
  check('DEFAULT_CONFIG.gpgpuAgeMaxJitter defaults to 0', D.DEFAULT_CONFIG.gpgpuAgeMaxJitter === 0);
  const N = await load('lib/appStateConfigNormalization.ts');
  check('normalizeConfig fills the default 0', N.normalizeConfig({}).gpgpuAgeMaxJitter === 0);
  check('normalizeConfig preserves an authored value',
    N.normalizeConfig({ gpgpuAgeMaxJitter: 0.4 }).gpgpuAgeMaxJitter === 0.4);
}

if (failures > 0) {
  console.error(`layer1-wp4-lifetime-jitter: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`layer1-wp4-lifetime-jitter: ${checks}/${checks} checks passed`);
