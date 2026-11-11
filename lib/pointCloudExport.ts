/**
 * Point-cloud export (roadmap Phase 9, PLY slice).
 *
 * The GPGPU particle system keeps its positions in a GPU texture
 * (xyz + age per texel). A one-shot readback channel lets the Play
 * tab request a single frame's positions: the panel sets
 * `requested`, the simulation loop performs one
 * readRenderTargetPixels into `buffer` and stamps `capturedAt`,
 * and the panel turns the buffer into a PLY download.
 *
 * This module holds the shared state shape and the pure PLY
 * builder; the GPU readback itself lives in the GPGPU system.
 */

export interface PointCloudCaptureState {
  /** Set by the requester; cleared by the simulation loop once served. */
  requested: boolean;
  /** RGBA texels: xyz = position, w = particle age. */
  buffer: { current: Float32Array | null };
  texSize: number;
  /** performance.now() of the last served capture; 0 = never. */
  capturedAt: number;
}

export function createPointCloudCaptureState(): PointCloudCaptureState {
  return { requested: false, buffer: { current: null }, texSize: 0, capturedAt: 0 };
}

export function countExportablePoints(data: Float32Array): number {
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (Number.isFinite(data[i]) && Number.isFinite(data[i + 1]) && Number.isFinite(data[i + 2])) {
      count++;
    }
  }
  return count;
}

/**
 * Build an ASCII PLY document from RGBA position texels.
 * Non-finite positions are dropped. The age channel is kept as a
 * scalar property so downstream tools can restyle or filter by it.
 */
export function buildPlyPointCloud(data: Float32Array): string {
  const count = countExportablePoints(data);
  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    'comment Monosphere GPGPU particle positions (xyz + age)',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float age',
    'end_header',
  ];
  for (let i = 0; i + 3 < data.length; i += 4) {
    const x = data[i];
    const y = data[i + 1];
    const z = data[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const age = Number.isFinite(data[i + 3]) ? data[i + 3] : 0;
    lines.push(`${x} ${y} ${z} ${age}`);
  }
  return lines.join('\n') + '\n';
}
