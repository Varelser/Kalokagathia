// Minimal tests for scripts/bench-harness.mjs (Phase DA1).
// Plain Node, no test framework — same style as relay/test_limiter.mjs.
// Run: node scripts/bench-harness.test.mjs   (from the project root)

import { canonicalize, stateHash, percentile, computeStats, generateSamples, buildRunRecord } from './bench-harness.mjs';

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// ---- canonicalisation / state hash ---------------------------------------
{
  const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } };
  const b = { a: { c: 'x', d: [3, { y: 2, z: 1 }] }, b: 1 };
  check('canonicalize sorts keys recursively', JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b)));
  check('stateHash equal for key-order-only difference', stateHash(a) === stateHash(b));
  check('stateHash differs when a value changes', stateHash(a) !== stateHash({ ...a, b: 2 }));
  check('stateHash is 64-hex sha256', /^[0-9a-f]{64}$/.test(stateHash(a)), stateHash(a));
}

// ---- percentile / stats ----------------------------------------------------
{
  const sorted = Array.from({ length: 101 }, (_, i) => i); // 0..100
  check('percentile p50 of 0..100 = 50', percentile(sorted, 50) === 50);
  check('percentile p99 of 0..100 = 99', percentile(sorted, 99) === 99);

  const flat = computeStats(new Array(200).fill(10));
  check('flat samples: mean=p50=p99=max=10', flat.frameMs.mean === 10 && flat.frameMs.p50 === 10 && flat.frameMs.p99 === 10 && flat.frameMs.max === 10);
  check('flat samples: cliff ratios are 1', flat.cliff.p99OverMean === 1 && flat.cliff.p99OverP50 === 1);

  const spiky = computeStats([...new Array(90).fill(10), ...new Array(9).fill(20), 100]);
  check('spiky samples: p99OverMean > 1', spiky.cliff.p99OverMean > 1, `p99/mean=${spiky.cliff.p99OverMean}`);
  check('spiky samples: max recorded', spiky.frameMs.max === 100);
  check('count preserved', spiky.count === 100);
}

// ---- generation determinism -------------------------------------------------
{
  const s1 = generateSamples({ seed: 42, frames: 50 });
  const s2 = generateSamples({ seed: 42, frames: 50 });
  const s3 = generateSamples({ seed: 43, frames: 50 });
  check('same seed → identical samples', JSON.stringify(s1) === JSON.stringify(s2));
  check('different seed → different samples', JSON.stringify(s1) !== JSON.stringify(s3));
  check('generated samples are positive finite numbers', s1.every((n) => Number.isFinite(n) && n > 0));
}

// ---- run record --------------------------------------------------------------
{
  const rec = buildRunRecord({
    samples: generateSamples({ seed: 1, frames: 120 }),
    samplesSource: 'generated(seed=1,frames=120)',
    state: { foo: 'bar' },
    stateSource: 'file:example.json',
    label: 'unit-test',
  });
  check('record kind/schema', rec.kind === 'kalokagathia-bench-run' && rec.schemaVersion === 1);
  check('record has env meta', typeof rec.env.node === 'string' && typeof rec.timestamp === 'string');
  check('record state hash matches stateHash()', rec.state.hash === stateHash({ foo: 'bar' }));
  check('record stats present', rec.frameMs.mean > 0 && rec.cliff.p99OverMean >= 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
