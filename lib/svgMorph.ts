/**
 * SVG import for the GPGPU morph system (Pro-2: logo / SVG emitter).
 *
 * Parses an SVG document (file upload or pasted text) with a small,
 * dependency-free parser and turns its geometry into a point cloud the
 * morph bake (lib/gpgpuMorphTargets.ts) can consume as the 'svg'
 * target. The flow mirrors the TextMap treatment: the SVG *source
 * text* lives in the config (gpgpuMorphSvgSource) so it persists with
 * projects and presets, and the point cloud is re-derived
 * deterministically at bake time — same source, same cloud.
 *
 * Supported geometry:
 *  - <path> with M / L / H / V / C / S / Q / T / A / Z, absolute and
 *    relative, multiple subpaths (compound logos: mark + letterforms).
 *  - <polygon> / <polyline> / <line> / <rect> / <circle> / <ellipse>
 *    converted to polylines (rect corner radius is ignored).
 *  - Element-level transform attributes (matrix / translate / scale /
 *    rotate / skewX / skewY), including transforms on enclosing
 *    <g> groups (nested groups compose outermost-first, per the SVG
 *    rendering model). Documents without <g> transforms sample
 *    exactly as before: the group matrix stays the identity and the
 *    composition is value-preserving.
 *  - viewBox normalisation when present; otherwise the geometry's own
 *    bounding box is used. Aspect ratio is always preserved and the
 *    SVG y-down axis is flipped to the morph space's y-up.
 *
 * Curves are flattened to dense polylines first, then the whole
 * geometry is resampled uniformly by arc length, so particle density
 * along a logo outline does not depend on how the author segmented
 * the paths. Filled regions are represented by their outlines only —
 * this is an emitter/morph outline cloud, not a fill rasteriser.
 */

/** Points sampled from an imported SVG (flat xy pairs, normalised). */
export const SVG_MORPH_SAMPLE_COUNT = 8192;

/** Bundled sample: a plain five-point star outline (original, no IP). */
export const SAMPLE_SVG_STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<path d="M 50 5 L 60.6 35.4 L 92.8 36.1 L 67.1 55.6 L 76.5 86.4 L 50 68 L 23.5 86.4 L 32.9 55.6 L 7.2 36.1 L 39.4 35.4 Z"/>' +
  '</svg>';

interface Pt {
  x: number;
  y: number;
}

type Mat = [number, number, number, number, number, number]; // a b c d e f

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function matApply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function parseTransform(attr: string | null): Mat {
  if (!attr) return IDENTITY;
  let result: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((v) => !Number.isFinite(v))) continue;
    let m: Mat = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) m = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case 'translate':
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        m = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Mat = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          m = matMul(matMul([1, 0, 0, 1, args[1], args[2]], rot), [1, 0, 0, 1, -args[1], -args[2]]);
        } else {
          m = rot;
        }
        break;
      }
      case 'skewX':
        m = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        m = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    result = matMul(result, m);
  }
  return result;
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`);
  const match = re.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function numAttr(tag: string, name: string, fallback = 0): number {
  const raw = getAttr(tag, name);
  const value = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Flatten a cubic Bézier into `out` (excluding the start point). */
function flattenCubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt): void {
  const approx =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.max(4, Math.min(64, Math.ceil(approx / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

/** Flatten a quadratic Bézier into `out` (excluding the start point). */
function flattenQuadratic(out: Pt[], p0: Pt, p1: Pt, p2: Pt): void {
  const approx = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const steps = Math.max(4, Math.min(48, Math.ceil(approx / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
}

/**
 * Flatten an elliptical arc (SVG endpoint parameterisation) into `out`.
 * Standard endpoint→center conversion (SVG 1.1 appendix F.6.5).
 */
function flattenArc(
  out: Pt[],
  from: Pt,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: Pt,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    out.push({ ...to });
    return;
  }
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const startAngle = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy) % (Math.PI * 2);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(4, Math.min(96, Math.ceil(Math.abs(delta) / (Math.PI / 16))));
  for (let i = 1; i <= steps; i++) {
    const t = startAngle + delta * (i / steps);
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push({
      x: cx + cosPhi * ex - sinPhi * ey,
      y: cy + sinPhi * ex + cosPhi * ey,
    });
  }
}

/** Parse one path `d` attribute into polylines (already flattened). */
function parsePathData(d: string): Pt[][] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(parseFloat(match[2]));
  }

  const polylines: Pt[][] = [];
  let current: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let prevCubicCtrl: Pt | null = null;
  let prevQuadCtrl: Pt | null = null;
  let cmd = '';
  let i = 0;

  const flush = () => {
    if (current.length > 1) polylines.push(current);
    current = [];
  };
  const nums = (n: number): number[] | null => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i + k];
      if (typeof v !== 'number') return null;
      out.push(v);
    }
    i += n;
    return out;
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      cmd = token;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        if (current.length > 0) {
          current.push({ ...start });
          cur = { ...start };
        }
        flush();
        prevCubicCtrl = null;
        prevQuadCtrl = null;
      }
      continue;
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        flush();
        cur = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        start = { ...cur };
        current = [{ ...cur }];
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        cur = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        current.push({ ...cur });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'H': {
        const v = nums(1);
        if (!v) { i = tokens.length; break; }
        cur = { x: rel ? cur.x + v[0] : v[0], y: cur.y };
        current.push({ ...cur });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'V': {
        const v = nums(1);
        if (!v) { i = tokens.length; break; }
        cur = { x: cur.x, y: rel ? cur.y + v[0] : v[0] };
        current.push({ ...cur });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'C': {
        const v = nums(6);
        if (!v) { i = tokens.length; break; }
        const p1 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p2 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        const p3 = rel ? { x: cur.x + v[4], y: cur.y + v[5] } : { x: v[4], y: v[5] };
        flattenCubic(current, cur, p1, p2, p3);
        prevCubicCtrl = p2;
        prevQuadCtrl = null;
        cur = p3;
        break;
      }
      case 'S': {
        const v = nums(4);
        if (!v) { i = tokens.length; break; }
        const p1: Pt = prevCubicCtrl
          ? { x: 2 * cur.x - prevCubicCtrl.x, y: 2 * cur.y - prevCubicCtrl.y }
          : { ...cur };
        const p2 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p3 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        flattenCubic(current, cur, p1, p2, p3);
        prevCubicCtrl = p2;
        prevQuadCtrl = null;
        cur = p3;
        break;
      }
      case 'Q': {
        const v = nums(4);
        if (!v) { i = tokens.length; break; }
        const p1 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p2 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        flattenQuadratic(current, cur, p1, p2);
        prevQuadCtrl = p1;
        prevCubicCtrl = null;
        cur = p2;
        break;
      }
      case 'T': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        const p1: Pt = prevQuadCtrl
          ? { x: 2 * cur.x - prevQuadCtrl.x, y: 2 * cur.y - prevQuadCtrl.y }
          : { ...cur };
        const p2 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        flattenQuadratic(current, cur, p1, p2);
        prevQuadCtrl = p1;
        prevCubicCtrl = null;
        cur = p2;
        break;
      }
      case 'A': {
        const v = nums(7);
        if (!v) { i = tokens.length; break; }
        const to = rel ? { x: cur.x + v[5], y: cur.y + v[6] } : { x: v[5], y: v[6] };
        flattenArc(current, cur, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0, to);
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        cur = to;
        break;
      }
      default:
        i += 1;
        break;
    }
    // A malformed argument group must not spin forever.
    if (typeof tokens[i] === 'string') continue;
    if (i < tokens.length && typeof tokens[i] === 'number' && !cmd) break;
  }
  flush();
  return polylines;
}

function parsePointsAttr(raw: string | null): Pt[] {
  if (!raw) return [];
  const values = raw.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v));
  const out: Pt[] = [];
  for (let k = 0; k + 1 < values.length; k += 2) out.push({ x: values[k], y: values[k + 1] });
  return out;
}

export interface SvgGeometry {
  polylines: Pt[][];
  viewBox: { x: number; y: number; width: number; height: number } | null;
}

/** Extract all supported geometry from an SVG document. */
export function parseSvgGeometry(svgText: string): SvgGeometry {
  const polylines: Pt[][] = [];
  let viewBox: SvgGeometry['viewBox'] = null;
  const svgTag = /<svg\b[^>]*>/i.exec(svgText);
  if (svgTag) {
    const vb = getAttr(svgTag[0], 'viewBox');
    if (vb) {
      const parts = vb.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length === 4 && parts.every((v) => Number.isFinite(v)) && parts[2] > 0 && parts[3] > 0) {
        viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }
    }
  }

  // Single scan over group and shape tags in document order. A stack
  // of group matrices tracks <g> nesting: entering a group composes
  // its transform onto the accumulated matrix (outermost first), and
  // each shape's effective matrix is group ∘ element. With no <g>
  // transforms in the document the accumulated matrix stays IDENTITY,
  // so matMul(IDENTITY, element) returns the element matrix unchanged
  // and legacy documents sample bit-identically.
  const tagRe = /<(\/?)(g|path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  let groupMat: Mat = IDENTITY;
  const groupStack: Mat[] = [];
  while ((tagMatch = tagRe.exec(svgText)) !== null) {
    const tag = tagMatch[0];
    const isClosing = tagMatch[1] === '/';
    const kind = tagMatch[2].toLowerCase();
    if (kind === 'g') {
      if (isClosing) {
        groupMat = groupStack.pop() ?? IDENTITY;
      } else if (!tag.endsWith('/>')) {
        groupStack.push(groupMat);
        groupMat = matMul(groupMat, parseTransform(getAttr(tag, 'transform')));
      }
      continue;
    }
    if (isClosing) continue;
    const mat = matMul(groupMat, parseTransform(getAttr(tag, 'transform')));
    const push = (line: Pt[], close: boolean) => {
      if (line.length < 2) return;
      const mapped = line.map((p) => matApply(mat, p));
      if (close) mapped.push({ ...mapped[0] });
      polylines.push(mapped);
    };
    switch (kind) {
      case 'path': {
        const d = getAttr(tag, 'd');
        if (d) {
          for (const line of parsePathData(d)) {
            polylines.push(line.map((p) => matApply(mat, p)));
          }
        }
        break;
      }
      case 'polygon':
        push(parsePointsAttr(getAttr(tag, 'points')), true);
        break;
      case 'polyline':
        push(parsePointsAttr(getAttr(tag, 'points')), false);
        break;
      case 'line':
        push(
          [
            { x: numAttr(tag, 'x1'), y: numAttr(tag, 'y1') },
            { x: numAttr(tag, 'x2'), y: numAttr(tag, 'y2') },
          ],
          false,
        );
        break;
      case 'rect': {
        const x = numAttr(tag, 'x');
        const y = numAttr(tag, 'y');
        const w = numAttr(tag, 'width');
        const h = numAttr(tag, 'height');
        if (w > 0 && h > 0) {
          push(
            [
              { x, y },
              { x: x + w, y },
              { x: x + w, y: y + h },
              { x, y: y + h },
            ],
            true,
          );
        }
        break;
      }
      case 'circle':
      case 'ellipse': {
        const cx = numAttr(tag, 'cx');
        const cy = numAttr(tag, 'cy');
        const rx = kind === 'circle' ? numAttr(tag, 'r') : numAttr(tag, 'rx');
        const ry = kind === 'circle' ? numAttr(tag, 'r') : numAttr(tag, 'ry');
        if (rx > 0 && ry > 0) {
          const line: Pt[] = [];
          const steps = 64;
          for (let k = 0; k < steps; k++) {
            const t = (k / steps) * Math.PI * 2;
            line.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
          }
          push(line, true);
        }
        break;
      }
      default:
        break;
    }
  }
  return { polylines, viewBox };
}

/**
 * Sample an SVG document into a normalised point cloud: flat xy pairs
 * in a centred, y-up space whose larger dimension spans [-1, 1].
 * Returns null when the document carries no drawable geometry.
 * Pure and deterministic — the same source always yields the same
 * cloud, which the deterministic renderer relies on.
 */
export function sampleSvgPointCloud(
  svgText: string,
  sampleCount: number = SVG_MORPH_SAMPLE_COUNT,
): Float32Array | null {
  if (!svgText || svgText.indexOf('<') === -1) return null;
  const { polylines, viewBox } = parseSvgGeometry(svgText);
  if (polylines.length === 0) return null;

  // Segment list with cumulative lengths over the raw geometry.
  const segments: { ax: number; ay: number; bx: number; by: number; from: number; len: number }[] = [];
  let total = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of polylines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k];
      const b = line[k + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) continue;
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, from: total, len });
      total += len;
    }
  }
  if (!Number.isFinite(minX)) return null;

  const box = viewBox ?? { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const span = Math.max(box.width, box.height);
  if (!(span > 0)) return null;
  const scale = 2 / span;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const normalize = (x: number, y: number): [number, number] => [(x - cx) * scale, -(y - cy) * scale];

  const out = new Float32Array(sampleCount * 2);
  if (total <= 0 || segments.length === 0) {
    // Degenerate geometry (points only): emit the vertices themselves.
    const flat: Pt[] = [];
    for (const line of polylines) flat.push(...line);
    if (flat.length === 0) return null;
    for (let s = 0; s < sampleCount; s++) {
      const p = flat[s % flat.length];
      const [nx, ny] = normalize(p.x, p.y);
      out[s * 2] = nx;
      out[s * 2 + 1] = ny;
    }
    return out;
  }

  let segIndex = 0;
  for (let s = 0; s < sampleCount; s++) {
    const target = (total * (s + 0.5)) / sampleCount;
    while (segIndex < segments.length - 1 && segments[segIndex].from + segments[segIndex].len < target) {
      segIndex += 1;
    }
    const seg = segments[segIndex];
    const t = Math.max(0, Math.min(1, (target - seg.from) / seg.len));
    const [nx, ny] = normalize(seg.ax + (seg.bx - seg.ax) * t, seg.ay + (seg.by - seg.ay) * t);
    out[s * 2] = nx;
    out[s * 2 + 1] = ny;
  }
  return out;
}
