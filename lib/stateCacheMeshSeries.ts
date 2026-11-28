import {
  stateCacheExportAllowed,
  STATE_CACHE_FORMAT,
  STATE_CACHE_VERSION,
  type StateCacheData,
} from './gpgpuStateCache';
import {
  buildObjFromGrid,
  buildStlFromGrid,
  countMeshExport,
  type MeshExportStats,
} from './meshExport';

/**
 * Mesh series (Grammar 2.0 stage 3, slice S5): turn a state
 * cache (lib/gpgpuStateCache.ts, the canonical frame
 * sequence) into a TIME SERIES of grid-topology meshes —
 * one OBJ / STL document per frame. Design:
 * kalokagathia-pro/STAGE3_DESIGN.md §2 S5.
 *
 * Position in the asset layer: a mesh series is DERIVED
 * data of the cache — a dependent artefact that can always
 * be regenerated from the canonical form, never a second
 * canonical form. This module only reads the cache; the
 * canonical form is not changed by it, and nothing is
 * written back into it.
 *
 * Topology premise, verified against the code: the mesh
 * builders in lib/meshExport.ts assume the positions are a
 * regular row-major grid of texSize x texSize vertices
 * (consecutive texels form quads). A state cache satisfies
 * exactly that premise: assembleStateCache stores the
 * readback in texel order as count (= texSize^2) triplets,
 * so frame f's positions feed buildObjFromGrid /
 * buildStlFromGrid directly at (texSize, texSize) — no
 * reordering, no resampling. A cache whose manifest or
 * buffers break the premise (texSize^2 !== count, a frame
 * buffer that is not count x 3, a frame count that does
 * not match the manifest) is REFUSED with the reason,
 * never silently rearranged (the pointCache / stateCache
 * discipline).
 *
 * Single-frame behaviour is untouched by construction:
 * lib/meshExport.ts is not modified, and each series entry
 * is exactly the document the single-frame builder
 * produces for that frame's positions (the S5 test pins
 * the pre-S5 single-frame output byte-for-byte and checks
 * every series entry against the single-frame builder).
 *
 * Output shape: an OBJ (or STL) sequence, one file per
 * frame, named after the absolute frame number
 * (startFrame + index, zero-padded — the PRT export's
 * naming convention), delivered as ONE ZIP archive. The
 * per-file download route the older exports use does not
 * scale to a sequence: browsers throttle or block bursts
 * of programmatic downloads, so the series goes through
 * the codebase's existing ZIP parts (JSZip, lazily loaded
 * the way lib/deterministicRender.ts and
 * lib/useFrameExport.ts load it) and the user downloads
 * exactly one file. The ZIP is a container only — its
 * entries are the plain per-frame documents, unmodified.
 *
 * Edition gate: export is a full-edition feature (杉
 * decision, STAGE3_DESIGN §4.5-3), enforced in the ZIP
 * entry point below with the same predicate as the
 * state-cache save and the PRT / Alembic exports.
 */

export type MeshSeriesFormat = 'obj' | 'stl';

export const MESH_SERIES_ZIP_FILE_NAME = 'monosphere-mesh-series.zip';

export interface StateCacheMeshFrameFile {
  /** Index into the cache's frame sequence (0-based). */
  frameIndex: number;
  /** Absolute frame number (startFrame + frameIndex). */
  frameNumber: number;
  fileName: string;
  /** The single-frame document for this frame, verbatim. */
  contents: string;
  stats: MeshExportStats;
}

export type StateCacheMeshSeriesResult =
  | { ok: true; format: MeshSeriesFormat; files: StateCacheMeshFrameFile[] }
  | { ok: false; error: string };

export type StateCacheMeshSeriesZipResult =
  | {
      ok: true;
      fileName: string;
      buffer: ArrayBuffer;
      format: MeshSeriesFormat;
      fileCount: number;
      totalVertices: number;
      totalFaces: number;
    }
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** File name for one frame of the series — the PRT
 *  export's convention (absolute frame number, padded). */
export function meshSeriesFileNameForFrame(
  cache: StateCacheData,
  frameIndex: number,
  format: MeshSeriesFormat,
): string {
  const absolute = cache.manifest.startFrame + frameIndex;
  return `monosphere-mesh-${String(absolute).padStart(4, '0')}.${format}`;
}

/**
 * Check that a cache actually satisfies the grid-topology
 * premise the mesh builders need. The manifest's own
 * parser already guarantees texSize^2 === count for caches
 * that came through a file, but a held cache is a live
 * object, so the premise is re-stated here at the point of
 * use — a mismatch refuses, it never rearranges.
 */
export function validateCacheForMeshSeries(
  cache: StateCacheData,
): { ok: true } | { ok: false; error: string } {
  const { manifest } = cache;
  if (!manifest || typeof manifest !== 'object') return fail('マニフェストがありません。');
  if (manifest.format !== STATE_CACHE_FORMAT || manifest.version !== STATE_CACHE_VERSION) {
    return fail(
      `正本形式（${STATE_CACHE_FORMAT} v${STATE_CACHE_VERSION}）ではないため、時系列メッシュへ変換できません（format="${String(manifest.format)}"、version=${String(manifest.version)}）。`,
    );
  }
  if (!Number.isInteger(manifest.texSize) || manifest.texSize < 2) {
    return fail(
      `グリッドが ${String(manifest.texSize)}×${String(manifest.texSize)} のため面を張れません（メッシュ化には texSize 2 以上のグリッドが必要です）。`,
    );
  }
  if (manifest.texSize * manifest.texSize !== manifest.count) {
    return fail(
      `キャッシュの粒子数（${manifest.count.toLocaleString()} 点）がグリッド前提（texSize ${manifest.texSize} の二乗＝${(manifest.texSize * manifest.texSize).toLocaleString()} 点）と一致しないため、時系列メッシュへ変換できません。粒子の並べ替えやリサンプルはしません。`,
    );
  }
  if (!Number.isInteger(manifest.frameCount) || manifest.frameCount <= 0) {
    return fail('キャッシュにフレームがありません。');
  }
  if (cache.positions.length !== manifest.frameCount) {
    return fail(
      `フレーム列の長さ（${cache.positions.length}）がマニフェストの frameCount（${manifest.frameCount}）と一致しないため、時系列メッシュへ変換できません。`,
    );
  }
  for (let f = 0; f < manifest.frameCount; f++) {
    const pos = cache.positions[f];
    if (!pos || pos.length !== manifest.count * 3) {
      return fail(
        `フレーム ${f} の位置バッファ長（${pos ? pos.length : 0}）が粒子数×3（${manifest.count * 3}）と一致しないため、時系列メッシュへ変換できません。`,
      );
    }
  }
  return { ok: true };
}

/**
 * Build the per-frame mesh documents for a whole cache.
 * Each entry is produced by the EXISTING single-frame
 * builders on that frame's stored positions, so a series
 * frame and a single-frame export of the same positions
 * are the same document.
 */
export function buildStateCacheMeshSeries(
  cache: StateCacheData,
  format: MeshSeriesFormat = 'obj',
): StateCacheMeshSeriesResult {
  const valid = validateCacheForMeshSeries(cache);
  if (!valid.ok) return valid;
  const { manifest } = cache;
  const files: StateCacheMeshFrameFile[] = [];
  for (let f = 0; f < manifest.frameCount; f++) {
    const positions = cache.positions[f];
    const contents =
      format === 'stl'
        ? buildStlFromGrid(positions, manifest.texSize, manifest.texSize)
        : buildObjFromGrid(positions, manifest.texSize, manifest.texSize);
    files.push({
      frameIndex: f,
      frameNumber: manifest.startFrame + f,
      fileName: meshSeriesFileNameForFrame(cache, f, format),
      contents,
      stats: countMeshExport(positions, manifest.texSize, manifest.texSize),
    });
  }
  return { ok: true, format, files };
}

/**
 * The panel's export entry point: the edition gate (see
 * header) plus the series build, packed into ONE ZIP
 * archive (one entry per frame, entries verbatim). JSZip
 * is loaded lazily, mirroring lib/deterministicRender.ts,
 * so the library only enters the bundle on this route.
 * OBJ text compresses well, so the archive uses JSZip's
 * default DEFLATE (the frame-sequence exporters use STORE
 * because their PNG payloads are already compressed).
 */
export async function buildStateCacheMeshSeriesZip(
  cache: StateCacheData,
  options?: { format?: MeshSeriesFormat; edition?: string },
): Promise<StateCacheMeshSeriesZipResult> {
  const format = options?.format ?? 'obj';
  if (!stateCacheExportAllowed(options?.edition)) {
    return fail('公開版では時系列メッシュの書き出しはできません（完全版の機能です）。');
  }
  const series = buildStateCacheMeshSeries(cache, format);
  if (!series.ok) return series;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let totalVertices = 0;
  let totalFaces = 0;
  for (const file of series.files) {
    zip.file(file.fileName, file.contents);
    totalVertices += file.stats.vertices;
    totalFaces += file.stats.faces;
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return {
    ok: true,
    fileName: MESH_SERIES_ZIP_FILE_NAME,
    buffer,
    format,
    fileCount: series.files.length,
    totalVertices,
    totalFaces,
  };
}
