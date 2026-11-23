// Phase 18 stage 4 — event rules + synth noteOnOnce + steering prep.
// Identity: with no rules stored the evaluator returns no actions,
// and noteOnOnce with audio disabled touches nothing, so every
// legacy path is unchanged. Steering checks are hand-computed.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18s4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (v, x, y, z, eps = 1e-9) => near(v.x, x, eps) && near(v.y, y, eps) && near(v.z, z, eps);

await build({
  stdin: {
    contents: `
      export { validateEventRule, validateEventRules, parseEventRulesData, serializeEventRules, loadEventRules, saveEventRules, evaluateEventRules, eventRuleMatches, dispatchEventRuleActions, EVENT_RULES_STORAGE_KEY } from './lib/eventRules.ts';
      export { seekForce, arriveForce, pathFollowTarget, pathFollowForce, stateFromSlot, steeringForState } from './lib/steering.ts';
      export { triggerSynthNoteOnce, performSynthNoteAction } from './lib/audioSynth.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  // lib/audioSynth.ts pulls lib/appState.ts, whose library-scope
  // constant is a vite define in the app build.
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { validateEventRule, validateEventRules, parseEventRulesData, serializeEventRules, loadEventRules, saveEventRules, evaluateEventRules, dispatchEventRuleActions, EVENT_RULES_STORAGE_KEY } = lib;
const { seekForce, arriveForce, pathFollowTarget, stateFromSlot, steeringForState } = lib;
const { triggerSynthNoteOnce } = lib;

const rule = (over = {}) => ({ id: 'r1', event: 'beat', actions: [{ type: 'synth-note', note: 60 }], ...over });

// --- validation ---------------------------------------------------
{
  check('valid rule accepted', validateEventRule(rule())?.id === 'r1');
  check('valid rule with condition accepted', validateEventRule(rule({ condition: 'vel > 0.5' })) !== null);
  check('broken condition rejected', validateEventRule(rule({ condition: 'vel >>' })) === null);
  check('unknown variable in condition rejected', validateEventRule(rule({ condition: 'bogus > 1' })) === null);
  check('unknown action rejected', validateEventRule(rule({ actions: [{ type: 'explode' }] })) === null);
  check('unknown event rejected', validateEventRule(rule({ event: 'explosion' })) === null);
  check('empty actions rejected', validateEventRule(rule({ actions: [] })) === null);
  check('bad id rejected', validateEventRule(rule({ id: 'has space!' })) === null);
  check('broken rule dropped, good rules survive', validateEventRules([rule(), rule({ id: 'bad', condition: 'nope(' }), rule({ id: 'r2', event: 'midi-note' })]).map((r) => r.id).join(',') === 'r1,r2');
  check('duplicate id dropped', validateEventRules([rule(), rule()]).length === 1);
  check('non-array rules -> empty', validateEventRules('x').length === 0 && parseEventRulesData('{oops').length === 0);
  check('action fields clamped', (() => { const a = validateEventRule(rule({ actions: [{ type: 'synth-note', note: 999, gain: 5, durationSec: 99 }] })).actions[0]; return a.note === 127 && a.gain === 1 && a.durationSec === 2; })());
}

// --- evaluator ------------------------------------------------------
{
  check('no rules -> no actions (legacy identity)', evaluateEventRules([], { type: 'beat' }).length === 0);
  check('condition true fires', evaluateEventRules([rule({ condition: 'vel > 0.5' })], { type: 'beat' }, { vel: 0.8 }).length === 1);
  check('condition false does not fire', evaluateEventRules([rule({ condition: 'vel > 0.5' })], { type: 'beat' }, { vel: 0.2 }).length === 0);
  check('sim vars in condition (vel/age/rad/slot)', evaluateEventRules([rule({ condition: '(age >= 0.5) * (rad < 1) * (slot2 > 0.25)' })], { type: 'beat' }, { age: 0.5, rad: 0.5, slots: [0, 0, 0.5] }).length === 1);
  check('x and t in condition', evaluateEventRules([rule({ condition: '(t >= 2) * (x > 0.1)' })], { type: 'beat' }, { t: 3, x: 0.5 }).length === 1);
  check('event type mismatch does not fire', evaluateEventRules([rule()], { type: 'midi-note', note: 60 }).length === 0);
  check('midi-note note filter', evaluateEventRules([rule({ event: 'midi-note', note: 64 })], { type: 'midi-note', note: 60 }).length === 0
    && evaluateEventRules([rule({ event: 'midi-note', note: 64 })], { type: 'midi-note', note: 64 }).length === 1);
  check('disabled rule does not fire', evaluateEventRules([rule({ enabled: false })], { type: 'beat' }).length === 0);
  check('multiple rules keep rule+action order', (() => {
    const rules = [rule({ id: 'a', actions: [{ type: 'synth-note', note: 60 }, { type: 'synth-note', note: 62 }] }), rule({ id: 'b', actions: [{ type: 'synth-note', note: 64 }] })];
    return evaluateEventRules(rules, { type: 'beat' }).map((a) => a.note).join(',') === '60,62,64';
  })());
  check('non-finite condition result does not fire', evaluateEventRules([rule({ condition: '1 / (vel - vel)' })], { type: 'beat' }, { vel: 1 }).length === 0);
  let dispatched = 0;
  dispatchEventRuleActions(evaluateEventRules([rule()], { type: 'beat' }), { synthNote: () => { dispatched += 1; } });
  check('dispatch routes synth-note actions', dispatched === 1);
}

// --- persistence round-trip (mock storage) --------------------------
{
  const store = new Map();
  const mock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  check('empty storage -> no rules', loadEventRules(mock).length === 0 && loadEventRules(undefined).length === 0);
  const rules = [rule(), rule({ id: 'r2', event: 'pattern-boundary', condition: 'step == 0', actions: [{ type: 'synth-note', semitoneOffset: 7, gain: 0.5 }] })];
  saveEventRules(mock, rules);
  check('save writes the storage key', store.has(EVENT_RULES_STORAGE_KEY));
  const loaded = loadEventRules(mock);
  check('round-trip preserves rules', JSON.stringify(loaded) === JSON.stringify(validateEventRules(rules)), JSON.stringify(loaded));
  store.set(EVENT_RULES_STORAGE_KEY, '{corrupt');
  check('corrupt stored data -> no rules', loadEventRules(mock).length === 0);
  store.set(EVENT_RULES_STORAGE_KEY, JSON.stringify([rule({ condition: 'bad expr!!' }), rule({ id: 'ok' })]));
  check('stored broken rule dropped, valid kept', loadEventRules(mock).map((r) => r.id).join(',') === 'ok');
  check('serialize empty -> empty string', serializeEventRules([]) === '');
}

// --- synth noteOnOnce (fake engine) ---------------------------------
{
  const makeFake = () => {
    const calls = [];
    const param = (name) => ({
      setTargetAtTime: (v) => calls.push([name, v]),
      setValueAtTime: (v) => calls.push([name, v]),
      cancelScheduledValues: () => calls.push([name, 'cancel']),
      linearRampToValueAtTime: (v) => calls.push([name, v]),
      exponentialRampToValueAtTime: (v) => calls.push([name, v]),
    });
    return {
      calls,
      synth: {
        context: { currentTime: 10 },
        mainOsc: { type: '', frequency: param('mainFreq') },
        subOsc: { type: '', frequency: param('subFreq') },
        filter: { frequency: param('filterFreq'), Q: param('filterQ') },
        noteGain: { gain: param('noteGain') },
        masterGain: { gain: param('masterGain') },
        stepTimer: null, currentStep: 5,
      },
    };
  };
  const cfg = { audioEnabled: true, synthWaveform: 'sawtooth', synthVolume: 0.18, synthCutoff: 1200, synthPatternDepth: 0.65, synthBaseFrequency: 110 };
  const f1 = makeFake();
  check('noteOnOnce fires when audio enabled', triggerSynthNoteOnce(f1.synth, cfg, { midiNote: 69 }) === true);
  check('noteOnOnce midi 69 = 440Hz main / 220Hz sub', f1.calls.some((c) => c[0] === 'mainFreq' && near(c[1], 440)) && f1.calls.some((c) => c[0] === 'subFreq' && near(c[1], 220)), JSON.stringify(f1.calls));
  check('noteOnOnce does not advance sequencer step', f1.synth.currentStep === 5);
  const f2 = makeFake();
  check('noteOnOnce silent when audio disabled', triggerSynthNoteOnce(f2.synth, { ...cfg, audioEnabled: false }, { midiNote: 69 }) === false && f2.calls.length === 0);
  check('noteOnOnce silent without engine', triggerSynthNoteOnce(null, cfg, { midiNote: 69 }) === false);
  const f3 = makeFake();
  triggerSynthNoteOnce(f3.synth, cfg, { semitoneOffset: 12 });
  check('noteOnOnce semitone +12 = 2x base (220Hz)', f3.calls.some((c) => c[0] === 'mainFreq' && near(c[1], 220)));
}

// --- steering: seek / arrive hand calculations ----------------------
{
  // pos origin, vel 0, target (10,0,0), maxSpeed 4 -> desired (4,0,0)
  check('seek frontal', vecNear(seekForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 4), 4, 0, 0));
  // sideways: target (0,10,0), vel (1,0,0) -> desired (0,4,0) - vel = (-1,4,0)
  check('seek sideways subtracts velocity', vecNear(seekForce({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }, 4), -1, 4, 0));
  // diagonal 3-4-5: target (3,4,0), maxSpeed 5 -> desired (3,4,0)
  check('seek diagonal 3-4-5', vecNear(seekForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, 5), 3, 4, 0));
  // maxForce clamp: desired (4,0,0) clamped to length 2
  check('seek maxForce clamp', vecNear(seekForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 4, 2), 2, 0, 0));
  // at target: desired 0 -> steer = -vel
  check('seek at target brakes', vecNear(seekForce({ x: 5, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }, { x: 5, y: 0, z: 0 }, 4), -1, -2, 0));
  // arrive outside radius == seek
  check('arrive outside radius == seek', vecNear(arriveForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 4, 5), 4, 0, 0));
  // arrive inside: distance 2.5 of radius 5 -> speed 4 * 0.5 = 2
  check('arrive inside radius slows (half)', vecNear(arriveForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }, 4, 5), 2, 0, 0));
  // arrive close: distance 0.5 -> speed 0.4; minus vel (0.4,0,0) -> 0
  check('arrive settles at matching speed', vecNear(arriveForce({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, 4, 5), 0, 0, 0));
}

// --- path following ---------------------------------------------------
{
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  // pos beside first segment at arc 2, lookAhead 3 -> (5,0)
  check('pathFollow straight ahead', (() => { const t = pathFollowTarget(path, { x: 2, y: 1, z: 0 }, 3); return near(t.x, 5) && near(t.y, 0); })());
  // pos at arc 9, lookAhead 3 crosses the corner -> (10,2)
  check('pathFollow around corner', (() => { const t = pathFollowTarget(path, { x: 9, y: -1, z: 0 }, 3); return near(t.x, 10) && near(t.y, 2); })());
  // lookAhead beyond end clamps to final point
  check('pathFollow clamps at end', (() => { const t = pathFollowTarget(path, { x: 9, y: 0, z: 0 }, 100); return near(t.x, 10) && near(t.y, 10); })());
  // no lookAhead = closest point itself (projection, not vertex)
  check('pathFollow zero lookAhead = projection', (() => { const t = pathFollowTarget(path, { x: 4, y: 3, z: 0 }, 0); return near(t.x, 4) && near(t.y, 0); })());
  check('pathFollow empty path returns pos', (() => { const t = pathFollowTarget([], { x: 1, y: 2, z: 3 }, 5); return t.x === 1 && t.y === 2 && t.z === 3; })());
}

// --- two-state --------------------------------------------------------
{
  check('state below threshold = 0', stateFromSlot(0.49) === 0);
  check('state at threshold = 1', stateFromSlot(0.5) === 1);
  check('state above threshold = 1', stateFromSlot(0.9) === 1);
  check('state custom threshold', stateFromSlot(0.3, 0.25) === 1 && stateFromSlot(0.2, 0.25) === 0);
  check('state non-finite = 0', stateFromSlot(NaN) === 0);
  const opts = { target0: { x: 10, y: 0, z: 0 }, target1: { x: 0, y: 10, z: 0 }, maxSpeed: 4, slowingRadius: 5 };
  // state 0 (slot 0.2): seek target0 -> (4,0,0)
  check('steeringForState state0 seeks target0', vecNear(steeringForState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.2, opts), 4, 0, 0));
  // state 1 (slot 0.8): arrive target1 at distance 10 (outside radius 5) -> (0,4,0)
  check('steeringForState state1 arrives target1', vecNear(steeringForState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.8, opts), 0, 4, 0));
  // state 1 close to target1: pos (0,8,0) distance 2 inside radius -> speed 4*2/5=1.6
  check('steeringForState state1 slows near target', vecNear(steeringForState({ x: 0, y: 8, z: 0 }, { x: 0, y: 0, z: 0 }, 0.8, opts), 0, 1.6, 0));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
