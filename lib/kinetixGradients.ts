/**
 * Kinetix colour data (Kinetix integration B2).
 *
 * The gradient presets and stage backgrounds below carry the exact
 * values from Kinetix Particle Studio's COLOR_GRADIENTS /
 * STAGE_BACKGROUNDS tables (parameter values re-implemented, not code
 * copied — see KINETIX_INTEGRATION_MAP §8). They feed the opt-in
 * "Kinetix Color" gradient system: nothing here changes the default
 * monochrome look until a user enables the gradient or picks a stage
 * background.
 */
import * as THREE from 'three';

export interface KinetixGradientPreset {
  id: string;
  name: string;
  start: string;
  mid: string;
  end: string;
}

export const KINETIX_COLOR_GRADIENTS: KinetixGradientPreset[] = [
  { id: 'nebula', name: 'Nebula Silk', start: '#e0f2fe', mid: '#38bdf8', end: '#8b5cf6' },
  { id: 'solaris', name: 'Solaris Flare', start: '#fff7ed', mid: '#fb923c', end: '#dc2626' },
  { id: 'aurora', name: 'Aurora Borealis', start: '#ecfeff', mid: '#2dd4bf', end: '#2563eb' },
  { id: 'plasma', name: 'Plasma Rose', start: '#fdf2f8', mid: '#f472b6', end: '#6366f1' },
  { id: 'golddust', name: 'Gilded Dust', start: '#fefce8', mid: '#facc15', end: '#92400e' },
  { id: 'emerald', name: 'Cyber Emerald', start: '#f0fdf4', mid: '#34d399', end: '#065f46' },
  { id: 'inferno', name: 'Inferno Magma', start: '#fef08a', mid: '#ef4444', end: '#4c0519' },
  { id: 'arctic', name: 'Arctic Ice', start: '#ffffff', mid: '#bae6fd', end: '#1e3a8a' },
  { id: 'ultraviolet', name: 'Ultraviolet', start: '#fae8ff', mid: '#c084fc', end: '#312e81' },
  { id: 'sumie', name: 'Sumi Ink', start: '#0f172a', mid: '#334155', end: '#94a3b8' },
];

export interface KinetixStageBackground {
  id: string;
  name: string;
  hex: string;
  /** Tone the backgroundColor logic should follow while this hex is
   *  active: dark stages keep the 'black' tone (additive-friendly),
   *  the paper stage follows the 'white' tone like legacy white
   *  backgrounds do. */
  tone: 'black' | 'white';
}

export const KINETIX_STAGE_BACKGROUNDS: KinetixStageBackground[] = [
  { id: 'obsidian', name: 'Obsidian', hex: '#07090d', tone: 'black' },
  { id: 'void', name: 'Pure Black', hex: '#000000', tone: 'black' },
  { id: 'abyss', name: 'Deep Navy', hex: '#060c1a', tone: 'black' },
  { id: 'plum', name: 'Nebula Plum', hex: '#120817', tone: 'black' },
  { id: 'paper', name: 'Studio Light', hex: '#edf0f5', tone: 'white' },
];

export function getKinetixGradientPreset(id: string): KinetixGradientPreset | undefined {
  return KINETIX_COLOR_GRADIENTS.find((g) => g.id === id);
}

/** Width of the gradient lookup texture baked for the point shader. */
export const GRADIENT_LUT_SIZE = 256;

/**
 * Fill `data` (GRADIENT_LUT_SIZE * 4 RGBA bytes) with the 3-stop
 * gradient: start -> mid over the first half, mid -> end over the
 * second, matching Kinetix's two-segment lerp of colorStart/colorMid/
 * colorEnd. Colours go through THREE.Color like every other colour in
 * the GPGPU draw path (setStyle on uniforms), so the LUT lives in the
 * same working colour space as uColor / uAgeColorYoung.
 */
export function fillGradientLutData(data: Uint8Array, start: string, mid: string, end: string): void {
  const a = new THREE.Color(start);
  const b = new THREE.Color(mid);
  const c = new THREE.Color(end);
  const tmp = new THREE.Color();
  for (let i = 0; i < GRADIENT_LUT_SIZE; i++) {
    const t = i / (GRADIENT_LUT_SIZE - 1);
    if (t < 0.5) tmp.copy(a).lerp(b, t * 2);
    else tmp.copy(b).lerp(c, (t - 0.5) * 2);
    const o = i * 4;
    data[o] = Math.round(THREE.MathUtils.clamp(tmp.r, 0, 1) * 255);
    data[o + 1] = Math.round(THREE.MathUtils.clamp(tmp.g, 0, 1) * 255);
    data[o + 2] = Math.round(THREE.MathUtils.clamp(tmp.b, 0, 1) * 255);
    data[o + 3] = 255;
  }
}

interface GradientStop {
  pos: number;
  color: THREE.Color;
}

function fillGradientLutFromStops(data: Uint8Array, stops: GradientStop[]): void {
  const tmp = new THREE.Color();
  for (let i = 0; i < GRADIENT_LUT_SIZE; i++) {
    const t = i / (GRADIENT_LUT_SIZE - 1);
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1].pos) s++;
    const a = stops[s];
    const b = stops[s + 1];
    const f = b.pos > a.pos ? (t - a.pos) / (b.pos - a.pos) : 0;
    tmp.copy(a.color).lerp(b.color, Math.min(1, Math.max(0, f)));
    const o = i * 4;
    data[o] = Math.round(THREE.MathUtils.clamp(tmp.r, 0, 1) * 255);
    data[o + 1] = Math.round(THREE.MathUtils.clamp(tmp.g, 0, 1) * 255);
    data[o + 2] = Math.round(THREE.MathUtils.clamp(tmp.b, 0, 1) * 255);
    data[o + 3] = 255;
  }
}

/**
 * Fill `data` with the 5-stop gradient (Phase AH): start at 0,
 * quarter at 0.25, mid at 0.5, threeQuarter at 0.75, end at 1,
 * piecewise-linear between stops. Pure apart from THREE.Color
 * parsing, so the interpolation is unit-testable.
 */
export function fillGradientLutData5(
  data: Uint8Array,
  start: string,
  quarter: string,
  mid: string,
  threeQuarter: string,
  end: string,
): void {
  fillGradientLutFromStops(data, [
    { pos: 0, color: new THREE.Color(start) },
    { pos: 0.25, color: new THREE.Color(quarter) },
    { pos: 0.5, color: new THREE.Color(mid) },
    { pos: 0.75, color: new THREE.Color(threeQuarter) },
    { pos: 1, color: new THREE.Color(end) },
  ]);
}

/**
 * Resolve the extra-stop positions (Phase AW): the quarter stop
 * lives in the first half, the three-quarter stop in the second,
 * each clamped away from the segment ends so the stop list stays
 * strictly increasing. The defaults (0.25 / 0.75) pass through
 * unchanged, so default configs resolve to the Phase AH layout.
 */
export function resolveGradientStopPositions(
  quarterPos?: number,
  threeQuarterPos?: number,
): { quarterPos: number; threeQuarterPos: number } {
  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    quarterPos: clamp(quarterPos as number, 0.02, 0.48, 0.25),
    threeQuarterPos: clamp(threeQuarterPos as number, 0.52, 0.98, 0.75),
  };
}

/**
 * Fill with the optional extra stops (Phase AH): an empty-string
 * stop is "unspecified". When BOTH extra stops are unspecified
 * this calls the legacy 3-stop fill verbatim, so the LUT stays
 * bit-identical; with one or both specified it builds the stop
 * list (start / [quarter] / mid / [threeQuarter] / end) and fills
 * piecewise-linearly. The extra stops sit at the Phase AW
 * positions (defaults 0.25 / 0.75 = the Phase AH layout).
 */
export function fillGradientLutDataAuto(
  data: Uint8Array,
  start: string,
  mid: string,
  end: string,
  quarter?: string,
  threeQuarter?: string,
  quarterPos?: number,
  threeQuarterPos?: number,
): void {
  const q = typeof quarter === 'string' && quarter.trim() !== '' ? quarter : null;
  const tq = typeof threeQuarter === 'string' && threeQuarter.trim() !== '' ? threeQuarter : null;
  if (!q && !tq) {
    fillGradientLutData(data, start, mid, end);
    return;
  }
  const pos = resolveGradientStopPositions(quarterPos, threeQuarterPos);
  const stops: GradientStop[] = [{ pos: 0, color: new THREE.Color(start) }];
  if (q) stops.push({ pos: pos.quarterPos, color: new THREE.Color(q) });
  stops.push({ pos: 0.5, color: new THREE.Color(mid) });
  if (tq) stops.push({ pos: pos.threeQuarterPos, color: new THREE.Color(tq) });
  stops.push({ pos: 1, color: new THREE.Color(end) });
  fillGradientLutFromStops(data, stops);
}

/** Create the LUT texture the draw shader samples (LinearFilter so the
 *  two segments blend smoothly; ClampToEdge on both axes). */
export function createGradientLutTexture(start: string, mid: string, end: string, quarter?: string, threeQuarter?: string, quarterPos?: number, threeQuarterPos?: number): THREE.DataTexture {
  const data = new Uint8Array(GRADIENT_LUT_SIZE * 4);
  fillGradientLutDataAuto(data, start, mid, end, quarter, threeQuarter, quarterPos, threeQuarterPos);
  const tex = new THREE.DataTexture(data, GRADIENT_LUT_SIZE, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** One stop of the arbitrary stop list (Phase BE): a position in
 *  [0, 1] and the colour string as held in the config. */
export interface GradientStopSpec {
  pos: number;
  color: string;
}

/** Maximum number of stops the arbitrary list may carry. */
const GRADIENT_STOP_LIST_MAX = 16;

/**
 * Resolve the arbitrary stop list (Phase BE) from the parallel
 * config arrays. Returns the normalised stop list, or null when the
 * pair does not resolve — different lengths, or fewer than two valid
 * pairs — in which case the ramp falls back to the legacy keys.
 * Normalisation: pairs whose position is not a finite number or
 * whose colour is not a non-empty string are dropped, positions are
 * clamped to [0, 1] and sorted ascending, the list is capped at
 * GRADIENT_STOP_LIST_MAX entries, and the first / last positions are
 * pinned to 0 / 1 (the list describes the whole ramp).
 */
export function resolveGradientStopsList(
  positions?: readonly number[] | null,
  colors?: readonly string[] | null,
): GradientStopSpec[] | null {
  if (!Array.isArray(positions) || !Array.isArray(colors) || positions.length !== colors.length) return null;
  const pairs: GradientStopSpec[] = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const color = colors[i];
    if (typeof pos !== 'number' || !Number.isFinite(pos)) continue;
    if (typeof color !== 'string' || color.trim() === '') continue;
    pairs.push({ pos: Math.min(1, Math.max(0, pos)), color });
  }
  if (pairs.length < 2) return null;
  pairs.sort((a, b) => a.pos - b.pos);
  const trimmed = pairs.slice(0, GRADIENT_STOP_LIST_MAX);
  trimmed[0] = { ...trimmed[0], pos: 0 };
  trimmed[trimmed.length - 1] = { ...trimmed[trimmed.length - 1], pos: 1 };
  return trimmed;
}

/**
 * The stop list the legacy keys imply (Phase BE): start at 0, the
 * optional quarter / three-quarter stops at their resolved (Phase
 * AW) positions, mid at 0.5, end at 1. Mirrors the stop construction
 * inside fillGradientLutDataAuto exactly, so a LUT filled from this
 * list is byte-identical to the legacy path. Used to seed the list
 * editor in the UI.
 */
export function legacyGradientStopsList(
  start: string,
  mid: string,
  end: string,
  quarter?: string,
  threeQuarter?: string,
  quarterPos?: number,
  threeQuarterPos?: number,
): GradientStopSpec[] {
  const q = typeof quarter === 'string' && quarter.trim() !== '' ? quarter : null;
  const tq = typeof threeQuarter === 'string' && threeQuarter.trim() !== '' ? threeQuarter : null;
  const pos = resolveGradientStopPositions(quarterPos, threeQuarterPos);
  const stops: GradientStopSpec[] = [{ pos: 0, color: start }];
  if (q) stops.push({ pos: pos.quarterPos, color: q });
  stops.push({ pos: 0.5, color: mid });
  if (tq) stops.push({ pos: pos.threeQuarterPos, color: tq });
  stops.push({ pos: 1, color: end });
  return stops;
}

/**
 * Fill with the arbitrary stop list when it resolves (Phase BE);
 * otherwise call fillGradientLutDataAuto verbatim, so an empty (or
 * unresolvable) list keeps the legacy LUT bit-identical.
 */
export function fillGradientLutDataResolved(
  data: Uint8Array,
  start: string,
  mid: string,
  end: string,
  quarter?: string,
  threeQuarter?: string,
  quarterPos?: number,
  threeQuarterPos?: number,
  stopPositions?: readonly number[] | null,
  stopColors?: readonly string[] | null,
): void {
  const list = resolveGradientStopsList(stopPositions, stopColors);
  if (!list) {
    fillGradientLutDataAuto(data, start, mid, end, quarter, threeQuarter, quarterPos, threeQuarterPos);
    return;
  }
  fillGradientLutFromStops(data, list.map((s) => ({ pos: s.pos, color: new THREE.Color(s.color) })));
}

/** Resolved variant of createGradientLutTexture (Phase BE): same
 *  texture settings, filled through fillGradientLutDataResolved. */
export function createGradientLutTextureResolved(
  start: string,
  mid: string,
  end: string,
  quarter?: string,
  threeQuarter?: string,
  quarterPos?: number,
  threeQuarterPos?: number,
  stopPositions?: readonly number[] | null,
  stopColors?: readonly string[] | null,
): THREE.DataTexture {
  const data = new Uint8Array(GRADIENT_LUT_SIZE * 4);
  fillGradientLutDataResolved(data, start, mid, end, quarter, threeQuarter, quarterPos, threeQuarterPos, stopPositions, stopColors);
  const tex = new THREE.DataTexture(data, GRADIENT_LUT_SIZE, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Serialise the stop-list arrays for the LUT rebake key (Phase BE):
 *  positions at 4 decimal places, colours verbatim. */
export function gradientStopsLutKey(
  stopPositions?: readonly number[] | null,
  stopColors?: readonly string[] | null,
): string {
  if (!Array.isArray(stopPositions) || !Array.isArray(stopColors)) return '';
  return stopPositions.map((p, i) => `${Number(p).toFixed(4)}:${stopColors[i] ?? ''}`).join(',');
}
