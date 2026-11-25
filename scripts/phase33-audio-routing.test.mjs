// Phase 33 (TD §7 stage 1) — Audio routing graph.
// Core identity: the default graph, resolved through
// lib/audioRouting.ts, must produce bit-identical inputs to
// the legacy fixed wiring that used to be inline in
// applyParticleAudioUniforms (reference copy below), across
// randomised levels and gains. Non-default graphs must change
// the wiring in the expected direction, and malformed stored
// data must fall back to the default graph.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p33-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { AUDIO_ROUTING_OUTPUTS, AUDIO_ROUTING_REGISTERS, defaultAudioRoutingGraph, isDefaultAudioRoutingGraph, parseAudioRoutingGraph, serializeAudioRoutingGraph, resolveAudioRoutingGraph, resolveAudioRoutingInputs } from './lib/audioRouting.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  AUDIO_ROUTING_OUTPUTS, AUDIO_ROUTING_REGISTERS, defaultAudioRoutingGraph,
  isDefaultAudioRoutingGraph, parseAudioRoutingGraph, serializeAudioRoutingGraph,
  resolveAudioRoutingGraph, resolveAudioRoutingInputs,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// --- reference: the legacy inline formulas (pre-Phase-33 code) ---
function legacyInputs(levels, config) {
  const bassInput = levels.bass * config.audioBeatScale;
  const trebleInput = levels.treble * config.audioJitterScale;
  const pulseInput = levels.pulse * config.audioPulseScale;
  const morphInput = levels.pulse * config.audioMorphScale;
  const shatterInput = (trebleInput * 0.75 + pulseInput * 0.35) * config.audioShatterScale;
  const twistInput = (bassInput * 0.6 + pulseInput * 0.9) * config.audioTwistScale;
  const bendInput = (trebleInput * 0.55 + pulseInput * 0.7) * config.audioBendScale;
  const warpInput = (bassInput * 0.35 + trebleInput * 0.35 + pulseInput) * config.audioWarpScale;
  return {
    bass: bassInput, treble: trebleInput, pulse: pulseInput, morph: morphInput,
    shatter: shatterInput, twist: twistInput, bend: bendInput, warp: warpInput,
    bandA: levels.bandA, bandB: levels.bandB,
  };
}

// Deterministic PRNG (mulberry32) so the sweep is reproducible.
let seed = 123456789;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const baseConfig = {
  audioBeatScale: 0.5, audioJitterScale: 0.5, audioPulseScale: 1.35,
  audioMorphScale: 1.1, audioShatterScale: 1.2, audioTwistScale: 1.2,
  audioBendScale: 1.1, audioWarpScale: 1.25,
};

// --- structure ---------------------------------------------------
check('registers are 0..14 in order', AUDIO_ROUTING_REGISTERS.map((r) => r.register).join(',') === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14');
check('default graph is recognised as default', isDefaultAudioRoutingGraph(defaultAudioRoutingGraph()));
check('default graph serialises to empty string', serializeAudioRoutingGraph(defaultAudioRoutingGraph()) === '');
check('empty stored text resolves to the default graph',
  JSON.stringify(resolveAudioRoutingGraph('')) === JSON.stringify(defaultAudioRoutingGraph()));

// --- identity: default graph === legacy formulas, bit-exact ------
{
  let exact = true;
  let worst = '';
  for (let i = 0; i < 2000; i += 1) {
    const levels = {
      bass: rnd() * 2 - 0.25, treble: rnd() * 2 - 0.25, pulse: rnd() * 2 - 0.25,
      bandA: rnd() * 2 - 0.25, bandB: rnd() * 2 - 0.25,
    };
    const config = { ...baseConfig };
    for (const k of Object.keys(config)) config[k] = rnd() * 4;
    const expected = legacyInputs(levels, config);
    const actual = resolveAudioRoutingInputs(defaultAudioRoutingGraph(), levels, config);
    for (const output of AUDIO_ROUTING_OUTPUTS) {
      if (!Object.is(actual[output.id], expected[output.id])) {
        exact = false;
        worst = `${output.id}: got ${actual[output.id]}, want ${expected[output.id]} (iter ${i})`;
        break;
      }
    }
    if (!exact) break;
  }
  check('default graph matches legacy formulas bit-exactly (2000 random cases)', exact, worst);
}

// --- non-default graphs change the wiring as expected ------------
{
  const levels = { bass: 0.8, treble: 0.4, pulse: 0.2, bandA: 0.1, bandB: 0.05 };
  const graph = parseAudioRoutingGraph(JSON.stringify({
    edges: { shatter: [{ from: 0, weight: 2 }] },
  }));
  const inputs = resolveAudioRoutingInputs(graph, levels, baseConfig);
  check('rewired shatter reads raw bass x2 x gain',
    Object.is(inputs.shatter, (0.8 * 2) * baseConfig.audioShatterScale), `got ${inputs.shatter}`);
  check('outputs absent from a stored graph resolve to 0',
    inputs.warp === 0 && inputs.morph === 0 && inputs.bass === 0);
  check('a non-default graph serialises back to itself',
    serializeAudioRoutingGraph(graph) === JSON.stringify({ edges: { shatter: [{ from: 0, weight: 2 }] } }));
  const cut = parseAudioRoutingGraph(JSON.stringify({ edges: { bass: [] } }));
  check('an output with an empty edge list is silent',
    resolveAudioRoutingInputs(cut, levels, baseConfig).bass === 0);
}

// --- validation / fallback ---------------------------------------
{
  const def = JSON.stringify(defaultAudioRoutingGraph());
  check('broken JSON falls back to default', JSON.stringify(parseAudioRoutingGraph('{oops')) === def);
  check('non-object JSON falls back to default', JSON.stringify(parseAudioRoutingGraph('[1,2]')) === def);
  check('missing edges object falls back to default', JSON.stringify(parseAudioRoutingGraph('{"x":1}')) === def);
  const guarded = parseAudioRoutingGraph(JSON.stringify({
    edges: {
      shatter: [
        { from: 9, weight: 1 },      // self reference: dropped
        { from: 12, weight: 1 },     // forward reference: dropped
        { from: 6, weight: 0.75 },   // valid
        { from: 6, weight: 0.5 },    // duplicate source: dropped
        { from: 7, weight: 99 },     // weight clamped to 4
        { from: -1, weight: 1 },     // out of range: dropped
        { from: 5, weight: 'x' },    // non-number weight: dropped
      ],
      bogus: [{ from: 0, weight: 1 }], // unknown output: ignored
    },
  }));
  check('invalid edges are dropped, valid ones kept in order',
    JSON.stringify(guarded.edges.shatter) === JSON.stringify([{ from: 6, weight: 0.75 }, { from: 7, weight: 4 }]),
    JSON.stringify(guarded.edges.shatter));
  check('unknown outputs do not appear in the parsed graph', !('bogus' in guarded.edges));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
