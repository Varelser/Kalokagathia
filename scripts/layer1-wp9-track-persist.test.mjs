#!/usr/bin/env node
// layer1-wp9-track-persist.test.mjs — Layer 1 WP9 phase C: the
// sequence tracks and the modulation setup become config keys
// (`sequenceTracks` / `modulationSetup`, JSON strings, default ''),
// so they travel with presets/projects instead of living only in
// localStorage performance state.
//
// Decided discipline (option (c) + sentinel, 2 keys only):
// - '' (or a non-string) = not authored: the localStorage-backed
//   store applies, exactly as before.
// - Any non-empty string is authoritative; the sentinel is the
//   RAW string judged before parsing, so the valid empty authored
//   forms ('[]' / '{}') block the local set from reviving.
// - No migration code. Editors write the config key; the first
//   edit promotes the edited set into the work.
// - Validation reuses sanitizeSequenceTracks / sanitizeSetup.
//
// Pins (the phase-C invariants):
// (1) key '' + localStorage empty -> the effective config path is
//     the legacy one: resolution returns the fallback untouched
//     and the apply engines return the config object itself.
// (2) the apply engines never write the base config: inputs are
//     not mutated (frozen bases survive), overrides land on a copy.
// (3) broken JSON degrades through the existing sanitize layer to
//     empty / default and never throws.
// (4) apply order and conditions are unchanged: source pins on
//     useAppSceneTemporalConfig (modulation before tracks; tracks
//     only while a sequence plays; modulation only when enabled),
//     plus the engines' own identity behaviour when inactive.
// (5) resolution is deterministic: same inputs, same result.
// (6) sentinel: with '[]' / '{}' authored, localStorage values
//     have no effect at all; a non-empty authored value wins too.
// (+) key registration: both keys default to '' in DEFAULT_CONFIG
//     and normalizeConfig passes authored strings through verbatim.
// (+) editor wiring: the three editing surfaces write the config
//     keys (source pins) and no longer call the store setters.
//     (第45期統合: Play tab のチェックは編集経路に限定した。
//     製品側の TD §7 face 4 の同梱行は対象外 — 下記参照。)
//
// Run: node scripts/layer1-wp9-track-persist.test.mjs

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
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, platform: 'node', format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const ST = await load('lib/sequenceTracks.ts');
const MO = await load('lib/modulation.ts');
const DEF = await load('lib/appStateConfigDefaults.ts');
const NORM = await load('lib/appStateConfigNormalization.ts');

const DEFAULT_CONFIG = DEF.DEFAULT_CONFIG;

const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

const trackSet = [
  {
    id: 't1',
    key: 'cameraDistance',
    keyframes: [
      { time: 0, value: 1000, easing: 'linear' },
      { time: 10, value: 2000, easing: 'linear' },
    ],
  },
];
const setupSet = {
  enabled: true,
  lfos: [0, 1, 2, 3].map(() => ({ waveform: 'sine', rate: 0.5 })),
  routes: [{ id: 'r1', source: { kind: 'lfo', index: 0 }, target: 'gpgpuBoidsAlignment', depth: 0.3, lag: 0 }],
};

// ---- (+) key registration ----------------------------------------------
check('keys: DEFAULT_CONFIG carries both keys as empty strings',
  DEFAULT_CONFIG.sequenceTracks === '' && DEFAULT_CONFIG.modulationSetup === '');
check('keys: normalizeConfig({}) keeps both keys empty',
  NORM.normalizeConfig({}).sequenceTracks === '' && NORM.normalizeConfig({}).modulationSetup === '');
check('keys: normalizeConfig passes authored strings through verbatim',
  NORM.normalizeConfig({ sequenceTracks: '[]' }).sequenceTracks === '[]'
  && NORM.normalizeConfig({ modulationSetup: '{}' }).modulationSetup === '{}');

// ---- (1) legacy identity when nothing is authored or stored ------------
{
  const storage = makeStorage();
  const storedTracks = ST.loadSequenceTracks(storage);
  const storedSetup = MO.loadModulationSetup(storage);
  check('1: empty storage loads the empty track set and the default setup',
    storedTracks.length === 0 && storedSetup.enabled === false && storedSetup.routes.length === 0);
  check('1: resolution with key "" returns the fallback itself (reference identity)',
    ST.resolveSequenceTracks('', storedTracks) === storedTracks
    && MO.resolveModulationSetup('', storedSetup) === storedSetup);
  check('1: resolution with an absent key returns the fallback itself',
    ST.resolveSequenceTracks(undefined, storedTracks) === storedTracks
    && MO.resolveModulationSetup(undefined, storedSetup) === storedSetup);
  check('1: applySequenceTracks with the empty set returns the config itself',
    ST.applySequenceTracks(DEFAULT_CONFIG, storedTracks, 5) === DEFAULT_CONFIG);
  check('1: applyModulation with the default (disabled) setup returns the config itself',
    MO.applyModulation(DEFAULT_CONFIG, storedSetup, 0, undefined) === DEFAULT_CONFIG);
}

// ---- (2) apply engines never write the base config ----------------------
{
  const base = Object.freeze({ ...DEFAULT_CONFIG, cameraDistance: 500, gpgpuBoidsAlignment: 1.0 });
  const out = ST.applySequenceTracks(base, ST.sanitizeSequenceTracks(trackSet), 5);
  check('2: track overrides land on a copy (midpoint value 1500), base untouched',
    out !== base && out.cameraDistance === 1500 && base.cameraDistance === 500);

  const exprSetup = {
    enabled: true,
    lfos: setupSet.lfos,
    routes: [{ id: 'r1', source: { kind: 'expr', text: 'p_gpgpuboidscohesion', input: { kind: 'lfo', index: 0 } }, target: 'gpgpuBoidsAlignment', depth: 1 }],
  };
  const base2 = Object.freeze({ ...DEFAULT_CONFIG, gpgpuBoidsCohesion: 3.75, gpgpuBoidsAlignment: 1.0 });
  const out2 = MO.applyModulation(base2, exprSetup, 0, undefined);
  check('2: modulation overrides land on a copy, frozen base untouched',
    out2 !== base2 && Math.abs(out2.gpgpuBoidsAlignment - 2.25) < 1e-6 && base2.gpgpuBoidsAlignment === 1.0);
}

// ---- (3) broken JSON degrades, never throws ------------------------------
check('3: broken track JSON parses to the empty set (authored, not null)',
  Array.isArray(ST.parseSequenceTracksConfigValue('{broken')) && ST.parseSequenceTracksConfigValue('{broken').length === 0);
check('3: non-array track JSON degrades to the empty set',
  ST.parseSequenceTracksConfigValue('{"x":1}').length === 0 && ST.parseSequenceTracksConfigValue('42').length === 0);
check('3: broken setup JSON parses to the default setup (authored, not null)',
  (() => {
    const parsed = MO.parseModulationSetupConfigValue('{broken');
    return parsed !== null && parsed.enabled === false && parsed.routes.length === 0 && parsed.lfos.length === 4;
  })());
check('3: malformed setup fields degrade field by field without throwing',
  (() => {
    const parsed = MO.parseModulationSetupConfigValue('{"enabled":"yes","routes":"junk","lfos":[null]}');
    return parsed !== null && parsed.enabled === false && parsed.routes.length === 0 && parsed.lfos.length === 4;
  })());
check('3: no authorship for empty / non-string values',
  ST.parseSequenceTracksConfigValue('') === null && ST.parseSequenceTracksConfigValue(undefined) === null
  && ST.parseSequenceTracksConfigValue(42) === null
  && MO.parseModulationSetupConfigValue('') === null && MO.parseModulationSetupConfigValue(null) === null);

// ---- (4) apply order / conditions (engines + source pins) ----------------
check('4: applyModulation returns the config itself when disabled or routeless',
  MO.applyModulation(DEFAULT_CONFIG, { ...setupSet, enabled: false }, 0, undefined) === DEFAULT_CONFIG
  && MO.applyModulation(DEFAULT_CONFIG, { ...setupSet, routes: [] }, 0, undefined) === DEFAULT_CONFIG);
{
  const temporal = readFileSync(join(ROOT, 'components/useAppSceneTemporalConfig.ts'), 'utf8');
  check('4: scene hook applies modulation before sequence tracks',
    temporal.indexOf('applyModulation(') >= 0
    && temporal.indexOf('applyModulation(') < temporal.indexOf('applySequenceTracks('));
  check('4: scene hook keeps the apply conditions (playing + enabled / sequence playing)',
    temporal.includes('modulationActive && isPlaying') && temporal.includes('isSequencePlaying && sequenceTracks.length > 0'));
  check('4: scene hook reads the resolved (config-first) values',
    temporal.includes('useResolvedModulationSetup(config.modulationSetup)')
    && temporal.includes('useResolvedSequenceTracks(config.sequenceTracks)'));
}

// ---- (5) deterministic resolution ----------------------------------------
{
  const storage = makeStorage();
  ST.saveSequenceTracks(storage, ST.sanitizeSequenceTracks(trackSet));
  MO.saveModulationSetup(storage, setupSet);
  const storedTracks = ST.loadSequenceTracks(storage);
  const storedSetup = MO.loadModulationSetup(storage);
  const authoredTracks = JSON.stringify([{
    id: 'a1', key: 'cameraDistance',
    keyframes: [{ time: 0, value: 3000, easing: 'linear' }],
  }]);
  check('5: same inputs resolve to the same track set, twice',
    deepEqual(ST.resolveSequenceTracks(authoredTracks, storedTracks), ST.resolveSequenceTracks(authoredTracks, storedTracks)));
  check('5: same inputs resolve to the same setup, twice',
    deepEqual(MO.resolveModulationSetup('{}', storedSetup), MO.resolveModulationSetup('{}', storedSetup)));
  check('5: fallback resolution is stable across calls',
    deepEqual(ST.resolveSequenceTracks('', storedTracks), storedTracks)
    && deepEqual(MO.resolveModulationSetup('', storedSetup), storedSetup));
}

// ---- (6) sentinel: authored emptiness blocks localStorage -----------------
{
  const storage = makeStorage();
  ST.saveSequenceTracks(storage, ST.sanitizeSequenceTracks(trackSet));
  MO.saveModulationSetup(storage, setupSet);
  const storedTracks = ST.loadSequenceTracks(storage);
  const storedSetup = MO.loadModulationSetup(storage);
  check('6: storage really holds the local sets (precondition)',
    storedTracks.length === 1 && storedSetup.enabled === true && storedSetup.routes.length === 1);
  check('6: authored "[]" wins over the stored track set',
    ST.resolveSequenceTracks('[]', storedTracks).length === 0);
  check('6: authored "{}" wins over the stored setup',
    (() => {
      const resolved = MO.resolveModulationSetup('{}', storedSetup);
      return resolved.enabled === false && resolved.routes.length === 0;
    })());
  check('6: a non-empty authored track set wins over the stored one',
    (() => {
      const authored = JSON.stringify([{
        id: 'a1', key: 'cameraDistance',
        keyframes: [{ time: 0, value: 3000, easing: 'linear' }],
      }]);
      const resolved = ST.resolveSequenceTracks(authored, storedTracks);
      return resolved.length === 1 && resolved[0].keyframes[0].value === 3000;
    })());
  check('6: with "" the stored sets apply again (fallback intact)',
    ST.resolveSequenceTracks('', storedTracks).length === 1
    && MO.resolveModulationSetup('', storedSetup).routes.length === 1);
}

// ---- (+) round trips: serialize -> parse, and first-edit promotion --------
{
  const sanitizedTracks = ST.sanitizeSequenceTracks(trackSet);
  check('rt: track serialize/parse round-trips the sanitized set',
    deepEqual(ST.parseSequenceTracksConfigValue(ST.serializeSequenceTracks(sanitizedTracks)), sanitizedTracks));
  const sanitizedSetup = MO.parseModulationSetupConfigValue(JSON.stringify(setupSet));
  check('rt: setup serialize/parse round-trips the sanitized setup',
    deepEqual(MO.parseModulationSetupConfigValue(MO.serializeModulationSetup(sanitizedSetup)), sanitizedSetup));
  check('rt: serializing the stored fallback promotes the same values into the key',
    deepEqual(ST.parseSequenceTracksConfigValue(ST.serializeSequenceTracks(sanitizedTracks)), sanitizedTracks)
    && MO.parseModulationSetupConfigValue(MO.serializeModulationSetup(setupSet)).routes.length === 1);
  check('rt: serializing the empty set yields the sentinel form "[]"',
    ST.serializeSequenceTracks([]) === '[]');
}

// ---- (+) editor wiring (source pins) ---------------------------------------
{
  const tracksPanel = readFileSync(join(ROOT, 'components/controlPanelSequenceTracks.tsx'), 'utf8');
  const playStage = readFileSync(join(ROOT, 'components/controlPanelPlayTabStage.tsx'), 'utf8');
  const custom = readFileSync(join(ROOT, 'components/controlPanelGlobalDisplayGpgpuForcesCustom.tsx'), 'utf8');
  check('wiring: tracks panel writes the config key and never the store setter',
    tracksPanel.includes("updateConfig('sequenceTracks', serializeSequenceTracks") && !tracksPanel.includes('setSequenceTracks('));
  // 第45期統合: the invariant is rescoped to the EDIT path.
  // WP9 Phase C's rule is that editing writes the config key
  // (first-edit promotion) — in this component every edit
  // funnels through the single `update` function, pinned
  // below. The product's TD §7 face 4 carry row (the
  // modulationGraph 同梱 row) is NOT an editing surface: its
  // "同梱をこのブラウザに読み込む" button is an explicit
  // import action whose purpose is to write the carried
  // setup into this browser's store (it also writes through
  // `update`), so the file-wide "never the store setter"
  // form cannot apply to it. The second check pins the
  // store setter to exactly that one call site.
  check('wiring: Play tab modulation editor writes the config key through its update path',
    playStage.includes("const update = (next: ModulationSetup) => updateConfig('modulationSetup', serializeModulationSetup(next));"));
  check('wiring: Play tab store setter is called only by the modulationGraph carry row (TD §7 face 4)',
    playStage.split('setModulationSetup(').length - 1 === 1
    && playStage.includes('setModulationSetup(carriedSetup);'));
  check('wiring: Simple LFO block writes the config key and never the store setter',
    custom.includes("updateConfig('modulationSetup', serializeModulationSetup") && !custom.includes('setModulationSetup('));
}

console.log(`layer1-wp9-track-persist: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
