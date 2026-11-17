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
 *    in, bit-identical grid out, on any runtime. The stroke
 *    radius is a fixed raster convention (like
 *    PATH_TAPER_MAX_WIDTH, deliberately not a config key). The
 *    supply reads the SVG document itself, independent of the
 *    morph target / path mode selection.
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

export const TEXT_RASTER_SOURCE = 'text-raster';
export const PATH_RASTER_SOURCE = 'path-raster';
export const EDGE_OUTPUT_SOURCE = 'edge-output';

export type AfMapSourceKind = 'text' | 'path' | 'edge';

export function parseAfMapSource(source: string): AfMapSourceKind | null {
  if (source === TEXT_RASTER_SOURCE) return 'text';
  if (source === PATH_RASTER_SOURCE) return 'path';
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
    || config.gpgpuMapDisplaceSource === EDGE_OUTPUT_SOURCE;
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
  };
}

export function textRasterCacheKey(settings: TextRasterSettings): string {
  return [settings.text, settings.fontFamily, settings.fontWeight, settings.size, settings.padding, settings.invert].join('|');
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
  const usableHeight = height * (1 - clampedPadding * 2);
  const lineHeight = usableHeight / Math.max(1, lines.length);
  lines.forEach((line, index) => {
    const y = height * clampedPadding + lineHeight * (index + 0.5);
    ctx.fillText(line, width / 2, y, width * (1 - clampedPadding * 2));
  });
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

/** Stroke radius of the path raster, in normalised cloud units.
 *  A fixed raster convention (like PATH_TAPER_MAX_WIDTH), not a
 *  config key: the mask reads as a band along the curve at any
 *  grid size. */
export const PATH_RASTER_STROKE_RADIUS = 0.045;

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Rasterise path geometry into a luma grid (row 0 = top, y up,
 * normalised [-1, 1]² space): each cell takes the smooth falloff
 * of its distance to the nearest path segment, max-composited
 * across subpaths. Pure and deterministic — the same geometry
 * rasterises bit-identically anywhere.
 */
export function rasterizePathGeometryLuma(
  geometry: PathGeometry,
  size: number,
  radius: number = PATH_RASTER_STROKE_RADIUS,
): Float32Array {
  const n = Math.max(2, Math.floor(size));
  const out = new Float32Array(n * n);
  const r = Math.max(radius, 1e-9);
  const cell = 2 / n;
  const pad = r + cell;
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
  texture: THREE.DataTexture | null;
  lumaBySize: Map<number, Float32Array>;
}

let pathEntry: PathRasterEntry | null = null;

function getPathEntry(config: ParticleConfig): PathRasterEntry | null {
  const source = config.gpgpuMorphSvgSource;
  if (!source) return null;
  const geometry = parseSvgPathGeometry(source);
  if (!geometry || geometry.totalLength <= 0) return null;
  if (pathEntry && pathEntry.hash === geometry.sourceHash) return pathEntry;
  if (pathEntry) pathEntry.texture?.dispose();
  pathEntry = { hash: geometry.sourceHash, geometry, texture: null, lumaBySize: new Map() };
  return pathEntry;
}

export function getPathRasterLuma(config: ParticleConfig, size: number): Float32Array | null {
  const entry = getPathEntry(config);
  if (!entry) return null;
  const n = Math.max(2, Math.floor(size));
  let luma = entry.lumaBySize.get(n);
  if (!luma) {
    luma = rasterizePathGeometryLuma(entry.geometry, n);
    entry.lumaBySize.set(n, luma);
  }
  return luma;
}

export function getPathRasterTexture(config: ParticleConfig): MapImageTextureState {
  const entry = getPathEntry(config);
  if (!entry) return NOT_READY;
  if (!entry.texture) {
    const size = PATH_RASTER_TEXTURE_SIZE;
    const luma = getPathRasterLuma(config, size);
    if (!luma) return NOT_READY;
    entry.texture = makeSupplyDataTexture(lumaGridToTextureData(luma, size, size), size, size);
  }
  return { texture: entry.texture, ready: true };
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
  if (kind === 'path') return getPathRasterTexture(config);
  if (kind === 'edge') return getEdgeCaptureTextureState();
  return null;
}
