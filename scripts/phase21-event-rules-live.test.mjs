// Phase 21 stage 2 — live wiring for midi-note and predicate rules.
// Identity: with no rules stored, fireEventRulesLive fires nothing
// and predicate transitions produce no actions; with no performer
// registered, live events are dropped, never queued.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p21s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const storageData = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storageData.has(k) ? storageData.get(k) : null),
    setItem: (k, v) => { storageData.set(k, String(v)); },
    removeItem: (k) => { storageData.delete(k); },
  },
  history: { replaceState: () => {} },
  location: { pathname: '/', search: '' },
};

await build({
  stdin: {
    contents: `
      export { saveEventRules, evaluatePredicateTransitions, setEventRuleActionPerformer, getEventRuleActionPerformer, fireEventRulesLive, createEventRule, validateEventRule, EVENT_RULES_STORAGE_KEY } from './lib/eventRules.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { saveEventRules, evaluatePredicateTransitions, setEventRuleActionPerformer, getEventRuleActionPerformer, fireEventRulesLive, createEventRule, validateEventRule, EVENT_RULES_STORAGE_KEY } = lib;

const storage = globalThis.window.localStorage;
const midiRule = { id: 'm1', event: 'midi-note', actions: [{ type: 'synth-note', note: 72 }] };
const midiRuleNote = { id: 'm2', event: 'midi-note', note: 60, actions: [{ type: 'synth-note', note: 65 }] };
const predRule = { id: 'p1', event: 'predicate', condition: 'step >= 4', actions: [{ type: 'synth-note', note: 50 }] };

// --- live MIDI firing ------------------------------------------------
{
  setEventRuleActionPerformer(null);
  saveEventRules(storage, [midiRule]);
  check('no performer: live event dropped (0 fired)', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60 }) === 0);

  const performed = [];
  setEventRuleActionPerformer((actions) => performed.push(...actions));
  check('matching midi-note rule fires', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60, velocity: 0.8 }) === 1 && performed[0]?.note === 72, JSON.stringify(performed));
  performed.length = 0;

  saveEventRules(storage, [midiRuleNote]);
  check('note-filtered rule fires on its note', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60 }) === 1 && performed[0]?.note === 65);
  performed.length = 0;
  check('note-filtered rule silent on other notes', fireEventRulesLive({ type: 'midi-note', note: 61 }, { note: 61 }) === 0 && performed.length === 0);

  saveEventRules(storage, [{ ...midiRule, condition: 'velocity > 0.5' }]);
  check('condition gates midi rule (soft velocity)', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60, velocity: 0.2 }) === 0);
  check('condition gates midi rule (hard velocity)', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60, velocity: 0.9 }) === 1);

  saveEventRules(storage, [{ ...midiRule, enabled: false }]);
  check('disabled rule never fires live', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60 }) === 0);

  storage.removeItem(EVENT_RULES_STORAGE_KEY);
  check('no rules stored: legacy identity (0 fired)', fireEventRulesLive({ type: 'midi-note', note: 60 }, { note: 60 }) === 0);
  setEventRuleActionPerformer(null);
  check('performer cleared', getEventRuleActionPerformer() === null);
}

// --- predicate rising edge -------------------------------------------
{
  let prev = new Map();
  let out = evaluatePredicateTransitions([predRule], { step: 2 }, prev);
  check('predicate false: no fire', out.actions.length === 0 && out.next.get('p1') === false);
  out = evaluatePredicateTransitions([predRule], { step: 4 }, out.next);
  check('predicate rising edge fires once', out.actions.length === 1 && out.actions[0].note === 50);
  out = evaluatePredicateTransitions([predRule], { step: 5 }, out.next);
  check('predicate held true: no refire', out.actions.length === 0 && out.next.get('p1') === true);
  out = evaluatePredicateTransitions([predRule], { step: 1 }, out.next);
  check('predicate falling edge: no fire, state resets', out.actions.length === 0 && out.next.get('p1') === false);
  out = evaluatePredicateTransitions([predRule], { step: 6 }, out.next);
  check('predicate second rising edge fires again', out.actions.length === 1);

  const noCond = { id: 'p2', event: 'predicate', actions: [{ type: 'synth-note', note: 51 }] };
  let o2 = evaluatePredicateTransitions([noCond], {}, new Map());
  check('conditionless predicate fires on first poll', o2.actions.length === 1);
  o2 = evaluatePredicateTransitions([noCond], {}, o2.next);
  check('conditionless predicate does not refire', o2.actions.length === 0);

  const mixed = evaluatePredicateTransitions([predRule, { id: 'b1', event: 'beat', actions: [{ type: 'synth-note' }] }], { step: 9 }, new Map());
  check('non-predicate rules ignored by transitions', mixed.actions.length === 1 && !mixed.next.has('b1'));

  const pruned = evaluatePredicateTransitions([], { step: 9 }, new Map([['p1', true]]));
  check('deleted rule pruned from truth state', pruned.next.size === 0 && pruned.actions.length === 0);

  check('no rules: transitions identity', evaluatePredicateTransitions([], { step: 9 }, new Map()).actions.length === 0);
}

// --- editor helpers ----------------------------------------------------
{
  const fresh = createEventRule('midi-note');
  check('createEventRule yields a valid rule', validateEventRule(fresh) !== null && fresh.event === 'midi-note' && fresh.enabled === true);
  const freshPred = createEventRule('predicate');
  check('createEventRule ids are unique', fresh.id !== freshPred.id);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
