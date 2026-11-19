import React from 'react';

import { Toggle } from './controlPanelParts';
import { CUSTOM_POST_GLSL_EXAMPLE, useCustomPostGlslStatus } from '../lib/customPostGlsl';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// Custom Post GLSL (Phase BX): the panel block for the second
// GLSL injection point. Same shape as the Custom Force block —
// a draft textarea with an explicit Apply button, so a
// half-typed snippet never reaches the compile check — plus the
// luminance-lock toggle that belongs to this point's contract.
export const CustomPostGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useCustomPostGlslStatus();
  const [draft, setDraft] = React.useState(config.postCustomGlslCode);
  const dirty = draft !== config.postCustomGlslCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Custom Post GLSL</div>
      <Toggle label="Custom Post GLSL (GLSL)" value={config.postCustomGlslEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('postCustomGlslEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        最終段（Output Grade）の直前に自分の GLSL を差し込みます（WebGL 経路のポスト処理）。color（vec3）を読み書きでき、vUv / uTime / uResolution が読めます。入力テクスチャの直接サンプリングはできません。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.postCustomGlslEnabled && (
        <>
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
    </div>
  );
};
