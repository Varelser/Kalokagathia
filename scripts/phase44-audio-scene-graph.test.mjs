// Phase 44 (TD §7 stage 2, Round 84 gap 5) — Audio scene graph.
// Core identity: the default scene graph, resolved through
// lib/audioSceneGraph.ts and composed the way each consumer
// composes it, must produce bit-identical values to the
// legacy direct formulas that used to be inline in the scene
// systems (reference copies below), across randomised levels
// and gains. Non-default graphs must change the wiring in the
// expected direction, and malformed stored data must fall
// back to the default graph.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p44-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { defaultAudioSceneGraph, isDefaultAudioSceneGraph, parseAudioSceneGraph, serializeAudioSceneGraph, resolveAudioSceneGraph, resolveAudioSceneOutputs, evaluateAudioSceneOutput, audioSceneOutputSum } from './lib/audioSceneGraph.ts';
      export { defaultAudioRoutingGraph, resolveAudioRoutingInputs } from './lib/audioRouting.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  defaultAudioSceneGraph, isDefaultAudioSceneGraph, parseAudioSceneGraph,
  serializeAudioSceneGraph, resolveAudioSceneGraph, resolveAudioSceneOutputs,
  audioSceneOutputSum,
  defaultAudioRoutingGraph, resolveAudioRoutingInputs,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// --- reference: the legacy direct formulas (pre-Phase-44 code) ---
const legacyBurst = (levels, c) => levels.pulse * c.audioBurstScale;
const legacyScreenPulse = (levels, c) => levels.pulse * c.audioScreenScale;
const legacyScreenTreble = (levels, c) => levels.treble * c.audioJitterScale * c.audioScreenScale;
const legacyCamera = (levels, c) => (levels.bass * c.audioBeatScale + levels.pulse * c.audioBurstScale * 0.65) * c.audioCameraScale;
const legacyHue = (levels, c) => (levels.bass * 0.35 + levels.treble * 0.2 + levels.pulse * 0.45) * c.audioHueShiftScale * 0.3;
const legacyLineBass = (levels, c) => (levels.bass * c.audioBeatScale) * c.audioLineScale;
const legacyLineTreble = (levels, c) => (levels.treble * c.audioJitterScale) * c.audioLineScale;
const legacyReactionDiffusion = (levels, c) => (levels.pulse * c.audioBurstScale + levels.bass * c.audioBeatScale * 0.5);

// Deterministic pseudo-random cases.
let seed = 1234567;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const KEY_SETS = [
  { audioBeatScale: 1, audioJitterScale: 1, audioPulseScale: 1, audioBurstScale: 1.15, audioScreenScale: 0.85, audioCameraScale: 1.15, audioHueShiftScale: 0, audioLineScale: 1.2, audioMorphScale: 1.1, audioShatterScale: 1, audioTwistScale: 1, audioBendScale: 1.1, audioWarpScale: 1.25 },
  { audioBeatScale: 0, audioJitterScale: 0, audioPulseScale: 0, audioBurstScale: 0, audioScreenScale: 0, audioCameraScale: 0, audioHueShiftScale: 0, audioLineScale: 0, audioMorphScale: 0, audioShatterScale: 0, audioTwistScale: 0, audioBendScale: 0, audioWarpScale: 0 },
  { audioBeatScale: 2.4, audioJitterScale: 1.7, audioPulseScale: 0.3, audioBurstScale: 3.1, audioScreenScale: 2.2, audioCameraScale: 0.45, audioHueShiftScale: 1.9, audioLineScale: 2.8, audioMorphScale: 0.9, audioShatterScale: 1.4, audioTwistScale: 0.2, audioBendScale: 1.6, audioWarpScale: 0.7 },
];

let identityMismatches = 0;
let firstMismatch = '';
for (let i = 0; i < 240; i += 1) {
  const levels = { bass: rnd() * 1.5, treble: rnd() * 1.5, pulse: rnd() * 1.5, bandA: rnd() * 1.5, bandB: rnd() * 1.5 };
  const config = { ...KEY_SETS[i % KEY_SETS.length], audioSceneGraph: '' };
  const graph = resolveAudioSceneGraph('');
  const stage1 = resolveAudioRoutingInputs(defaultAudioRoutingGraph(), levels, config);
  const out = resolveAudioSceneOutputs(graph, levels, stage1, config);
  const pairs = [
    ['burst', out.burst.sum * config.audioBurstScale, legacyBurst(levels, config)],
    ['screen.pulse', out.screen.parts.pulse * config.audioScreenScale, legacyScreenPulse(levels, config)],
    ['screen.treble', out.screen.parts.treble * config.audioScreenScale, legacyScreenTreble(levels, config)],
    ['camera', out.camera.sum * config.audioCameraScale, legacyCamera(levels, config)],
    ['hue', out.hue.sum * config.audioHueShiftScale * out.hue.coefficient, legacyHue(levels, config)],
    ['line.bass', out.line.parts.bass * config.audioLineScale, legacyLineBass(levels, config)],
    ['line.treble', out.line.parts.treble * config.audioLineScale, legacyLineTreble(levels, config)],
    ['rd', out.burst.sum * config.audioBurstScale + levels.bass * config.audioBeatScale * 0.5, legacyReactionDiffusion(levels, config)],
    ['helper.burst', audioSceneOutputSum(config, levels, 'burst') * config.audioBurstScale, legacyBurst(levels, config)],
  ];
  for (const [name, got, want] of pairs) {
    if (!Object.is(got, want)) {
      identityMismatches += 1;
      if (!firstMismatch) firstMismatch = `${name}: got ${got}, want ${want} (case ${i})`;
    }
  }
}
check('default graph is bit-identical to the legacy direct formulas (240 cases × 9 compositions)', identityMismatches === 0, firstMismatch);

// --- default handling ---
check("'' parses to the default graph", isDefaultAudioSceneGraph(parseAudioSceneGraph('')));
check('default graph serialises to \'\'', serializeAudioSceneGraph(defaultAudioSceneGraph()) === '');
check('resolve memo returns the same object for the same text', resolveAudioSceneGraph('') === resolveAudioSceneGraph(''));
check('garbage JSON falls back to the default graph', isDefaultAudioSceneGraph(parseAudioSceneGraph('{not json')));
check('non-object JSON falls back to the default graph', isDefaultAudioSceneGraph(parseAudioSceneGraph('[1,2]')));
check('missing outputs falls back to the default graph', isDefaultAudioSceneGraph(parseAudioSceneGraph('{"version":1}')));

// --- validation of individual edges ---
{
  const g = parseAudioSceneGraph(JSON.stringify({ version: 1, outputs: { burst: { edges: [
    { from: 'nope', weight: 1 },
    { from: 'bass', weightKey: 'notAKey' },
    { from: 'bass', weight: 0.5 },
    { from: 'bass', weight: 2 },
    { from: 'treble', weight: 'x' },
    { from: 'pulse', weight: 99 },
  ] } } }));
  const edges = g.outputs.burst?.edges ?? [];
  check('invalid edges are dropped, duplicates dropped, weights clamped',
    edges.length === 2 && edges[0].from === 'bass' && edges[0].weight === 0.5 && edges[1].from === 'pulse' && edges[1].weight === 4,
    JSON.stringify(edges));
}
{
  const g = parseAudioSceneGraph(JSON.stringify({ version: 1, outputs: { hue: { coefficient: 0.5, edges: [{ from: 'bass', weight: 1 }] } } }));
  check('coefficient survives parsing', g.outputs.hue?.coefficient === 0.5);
  const roundtrip = parseAudioSceneGraph(serializeAudioSceneGraph(g));
  check('serialise/parse roundtrip preserves a custom graph',
    JSON.stringify(roundtrip) === JSON.stringify(g), `${JSON.stringify(roundtrip)} vs ${JSON.stringify(g)}`);
}

// --- a custom graph changes the wiring as expected ---
{
  const config = { ...KEY_SETS[0], audioSceneGraph: '' };
  const levels = { bass: 0.8, treble: 0.1, pulse: 0.4, bandA: 0.2, bandB: 0.3 };
  const custom = parseAudioSceneGraph(JSON.stringify({ version: 1, outputs: {
    burst: { edges: [{ from: 'bass', weight: 2 }] },
    camera: { edges: [{ from: 'bandB', weightKey: 'audioPulseScale', weightScale: 0.5 }] },
  } }));
  const out = resolveAudioSceneOutputs(custom, levels, null, config);
  check('custom burst reads bass × 2', Object.is(out.burst.sum, levels.bass * 2), `${out.burst.sum}`);
  check('custom camera reads (bandB × pulseScale) × 0.5', Object.is(out.camera.sum, (levels.bandB * config.audioPulseScale) * 0.5), `${out.camera.sum}`);
  check('outputs absent from a custom graph are silent', out.screen.sum === 0 && out.hue.sum === 0 && out.line.sum === 0);
  check('custom graph is not the default', !isDefaultAudioSceneGraph(custom));
}

// --- line reads stage-1 inputs, not raw levels ---
{
  const config = { ...KEY_SETS[2], audioSceneGraph: '' };
  const levels = { bass: 0.7, treble: 0.6, pulse: 0.1, bandA: 0, bandB: 0 };
  const stage1 = resolveAudioRoutingInputs(defaultAudioRoutingGraph(), levels, config);
  const out = resolveAudioSceneOutputs(defaultAudioSceneGraph(), levels, stage1, config);
  check('line parts equal the stage-1 inputs at the default graphs',
    Object.is(out.line.parts.bass, stage1.bass) && Object.is(out.line.parts.treble, stage1.treble));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
