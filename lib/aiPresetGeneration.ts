// AI preset generation (AI integration Phase 2): turn a natural-language
// request into a BRAND-NEW preset, via two routes the model chooses between:
//   breed    — AI picks two existing library presets as parents; the client
//              crosses them over + mutates with the existing breeding engine.
//   assemble — AI writes a large patch within the AI control catalog; the
//              client validates it (same gate as Phase 1 adjustments) and
//              applies it onto the current config to form a new preset.
// Everything the model returns is validated client-side; invalid output is
// retried once by the caller and then discarded. Created presets carry an
// "AI:" name prefix so their origin is distinguishable from hand-made and
// from the generated Ignition/Coverage sets.
import type { ParticleConfig, PresetRecord } from '../types';
import { buildAiContext, validateAiPatch, type AiAppliedChange } from './aiControlCatalog';
import { breedConfigs, createSeededRng, mutateConfig } from './presetBreeding';
import { normalizeConfig } from './appStateConfigNormalization';

export interface AiGeneratePlan {
  mode: 'breed' | 'assemble';
  name: string;
  parentIds: string[];
  t: number;
  mutation: number;
  patch: Record<string, unknown>;
  summary: string;
}

const PARENT_LIST_LIMIT = 250;

export function buildAiGenerateSystemPrompt(config: ParticleConfig, presets: PresetRecord[]): string {
  const parentLines = presets.slice(0, PARENT_LIST_LIMIT).map((p) => `${p.id} | ${p.name}`);
  return [
    'あなたはモノクロ3Dパーティクル生成アプリ「Kalokagathia」のプリセット設計者です。',
    'ユーザーの日本語の要望から、新しいプリセットを1つ設計します。方法は次の2つから選んでください。',
    '',
    '方法A「breed（交配）」: 下記の親プリセット一覧から2つを選び、その中間＋変異で新しい見た目を作る。既存の良さを組み合わせたい時に。',
    '方法B「assemble（新規組立）」: 現在の設定を土台に、カタログ範囲内の大きなパッチで全く新しい見た目を組み立てる。親に縛られない表現をしたい時に。',
    '',
    '出力は必ず次のJSONだけにしてください（説明文やコードフェンスは付けない）:',
    '{"mode": "breed" または "assemble", "name": "プリセット名の提案（日本語可・20文字以内）", "parentIds": ["親のid", "親のid"], "t": 0.5, "mutation": 0.15, "patch": {"キー": 値, ...}, "summary": "どんなプリセットかの日本語要約（1〜2文）"}',
    '',
    'ルール:',
    '- breed の場合: parentIds は一覧にある実在の id を2つ（別々）指定する。t は交配位置（0=親1寄り、1=親2寄り、0.5=中間）。mutation は 0〜0.6（大きいほど親から離れる）。patch は空でよい。',
    '- assemble の場合: patch のキーは下記カタログにあるものだけを最大40キーまで。モーション種別（layer2Type/layer3Type）・発生形状・粒の数・速さ・色調・ポストFX まで含めて、土台から明確に異なる見た目を作ること（最低でも8キー以上変える）。parentIds は空でよい。',
    '- 数値はカタログの範囲内に収める。',
    '- 名前は見た目が伝わるものにする（例:「夕焼けの渦」「静かな霧」）。',
    '- プリセット生成と無関係な話題には mode を assemble、patch を空にし、summary で短く断る。',
    '',
    '親プリセット一覧（id | 名前）:',
    parentLines.join('\n'),
    '',
    'カタログ（キー / 制約 / 現在値 / 意味）:',
    buildAiContext(config),
  ].join('\n');
}

/** Parse the model's generation reply; tolerant of code fences. */
export function parseAiGenerateReply(text: string): AiGeneratePlan | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    if (!j || typeof j !== 'object') return null;
    const mode = j.mode === 'breed' ? 'breed' : 'assemble';
    const clampNum = (v: unknown, lo: number, hi: number, dflt: number) => (
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt
    );
    return {
      mode,
      name: typeof j.name === 'string' ? j.name.trim().slice(0, 40) : '',
      parentIds: Array.isArray(j.parentIds) ? j.parentIds.filter((x): x is string => typeof x === 'string') : [],
      t: clampNum(j.t, 0, 1, 0.5),
      mutation: clampNum(j.mutation, 0, 0.6, 0.15),
      patch: (j.patch && typeof j.patch === 'object' && !Array.isArray(j.patch)) ? j.patch as Record<string, unknown> : {},
      summary: typeof j.summary === 'string' ? j.summary : '',
    };
  } catch {
    return null;
  }
}

export interface AiGenerateOutcome {
  ok: boolean;
  reason?: string;
  config?: ParticleConfig;
  plan?: AiGeneratePlan;
  applied?: AiAppliedChange[];
  parentNames?: string[];
}

/** Validate a plan and materialise the new config. Never throws. */
export function materialiseAiPreset(
  plan: AiGeneratePlan,
  baseConfig: ParticleConfig,
  presets: PresetRecord[],
  seed: number,
): AiGenerateOutcome {
  if (plan.mode === 'breed') {
    const parents = plan.parentIds
      .map((id) => presets.find((p) => p.id === id))
      .filter((p): p is PresetRecord => Boolean(p));
    if (parents.length < 2 || parents[0].id === parents[1].id) {
      return { ok: false, reason: '親プリセットの指定が不正です（実在する別々の2つが必要）', plan };
    }
    const rng = createSeededRng(seed);
    const crossed = breedConfigs(parents[0].config, parents[1].config, plan.t, rng);
    const config = mutateConfig(crossed, plan.mutation, 0.35, rng);
    return { ok: true, config: normalizeConfig(config), plan, parentNames: [parents[0].name, parents[1].name] };
  }
  const { applied, rejected } = validateAiPatch(plan.patch, baseConfig);
  if (applied.length < 4) {
    return { ok: false, reason: `変更が少なすぎます（有効 ${applied.length} 件 / 除外 ${rejected.length} 件）`, plan };
  }
  const next = { ...(baseConfig as unknown as Record<string, unknown>) };
  for (const c of applied) next[c.key as string] = c.to;
  return { ok: true, config: normalizeConfig(next as Partial<ParticleConfig>), plan, applied };
}

export function aiPresetName(plan: AiGeneratePlan): string {
  const base = plan.name.trim() || '無題';
  return base.startsWith('AI:') ? base.slice(0, 44) : `AI: ${base}`.slice(0, 44);
}
