// Minimal tests for components/firstRunTutorialMachine.ts (KCB4).
// Plain Node, no test framework — same style as scripts/bench-harness.test.mjs.
// The machine module is erasable-syntax TypeScript only, so Node's type
// stripping imports it directly.
// Run: node scripts/first-run-tutorial.test.mjs   (from the project root)

import {
  FIRST_RUN_TUTORIAL_SEEN_VALUE,
  FIRST_RUN_TUTORIAL_STEPS,
  FIRST_RUN_TUTORIAL_STEP_COUNT,
  FIRST_RUN_TUTORIAL_STORAGE_KEY,
  firstRunTutorialReducer,
  initialFirstRunTutorialState,
  isFirstRunTutorialSeen,
  isLastFirstRunTutorialStep,
  markFirstRunTutorialSeen,
  shouldShowFirstRunTutorial,
} from '../components/firstRunTutorialMachine.ts';

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    map,
  };
}

// ---- step metadata ---------------------------------------------------------
{
  check('exactly 4 steps', FIRST_RUN_TUTORIAL_STEP_COUNT === 4 && FIRST_RUN_TUTORIAL_STEPS.length === 4);
  check(
    'step order is welcome/controls/custom-code/gallery-export',
    FIRST_RUN_TUTORIAL_STEPS.map((s) => s.id).join(',') === 'welcome,controls,custom-code,gallery-export',
    FIRST_RUN_TUTORIAL_STEPS.map((s) => s.id).join(','),
  );
  check(
    'step titles are the planned four',
    FIRST_RUN_TUTORIAL_STEPS.map((s) => s.title).join(',') === 'ようこそ,操作,カスタムコード,ギャラリーと書き出し',
  );
}

// ---- forward / backward ------------------------------------------------------
{
  let s = initialFirstRunTutorialState;
  check('initial state: active at step 0', s.status === 'active' && s.stepIndex === 0);
  s = firstRunTutorialReducer(s, { type: 'next' });
  check('next advances to step 1', s.status === 'active' && s.stepIndex === 1);
  s = firstRunTutorialReducer(s, { type: 'next' });
  s = firstRunTutorialReducer(s, { type: 'back' });
  check('back returns to step 1', s.status === 'active' && s.stepIndex === 1);
  s = firstRunTutorialReducer(s, { type: 'back' });
  s = firstRunTutorialReducer(s, { type: 'back' });
  check('back clamps at step 0 (no negative, still active)', s.status === 'active' && s.stepIndex === 0);
}

// ---- finishing via next on the last step / explicit finish -------------------
{
  let s = initialFirstRunTutorialState;
  for (let i = 0; i < FIRST_RUN_TUTORIAL_STEP_COUNT - 1; i += 1) {
    s = firstRunTutorialReducer(s, { type: 'next' });
  }
  check('three nexts reach the last step, still active', s.status === 'active' && isLastFirstRunTutorialStep(s));
  s = firstRunTutorialReducer(s, { type: 'next' });
  check('next on the last step finishes', s.status === 'done');

  let t = { status: 'active', stepIndex: FIRST_RUN_TUTORIAL_STEP_COUNT - 1 };
  t = firstRunTutorialReducer(t, { type: 'finish' });
  check('finish on the last step finishes', t.status === 'done');
}

// ---- skip / close -------------------------------------------------------------
{
  const mid = { status: 'active', stepIndex: 2 };
  check('skip from a middle step finishes', firstRunTutorialReducer(mid, { type: 'skip' }).status === 'done');
  check('close from a middle step finishes', firstRunTutorialReducer(mid, { type: 'close' }).status === 'done');
  check('skip keeps the step index (no jump)', firstRunTutorialReducer(mid, { type: 'skip' }).stepIndex === 2);
}

// ---- done is terminal -----------------------------------------------------------
{
  const done = { status: 'done', stepIndex: 1 };
  check(
    'done state ignores next/back/skip',
    firstRunTutorialReducer(done, { type: 'next' }) === done
      && firstRunTutorialReducer(done, { type: 'back' }) === done
      && firstRunTutorialReducer(done, { type: 'skip' }) === done,
  );
}

// ---- seen flag: first visit shows, revisit hides --------------------------------
{
  const storage = fakeStorage();
  check('first visit (no flag): tutorial shows', shouldShowFirstRunTutorial(storage) === true);
  check('first visit (no flag): not seen', isFirstRunTutorialSeen(storage) === false);

  markFirstRunTutorialSeen(storage);
  check(
    'markSeen writes the seen value under the tutorial key',
    storage.map.get(FIRST_RUN_TUTORIAL_STORAGE_KEY) === FIRST_RUN_TUTORIAL_SEEN_VALUE,
  );
  check('revisit (flag set): tutorial hidden', shouldShowFirstRunTutorial(storage) === false);
  check('revisit (flag set): seen', isFirstRunTutorialSeen(storage) === true);

  const otherValue = fakeStorage({ [FIRST_RUN_TUTORIAL_STORAGE_KEY]: 'yes' });
  check('unrelated flag value does not count as seen', shouldShowFirstRunTutorial(otherValue) === true);
}

// ---- storage failure handling ------------------------------------------------------
{
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  check('unreadable storage suppresses the tutorial (no every-load popup)', shouldShowFirstRunTutorial(broken) === false);
  let threw = false;
  try { markFirstRunTutorialSeen(broken); } catch { threw = true; }
  check('markSeen on broken storage does not throw', threw === false);
  check('null storage suppresses the tutorial', shouldShowFirstRunTutorial(null) === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
