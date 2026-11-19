import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  PARTICLE_POINTS_VERTEX_GLSL_EXAMPLE,
  useParticlePointsVertexGlslStatus,
} from '../lib/particlePointsVertexGlsl';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// Particle Points Vertex GLSL (Phase CD): the panel block for
// the third GLSL injection point. Same shape as the Custom
// Force / Custom Post GLSL blocks — a draft textarea with an
// explicit Apply button, so a half-typed snippet never reaches
// the compile check.
export const ParticleVertexGlslBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useParticlePointsVertexGlslStatus();
  const [draft, setDraft] = React.useState(config.particlePointsVertexGlslCode);
  const dirty = draft !== config.particlePointsVertexGlslCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Particle Vertex GLSL</div>
      <Toggle label="Particle Points Vertex (GLSL)" value={config.particlePointsVertexGlslEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('particlePointsVertexGlslEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        粒子ポイントの頂点シェーダで pos が確定した直前に自分の GLSL を差し込みます（WebGL 経路）。pos（vec3）/ lifeProgress / aVariant / uTime が読めます。変位は disp（vec3）へ入れてください。コンパイル確認を通ったコードだけが差し替わり、失敗時は前の動作版を維持します。CPU フォールバック表示では適用されません。
      </div>
      {config.particlePointsVertexGlslEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: disp = vec3(0.0, sin(uTime * 2.0 + aVariant * 6.2831) * 0.05, 0.0);'}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('particlePointsVertexGlslCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(PARTICLE_POINTS_VERTEX_GLSL_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">粒子頂点 GLSL 適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};
