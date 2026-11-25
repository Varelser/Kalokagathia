/**
 * Display metadata for the PostFx stages (TD §7 stage 3,
 * Phase 35). The stage set and profile orders live in
 * lib/postFxStack.ts; this module adds the panel label and,
 * for the stages whose placement carries a recorded reason
 * in that file's comments, an order note. The editor only
 * permutes the declared order — a stage exists or not
 * purely from its own config conditions
 * (getActivePostFxStageIds), never from the order.
 */
import type { PostFxStageId } from './postFxStack';

export interface PostFxStageMeta {
  id: PostFxStageId;
  label: string;
  orderNote?: string;
}

export const POST_FX_STAGE_META: readonly PostFxStageMeta[] = [
  { id: 'brightness-contrast', label: 'Brightness / Contrast' },
  { id: 'noise', label: 'Noise' },
  { id: 'bloom', label: 'Bloom' },
  { id: 'light-fx', label: 'Light FX' },
  { id: 'chromatic-aberration', label: 'Chromatic Aberration' },
  { id: 'depth-of-field', label: 'Depth of Field' },
  { id: 'radial-blur', label: 'Radial Blur' },
  { id: 'vignette', label: 'Vignette' },
  { id: 'kaleidoscope', label: 'Kaleidoscope' },
  { id: 'slit-scan', label: 'Slit Scan' },
  { id: 'displace', label: 'Displace' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'pixel-sort', label: 'Pixel Sort' },
  { id: 'fractal', label: 'Fractal' },
  { id: 'cellular', label: 'Cellular' },
  { id: 'moire', label: 'Moire' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'brush-accum', label: 'Brush Accumulation' },
  { id: 'posterize', label: 'Posterize' },
  { id: 'ordered-dither', label: 'Ordered Dither' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'edge-detect', label: 'Edge Detect' },
  { id: 'composite', label: 'Composite' },
  { id: 'custom-glsl-post', label: 'Custom GLSL Post' },
  { id: 'output-grade', label: 'Output Grade', orderNote: '露出とトーンの仕上げ段です。通常は最後に置きます（前に置くと、後段の効果はグレーディング前の色で処理されます）' },
  { id: 'edge-capture', label: 'Edge Capture', orderNote: 'フレームを変えず、エッジ場を他系統へ供給する段です。通常は output-grade の後ろに置きます' },
  { id: 'chroma-key', label: 'Chroma Key', orderNote: '通常は edge-capture の後ろに置きます' },
];

const META_BY_ID = new Map(POST_FX_STAGE_META.map((m) => [m.id, m]));

export function postFxStageMeta(id: PostFxStageId): PostFxStageMeta {
  return META_BY_ID.get(id)!;
}
