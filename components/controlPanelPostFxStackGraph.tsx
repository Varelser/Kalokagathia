import React from 'react';
import type { ParticleConfig } from '../types';
import type { UpdateConfig } from './controlPanelTabsShared';
import {
  getActivePostFxStageIds,
  isProfilePostFxStackOrder,
  resolvePostFxStackOrder,
  serializePostFxStackOrder,
  type PostFxStageId,
} from '../lib/postFxStack';
import { postFxStageMeta } from '../lib/postFxStageMeta';

/**
 * PostFx stack graph view (TD §7 stage 3, Phase 35).
 *
 * The post chain is a sequence of stage components the
 * rendered frame flows through. Until now the stage order
 * came only from the five built-in profiles
 * (postFxStackProfile); this view lets the user declare
 * their own order, stored in the postFxStackOrder key
 * ('' = profile order) and resolved by lib/postFxStack.ts.
 * The view permutes only: whether a stage exists is
 * decided by its own config conditions and is shown as a
 * readout. Stages with a recorded placement reason
 * (output-grade, edge-capture, chroma-key) carry a note.
 */

interface Props {
  config: ParticleConfig;
  updateConfig: UpdateConfig;
}

const Connector: React.FC = () => (
  <div className="flex justify-center py-0.5" aria-hidden>
    <div className="h-3 w-px bg-white/25" />
  </div>
);

export const PostFxStackGraph: React.FC<Props> = ({ config, updateConfig }) => {
  const order = resolvePostFxStackOrder(config);
  const active = new Set(getActivePostFxStageIds(config));
  const isProfile = isProfilePostFxStackOrder(config.postFxStackOrder, config.postFxStackProfile);
  const [selected, setSelected] = React.useState<PostFxStageId>('output-grade');

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    updateConfig('postFxStackOrder', serializePostFxStackOrder(next, config.postFxStackProfile));
  };

  const selectedMeta = postFxStageMeta(selected);

  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-white/50">
        描画済みフレームがポスト段を通る順序です。↑↓ で並べ替えると、その場で適用順が変わります。
        段が存在するかどうかは各段自身の設定で決まり、ここでは現在の状態を表示するだけです。
        カスタム順を設定している間は、Stack Profile の順序よりカスタム順が優先されます。
      </p>

      <div className="rounded border border-dashed border-white/15 bg-black/10 px-3 py-2">
        <span className="text-[11px] text-white/50">入力フレーム</span>
        <span className="ml-2 text-[10px] text-white/35">シーンの描画結果</span>
      </div>
      <Connector />
      {order.map((id, index) => {
        const meta = postFxStageMeta(id);
        const isActive = active.has(id);
        const isSelected = selected === id;
        return (
          <React.Fragment key={id}>
            <div
              className={`flex items-center gap-2 rounded border px-3 py-2 transition-colors ${
                isSelected ? 'border-white/60 bg-[#2a2a2a]' : 'border-white/12 bg-[#1c1c1c]'
              }`}
            >
              <button type="button" onClick={() => setSelected(id)} className="flex flex-1 items-center gap-2 text-left">
                <span className="text-[10px] text-white/35">{index + 1}</span>
                <span className={`text-[12px] ${isActive ? 'text-white/90' : 'text-white/40'}`}>{meta.label}</span>
                <span className="text-[9px] text-white/30">{id}</span>
                {meta.orderNote && <span className="text-[9px] text-amber-200/70">順序に理由あり</span>}
              </button>
              <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                isActive ? 'bg-emerald-300/15 text-emerald-200' : 'bg-white/[0.05] text-white/35'
              }`}>
                {isActive ? '有効' : '無効'}
              </span>
              <span className="flex flex-col">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}
                  className="px-1 text-[10px] leading-tight text-white/60 transition-colors hover:text-white disabled:opacity-25">▲</button>
                <button type="button" disabled={index === order.length - 1} onClick={() => move(index, 1)}
                  className="px-1 text-[10px] leading-tight text-white/60 transition-colors hover:text-white disabled:opacity-25">▼</button>
              </span>
            </div>
            <Connector />
          </React.Fragment>
        );
      })}
      <div className="rounded border border-dashed border-white/15 bg-black/10 px-3 py-2">
        <span className="text-[11px] text-white/50">画面出力</span>
      </div>

      {selectedMeta?.orderNote && (
        <div className="mt-4 rounded border border-amber-300/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
          {selectedMeta.label}: {selectedMeta.orderNote}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button type="button" disabled={isProfile}
          onClick={() => updateConfig('postFxStackOrder', '')}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
          プロファイル順に戻す
        </button>
        <span className="text-[10px] tracking-wider text-white/40">
          {isProfile
            ? `現在の順序はプロファイル（${config.postFxStackProfile}）の順序です`
            : 'カスタム順が有効です（プリセットに保存されます）'}
        </span>
      </div>
    </div>
  );
};
