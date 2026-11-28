import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  CUSTOM_POST_GLSL_EXAMPLE,
  customPostStageLabel,
  parseCustomPostStages,
  serializeCustomPostStages,
  useCustomPostGlslStatus,
} from '../lib/customPostGlsl';
import {
  POST_GLSL_REPLACEMENT_EXAMPLE,
  usePostGlslReplacementStatus,
} from '../lib/glslReplacementPoints';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// Custom Post GLSL (Phase BX): the panel block for the second
// GLSL injection point. Same shape as the Custom Force block —
// a draft textarea with an explicit Apply button, so a
// half-typed snippet never reaches the compile check — plus the
// luminance-lock toggle that belongs to this point's contract.
//
// Layer 1 WP11 phase D1: the snippet document may author
// several stages (`// @stage` blocks, executed in document
// order); the stage list below the textarea reorders them by
// rewriting the draft document (lib/customPostGlsl.ts
// serializeCustomPostStages), still behind the same Apply
// button. Phase D2/C: the point also has a full-fragment
// replacement form — the 著述形式 toggle switches the editor
// between the snippet stages and the replacement code, which
// IS the whole fragment (host declarations supplied; the code
// defines main and writes gl_FragColor). Each form keeps its
// own code key and its own status store.
export const CustomPostGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useCustomPostGlslStatus();
  const replaceStatus = usePostGlslReplacementStatus();
  const [draft, setDraft] = React.useState(config.postCustomGlslCode);
  const dirty = draft !== config.postCustomGlslCode;
  const [replaceDraft, setReplaceDraft] = React.useState(config.postCustomGlslReplacementCode);
  const replaceDirty = replaceDraft !== config.postCustomGlslReplacementCode;
  const parsedDraft = React.useMemo(() => parseCustomPostStages(draft), [draft]);
  const moveStage = (index: number, direction: -1 | 1) => {
    if (!parsedDraft.ok) return;
    const stages = [...parsedDraft.stages];
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    [stages[index], stages[target]] = [stages[target], stages[index]];
    setDraft(serializeCustomPostStages(stages.map((stage, i) => ({ ...stage, index: i }))));
  };
  const replacement = config.postCustomGlslReplacementEnabled;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Custom Post GLSL</div>
      <Toggle label="Custom Post GLSL (GLSL)" value={config.postCustomGlslEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('postCustomGlslEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        最終段（Output Grade）の直前に自分の GLSL を差し込みます（WebGL 経路のポスト処理）。著述形式は2つあります: 「断片」は color（vec3）を読み書きする断片を差し込む従来の形、「全体差し替え」はフラグメントシェーダ全体を自分のコードで置く形です。断片形式では共有スニペット定義（GLSL Shared Snippets）を「// @use 名前」で参照できます（全体差し替え形式は対象外）。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.postCustomGlslEnabled && (
        <>
          <Toggle
            label="著述形式"
            value={replacement}
            options={[{ label: '断片 (Snippet)', val: false }, { label: '全体差し替え (Replace)', val: true }]}
            onChange={(v) => updateConfig('postCustomGlslReplacementEnabled', v)}
          />
          {!replacement && (
            <>
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                color（vec3）を読み書きでき、vUv / uTime / uResolution が読めます。段は複数書けます: 行全体の「// @stage 名前」で区切ると書いた順に実行されます（内蔵段の順序は変わりません）。段の先頭に「// @sample-input」と書いた段だけは、入力テクスチャを texture2D(tDiffuse, uv) で読み取り専用にサンプリングできます（近傍参照用）。
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                rows={7}
                className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                placeholder={'// 例: color = vec3(1.0) - color;'}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => updateConfig('postCustomGlslCode', draft)}
                  disabled={!dirty}
                  className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => setDraft(CUSTOM_POST_GLSL_EXAMPLE)}
                  className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  例を読み込む
                </button>
                {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
              </div>
              {parsedDraft.ok && parsedDraft.stages.length >= 2 && (
                <div className="mt-3">
                  <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">段の順序（実行順）</div>
                  {parsedDraft.stages.map((stage, index) => (
                    <div key={index} className="mt-1 flex items-center gap-2">
                      <span className="flex-1 text-[10px] text-white/75">
                        {index + 1}. {customPostStageLabel(stage)}
                        {stage.sampling && <span className="text-white/40">（サンプリング契約）</span>}
                      </span>
                      <button
                        onClick={() => moveStage(index, -1)}
                        disabled={index === 0}
                        className="px-2 py-0.5 rounded-full border border-white/25 text-white/80 text-[10px] hover:bg-white/10 transition-colors disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveStage(index, 1)}
                        disabled={index === parsedDraft.stages.length - 1}
                        className="px-2 py-0.5 rounded-full border border-white/25 text-white/80 text-[10px] hover:bg-white/10 transition-colors disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </div>
                  ))}
                  <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                    順序の変更はドラフト本文の段ブロックを並べ替えます（「適用」で確定します。本文で直接ブロックを移動しても同じです）。
                  </div>
                </div>
              )}
              <Toggle
                label="Luminance Lock (輝度ロック)"
                value={config.postCustomGlslLumaLock}
                options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                onChange={(v) => updateConfig('postCustomGlslLumaLock', v)}
              />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                断片の結果を輝度へ射影し直し、色を作る断片でも単色方針を保ちます（既定OFF）。
              </div>
              {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">カスタムポスト GLSL 適用中</p>}
              {status.state === 'error' && (
                <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
              )}
            </>
          )}
          {replacement && (
            <>
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                フラグメント全体を自分のコードで置きます。宣言はホスト側が供給します（tDiffuse / vUv / uTime / uResolution / uLumaLock が読めます。宣言し直すことはできません）。main を定義し、最終色を gl_FragColor へ書いてください。入力フレームのサンプリングと出力アルファはコード側の責任になり、輝度ロック（uLumaLock）に従うかどうかもコード側で決めます。
              </div>
              <textarea
                value={replaceDraft}
                onChange={(event) => setReplaceDraft(event.target.value)}
                spellCheck={false}
                rows={9}
                className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                placeholder={'// 例: void main() { gl_FragColor = vec4(vec3(1.0) - texture2D(tDiffuse, vUv).rgb, 1.0); }'}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => updateConfig('postCustomGlslReplacementCode', replaceDraft)}
                  disabled={!replaceDirty}
                  className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => setReplaceDraft(POST_GLSL_REPLACEMENT_EXAMPLE)}
                  className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  例を読み込む
                </button>
                {replaceDirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
              </div>
              {replaceStatus.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">全体差し替え 適用中</p>}
              {replaceStatus.state === 'error' && (
                <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {replaceStatus.message}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
