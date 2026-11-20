import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

import { Slider, Toggle } from './controlPanelParts';
import {
  FREE_CURVE_MAX_POINTS,
  FREE_CURVE_MIN_POINTS,
  flattenFreeCurvePoints,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from '../lib/freeCurve';
import { useAttrPointCloud } from '../lib/attrPointCloud';
import {
  ATTR_SOURCES,
  ATTR_SOURCE_LABELS,
  normalizeAttrExprs,
  normalizeAttrNames,
  normalizeAttrSources,
} from '../lib/gpgpuAttributes';
import {
  freezeGpgpuGroup,
  makeGpgpuGroupId,
  parseGpgpuGroups,
  serializeGpgpuGroups,
  type GpgpuGroupDef,
} from '../lib/gpgpuGroups';
import { getLastAttrBake } from '../lib/gpgpuGroupBridge';

/** Free curve editor (Phase AJ): per-point t / value sliders with
 *  add / remove, plus shape presets. Controlled entirely by the
 *  config value (the flat [t, v, …] asset). Exported for the
 *  Trails section's tube profiles (Phase AM). */
export const FreeCurveEditor: React.FC<{
  points: FreeCurvePoint[];
  onChange: (points: FreeCurvePoint[]) => void;
}> = ({ points, onChange }) => {
  const updatePoint = (index: number, patch: Partial<FreeCurvePoint>) => {
    const next = points.map((point, i) => (i === index ? { ...point, ...patch } : point));
    onChange(normalizeFreeCurvePoints(flattenFreeCurvePoints(next)));
  };
  const presets: { label: string; points: FreeCurvePoint[] }[] = [
    { label: 'Flat（恒等）', points: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
    { label: 'Ramp（上昇）', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
    { label: 'Pulse（山）', points: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }] },
    { label: 'Gate（開閉）', points: [{ t: 0, v: 1 }, { t: 0.4, v: 1 }, { t: 0.5, v: 0 }, { t: 0.9, v: 0 }, { t: 1, v: 1 }] },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onChange(preset.points)}
            className="px-2 py-1 rounded-full border border-white/20 text-[9px] uppercase tracking-widest text-white/60 hover:bg-white/10"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {points.map((point, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Slider label={`点 ${index + 1} 位置 t`} value={point.t} min={0} max={1} step={0.01} onChange={(v) => updatePoint(index, { t: v })} />
          <Slider label={`点 ${index + 1} 値`} value={point.v} min={0} max={4} step={0.05} onChange={(v) => updatePoint(index, { v })} />
          {points.length > FREE_CURVE_MIN_POINTS && (
            <button
              onClick={() => onChange(points.filter((_, i) => i !== index))}
              className="pb-1 text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
            >
              削除
            </button>
          )}
        </div>
      ))}
      {points.length < FREE_CURVE_MAX_POINTS && (
        <button
          onClick={() => onChange(normalizeFreeCurvePoints(flattenFreeCurvePoints([...points, { t: 0.5, v: 1 }])))}
          className="w-full py-1.5 rounded border border-dashed border-white/20 text-white/60 text-[10px] hover:bg-white/5"
        >
          ＋ 制御点を追加（最大 {FREE_CURVE_MAX_POINTS} 点）
        </button>
      )}
    </div>
  );
};

/** Labeled native select in the Morph Target Shape's styling
 *  (Phase AK): used by the attribute section's enum controls. */
const AttrSelect: React.FC<{
  label?: string;
  value: string;
  options: { label: string; val: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    {label && <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">{label}</div>}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mb-2 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
    >
      {options.map((option) => (
        <option key={option.val} value={option.val}>{option.label}</option>
      ))}
    </select>
  </div>
);

/** Named attributes (Phase AK): the four attribute slots with
 *  their names and sources, the three drives (size / brightness /
 *  force) and the attribute group gate. Every control resolves
 *  off by default, so the section costs nothing while unused. */
const AttrSection: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const cloud = useAttrPointCloud();
  const names = normalizeAttrNames(config.gpgpuAttrNames);
  const sources = normalizeAttrSources(config.gpgpuAttrSources);
  const exprs = normalizeAttrExprs(config.gpgpuAttrExprs);
  const slotOptions = [
    { label: 'OFF', val: '-1' },
    { label: `Slot 1（${names[0]}）`, val: '0' },
    { label: `Slot 2（${names[1]}）`, val: '1' },
    { label: `Slot 3（${names[2]}）`, val: '2' },
    { label: `Slot 4（${names[3]}）`, val: '3' },
  ];
  const groupSlotOptions = slotOptions.slice(1);
  // Named groups (Phase CV): the definition library lives in the
  // serialised gpgpuGroupsData key; every edit round-trips through
  // the lib's parser/serializer so the stored form stays valid.
  const groupDefs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
  const [groupName, setGroupName] = React.useState('');
  const [groupPickA, setGroupPickA] = React.useState('');
  const [groupPickB, setGroupPickB] = React.useState('');
  const [groupOp, setGroupOp] = React.useState<'union' | 'intersection'>('union');
  const [groupNote, setGroupNote] = React.useState('');
  const saveGroupDefs = (next: GpgpuGroupDef[]) => {
    const text = serializeGpgpuGroups(next);
    if (text === null) {
      setGroupNote('グループの保存容量上限を超えるため保存できませんでした。');
      return;
    }
    updateConfig('gpgpuGroupsData', text);
    if (config.gpgpuGroupRef && !next.some((d) => d.id === config.gpgpuGroupRef)) {
      updateConfig('gpgpuGroupRef', '');
    }
    setGroupNote('');
  };
  const createGroupFromLegacy = () => {
    const def: GpgpuGroupDef = {
      id: makeGpgpuGroupId(groupDefs),
      name: groupName.trim() || `Group ${groupDefs.length + 1}`,
      source: {
        kind: 'predicate',
        predicate: {
          slot: config.gpgpuGroupSlot,
          mode: config.gpgpuGroupMode,
          low: config.gpgpuGroupLow,
          high: config.gpgpuGroupHigh,
          invert: config.gpgpuGroupInvert,
        },
      },
    };
    saveGroupDefs([...groupDefs, def]);
    setGroupName('');
  };
  const freezeGroup = (id: string) => {
    const bake = getLastAttrBake();
    if (!bake) {
      setGroupNote('属性ベイクがまだ無いため凍結できません（属性を使う設定で一度再生してください）。');
      return;
    }
    const next = freezeGpgpuGroup(groupDefs, id, bake.data, bake.data.length / 4);
    if (!next) {
      setGroupNote('このグループは凍結できませんでした。');
      return;
    }
    saveGroupDefs(next);
  };
  const createCompositeGroup = () => {
    if (!groupPickA || !groupPickB || groupPickA === groupPickB) {
      setGroupNote('合成には異なる2つのグループを選んでください。');
      return;
    }
    const def: GpgpuGroupDef = {
      id: makeGpgpuGroupId(groupDefs),
      name: groupName.trim() || `Group ${groupDefs.length + 1}`,
      source: { kind: 'composite', a: groupPickA, b: groupPickB, op: groupOp },
    };
    saveGroupDefs([...groupDefs, def]);
    setGroupName('');
  };
  const groupKindLabel = (def: GpgpuGroupDef): string => {
    if (def.source.kind === 'predicate') return '述語（ライブ）';
    if (def.source.kind === 'snapshot') return '凍結（スナップショット）';
    return def.source.op === 'union' ? '合成（和集合）' : '合成（積集合）';
  };
  const setName = (slot: number, value: string) => {
    const next = [...names];
    next[slot] = value;
    updateConfig('gpgpuAttrNames', next);
  };
  const setSource = (slot: number, value: string) => {
    const next = [...sources];
    next[slot] = value as (typeof sources)[number];
    updateConfig('gpgpuAttrSources', next);
  };
  const setExpr = (slot: number, value: string) => {
    const next = [...exprs];
    next[slot] = value;
    updateConfig('gpgpuAttrExprs', next);
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Attributes — 名前付き属性とグループ（Phase AK）</div>
      {[0, 1, 2, 3].map((slot) => (
        <div key={slot} className="mt-2 flex items-center gap-2">
          <span className="w-10 shrink-0 text-[9px] uppercase tracking-widest opacity-60">Slot {slot + 1}</span>
          <input
            type="text"
            value={names[slot]}
            onChange={(e) => setName(slot, e.target.value)}
            className="w-24 shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40"
            aria-label={`Attribute name slot ${slot + 1}`}
          />
          <div className="min-w-0 flex-1 [&_select]:mb-0">
            <AttrSelect
              value={sources[slot]}
              options={ATTR_SOURCES.map((source) => ({ label: ATTR_SOURCE_LABELS[source], val: source }))}
              onChange={(v) => setSource(slot, v)}
            />
          </div>
          <input
            type="text"
            value={exprs[slot]}
            onChange={(e) => setExpr(slot, e.target.value)}
            placeholder="a * b"
            className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40"
            aria-label={`Attribute expression slot ${slot + 1}`}
          />
        </div>
      ))}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        属性は粒子ごとの数値（0..1）で、生成時に固定されます。Data 源は Play タブで登録した属性点群の同名列（名前が一致しない場合は 0）を使います。属性点群: {cloud ? `登録済み（${cloud.table.rows.length} 行）` : '未登録（Play タブ → Data Source）'}。
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        式（Phase BI）は生成時のベイクで一度だけ計算され、結果が属性値になります（毎フレームは変わりません）。使える変数はスロット名（例: a * b、先のスロットは計算結果・後のスロットは生成値）と x（そのスロット自身の生成値）で、結果は 0..1 に収められます。不正な式は生成値のままになります。空欄は演算なしです。
      </div>
      <Toggle label="Dynamic Re-eval（属性の動的再評価 — 段階2）" value={config.gpgpuAttrDynEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAttrDynEnabled', v)} />
      {(config.gpgpuAttrDynEnabled || config.gpgpuAttrFeedbackEnabled) && (
        <Slider label="Re-eval Interval（再評価の間隔・フレーム）" value={config.gpgpuAttrDynInterval} min={1} max={60} step={1} onChange={(v) => updateConfig('gpgpuAttrDynInterval', Math.round(v))} />
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        段階2（Phase BO）: ON では上記の式が間隔ごとのフレームで再評価され、変数 t（シミュレーション時刻・秒）も使えます。再評価の結果は下の駆動とグループ判定にそのまま流れます。OFF では従来のベイクと完全同一です。CPU フォールバックでは属性自体が無いため使えません。
      </div>
      <Toggle label="Attribute Feedback（属性フィードバック — Phase BV）" value={config.gpgpuAttrFeedbackEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAttrFeedbackEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        フィードバック（Phase BV）: ON では式の予約変数 p で自スロットの前回の評価値を参照でき、p * 0.9 + drive * 0.1 のような蓄積・減衰が書けます。p の初期値はベイク値で、状態は再評価の実行回数だけ進みます（間隔を指定してもフレーム実数では進みません）。p を使わない式では従来の再評価／ベイクと同一です。WebGPU 経路では駆動・グループ判定側の消費はベイクのままです。
      </div>
      <AttrSelect label="Attr → Size（サイズ駆動）" value={String(config.gpgpuAttrSizeSlot)} options={slotOptions} onChange={(v) => updateConfig('gpgpuAttrSizeSlot', Number(v))} />
      {config.gpgpuAttrSizeSlot >= 0 && (
        <Slider label="Size Amount（サイズ駆動の量）" value={config.gpgpuAttrSizeAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuAttrSizeAmount', v)} />
      )}
      <AttrSelect label="Attr → Brightness（明るさ駆動）" value={String(config.gpgpuAttrBrightSlot)} options={slotOptions} onChange={(v) => updateConfig('gpgpuAttrBrightSlot', Number(v))} />
      {config.gpgpuAttrBrightSlot >= 0 && (
        <Slider label="Brightness Amount（明るさ駆動の量）" value={config.gpgpuAttrBrightAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuAttrBrightAmount', v)} />
      )}
      <Toggle label="Attr → Color（色駆動 — Phase CL）" value={config.gpgpuAttrColorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAttrColorEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        色駆動（Phase CL）: スロット名が colorR／colorG／colorB の3列（Data 源）を、正規化しない raw 値のまま点の色として掛けます。3名のうち1つでもスロットに割り当てられていない場合は無効扱いになります。色で3スロットを使うため、サイズ・明るさ・フォース・グループに使えるのは残り1スロットです。ポイントキャッシュの色列はフレームごとに保持されるので、再生に合わせて色も動きます。
      </div>
      <AttrSelect label="Attr → Force（フォース駆動）" value={String(config.gpgpuAttrForceSlot)} options={slotOptions} onChange={(v) => updateConfig('gpgpuAttrForceSlot', Number(v))} />
      {config.gpgpuAttrForceSlot >= 0 && (
        <Slider label="Force Amount（フォース駆動の量）" value={config.gpgpuAttrForceAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuAttrForceAmount', v)} />
      )}
      <Toggle label="Attribute Group（属性グループ — Phase AK）" value={config.gpgpuGroupEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGroupEnabled', v)} />
      {config.gpgpuGroupEnabled && (
        <>
          <AttrSelect label="Group Slot（条件に使う属性）" value={String(config.gpgpuGroupSlot)} options={groupSlotOptions} onChange={(v) => updateConfig('gpgpuGroupSlot', Number(v))} />
          <AttrSelect
            label="Group Mode（条件の型）"
            value={config.gpgpuGroupMode}
            options={[
              { label: 'Below（上限以下）', val: 'below' },
              { label: 'Above（下限以上）', val: 'above' },
              { label: 'Band（区間内）', val: 'band' },
            ]}
            onChange={(v) => updateConfig('gpgpuGroupMode', v as typeof config.gpgpuGroupMode)}
          />
          <Slider label="Group Low（下限）" value={config.gpgpuGroupLow} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuGroupLow', v)} />
          <Slider label="Group High（上限）" value={config.gpgpuGroupHigh} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuGroupHigh', v)} />
          <AttrSelect
            label="Group Target（ゲートするフォース）"
            value={config.gpgpuGroupTarget}
            options={[
              { label: 'All Forces（全フォース）', val: 'all' },
              { label: 'Gravity（重力）', val: 'gravity' },
              { label: 'Turbulence（乱流）', val: 'turbulence' },
              { label: 'Curl（カール）', val: 'curl' },
              { label: 'Wind（風）', val: 'wind' },
              { label: 'Morph（モーフ）', val: 'morph' },
            ]}
            onChange={(v) => updateConfig('gpgpuGroupTarget', v as typeof config.gpgpuGroupTarget)}
          />
          <Toggle label="Group Invert（条件の反転）" value={config.gpgpuGroupInvert} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGroupInvert', v)} />
        </>
      )}
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Named Groups — 名前付きグループ（Phase CV）</div>
      <AttrSelect
        label="Gate Group（ゲートに使うグループ）"
        value={config.gpgpuGroupRef || ''}
        options={[
          { label: '従来の単一条件（上の Group 設定）', val: '' },
          ...groupDefs.map((d) => ({ label: `${d.name}（${groupKindLabel(d)}）`, val: d.id })),
        ]}
        onChange={(v) => updateConfig('gpgpuGroupRef', v)}
      />
      {groupDefs.map((def) => (
        <div key={def.id} className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-white/90">{def.name}<span className="text-white/50"> — {groupKindLabel(def)}</span></span>
          {def.source.kind !== 'snapshot' && (
            <button type="button" onClick={() => freezeGroup(def.id)} className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white/80 hover:border-white/40">凍結</button>
          )}
          <button type="button" onClick={() => saveGroupDefs(groupDefs.filter((d) => d.id !== def.id))} className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white/80 hover:border-white/40">削除</button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="新しいグループ名"
          className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40"
          aria-label="New group name"
        />
        <button type="button" onClick={createGroupFromLegacy} className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white/80 hover:border-white/40">現在の条件で作成</button>
      </div>
      {groupDefs.length >= 2 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 [&_select]:mb-0">
            <AttrSelect value={groupPickA} options={[{ label: 'グループA', val: '' }, ...groupDefs.map((d) => ({ label: d.name, val: d.id }))]} onChange={setGroupPickA} />
          </div>
          <div className="w-24 shrink-0 [&_select]:mb-0">
            <AttrSelect value={groupOp} options={[{ label: '和集合', val: 'union' }, { label: '積集合', val: 'intersection' }]} onChange={(v) => setGroupOp(v as 'union' | 'intersection')} />
          </div>
          <div className="min-w-0 flex-1 [&_select]:mb-0">
            <AttrSelect value={groupPickB} options={[{ label: 'グループB', val: '' }, ...groupDefs.map((d) => ({ label: d.name, val: d.id }))]} onChange={setGroupPickB} />
          </div>
          <button type="button" onClick={createCompositeGroup} className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-white/80 hover:border-white/40">合成を作成</button>
        </div>
      )}
      {groupNote && (
        <div className="mt-1 text-[9px] leading-relaxed text-amber-200/80">{groupNote}</div>
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        名前付きグループ（Phase CV）: 「現在の条件で作成」は上の単一条件を述語グループとして登録します。「凍結」は現在の所属をスナップショットとして保持し、属性値が後で動いても所属は変わりません。ゲートに使うグループを選ぶと、Target のフォースはそのグループの所属で効きます（未選択なら従来の単一条件）。凍結グループは共有リンクには含まれず、この端末の保存とプリセットにだけ残ります。なお凍結／合成グループがゲートの間は、所属の受け渡しにスロット4のベイクを使うため、スロット4を読む駆動は所属（0/1）を読み、属性の動的再評価とフィードバックは休止します（述語グループではこの制限はありません）。
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        駆動は「属性値で係数を mix する」形で、Amount 0 は無効です。グループは条件を満たす粒子だけ（Invert でその逆だけ）に Target のフォースを効かせます。全て OFF が従来同一です。
      </div>
    </div>
  );
};

export const GlobalDisplayGpgpuForcesCoreSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* N-Body */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="N-Body Gravity" value={config.gpgpuNBodyEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuNBodyEnabled', v)} />
      {config.gpgpuNBodyEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuNBodyStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuNBodyStrength', v)} />
          <Slider label="Repulsion Radius" value={config.gpgpuNBodyRepulsion} min={0.5} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuNBodyRepulsion', v)} />
          <Slider label="Softening" value={config.gpgpuNBodySoftening} min={0.1} max={20} step={0.1} onChange={(v) => updateConfig('gpgpuNBodySoftening', v)} />
          <Slider label="Sample Count" value={config.gpgpuNBodySampleCount} min={4} max={64} step={4} onChange={(v) => updateConfig('gpgpuNBodySampleCount', v)} />
        </>
      )}
    </div>

    {/* Velocity Color */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Velocity Color" value={config.gpgpuVelColorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVelColorEnabled', v)} />
      {config.gpgpuVelColorEnabled && (
        <>
          <Slider label="Hue Min (°)" value={config.gpgpuVelColorHueMin} min={0} max={360} step={1} onChange={(v) => updateConfig('gpgpuVelColorHueMin', v)} />
          <Slider label="Hue Max (°)" value={config.gpgpuVelColorHueMax} min={0} max={360} step={1} onChange={(v) => updateConfig('gpgpuVelColorHueMax', v)} />
          <Slider label="Saturation" value={config.gpgpuVelColorSaturation} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuVelColorSaturation', v)} />
        </>
      )}
    </div>

    {/* Life/Age */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Life System" value={config.gpgpuAgeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAgeEnabled', v)} />
      {config.gpgpuAgeEnabled && (
        <>
          <Slider label="Lifetime (s)" value={config.gpgpuAgeMax} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('gpgpuAgeMax', v)} />
          <Slider label="Fade In" value={config.gpgpuAgeFadeIn} min={0} max={0.5} step={0.01} onChange={(v) => updateConfig('gpgpuAgeFadeIn', v)} />
          <Slider label="Fade Out" value={config.gpgpuAgeFadeOut} min={0} max={0.5} step={0.01} onChange={(v) => updateConfig('gpgpuAgeFadeOut', v)} />
        </>
      )}
    </div>

    {/* Lifecycle grammar (Phase AB): spawn gate / kill / global drag+cap */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Lifecycle — Spawn / Kill / Drag （ライフサイクル文法 — Phase AB）</div>
      <Slider label="Spawn Burst （開始バースト）" value={config.gpgpuSpawnBurst} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnBurst', v)} />
      <Slider label="Spawn Rate （放出レート）" value={config.gpgpuSpawnRate} min={0.01} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnRate', v)} />
      <Slider label="Spawn Pulse Interval （周期バースト間隔・秒、0でOFF）" value={config.gpgpuSpawnPulseInterval} min={0} max={30} step={0.1} onChange={(v) => updateConfig('gpgpuSpawnPulseInterval', v)} />
      {config.gpgpuSpawnPulseInterval > 0 && (
        <>
          <Slider label="Spawn Pulse Duty （周期内の放出割合）" value={config.gpgpuSpawnPulseDuty} min={0.05} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnPulseDuty', v)} />
          <Slider label="Spawn Pulse Cycles （繰り返し回数・0で無制限）" value={config.gpgpuSpawnPulseCycles} min={0} max={64} step={1} onChange={(v) => updateConfig('gpgpuSpawnPulseCycles', Math.round(v))} />
          <Slider label="Spawn Pulse Probability （周期ごとの発生確率）" value={config.gpgpuSpawnPulseProbability} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnPulseProbability', v)} />
        </>
      )}
      <Toggle label="Spawn Order （放出順）" value={config.gpgpuSpawnOrderMode} options={[{ label: 'Hash', val: 'hash' as const }, { label: 'Distance', val: 'distance' as const }, { label: 'Far', val: 'distanceFar' as const }]} onChange={(v) => updateConfig('gpgpuSpawnOrderMode', v)} />
      <Toggle label="Spawn Burst Event （バーストイベント — Phase AX）" value={config.gpgpuSpawnEventEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSpawnEventEnabled', v)} />
      {config.gpgpuSpawnEventEnabled && (
        <>
          <Slider label="Event Time （時刻・秒）" value={config.gpgpuSpawnEventTime} min={0} max={600} step={0.1} onChange={(v) => updateConfig('gpgpuSpawnEventTime', v)} />
          <Slider label="Event Count （リスポーン割合）" value={config.gpgpuSpawnEventCount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnEventCount', v)} />
          <Slider label="Event Speed （初速・直接指定）" value={config.gpgpuSpawnEventSpeed} min={0} max={50} step={0.1} onChange={(v) => updateConfig('gpgpuSpawnEventSpeed', v)} />
          <Slider label="Event Spread （初速の広がり）" value={config.gpgpuSpawnEventSpread} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnEventSpread', v)} />
        </>
      )}
      <Toggle label="Emission Curve （放出カーブ駆動 — Phase AJ）" value={config.gpgpuEmissionCurveEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuEmissionCurveEnabled', v)} />
      {config.gpgpuEmissionCurveEnabled && (
        <>
          <Slider label="Emission Curve Period （周期・秒）" value={config.gpgpuEmissionCurvePeriod} min={0.5} max={120} step={0.5} onChange={(v) => updateConfig('gpgpuEmissionCurvePeriod', v)} />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Free Curve （自由制御点カーブ — 放出の資産）</div>
          <FreeCurveEditor
            points={normalizeFreeCurvePoints(config.gpgpuFreeCurvePoints)}
            onChange={(points) => updateConfig('gpgpuFreeCurvePoints', flattenFreeCurvePoints(points))}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            年齢リスポーン（寿命での生まれ直し）を、周期の中でカーブの値の割合だけ通します。値 0 の区間は生まれ直しが止まり、寿命末尾の粒子が滞留します。Life System が OFF の間はリスポーン自体がないため無効です。全点 1（Flat）は有効でも従来同一です。
          </div>
        </>
      )}
      <Toggle label="Boundary Kill （境界キル）" value={config.gpgpuKillBoundary} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKillBoundary', v)} />
      <Toggle label="Mask Kill （マスクキル）" value={config.gpgpuKillMask} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKillMask', v)} />
      <Slider label="Global Drag （全体ドラッグ）" value={config.gpgpuDrag} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuDrag', v)} />
      <Slider label="Global Max Speed （全体の最高速度・0で無制限）" value={config.gpgpuMaxSpeed} min={0} max={350} step={1} onChange={(v) => updateConfig('gpgpuMaxSpeed', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        粒子の「生まれ方・消え方」の文法です。Spawn Burst は開始時に有効な粒子の割合（1＝全粒子で従来同一）、残りは Spawn Rate（プール割合/秒）で順に放出されます。放出順（Phase AX）は Hash が従来のハッシュ順、Distance は初期位置が原点に近い粒子から、Far は遠い粒子から放出します（ゲート有効時のみ）。周期バーストには繰り返し回数と周期ごとの発生確率（決定論ハッシュ判定）を付けられます。バーストイベントは指定時刻に生存プールの一部を一斉にリスポーンさせ、初速を直接指定します（未放出の粒子は対象外）。境界キルは球境界の外へ出た粒子を跳ね返さず消滅→リスポーンさせます。マスクキルはラスタマスク（Morph の Mask 画像）の拒否域にいる粒子を消滅→リスポーンさせます（マスク画像が読み込めていない間は無効）。Global Drag 1.1・Max Speed 0 が従来同一です。
      </div>
    </div>

    {/* Named attributes + group gate (Phase AK) */}
    <AttrSection config={config} updateConfig={updateConfig} />

    {/* Curl Noise */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Curl Noise" value={config.gpgpuCurlEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuCurlEnabled', v)} />
      {config.gpgpuCurlEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuCurlStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuCurlStrength', v)} />
          <Slider label="Scale" value={config.gpgpuCurlScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuCurlScale', v)} />
          <Slider label="Speed (時間発展)" value={config.gpgpuCurlSpeed} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuCurlSpeed', v)} />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Field Mode (場の型)</div>
          <select
            value={config.gpgpuCurlMode}
            onChange={(e) => updateConfig('gpgpuCurlMode', e.target.value as typeof config.gpgpuCurlMode)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="curl">Curl (従来のカール)</option>
            <option value="ridged">Ridged (稜線状に尖る)</option>
            <option value="vortex">Vortex (渦巻きを加える)</option>
          </select>
          <Slider label="Octaves (重ね)" value={config.gpgpuCurlOctaves} min={1} max={3} step={1} onChange={(v) => updateConfig('gpgpuCurlOctaves', Math.round(v))} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            場の型とオクターブ合成は Kinetix の noiseMode / turbulenceOctaves の移植です。Curl + 1オクターブが従来の場そのものです。
          </div>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Field Symmetry</div>
          <select
            value={config.gpgpuCurlSymmetry}
            onChange={(e) => updateConfig('gpgpuCurlSymmetry', e.target.value as typeof config.gpgpuCurlSymmetry)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="none">None (対称なし)</option>
            <option value="mirrorX">Mirror X (Xミラー)</option>
            <option value="radial4">Radial 4 (放射4分割)</option>
            <option value="radial6">Radial 6 (放射6分割)</option>
            <option value="octahedral">Octahedral (八面体)</option>
          </select>
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            カール場のサンプリング座標を対称化します（Kinetix の対称サンプリングの移植）。粒子の位置や画面の対称とは別物で、場そのものが万華鏡状になります。
          </div>
          <Toggle label="Field Glyphs （場のグリフ表示）" value={config.gpgpuFieldGlyphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFieldGlyphEnabled', v)} />
          {config.gpgpuFieldGlyphEnabled && (
            <>
              <Slider label="Glyph Grid （格子数）" value={config.gpgpuFieldGlyphGrid} min={4} max={40} step={1} onChange={(v) => updateConfig('gpgpuFieldGlyphGrid', Math.round(v))} />
              <Slider label="Glyph Length （長さ）" value={config.gpgpuFieldGlyphLength} min={0.05} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuFieldGlyphLength', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Curl 場そのものを z=0 平面の線分グリフ格子で重ね描きします（向き＝場の方向、長さ＝場の強さ）。シミュレーションと同じ式・同じ時計で評価する表示専用オーバーレイです。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Boids */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Boids Flocking" value={config.gpgpuBoidsEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuBoidsEnabled', v)} />
      {config.gpgpuBoidsEnabled && (
        <>
          <Slider label="Separation" value={config.gpgpuBoidsSeparation} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsSeparation', v)} />
          <Slider label="Alignment" value={config.gpgpuBoidsAlignment} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsAlignment', v)} />
          <Slider label="Cohesion" value={config.gpgpuBoidsCohesion} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsCohesion', v)} />
          <Slider label="Radius" value={config.gpgpuBoidsRadius} min={5} max={200} step={5} onChange={(v) => updateConfig('gpgpuBoidsRadius', v)} />
        </>
      )}
    </div>

    {/* Strange Attractor */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Strange Attractor" value={config.gpgpuAttractorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAttractorEnabled', v)} />
      {config.gpgpuAttractorEnabled && (
        <>
          <Toggle
            label="Type"
            value={config.gpgpuAttractorType}
            options={[{ label: 'Lorenz', val: 'lorenz' }, { label: 'Rössler', val: 'rossler' }, { label: 'Thomas', val: 'thomas' }, { label: 'Halvorsen', val: 'halvorsen' }, { label: 'Chen', val: 'chen' }, { label: 'Lü', val: 'lu' }, { label: 'Aizawa', val: 'aizawa' }, { label: 'Sprott', val: 'sprott' }, { label: 'Rabinovich', val: 'rabinovich' }, { label: 'De Jong', val: 'dejong' }, { label: 'Ikeda', val: 'ikeda' }, { label: 'Chua', val: 'chua' }]}
            onChange={(v) => updateConfig('gpgpuAttractorType', v)}
          />
          <Slider label="Strength" value={config.gpgpuAttractorStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAttractorStrength', v)} />
          <Slider label="Scale" value={config.gpgpuAttractorScale} min={0.5} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuAttractorScale', v)} />
        </>
      )}
    </div>

    {/* Lévy flight */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Lévy Flight" value={config.gpgpuLevyEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuLevyEnabled', v)} />
      {config.gpgpuLevyEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuLevyStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuLevyStrength', v)} />
          <Slider label="Rate" value={config.gpgpuLevyRate} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('gpgpuLevyRate', v)} />
        </>
      )}
    </div>

    {/* Kuramoto sync */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Kuramoto Sync" value={config.gpgpuKuramotoEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKuramotoEnabled', v)} />
      {config.gpgpuKuramotoEnabled && (
        <>
          <Slider label="Coupling" value={config.gpgpuKuramotoCoupling} min={0} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuKuramotoCoupling', v)} />
          <Slider label="Spread" value={config.gpgpuKuramotoSpread} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuKuramotoSpread', v)} />
          <Slider label="Radius" value={config.gpgpuKuramotoRadius} min={10} max={200} step={5} onChange={(v) => updateConfig('gpgpuKuramotoRadius', v)} />
          <Slider label="Influence" value={config.gpgpuKuramotoInfluence} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuKuramotoInfluence', v)} />
        </>
      )}
    </div>

    {/* Particle Life */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Particle Life" value={config.gpgpuParticleLifeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuParticleLifeEnabled', v)} />
      {config.gpgpuParticleLifeEnabled && (
        <>
          <Toggle
            label="Preset"
            value={config.gpgpuParticleLifePreset}
            options={[{ label: 'Cells', val: 'cells' }, { label: 'Snakes', val: 'snakes' }, { label: 'Community', val: 'community' }, { label: 'Random', val: 'random' }]}
            onChange={(v) => updateConfig('gpgpuParticleLifePreset', v)}
          />
          <Slider label="Species" value={config.gpgpuParticleLifeSpecies} min={2} max={6} step={1} onChange={(v) => updateConfig('gpgpuParticleLifeSpecies', Math.round(v))} />
          <Slider label="Strength" value={config.gpgpuParticleLifeStrength} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeStrength', v)} />
          <Slider label="Radius" value={config.gpgpuParticleLifeRadius} min={10} max={160} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeRadius', v)} />
          <Slider label="Friction" value={config.gpgpuParticleLifeFriction} min={0.5} max={0.99} step={0.01} onChange={(v) => updateConfig('gpgpuParticleLifeFriction', v)} />
          <div className="mt-1 mb-1 text-[10px] uppercase tracking-widest text-white/50">Behaviour （行動: 循環する捕食チェーン — 種 i は種 i+1 を追い、種 i-1 から逃げる）</div>
          <Slider label="Pursue （追跡）" value={config.gpgpuParticleLifePursue} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifePursue', v)} />
          <Slider label="Evade （逃避）" value={config.gpgpuParticleLifeEvade} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeEvade', v)} />
          <Slider label="Vision Range （視野距離）" value={config.gpgpuParticleLifeVisionRange} min={0} max={200} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeVisionRange', v)} />
          <Slider label="Vision Angle （視野角°）" value={config.gpgpuParticleLifeVisionAngle} min={10} max={360} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeVisionAngle', v)} />
          <Slider label="Max Speed （最高速度・0で無制限）" value={config.gpgpuParticleLifeMaxSpeed} min={0} max={120} step={1} onChange={(v) => updateConfig('gpgpuParticleLifeMaxSpeed', v)} />
          <Slider label="Meander Amount （徘徊）" value={config.gpgpuParticleLifeMeanderAmount} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeMeanderAmount', v)} />
          <Slider label="Meander Scale （徘徊スケール）" value={config.gpgpuParticleLifeMeanderScale} min={0.1} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuParticleLifeMeanderScale', v)} />
          <Slider label="Avoid （障害物回避・SDF有効時）" value={config.gpgpuParticleLifeAvoid} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeAvoid', v)} />
          {config.gpgpuParticleLifePreset === 'random' && (
            <button
              onClick={() => updateConfig('gpgpuParticleLifeSeed', Math.floor(Math.random() * 1000000))}
              className="mb-4 px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
            >
              Random Matrix (Seed {config.gpgpuParticleLifeSeed})
            </button>
          )}
        </>
      )}
    </div>

    {/* Vortex */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Vortex Field" value={config.gpgpuVortexEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVortexEnabled', v)} />
      {config.gpgpuVortexEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuVortexStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVortexStrength', v)} />
          <Slider label="Axis Tilt (rad)" value={config.gpgpuVortexTilt} min={-Math.PI} max={Math.PI} step={0.05} onChange={(v) => updateConfig('gpgpuVortexTilt', v)} />
        </>
      )}
    </div>

    {/* Wind */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Wind Force" value={config.gpgpuWindEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWindEnabled', v)} />
      {config.gpgpuWindEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuWindStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuWindStrength', v)} />
          <Slider label="Direction X" value={config.gpgpuWindX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindX', v)} />
          <Slider label="Direction Y" value={config.gpgpuWindY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindY', v)} />
          <Slider label="Direction Z" value={config.gpgpuWindZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindZ', v)} />
          <Slider label="Gustiness" value={config.gpgpuWindGust} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuWindGust', v)} />
        </>
      )}
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Wind Volume （配置型・Phase AL）</div>
      <Toggle label="Wind Volume" value={config.gpgpuWindVolumeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWindVolumeEnabled', v)} />
      {config.gpgpuWindVolumeEnabled && (
        <>
          <Slider label="Center X" value={config.gpgpuWindVolumeX} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuWindVolumeX', v)} />
          <Slider label="Center Y" value={config.gpgpuWindVolumeY} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuWindVolumeY', v)} />
          <Slider label="Center Z" value={config.gpgpuWindVolumeZ} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuWindVolumeZ', v)} />
          <Slider label="Radius" value={config.gpgpuWindVolumeRadius} min={1} max={400} step={1} onChange={(v) => updateConfig('gpgpuWindVolumeRadius', v)} />
          <Slider label="Volume Strength" value={config.gpgpuWindVolumeStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuWindVolumeStrength', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            置いた球の内側だけに風（向きと息づきは上の Wind 設定を継承）を効かせます。中心で最大、縁で滑らかにゼロになります。全体の Wind Force が OFF でもボリューム単独で効きます。
          </div>
        </>
      )}
    </div>

    {/* Gravity Well */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Gravity Well" value={config.gpgpuWellEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWellEnabled', v)} />
      {config.gpgpuWellEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuWellStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuWellStrength', v)} />
          <Slider label="Softening" value={config.gpgpuWellSoftening} min={1} max={100} step={1} onChange={(v) => updateConfig('gpgpuWellSoftening', v)} />
          <Slider label="Orbit (tangential)" value={config.gpgpuWellOrbit} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuWellOrbit', v)} />
          <Slider label="Well Count (ウェル数)" value={config.gpgpuWellCount} min={1} max={4} step={1} onChange={(v) => updateConfig('gpgpuWellCount', Math.round(v))} />
          {config.gpgpuWellCount > 1 && (
            <>
              <Slider label="Well Spread (配置半径)" value={config.gpgpuWellSpread} min={10} max={300} step={5} onChange={(v) => updateConfig('gpgpuWellSpread', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                2〜4個のウェルがゆっくり回るリング上に並びます（Kinetix の多重ウェル）。1個が従来の中心ウェルです。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Elastic Spring */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Elastic Spring" value={config.gpgpuElasticEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuElasticEnabled', v)} />
      {config.gpgpuElasticEnabled && (
        <Slider label="Strength" value={config.gpgpuElasticStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuElasticStrength', v)} />
      )}
    </div>

    {/* Magnetic / Lorentz */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Magnetic Field" value={config.gpgpuMagneticEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMagneticEnabled', v)} />
      {config.gpgpuMagneticEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuMagneticStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticStrength', v)} />
          <Slider label="Field X" value={config.gpgpuMagneticBX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBX', v)} />
          <Slider label="Field Y" value={config.gpgpuMagneticBY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBY', v)} />
          <Slider label="Field Z" value={config.gpgpuMagneticBZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBZ', v)} />
        </>
      )}
    </div>

    {/* SPH Fluid */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="SPH Fluid" value={config.gpgpuSphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSphEnabled', v)} />
      {config.gpgpuSphEnabled && (
        <>
          <Slider label="Pressure" value={config.gpgpuSphPressure} min={0} max={20} step={0.1} onChange={(v) => updateConfig('gpgpuSphPressure', v)} />
          <Slider label="Viscosity" value={config.gpgpuSphViscosity} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuSphViscosity', v)} />
          <Slider label="Interaction Radius" value={config.gpgpuSphRadius} min={5} max={200} step={5} onChange={(v) => updateConfig('gpgpuSphRadius', v)} />
          <Slider label="Rest Density" value={config.gpgpuSphRestDensity} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSphRestDensity', v)} />
          <Slider label="Surface Tension （表面張力・近似）" value={config.gpgpuSphSurfaceTension} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuSphSurfaceTension', v)} />
        </>
      )}
    </div>

    {/* Grains (Phase AQ): DEM-style grain contact / friction */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Grains （粒状体ソルバ）" value={config.gpgpuGrainsEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGrainsEnabled', v)} />
      {config.gpgpuGrainsEnabled && (
        <>
          <Slider label="Grain Size （粒径）" value={config.gpgpuGrainsSize} min={1} max={60} step={0.5} onChange={(v) => updateConfig('gpgpuGrainsSize', v)} />
          <Slider label="Stiffness （接触の硬さ）" value={config.gpgpuGrainsStiffness} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuGrainsStiffness', v)} />
          <Slider label="Friction （摩擦・安息角は創発）" value={config.gpgpuGrainsFriction} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuGrainsFriction', v)} />
          <Slider label="Repose Angle （安息角・度。0=創発、有効時は摩擦より優先）" value={config.gpgpuGrainsReposeAngle} min={0} max={90} step={0.5} onChange={(v) => updateConfig('gpgpuGrainsReposeAngle', v)} />
          <Slider label="Cohesion （凝集）" value={config.gpgpuGrainsCohesion} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuGrainsCohesion', v)} />
          <Slider label="Restitution （反発）" value={config.gpgpuGrainsRestitution} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuGrainsRestitution', v)} />
          <Slider label="Rest Damping （静止減衰）" value={config.gpgpuGrainsRestDamping} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuGrainsRestDamping', v)} />
        </>
      )}
    </div>

    {/* Pyro (Phase AS): particle-side temperature / buoyancy */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Pyro （温度・浮力ソルバ）" value={config.gpgpuPyroEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuPyroEnabled', v)} />
      {config.gpgpuPyroEnabled && (
        <>
          <Slider label="Temperature （放出温度）" value={config.gpgpuPyroTemperature} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuPyroTemperature', v)} />
          <Slider label="Buoyancy （浮力・重力単位）" value={config.gpgpuPyroBuoyancy} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuPyroBuoyancy', v)} />
          <Slider label="Cooling （冷却の指数）" value={config.gpgpuPyroCooling} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuPyroCooling', v)} />
          <Slider label="Disturbance （攪拌）" value={config.gpgpuPyroDisturbance} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuPyroDisturbance', v)} />
          <Slider label="Disturbance Heat （カールへの温度連動）" value={config.gpgpuPyroDisturbanceHeat} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuPyroDisturbanceHeat', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            温度は年齢から決定的に導かれます（熱い粒子ほど昇り、冷えると落ち着きます）。グリッドの密度場・圧力投影・燃焼は解かない粒子側ソルバです。
          </div>
        </>
      )}
    </div>

    {/* Pyro Grid (Phase CA/CB): atlas grid solver — density /
        temperature / pressure projection on a real 3D grid, fog
        feed, particle coupling, vorticity, combustion. */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Pyro Grid （グリッドソルバ）" value={config.gpgpuPyroGridEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuPyroGridEnabled', v)} />
      {config.gpgpuPyroGridEnabled && (
        <>
          <Toggle
            label="Grid Resolution （解像度）"
            value={config.gpgpuPyroGridResolution}
            options={[{ label: 'Auto', val: 0 }, { label: '32³', val: 32 }, { label: '48³', val: 48 }, { label: '64³', val: 64 }, { label: '96³', val: 96 }]}
            onChange={(v) => updateConfig('gpgpuPyroGridResolution', v)}
          />
          <Slider label="Jacobi Iterations （圧力反復）" value={config.gpgpuPyroGridJacobiIterations} min={0} max={32} step={1} onChange={(v) => updateConfig('gpgpuPyroGridJacobiIterations', v)} />
          <Slider label="Grid Blend （PIC↔FLIP結合）" value={config.gpgpuPyroGridBlend} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuPyroGridBlend', v)} />
          <Slider label="Grid Transfer （結合の移転率）" value={config.gpgpuPyroGridTransfer} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuPyroGridTransfer', v)} />
          <Slider label="Vorticity ε （渦度閉じ込め）" value={config.gpgpuPyroVorticityEpsilon} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuPyroVorticityEpsilon', v)} />
          <Slider label="Fuel Rate （燃焼）" value={config.gpgpuPyroFuelRate} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuPyroFuelRate', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            密度・温度をフォグ層へ供給し（レイヤー側の Pyro 量で効きます）、粒子結合は Blend が 0 より大きいときだけ働きます。ε と燃料は 0 で従来同一です。
          </div>
        </>
      )}
    </div>

    {/* Vector Field */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Vector Field" value={config.gpgpuVFieldEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVFieldEnabled', v)} />
      {config.gpgpuVFieldEnabled && (
        <>
          <Toggle
            label="Field Type"
            value={config.gpgpuVFieldType}
            options={[{ label: 'Dipole', val: 'dipole' }, { label: 'Saddle', val: 'saddle' }, { label: 'Spiral', val: 'spiral' }, { label: 'Source', val: 'source' }, { label: 'ABC Flow', val: 'abc' }, { label: 'Double Gyre', val: 'gyre' }, { label: 'Worley', val: 'worley' }]}
            onChange={(v) => updateConfig('gpgpuVFieldType', v)}
          />
          <Slider label="Strength" value={config.gpgpuVFieldStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVFieldStrength', v)} />
          <Slider label="Scale" value={config.gpgpuVFieldScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuVFieldScale', v)} />
        </>
      )}
    </div>

    {/* Spring */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Spring (to Spawn)" value={config.gpgpuSpringEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSpringEnabled', v)} />
      {config.gpgpuSpringEnabled && (
        <Slider label="Strength" value={config.gpgpuSpringStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSpringStrength', v)} />
      )}
    </div>
  </>
);
