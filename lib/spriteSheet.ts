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

export type SpriteFrameMode = 'age' | 'fps' | 'random' | 'channel';

export const SPRITE_FRAME_MODES: readonly SpriteFrameMode[] = ['age', 'fps', 'random', 'channel'];

/**
 * Frame channels (Limit plan stage 4, S3 — sprite grammar,
 * design §2 案A): in 'channel' mode a per-particle channel
 * value drives the frame. Every channel produces a RAW value
 * (see spriteFrameChannelRaw); dividing by the configured
 * range and clamping to [0, 1] gives the sheet position t,
 * which maps to a frame exactly like 'age' mode maps normAge
 * (floor(t · total), loop wraps / non-loop clamps). The GLSL
 * twin lives in the points draw vertex variant
 * (components/gpgpuShaderPoints.ts, spriteFrameChannel) — the
 * frame is decided in the vertex and passed as vSpriteFrame,
 * so the fragment gains no sampler.
 *
 * Channels (all readable in the draw vertex from stock
 * inputs):
 * - 'ageRatio': the normalised age (raw already in [0, 1]).
 * - 'speed':    the raw speed |vel| (world units / second).
 * - 'attr':     the attribute slot value (uAttrTex via
 *               kaloAttrChannel); slot -1 or attributes off
 *               reads 0.
 * - 'state':    the live-rule state id (REP texture .g,
 *               stored /255; raw is the id itself, 0..255).
 * - 'rule':     the live-rule condition bits (REP texture
 *               .b, raw bit sum 0..255).
 * 'state' / 'rule' read the REP texture, which is bound only
 * while live rules run; with no REP supply they read the
 * unbound-texture value (state 0 / no bits), matching the
 * CPU-side default input of 0.
 */
export type SpriteFrameChannel = 'ageRatio' | 'speed' | 'attr' | 'state' | 'rule';

export const SPRITE_FRAME_CHANNELS: readonly SpriteFrameChannel[] = ['ageRatio', 'speed', 'attr', 'state', 'rule'];

export function normalizeSpriteFrameChannel(value: unknown): SpriteFrameChannel {
  return (SPRITE_FRAME_CHANNELS as readonly unknown[]).includes(value)
    ? (value as SpriteFrameChannel)
    : 'ageRatio';
}

export function spriteFrameChannelIndex(channel: SpriteFrameChannel): number {
  const idx = SPRITE_FRAME_CHANNELS.indexOf(channel);
  return idx >= 0 ? idx : 0;
}

/**
 * Slot selector for the 'attr' channel: -1 (none) or 0..3.
 * The same clamp as normalizeAttrSlot in
 * lib/gpgpuAttributes.ts, duplicated so this module stays a
 * dependency-free leaf.
 */
export function normalizeSpriteFrameSlot(value: number): number {
  if (!Number.isFinite(value)) return -1;
  const slot = Math.round(value);
  return slot >= 0 && slot <= 3 ? slot : -1;
}

/**
 * Divisor that normalises a raw channel value: positive and
 * finite, defaulting to 1 (identity). With range 1 the
 * discrete channels behave as binary splits (state 0 / no
 * rule bits → first frame, anything above → last frame);
 * set the range to the expected maximum (e.g. the number of
 * states) for a spread across the sheet.
 */
export function normalizeSpriteFrameRange(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(1e6, Math.max(1e-6, value));
}

export interface SpriteFrameChannelInput {
  normAge: number;
  speed: number;
  attrValue: number;
  stateId: number;
  ruleBits: number;
}

/** Raw (pre-range) value of one channel; non-finite inputs read as 0. */
export function spriteFrameChannelRaw(channel: SpriteFrameChannel, input: SpriteFrameChannelInput): number {
  const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
  switch (channel) {
    case 'speed':
      return Math.max(0, finite(input.speed));
    case 'attr':
      return finite(input.attrValue);
    case 'state':
      return Math.min(255, Math.max(0, Math.round(finite(input.stateId))));
    case 'rule':
      return Math.min(255, Math.max(0, finite(input.ruleBits)));
    case 'ageRatio':
    default:
      return Math.min(1, Math.max(0, finite(input.normAge)));
  }
}

/** The normalised sheet position t in [0, 1] for one particle. */
export function spriteFrameChannelT(channel: SpriteFrameChannel, input: SpriteFrameChannelInput, range: number): number {
  const t = spriteFrameChannelRaw(channel, input) / normalizeSpriteFrameRange(range);
  return Math.min(1, Math.max(0, t));
}

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
  /** Normalised channel position (spriteFrameChannelT) for
   *  'channel' mode; absent / non-finite reads as 0. */
  channelT?: number;
}

/**
 * Frame index for one particle. Modes:
 * - 'age':    the life fraction sweeps the whole sheet once.
 * - 'fps':    wall-clock frames at the configured rate (the
 *             deterministic render clock is frame-derived, so
 *             exports stay reproducible).
 * - 'random': one fixed frame per particle, from its seed.
 * - 'channel': the channel position t (input.channelT, from
 *             spriteFrameChannelT) sweeps the sheet like
 *             'age' sweeps normAge.
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
    case 'channel': {
      const ct = input.channelT;
      const t = Math.min(1, Math.max(0, typeof ct === 'number' && Number.isFinite(ct) ? ct : 0));
      raw = Math.floor(t * total);
      break;
    }
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

// ── Config-side drive resolution (stage 4, S3) ─────────────

export interface SpriteFrameDriveConfigLike {
  gpgpuSpriteFrameMode?: string;
  gpgpuSpriteFrameChannel?: string;
  gpgpuSpriteFrameSlot?: number;
  gpgpuSpriteFrameRange?: number;
}

/** The channel variant (vertex-decided frame) stands only
 *  while the frame mode is 'channel'. */
export function spriteFrameChannelActive(config: SpriteFrameDriveConfigLike): boolean {
  return config.gpgpuSpriteFrameMode === 'channel';
}

export interface ResolvedSpriteFrameDrive {
  channel: SpriteFrameChannel;
  channelIndex: number;
  slot: number;
  range: number;
}

/** Resolve the channel drive keys to shader-ready values. */
export function resolveSpriteFrameDrive(config: SpriteFrameDriveConfigLike): ResolvedSpriteFrameDrive {
  const channel = normalizeSpriteFrameChannel(config.gpgpuSpriteFrameChannel);
  return {
    channel,
    channelIndex: spriteFrameChannelIndex(channel),
    slot: normalizeSpriteFrameSlot(config.gpgpuSpriteFrameSlot ?? -1),
    range: normalizeSpriteFrameRange(config.gpgpuSpriteFrameRange ?? 1),
  };
}
