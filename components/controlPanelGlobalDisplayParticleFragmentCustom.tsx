import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  PARTICLE_POINTS_FRAGMENT_GLSL_EXAMPLE,
  useParticlePointsFragmentGlslStatus,
} from '../lib/particlePointsFragmentGlsl';
import {
  PARTICLE_POINTS_FRAGMENT_REPLACEMENT_EXAMPLE,
  useParticlePointsFragmentReplacementStatus,
} from '../lib/glslReplacementPoints';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// Particle Points Fragment GLSL (Phase CE): the panel block for
// the fourth GLSL injection point. Same shape as the Custom
// Force / Custom Post GLSL / Particle Vertex blocks — a draft
// textarea with an explicit Apply button, so a half-typed
// snippet never reaches the compile check.
//
// Layer 1 WP11 phase D2/C: the point also has a full-fragment
// replacement form — the 著述形式 toggle switches the editor
// between the snippet and the replacement code, which IS the
// whole fragment (host declarations supplied; the code defines
// main and writes gl_FragColor; the vertex shader and its
// varyings are unchanged). Each form keeps its own code key
// and its own status store.
export const ParticleFragmentGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useParticlePointsFragmentGlslStatus();
  const replaceStatus = useParticlePointsFragmentReplacementStatus();
  const [draft, setDraft] = React.useState(config.particlePointsFragmentGlslCode);
  const dirty = draft !== config.particlePointsFragmentGlslCode;
  const [replaceDraft, setReplaceDraft] = React.useState(config.particlePointsFragmentGlslReplacementCode);
  const replaceDirty = replaceDraft !== config.particlePointsFragmentGlslReplacementCode;
  const replacement = config.particlePointsFragmentGlslReplacementEnabled;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Particle Fragment GLSL</div>
      <Toggle label="Particle Points Fragment (GLSL)" value={config.particlePointsFragmentGlslEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('particlePointsFragmentGlslEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        粒子ポイントの断片シェーダへ自分の GLSL を入れます（WebGL 経路）。著述形式は2つあります: 「断片」は色が確定した後・書き込みの直前に断片を差し込む従来の形、「全体差し替え」はフラグメント全体を自分のコードで置く形です。断片形式では共有スニペット定義（GLSL Shared Snippets）を「// @use 名前」で参照できます（全体差し替え形式は対象外）。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.particlePointsFragmentGlslEnabled && (
        <>
          <Toggle
            label="著述形式"
            value={replacement}
            options={[{ label: '断片 (Snippet)', val: false }, { label: '全体差し替え (Replace)', val: true }]}
            onChange={(v) => updateConfig('particlePointsFragmentGlslReplacementEnabled', v)}
          />
          {!replacement && (
            <>
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                vUv / vLife / vVelocity / vAlpha / uTime が読めます。色は color（vec4）を読み書きしてください。
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                rows={7}
                className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                placeholder={'// 例: color = vec4(vec3(1.0) - color.rgb, color.a);'}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => updateConfig('particlePointsFragmentGlslCode', draft)}
                  disabled={!dirty}
                  className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => setDraft(PARTICLE_POINTS_FRAGMENT_GLSL_EXAMPLE)}
                  className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  例を読み込む
                </button>
                {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
              </div>
              {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">粒子断片 GLSL 適用中</p>}
              {status.state === 'error' && (
                <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
              )}
            </>
          )}
          {replacement && (
            <>
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                フラグメント全体を自分のコードで置きます。宣言はホスト側が供給します（vUv / vLife / vVelocity / vAlpha / uTime が読めます。宣言し直すことはできません）。main を定義し、最終色を gl_FragColor へ書いてください。本体側のスプライト形状・SDF・レイヤーグラデーション等の決定は差し替えに含まれません（頂点シェーダと varying は従来のまま）。サンプリングと discard は使えません。
              </div>
              <textarea
                value={replaceDraft}
                onChange={(event) => setReplaceDraft(event.target.value)}
                spellCheck={false}
                rows={9}
                className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                placeholder={'// 例: void main() { gl_FragColor = vec4(vec3(vLife), vAlpha); }'}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => updateConfig('particlePointsFragmentGlslReplacementCode', replaceDraft)}
                  disabled={!replaceDirty}
                  className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => setReplaceDraft(PARTICLE_POINTS_FRAGMENT_REPLACEMENT_EXAMPLE)}
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
