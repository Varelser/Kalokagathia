// Prompt-to-preset drafts: turns a short descriptive phrase (Japanese or
// English) into starter presets, entirely locally — no external AI. A
// keyword table maps motion words to real motion types and mood words to
// macro positions; the base is a donor preset already running the chosen
// motion (so its tuned parameters carry over), macros are applied as
// data, and two seeded mutations of the base join it as variations. The
// interpretation notes are returned with the drafts so the user can see
// exactly which words did what — it is a transparent interpreter, not a
// black box.

import type { ParticleConfig, PresetRecord } from '../types';
import { MACRO_DEFINITIONS, getMacroUpdates } from './macroControls';
import { createSeededRng, mutateConfig } from './presetBreeding';

interface MotionKeyword {
  words: string[];
  motion: string;
  gloss: string;
}

const MOTION_KEYWORDS: MotionKeyword[] = [
  { words: ['渦巻', 'スパイラル', 'spiral'], motion: 'spiral_motion', gloss: '渦巻き' },
  { words: ['渦', 'vortex', 'whirl'], motion: 'vortex', gloss: '渦' },
  { words: ['螺旋', 'ヘリックス', 'helix', 'dna'], motion: 'helix', gloss: '螺旋' },
  { words: ['星雲', 'nebula'], motion: 'nebula', gloss: '星雲' },
  { words: ['雲', '煙', 'スモーク', 'cloud', 'smoke', '霧', 'mist', 'fog'], motion: 'smoke', gloss: '雲・煙' },
  { words: ['蒸気', '昇華', 'vapor'], motion: 'sublimate_cloud', gloss: '蒸気' },
  { words: ['混沌', 'カオス', 'chaos', 'lorenz', 'ローレンツ'], motion: 'lorenz', gloss: '混沌' },
  { words: ['ロスラー', 'rossler'], motion: 'rossler', gloss: 'ロスラー' },
  { words: ['爆発', 'explosion'], motion: 'explosion', gloss: '爆発' },
  { words: ['衝撃波', 'shockwave'], motion: 'shockwave', gloss: '衝撃波' },
  { words: ['波紋', 'ripple'], motion: 'ripple_ring', gloss: '波紋' },
  { words: ['波', 'ウェーブ', 'wave'], motion: 'wave', gloss: '波' },
  { words: ['格子', 'ラティス', 'lattice', 'grid'], motion: 'lattice', gloss: '格子' },
  { words: ['結晶', 'クリスタル', 'crystal'], motion: 'crystal', gloss: '結晶' },
  { words: ['曼荼羅', 'マンダラ', 'mandala'], motion: 'mandala', gloss: '曼荼羅' },
  { words: ['万華鏡', 'kaleidoscope'], motion: 'kaleidoscope', gloss: '万華鏡' },
  { words: ['花', '花びら', 'petal', 'flower'], motion: 'petals', gloss: '花' },
  { words: ['葉序', 'phyllotaxis'], motion: 'phyllotaxis', gloss: '葉序' },
  { words: ['軌道', 'オービット', 'orbit'], motion: 'orbit', gloss: '軌道' },
  { words: ['結び目', 'torus knot'], motion: 'torus_knot', gloss: '結び目' },
  { words: ['重力', 'gravity'], motion: 'gravity', gloss: '重力' },
  { words: ['ばね', 'バネ', 'スプリング', 'spring'], motion: 'spring', gloss: 'ばね' },
  { words: ['変形', 'モーフ', 'morph'], motion: 'morph', gloss: '変形' },
  { words: ['リボン', 'ribbon'], motion: 'ribbon_veil', gloss: 'リボン' },
  { words: ['フォグ', 'volume fog'], motion: 'volume_fog', gloss: 'フォグ' },
  { words: ['砂', '落下', 'granular', 'sand'], motion: 'granular_fall', gloss: '砂・落下' },
  { words: ['雨', 'rain'], motion: 'ion_rain', gloss: '雨' },
  { words: ['新星', 'nova'], motion: 'nova', gloss: '新星' },
  { words: ['渦流', 'swirl'], motion: 'swirl', gloss: '渦流' },
];

interface MacroKeyword {
  words: string[];
  macroId: string;
  position: number;
  gloss: string;
}

const MACRO_KEYWORDS: MacroKeyword[] = [
  { words: ['儚い', 'はかない', '繊細', 'delicate', 'fleeting'], macroId: 'density', position: 0.3, gloss: '儚く（密度 低）' },
  { words: ['儚い', 'はかない', '繊細', 'delicate', 'fleeting'], macroId: 'trails', position: 0.8, gloss: '儚く（残像 長）' },
  { words: ['儚い', 'はかない', 'delicate', 'fleeting'], macroId: 'glow', position: 0.35, gloss: '儚く（光 弱）' },
  { words: ['激しい', '荒々しい', 'intense', 'wild'], macroId: 'chaos', position: 0.85, gloss: '激しく（混沌 高）' },
  { words: ['激しい', '荒々しい', 'intense', 'wild'], macroId: 'speed', position: 0.8, gloss: '激しく（速度 高）' },
  { words: ['静か', '穏やか', 'calm', 'quiet'], macroId: 'speed', position: 0.25, gloss: '静かに（速度 低）' },
  { words: ['静か', '穏やか', 'calm', 'quiet'], macroId: 'chaos', position: 0.2, gloss: '静かに（混沌 低）' },
  { words: ['重厚', '重い', 'heavy'], macroId: 'weight', position: 0.8, gloss: '重く（重さ 高）' },
  { words: ['重厚', '重い', 'heavy'], macroId: 'speed', position: 0.35, gloss: '重く（速度 控えめ）' },
  { words: ['軽やか', '軽い', 'light', 'airy'], macroId: 'weight', position: 0.2, gloss: '軽く（重さ 低）' },
  { words: ['広がる', '拡散', '広大', 'wide', 'vast'], macroId: 'spread', position: 0.85, gloss: '広く（拡散 高）' },
  { words: ['密集', '濃密', 'dense'], macroId: 'density', position: 0.9, gloss: '濃密に（密度 高）' },
  { words: ['まばら', '疎', 'sparse'], macroId: 'density', position: 0.2, gloss: 'まばらに（密度 低）' },
  { words: ['速い', '高速', 'fast'], macroId: 'speed', position: 0.85, gloss: '速く（速度 高）' },
  { words: ['ゆっくり', '遅い', 'slow'], macroId: 'speed', position: 0.2, gloss: 'ゆっくり（速度 低）' },
  { words: ['明るい', '輝く', 'bright', 'glow'], macroId: 'glow', position: 0.8, gloss: '輝く（光 高）' },
  { words: ['残像', 'trails', 'trail'], macroId: 'trails', position: 0.85, gloss: '残像（残像 長）' },
  { words: ['弾ける', 'バースト', 'burst'], macroId: 'burst', position: 0.8, gloss: '弾ける（バースト 高）' },
  { words: ['上昇', 'のぼる', 'rise', 'rising', 'upward'], macroId: 'weight', position: 0.25, gloss: '上昇（重さ 低）' },
];

export interface PromptDraft {
  name: string;
  config: ParticleConfig;
}

export interface PromptDraftResult {
  drafts: PromptDraft[];
  notes: string[];
  matchedMotion: string | null;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function generatePromptDrafts(
  text: string,
  presets: readonly PresetRecord[],
  currentConfig: ParticleConfig,
): PromptDraftResult {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const notes: string[] = [];

  const motionHit = MOTION_KEYWORDS.find((entry) => entry.words.some((word) => lower.includes(word.toLowerCase())));
  const matchedMotion = motionHit?.motion ?? null;
  if (motionHit) {
    notes.push(`「${motionHit.gloss}」→ 運動タイプ ${motionHit.motion}`);
  }

  let base: ParticleConfig;
  const donor = matchedMotion
    ? presets.find((preset) => preset.config.layer2Enabled && preset.config.layer2Type === matchedMotion)
      ?? presets.find((preset) => preset.config.layer3Enabled && preset.config.layer3Type === matchedMotion)
    : undefined;
  if (donor) {
    base = structuredClone(donor.config);
    notes.push(`土台プリセット: ${donor.name}`);
  } else {
    base = structuredClone(currentConfig);
    notes.push(matchedMotion ? '対応する土台が無いため現在の設定を土台にしました。' : '現在の設定を土台にしました。');
  }
  if (matchedMotion) {
    base.layer2Enabled = true;
    base.layer2Type = matchedMotion as ParticleConfig['layer2Type'];
  }

  const macroById = new Map(MACRO_DEFINITIONS.map((definition) => [definition.id, definition]));
  const appliedMacros = new Set<string>();
  for (const keyword of MACRO_KEYWORDS) {
    if (!keyword.words.some((word) => lower.includes(word.toLowerCase()))) continue;
    const noteKey = `${keyword.macroId}:${keyword.position}`;
    if (appliedMacros.has(noteKey)) continue;
    appliedMacros.add(noteKey);
    const definition = macroById.get(keyword.macroId);
    if (!definition) continue;
    getMacroUpdates(definition, keyword.position).forEach(({ key, value }) => {
      (base as unknown as Record<string, unknown>)[key] = value;
    });
    notes.push(keyword.gloss);
  }
  if (!motionHit && appliedMacros.size === 0) {
    notes.push('キーワードに一致する語がありませんでした。現在の設定からの変異のみ生成します。');
  }

  const seed = hashText(trimmed || 'monosphere');
  const label = trimmed.slice(0, 20) || '無題';
  const drafts: PromptDraft[] = [
    { name: `言葉 · ${label}（素案）`, config: base },
    { name: `言葉 · ${label}（変異A）`, config: mutateConfig(base, 0.12, 0.5, createSeededRng(seed + 11)) },
    { name: `言葉 · ${label}（変異B）`, config: mutateConfig(base, 0.25, 0.7, createSeededRng(seed + 29)) },
  ];
  // Mutation can perturb the motion type's numeric neighbours but never
  // the type itself (it only touches numbers/arrays); re-assert anyway.
  if (matchedMotion) {
    drafts.forEach((draft) => {
      draft.config.layer2Enabled = true;
      draft.config.layer2Type = matchedMotion as ParticleConfig['layer2Type'];
    });
  }
  return { drafts, notes, matchedMotion };
}
