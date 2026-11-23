import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  GEOM_CUSTOM_FRAGMENT_GLSL_EXAMPLE,
  GEOM_CUSTOM_VERTEX_GLSL_EXAMPLE,
  useGeomCustomFragmentGlslStatus,
  useGeomCustomVertexGlslStatus,
} from '../lib/geomCustomGlsl';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// GEOM Custom GLSL (Phase 16 stage 4): the panel blocks for the
// two GEOM injection points. Same shape as the Particle Vertex /
// Fragment GLSL blocks — a draft textarea with an explicit Apply
// button, so a half-typed snippet never reaches the compile
// check. Vertex and fragment are independent points with
// independent status stores.

export const GeomCustomVertexGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useGeomCustomVertexGlslStatus();
  const [draft, setDraft] = React.useState(config.gpgpuGeomCustomVertexCode);
  const dirty = draft !== config.gpgpuGeomCustomVertexCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Geom Vertex GLSL</div>
      <Toggle label="Geom Vertex (GLSL)" value={config.gpgpuGeomCustomVertexEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGeomCustomVertexEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        ジオメトリ描画の頂点シェーダで位置が確定した直後に自分の GLSL を差し込みます（WebGL 経路）。worldPos（vec3）/ normal / uTime が読めます。変位は disp（vec3）へ入れてください。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.gpgpuGeomCustomVertexEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: disp = vec3(0.0, sin(uTime * 2.0 + worldPos.x * 0.05) * 0.5, 0.0);'}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('gpgpuGeomCustomVertexCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(GEOM_CUSTOM_VERTEX_GLSL_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">ジオメトリ頂点 GLSL 適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};

export const GeomCustomFragmentGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useGeomCustomFragmentGlslStatus();
  const [draft, setDraft] = React.useState(config.gpgpuGeomCustomFragmentCode);
  const dirty = draft !== config.gpgpuGeomCustomFragmentCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Geom Fragment GLSL</div>
      <Toggle label="Geom Fragment (GLSL)" value={config.gpgpuGeomCustomFragmentEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGeomCustomFragmentEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        ジオメトリ描画の断片シェーダでライティング直後に自分の GLSL を差し込みます（WebGL 経路）。col（vec3）/ N / V が読めます。書き戻しは col のみです。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.gpgpuGeomCustomFragmentEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: col *= 0.85 + 0.15 * N.y;'}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('gpgpuGeomCustomFragmentCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(GEOM_CUSTOM_FRAGMENT_GLSL_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">ジオメトリ断片 GLSL 適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};
