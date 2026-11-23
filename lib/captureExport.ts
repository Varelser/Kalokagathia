/**
 * captureExport.ts — still-image export options for the deck capture
 * (KCB3, Casberry comparison follow-up).
 *
 * Pure helpers only: image-format specs (mime / extension / quality)
 * and centre-crop geometry for the aspect-ratio presets. The canvas
 * work itself lives in components/sceneCapture.tsx; everything here is
 * deterministic and unit-testable without a DOM.
 *
 * These are transient UI choices, NOT ParticleConfig keys: the key set
 * (and its fingerprint) is intentionally untouched.
 */

export type CaptureImageFormat = 'png' | 'jpeg' | 'webp';

export type CaptureAspectPreset = 'original' | '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export interface CaptureExportOptions {
  format: CaptureImageFormat;
  aspect: CaptureAspectPreset;
  /** 0..1, used only by the lossy formats (jpeg / webp). */
  quality: number;
}

export const DEFAULT_CAPTURE_EXPORT_OPTIONS: CaptureExportOptions = {
  format: 'png',
  aspect: 'original',
  quality: 0.92,
};

export interface CaptureFormatSpec {
  format: CaptureImageFormat;
  mimeType: string;
  /** File extension including the dot, e.g. '.jpg'. */
  extension: string;
  /** Human label for the save-picker description. */
  description: string;
  /** Whether canvas toBlob/toDataURL honours a quality argument. */
  supportsQuality: boolean;
  defaultQuality: number;
}

const FORMAT_SPECS: Record<CaptureImageFormat, CaptureFormatSpec> = {
  png: {
    format: 'png',
    mimeType: 'image/png',
    extension: '.png',
    description: 'PNG image',
    supportsQuality: false,
    defaultQuality: 1,
  },
  jpeg: {
    format: 'jpeg',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    description: 'JPEG image',
    supportsQuality: true,
    defaultQuality: 0.92,
  },
  webp: {
    format: 'webp',
    mimeType: 'image/webp',
    extension: '.webp',
    description: 'WebP image',
    supportsQuality: true,
    defaultQuality: 0.92,
  },
};

export const CAPTURE_IMAGE_FORMATS: CaptureImageFormat[] = ['png', 'jpeg', 'webp'];

export function isCaptureImageFormat(value: unknown): value is CaptureImageFormat {
  return value === 'png' || value === 'jpeg' || value === 'webp';
}

/** Unknown input falls back to the PNG spec (the legacy behaviour). */
export function captureFormatSpec(format: CaptureImageFormat): CaptureFormatSpec {
  return FORMAT_SPECS[format] ?? FORMAT_SPECS.png;
}

/** Save-picker accept map for saveBlobFile, keyed by the format mime. */
export function captureAcceptMap(format: CaptureImageFormat): Record<string, string[]> {
  const spec = captureFormatSpec(format);
  return { [spec.mimeType]: [spec.extension] };
}

/** Download filename for a capture, e.g. `kalokagathia_1730000000000.jpg`. */
export function buildCaptureFilename(timestamp: number, format: CaptureImageFormat): string {
  return `kalokagathia_${timestamp}${captureFormatSpec(format).extension}`;
}

/**
 * Clamp a quality value into [0, 1]. Non-finite input falls back to the
 * format's default quality.
 */
export function normalizeCaptureQuality(quality: number, format: CaptureImageFormat): number {
  if (!Number.isFinite(quality)) return captureFormatSpec(format).defaultQuality;
  return Math.min(1, Math.max(0, quality));
}

/**
 * The quality argument to pass to canvas encoding: the normalised
 * quality for lossy formats, `undefined` for PNG (which ignores it —
 * passing undefined keeps the PNG call byte-identical to the legacy
 * two-argument form).
 */
export function captureQualityArg(options: CaptureExportOptions): number | undefined {
  const spec = captureFormatSpec(options.format);
  if (!spec.supportsQuality) return undefined;
  return normalizeCaptureQuality(options.quality, options.format);
}

const ASPECT_RATIOS: Record<CaptureAspectPreset, number | null> = {
  original: null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '21:9': 21 / 9,
};

export const CAPTURE_ASPECT_PRESETS: CaptureAspectPreset[] = [
  'original',
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '21:9',
];

export function isCaptureAspectPreset(value: unknown): value is CaptureAspectPreset {
  return typeof value === 'string' && value in ASPECT_RATIOS;
}

/** Target width/height ratio for a preset, or null for 'original'. */
export function captureAspectRatio(preset: CaptureAspectPreset): number | null {
  return ASPECT_RATIOS[preset] ?? null;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Largest centre-aligned rectangle of the target aspect inside a
 * srcW x srcH frame. Integer pixels: the cropped size is floored (so
 * it never exceeds the source) and clamped to at least 1px; the origin
 * is the floored half of the leftover, so sx+sw <= srcW always holds.
 *
 * 'original' (or a target ratio equal to the source ratio) returns the
 * full frame — this is the identity case the legacy export relies on.
 * Degenerate sources (non-finite or <= 0) return a zero rect.
 */
export function centerCropRect(
  srcW: number,
  srcH: number,
  preset: CaptureAspectPreset,
): CropRect {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const w = Math.floor(srcW);
  const h = Math.floor(srcH);
  const ratio = captureAspectRatio(preset);
  if (ratio === null) return { sx: 0, sy: 0, sw: w, sh: h };

  let sw = w;
  let sh = h;
  if (ratio > w / h) {
    // Target is wider than the source: full width, crop the height.
    sh = Math.floor(w / ratio);
  } else if (ratio < w / h) {
    // Target is narrower than the source: full height, crop the width.
    sw = Math.floor(h * ratio);
  }
  sw = Math.min(w, Math.max(1, sw));
  sh = Math.min(h, Math.max(1, sh));
  return {
    sx: Math.floor((w - sw) / 2),
    sy: Math.floor((h - sh) / 2),
    sw,
    sh,
  };
}

/** Output pixel size after applying the aspect preset to a frame. */
export function captureOutputSize(
  srcW: number,
  srcH: number,
  preset: CaptureAspectPreset,
): { width: number; height: number } {
  const rect = centerCropRect(srcW, srcH, preset);
  return { width: rect.sw, height: rect.sh };
}

/** True when the rect covers the whole frame (no crop needed). */
export function isFullFrameRect(rect: CropRect, srcW: number, srcH: number): boolean {
  return rect.sx === 0 && rect.sy === 0 && rect.sw === Math.floor(srcW) && rect.sh === Math.floor(srcH);
}

/**
 * Identity condition for KCB3: PNG + 'original' must reproduce the
 * legacy export exactly (same canvas, same two-argument toBlob call,
 * same filename and accept map).
 */
export function isIdentityCaptureOptions(options: CaptureExportOptions): boolean {
  return options.format === 'png' && options.aspect === 'original';
}
