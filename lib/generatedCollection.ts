// Lazy access to the GENERATED preset collection index.
//
// The 746 generated presets (2026-11-09..11 batches) live outside the app
// bundle as static files on the same origin (/presets/<id>.json,
// /catalog/thumbs/<id>.jpg, /share/<id>). Their records carry no genre or
// tag fields — only id, name, config, timestamps — so the shelf groups
// them by SERIES, derived from the id prefix. The compact index
// (public/generated-collection.json, built by
// scripts/build-generated-index.mjs, ~66 KB) is fetched on first use and
// cached for the session; preset configs themselves are fetched one at a
// time through the same /presets/<id>.json path share links use
// (fetchCatalogPreset in lib/shareLink.ts).

export interface GeneratedPresetEntry {
  id: string;
  name: string;
  series: string; // series key, e.g. 'coverage'
}

export interface GeneratedSeries {
  key: string;
  label: string;
}

// Display order + labels for the known series (brief order). Unknown
// prefixes are appended alphabetically by deriveGeneratedSeries().
const KNOWN_SERIES: GeneratedSeries[] = [
  { key: 'coverage', label: 'Coverage' },
  { key: 'ignition', label: 'Ignition' },
  { key: 'theory', label: 'Theory' },
  { key: 'lenia', label: 'Lenia' },
  { key: 'plife', label: 'Particle Life' },
  { key: 'dla', label: 'DLA' },
  { key: 'lsys', label: 'L-System' },
  { key: 'ray', label: 'Raymarch' },
  { key: 'raymarch', label: 'Raymarch' },
  { key: 'fft', label: 'Audio FFT' },
];

export const generatedSeriesLabel = (key: string): string =>
  KNOWN_SERIES.find((series) => series.key === key)?.label
  ?? (key.charAt(0).toUpperCase() + key.slice(1));

export function deriveGeneratedSeries(entries: GeneratedPresetEntry[]): GeneratedSeries[] {
  const present = new Set(entries.map((entry) => entry.series));
  const ordered = KNOWN_SERIES.filter((series) => present.has(series.key));
  const knownKeys = new Set(ordered.map((series) => series.key));
  [...present]
    .filter((key) => !knownKeys.has(key))
    .sort()
    .forEach((key) => ordered.push({ key, label: generatedSeriesLabel(key) }));
  return ordered;
}

interface GeneratedIndexPayload {
  v: number;
  count: number;
  presets: [string, string, string][];
}

let cachedIndex: GeneratedPresetEntry[] | null = null;
let indexPromise: Promise<GeneratedPresetEntry[] | null> | null = null;

/** Session-cached lazy load of the generated-collection index.
 *  Resolves null when the index is unreachable or malformed. */
export function loadGeneratedCollectionIndex(): Promise<GeneratedPresetEntry[] | null> {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (!indexPromise) {
    indexPromise = fetch('/generated-collection.json')
      .then((r) => ((r.headers.get('content-type') || '').includes('json') ? (r.json() as Promise<GeneratedIndexPayload>) : null))
      .then((payload) => {
        if (!payload || !Array.isArray(payload.presets)) return null;
        const entries: GeneratedPresetEntry[] = [];
        payload.presets.forEach((tuple) => {
          if (Array.isArray(tuple) && typeof tuple[0] === 'string' && typeof tuple[1] === 'string' && typeof tuple[2] === 'string') {
            entries.push({ id: tuple[0], name: tuple[1], series: tuple[2] });
          }
        });
        cachedIndex = entries;
        return entries;
      })
      .catch(() => null)
      .finally(() => {
        // Allow a retry after a failed load; a successful load stays
        // cached in cachedIndex above.
        if (!cachedIndex) indexPromise = null;
      });
  }
  return indexPromise;
}

let availabilityCache: boolean | null = null;

/** One-time probe: can this origin actually serve preset JSONs?
 *  A static preview without the presets/ dir answers /presets/* with the
 *  SPA shell (text/html), which this check detects — the same
 *  content-type test the share-link loader uses. Network errors count as
 *  unavailable. The result is cached for the session. */
export function probeGeneratedCollectionAvailable(sampleId: string): Promise<boolean> {
  if (availabilityCache !== null) return Promise.resolve(availabilityCache);
  return fetch(`/presets/${encodeURIComponent(sampleId)}.json`, { method: 'HEAD' })
    .then((r) => {
      availabilityCache = r.ok && (r.headers.get('content-type') || '').includes('json');
      return availabilityCache;
    })
    .catch(() => {
      availabilityCache = false;
      return false;
    });
}
