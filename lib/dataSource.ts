import type { ParticleConfig } from '../types';
import { createSeededRng } from './seededRng';

/**
 * CSV / JSON data source (roadmap Phase 8A).
 *
 * Turns tabular point data into particles by reusing the app's existing
 * media pipeline: points are rasterized into a luminance map in exactly
 * the format the image/text sources consume (a number[] of width*height
 * values in 0..1), and the target layer is switched to the `image`
 * source with that map. No renderer changes are needed — every motion,
 * render family, and post effect then applies to the data shape as it
 * would to a photo or a line of text.
 *
 * Accepted input:
 * - CSV / TSV / whitespace-separated rows: `x, y[, z][, value]`
 *   (a non-numeric first row is treated as a header and skipped)
 * - JSON: an array of `[x, y, z?, value?]` tuples, or of objects with
 *   x / y and optional z / v / value fields.
 *
 * The XY plane becomes the shape. Brightness is the per-cell point
 * density, unless a value (or z, when no value exists) is supplied, in
 * which case brightness is that value. Both are max-normalized.
 */

export interface DataPoint {
  x: number;
  y: number;
  z?: number;
  value?: number;
}

export interface ParsedData {
  points: DataPoint[];
  hasValue: boolean;
  xRange: [number, number];
  yRange: [number, number];
}

const MAX_POINTS = 200_000;

function finalize(points: DataPoint[]): ParsedData | null {
  if (points.length === 0) return null;
  const capped = points.slice(0, MAX_POINTS);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let hasValue = false;
  capped.forEach((point) => {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
    if (typeof point.value === 'number' || typeof point.z === 'number') hasValue = true;
  });
  return { points: capped, hasValue, xRange: [minX, maxX], yRange: [minY, maxY] };
}

function parseDelimited(text: string): ParsedData | null {
  const points: DataPoint[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cells = trimmed.split(/[,;\t ]+/).filter(Boolean);
    const numbers = cells.map((cell) => Number(cell));
    if (numbers.some((value) => !Number.isFinite(value))) {
      if (index === 0) return; // header row
      return;
    }
    if (numbers.length < 2) return;
    const [x, y, third, fourth] = numbers;
    const point: DataPoint = { x, y };
    if (typeof third === 'number') point.z = third;
    if (typeof fourth === 'number') point.value = fourth;
    points.push(point);
  });
  return finalize(points);
}

export function parseDataPoints(text: string): ParsedData | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    try {
      const raw = JSON.parse(trimmed) as unknown;
      if (Array.isArray(raw)) {
        const points: DataPoint[] = [];
        raw.forEach((entry) => {
          if (Array.isArray(entry)) {
            const [x, y, z, value] = entry.map((cell) => Number(cell));
            if (Number.isFinite(x) && Number.isFinite(y)) {
              const point: DataPoint = { x, y };
              if (Number.isFinite(z)) point.z = z;
              if (Number.isFinite(value)) point.value = value;
              points.push(point);
            }
          } else if (entry && typeof entry === 'object') {
            const record = entry as Record<string, unknown>;
            const x = Number(record.x);
            const y = Number(record.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              const point: DataPoint = { x, y };
              const z = Number(record.z);
              if (Number.isFinite(z)) point.z = z;
              const value = Number(record.value ?? record.v);
              if (Number.isFinite(value)) point.value = value;
              points.push(point);
            }
          }
        });
        const parsed = finalize(points);
        if (parsed) return parsed;
      }
    } catch {
      // fall through to delimited parsing
    }
  }
  return parseDelimited(trimmed);
}

export const DATA_MAP_SIZE = 64;

export function buildDataLumaMap(data: ParsedData, size = DATA_MAP_SIZE): number[] {
  const map = new Array<number>(size * size).fill(0);
  const [minX, maxX] = data.xRange;
  const [minY, maxY] = data.yRange;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min(size / spanX, size / spanY);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;

  const splat = (px: number, py: number, amount: number) => {
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const falloff = dx === 0 && dy === 0 ? 1 : 0.35;
        map[y * size + x] += amount * falloff;
      }
    }
  };

  let maxBrightness = 0;
  if (data.hasValue) {
    data.points.forEach((point) => {
      const brightness = point.value ?? point.z ?? 0;
      if (brightness > maxBrightness) maxBrightness = brightness;
    });
  }
  const brightnessScale = maxBrightness > 0 ? 1 / maxBrightness : 0;

  data.points.forEach((point) => {
    const px = offsetX + (point.x - minX) * scale;
    // Flip Y so the shape reads the same way up as the data (data Y-up,
    // image rows are Y-down).
    const py = size - 1 - (offsetY + (point.y - minY) * scale);
    const amount = data.hasValue ? (point.value ?? point.z ?? 0) * brightnessScale : 1;
    splat(px, py, amount);
  });

  if (!data.hasValue) {
    let maxDensity = 0;
    map.forEach((value) => {
      if (value > maxDensity) maxDensity = value;
    });
    if (maxDensity > 0) {
      for (let i = 0; i < map.length; i++) map[i] = Math.min(1, map[i] / maxDensity);
    }
  } else {
    for (let i = 0; i < map.length; i++) map[i] = Math.min(1, map[i]);
  }
  return map;
}

/** A built-in sample dataset (two-arm spiral) so the feature can be tried without a file. Seeded, so the sample is the same spiral on every click. */
export function buildSampleDataPoints(count = 4000): DataPoint[] {
  const random = createSeededRng(20261107);
  const points: DataPoint[] = [];
  for (let i = 0; i < count; i++) {
    const arm = i % 2 === 0 ? 0 : Math.PI;
    const t = random();
    const angle = arm + t * Math.PI * 2.4 + (random() - 0.5) * 0.35;
    const radius = 4 + t * 42 + (random() - 0.5) * 5;
    points.push({
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      value: 1 - t * 0.6,
    });
  }
  return points;
}

/**
 * Config updates that point a layer at the data map. Returned as a list
 * so callers can feed them through the standard updateConfig path.
 */
export function getDataSourceUpdates(
  layerIndex: 2 | 3,
  map: number[],
  size = DATA_MAP_SIZE,
): [keyof ParticleConfig, ParticleConfig[keyof ParticleConfig]][] {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const set = (suffix: string, value: unknown) =>
    [`${prefix}${suffix}`, value] as [keyof ParticleConfig, ParticleConfig[keyof ParticleConfig]];
  return [
    set('Enabled', true),
    set('Source', 'image'),
    set('MediaLumaMap', map),
    set('MediaMapWidth', size),
    set('MediaMapHeight', size),
  ];
}
