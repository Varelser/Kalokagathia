/**
 * Phase CI (CSG second release, U2): free-form cross-section
 * input for the extrude operand. Three input routes, one
 * result type — a list of polygons that the existing
 * validateExtrudePolygons / buildExtrudeFromPolygons pair
 * already knows how to check and build:
 *
 *  1. Point lists: one "x, y" (or "x y") point per line,
 *     blank line separates polygons, "#" starts a comment.
 *     A block may also be a flat stream of numbers, paired
 *     up in order.
 *  2. SVG path data: M L H V C S Q T A Z (absolute and
 *     relative). Curves and arcs are flattened to line
 *     segments; each subpath becomes one polygon.
 *  3. SVG documents: <path d>, <polygon points>,
 *     <polyline points> (closed), <rect>, <circle> and
 *     <ellipse> elements are all extracted.
 *
 * Coordinates are used as written (world units) — no
 * normalisation, matching the U5 raw-units discipline.
 * Holes are NOT supported: the shared validation rejects
 * polygons that contain one another, with its reason.
 */
import type { ExtrudePolygon } from './csgExtrude';
import { validateExtrudePolygons } from './csgExtrude';

export type FreeformFormat = 'points' | 'svg-path' | 'svg-document';

export interface FreeformParseResult {
  ok: boolean;
  polygons: ExtrudePolygon[];
  /** Japanese refusal reason ('' when ok). */
  reason: string;
  format: FreeformFormat | '';
  pointCount: number;
}

const MAX_POLYGONS = 16;
const MAX_POINTS = 4096;

function ng(reason: string, format: FreeformFormat | ''): FreeformParseResult {
  return { ok: false, polygons: [], reason, format, pointCount: 0 };
}

/** Shared cleanup: drop a closing point that duplicates
 *  the first, drop consecutive duplicates (zero-length
 *  edges), drop empty polygons. Used by the strict
 *  finish() and by the editor's lenient draft parse. */
export function cleanFreeformPolygons(
  polygons: readonly (readonly (readonly [number, number])[])[],
): [number, number][][] {
  const cleaned: [number, number][][] = [];
  for (const poly of polygons) {
    let pts = poly as [number, number][];
    if (pts.length > 1) {
      const [fx, fy] = pts[0];
      const [lx, ly] = pts[pts.length - 1];
      if (Math.abs(fx - lx) < 1e-12 && Math.abs(fy - ly) < 1e-12) {
        pts = pts.slice(0, -1);
      }
    }
    const dedup: [number, number][] = [];
    for (const p of pts) {
      const last = dedup[dedup.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-12 || Math.abs(last[1] - p[1]) > 1e-12) {
        dedup.push(p);
      }
    }
    if (dedup.length > 0) cleaned.push(dedup);
  }
  return cleaned;
}

function finish(
  polygons: [number, number][][],
  format: FreeformFormat,
): FreeformParseResult {
  const cleaned = cleanFreeformPolygons(polygons);
  if (cleaned.length === 0) return ng('図形が読み取れませんでした。', format);
  if (cleaned.length > MAX_POLYGONS) {
    return ng(`図形が多すぎます（${cleaned.length} 個、上限 ${MAX_POLYGONS} 個）。`, format);
  }
  const pointCount = cleaned.reduce((n, p) => n + p.length, 0);
  if (pointCount > MAX_POINTS) {
    return ng(`点が多すぎます（${pointCount} 点、上限 ${MAX_POINTS} 点）。`, format);
  }
  const check = validateExtrudePolygons(cleaned);
  if (!check.ok) return ng(check.reason, format);
  return { ok: true, polygons: cleaned, reason: '', format, pointCount };
}

// ------------------------------------------------------------------ point lists

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function parsePointList(text: string): FreeformParseResult {
  const blocks = text.split(/\n\s*\n/);
  const polygons: [number, number][][] = [];
  for (const block of blocks) {
    const noComments = block
      .split('\n')
      .map((line) => line.split('#')[0])
      .join('\n');
    const nums = (noComments.match(NUMBER_RE) || []).map(Number);
    if (nums.length === 0) continue;
    if (nums.length % 2 !== 0) {
      return ng('点リストの数値が奇数個あります（x, y の組になりません）。', 'points');
    }
    const pts: [number, number][] = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    polygons.push(pts);
  }
  if (polygons.length === 0) {
    return ng('点リストとして読み取れませんでした。"x, y" の行を書いてください。', 'points');
  }
  return finish(polygons, 'points');
}

/** Lenient point-list parse for the point editor's draft
 *  state. While a shape is being drawn it passes through
 *  states the strict parser rightly refuses (1-2 points,
 *  a dangling odd number mid-typing); the editor must
 *  still see those points or every click would restart
 *  from empty. Never used for running an operation —
 *  parseFreeformText stays the only strict entry. */
export function parsePointListLenient(text: string): [number, number][][] {
  const polygons: [number, number][][] = [];
  for (const block of (text || '').split(/\n\s*\n/)) {
    const noComments = block
      .split('\n')
      .map((line) => line.split('#')[0])
      .join('\n');
    const nums = (noComments.match(NUMBER_RE) || []).map(Number);
    if (nums.length < 2) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.length > 0) polygons.push(pts);
  }
  return cleanFreeformPolygons(polygons);
}

// ------------------------------------------------------------------ SVG path data

interface PathCursor {
  x: number;
  y: number;
  startX: number;
  startY: number;
  prevCubic: [number, number] | null;
  prevQuad: [number, number] | null;
}

function flattenCubic(
  out: [number, number][],
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
): void {
  const STEPS = 16;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    out.push([
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ]);
  }
}

function flattenQuad(
  out: [number, number][],
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
): void {
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    out.push([
      u * u * x0 + 2 * u * t * x1 + t * t * x2,
      u * u * y0 + 2 * u * t * y1 + t * t * y2,
    ]);
  }
}

/** SVG arc (endpoint parametrisation) flattened per the
 *  spec's F.6.5 centre conversion. */
function flattenArc(
  out: [number, number][],
  x0: number, y0: number,
  rxIn: number, ryIn: number, angleDeg: number,
  largeArc: number, sweep: number,
  x1: number, y1: number,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x0 === x1 && y0 === y1)) {
    out.push([x1, y1]);
    return;
  }
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
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
  if ((largeArc !== 0) === (sweep !== 0)) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const startAngle = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy) % (Math.PI * 2);
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
  if (sweep !== 0 && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
  for (let i = 1; i <= steps; i++) {
    const t = startAngle + (delta * i) / steps;
    out.push([
      cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
      cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
    ]);
  }
}

const PATH_TOKEN_RE = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

export function parseSvgPathData(d: string): FreeformParseResult {
  const tokens: (string | number)[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  const leftover = d.replace(PATH_TOKEN_RE, (_whole, cmd, num) => {
    tokens.push(cmd !== undefined ? cmd : Number(num));
    return ' ';
  });
  if (/[A-Za-z]/.test(leftover)) {
    return ng('SVG パスに読めない文字が含まれています。', 'svg-path');
  }
  if (tokens.length === 0 || typeof tokens[0] !== 'string') {
    return ng('SVG パスとして読み取れませんでした。', 'svg-path');
  }
  const polygons: [number, number][][] = [];
  let current: [number, number][] | null = null;
  const cur: PathCursor = { x: 0, y: 0, startX: 0, startY: 0, prevCubic: null, prevQuad: null };
  let i = 0;
  let cmd = '';
  const num = (): number => {
    const v = tokens[i++];
    if (typeof v !== 'number') throw new Error('SVG パスの数値が不足しています。');
    return v;
  };
  const flush = () => {
    if (current && current.length > 0) polygons.push(current);
    current = null;
  };
  try {
    while (i < tokens.length) {
      if (typeof tokens[i] === 'string') {
        cmd = tokens[i++] as string;
      }
      if (cmd === '') throw new Error('SVG パスの開始コマンドがありません。');
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        if (current && current.length > 0) {
          cur.x = cur.startX;
          cur.y = cur.startY;
          flush();
        }
        cmd = '';
        cur.prevCubic = null;
        cur.prevQuad = null;
        continue;
      }
      if (C === 'M') {
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flush();
        current = [[x, y]];
        cur.x = cur.startX = x;
        cur.y = cur.startY = y;
        cur.prevCubic = null;
        cur.prevQuad = null;
        cmd = rel ? 'l' : 'L';
        continue;
      }
      if (!current) current = [[cur.x, cur.y]];
      if (C === 'L') {
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        current.push([x, y]);
        cur.x = x; cur.y = y;
        cur.prevCubic = null; cur.prevQuad = null;
      } else if (C === 'H') {
        const x = num() + (rel ? cur.x : 0);
        current.push([x, cur.y]);
        cur.x = x;
        cur.prevCubic = null; cur.prevQuad = null;
      } else if (C === 'V') {
        const y = num() + (rel ? cur.y : 0);
        current.push([cur.x, y]);
        cur.y = y;
        cur.prevCubic = null; cur.prevQuad = null;
      } else if (C === 'C') {
        const x1 = num() + (rel ? cur.x : 0);
        const y1 = num() + (rel ? cur.y : 0);
        const x2 = num() + (rel ? cur.x : 0);
        const y2 = num() + (rel ? cur.y : 0);
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flattenCubic(current, cur.x, cur.y, x1, y1, x2, y2, x, y);
        cur.prevCubic = [x2, y2];
        cur.prevQuad = null;
        cur.x = x; cur.y = y;
      } else if (C === 'S') {
        const x1 = cur.prevCubic ? 2 * cur.x - cur.prevCubic[0] : cur.x;
        const y1 = cur.prevCubic ? 2 * cur.y - cur.prevCubic[1] : cur.y;
        const x2 = num() + (rel ? cur.x : 0);
        const y2 = num() + (rel ? cur.y : 0);
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flattenCubic(current, cur.x, cur.y, x1, y1, x2, y2, x, y);
        cur.prevCubic = [x2, y2];
        cur.prevQuad = null;
        cur.x = x; cur.y = y;
      } else if (C === 'Q') {
        const x1 = num() + (rel ? cur.x : 0);
        const y1 = num() + (rel ? cur.y : 0);
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flattenQuad(current, cur.x, cur.y, x1, y1, x, y);
        cur.prevQuad = [x1, y1];
        cur.prevCubic = null;
        cur.x = x; cur.y = y;
      } else if (C === 'T') {
        const x1 = cur.prevQuad ? 2 * cur.x - cur.prevQuad[0] : cur.x;
        const y1 = cur.prevQuad ? 2 * cur.y - cur.prevQuad[1] : cur.y;
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flattenQuad(current, cur.x, cur.y, x1, y1, x, y);
        cur.prevQuad = [x1, y1];
        cur.prevCubic = null;
        cur.x = x; cur.y = y;
      } else if (C === 'A') {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const x = num() + (rel ? cur.x : 0);
        const y = num() + (rel ? cur.y : 0);
        flattenArc(current, cur.x, cur.y, rx, ry, rot, large, sweep, x, y);
        cur.prevCubic = null; cur.prevQuad = null;
        cur.x = x; cur.y = y;
      } else {
        throw new Error(`未対応の SVG パスコマンドです: ${cmd}`);
      }
    }
  } catch (e) {
    return ng(e instanceof Error ? e.message : 'SVG パスの解析に失敗しました。', 'svg-path');
  }
  flush();
  if (polygons.length === 0) return ng('SVG パスに図形がありませんでした。', 'svg-path');
  return finish(polygons, 'svg-path');
}

// ------------------------------------------------------------------ SVG documents

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
}

function parsePointsAttr(points: string): [number, number][] {
  const nums = (points.match(NUMBER_RE) || []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

function parseSvgDocument(text: string): FreeformParseResult {
  const polygons: [number, number][][] = [];
  const tagRe = /<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = tagRe.exec(text)) !== null) {
    const tag = m[0];
    const kind = m[1];
    found = true;
    if (kind === 'path') {
      const d = attr(tag, 'd');
      if (d) {
        const r = parseSvgPathData(d);
        if (r.ok) polygons.push(...(r.polygons as [number, number][][]));
      }
    } else if (kind === 'polygon' || kind === 'polyline') {
      const pts = attr(tag, 'points');
      if (pts) {
        const parsed = parsePointsAttr(pts);
        if (parsed.length > 0) polygons.push(parsed);
      }
    } else if (kind === 'rect') {
      const x = Number(attr(tag, 'x') || 0);
      const y = Number(attr(tag, 'y') || 0);
      const w = Number(attr(tag, 'width') || 0);
      const h = Number(attr(tag, 'height') || 0);
      if (w > 0 && h > 0) polygons.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    } else if (kind === 'circle' || kind === 'ellipse') {
      const cx = Number(attr(tag, 'cx') || 0);
      const cy = Number(attr(tag, 'cy') || 0);
      const rx = kind === 'circle' ? Number(attr(tag, 'r') || 0) : Number(attr(tag, 'rx') || 0);
      const ry = kind === 'circle' ? rx : Number(attr(tag, 'ry') || 0);
      if (rx > 0 && ry > 0) {
        const ring: [number, number][] = [];
        const N = 48;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          ring.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
        polygons.push(ring);
      }
    }
  }
  if (!found || polygons.length === 0) {
    return ng('SVG から図形（path／polygon／rect／circle 等）が見つかりませんでした。', 'svg-document');
  }
  return finish(polygons, 'svg-document');
}

// ------------------------------------------------------------------ entry point

/** Parse any supported free-form input. SVG documents are
 *  recognised by their tags; bare path data by its leading
 *  command letter; everything else is read as a point list. */
export function parseFreeformText(text: string): FreeformParseResult {
  const t = (text || '').trim();
  if (!t) return ng('入力が空です。', '');
  if (/<(svg|path|polygon|polyline|rect|circle|ellipse)\b/.test(t)) {
    return parseSvgDocument(t);
  }
  if (/^[Mm]\s*[-+0-9.]/.test(t) || /^d\s*=\s*"/.test(t)) {
    const d = t.startsWith('d') ? (t.match(/"([^"]*)"/) || [])[1] || '' : t;
    return parseSvgPathData(d);
  }
  return parsePointList(t);
}

/** Canonical point-list text for a polygon set (the editor
 *  writes this back into the config text). */
export function serializePolygonsToPointList(
  polygons: readonly (readonly (readonly [number, number])[])[],
): string {
  const fmt = (v: number) => {
    const r = Math.round(v * 10000) / 10000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  return polygons
    .map((poly) => poly.map(([x, y]) => `${fmt(x)}, ${fmt(y)}`).join('\n'))
    .join('\n\n');
}
