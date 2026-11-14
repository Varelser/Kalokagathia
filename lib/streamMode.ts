// Stream mode (Phase 8): a pure-picture player for OBS Browser
// Sources and other live compositors.
//
// URL forms:
//   /?stream=1#p=<presetId>          transparent background (alpha)
//   /?stream=1#c=<payload>           same, inline config snapshot
//   /?stream=1                       the default scene, transparent
//   /?stream=1&bg=key#p=<presetId>   chroma-key variant: solid pure
//                                    green background, full PostFx
//   /?stream=1&bg=black#p=<presetId> solid black background, full PostFx
//
// Detection mirrors lib/embedMode.ts / lib/kioskMode.ts: plain
// query-param reads at boot; the query never changes during a session.
// Precedence when several mode params are present: KIOSK > STREAM >
// EMBED (App checks kiosk first, then stream, then embed) — an
// exhibition terminal outranks a stream overlay, which outranks the
// iframe player because a stream surface must never grow the embed
// player's control cluster.
//
// WHY TRANSPARENT MEANS "NO PostFx": the app's custom post passes
// hard-code opaque alpha (components/feedbackPass.ts,
// kaleidoscopePass.ts, slitScanPass.ts all emit `vec4(rgb, 1.0)`),
// and a scene background colour clears the composer's buffer at
// alpha 1. No configuration of the EffectComposer chain can therefore
// deliver a usable alpha matte, so the transparent variant renders
// the scene directly: renderer created with alpha:true, clear alpha
// 0, no scene background attached, PostFx never mounted. Effects that
// live INSIDE the scene (screen overlay, fog tint, fullscreen layer
// content some presets draw) are scene content, not background — they
// still render, over the transparent matte. The bg=key / bg=black
// variants keep the full PostFx chain over a solid, keyable colour.

export const STREAM_MODE_PARAM = 'stream';
export const STREAM_MODE_VALUE = '1';
export const STREAM_BG_PARAM = 'bg';

/** Chroma-key green: pure (0, 255, 0), the colour OBS's Chroma Key
 *  filter expects by default and the least likely to appear in the
 *  (monochrome-first) scene content. */
export const STREAM_KEY_COLOR = '#00ff00';
export const STREAM_BLACK_COLOR = '#000000';

export type StreamBackground =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string; name: 'key' | 'black' };

const TRANSPARENT: StreamBackground = { kind: 'transparent' };

export function isStreamMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(STREAM_MODE_PARAM) === STREAM_MODE_VALUE;
  } catch {
    return false;
  }
}

/** The stream background variant from the URL. Unknown / absent `bg`
 *  values fall back to transparent — the headline behaviour of the
 *  mode — rather than failing the overlay. */
export function getStreamBackground(): StreamBackground {
  if (typeof window === 'undefined') return TRANSPARENT;
  try {
    const bg = new URLSearchParams(window.location.search).get(STREAM_BG_PARAM);
    if (bg === 'key') return { kind: 'solid', color: STREAM_KEY_COLOR, name: 'key' };
    if (bg === 'black') return { kind: 'solid', color: STREAM_BLACK_COLOR, name: 'black' };
    return TRANSPARENT;
  } catch {
    return TRANSPARENT;
  }
}

/** App URL for the stream player: origin + /?stream=1 (+ optional
 *  &bg=…) + a share hash ('#p=…' or '#c=…', as produced by the share
 *  flow in ControlPanel). */
export function buildStreamUrl(origin: string, shareHash: string, bg?: 'key' | 'black'): string {
  const bgPart = bg ? `&${STREAM_BG_PARAM}=${bg}` : '';
  return `${origin}/?${STREAM_MODE_PARAM}=${STREAM_MODE_VALUE}${bgPart}${shareHash}`;
}
