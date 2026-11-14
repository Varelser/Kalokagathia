// Embed mode (ultimate Wave 3): a preset player for external sites
// (note articles, blogs) via an <iframe>.
//
// URL form:
//   /?embed=1#p=<presetId>   play one preset, chrome-free
//   /?embed=1#c=<payload>    play an inline config snapshot
//   /?embed=1                the default scene
//
// The preset half is exactly the existing share-hash mechanism
// (lib/shareLink.ts: parseShareHash + the App share effect, including
// the starter-library resolution safeguard) — embed only changes what
// mounts around the canvas. Detection mirrors AppModeGate: a plain
// query-param read at boot; the query never changes during a session.

export const EMBED_MODE_PARAM = 'embed';
export const EMBED_MODE_VALUE = '1';

export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(EMBED_MODE_PARAM) === EMBED_MODE_VALUE;
  } catch {
    return false;
  }
}

/** App URL for the embed player: origin + /?embed=1 + a share hash
 *  ('#p=…' or '#c=…', as produced by the share flow in ControlPanel). */
export function buildEmbedUrl(origin: string, shareHash: string): string {
  return `${origin}/?${EMBED_MODE_PARAM}=${EMBED_MODE_VALUE}${shareHash}`;
}

/** The iframe snippet the share UI copies for the current scene. The
 *  size matches the snippet shape site owners paste into note/blog
 *  editors; allowfullscreen pairs with the player's fullscreen button
 *  (an iframe without it cannot enter fullscreen at all). */
export function buildEmbedSnippet(origin: string, shareHash: string): string {
  const src = buildEmbedUrl(origin, shareHash);
  return `<iframe src="${src}" width="800" height="450" style="border:0" loading="lazy" allowfullscreen></iframe>`;
}

/** Full-app URL for the embed player's credit link: same origin and the
 *  same share hash (so the full app opens on the same preset), minus
 *  the embed query. */
export function buildFullAppUrl(origin: string, shareHash: string): string {
  return `${origin}/${shareHash}`;
}
