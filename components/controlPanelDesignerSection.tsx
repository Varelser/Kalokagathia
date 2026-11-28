import React from 'react';
import { Workflow } from 'lucide-react';
import type { ParticleConfig } from '../types';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle } from './controlPanelPlayTabShared';
import {
  buildDesignerBlockModelFromConfig,
  createDesignerBlockRecord,
  defaultDesignerBlocksStorage,
  designerBlockModelToConfigUpdates,
  layoutDesignerBlockModel,
  loadDesignerBlockRecords,
  persistDesignerBlockRecords,
  DESIGNER_BLOCKS_MAX_RECORDS,
  type DesignerBlockLayout,
  type DesignerBlockModel,
  type DesignerBlockRecord,
} from '../lib/designerBlocks';

/**
 * Designer section (limit plan stage 4, slice S7, first
 * instalment — STAGE4_DECISIONS 案3 ハイブリッド): the current
 * rule list + group definitions projected as a block
 * composition (lib/designerBlocks.ts), shown as a small
 * READ-ONLY flow diagram, with named save / load / delete of
 * compositions into their own storage key.
 *
 * Read-only is deliberate: in stage 4 the diagram only shows
 * the flow (pool -> groups -> rules, list order = evaluation
 * order); assembly still happens in the existing editors
 * (particle rules / groups), and the diagram follows them
 * live because the model is rebuilt from config on every
 * render. Stage 5 grows this same view into the editable
 * canvas — the saved format (designer-blocks-v1) is already
 * the graph form (nodes / edges) that stage 5 consumes.
 *
 * Applying a composition writes back ONLY the two serialised
 * entity keys (gpgpuParticleRules / gpgpuGroupsData) through
 * the entities' own serializers — the same write-back the
 * rule editor performs — so nothing else in the config, the
 * render path or the preset library is touched.
 */

const KIND_LABEL: Record<DesignerBlockModel['nodes'][number]['kind'], string> = {
  source: 'SOURCE',
  group: 'GROUP',
  rule: 'RULE',
};

const FlowDiagram: React.FC<{ model: DesignerBlockModel }> = ({ model }) => {
  const layout: DesignerBlockLayout = React.useMemo(() => layoutDesignerBlockModel(model), [model]);
  const nodeById = React.useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="w-full max-w-[640px] rounded border border-white/10 bg-black/30"
      role="img"
      aria-label="ブロック構成の流れ図（読み取り専用）"
    >
      <defs>
        <marker id="designer-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.45)" />
        </marker>
      </defs>
      {layout.edges.map((edge) => (
        <polyline
          key={edge.id}
          points={edge.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={1}
          strokeDasharray={edge.kind === 'reference' || edge.kind === 'composite' ? '3 3' : undefined}
          markerEnd="url(#designer-arrow)"
        />
      ))}
      {layout.nodes.map((placed) => {
        const node = nodeById.get(placed.id);
        if (!node) return null;
        const dimmed = !node.enabled || node.dangling === true;
        return (
          <g key={placed.id} opacity={dimmed ? 0.45 : 1}>
            <rect
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              rx={4}
              fill="rgba(255,255,255,0.06)"
              stroke="rgba(255,255,255,0.3)"
            />
            <text x={placed.x + 8} y={placed.y + 14} fontSize={8} fill="rgba(255,255,255,0.5)" letterSpacing={1}>
              {KIND_LABEL[node.kind]}{node.dangling ? ' · 未定義' : ''}{node.enabled ? '' : ' · 無効'}
            </text>
            <text x={placed.x + 8} y={placed.y + 28} fontSize={10} fill="rgba(255,255,255,0.9)">
              {node.label.length > 24 ? `${node.label.slice(0, 24)}…` : node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const DesignerSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [records, setRecords] = React.useState<DesignerBlockRecord[]>(() => {
    const storage = defaultDesignerBlocksStorage();
    return storage ? loadDesignerBlockRecords(storage) : [];
  });
  const [name, setName] = React.useState('');
  const [status, setStatus] = React.useState('');

  const model = React.useMemo(
    () => buildDesignerBlockModelFromConfig({
      gpgpuParticleRules: config.gpgpuParticleRules,
      gpgpuGroupsData: config.gpgpuGroupsData,
    }),
    [config.gpgpuParticleRules, config.gpgpuGroupsData],
  );
  const ruleCount = model.nodes.filter((node) => node.kind === 'rule').length;
  const groupCount = model.nodes.filter((node) => node.kind === 'group' && !node.dangling).length;

  const persist = (next: DesignerBlockRecord[]): boolean => {
    const storage = defaultDesignerBlocksStorage();
    if (!storage) {
      setStatus('保存先（localStorage）にアクセスできませんでした。');
      return false;
    }
    const result = persistDesignerBlockRecords(storage, next);
    if (!result.ok) {
      setStatus(`保存できませんでした（${result.reason}）。`);
      return false;
    }
    setRecords(next);
    return true;
  };

  const handleSave = () => {
    if (records.length >= DESIGNER_BLOCKS_MAX_RECORDS) {
      setStatus(`保存できるブロック構成は ${DESIGNER_BLOCKS_MAX_RECORDS} 件までです。`);
      return;
    }
    const record = createDesignerBlockRecord({ name: name || 'Designer Blocks', model });
    if (persist([record, ...records])) {
      setName('');
      setStatus(`現在の構成を「${record.name}」として保存しました（ルール ${ruleCount} 件・グループ ${groupCount} 件）。`);
    }
  };

  const handleApply = (record: DesignerBlockRecord) => {
    const updates = designerBlockModelToConfigUpdates(record.model);
    if (updates.gpgpuGroupsData === null) {
      setStatus('グループの保存量が上限を超えるため、この構成は適用できませんでした。');
      return;
    }
    write('gpgpuParticleRules', updates.gpgpuParticleRules);
    write('gpgpuGroupsData', updates.gpgpuGroupsData);
    setStatus(`「${record.name}」を適用しました。ルールとグループだけが書き戻され、他の設定には触れていません。`);
  };

  const handleDelete = (record: DesignerBlockRecord) => {
    if (persist(records.filter((item) => item.id !== record.id))) {
      setStatus(`「${record.name}」を削除しました。`);
    }
  };

  return (
    <section>
      <SectionTitle icon={<Workflow size={12} />}>Designer · ブロック構成</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        現在のルールとグループを「ブロック構成」として眺める面です（第4段・案3ハイブリッドの第1弾）。下の図は読み取り専用で、左が粒子プール、中央がグループ、右がルール（上から評価順）です。組み立て自体は従来のルール編集・グループ編集で行い、図はその変更にそのまま追随します。構成に名前を付けて保存でき、保存物はルールとグループだけを持つ独立の保存領域に置かれます（プリセットとは混ざりません）。適用するとルールとグループだけが書き戻され、他の設定・描画には触れません。保存形式（designer-blocks-v1）は第5段の配線キャンバスと互換なグラフ形式（ノード／エッジ）で、第5段でそのまま編集可能なキャンバスへ育てる前提です。
      </p>
      <div className="mb-3">
        <FlowDiagram model={model} />
        <p className="text-[10px] text-white/35 mt-1">
          ルール {ruleCount} 件・グループ {groupCount} 件。破線は参照（ルール→グループ／合成グループの構成元）、実線はデータの流れと評価順です。無効なルールと未定義のグループ参照は薄く表示されます。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="構成の名前"
          disabled={isPublicLibrary}
          className="w-44 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
        />
        <button
          onClick={handleSave}
          disabled={isPublicLibrary}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
        >
          現在の構成を保存
        </button>
      </div>
      {records.length > 0 ? (
        <div className="flex flex-col gap-1 mb-3">
          {records.map((record) => {
            const rules = record.model.nodes.filter((node) => node.kind === 'rule').length;
            const groups = record.model.nodes.filter((node) => node.kind === 'group' && !node.dangling).length;
            return (
              <div key={record.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 px-2 py-1.5">
                <span className="text-[11px] text-white/85">{record.name}</span>
                <span className="text-[10px] text-white/40">
                  {record.kind === 'template' ? '雛形' : '構成'} · ルール {rules} · グループ {groups} · {new Date(record.createdAt).toLocaleDateString()}
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => handleApply(record)}
                  disabled={isPublicLibrary}
                  className="px-3 py-1 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                  適用
                </button>
                <button
                  onClick={() => handleDelete(record)}
                  disabled={isPublicLibrary}
                  className="px-3 py-1 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                  削除
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-white/35 mb-3">保存済みのブロック構成はまだありません。</p>
      )}
      {status && <p className="text-[11px] text-white/55">{status}</p>}
    </section>
  );
};
