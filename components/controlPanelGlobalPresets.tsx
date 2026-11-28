import React from 'react';
import { Bookmark, Pause, Save } from 'lucide-react';
import { PRESET_CATEGORY_OPTIONS, getPresetCategories, getPresetPerformanceTier, getPresetSearchText } from '../lib/presetCatalog';
import { PRESET_HIERARCHY, filterPresetsByHierarchy, getPresetHierarchyPlacement } from '../lib/presetHierarchy';
import { Slider } from './controlPanelParts';
import { ControlPanelPresetCard } from './controlPanelPresetCard';
import { ControlPanelPresetLibraryIO } from './controlPanelPresetLibraryIO';
import { ControlPanelContentProps, NoticeBanner } from './controlPanelTabsShared';

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
