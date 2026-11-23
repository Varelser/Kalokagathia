/**
 * First-run tutorial (KCB4): pure step state machine + seen-flag storage.
 *
 * The tutorial is a first-visit-only, four-step card shown in a corner of
 * the screen. This module holds everything except rendering so the flow
 * can be unit-tested in plain Node (scripts/first-run-tutorial.test.mjs):
 *
 *   - step metadata (ids + titles, in display order)
 *   - the reducer: next / back / skip / finish / close
 *   - the localStorage seen flag: once set, the tutorial never shows
 *     again and the host component renders null, leaving the UI byte-
 *     and behaviour-identical to before the tutorial existed.
 *
 * Nothing here touches the app config or any persisted preset/sequence
 * data — the only storage write is the tutorial's own seen flag.
 */

export const FIRST_RUN_TUTORIAL_STORAGE_KEY = 'kalokagathia.tutorial.v1';
export const FIRST_RUN_TUTORIAL_SEEN_VALUE = '1';

export interface FirstRunTutorialStep {
  id: string;
  title: string;
}

export const FIRST_RUN_TUTORIAL_STEPS: readonly FirstRunTutorialStep[] = [
  { id: 'welcome', title: 'ようこそ' },
  { id: 'controls', title: '操作' },
  { id: 'custom-code', title: 'カスタムコード' },
  { id: 'gallery-export', title: 'ギャラリーと書き出し' },
];

export const FIRST_RUN_TUTORIAL_STEP_COUNT = FIRST_RUN_TUTORIAL_STEPS.length;

export interface FirstRunTutorialState {
  status: 'active' | 'done';
  stepIndex: number;
}

export type FirstRunTutorialAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  | { type: 'finish' }
  | { type: 'close' };

export const initialFirstRunTutorialState: FirstRunTutorialState = {
  status: 'active',
  stepIndex: 0,
};

export function isLastFirstRunTutorialStep(state: FirstRunTutorialState): boolean {
  return state.stepIndex >= FIRST_RUN_TUTORIAL_STEP_COUNT - 1;
}

/**
 * Pure transitions. `next` on the last step finishes the tutorial;
 * `skip`, `finish` and `close` all end it immediately. Once done, every
 * action is a no-op so late events (e.g. an Escape keydown racing the
 * close button) can never resurrect or mutate a finished state.
 */
export function firstRunTutorialReducer(
  state: FirstRunTutorialState,
  action: FirstRunTutorialAction,
): FirstRunTutorialState {
  if (state.status === 'done') return state;
  switch (action.type) {
    case 'next':
      return isLastFirstRunTutorialStep(state)
        ? { status: 'done', stepIndex: state.stepIndex }
        : { status: 'active', stepIndex: state.stepIndex + 1 };
    case 'back':
      return { status: 'active', stepIndex: Math.max(0, state.stepIndex - 1) };
    case 'skip':
    case 'finish':
    case 'close':
      return { status: 'done', stepIndex: state.stepIndex };
    default:
      return state;
  }
}

/** Minimal storage surface so tests can pass a fake instead of localStorage. */
export interface FirstRunTutorialStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * True when the tutorial must stay hidden: the seen flag is set, or
 * storage is unreadable (blocked cookies etc.) — in that case showing
 * the card on every load would be worse than never showing it.
 */
export function isFirstRunTutorialSeen(storage: FirstRunTutorialStorage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(FIRST_RUN_TUTORIAL_STORAGE_KEY) === FIRST_RUN_TUTORIAL_SEEN_VALUE;
  } catch {
    return true;
  }
}

export function shouldShowFirstRunTutorial(storage: FirstRunTutorialStorage | null): boolean {
  return !isFirstRunTutorialSeen(storage);
}

/** Persist the seen flag. Failures are swallowed: the card simply closes. */
export function markFirstRunTutorialSeen(storage: FirstRunTutorialStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(FIRST_RUN_TUTORIAL_STORAGE_KEY, FIRST_RUN_TUTORIAL_SEEN_VALUE);
  } catch {
    /* storage unavailable: nothing to persist */
  }
}

/** Browser storage accessor kept in one place (SSR / test safe). */
export function getFirstRunTutorialStorage(): FirstRunTutorialStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
