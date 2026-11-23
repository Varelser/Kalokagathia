/**
 * Fragment collections (Phase 17 stage 4 — Geometry Collection
 * equivalent, first step: the ASSET form of a fracture division).
 *
 * Until this phase a Voronoi fracture division existed only as a
 * by-product of a bake: the parameters (cells / seed / gap) lived
 * in config, and the division itself — the per-particle cell
 * assignment computed by buildFractureCellData — was discarded
 * with every re-bake. A FragmentCollection names and freezes
 * that division:
 *
 *   { name, signature, assignment (RLE + base64), clusters }
 *
 * - signature records the bake conditions the division belongs
 *   to (morph target / particle count / requested cells /
 *   fracture seed / effective gap). A saved collection is only
 *   ever COMPARED against the current conditions — a mismatch is
 *   reported, never silently applied (the audit's re-bake rule).
 * - clusters are the connected components of the rigid solver's
 *   glue bonds: { collection → clusters → bodies }, two levels.
 *   They are derived data (recomputable from the assignment's
 *   cell table + the bond rule) but stored so a reader does not
 *   need the centroids to know the grouping.
 * - The rigid solver's DYNAMIC state (positions, velocities,
 *   sleep, broken bonds) is deliberately NOT part of the asset:
 *   this phase freezes the division, not a simulation moment.
 * - Multi-polyhedron solidification and mesh collision are out
 *   of scope (audit item 4, shortage 5 stays open).
 *
 * Everything here is pure and deterministic: the same cell data
 * always serialises to the same JSON text. Nothing in the bake,
 * the solver or the renderer reads this module's stored form —
 * an unsaved / unused collection changes no behaviour at all.
 * The one bridge is the bake publication registry at the bottom:
 * the runtime publishes its latest FractureCellData (write-only
 * metadata) so the panel can offer "save the current division"
 * without the panel ever touching the bake.
 */

import type { FractureCellData } from './voronoiFracture';

export interface FragmentCollectionSignature {
  /** Morph target the cloud was baked for (config gpgpuMorphTarget). */
  sourceTarget: string;
  /** Particle slots the assignment covers (texSize²). */
  particleCount: number;
  /** Requested division cell count (the fracture Cells key). */
  cells: number;
  /** Fracture seed the division was drawn with. */
  fractureSeed: number;
  /** Effective gap the cell data was computed with (0 while the
   *  fracture itself is disabled — the rigidFracture rule). */
  gap: number;
}

export interface FragmentCluster {
  /** Cluster index (0-based, in first-body order). */
  id: number;
  /** Body indices in this cluster, ascending. */
  bodies: number[];
  /** Total member particles over the cluster's bodies. */
  particleCount: number;
}

export interface FragmentCollection {
  version: 1;
  name: string;
  signature: FragmentCollectionSignature;
  /** Non-empty cells in the division (= FractureCellData.bodyCount). */
  bodyCount: number;
  /** Member count per body (sums to signature.particleCount). */
  cellCounts: number[];
  /** Per-particle body index, run-length encoded then base64. */
  assignmentRleB64: string;
  clusters: FragmentCluster[];
}

/** Hard cap for the serialised key, in the gpgpuGroups spirit:
 *  a 512² assignment RLE-compresses far below this in practice
 *  (measured in the stage-4 test), the cap only stops a pasted
 *  or corrupted payload from growing the config without bound. */
export const FRAGMENT_COLLECTION_MAX_CHARS = 4_000_000;

/** The glue distance factor of lib/rigidBodies.ts
 *  (GLUE_DISTANCE_FACTOR there): bonds form between bodies whose
 *  centroids start within (coreI + coreJ) × this factor. Kept as
 *  a named mirror so cluster derivation follows the solver's own
 *  adjacency rule; if the solver's factor changes, this must too. */
export const FRAGMENT_GLUE_DISTANCE_FACTOR = 1.35;

export type FragmentBondPair = readonly [number, number];

/**
 * The glue bonds createRigidSolver would form for this cell
 * table (glue enabled): every pair whose centroid distance is
 * within (coreI + coreJ) × FRAGMENT_GLUE_DISTANCE_FACTOR.
 * Pure; reads centroids / coreRadii only.
 */
export function deriveGlueBonds(cellData: FractureCellData): FragmentBondPair[] {
  const n = cellData.bodyCount;
  const bonds: FragmentBondPair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = (cellData.centroids[j * 3] ?? 0) - (cellData.centroids[i * 3] ?? 0);
      const dy = (cellData.centroids[j * 3 + 1] ?? 0) - (cellData.centroids[i * 3 + 1] ?? 0);
      const dz = (cellData.centroids[j * 3 + 2] ?? 0) - (cellData.centroids[i * 3 + 2] ?? 0);
      const d = Math.hypot(dx, dy, dz);
      const reach = ((cellData.coreRadii[i] ?? 0) + (cellData.coreRadii[j] ?? 0)) * FRAGMENT_GLUE_DISTANCE_FACTOR;
      if (d <= reach) bonds.push([i, j]);
    }
  }
  return bonds;
}

/**
 * Connected components of the bond graph over `bodyCount`
 * bodies (union-find). Deterministic: clusters are ordered by
 * their smallest body index, bodies inside a cluster ascend,
 * and isolated bodies form single-body clusters.
 */
export function deriveFragmentClusters(
  bodyCount: number,
  cellCounts: ArrayLike<number>,
  bonds: ReadonlyArray<FragmentBondPair>,
): FragmentCluster[] {
  const parent = new Int32Array(bodyCount);
  for (let i = 0; i < bodyCount; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== r) { const next = parent[c]; parent[c] = r; c = next; }
    return r;
  };
  for (const [a, b] of bonds) {
    if (a < 0 || b < 0 || a >= bodyCount || b >= bodyCount || a === b) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < bodyCount; i++) {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(i);
    else byRoot.set(r, [i]);
  }
  const groups = [...byRoot.values()].sort((g1, g2) => g1[0] - g2[0]);
  return groups.map((bodies, id) => ({
    id,
    bodies,
    particleCount: bodies.reduce((sum, b) => sum + (cellCounts[b] ?? 0), 0),
  }));
}

// ── Assignment codec: RLE (varint pairs) + base64 ─────────────
// Byte format: a sequence of (value, runLength) unsigned LEB128
// varints. Values are body indices (0..63 in practice), runs can
// be long (a whole cell's members are rarely contiguous in
// particle order, but ordered clouds compress well). The format
// is fixed and canonical, so encoding is a pure function of the
// assignment — the same division always yields the same text.

function pushVarint(bytes: number[], value: number): void {
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array | null {
  if (b64 === '') return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeAssignmentRle(assignment: ArrayLike<number>): string {
  const bytes: number[] = [];
  const n = assignment.length;
  let i = 0;
  while (i < n) {
    const value = assignment[i];
    let run = 1;
    while (i + run < n && assignment[i + run] === value) run += 1;
    pushVarint(bytes, value);
    pushVarint(bytes, run);
    i += run;
  }
  return bytesToBase64(Uint8Array.from(bytes));
}

/**
 * Decode an RLE assignment. Returns null on any malformation:
 * bad base64, a truncated varint, a zero run, or a total length
 * different from `particleCount` (when given, > 0).
 */
export function decodeAssignmentRle(b64: string, particleCount = 0): Int32Array | null {
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  const values: number[] = [];
  let pos = 0;
  const readVarint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      pos += 1;
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 28) return null;
    }
    return null;
  };
  while (pos < bytes.length) {
    const value = readVarint();
    const run = readVarint();
    if (value === null || run === null || run <= 0) return null;
    for (let k = 0; k < run; k++) values.push(value);
    if (particleCount > 0 && values.length > particleCount) return null;
  }
  if (particleCount > 0 && values.length !== particleCount) return null;
  return Int32Array.from(values);
}

// ── Build / serialise / parse ─────────────────────────────────

export function buildFragmentCollection(
  cellData: FractureCellData,
  options: {
    name: string;
    signature: FragmentCollectionSignature;
    /** Bond pairs to cluster by; defaults to the solver's glue
     *  rule over this cell table (deriveGlueBonds). */
    bonds?: ReadonlyArray<FragmentBondPair>;
  },
): FragmentCollection {
  const cellCounts = Array.from(cellData.cellCounts as ArrayLike<number>);
  const bonds = options.bonds ?? deriveGlueBonds(cellData);
  return {
    version: 1,
    name: options.name,
    signature: { ...options.signature },
    bodyCount: cellData.bodyCount,
    cellCounts,
    assignmentRleB64: encodeAssignmentRle(cellData.assignment),
    clusters: deriveFragmentClusters(cellData.bodyCount, cellData.cellCounts, bonds),
  };
}

export function serializeFragmentCollection(collection: FragmentCollection): string | null {
  const text = JSON.stringify(collection);
  return text.length <= FRAGMENT_COLLECTION_MAX_CHARS ? text : null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseSignature(raw: unknown): FragmentCollectionSignature | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.sourceTarget !== 'string' || s.sourceTarget.length === 0) return null;
  if (!isFiniteNumber(s.particleCount) || Math.round(s.particleCount) !== s.particleCount || s.particleCount <= 0) return null;
  if (!isFiniteNumber(s.cells) || Math.round(s.cells) !== s.cells || s.cells <= 0) return null;
  if (!isFiniteNumber(s.fractureSeed) || Math.round(s.fractureSeed) !== s.fractureSeed) return null;
  if (!isFiniteNumber(s.gap) || s.gap < 0 || s.gap > 1) return null;
  return {
    sourceTarget: s.sourceTarget,
    particleCount: s.particleCount,
    cells: s.cells,
    fractureSeed: s.fractureSeed,
    gap: s.gap,
  };
}

/**
 * Parse + fully validate the serialised key. Anything malformed
 * returns null (the config must never crash the app): the
 * assignment must decode to exactly particleCount entries, the
 * per-body counts recomputed from it must equal cellCounts, and
 * the clusters must partition the bodies exactly.
 */
export function parseFragmentCollection(json: string): FragmentCollection | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.version !== 1) return null;
  if (typeof c.name !== 'string' || c.name.length === 0) return null;
  const signature = parseSignature(c.signature);
  if (!signature) return null;
  if (!isFiniteNumber(c.bodyCount) || Math.round(c.bodyCount) !== c.bodyCount || c.bodyCount <= 0) return null;
  const bodyCount = c.bodyCount;
  if (!Array.isArray(c.cellCounts) || c.cellCounts.length !== bodyCount) return null;
  const cellCounts: number[] = [];
  for (const v of c.cellCounts) {
    if (!isFiniteNumber(v) || Math.round(v) !== v || v <= 0) return null;
    cellCounts.push(v);
  }
  if (cellCounts.reduce((a, b) => a + b, 0) !== signature.particleCount) return null;
  if (typeof c.assignmentRleB64 !== 'string' || c.assignmentRleB64.length === 0) return null;
  const assignment = decodeAssignmentRle(c.assignmentRleB64, signature.particleCount);
  if (!assignment) return null;
  const recomputed = new Int32Array(bodyCount);
  for (const b of assignment) {
    if (b < 0 || b >= bodyCount) return null;
    recomputed[b] += 1;
  }
  for (let b = 0; b < bodyCount; b++) if (recomputed[b] !== cellCounts[b]) return null;
  if (!Array.isArray(c.clusters) || c.clusters.length === 0 || c.clusters.length > bodyCount) return null;
  const seenBodies = new Set<number>();
  const clusters: FragmentCluster[] = [];
  for (let i = 0; i < c.clusters.length; i++) {
    const cl = c.clusters[i] as Record<string, unknown> | null;
    if (!cl || typeof cl !== 'object') return null;
    if (cl.id !== i) return null;
    if (!Array.isArray(cl.bodies) || cl.bodies.length === 0) return null;
    const bodies: number[] = [];
    for (const b of cl.bodies) {
      if (!isFiniteNumber(b) || Math.round(b) !== b || b < 0 || b >= bodyCount || seenBodies.has(b)) return null;
      seenBodies.add(b);
      bodies.push(b);
    }
    const expected = bodies.reduce((sum, b) => sum + cellCounts[b], 0);
    if (cl.particleCount !== expected) return null;
    clusters.push({ id: i, bodies, particleCount: expected });
  }
  if (seenBodies.size !== bodyCount) return null;
  return {
    version: 1,
    name: c.name.slice(0, 120),
    signature,
    bodyCount,
    cellCounts,
    assignmentRleB64: c.assignmentRleB64,
    clusters,
  };
}

/** The decoded per-particle body assignment of a collection. */
export function decodeCollectionAssignment(collection: FragmentCollection): Int32Array | null {
  return decodeAssignmentRle(collection.assignmentRleB64, collection.signature.particleCount);
}

// ── Signature matching ────────────────────────────────────────
// A saved division belongs to ONE bake condition set. Matching
// is exact on the discrete fields and tight on gap; the caller
// reports differences instead of applying anything.

export type FragmentSignatureField = 'sourceTarget' | 'particleCount' | 'cells' | 'fractureSeed' | 'gap';

export function fragmentSignatureDiffs(
  saved: FragmentCollectionSignature,
  current: FragmentCollectionSignature,
): FragmentSignatureField[] {
  const diffs: FragmentSignatureField[] = [];
  if (saved.sourceTarget !== current.sourceTarget) diffs.push('sourceTarget');
  if (saved.particleCount !== current.particleCount) diffs.push('particleCount');
  if (saved.cells !== current.cells) diffs.push('cells');
  if (saved.fractureSeed !== current.fractureSeed) diffs.push('fractureSeed');
  if (Math.abs(saved.gap - current.gap) > 1e-6) diffs.push('gap');
  return diffs;
}

export function fragmentSignatureMatches(
  saved: FragmentCollectionSignature,
  current: FragmentCollectionSignature,
): boolean {
  return fragmentSignatureDiffs(saved, current).length === 0;
}

// ── Bake publication registry ─────────────────────────────────
// The runtime's bake produces FractureCellData inside the
// runtime hook; the control panel has no handle to it. The
// runtime therefore PUBLISHES each bake's cell table here
// (write-only: nothing reads this to bake, solve or draw), and
// the panel reads it to offer "save the current division as a
// collection". Publication happens only when a bake actually
// produced cell data (the rigid solver path); with the solver
// off nothing is published and the panel says so.

export interface PublishedFragmentBake {
  cellData: FractureCellData;
  signature: FragmentCollectionSignature;
}

let publishedFragmentBake: PublishedFragmentBake | null = null;

export function publishFragmentBake(bake: PublishedFragmentBake): void {
  publishedFragmentBake = bake;
}

export function getPublishedFragmentBake(): PublishedFragmentBake | null {
  return publishedFragmentBake;
}

export function clearPublishedFragmentBake(): void {
  publishedFragmentBake = null;
}
