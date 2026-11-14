// Kiosk mode (ultimate Wave 5): an unattended exhibition mode for
// installations and care settings.
//
// URL form:
//   /?kiosk=1            canvas only, auto-rotating presets (attract loop)
//   /?kiosk=1#p=<id>     same, starting from the shared preset
//
// Detection mirrors lib/embedMode.ts: a plain query-param read at boot;
// the query never changes during a session (exiting kiosk navigates to
// the same URL minus the param, in the same tab). When BOTH ?embed=1
// and ?kiosk=1 are present, KIOSK TAKES PRECEDENCE — an exhibition
// terminal must never end up showing the embed player's control
// cluster just because an embed URL was reused.
//
// The rotation itself lives in lib/useKioskMode.ts. It deliberately
// does NOT drive the shared sequence-playback state machine
// (useSequencePlayback): that state is persisted to IndexedDB /
// localStorage, so installing exhibition pacing (20–30s holds) into it
// would corrupt the visitor's own saved sequence. Instead the kiosk
// hook reuses the sequence system's pieces — PresetSequenceItem,
// getSequenceItemResolvedConfig and the applyConfigMorph transition
// engine (the exact verb sequence advance uses) — behind a private
// timer, leaving all persisted state untouched.

import type { PresetSequenceItem } from '../types';

export const KIOSK_MODE_PARAM = 'kiosk';
export const KIOSK_MODE_VALUE = '1';

/** Each preset in the default rotation is shown this long. */
export const KIOSK_HOLD_SECONDS = 25;
/** Morph duration into the next rotation preset. */
export const KIOSK_TRANSITION_SECONDS = 3;
/** Floor for user-sequence holds in kiosk: the visitor's own (often
 *  ~3s) step timing is performance pacing, not exhibition pacing, so
 *  shorter holds are lifted to this; longer holds are respected. */
export const KIOSK_MIN_HOLD_SECONDS = 20;
/** How many presets the default rotation draws from the starter
 *  sequence (spread evenly across it, so families/chunks rotate). */
export const KIOSK_ROTATION_SIZE = 10;
/** Idle time after the last interaction before the rotation resumes. */
export const KIOSK_RESUME_DELAY_MS = 60_000;
/** How long the exit hint stays visible after pointer movement. */
export const KIOSK_HINT_VISIBLE_MS = 3_000;

export function isKioskMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(KIOSK_MODE_PARAM) === KIOSK_MODE_VALUE;
  } catch {
    return false;
  }
}

/** Same-tab URL with the kiosk param removed (hash and any other query
 *  params preserved), used by the exit affordance. Navigating there
 *  reloads the app in normal mode with all persisted state untouched. */
export function buildKioskExitUrl(loc: Location): string {
  const url = new URL(loc.href);
  url.searchParams.delete(KIOSK_MODE_PARAM);
  return url.toString();
}

function kioskItem(base: PresetSequenceItem, holdSeconds: number): PresetSequenceItem {
  return {
    ...base,
    id: `kiosk-${base.id}`,
    holdSeconds,
    transitionSeconds: KIOSK_TRANSITION_SECONDS,
    transitionEasing: 'ease-in-out',
    keyframeConfig: base.keyframeConfig ?? null,
  };
}

/**
 * Build the exhibition rotation.
 *
 * Source preference (decided by the caller, which knows the library):
 *  - `userSequence`: the visitor's own preset sequence, when one
 *    exists. Order, labels, keyframes and transitions are kept; only
 *    the hold is floored to KIOSK_MIN_HOLD_SECONDS.
 *  - otherwise the default rotation: KIOSK_ROTATION_SIZE items spread
 *    evenly across `starterSequence` (the starter library's curated
 *    sequence, which is itself ordered across the library's families),
 *    each held KIOSK_HOLD_SECONDS.
 *
 * Items whose preset is not in `availablePresetIds` are dropped (a
 * generated-collection id, for instance, only resolves after a catalog
 * fetch the kiosk never performs). Returns [] when nothing is
 * resolvable yet — the caller retries once the library arrives.
 *
 * To curate the default rotation by hand, replace the spread pick
 * below with an explicit preset-id list; this function is the single
 * place the default list is built.
 */
export function buildKioskRotation(args: {
  userSequence: PresetSequenceItem[] | null;
  starterSequence: PresetSequenceItem[];
  availablePresetIds: Set<string>;
}): PresetSequenceItem[] {
  const { userSequence, starterSequence, availablePresetIds } = args;
  const resolvable = (item: PresetSequenceItem) => (
    Boolean(item.keyframeConfig) || availablePresetIds.has(item.presetId)
  );

  if (userSequence && userSequence.length > 0) {
    return userSequence
      .filter(resolvable)
      .map((item) => kioskItem(item, Math.max(item.holdSeconds, KIOSK_MIN_HOLD_SECONDS)));
  }

  const pool = starterSequence.filter(resolvable);
  if (pool.length === 0) return [];
  const count = Math.min(KIOSK_ROTATION_SIZE, pool.length);
  const picked: PresetSequenceItem[] = [];
  const seenPresets = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    // Even spread across the whole starter sequence (index 0 included,
    // last item included when count == pool.length).
    const item = pool[Math.floor((i * pool.length) / count)];
    if (!item || seenPresets.has(item.presetId)) continue;
    seenPresets.add(item.presetId);
    picked.push(kioskItem(item, KIOSK_HOLD_SECONDS));
  }
  return picked;
}
