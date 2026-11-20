// bench-harness.mjs — Phase DA1: frame-time bench run records.
//
// Turns a list of frame-time samples (ms) into one self-describing "run
// record" JSON: distribution stats (mean/p50/p95/p99/max), cliff ratios
// (p99/mean, p99/p50 — how bad the tail is versus the typical frame), a
// state hash (SHA-256 over the canonicalised config/preset JSON, so two
// runs are comparable only when the fingerprinted state matches), and
// environment metadata (timestamp, app version, node, platform).
//
// Samples can come from an external JSON file (the future hook for real
// browser measurement: capture frame times in the page, dump them as
// JSON, feed them here) or be generated deterministically in-process.
//
// Usage:
//   node scripts/bench-harness.mjs [--samples <file.json>]
//                                  [--state <file.json>]
//                                  [--frames <n>] [--seed <n>]
//                                  [--label <text>] [--env-extra <file.json>]
//                                  [--out <file.json>]
//
// --samples file format: a JSON array of numbers, or an object with a
//   "samples" or "frames" array of numbers.
// With no --samples, samples are generated (seeded, reproducible).
// Stdout is the run record JSON. Exit code 0 on success, 1 on bad input.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { platform, arch, release, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Canonicalisation + state hash
// ---------------------------------------------------------------------------

// Deep-canonicalise a JSON value: object keys sorted recursively, arrays
// kept in order, undefined dropped (mirrors JSON.stringify semantics).
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

// SHA-256 hex fingerprint of any JSON-serialisable state.
export function stateHash(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Frame-time statistics
// ---------------------------------------------------------------------------

// Percentile with linear interpolation between closest ranks.
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

const round4 = (n) => Math.round(n * 10000) / 10000;

export function computeStats(samples) {
  const clean = samples.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (clean.length === 0) {
    throw new Error('no finite numeric samples');
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const sum = clean.reduce((acc, n) => acc + n, 0);
  const mean = sum / clean.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  return {
    count: clean.length,
    frameMs: {
      mean: round4(mean),
      p50: round4(p50),
      p95: round4(p95),
      p99: round4(p99),
      max: round4(max),
      min: round4(min),
    },
    // Cliff ratios: 1.0 = perfectly flat; large values mean the tail
    // (hitches/stalls) dominates over the typical frame cost.
    cliff: {
      p99OverMean: mean > 0 ? round4(p99 / mean) : null,
      p99OverP50: p50 > 0 ? round4(p99 / p50) : null,
      maxOverMean: mean > 0 ? round4(max / mean) : null,
    },
    approxFpsFromMean: mean > 0 ? round4(1000 / mean) : null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic sample generation (stand-in until browser capture is wired)
// ---------------------------------------------------------------------------

// mulberry32: tiny seeded PRNG so generated runs are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSamples({
  frames = 300,
  baseMs = 11.7,
  jitterMs = 1.8,
  spikeEvery = 47,
  spikeMs = 14,
  seed = 1,
} = {}) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    let ms = baseMs + (rand() * 2 - 1) * jitterMs;
    if (spikeEvery > 0 && i > 0 && i % spikeEvery === 0) {
      ms += spikeMs * (0.5 + rand());
    }
    out.push(round4(Math.max(0.1, ms)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export function appVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export function buildRunRecord({ samples, samplesSource, state = null, stateSource = null, label = null, envExtra = null }) {
  const stats = computeStats(samples);
  const record = {
    kind: 'kalokagathia-bench-run',
    schemaVersion: 1,
    label,
    timestamp: new Date().toISOString(),
    env: {
      appVersion: appVersion(),
      node: process.version,
      platform: platform(),
      osRelease: release(),
      arch: arch(),
      cpuCount: cpus().length,
      ...(envExtra && typeof envExtra === 'object' ? envExtra : {}),
    },
    state: state === null
      ? null
      : {
          source: stateSource,
          hash: stateHash(state),
          canonicalBytes: Buffer.byteLength(canonicalJson(state), 'utf8'),
        },
    samples: { source: samplesSource, count: stats.count },
    frameMs: stats.frameMs,
    cliff: stats.cliff,
    approxFpsFromMean: stats.approxFpsFromMean,
  };
  return record;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function extractSamples(parsed, path) {
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed?.samples ?? parsed?.frames ?? parsed?.frameTimes;
  if (!Array.isArray(arr)) {
    throw new Error(`${path}: expected a JSON array of numbers, or an object with "samples"/"frames" array`);
  }
  return arr;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  let samples;
  let samplesSource;
  if (typeof args.samples === 'string') {
    samples = extractSamples(readJsonFile(args.samples), args.samples);
    samplesSource = `file:${basename(args.samples)}`;
  } else {
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const frames = args.frames !== undefined ? Number(args.frames) : 300;
    samples = generateSamples({ seed, frames });
    samplesSource = `generated(seed=${seed},frames=${frames})`;
  }

  let state = null;
  let stateSource = null;
  if (typeof args.state === 'string') {
    state = readJsonFile(args.state);
    stateSource = `file:${basename(args.state)}`;
  }

  const envExtra = typeof args['env-extra'] === 'string' ? readJsonFile(args['env-extra']) : null;

  const record = buildRunRecord({
    samples,
    samplesSource,
    state,
    stateSource,
    label: typeof args.label === 'string' ? args.label : null,
    envExtra,
  });

  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (typeof args.out === 'string') {
    writeFileSync(args.out, text, 'utf8');
  }
  process.stdout.write(text);
  return record;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`bench-harness: ${err.message}`);
    process.exit(1);
  }
}
