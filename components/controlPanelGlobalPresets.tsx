import React from 'react';
import { Bookmark, Pause, Save } from 'lucide-react';
import { PRESET_CATEGORY_OPTIONS, getPresetCategories, getPresetPerformanceTier, getPresetSearchText } from '../lib/presetCatalog';
import { PRESET_HIERARCHY, filterPresetsByHierarchy, getPresetHierarchyPlacement } from '../lib/presetHierarchy';
import { PARTIAL_GROUPS } from '../lib/presetPartial';
import {
  applyPresetReuseUnit,
  createPresetReuseUnitFromGroups,
  parsePresetReuseUnits,
  serializePresetReuseUnits,
  type PresetReuseUnit,
} from '../lib/presetReuseUnits';
import { Slider } from './controlPanelParts';
import { ControlPanelPresetCard } from './controlPanelPresetCard';
import { ControlPanelPresetLibraryIO } from './controlPanelPresetLibraryIO';
import { ControlPanelContentProps, NoticeBanner } from './controlPanelTabsShared';

/**
 * Named reuse units (Layer 1 WP10 phase C wiring of the
 * phase-B grammar in lib/presetReuseUnits.ts): a fixed
 * partial-apply group selection frozen under a name, captured
 * from the current config and re-applied later. Definitions
 * are setup-side data — they persist under their own
 * localStorage key (the user-parameters / designer-blocks
 * discipline), never inside config or preset records, and no
 * config key is registered for them. Applying goes through
 * onApplyConfig with the lib's pure apply result, exactly
 * like partial apply: the panel never writes the base config
 * itself.
 */
const REUSE_UNITS_STORAGE_KEY = 'kalokagathia.presetReuseUnits.v1';

function loadStoredReuseUnits(): PresetReuseUnit[] {
  try {
    return parsePresetReuseUnits(window.localStorage.getItem(REUSE_UNITS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function storeReuseUnits(units: PresetReuseUnit[]): boolean {
  try {
    window.localStorage.setItem(REUSE_UNITS_STORAGE_KEY, serializePresetReuseUnits(units));
    return true;
  } catch {
    return false;
  }
}

export const GlobalPresetsSection: React.FC<ControlPanelContentProps> = ({
  config,
  updateConfig,
  activePresetId,
  editingPresetId,
  editingPresetName,
  formatPresetDate,
  handleCreatePreset,
  handleLibraryFileChange,
  handleStartRename,
  handleSubmitRename,
  isPresetDirty,
  isPresetTransitioning,
  isPublicLibrary,
  libraryImportMode,
  libraryInputRef,
  libraryNotice,
  onAddPresetToSequence,
  onApplyConfig,
  onDeletePreset,
  onDismissLibraryNotice,
  onDuplicatePreset,
  onExportLibrary,
  onLoadPreset,
  onOverwritePreset,
  onPresetBlendDurationChange,
  onSyncApplyPresets,
  onSyncNotice,
  onStopPresetTransition,
  onTransitionToPreset,
  presetBlendDuration,
  presetName,
  presets,
  setEditingPresetId,
  setEditingPresetName,
  setLibraryImportMode,
  setPresetName,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState<(typeof PRESET_CATEGORY_OPTIONS)[number]>('All');
  // Hierarchy (系統 > 家族) narrowing, stage-4 slice S8. Both
  // stay null by default, in which case the list below is
  // exactly the pre-hierarchy behaviour.
  const [hierarchyLineageId, setHierarchyLineageId] = React.useState<string | null>(null);
  const [hierarchyFamilyId, setHierarchyFamilyId] = React.useState<string | null>(null);
  // Reuse units (WP10 phase C): definitions held in their own
  // storage key; the group selection mirrors Partial Apply's.
  const [reuseUnits, setReuseUnits] = React.useState<PresetReuseUnit[]>(() => loadStoredReuseUnits());
  const [reuseUnitName, setReuseUnitName] = React.useState('');
  const [reuseGroups, setReuseGroups] = React.useState<ReadonlySet<string>>(new Set(['motion']));
  const [reuseNote, setReuseNote] = React.useState('');

  const toggleReuseGroup = (id: string) => {
    setReuseGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateReuseUnit = () => {
    const unit = createPresetReuseUnitFromGroups({
      name: reuseUnitName.trim() || 'Reuse Unit',
      source: config as unknown as Record<string, unknown>,
      groupIds: reuseGroups,
    });
    if (!unit) {
      setReuseNote('選択したグループに該当する項目が現在の設定にありませんでした。');
      return;
    }
    const next = [unit, ...reuseUnits];
    if (storeReuseUnits(next)) {
      setReuseUnits(next);
      setReuseUnitName('');
      setReuseNote(`再利用単位「${unit.name}」（${unit.keys.length} 項目）を作成しました。`);
    } else {
      setReuseNote('再利用単位を保存できませんでした。');
    }
  };

  const handleApplyReuseUnit = (unit: PresetReuseUnit) => {
    if (!onApplyConfig) return;
    onApplyConfig(applyPresetReuseUnit(config, unit));
    setReuseNote(`再利用単位「${unit.name}」（${unit.keys.length} 項目）を適用しました。`);
  };

  const handleDeleteReuseUnit = (unit: PresetReuseUnit) => {
    const next = reuseUnits.filter((item) => item.id !== unit.id);
    if (storeReuseUnits(next)) {
      setReuseUnits(next);
      setReuseNote(`再利用単位「${unit.name}」を削除しました。`);
    } else {
      setReuseNote('再利用単位の削除を保存できませんでした。');
    }
  };

  const hierarchyCounts = React.useMemo(() => {
    const byLineage = new Map<string, number>();
    const byFamily = new Map<string, number>();
    presets.forEach((preset) => {
      const placement = getPresetHierarchyPlacement(preset.id);
      if (!placement) return;
      byLineage.set(placement.lineageId, (byLineage.get(placement.lineageId) ?? 0) + 1);
      byFamily.set(placement.familyId, (byFamily.get(placement.familyId) ?? 0) + 1);
    });
    return { byLineage, byFamily };
  }, [presets]);

  const filteredPresets = React.useMemo(() => presets.filter((preset) => {
    const categories = getPresetCategories(preset);
    const matchesQuery = searchQuery.trim().length === 0 || getPresetSearchText(preset).includes(searchQuery.trim().toLowerCase());
    const matchesCategory = categoryFilter === 'All' || categories.includes(categoryFilter);
    return matchesQuery && matchesCategory;
  }), [categoryFilter, presets, searchQuery]);

  const visiblePresets = React.useMemo(
    () => filterPresetsByHierarchy(filteredPresets, { lineageId: hierarchyLineageId, familyId: hierarchyFamilyId }),
    [filteredPresets, hierarchyFamilyId, hierarchyLineageId],
  );

  const activeLineage = PRESET_HIERARCHY.lineages.find((lineage) => lineage.id === hierarchyLineageId) ?? null;

  return (
  <div>
    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
      <Bookmark size={12} /> Presets
    </h3>
    {isPublicLibrary ? (
      <div className="mb-3 rounded border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
        Public build: bundled presets are read-only. Update <code className="font-mono normal-case">public-library.json</code> from your private workspace and redeploy.
      </div>
    ) : (
      <div className="grid grid-cols-[1fr_auto] gap-2 mb-3">
        <input
          type="text"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleCreatePreset();
            }
          }}
          placeholder="New preset name"
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs tracking-wide outline-none focus:border-white/40"
        />
        <button
          onClick={handleCreatePreset}
          disabled={!presetName.trim()}
          className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Save New
        </button>
      </div>
    )}
    {!isPublicLibrary && activePresetId && (
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => onOverwritePreset(activePresetId)}
          className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-wider border border-white/20 rounded bg-white/5 hover:bg-white/10 transition-colors"
        >
          <Save size={14} />
          Overwrite
        </button>
        <button
          onClick={isPresetTransitioning ? onStopPresetTransition : undefined}
          disabled={!isPresetTransitioning}
          className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-wider border border-white/20 rounded bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Pause size={14} />
          Stop Morph
        </button>
      </div>
    )}
    <Slider
      label="Preset Morph Seconds"
      value={presetBlendDuration}
      min={0.2}
      max={8}
      step={0.1}
      onChange={onPresetBlendDurationChange}
    />
    <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Transition Shape （遷移の形状・Phase AW）</div>
    <select
      value={config.presetTransitionShape}
      onChange={(e) => updateConfig('presetTransitionShape', e.target.value as typeof config.presetTransitionShape)}
      className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
    >
      <option value="crossfade">Crossfade (全キーが一様に遷移＝従来)</option>
      <option value="wipe">Wipe (レイヤー→粒子→ポストの順)</option>
      <option value="dissolve">Dissolve (キーがばらばらに遷移)</option>
      <option value="circle">Circle (中心＝粒子→周囲→フレームの順)</option>
    </select>
    <div className="mt-1 text-[9px] leading-relaxed text-white/40">
      遷移先プリセットの Shape がモーフの進み方を決めます。パラメータの遷移順の文法で、画面のピクセルを拭う演出ではありません。
    </div>
    {!isPublicLibrary && (
      <ControlPanelPresetLibraryIO
        handleLibraryFileChange={handleLibraryFileChange}
        libraryImportMode={libraryImportMode}
        libraryInputRef={libraryInputRef}
        libraryNotice={libraryNotice}
        onDismissLibraryNotice={onDismissLibraryNotice}
        onExportLibrary={onExportLibrary}
        setLibraryImportMode={setLibraryImportMode}
        presets={presets}
        onSyncApplyPresets={onSyncApplyPresets}
        onSyncNotice={onSyncNotice}
      />
    )}
    {isPublicLibrary && <NoticeBanner notice={libraryNotice} onDismiss={onDismissLibraryNotice} className="mt-4" />}
    {!isPublicLibrary && onApplyConfig && (
      <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/70">
          Reuse Units （再利用単位）
        </div>
        <p className="mb-3 text-[10px] leading-relaxed text-white/40">
          現在の設定の一部（選んだグループの項目だけ）を名前付きの「再利用単位」として切り出し、後から今の設定へ重ねて適用できます。部分適用の固定グループを、名前を付けて保存できる形に一般化したものです。単位の定義はこのブラウザに保存され、プリセット記録や設定キーには混ざりません。
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
          <input
            type="text"
            value={reuseUnitName}
            onChange={(event) => setReuseUnitName(event.target.value)}
            placeholder="再利用単位の名前"
            className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-xs outline-none focus:border-white/35"
          />
          <button
            onClick={handleCreateReuseUnit}
            disabled={reuseGroups.size === 0}
            className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
          >
            現在の設定から作成
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {PARTIAL_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => toggleReuseGroup(group.id)}
              title={group.description}
              className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
                reuseGroups.has(group.id)
                  ? 'border-transparent bg-white text-black'
                  : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
        {reuseUnits.length > 0 ? (
          <div className="flex flex-col gap-1">
            {reuseUnits.map((unit) => (
              <div key={unit.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 px-2 py-1.5">
                <span className="text-[11px] text-white/85">{unit.name}</span>
                <span className="text-[10px] text-white/40">
                  {unit.keys.length} 項目 · {new Date(unit.createdAt).toLocaleDateString()}
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => handleApplyReuseUnit(unit)}
                  className="px-3 py-1 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
                >
                  適用
                </button>
                <button
                  onClick={() => handleDeleteReuseUnit(unit)}
                  className="px-3 py-1 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-white/35">保存済みの再利用単位はまだありません。</p>
        )}
        {reuseNote && <p className="mt-2 text-[11px] text-white/55">{reuseNote}</p>}
      </div>
    )}
    <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">
        Browse Library
      </div>
      <input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search presets, motions, or categories"
        className="mb-3 w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-xs outline-none focus:border-white/35"
      />
      <div className="flex flex-wrap gap-2">
        {PRESET_CATEGORY_OPTIONS.map((category) => (
          <button
            key={category}
            onClick={() => setCategoryFilter(category)}
            className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
              categoryFilter === category
                ? 'border-transparent bg-white text-black'
                : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
            }`}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 text-[9px] uppercase tracking-widest text-white/40">
          Hierarchy （系統 &gt; 家族・階層で絞る）
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setHierarchyLineageId(null); setHierarchyFamilyId(null); }}
            className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
              hierarchyLineageId === null
                ? 'border-transparent bg-white text-black'
                : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
            }`}
          >
            All
          </button>
          {PRESET_HIERARCHY.lineages.map((lineage) => (
            <button
              key={lineage.id}
              onClick={() => { setHierarchyLineageId(lineage.id); setHierarchyFamilyId(null); }}
              className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
                hierarchyLineageId === lineage.id
                  ? 'border-transparent bg-white text-black'
                  : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
              }`}
            >
              {lineage.label} ({hierarchyCounts.byLineage.get(lineage.id) ?? 0})
            </button>
          ))}
        </div>
        {activeLineage && (
          <div className="mt-2 flex flex-wrap gap-2 pl-3">
            <button
              onClick={() => setHierarchyFamilyId(null)}
              className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
                hierarchyFamilyId === null
                  ? 'border-transparent bg-white text-black'
                  : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
              }`}
            >
              All Families
            </button>
            {activeLineage.families.map((family) => (
              <button
                key={family.id}
                onClick={() => setHierarchyFamilyId(family.id)}
                className={`px-2 py-1 text-[9px] uppercase tracking-widest rounded border transition-colors ${
                  hierarchyFamilyId === family.id
                    ? 'border-transparent bg-white text-black'
                    : 'border-white/15 bg-transparent text-white/55 hover:border-white/35 hover:text-white/80'
                }`}
              >
                {family.label} ({hierarchyCounts.byFamily.get(family.id) ?? 0})
              </button>
            ))}
          </div>
        )}
        {hierarchyLineageId === 'designer-templates' && (
          <div className="mt-2 text-[10px] leading-relaxed text-white/40">
            雛形（template）は完成形プリセットではなく Designer ブロック構成の保存物です。一覧は Play タブの Designer セクションにあります。
          </div>
        )}
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-widest text-white/40">
        Showing {visiblePresets.length} of {presets.length}
      </div>
    </div>
    <div className="space-y-2 max-h-72 overflow-y-auto pr-1 mt-4">
      {visiblePresets.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded p-3 text-[10px] uppercase tracking-widest text-white/35">
          {presets.length === 0
            ? (isPublicLibrary ? 'No bundled public presets yet.' : 'No saved presets yet.')
            : 'No presets match the current search/filter.'}
        </div>
      ) : visiblePresets.map((preset) => (
        <ControlPanelPresetCard
          key={preset.id}
          activePresetId={activePresetId}
          categories={getPresetCategories(preset)}
          editingPresetId={editingPresetId}
          editingPresetName={editingPresetName}
          formatPresetDate={formatPresetDate}
          handleStartRename={handleStartRename}
          handleSubmitRename={handleSubmitRename}
          isPresetDirty={isPresetDirty}
          isPublicLibrary={isPublicLibrary}
          onAddPresetToSequence={onAddPresetToSequence}
          onDeletePreset={onDeletePreset}
          onDuplicatePreset={onDuplicatePreset}
          onLoadPreset={onLoadPreset}
          onTransitionToPreset={onTransitionToPreset}
          performanceTier={getPresetPerformanceTier(preset)}
          preset={preset}
          setEditingPresetId={setEditingPresetId}
          setEditingPresetName={setEditingPresetName}
        />
      ))}
    </div>
  </div>
  );
};
