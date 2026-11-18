/**
 * Internal map-source supply (Phase AF): shapes the app already
 * authors — the morph text, the authored SVG path, and the post
 * chain's edge field — wired into the consumers that already read
 * maps (Layer Maps, the raster / kill mask, and with Phase AF the
 * feedback mask), following the Phase AE supply pattern exactly:
 *
 *  - A supply is a sentinel string stored in the EXISTING source
 *    keys (gpgpuMapColorSource / ... / gpgpuMaskSource). No new
 *    config keys describe the maps themselves.
 *  - `resolveMapSourceTexture` (lib/terrainDerivedMaps.ts) stays
 *    the single resolution point; it delegates here for the AF
 *    sentinels before falling back to the image cache.
 *  - `text-raster` rasterises the layer-2 TextMap settings — the
 *    same string and font settings the 'text' morph target bakes
 *    with (components/controlPanelPartsSourceMediaUtils
 *    `extractTextLumaMap` draws identically) — so the mask tracks
 *    text edits live instead of freezing a picture.
 *  - `path-raster` rasterises the authored path geometry
 *    (lib/pathGeometry.ts over gpgpuMorphSvgSource, normalised
 *    cloud space) with a pure distance-field function: same SVG
 *    in, bit-identical grid out, on any runtime. The supply
 *    reads the SVG document itself, independent of the morph
 *    target / path mode selection. Phase AF2 adds fill modes
 *    (source suffixes `path-raster:fill-evenodd` /
 *    `path-raster:fill-nonzero`: the closed subpaths are filled
 *    by the SVG fill rules and the stroke composited over them)
 *    and turns the stroke radius into the config key
 *    gpgpuPathRasterStrokeWidth (default = the AF constant).
 *  - `edge-output` exposes the post chain's Sobel field. A
 *    dedicated capture pass (components/edgeCapturePass.ts)
 *    copies the finished frame's edge field into a persistent
 *    target every frame and registers it here; consumers sample
 *    the PREVIOUS frame's field (one frame of lag — invisible
 *    for the static subjects a mask is authored against, and
 *    stated wherever the source is offered). Display and supply
 *    are independent: the capture pass is a pass-through, so
 *    supplying edges never changes the picture, and the display
 *    edge pass need not be on.
 *
 * Row conventions mirror lib/mapImageTexture.ts: texture data
 * row 0 is the v = 0 (bottom) row, so a supplied texture samples
 * identically to the same picture loaded as an image; numeric
 * luma grids (for the mask's bake consumers) keep image order,
 * row 0 = top, as lib/layerMask.ts expects.
 */

import * as THREE from 'three';
import { parseSvgPathGeometry, type PathGeometry } from './pathGeometry';
import type { MapImageTextureState } from './mapImageTexture';
import type { ParticleConfig } from '../types';
import { verticalGlyphPlacements } from './textColumnLayout';

export const TEXT_RASTER_SOURCE = 'text-raster';
export const PATH_RASTER_SOURCE = 'path-raster';
export const EDGE_OUTPUT_SOURCE = 'edge-output';

/** Fill modes of the path raster supply (Phase AF2), carried as
 *  source-string suffixes on the path-raster sentinel — the AE
 *  sentinel convention, so no new source key is needed. The bare
 *  'path-raster' source stays the Phase AF stroke-only raster. */
export type PathFillMode = 'none' | 'evenodd' | 'nonzero';
export const PATH_RASTER_FILL_EVENODD_SOURCE = 'path-raster:fill-evenodd';
export const PATH_RASTER_FILL_NONZERO_SOURCE = 'path-raster:fill-nonzero';

export function parsePathRasterFillMode(source: string): PathFillMode {
  if (source === PATH_RASTER_FILL_EVENODD_SOURCE) return 'evenodd';
  if (source === PATH_RASTER_FILL_NONZERO_SOURCE) return 'nonzero';
  return 'none';
}

export type AfMapSourceKind = 'text' | 'path' | 'edge';

export function parseAfMapSource(source: string): AfMapSourceKind | null {
  if (source === TEXT_RASTER_SOURCE) return 'text';
  if (source === PATH_RASTER_SOURCE
    || source === PATH_RASTER_FILL_EVENODD_SOURCE
    || source === PATH_RASTER_FILL_NONZERO_SOURCE) return 'path';
  if (source === EDGE_OUTPUT_SOURCE) return 'edge';
  return null;
}

export function isAfMapSource(source: string): boolean {
  return parseAfMapSource(source) !== null;
}

export function afMapSource(kind: AfMapSourceKind): string {
  return kind === 'text' ? TEXT_RASTER_SOURCE : kind === 'path' ? PATH_RASTER_SOURCE : EDGE_OUTPUT_SOURCE;
}

/** Every source key whose value can request the edge supply. */
export function configUsesEdgeSupply(config: ParticleConfig): boolean {
  return config.gpgpuMaskSource === EDGE_OUTPUT_SOURCE
    || config.gpgpuMapColorSource === EDGE_OUTPUT_SOURCE
    || config.gpgpuMapSizeSource === EDGE_OUTPUT_SOURCE
    || config.gpgpuMapOpacitySource === EDGE_OUTPUT_SOURCE
    || config.gpgpuMapDisplaceSource === EDGE_OUTPUT_SOURCE
    // Composite B layer (Phase AM): 'edge-output' reads the
    // previous frame's capture, so it requests the supply too.
    || (config.postCompositeEnabled === true && config.postCompositeSource === 'edge-output');
}

// ---------------------------------------------------------------------------
// Shared byte helpers (pure)

/** Flip RGBA rows: canvas/image order (row 0 = top) → texture
 *  data order (row 0 = v = 0, bottom), the mapImageTexture
 *  decode convention. */
export function flipRgbaRows(data: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    for (let x = 0; x < rowBytes; x++) out[y * rowBytes + x] = data[srcRow * rowBytes + x] ?? 0;
  }
  return out;
}

/** Luma grid (row 0 = top) → texture data (row 0 = bottom),
 *  grey RGB + opaque alpha. */
export function lumaGridToTextureData(luma: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const v = Math.round(Math.max(0, Math.min(1, luma[srcRow * width + x] ?? 0)) * 255);
      const o = (y * width + x) * 4;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return out;
}

function makeSupplyDataTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const NOT_READY: MapImageTextureState = { texture: null, ready: false };

// ---------------------------------------------------------------------------
// Text raster supply

export interface TextRasterSettings {
  text: string;
  fontFamily: string;
  fontWeight: number;
  size: number;
  padding: number;
  invert: boolean;
  // Vertical layout (Phase BG, lib/textColumnLayout.ts):
  // vertical=false keeps the legacy horizontal layout verbatim.
  vertical: boolean;
  columnLength: number;
  columnGap: number;
  letterSpacing: number;
}

/** The layer-2 TextMap settings: the same source the 'text'
 *  morph target rasterises (useGpgpuRuntime buildMorphBakeData). */
export function textRasterSettingsFromConfig(config: ParticleConfig): TextRasterSettings {
  return {
    text: config.layer2TextMapText,
    fontFamily: config.layer2TextMapFontFamily,
    fontWeight: config.layer2TextMapWeight,
    size: config.layer2TextMapSize,
    padding: config.layer2TextMapPadding,
    invert: config.layer2TextMapInvert,
    vertical: config.layer2TextMapVertical,
    columnLength: config.layer2TextMapColumnLength,
    columnGap: config.layer2TextMapColumnGap,
    letterSpacing: config.layer2TextMapLetterSpacing,
  };
}

export function textRasterCacheKey(settings: TextRasterSettings): string {
  return [
    settings.text, settings.fontFamily, settings.fontWeight, settings.size, settings.padding, settings.invert,
    settings.vertical, settings.columnLength, settings.columnGap, settings.letterSpacing,
  ].join('|');
}

/**
 * Rasterise the text settings onto a canvas, drawing exactly as
 * extractTextLumaMap does (same background/foreground convention,
 * font string, line layout and max-width), so the supplied
 * texture and the morph's numeric text map are the same picture.
 * Browser only; null where no DOM exists.
 */
export function rasterizeTextCanvas(settings: TextRasterSettings, size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const width = Math.max(2, Math.floor(size));
  const height = width;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = settings.invert ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = settings.invert ? '#000000' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = (settings.text || 'TEXT').split(/\n/).slice(0, 4);
  const clampedSize = Math.max(0.2, Math.min(1.4, settings.size || 0.76));
  const clampedPadding = Math.max(0, Math.min(0.35, settings.padding || 0.1));
  const pxSize = Math.max(12, Math.floor(clampedSize * Math.min(width, height)));
  ctx.font = `${Math.max(100, Math.min(900, settings.fontWeight || 700))} ${pxSize}px ${settings.fontFamily || 'Arial'}`;
  if (settings.vertical) {
    // Vertical layout (Phase BG): glyphs placed one by one from
    // the shared pure layout (lib/textColumnLayout.ts) — columns
    // right → left, glyphs top → bottom, all upright. Draws
    // identically to extractTextLumaMap's vertical branch.
    const placements = verticalGlyphPlacements(settings.text || 'TEXT', settings.columnLength, {
      width,
      height,
      padding: clampedPadding,
      pxSize,
      columnGap: settings.columnGap,
      letterSpacing: settings.letterSpacing,
    });
    placements.forEach((placement) => {
      ctx.fillText(placement.glyph, placement.x, placement.y);
    });
  } else {
    const usableHeight = height * (1 - clampedPadding * 2);
    const lineHeight = usableHeight / Math.max(1, lines.length);
    lines.forEach((line, index) => {
      const y = height * clampedPadding + lineHeight * (index + 0.5);
      ctx.fillText(line, width / 2, y, width * (1 - clampedPadding * 2));
    });
  }
  return canvas;
}

export const TEXT_RASTER_TEXTURE_SIZE = 256;

let textTextureEntry: { key: string; texture: THREE.DataTexture } | null = null;

export function getTextRasterTexture(config: ParticleConfig): MapImageTextureState {
  const settings = textRasterSettingsFromConfig(config);
  const key = textRasterCacheKey(settings);
  if (textTextureEntry && textTextureEntry.key === key) {
    return { texture: textTextureEntry.texture, ready: true };
  }
  const canvas = rasterizeTextCanvas(settings, TEXT_RASTER_TEXTURE_SIZE);
  if (!canvas) return NOT_READY;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return NOT_READY;
  const size = TEXT_RASTER_TEXTURE_SIZE;
  const imageData = ctx.getImageData(0, 0, size, size);
  const texture = makeSupplyDataTexture(flipRgbaRows(imageData.data, size, size), size, size);
  if (textTextureEntry) textTextureEntry.texture.dispose();
  textTextureEntry = { key, texture };
  return { texture, ready: true };
}

// ---------------------------------------------------------------------------
// Path raster supply (pure)

/** Default stroke radius of the path raster, in normalised
 *  cloud units. Phase AF fixed this as a raster convention; Phase
 *  AF2 turned it into the config key gpgpuPathRasterStrokeWidth
 *  with THIS value as its default, so existing renders stay
 *  bit-identical. */
export const PATH_RASTER_STROKE_RADIUS = 0.045;

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Fill edges of one subpath: consecutive point pairs plus the
 *  closing pair (SVG fills implicitly close subpaths). */
function collectFillEdges(geometry: PathGeometry): Float32Array {
  let total = 0;
  for (const sub of geometry.subpaths) {
    const count = Math.floor(sub.points.length / 2);
    if (count >= 2) total += count;
  }
  const edges = new Float32Array(total * 4);
  let o = 0;
  for (const sub of geometry.subpaths) {
    const pts = sub.points;
    const count = Math.floor(pts.length / 2);
    if (count < 2) continue;
    for (let k = 0; k < count; k++) {
      const k2 = (k + 1) % count;
      edges[o++] = pts[k * 2];
      edges[o++] = pts[k * 2 + 1];
      edges[o++] = pts[k2 * 2];
      edges[o++] = pts[k2 * 2 + 1];
    }
  }
  return edges;
}

/**
 * Point-in-fill test over every subpath edge (Phase AF2).
 * 'evenodd' counts ray crossings; 'nonzero' sums the winding
 * number — the two SVG fill rules. Pure and deterministic.
 */
export function pathFillContains(
  edges: ArrayLike<number>,
  px: number,
  py: number,
  mode: 'evenodd' | 'nonzero',
): boolean {
  const count = Math.floor(edges.length / 4);
  if (mode === 'evenodd') {
    let inside = false;
    for (let e = 0; e < count; e++) {
      const ax = edges[e * 4];
      const ay = edges[e * 4 + 1];
      const bx = edges[e * 4 + 2];
      const by = edges[e * 4 + 3];
      if ((ay > py) !== (by > py)) {
        const xInt = ax + ((py - ay) / (by - ay)) * (bx - ax);
        if (px < xInt) inside = !inside;
      }
    }
    return inside;
  }
  let wn = 0;
  for (let e = 0; e < count; e++) {
    const ax = edges[e * 4];
    const ay = edges[e * 4 + 1];
    const bx = edges[e * 4 + 2];
    const by = edges[e * 4 + 3];
    const isLeft = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py) {
      if (by > py && isLeft > 0) wn++;
    } else if (by <= py && isLeft < 0) {
      wn--;
    }
  }
  return wn !== 0;
}

/**
 * Rasterise path geometry into a luma grid (row 0 = top, y up,
 * normalised [-1, 1]² space): each cell takes the smooth falloff
 * of its distance to the nearest path segment, max-composited
 * across subpaths. With a fill mode (Phase AF2), cells inside
 * the (implicitly closed) subpaths take 1 before the stroke is
 * composited over them, so the supply reads as a filled vector
 * mask with the stroke as its outline weight. Pure and
 * deterministic — the same geometry rasterises bit-identically
 * anywhere. fillMode 'none' with the default radius reproduces
 * the Phase AF raster bit-for-bit.
 */
export function rasterizePathGeometryLuma(
  geometry: PathGeometry,
  size: number,
  radius: number = PATH_RASTER_STROKE_RADIUS,
  fillMode: PathFillMode = 'none',
): Float32Array {
  const n = Math.max(2, Math.floor(size));
  const out = new Float32Array(n * n);
  const r = Math.max(radius, 1e-9);
  const cell = 2 / n;
  const pad = r + cell;
  if (fillMode !== 'none') {
    const edges = collectFillEdges(geometry);
    if (edges.length > 0) {
      for (let cy = 0; cy < n; cy++) {
        const py = 1 - ((cy + 0.5) / n) * 2;
        for (let cx = 0; cx < n; cx++) {
          const px = ((cx + 0.5) / n) * 2 - 1;
          if (pathFillContains(edges, px, py, fillMode)) out[cy * n + cx] = 1;
        }
      }
    }
  }
  for (const sub of geometry.subpaths) {
    const pts = sub.points;
    const count = Math.floor(pts.length / 2);
    for (let k = 0; k + 1 < count; k++) {
      const ax = pts[k * 2];
      const ay = pts[k * 2 + 1];
      const bx = pts[(k + 1) * 2];
      const by = pts[(k + 1) * 2 + 1];
      // Cell window around the segment (x right, row 0 = y top).
      const minX = Math.min(ax, bx) - pad;
      const maxX = Math.max(ax, bx) + pad;
      const minY = Math.min(ay, by) - pad;
      const maxY = Math.max(ay, by) + pad;
      const cx0 = Math.max(0, Math.floor(((minX + 1) / 2) * n - 0.5));
      const cx1 = Math.min(n - 1, Math.ceil(((maxX + 1) / 2) * n - 0.5));
      const cy0 = Math.max(0, Math.floor(((1 - maxY) / 2) * n - 0.5));
      const cy1 = Math.min(n - 1, Math.ceil(((1 - minY) / 2) * n - 0.5));
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let cy = cy0; cy <= cy1; cy++) {
        const py = 1 - ((cy + 0.5) / n) * 2;
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = ((cx + 0.5) / n) * 2 - 1;
          let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t;
          const qy = ay + dy * t;
          const d = Math.hypot(px - qx, py - qy);
          if (d >= r) continue;
          const v = smooth01(1 - d / r);
          const idx = cy * n + cx;
          if (v > out[idx]) out[idx] = v;
        }
      }
    }
  }
  return out;
}

export const PATH_RASTER_TEXTURE_SIZE = 256;

interface PathRasterEntry {
  hash: string;
  geometry: PathGeometry;
  textureByKey: Map<string, THREE.DataTexture>;
  lumaByKey: Map<string, Float32Array>;
}

let pathEntry: PathRasterEntry | null = null;

function getPathEntry(config: ParticleConfig): PathRasterEntry | null {
  const source = config.gpgpuMorphSvgSource;
  if (!source) return null;
  const geometry = parseSvgPathGeometry(source);
  if (!geometry || geometry.totalLength <= 0) return null;
  if (pathEntry && pathEntry.hash === geometry.sourceHash) return pathEntry;
  if (pathEntry) pathEntry.textureByKey.forEach((tex) => tex.dispose());
  pathEntry = { hash: geometry.sourceHash, geometry, textureByKey: new Map(), lumaByKey: new Map() };
  return pathEntry;
}

/** The stroke radius the config asks for (Phase AF2 key; the AF
 *  constant when unset / invalid). */
export function pathRasterStrokeRadius(config: ParticleConfig): number {
  const v = config.gpgpuPathRasterStrokeWidth;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : PATH_RASTER_STROKE_RADIUS;
}

function pathRasterCacheKey(size: number, radius: number, fillMode: PathFillMode): string {
  return `${size}|${radius}|${fillMode}`;
}

export function getPathRasterLuma(
  config: ParticleConfig,
  size: number,
  fillMode: PathFillMode = 'none',
): Float32Array | null {
  const entry = getPathEntry(config);
  if (!entry) return null;
  const n = Math.max(2, Math.floor(size));
  const radius = pathRasterStrokeRadius(config);
  const key = pathRasterCacheKey(n, radius, fillMode);
  let luma = entry.lumaByKey.get(key);
  if (!luma) {
    luma = rasterizePathGeometryLuma(entry.geometry, n, radius, fillMode);
    entry.lumaByKey.set(key, luma);
  }
  return luma;
}

export function getPathRasterTexture(
  config: ParticleConfig,
  fillMode: PathFillMode = 'none',
): MapImageTextureState {
  const entry = getPathEntry(config);
  if (!entry) return NOT_READY;
  const size = PATH_RASTER_TEXTURE_SIZE;
  const key = pathRasterCacheKey(size, pathRasterStrokeRadius(config), fillMode);
  let texture = entry.textureByKey.get(key);
  if (!texture) {
    const luma = getPathRasterLuma(config, size, fillMode);
    if (!luma) return NOT_READY;
    texture = makeSupplyDataTexture(lumaGridToTextureData(luma, size, size), size, size);
    entry.textureByKey.set(key, texture);
  }
  return { texture, ready: true };
}

// ---------------------------------------------------------------------------
// Edge output supply (registered by the capture pass)

let edgeCaptureTexture: THREE.Texture | null = null;

export function registerEdgeCaptureTexture(texture: THREE.Texture | null): void {
  edgeCaptureTexture = texture;
}

export function getEdgeCaptureTextureState(): MapImageTextureState {
  // The capture target's texture is a render-target texture,
  // not a DataTexture; consumers only bind it as a sampler, so
  // it is handed over through the shared state shape as-is.
  return edgeCaptureTexture
    ? { texture: edgeCaptureTexture as THREE.DataTexture, ready: true }
    : NOT_READY;
}

// ---------------------------------------------------------------------------
// Resolution delegation (called from resolveMapSourceTexture)

/** Returns the supply state for an AF sentinel, or null when the
 *  source is not one (the caller then continues its own chain). */
export function resolveAfMapSourceTexture(source: string, config: ParticleConfig): MapImageTextureState | null {
  const kind = parseAfMapSource(source);
  if (kind === 'text') return getTextRasterTexture(config);
  if (kind === 'path') return getPathRasterTexture(config, parsePathRasterFillMode(source));
  if (kind === 'edge') return getEdgeCaptureTextureState();
  return null;
}
