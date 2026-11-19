import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  VOLUME_FOG_GLSL_EXAMPLE,
  useVolumeFogGlslStatus,
} from '../lib/volumeFogGlsl';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// Volume Fog Fragment GLSL (Phase CE): the panel block for the
// fifth GLSL injection point. Same shape as the other GLSL
// blocks — a draft textarea with an explicit Apply button, so
// a half-typed snippet never reaches the compile check.
export const VolumeFogGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useVolumeFogGlslStatus();
  const [draft, setDraft] = React.useState(config.volumeFogGlslCode);
  const dirty = draft !== config.volumeFogGlslCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Volume Fog GLSL</div>
      <Toggle label="Volume Fog Fragment (GLSL)" value={config.volumeFogGlslEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('volumeFogGlslEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        ボリューム霧の断片シェーダで密度の適用が終わった直後、フェードの直前に自分の GLSL を差し込みます（WebGL 経路）。vUv / vSlice / uTime が読めます。不透明度は alpha を読み書きしてください。同じコードが全スライスに効きます。霧はスライス数ぶん重ね描画されるため、この経路は重くなります。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.volumeFogGlslEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: alpha *= 0.5 + 0.5 * sin(vSlice * 0.05 + uTime);'}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('volumeFogGlslCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(VOLUME_FOG_GLSL_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">霧断片 GLSL 適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};
