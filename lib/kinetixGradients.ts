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
 * Fill with the optional extra stops (Phase AH): an empty-string
 * stop is "unspecified". When BOTH extra stops are unspecified
 * this calls the legacy 3-stop fill verbatim, so the LUT stays
 * bit-identical; with one or both specified it builds the stop
 * list (start / [quarter] / mid / [threeQuarter] / end) and fills
 * piecewise-linearly.
 */
export function fillGradientLutDataAuto(
  data: Uint8Array,
  start: string,
  mid: string,
  end: string,
  quarter?: string,
  threeQuarter?: string,
): void {
  const q = typeof quarter === 'string' && quarter.trim() !== '' ? quarter : null;
  const tq = typeof threeQuarter === 'string' && threeQuarter.trim() !== '' ? threeQuarter : null;
  if (!q && !tq) {
    fillGradientLutData(data, start, mid, end);
    return;
  }
  const stops: GradientStop[] = [{ pos: 0, color: new THREE.Color(start) }];
  if (q) stops.push({ pos: 0.25, color: new THREE.Color(q) });
  stops.push({ pos: 0.5, color: new THREE.Color(mid) });
  if (tq) stops.push({ pos: 0.75, color: new THREE.Color(tq) });
  stops.push({ pos: 1, color: new THREE.Color(end) });
  fillGradientLutFromStops(data, stops);
}

/** Create the LUT texture the draw shader samples (LinearFilter so the
 *  two segments blend smoothly; ClampToEdge on both axes). */
export function createGradientLutTexture(start: string, mid: string, end: string, quarter?: string, threeQuarter?: string): THREE.DataTexture {
  const data = new Uint8Array(GRADIENT_LUT_SIZE * 4);
  fillGradientLutDataAuto(data, start, mid, end, quarter, threeQuarter);
  const tex = new THREE.DataTexture(data, GRADIENT_LUT_SIZE, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
