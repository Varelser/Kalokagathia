// Custom GLSL post stage (Phase BX): the second GLSL injection
// point, registered on the shared foundation in
// lib/glslInjection.ts. The user writes a GLSL fragment that runs
// in a fullscreen post pass placed immediately before the
// 'output-grade' stage, so output-grade stays the final word on
// exposure / tone / brand duotone.
//
// The snippet may read:
//   vUv (vec2, screen position), uTime (float, seconds),
//   uResolution (vec2, pixels)
// and read/write:
//   color (vec3, the frame colour entering this stage)
// e.g.:
//   color = vec3(1.0) - color;
//
// The input texture is deliberately NOT exposed: the frame is
// handed over as `color` only, and texture sampling tokens are
// rejected (sampling neighbouring pixels is a different contract
// and stays out of this point, as in the Phase BX spike).
//
// Safety model matches the custom force (the user's own code in
// their own browser — the goal is protecting the output
// contract, not sandboxing): forbidden tokens first, then the
// snippet must compile inside the harness below before it is
// swapped in; on any failure the previously working fragment
// stays active and the error is reported through the status
// store. The stage itself only exists while an enabled,
// statically valid snippet is set (lib/postFxStack.ts), so the
// defaults leave the composer output bit-identical.
//
// Luminance lock: the stage's fragment can re-project its result
// onto luminance (Rec. 709 weights, the same weights the brand
// duotone uses) after the snippet runs. That keeps the app's
// monochrome policy from silently dissolving just because a
// snippet can now produce colour: the lock is an option on the
// contract, default OFF (Phase BX brief, following the spike's
// recommendation).
//
// Layer 1 WP11 phase D1 (decision (b) on the Unity §4 post
// hand-off): the ONE stored document (postCustomGlslCode, no
// new key) may now author SEVERAL custom stages, and a stage may
// opt into a sampling contract. The opening is deliberately
// limited to the custom stages:
//
//   - Stages are separated by a whole-line directive,
//     `// @stage <name>` (the name is optional and only labels
//     the stage in error messages). Execution order is document
//     order — reordering stages means moving their blocks in
//     the text. All custom stages still run consecutively at
//     the one fixed anchor (immediately before 'output-grade');
//     the built-in stage order and the "output-grade is final"
//     invariant are NOT opened to authoring.
//   - A stage whose text carries a whole-line directive
//     `// @sample-input` is validated under the sampling
//     contract: the texture-sampling tokens are permitted and
//     the snippet may read the stage's input frame through
//     texture2D(tDiffuse, uv). Sampling is read-only by
//     construction — tDiffuse is the only sampler in scope
//     (uniform declarations stay forbidden, so no other sampler
//     can be named, and a sampler cannot be written to). Every
//     other stage keeps the original contract, which still
//     rejects sampling outright.
//   - A document without any directive is exactly one stage
//     whose code is the document itself, so existing snippets
//     validate and generate byte-identically to Phase BX.
//   - The per-stage discipline is unchanged: each stage is
//     token-scanned and harness-compiled on its own, any
//     failure keeps the previously working stage set active,
//     and a stage exists only while its snippet is enabled and
//     statically valid (structural identity, per stage).

import {
  createGlslInjectionStatusStore,
  registerGlslInjection,
  resolveGlslSnippet,
  validateGlslSnippet,
  GLSL_SNIPPET_MAX_LENGTH,
  type GlslForbiddenToken,
  type GlslInjectionContract,
  type GlslInjectionStatus,
  type GlslSnippetResolution,
  type GlslSnippetValidation,
} from './glslInjection';
import type { GlslSharedSnippetSet } from './glslSharedSnippets';

export const CUSTOM_POST_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（color を書き換えてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（color / vUv / uTime / uResolution が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません（入力は color として渡ります）' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません（入力は color として渡ります）' },
];

export type CustomPostGlslValidation = GlslSnippetValidation;

// The sampling contract's token list (WP11 phase D1): the
// legacy list minus the two texture-sampling entries. Every
// other prohibition — preprocessor, main, uniform / attribute /
// varying / precision declarations, gl_FragColor — applies to
// sampling stages exactly as before, which is what keeps
// tDiffuse the only sampler a sampling snippet can name.
const SAMPLING_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = FORBIDDEN_TOKENS.filter(
  ({ token }) => token !== 'texture2D' && token !== 'texture(',
);

// ---------------------------------------------------------------------------
// Multi-stage documents (WP11 phase D1)
//
// The stored code is a document of one or more stages. Grammar:
// a whole line `// @stage` or `// @stage <name>` starts a new
// stage; text before the first directive is the first stage.
// A whole line `// @sample-input` inside a stage opts THAT
// stage into the sampling contract. Directive-looking lines
// that do not match the grammar are a parse error rather than
// silent prose, so a typo can never quietly merge two stages.

export const CUSTOM_POST_MAX_STAGES = 8;

export interface CustomPostStage {
  /** Label from `// @stage <name>`, or null when unlabelled. */
  name: string | null;
  /** The stage's snippet text (directive lines excluded). For
   *  a directive-free document this is the document itself,
   *  byte for byte. */
  code: string;
  /** True when the stage opted into the sampling contract. */
  sampling: boolean;
  /** 0-based position in the document = execution order. */
  index: number;
}

export interface CustomPostStagesParse {
  ok: boolean;
  stages: CustomPostStage[];
  error?: string;
}

const STAGE_DIRECTIVE_LINE = /^\s*\/\/\s*@stage(?:\s+([A-Za-z_][A-Za-z0-9_-]*))?\s*$/;
const STAGE_DIRECTIVE_HINT = /^\s*\/\/\s*@stage\b/;
const SAMPLE_DIRECTIVE_LINE = /^\s*\/\/\s*@sample-input\s*$/;
const SAMPLE_DIRECTIVE_HINT = /^\s*\/\/\s*@sample-input\b/;

/** Human-readable stage reference for error messages. */
export function customPostStageLabel(stage: CustomPostStage): string {
  return stage.name ? `段 '${stage.name}'` : `段 ${stage.index + 1}`;
}

export function parseCustomPostStages(document: string): CustomPostStagesParse {
  const chunks: { name: string | null; lines: string[] }[] = [];
  let current: { name: string | null; lines: string[] } = { name: null, lines: [] };
  let sawStageDirective = false;
  for (const line of document.split('\n')) {
    if (STAGE_DIRECTIVE_HINT.test(line)) {
      const match = STAGE_DIRECTIVE_LINE.exec(line);
      if (!match) {
        return { ok: false, stages: [], error: `カスタムポスト段の区切り（// @stage 名前）の書式が不正です: ${line.trim()}` };
      }
      chunks.push(current);
      current = { name: match[1] ?? null, lines: [] };
      sawStageDirective = true;
      continue;
    }
    if (SAMPLE_DIRECTIVE_HINT.test(line) && !SAMPLE_DIRECTIVE_LINE.test(line)) {
      return { ok: false, stages: [], error: `近傍サンプリング宣言（// @sample-input）の書式が不正です: ${line.trim()}` };
    }
    current.lines.push(line);
  }
  chunks.push(current);

  const stages: CustomPostStage[] = [];
  for (const chunk of chunks) {
    let body: string;
    if (!sawStageDirective) {
      // Legacy form: the document itself is the one stage,
      // byte for byte — no trimming, so Phase BX snippets keep
      // generating the identical fragment.
      body = chunk.lines.join('\n');
    } else {
      const lines = [...chunk.lines];
      while (lines.length > 0 && lines[0].trim() === '') lines.shift();
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      body = lines.join('\n');
    }
    if (body.trim().length === 0) continue;
    stages.push({
      name: chunk.name,
      code: body,
      sampling: chunk.lines.some((line) => SAMPLE_DIRECTIVE_LINE.test(line)),
      index: stages.length,
    });
  }
  if (stages.length > CUSTOM_POST_MAX_STAGES) {
    return { ok: false, stages: [], error: `カスタムポスト段が多すぎます（最大 ${CUSTOM_POST_MAX_STAGES} 段）` };
  }
  const names = new Set<string>();
  for (const stage of stages) {
    if (stage.name === null) continue;
    if (names.has(stage.name)) {
      return { ok: false, stages: [], error: `カスタムポスト段の名前 '${stage.name}' が重複しています` };
    }
    names.add(stage.name);
  }
  return { ok: true, stages };
}

/** Validate one stage under its own contract kind. */
export function validateCustomPostStageCode(stage: CustomPostStage): CustomPostGlslValidation {
  return validateGlslSnippet(
    stage.code,
    stage.sampling ? SAMPLING_FORBIDDEN_TOKENS : FORBIDDEN_TOKENS,
    CUSTOM_POST_GLSL_MAX_LENGTH,
  );
}

// ---------------------------------------------------------------------------
// Shared definition resolution + document serialisation
// (Layer 1 WP11, phase C)
//
// A stage's snippet may reference the shared definition set
// (lib/glslSharedSnippets.ts) with `// @use` directives, like
// every other injection point. Resolution is per stage, under
// the stage's OWN contract kind: a sampling stage resolves its
// definitions under the sampling token list, a legacy stage
// under the legacy list, so a definition can never smuggle
// sampling into a stage that did not opt into it. A stage
// without directives resolves to the identical string, so a
// document that never uses shared definitions keeps generating
// byte-identical fragments.

/** Resolve one stage's snippet against the shared definition set. */
export function resolveCustomPostStageSnippet(
  stage: CustomPostStage,
  defs: GlslSharedSnippetSet,
): GlslSnippetResolution {
  return resolveGlslSnippet(
    stage.code,
    defs,
    stage.sampling ? SAMPLING_FORBIDDEN_TOKENS : FORBIDDEN_TOKENS,
    CUSTOM_POST_GLSL_MAX_LENGTH,
  );
}

export interface CustomPostStagesResolution {
  ok: boolean;
  /** Present when ok: the stages with resolved code, in document order. */
  stages?: CustomPostStage[];
  error?: string;
}

/**
 * Parse a stored document and resolve every stage against the
 * shared definition set. Error labelling follows
 * validateCustomPostGlslCode: a multi-stage document (or a
 * named stage) names the failing stage.
 */
export function resolveCustomPostGlslStages(
  code: string,
  defs: GlslSharedSnippetSet,
): CustomPostStagesResolution {
  const parsed = parseCustomPostStages(code);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const multi = parsed.stages.length > 1;
  const stages: CustomPostStage[] = [];
  for (const stage of parsed.stages) {
    const resolution = resolveCustomPostStageSnippet(stage, defs);
    if (!resolution.ok) {
      return {
        ok: false,
        error: multi || stage.name !== null
          ? `${customPostStageLabel(stage)}: ${resolution.error}`
          : resolution.error,
      };
    }
    stages.push({ ...stage, code: resolution.code as string });
  }
  return { ok: true, stages };
}

/**
 * Serialise a stage list back into a stored document (the
 * panel's stage-reorder writes this). A single unlabelled
 * stage serialises to its code verbatim — the legacy form, so
 * a one-stage document round-trips byte for byte. Otherwise
 * each stage after an unlabelled first stage is introduced by
 * its `// @stage` directive line; a stage's sampling opt-in
 * rides inside its code (the `// @sample-input` line is part
 * of the parsed stage code), so nothing else is emitted.
 * Parsing the result yields the same stage list.
 */
export function serializeCustomPostStages(stages: readonly CustomPostStage[]): string {
  if (stages.length === 0) return '';
  if (stages.length === 1 && stages[0].name === null) return stages[0].code;
  const blocks: string[] = [];
  stages.forEach((stage, i) => {
    if (i === 0 && stage.name === null) {
      blocks.push(stage.code);
    } else {
      blocks.push(`// @stage${stage.name ? ` ${stage.name}` : ''}\n${stage.code}`);
    }
  });
  return blocks.join('\n');
}

/**
 * Validate a whole stored document: it parses, authors at
 * least one stage, and every stage passes its own contract's
 * token scan. An empty document validates (callers gate stage
 * existence on non-empty separately, as before); a document
 * holding only stage directives authors no stage and fails.
 * A single-stage document reports the bare legacy error, so
 * Phase BX messages are unchanged.
 */
export function validateCustomPostGlslCode(code: string): CustomPostGlslValidation {
  if (code.trim().length === 0) return { ok: true };
  const parsed = parseCustomPostStages(code);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.stages.length === 0) {
    return { ok: false, error: 'カスタムポスト段が1つもありません（区切りだけでは段になりません）' };
  }
  const multi = parsed.stages.length > 1;
  for (const stage of parsed.stages) {
    const validation = validateCustomPostStageCode(stage);
    if (!validation.ok) {
      return {
        ok: false,
        error: multi || stage.name !== null
          ? `${customPostStageLabel(stage)}: ${validation.error}`
          : validation.error,
      };
    }
  }
  return { ok: true };
}

// The example doubles as the BX starter's snippet: a warm tint
// graded across the frame, written to be paired with the
// luminance lock (the tint folds back to a luminance lift, so
// the demo shows colour code landing as monochrome). Keep the
// comments free of the forbidden tokens above — the scan covers
// the whole snippet, comments included.
export const CUSTOM_POST_GLSL_EXAMPLE = `// 例: 暖色ティントを画面の左右で変えながら重ねる断片。
// color はこの段への入力色（読み書き）、vUv は画面座標です。
// 輝度ロックと併用すると、色は輝度の持ち上げとして残ります。
float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
float lift = mix(0.92, 1.08, vUv.x);
color = color * lift + vec3(0.10, 0.03, 0.0) * (1.0 - luma) * 0.35;`;

// ---------------------------------------------------------------------------
// Compile status, shared between the composer component (which
// compiles and swaps fragments) and the panel UI (which reports
// the outcome).

export type CustomPostGlslStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setCustomPostGlslStatus = statusStore.set;
export const getCustomPostGlslStatus = statusStore.get;
export const useCustomPostGlslStatus = statusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness + fragment generation

// Builds the harness fragment shader used for the compile check:
// the snippet sits in the same block scope it will occupy in the
// post pass, with the documented interface as locals/uniforms.
export function buildCustomPostGlslHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  void main() {
    vec2 vUv = vec2(0.5);
    vec3 color = vec3(0.0);
    {
${customCode}
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;
}

// The vertex source paired with the harness for the compile
// check (the check compiles a pair; the pass's own vertex shader
// only derives vUv from clip-space position).
export const CUSTOM_POST_GLSL_CHECK_VERTEX = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

// Builds the full fragment shader of the post pass for a
// validated snippet: the input frame is sampled into `color`
// BEFORE the snippet runs, and the luminance lock (uLumaLock,
// a uniform so toggling it needs no recompile) re-projects the
// result afterwards.
export function buildCustomPostGlslFragment(customCode: string): string {
  return /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uLumaLock;
varying vec2 vUv;

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  {
${customCode}
  }
  if (uLumaLock > 0.5) {
    color = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
}

// The harness for a sampling-contract stage: the legacy
// harness plus the one sampler the contract exposes, so a
// snippet calling texture2D(tDiffuse, ...) compile-checks in
// the same block scope it will occupy in the post pass.
export function buildCustomPostSamplingGlslHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform sampler2D tDiffuse;
  void main() {
    vec2 vUv = vec2(0.5);
    vec3 color = vec3(0.0);
    {
${customCode}
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;
}

/** The compile-check harness for one stage, under its contract kind. */
export function buildCustomPostStageHarness(stage: CustomPostStage): string {
  return stage.sampling
    ? buildCustomPostSamplingGlslHarness(stage.code)
    : buildCustomPostGlslHarness(stage.code);
}

/**
 * The post-pass fragment for one stage. One builder serves
 * both contract kinds: the generated fragment already declares
 * and binds tDiffuse (it samples the stage's input frame into
 * `color` before the snippet runs), so a sampling snippet's
 * texture2D(tDiffuse, ...) reads that same input — for a later
 * stage, the previous stage's output, exactly what `color`
 * means at that point in the chain. The contract kinds differ
 * only in what validation permits and what the harness
 * declares, never in the generated shape.
 */
export function buildCustomPostStageFragment(stage: CustomPostStage): string {
  return buildCustomPostGlslFragment(stage.code);
}

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation. Backends:
// the post chain is a WebGL composer — there is no WGSL post
// pipeline and the CPU fallback canvas has no post chain — so
// both declare 'unsupported' rather than dropping the effect
// without a word.

export const CUSTOM_POST_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'custom-glsl-post',
  stage: 'post-fragment',
  variables: [
    { name: 'color', type: 'vec3', access: 'readwrite' },
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'uResolution', type: 'vec2', access: 'read' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: CUSTOM_POST_GLSL_MAX_LENGTH,
  buildHarness: buildCustomPostGlslHarness,
};

registerGlslInjection(CUSTOM_POST_GLSL_CONTRACT);
