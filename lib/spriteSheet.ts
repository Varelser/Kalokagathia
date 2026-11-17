/**
 * Sprite sheet (flipbook) math (Phase AD): the pure twins of the
 * frame selection in the GPGPU point fragment shader
 * (components/gpgpuShaderPoints.ts). A sprite image can be a
 * sheet of cols x rows frames; which frame a particle shows is a
 * pure function of values the shader already has — normalised
 * age, the draw clock, or the per-particle seed — so the
 * deterministic render reproduces the exact same frames.
 *
 * Identity contract: at 1x1 the frame is always 0 and the UV
 * remap is (0 + u) / 1 and 1 - (0 + v) / 1, which is IEEE-exact,
 * so a sheet-configured sprite at the defaults samples exactly
 * the same texels as the legacy single-image path.
 */

export type SpriteFrameMode = 'age' | 'fps' | 'random';

export const SPRITE_FRAME_MODES: readonly SpriteFrameMode[] = ['age', 'fps', 'random'];

export interface SpriteSheetConfigLike {
  cols: number;
  rows: number;
  mode: SpriteFrameMode;
  fps: number;
  loop: boolean;
}

export function normalizeSpriteSheetDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(16, Math.max(1, Math.round(value)));
}

export function normalizeSpriteFrameFps(value: number): number {
  if (!Number.isFinite(value)) return 12;
  return Math.min(60, Math.max(0.1, value));
}

export function spriteFrameModeIndex(mode: SpriteFrameMode): number {
  const idx = SPRITE_FRAME_MODES.indexOf(mode);
  return idx >= 0 ? idx : 0;
}

export interface SpriteFrameInput {
  normAge: number;
  timeSeconds: number;
  seed: number;
}

/**
 * Frame index for one particle. Modes:
 * - 'age':    the life fraction sweeps the whole sheet once.
 * - 'fps':    wall-clock frames at the configured rate (the
 *             deterministic render clock is frame-derived, so
 *             exports stay reproducible).
 * - 'random': one fixed frame per particle, from its seed.
 * Looping wraps; non-looping clamps on the last frame.
 */
export function spriteFrameIndex(sheet: SpriteSheetConfigLike, input: SpriteFrameInput): number {
  const cols = normalizeSpriteSheetDimension(sheet.cols);
  const rows = normalizeSpriteSheetDimension(sheet.rows);
  const total = cols * rows;
  if (total <= 1) return 0;
  let raw: number;
  switch (sheet.mode) {
    case 'fps':
      raw = Math.floor(Math.max(0, input.timeSeconds) * normalizeSpriteFrameFps(sheet.fps));
      break;
    case 'random':
      raw = Math.floor(Math.min(0.999999, Math.max(0, input.seed)) * total);
      return Math.min(total - 1, Math.max(0, raw));
    case 'age':
    default: {
      const t = Math.min(1, Math.max(0, input.normAge));
      raw = Math.floor(t * total);
      break;
    }
  }
  if (sheet.loop) {
    return ((raw % total) + total) % total;
  }
  return Math.min(total - 1, Math.max(0, raw));
}

/** Frame -> (col, row); frame 0 is the top-left cell. */
export function spriteFrameCell(frame: number, cols: number): { col: number; row: number } {
  const c = normalizeSpriteSheetDimension(cols);
  const f = Math.max(0, Math.floor(frame));
  return { col: f % c, row: Math.floor(f / c) };
}

/**
 * Remap a point coordinate (gl_PointCoord space: x right, y
 * DOWN, both in [0,1]) into the frame's cell of the sheet. The
 * sprite texture holds the image top at v=1, so the returned v
 * is 1 - (row + pointY) / rows — at 1x1 this is exactly the
 * legacy 1 - pointY.
 */
export function spriteSheetUv(
  pointX: number,
  pointY: number,
  cols: number,
  rows: number,
  frame: number,
): [number, number] {
  const c = normalizeSpriteSheetDimension(cols);
  const r = normalizeSpriteSheetDimension(rows);
  const { col, row } = spriteFrameCell(frame, c);
  return [(col + pointX) / c, 1 - (row + pointY) / r];
}
