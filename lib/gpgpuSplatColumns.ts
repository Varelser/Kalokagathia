import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { parseDataTable, type DataTable } from './dataTable';
import { ATTR_COLOR_COLUMN_NAMES } from './attrPointCloud';
import { colorMasterEnabled } from './appStateConfigNormalization';

// ── Splat column data (Layer 1 WP7 Phase C3) ───────────────
// The second input form of the Gaussian splat draw: an
// independent column set (one row = one splat) converted into
// the primitive's texture payloads, next to the pool form
// (Phase C1/C2: centre = the pool position texture, parameter
// bake from lib/gpgpuSplatSupply.ts). This module is the
// render-side conversion only — "the columns have arrived at
// lib" is where it starts; file formats (PLY etc.) are the
// Layer 3 input side and are NOT read here.
//
// Column conventions (names matched case-insensitively, the
// attrPointCloud rule; a missing / non-numeric cell holds the
// previous valid value in the column, or the channel's
// initial value when nothing valid precedes it):
//   x / y / z            centre (z optional, 0 when absent;
//                        unnamed tables fall back to the
//                        first columns in order, the
//                        attrPointCloud convention)
//   scaleX/Y/Z           per-axis scale (else the uniform
//                        `scale` column, else 1)
//   quatX/Y/Z/W          rotation quaternion (normalised at
//                        build; absent = identity)
//   opacity              alpha in [0, 1] (absent = 1)
//   colorR / colorG / colorB
//                        the DC colour, RAW values — colour
//                        columns are exempt from range
//                        normalisation (the Phase CL rule:
//                        the values ARE the colour). Absent
//                        channel = 1, so an unauthored colour
//                        leaves the tint unchanged.
//
// Payload layout: the splat count N is independent of the
// pool's texSize; the four payloads are square textures of
// side ceil(√N), row-major, texel i = splat i, texels past N
// zero-filled (param opacity 0 / identity rotation, so a pad
// texel can never paint). The payloads reuse the pool form's
// layouts exactly (lib/gpgpuSplat.ts): centre (xyz, 1),
// param (scale xyz, opacity), rotation (quat xyzw), plus the
// DC colour payload (rgb, 1) read by uSplatColorTex.
//
// Sorting: the depth sort (runDepthSortPass) is reused by
// swapping the centre texture, but its bitonic network only
// totally orders a power-of-two grid (measured: non-pow2
// sides mis-order almost surely), while the payload side
// ceil(√N) is pow2 only by luck. The columns sort therefore
// runs on its own grid of side P = the smallest power of two
// ≥ the payload side, through a dedicated depth material
// (SPLAT_COLUMNS_SORT_DEPTH_FRAG in
// components/gpgpuShaderSimulationSort.ts): slot k of the
// sort grid maps to payload texel k, the depth entry writes
// the PAYLOAD uv (so the splat vertex consumes the sort
// texture in exactly the pool form), and every slot at or
// past the splat count writes SPLAT_COLUMNS_PAD_VIEW_Z so
// padding sorts to the tail and the first `count` slots are
// precisely the real splats, far to near.
//
// The store mirrors lib/attrPointCloud.ts (module-level,
// versioned, subscribed) except persistence: the payloads are
// derived render data (up to 8,192 × 14 floats), and the
// source text's persistence belongs to the Layer 3 import
// side that will own it. The store is in-memory only, like
// the transient attr-cloud swap.

/** Row cap, aligned with ATTR_CLOUD_MAX_ROWS. */
export const SPLAT_COLUMNS_MAX_ROWS = 8192;

/** viewZ written for every sort slot at or past the splat
 *  count: below any real depth, so padding sorts to the tail
 *  of the far-to-near order and is never consumed (instances
 *  read only the first `count` slots). The GLSL twin is the
 *  literal in SPLAT_COLUMNS_SORT_DEPTH_FRAG. */
export const SPLAT_COLUMNS_PAD_VIEW_Z = -1e18;

export interface SplatColumns {
  /** The source table, retained in full (every column). */
  table: DataTable;
  /** Number of splats (rows kept, ≤ SPLAT_COLUMNS_MAX_ROWS). */
  count: number;
  /** Side of the square payload textures: ceil(√count). */
  texSize: number;
  /** Centre payload, RGBA per texel: (x, y, z, 1) — the
   *  uCenterTex layout. */
  centerData: Float32Array;
  /** Parameter payload: (scale.x, scale.y, scale.z, opacity)
   *  — the uSplatParamTex layout. */
  paramData: Float32Array;
  /** Rotation payload: quaternion (x, y, z, w) — the
   *  uSplatRotTex layout. */
  rotData: Float32Array;
  /** DC colour payload: (r, g, b, 1), RAW authored values —
   *  the uSplatColorTex layout. */
  colorData: Float32Array;
  /** True when at least one colour column was present. */
  hasColor: boolean;
  /** Bumped on every store write; texture / geometry
   *  signatures key off the object identity + this version. */
  version: number;
}

/** Side of the square payload grid for `count` splats. */
export function splatColumnsTexSize(count: number): number {
  return count > 0 ? Math.ceil(Math.sqrt(count)) : 0;
}

/** Side of the columns sort grid: the smallest power of two
 *  ≥ the payload side, so the shared bitonic network totally
 *  orders the grid (see the header note). */
export function splatColumnsSortTexSize(columns: SplatColumns): number {
  let p = 1;
  while (p < columns.texSize) p *= 2;
  return p;
}

function fillColumn(table: DataTable, col: number, rows: number, initial: number): Float32Array {
  const out = new Float32Array(rows);
  let last = initial;
  for (let i = 0; i < rows; i++) {
    const value = col >= 0 ? table.rows[i]?.[col] : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) last = value;
    out[i] = last;
  }
  return out;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Build the splat column set from a parsed table. Returns
 * null when the table carries no usable position columns or
 * no real (x, y) point (the attrPointCloud validity rule).
 */
export function buildSplatColumns(table: DataTable, version = 0): SplatColumns | null {
  const rows = Math.min(table.rows.length, SPLAT_COLUMNS_MAX_ROWS);
  const cols = table.columns.length;
  if (rows === 0 || cols < 2) return null;
  const find = (name: string) => table.columns.findIndex((c) => c.trim().toLowerCase() === name);
  let xCol = find('x');
  let yCol = find('y');
  let zCol = find('z');
  if (xCol < 0 || yCol < 0 || xCol === yCol) {
    xCol = 0;
    yCol = 1;
    zCol = cols > 2 ? 2 : -1;
  }
  let hasPoint = false;
  for (let i = 0; i < rows; i++) {
    const x = table.rows[i][xCol];
    const y = table.rows[i][yCol];
    if (typeof x === 'number' && typeof y === 'number') {
      hasPoint = true;
      break;
    }
  }
  if (!hasPoint) return null;

  const xs = fillColumn(table, xCol, rows, 0);
  const ys = fillColumn(table, yCol, rows, 0);
  const zs = fillColumn(table, zCol, rows, 0);

  const scaleXCol = find('scalex');
  const scaleYCol = find('scaley');
  const scaleZCol = find('scalez');
  const scaleUniCol = find('scale');
  const scaleUni = fillColumn(table, scaleUniCol, rows, 1);
  const scaleXs = scaleXCol >= 0 ? fillColumn(table, scaleXCol, rows, 1) : scaleUni;
  const scaleYs = scaleYCol >= 0 ? fillColumn(table, scaleYCol, rows, 1) : scaleUni;
  const scaleZs = scaleZCol >= 0 ? fillColumn(table, scaleZCol, rows, 1) : scaleUni;

  const quatXs = fillColumn(table, find('quatx'), rows, 0);
  const quatYs = fillColumn(table, find('quaty'), rows, 0);
  const quatZs = fillColumn(table, find('quatz'), rows, 0);
  const quatWs = fillColumn(table, find('quatw'), rows, 1);

  const opacities = fillColumn(table, find('opacity'), rows, 1);

  const colorCols = ATTR_COLOR_COLUMN_NAMES.map((name) => find(name));
  const hasColor = colorCols.some((c) => c >= 0);
  const colorRs = fillColumn(table, colorCols[0], rows, 1);
  const colorGs = fillColumn(table, colorCols[1], rows, 1);
  const colorBs = fillColumn(table, colorCols[2], rows, 1);

  const texSize = splatColumnsTexSize(rows);
  const texels = texSize * texSize;
  const centerData = new Float32Array(texels * 4);
  const paramData = new Float32Array(texels * 4);
  const rotData = new Float32Array(texels * 4);
  const colorData = new Float32Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    if (i >= rows) {
      // Padding texel: invisible (opacity 0), identity
      // rotation, centre at the origin.
      centerData[i * 4 + 3] = 1;
      rotData[i * 4 + 3] = 1;
      continue;
    }
    centerData[i * 4] = xs[i];
    centerData[i * 4 + 1] = ys[i];
    centerData[i * 4 + 2] = zs[i];
    centerData[i * 4 + 3] = 1;
    paramData[i * 4] = Math.max(scaleXs[i], 0);
    paramData[i * 4 + 1] = Math.max(scaleYs[i], 0);
    paramData[i * 4 + 2] = Math.max(scaleZs[i], 0);
    paramData[i * 4 + 3] = clamp(opacities[i], 0, 1);
    let qx = quatXs[i];
    let qy = quatYs[i];
    let qz = quatZs[i];
    let qw = quatWs[i];
    const qLen = Math.hypot(qx, qy, qz, qw);
    if (qLen > 1e-12) {
      qx /= qLen;
      qy /= qLen;
      qz /= qLen;
      qw /= qLen;
    } else {
      qx = 0;
      qy = 0;
      qz = 0;
      qw = 1;
    }
    rotData[i * 4] = qx;
    rotData[i * 4 + 1] = qy;
    rotData[i * 4 + 2] = qz;
    rotData[i * 4 + 3] = qw;
    // RAW colour values, never normalised (Phase CL rule).
    colorData[i * 4] = colorRs[i];
    colorData[i * 4 + 1] = colorGs[i];
    colorData[i * 4 + 2] = colorBs[i];
    colorData[i * 4 + 3] = 1;
  }

  return {
    table,
    count: rows,
    texSize,
    centerData,
    paramData,
    rotData,
    colorData,
    hasColor,
    version,
  };
}

/** Parse CSV / TSV / JSON text into a splat column set. */
export function parseSplatColumns(text: string, version = 0): SplatColumns | null {
  const table = parseDataTable(text);
  if (!table) return null;
  return buildSplatColumns(table, version);
}

export interface SplatColumnsTextures {
  centerTex: THREE.DataTexture;
  paramTex: THREE.DataTexture;
  rotTex: THREE.DataTexture;
  colorTex: THREE.DataTexture;
}

function makePayloadTexture(data: Float32Array, texSize: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The four payload DataTextures for a column set. */
export function createSplatColumnsTextures(columns: SplatColumns): SplatColumnsTextures {
  return {
    centerTex: makePayloadTexture(columns.centerData, columns.texSize),
    paramTex: makePayloadTexture(columns.paramData, columns.texSize),
    rotTex: makePayloadTexture(columns.rotData, columns.texSize),
    colorTex: makePayloadTexture(columns.colorData, columns.texSize),
  };
}

/**
 * The instance aTexCoord array for the columns form: slot
 * i's uv over the SORT grid (side P — the vertex reads the
 * sort texture at the slot, exactly the pool form's
 * consumption, with the sort entry carrying the payload uv).
 */
export function buildSplatInstanceTexCoords(columns: SplatColumns): Float32Array {
  const sortSize = splatColumnsSortTexSize(columns);
  const coords = new Float32Array(columns.count * 2);
  for (let i = 0; i < columns.count; i++) {
    coords[i * 2] = ((i % sortSize) + 0.5) / sortSize;
    coords[i * 2 + 1] = (Math.floor(i / sortSize) + 0.5) / sortSize;
  }
  return coords;
}

export interface SplatColumnsSortEntry {
  /** Payload uv the entry carries (what the splat vertex
   *  reads as particleUv). */
  uv: [number, number];
  viewZ: number;
}

/**
 * CPU twin of SPLAT_COLUMNS_SORT_DEPTH_FRAG: the depth entry
 * for sort slot `slotIndex` (row-major over the sort grid).
 * `viewElements` is the view matrix in THREE column-major
 * element order. Slots at or past the splat count return the
 * pad depth (the fragment writes it without sampling).
 */
export function splatColumnsSortEntry(
  columns: SplatColumns,
  slotIndex: number,
  viewElements: readonly number[],
): SplatColumnsSortEntry {
  if (slotIndex >= columns.count) {
    return { uv: [0, 0], viewZ: SPLAT_COLUMNS_PAD_VIEW_Z };
  }
  const t = columns.texSize;
  const uv: [number, number] = [
    ((slotIndex % t) + 0.5) / t,
    (Math.floor(slotIndex / t) + 0.5) / t,
  ];
  const cx = columns.centerData[slotIndex * 4];
  const cy = columns.centerData[slotIndex * 4 + 1];
  const cz = columns.centerData[slotIndex * 4 + 2];
  const viewZ = viewElements[2] * cx + viewElements[6] * cy + viewElements[10] * cz + viewElements[14];
  return { uv, viewZ: -viewZ };
}

/** Which input form the splat draw consumes. */
export type SplatInputForm = 'pool' | 'columns';

/**
 * The input selection: the columns form holds while the
 * splat draw is enabled and a non-empty column set is in the
 * store; every other configuration is the pool form (the
 * C1/C2 behaviour, byte-identical).
 */
export function resolveSplatInputForm(
  config: Pick<ParticleConfig, 'gpgpuSplatEnabled'>,
  columns: SplatColumns | null,
): SplatInputForm {
  return config.gpgpuSplatEnabled && columns && columns.count > 0 ? 'columns' : 'pool';
}

/**
 * Whether the columns DC colour drives the splat colour.
 * The DC colour is a colour FEATURE (WP7 Phase A's rule):
 * it applies only while the colour master is on; with the
 * master off the splat keeps its single tint. The config may
 * be raw or colour-master-resolved — the resolution never
 * rewrites the master key itself, so the predicate reads the
 * same either way (the C2 supply's convention).
 */
export function splatColumnsColorActive(
  config: ParticleConfig,
  columns: SplatColumns | null,
): boolean {
  return resolveSplatInputForm(config, columns) === 'columns'
    && !!columns?.hasColor
    && colorMasterEnabled(config);
}

/* ---------------- shared store (editor <-> engine) ---------------- */

let currentColumns: SplatColumns | null = null;
let columnsVersion = 0;
const listeners = new Set<() => void>();

export function getSplatColumns(): SplatColumns | null {
  return currentColumns;
}

export function setSplatColumns(columns: SplatColumns | null): void {
  columnsVersion += 1;
  currentColumns = columns ? { ...columns, version: columnsVersion } : null;
  listeners.forEach((listener) => listener());
}

export function subscribeSplatColumns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSplatColumns(): SplatColumns | null {
  return React.useSyncExternalStore(subscribeSplatColumns, getSplatColumns, getSplatColumns);
}
