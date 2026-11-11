/**
 * Monochrome texture pack (roadmap Phase 9).
 *
 * Procedurally generated 64x64 luminance maps in exactly the format
 * the media pipeline consumes (the same shape the CSV/JSON data
 * source produces), so any texture can become a layer's particle
 * shape through the existing image-source path — no renderer
 * changes. Every generator is a pure function of pixel position,
 * so thumbnails and applied maps always match, and results are
 * identical on every machine.
 */

export const TEXTURE_MAP_SIZE = 64;

export interface TextureDefinition {
  id: string;
  label: string;
  description: string;
  generate: () => number[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function buildMap(fn: (u: number, v: number, x: number, y: number) => number): number[] {
  const size = TEXTURE_MAP_SIZE;
  const map = new Array<number>(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      map[y * size + x] = clamp01(fn((x + 0.5) / size, (y + 0.5) / size, x, y));
    }
  }
  return map;
}

/** Deterministic integer hash -> [0, 1). */
function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(u: number, v: number, cells: number): number {
  const fx = u * cells;
  const fy = v * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export const TEXTURE_DEFINITIONS: TextureDefinition[] = [
  {
    id: 'halftone',
    label: '網点',
    description: '中心ほど大きなドットが並ぶハーフトーン',
    generate: () =>
      buildMap((u, v) => {
        const cells = 8;
        const cx = (Math.floor(u * cells) + 0.5) / cells;
        const cy = (Math.floor(v * cells) + 0.5) / cells;
        const radial = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) * 1.6);
        const radius = 0.16 + radial * 0.3;
        const d = Math.hypot(u - cx, v - cy) * cells;
        return 1 - smoothstep(radius * 0.85, radius * 1.15, d);
      }),
  },
  {
    id: 'rings',
    label: '同心円',
    description: '中心から広がるリング状の波紋',
    generate: () =>
      buildMap((u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5);
        return smoothstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(r * Math.PI * 2 * 9));
      }),
  },
  {
    id: 'stripes',
    label: '斜め縞',
    description: '45度の帯が流れるストライプ',
    generate: () =>
      buildMap((u, v) => smoothstep(0.3, 0.7, 0.5 + 0.5 * Math.sin((u + v) * Math.PI * 2 * 6))),
  },
  {
    id: 'crosshatch',
    label: 'クロスハッチ',
    description: '交差する2方向の線で作る網目',
    generate: () =>
      buildMap((u, v) => {
        const a = smoothstep(0.55, 0.95, 0.5 + 0.5 * Math.sin((u + v) * Math.PI * 2 * 8));
        const b = smoothstep(0.55, 0.95, 0.5 + 0.5 * Math.sin((u - v) * Math.PI * 2 * 8));
        return Math.max(a, b);
      }),
  },
  {
    id: 'checker',
    label: '市松',
    description: 'くっきりした市松模様',
    generate: () =>
      buildMap((u, v) => ((Math.floor(u * 8) + Math.floor(v * 8)) % 2 === 0 ? 1 : 0.04)),
  },
  {
    id: 'dotgrid',
    label: 'ドット格子',
    description: '等間隔に並ぶ丸ドットのグリッド',
    generate: () =>
      buildMap((u, v) => {
        const cells = 8;
        const cx = (Math.floor(u * cells) + 0.5) / cells;
        const cy = (Math.floor(v * cells) + 0.5) / cells;
        const d = Math.hypot(u - cx, v - cy) * cells;
        return 1 - smoothstep(0.26, 0.34, d);
      }),
  },
  {
    id: 'waves',
    label: '波',
    description: '横方向にうねる波の帯',
    generate: () =>
      buildMap((u, v) => {
        const warp = Math.sin(u * Math.PI * 2 * 2) * 0.06;
        return smoothstep(0.3, 0.7, 0.5 + 0.5 * Math.sin((v + warp) * Math.PI * 2 * 6));
      }),
  },
  {
    id: 'noise',
    label: '雲ノイズ',
    description: '雲のような有機的な濃淡（決定的生成）',
    generate: () =>
      buildMap((u, v) => {
        const n =
          valueNoise(u, v, 4) * 0.55 + valueNoise(u, v, 8) * 0.3 + valueNoise(u, v, 16) * 0.15;
        return smoothstep(0.25, 0.8, n);
      }),
  },
];

export function getTextureDefinition(id: string): TextureDefinition | undefined {
  return TEXTURE_DEFINITIONS.find((definition) => definition.id === id);
}
