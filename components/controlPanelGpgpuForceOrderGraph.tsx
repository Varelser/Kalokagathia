import React from 'react';
import type { ParticleConfig } from '../types';
import type { UpdateConfig } from './controlPanelTabsShared';
import {
  isDefaultGpgpuForceOrder,
  normalizeGpgpuForceOrder,
  serializeGpgpuForceOrder,
  type GpgpuForceChunkName,
} from '../lib/gpgpuForceOrder';
import { gpgpuForceChunkMeta, resolveForceChunkActive } from '../lib/gpgpuForceChunkMeta';

/**
 * Force order graph view (TD §7 stage 2, Phase 34).
 *
 * The GPGPU velocity shader applies its built-in force
 * chunks in the order stored in the gpgpuForceOrder key
 * (lib/gpgpuForceOrder.ts); until now that key could only
 * be set through preset data — the panel had no editor.
 * This view shows the chain as it truly is: a fixed head
 * (gravity and the spawn/attribute preparation, not
 * reorderable), the 23 chunks in their current order, and
 * the fixed tail parts (SPH / Grains / VField / Spring,
 * then morph / FLIP / custom force / clamp). Reordering
 * writes the existing key through its serializer; the
 * default order stores as ''.
 *
 * The view permutes only. Whether a force is active is
 * governed by its own keys and is shown as a readout;
 * variant-gated chunks are spliced into the shader only
 * while their enable key is on.
 */

interface Props {
  config: ParticleConfig;
  updateConfig: UpdateConfig;
}

const FixedBlock: React.FC<{ title: string; detail: string }> = ({ title, detail }) => (
  <div className="rounded border border-dashed border-white/15 bg-black/10 px-3 py-2">
    <span className="text-[11px] text-white/50">{title}</span>
    <span className="ml-2 text-[10px] text-white/35">{detail}</span>
  </div>
);

const Connector: React.FC = () => (
  <div className="flex justify-center py-0.5" aria-hidden>
    <div className="h-3 w-px bg-white/25" />
  </div>
);

export const GpgpuForceOrderGraph: React.FC<Props> = ({ config, updateConfig }) => {
  const order = normalizeGpgpuForceOrder(config.gpgpuForceOrder);
  const isDefault = isDefaultGpgpuForceOrder(config.gpgpuForceOrder);
  const [selected, setSelected] = React.useState<GpgpuForceChunkName>('attractor');

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    updateConfig('gpgpuForceOrder', serializeGpgpuForceOrder(next));
  };

  const selectedMeta = gpgpuForceChunkMeta(selected);

  return (
    <div>
      <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
        Force Order Graph
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-white/50">
        速度シェーダの中で内蔵フォースが適用される順序です。↑↓ で並べ替えると、その場でシェーダが組み立て直されます。
        有効・無効は各フォース自身の設定で決まり、ここでは現在の状態を表示するだけです。
        点線の枠は順序キーでは動かせない固定部品です。
      </p>

      <FixedBlock title="固定ヘッド" detail="rigid 早期判定 / スポーン / 属性とグループ倍率 / 重力" />
      <Connector />
      {order.map((rawName, index) => {
        const name = rawName as GpgpuForceChunkName;
        const meta = gpgpuForceChunkMeta(name);
        const activity = resolveForceChunkActive(name, config);
        const isSelected = selected === name;
        return (
          <React.Fragment key={name}>
            <div
              className={`flex items-center gap-2 rounded border px-3 py-2 transition-colors ${
                isSelected ? 'border-white/60 bg-[#2a2a2a]' : 'border-white/12 bg-[#1c1c1c]'
              }`}
            >
              <button type="button" onClick={() => setSelected(name)} className="flex flex-1 items-center gap-2 text-left">
                <span className="text-[10px] text-white/35">{index + 1}</span>
                <span className={`text-[12px] ${activity === 'inactive' ? 'text-white/40' : 'text-white/90'}`}>{meta.label}</span>
                <span className="text-[9px] text-white/30">{name}</span>
                {meta.orderNote && <span className="text-[9px] text-amber-200/70">順序で結果が変わる</span>}
              </button>
              <span className={`rounded px-1.5 py-0.5 text-[9px] ${
                activity === 'active' ? 'bg-emerald-300/15 text-emerald-200'
                  : activity === 'derived' ? 'bg-white/[0.07] text-white/50'
                    : 'bg-white/[0.05] text-white/35'
              }`}>
                {activity === 'active' ? '有効' : activity === 'derived' ? '地形依存' : '無効'}
              </span>
              {meta.variantGated && (
                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] text-white/50">有効時のみ挿入</span>
              )}
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
      <FixedBlock title="固定部品" detail="SPH / Grains / VField / Spring" />
      <Connector />
      <FixedBlock title="固定末尾" detail="morph / Vellum / paint / FLIP / カスタムフォース / 速度クランプ" />

      {selectedMeta?.orderNote && (
        <div className="mt-4 rounded border border-amber-300/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
          {selectedMeta.label}: {selectedMeta.orderNote}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button type="button" disabled={isDefault}
          onClick={() => updateConfig('gpgpuForceOrder', '')}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
          既定順に戻す
        </button>
        <span className="text-[10px] tracking-wider text-white/40">
          {isDefault ? '現在の順序は既定です' : '既定から変更されています（プリセットに保存されます）'}
        </span>
      </div>
    </div>
  );
};
