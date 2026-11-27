// Phase 45 (TD §7 face 4) — Modulation wiring carried in the config.
// The modulation setup used to be performance state in localStorage
// only: presets could not carry it. The modulationGraph config key
// carries a setup as JSON. Core identities pinned here:
//   - '' (and malformed data) resolves to the local setup, so every
//     existing preset behaves exactly as before the key existed.
//   - A carried setup wins over the local one, and applying the
//     resolved setup is identical to applying the carried setup.
//   - Serialisation is a stable round-trip through the sanitizer:
//     parse(serialize(x)) deep-equals the sanitized x, and the
//     default setup serialises to '' (untouched presets stay clean).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p45-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { applyModulation, createDefaultModulationSetup, createStarterModulationRoutes, parseModulationSetupJson, resolveModulationSetup, serializeModulationSetup } from './lib/modulation.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A representative non-default setup: starter routes + one chained
// expr route, engine on.
const starter = {
  enabled: true,
  lfos: [
    { waveform: 'sine', rate: 0.1 },
    { waveform: 'triangle', rate: 0.23 },
    { waveform: 'saw', rate: 0.05 },
    { waveform: 'drift', rate: 0.07 },
  ],
  routes: M.createStarterModulationRoutes(),
};
const localOff = M.createDefaultModulationSetup();

// M1: '' carries nothing — the local setup rules (identity).
check('M1 empty key resolves to the local setup',
  M.resolveModulationSetup('', starter) === starter
  && M.resolveModulationSetup('', localOff) === localOff);

// M2: malformed data also carries nothing.
check('M2 malformed JSON resolves to the local setup',
  M.parseModulationSetupJson('not json') === null
  && M.parseModulationSetupJson('42') === null
  && M.parseModulationSetupJson('[1,2]') === null
  && M.resolveModulationSetup('{"routes":', starter) === starter);

// M3: the default setup serialises to '' — untouched presets stay clean.
check('M3 default setup serialises to empty',
  M.serializeModulationSetup(localOff) === '',
  M.serializeModulationSetup(localOff));

// M4: round-trip — parse(serialize(x)) deep-equals the sanitized x,
// and serialising the parsed value again is a fixed point.
const json = M.serializeModulationSetup(starter);
const parsed = M.parseModulationSetupJson(json);
check('M4a starter setup serialises non-empty', json !== '');
check('M4b round-trip preserves the setup', parsed !== null && deepEqual(parsed.routes.map((r) => [r.source, r.target, r.depth]), starter.routes.map((r) => [r.source, r.target, r.depth])),
  parsed ? JSON.stringify(parsed.routes?.length) : 'null');
check('M4c serialise is a fixed point', parsed !== null && M.serializeModulationSetup(parsed) === json);

// M5: a carried setup wins over the local one.
const resolved = M.resolveModulationSetup(json, localOff);
check('M5 carried setup wins over local', resolved !== localOff && resolved.enabled === true && resolved.routes.length === starter.routes.length);

// M6: application identity — applying the resolved setup equals
// applying the carried setup directly, and differs from the base
// config when routes bite; with '' the local (disabled) setup
// leaves the config untouched (same reference).
const base = { layer2FlowSpeed: 1, layer2BaseSize: 10, layer3FlowSpeed: 1, layer3BaseSize: 10 };
const viaResolved = M.applyModulation({ ...base }, resolved, 0.37, undefined);
const viaCarried = M.applyModulation({ ...base }, parsed, 0.37, undefined);
check('M6a resolved application equals carried application', deepEqual(viaResolved, viaCarried),
  JSON.stringify([viaResolved, viaCarried]));
check('M6b carried wiring actually moves values', !deepEqual(viaResolved, base));
const viaEmpty = M.applyModulation(base, M.resolveModulationSetup('', localOff), 0.37, undefined);
check('M6c empty key + disabled local returns the config untouched', viaEmpty === base);

// M7: sanitizer discipline — routes to unknown targets are dropped,
// depths are clamped, unknown source kinds are dropped.
const dirty = JSON.stringify({
  enabled: true,
  lfos: [],
  routes: [
    { id: 'x', source: { kind: 'lfo', index: 0 }, target: 'noSuchKey', depth: 0.5 },
    { id: 'y', source: { kind: 'lfo', index: 1 }, target: 'layer2FlowSpeed', depth: 99 },
    { id: 'z', source: { kind: 'wat' }, target: 'layer2FlowSpeed', depth: 0.5 },
  ],
});
const cleaned = M.parseModulationSetupJson(dirty);
check('M7 sanitizer drops unknown targets/sources and clamps depth',
  cleaned !== null && cleaned.routes.length === 1 && cleaned.routes[0].depth === 1,
  JSON.stringify(cleaned?.routes));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
