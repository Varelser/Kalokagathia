import type { DensityField } from './stateCacheSkinning';
import { PYRO_GRID_RESOLUTIONS, PYRO_GRID_TEMP_MAX } from './pyroGrid';

/**
 * Grid package import (Layer 3, B3-2): read a "grid package"
 * produced by the VDB conversion helper (kalokagathia-pro/
 * layer3-b3-2/vdb_to_package.py, which runs on pyopenvdb inside
 * Blender) and turn its density grid into a DensityField the
 * existing skinning pipeline (stateCacheSkinning.ts) can consume.
 *
 * WHY A PACKAGE AND NOT A .vdb READER: the linkage design
 * (LAYER3_LINKAGE_DESIGN.md) rejected a pure-TS .vdb reader as
 * the main line. OpenVDB stays on the helper side, where it is
 * already proven (B3-1 export + gate G-A1-4); the product side
 * reads a plain dense float32 block per frame and grid, plus a
 * JSON manifest that keeps the VDB index-to-world transform
 * explicit so the mapping can be verified instead of assumed.
 *
 * PACKAGE LAYOUT (format grid-package-v1):
 *   manifest.json          — the manifest below
 *   f<frame>_<grid>.f32    — dims[0]*dims[1]*dims[2] little-endian
 *                            float32, index = x + dx*(y + dy*z),
 *                            the same layout DensityField uses.
 * The manifest's box is one index box for the whole sequence
 * (the helper fixes it across frames), so every frame shares
 * the same index frame and the same world mapping.
 *
 * WORLD MAPPING (the half-cell trap, LAYER3_B3_2_PREP.md §4):
 * the product DensityField is a NODE field: node i sits at
 * world -extent + i*spacing. The package keeps the VDB
 * transform as (indexOriginWorld, voxelSize): VDB index j sits
 * at indexOriginWorld + voxelSize*j. densityFieldFromGridPackage
 * therefore sets, per axis,
 *   spacing = voxelSize,
 *   extent  = -(indexOriginWorld + voxelSize * indexMin),
 * so node (local) i of the field is exactly VDB index
 * indexMin + i, at exactly the VDB world position. Nothing is
 * resampled and no half-cell shift is introduced. A grid whose
 * per-axis extents or spacings differ cannot be represented by
 * the (single extent, single spacing) DensityField shape; the
 * constructor refuses it with a visible error instead of
 * silently shifting or stretching it.
 *
 * GRID NAMES (LAYER3_B3_2_PREP.md §3): density maps to the
 * DensityField here; temperature / flame / fuel / velocity are
 * reserved for the Pyro slice (B3-2 slice 2) and are reported,
 * not consumed, by this module; sdf belongs to the collider
 * route. Any grid the mapping does not know is listed in the
 * manifest's unmappedGrids and surfaced by gridPackageReport —
 * never silently dropped.
 */

export const GRID_PACKAGE_FORMAT = 'grid-package-v1';

/** Grid names this import path knows about (prep §3). */
export const GRID_PACKAGE_KNOWN_GRIDS: Readonly<Record<string, string>> = {
  density: 'densityField',
  temperature: 'pyroTemperature',
  flame: 'pyroFuel',
  fuel: 'pyroFuel',
  vel: 'pyroVelocity',
  velocity: 'pyroVelocity',
  sdf: 'colliderRoute',
};

export interface GridPackageGridInfo {
  name: string;
  gridClass?: string;
  valueType?: string;
  /** Set by the helper when a grid was present but not exported
   *  (e.g. a vector grid in slice 1), with the reason. */
  deferred?: string;
}

export interface GridPackageFrame {
  index: number;
  sourceFile?: string;
  /** grid name -> package-relative .f32 file name */
  files: Record<string, string>;
}

export interface GridPackageManifest {
  format: string;
  box: {
    indexMin: [number, number, number];
    dims: [number, number, number];
  };
  transform: {
    voxelSize: [number, number, number];
    /** World position of VDB index (0,0,0), per axis. */
    indexOriginWorld: [number, number, number];
  };
  grids: GridPackageGridInfo[];
  unmappedGrids: string[];
  frames: GridPackageFrame[];
}

export type GridPackageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const fail = <T>(error: string): GridPackageResult<T> => ({ ok: false, error });

const isNum3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Parse and validate a manifest (already JSON-parsed input). */
export function parseGridPackageManifest(
  input: unknown,
): GridPackageResult<GridPackageManifest> {
  if (typeof input !== 'object' || input === null) {
    return fail('グリッドパッケージの manifest がオブジェクトではありません。');
  }
  const m = input as Record<string, unknown>;
  if (m.format !== GRID_PACKAGE_FORMAT) {
    return fail(`グリッドパッケージの形式が想定と違います（format=${String(m.format)}、想定 ${GRID_PACKAGE_FORMAT}）。`);
  }
  const box = m.box as Record<string, unknown> | undefined;
  if (!box || !isNum3(box.indexMin) || !isNum3(box.dims) ||
      !box.dims.every((d) => Number.isInteger(d) && d > 0)) {
    return fail('グリッドパッケージの box（indexMin / dims）が不正です。');
  }
  const tr = m.transform as Record<string, unknown> | undefined;
  if (!tr || !isNum3(tr.voxelSize) || !isNum3(tr.indexOriginWorld) ||
      !tr.voxelSize.every((s) => s > 0)) {
    return fail('グリッドパッケージの transform（voxelSize / indexOriginWorld）が不正です。');
  }
  if (!Array.isArray(m.frames) || m.frames.length === 0) {
    return fail('グリッドパッケージにフレームがありません。');
  }
  for (const f of m.frames as Array<Record<string, unknown>>) {
    if (typeof f !== 'object' || f === null ||
        typeof f.index !== 'number' ||
        typeof f.files !== 'object' || f.files === null) {
      return fail('グリッドパッケージのフレーム記述が不正です。');
    }
  }
  if (!Array.isArray(m.grids)) {
    return fail('グリッドパッケージの grids 一覧がありません。');
  }
  return {
    ok: true,
    value: {
      format: GRID_PACKAGE_FORMAT,
      box: {
        indexMin: box.indexMin as [number, number, number],
        dims: box.dims as [number, number, number],
      },
      transform: {
        voxelSize: tr.voxelSize as [number, number, number],
        indexOriginWorld: tr.indexOriginWorld as [number, number, number],
      },
      grids: m.grids as GridPackageGridInfo[],
      unmappedGrids: Array.isArray(m.unmappedGrids)
        ? (m.unmappedGrids as string[])
        : [],
      frames: m.frames as GridPackageFrame[],
    },
  };
}

/** What the package contains, in reporting form: known grids,
 *  unmapped grids (never dropped silently), and grids the
 *  helper saw but deferred. */
export function gridPackageReport(manifest: GridPackageManifest): {
  frameCount: number;
  knownGrids: string[];
  unmappedGrids: string[];
  deferredGrids: { name: string; reason: string }[];
} {
  return {
    frameCount: manifest.frames.length,
    knownGrids: manifest.grids
      .map((g) => g.name)
      .filter((n) => n in GRID_PACKAGE_KNOWN_GRIDS),
    unmappedGrids: [...manifest.unmappedGrids],
    deferredGrids: manifest.grids
      .filter((g) => g.deferred)
      .map((g) => ({ name: g.name, reason: g.deferred as string })),
  };
}

/** Read one frame's grid values out of its .f32 bytes. */
export function gridPackageFrameValues(
  manifest: GridPackageManifest,
  frameIndex: number,
  gridName: string,
  bytes: ArrayBuffer | Uint8Array,
): GridPackageResult<Float32Array> {
  const frame = manifest.frames.find((f) => f.index === frameIndex);
  if (!frame) {
    return fail(`フレーム ${frameIndex} がグリッドパッケージにありません。`);
  }
  if (!(gridName in frame.files)) {
    return fail(`フレーム ${frameIndex} にグリッド「${gridName}」がありません。`);
  }
  const [dx, dy, dz] = manifest.box.dims;
  const count = dx * dy * dz;
  const u8 = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes);
  if (u8.byteLength !== count * 4) {
    return fail(`グリッド「${gridName}」のデータ長が想定と違います（${u8.byteLength} バイト、想定 ${count * 4}）。`);
  }
  const copy = new Uint8Array(count * 4);
  copy.set(u8);
  return { ok: true, value: new Float32Array(copy.buffer) };
}

/**
 * Build a DensityField from a package frame's density grid.
 * The field's values are the package values verbatim (no
 * resampling); extent/spacing are derived from the package
 * transform as documented in the header, and a package whose
 * transform the DensityField shape cannot represent exactly
 * is refused with a visible error. usedParticles /
 * skippedParticles carry no meaning for a grid-origin field
 * and are 0; the provenance of the field is this constructor
 * itself (compare buildDensityField for particle-origin fields).
 */
export function densityFieldFromGridPackage(
  manifest: GridPackageManifest,
  frameIndex: number,
  bytes: ArrayBuffer | Uint8Array,
  gridName = 'density',
): GridPackageResult<DensityField> {
  const [dx, dy, dz] = manifest.box.dims;
  if (dx !== dy || dy !== dz) {
    return fail(`グリッドの寸法が立方体ではありません（${dx}×${dy}×${dz}）。DensityField は立方体格子だけを扱います。`);
  }
  const vs = manifest.transform.voxelSize;
  if (vs[0] !== vs[1] || vs[1] !== vs[2]) {
    return fail(`ボクセル間隔が軸ごとに異なります（${vs.join(', ')}）。DensityField は一様間隔だけを表せるため、このグリッドは取り込めません。`);
  }
  const origin = manifest.transform.indexOriginWorld;
  const indexMin = manifest.box.indexMin;
  const extents = [0, 1, 2].map(
    (k) => -(origin[k] + vs[k] * indexMin[k]),
  );
  if (extents[0] !== extents[1] || extents[1] !== extents[2]) {
    return fail(`グリッドの原点が軸対称ではありません（extent 換算 ${extents.join(', ')}）。DensityField は単一の extent だけを表せるため、このグリッドは取り込めません。`);
  }
  const extent = extents[0];
  if (!(extent > 0)) {
    return fail(`グリッドの原点から求めた extent が正ではありません（${extent}）。`);
  }
  const values = gridPackageFrameValues(manifest, frameIndex, gridName, bytes);
  if (!values.ok) return values;
  return {
    ok: true,
    value: {
      resolution: dx,
      extent,
      spacing: vs[0],
      values: values.value,
      usedParticles: 0,
      skippedParticles: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pyro seeding (B3-2 slice 2): package frame -> Pyro initial fields.  */
/*                                                                     */
/* The Pyro grid (lib/pyroGrid.ts) is a CELL-centred solver grid at a  */
/* fixed resolution {32,48,64,96} over the cube [-halfExtent,          */
/* +halfExtent]^3. Seeding resamples the package through world space:  */
/* each Pyro cell centre's world position is mapped into the           */
/* package's continuous index coordinates and trilinearly sampled      */
/* (the package values are node samples at integer indices; outside    */
/* the package box the field is 0 — no silent extrapolation).          */
/*                                                                     */
/* Unit bridges, all explicit: density passes through (densityScale,   */
/* default 1); temperature is divided by temperatureScale (required —  */
/* VDB temperatures are physical-scale, Pyro's are normalised to       */
/* [0, PYRO_GRID_TEMP_MAX], and the number of cells the clamp touches  */
/* is reported); velocity is converted from world units/second to      */
/* cells/second by dividing by the cell world width. A grid the        */
/* package does not carry becomes a zero field and is NAMED in the     */
/* report's absent list — never silently dropped. Only a missing       */
/* density grid is an error, since a seed without density is not a     */
/* seed. The GPU passes consume fields elsewhere; this is the data     */
/* path only, independent of the drawing path (same rule as the        */
/* skinning module).                                                   */
/* ------------------------------------------------------------------ */

export interface PyroSeedOptions {
  /** One of PYRO_GRID_RESOLUTIONS. */
  resolution: number;
  /** Half-extent of the Pyro cube, world units. */
  halfExtent: number;
  /** World temperature units per one Pyro temperature unit. */
  temperatureScale: number;
  densityScale?: number;
  fuelScale?: number;
}

export interface PyroSeed {
  resolution: number;
  halfExtent: number;
  /** Cell layout: index = x + n*(y + n*z), n = resolution. */
  density: Float32Array;
  temperature: Float32Array;
  fuel: Float32Array;
  /** Cells/second per component, or null when the package has
   *  no velocity grid. */
  velocity: { x: Float32Array; y: Float32Array; z: Float32Array } | null;
  report: {
    gridsUsed: string[];
    gridsAbsent: string[];
    clampedTemperatureCells: number;
  };
}

const sampleTrilinear = (
  values: Float32Array,
  dims: [number, number, number],
  lx: number, ly: number, lz: number,
): number => {
  const axis = (l: number): [number, number, number] => {
    const i0 = Math.floor(l);
    return [i0, i0 + 1, l - i0];
  };
  const [x0, x1, fx] = axis(lx);
  const [y0, y1, fy] = axis(ly);
  const [z0, z1, fz] = axis(lz);
  const at = (x: number, y: number, z: number): number =>
    (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2])
      ? 0
      : values[x + dims[0] * (y + dims[1] * z)];
  let sum = 0;
  for (const [x, wx] of [[x0, 1 - fx], [x1, fx]] as const) {
    for (const [y, wy] of [[y0, 1 - fy], [y1, fy]] as const) {
      for (const [z, wz] of [[z0, 1 - fz], [z1, fz]] as const) {
        sum += wx * wy * wz * at(x, y, z);
      }
    }
  }
  return sum;
};

export function pyroSeedFromGridPackage(
  manifest: GridPackageManifest,
  frameIndex: number,
  files: Readonly<Record<string, ArrayBuffer | Uint8Array>>,
  options: PyroSeedOptions,
): GridPackageResult<PyroSeed> {
  const n = options.resolution;
  if (!PYRO_GRID_RESOLUTIONS.includes(n)) {
    return fail(`Pyro 解像度 ${n} は固定集合 {${PYRO_GRID_RESOLUTIONS.join(', ')}} にありません。`);
  }
  const halfExtent = options.halfExtent;
  if (!Number.isFinite(halfExtent) || halfExtent <= 0) {
    return fail(`halfExtent（${String(halfExtent)}）が正の有限値ではありません。`);
  }
  const temperatureScale = options.temperatureScale;
  if (!Number.isFinite(temperatureScale) || temperatureScale <= 0) {
    return fail(`temperatureScale（${String(temperatureScale)}）が正の有限値ではありません。温度の単位橋渡しは必須です。`);
  }
  const densityScale = options.densityScale ?? 1;
  const fuelScale = options.fuelScale ?? 1;
  const frame = manifest.frames.find((f) => f.index === frameIndex);
  if (!frame) {
    return fail(`フレーム ${frameIndex} がグリッドパッケージにありません。`);
  }
  const load = (grid: string): GridPackageResult<Float32Array | null> => {
    const fileName = frame.files[grid];
    if (!fileName) return { ok: true, value: null };
    const bytes = files[fileName];
    if (!bytes) {
      return fail(`グリッド「${grid}」のファイル ${fileName} のバイト列が渡されていません。`);
    }
    return gridPackageFrameValues(manifest, frameIndex, grid, bytes);
  };
  const densityRaw = load('density');
  if (!densityRaw.ok) return densityRaw;
  if (!densityRaw.value) {
    return fail('グリッドパッケージに density グリッドがありません。種には density が必須です。');
  }
  const temperatureRaw = load('temperature');
  if (!temperatureRaw.ok) return temperatureRaw;
  const fuelName = 'flame' in frame.files ? 'flame' : 'fuel';
  const fuelRaw = load(fuelName);
  if (!fuelRaw.ok) return fuelRaw;
  const velName = manifest.grids.some((g) => g.name === 'vel') ? 'vel' : 'velocity';
  const velParts: (Float32Array | null)[] = [];
  for (const axisName of ['x', 'y', 'z'] as const) {
    const part = load(`${velName}_${axisName}`);
    if (!part.ok) return part;
    velParts.push(part.value);
  }
  const hasVelocity = velParts.every((p) => p !== null);

  const dims = manifest.box.dims;
  const indexMin = manifest.box.indexMin;
  const origin = manifest.transform.indexOriginWorld;
  const vs = manifest.transform.voxelSize;
  const cellWorld = (2 * halfExtent) / n;
  const count = n * n * n;
  const density = new Float32Array(count);
  const temperature = new Float32Array(count);
  const fuel = new Float32Array(count);
  const velocity = hasVelocity
    ? { x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count) }
    : null;
  let clampedTemperatureCells = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = x + n * (y + n * z);
        const wx = -halfExtent + (x + 0.5) * cellWorld;
        const wy = -halfExtent + (y + 0.5) * cellWorld;
        const wz = -halfExtent + (z + 0.5) * cellWorld;
        const lx = (wx - origin[0]) / vs[0] - indexMin[0];
        const ly = (wy - origin[1]) / vs[1] - indexMin[1];
        const lz = (wz - origin[2]) / vs[2] - indexMin[2];
        density[idx] = densityScale *
          sampleTrilinear(densityRaw.value, dims, lx, ly, lz);
        if (temperatureRaw.value) {
          let t = sampleTrilinear(temperatureRaw.value, dims, lx, ly, lz) /
            temperatureScale;
          if (t > PYRO_GRID_TEMP_MAX) { t = PYRO_GRID_TEMP_MAX; clampedTemperatureCells++; }
          if (t < 0) t = 0;
          temperature[idx] = t;
        }
        if (fuelRaw.value) {
          fuel[idx] = fuelScale *
            sampleTrilinear(fuelRaw.value, dims, lx, ly, lz);
        }
        if (velocity) {
          velocity.x[idx] = sampleTrilinear(velParts[0] as Float32Array, dims, lx, ly, lz) / cellWorld;
          velocity.y[idx] = sampleTrilinear(velParts[1] as Float32Array, dims, lx, ly, lz) / cellWorld;
          velocity.z[idx] = sampleTrilinear(velParts[2] as Float32Array, dims, lx, ly, lz) / cellWorld;
        }
      }
    }
  }
  const gridsUsed = ['density'];
  if (temperatureRaw.value) gridsUsed.push('temperature');
  if (fuelRaw.value) gridsUsed.push(fuelName);
  if (hasVelocity) gridsUsed.push(velName);
  const gridsAbsent: string[] = [];
  if (!temperatureRaw.value) gridsAbsent.push('temperature');
  if (!fuelRaw.value) gridsAbsent.push('fuel');
  if (!hasVelocity) gridsAbsent.push('velocity');
  return {
    ok: true,
    value: {
      resolution: n,
      halfExtent,
      density,
      temperature,
      fuel,
      velocity,
      report: { gridsUsed, gridsAbsent, clampedTemperatureCells },
    },
  };
}
