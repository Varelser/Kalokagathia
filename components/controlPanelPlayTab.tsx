import React from 'react';
import { Activity, ArrowLeftRight, Compass, Database, Dna, FileDown, Gamepad2, Grid3x3, History, Keyboard, Library, LocateFixed, Minus, Monitor, Network, Piano, Plus, Radio, Search, Sparkles, Video } from 'lucide-react';
import type { Layer2Type, MotionDagNode, MotionGraphStep, ParticleConfig, PresetRecord } from '../types';
import {
  TARGET_COMPUTE_BACKENDS,
  TARGET_MOTION_FAMILIES,
  TARGET_POST_FAMILIES,
  TARGET_RENDER_FAMILIES,
  TARGET_SOLVER_FAMILIES,
  TARGET_SOURCE_FAMILIES,
  getCoverageProfile,
} from '../lib/depictionCoverage';
import { MACRO_DEFINITIONS, getMacroUpdates } from '../lib/macroControls';
import { MOTION_GROUPS } from '../lib/motionGrouping';
import { isDedicatedSystemMotionType, isPlacementMotionType } from '../lib/motionChain';
import { generateOffspring, type BredChild } from '../lib/presetBreeding';
import { sampleCanvasMetrics, scoreChild, type ScreenMetrics } from '../lib/evolutionLab';
import { PartialApplySection } from './controlPanelPartialApply';
import { PARAMETER_CATALOG, searchParameters, type ParameterCatalogEntry } from '../lib/parameterCatalog';
import {
  buildDataLumaMap,
  buildSampleDataPoints,
  getDataSourceUpdates,
  parseDataPoints,
  type ParsedData,
} from '../lib/dataSource';
import {
  describeMidiTarget,
  loadMidiAssignments,
  resolveAssignment,
  saveMidiAssignments,
  scaleCcValue,
  type MidiAssignment,
  type MidiTarget,
} from '../lib/midiControl';
import {
  DEFAULT_OSC_BRIDGE_URL,
  describeOscTarget,
  isValidOscAddress,
  loadOscAssignments,
  oscValueToRatio,
  resolveOscAssignment,
  saveOscAssignments,
  scaleOscValue,
  type OscAssignment,
  type OscTarget,
} from '../lib/oscControl';
import {
  DEFAULT_GRAPH_LAYOUT,
  GRAPH_CONNECTION_OPTIONS,
  GRAPH_EDGES,
  GRAPH_EMIT_SHAPE_OPTIONS,
  GRAPH_NODE_WIDTH,
  GRAPH_SOURCE_OPTIONS,
  GRAPH_SPRITE_OPTIONS,
  loadGraphLayout,
  saveGraphLayout,
  type GraphNodeId,
  type GraphOption,
} from '../lib/graphModel';
import {
  AUDIO_BAND_OPTIONS,
  LFO_WAVEFORM_OPTIONS,
  createStarterModulationRoutes,
  describeModulationSource,
  evaluateLfo,
  setModulationSetup,
  useModulationSetup,
  type LfoWaveform,
  type ModulationRoute,
  type ModulationSetup,
  type ModulationSource,
} from '../lib/modulation';
import { buildPresetVector, cosineSimilarity, projectPresetsTo2D } from '../lib/presetSimilarity';
import { MAX_DETERMINISTIC_FRAMES, renderDeterministicSequence, renderDeterministicVideo } from '../lib/deterministicRender';
import { VideoEncodeUnsupportedError, type VideoFormat } from '../lib/videoEncode';
import { closeCleanOutput, isCleanOutputOpen, openCleanOutput } from '../lib/cleanOutput';
import { collectGpuDiagnostics, type GpuDiagnosticsReport } from '../lib/gpuDiagnostics';
import {
  GPU_TIER_LABELS_JA,
  redetectGpuTier,
  setGpuTierOverride,
  type GpuTier,
} from '../lib/gpuTier';
import { useGpuTierInfo } from '../lib/useGpuTierInfo';
import { getRaymarchDefaults } from '../lib/raymarchDefaults';
import { getMaxGpgpuTexSize } from './useGpgpuRuntime';
import { generatePromptDrafts, type PromptDraft } from '../lib/promptPreset';
import {
  COVERAGE_BATCH_LIMIT,
  COVERAGE_MOTIONS,
  COVERAGE_SOURCES,
  generateCoverageCandidates,
  getCoveredSourceMotionPairs,
  listUncoveredPairs,
} from '../lib/coverageCompletion';
import { applyTransitionEasing, interpolateConfig } from '../lib/appState';
import {
  buildPlyPointCloud,
  countExportablePoints,
  type PointCloudCaptureState,
} from '../lib/pointCloudExport';
import { TEXTURE_DEFINITIONS, TEXTURE_MAP_SIZE, getTextureDefinition } from '../lib/texturePack';
import { buildSvgPointCloud, type SvgPlane } from '../lib/svgExport';
import {
  PerformanceRecorder,
  deleteTakeFrame,
  frameIndexAt,
  parseTake,
  reconstructAt,
  reconstructInterpolatedAt,
  serializeTake,
  shiftTakeFrame,
  type PerformanceTake,
} from '../lib/performanceRecorder';
import {
  effectivePosition,
  offsetFromEffective,
  padToWorld,
  withPosition,
  worldToPad,
} from '../lib/sourceEditor';
import {
  PRESET_CATEGORY_OPTIONS,
  getPresetCategories,
  getPresetPerformanceTier,
  getPresetSearchText,
} from '../lib/presetCatalog';
import {
  deriveGeneratedSeries,
  generatedSeriesLabel,
  loadGeneratedCollectionIndex,
  probeGeneratedCollectionAvailable,
  type GeneratedPresetEntry,
} from '../lib/generatedCollection';
import { getPresetTagCounts, getPresetTags } from '../lib/presetTags';
import { PlayDagSection } from './controlPanelDagEditor';
import { Slider } from './controlPanelParts';
import type { ControlPanelContentProps } from './controlPanelTabsShared';

/**
 * Play tab (roadmap Phase 6A / 6C / 7A).
 *
 * The entrance to the panel: pick a preset from a simple shelf, bend it
 * with perceptual macro knobs, and see which regions of the expression
 * space the whole library has not covered yet. Everything here is
 * additive — the detailed tabs are untouched, and macros only write
 * ordinary config fields through updateConfig.
 */

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
    {icon} {children}
  </h3>
);

const PIN_STORAGE_KEY = 'kalokagathia.pins.v1';
const loadPins = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// Genre fold state for the shelf rides in the deck's shared fold map
// (kalokagathia.folds.v1 — the same JSON the detail-sheet sections use in
// controlPanelTabs.tsx) under `shelf|genre|<Genre>` keys, so shelf folds
// live alongside, and can never collide with, the sheet's `tab|heading`
// keys. Values are booleans: true = genre section open. Only explicit
// user choices are stored; an absent key means "use the default" (the
// active preset's primary genre open, everything else closed).
const SHELF_GENRE_FOLD_PREFIX = 'shelf|genre|';
// Generated-collection folds share the same map under their own
// namespace (`shelf|generated|<seriesKey>`, plus `__group` for the
// group itself), so they can never collide with genre or sheet keys.
const SHELF_GENERATED_FOLD_PREFIX = 'shelf|generated|';
const SHELF_FOLD_STORAGE_KEY = 'kalokagathia.folds.v1';

const readShelfFoldMap = (prefix: string): Record<string, boolean> => {
  try {
    const all = JSON.parse(localStorage.getItem(SHELF_FOLD_STORAGE_KEY) || '{}') as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    Object.entries(all).forEach(([key, value]) => {
      if (key.startsWith(prefix) && typeof value === 'boolean') {
        out[key.slice(prefix.length)] = value;
      }
    });
    return out;
  } catch {
    return {};
  }
};

const writeShelfFold = (prefix: string, key: string, open: boolean) => {
  try {
    const all = JSON.parse(localStorage.getItem(SHELF_FOLD_STORAGE_KEY) || '{}') as Record<string, unknown>;
    all[prefix + key] = open;
    localStorage.setItem(SHELF_FOLD_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
};

const loadShelfGenreFolds = (): Record<string, boolean> => readShelfFoldMap(SHELF_GENRE_FOLD_PREFIX);

const saveShelfGenreFold = (genre: string, open: boolean) => writeShelfFold(SHELF_GENRE_FOLD_PREFIX, genre, open);

const loadShelfGeneratedFolds = (): Record<string, boolean> => readShelfFoldMap(SHELF_GENERATED_FOLD_PREFIX);

const saveShelfGeneratedFold = (key: string, open: boolean) => writeShelfFold(SHELF_GENERATED_FOLD_PREFIX, key, open);

export const PresetShelf: React.FC<{
  presets: PresetRecord[];
  activePresetId: string | null;
  onLoadPreset: (presetId: string) => void;
  /** Load a GENERATED-collection preset by id (share-link fetch path).
   *  Resolves false when the record cannot be fetched. */
  onLoadGeneratedPreset?: (presetId: string) => Promise<boolean>;
  /** Four-edge layout: render without the section title when the shelf
   * lives in the right-edge panel, which carries its own header. */
  bare?: boolean;
}> = ({ presets, activePresetId, onLoadPreset, onLoadGeneratedPreset, bare = false }) => {
  const [pins, setPins] = React.useState<string[]>(loadPins);
  const togglePin = (id: string) => {
    setPins((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  const pinnedPresets = presets.filter((preset) => pins.includes(preset.id));
  const [searchQuery, setSearchQuery] = React.useState('');
  // The category chips are a genre jump, not a filter: `jumpGenre` only
  // remembers which chip was last used for the highlight.
  const [jumpGenre, setJumpGenre] = React.useState<string | null>(null);
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);

  const tagCounts = React.useMemo(
    () => getPresetTagCounts(presets).filter((entry) => entry.count >= 3).slice(0, 10),
    [presets],
  );

  // Categories per preset, computed once per library change.
  const categoriesById = React.useMemo(() => {
    const map = new Map<string, string[]>();
    presets.forEach((preset) => map.set(preset.id, getPresetCategories(preset)));
    return map;
  }, [presets]);

  // Genre sections are derived from the data: every category at least
  // one preset belongs to, in the existing category ordering. Genres are
  // non-exclusive (a preset is filed under each genre it belongs to —
  // the same membership semantics the category chips always used), so a
  // preset can appear in several sections.
  const genres = React.useMemo(() => {
    const present = new Set<string>();
    categoriesById.forEach((cats) => cats.forEach((category) => present.add(category)));
    const ordered = PRESET_CATEGORY_OPTIONS.filter(
      (category) => category !== 'All' && present.has(category),
    ) as string[];
    present.forEach((category) => {
      if (!ordered.includes(category)) ordered.push(category);
    });
    return ordered;
  }, [categoriesById]);

  const membersByGenre = React.useMemo(() => {
    const map = new Map<string, PresetRecord[]>();
    genres.forEach((genre) => {
      map.set(genre, presets.filter((preset) => (categoriesById.get(preset.id) ?? []).includes(genre)));
    });
    return map;
  }, [genres, presets, categoriesById]);

  const activePreset = React.useMemo(
    () => presets.find((preset) => preset.id === activePresetId) ?? null,
    [presets, activePresetId],
  );
  const activeGenres = React.useMemo(
    () => (activePreset ? categoriesById.get(activePreset.id) ?? [] : []),
    [activePreset, categoriesById],
  );
  const activePrimaryGenre = activeGenres[0] ?? null;

  // --- genre folds -----------------------------------------------------
  const [genreFolds, setGenreFolds] = React.useState<Record<string, boolean>>(loadShelfGenreFolds);
  const setGenreOpen = React.useCallback((genre: string, open: boolean) => {
    setGenreFolds((prev) => (prev[genre] === open ? prev : { ...prev, [genre]: open }));
    saveShelfGenreFold(genre, open);
  }, []);
  const setAllGenresOpen = React.useCallback(
    (open: boolean) => {
      genres.forEach((genre) => saveShelfGenreFold(genre, open));
      setGenreFolds((prev) => {
        const next = { ...prev };
        genres.forEach((genre) => {
          next[genre] = open;
        });
        return next;
      });
    },
    [genres],
  );

  // Findability: whenever the active preset changes (card click, [ ]
  // keys, shuffle, share link…), make sure its primary genre section is
  // open, so the active card is visible when the shelf is looked at.
  // Uses the render-phase adjustment pattern: remember which preset was
  // last handled and adjust the fold state while rendering when it
  // changes (a manual close afterwards is left alone until the active
  // preset changes again).
  const [autoOpenedFor, setAutoOpenedFor] = React.useState<string | null>(null);
  if (activePresetId !== autoOpenedFor) {
    setAutoOpenedFor(activePresetId);
    if (activePrimaryGenre && genreFolds[activePrimaryGenre] !== true) {
      setGenreFolds((prev) => ({ ...prev, [activePrimaryGenre]: true }));
      saveShelfGenreFold(activePrimaryGenre, true);
    }
  }

  // --- filtering (search / tags): grouped view, folds overridden -------
  const query = searchQuery.trim().toLowerCase();
  const filtering = query.length > 0 || tagFilter !== null;
  const matchesFilters = React.useCallback(
    (preset: PresetRecord) => {
      const tags = getPresetTags(preset);
      const matchesQuery =
        query.length === 0 ||
        getPresetSearchText(preset).includes(query) ||
        tags.some((tag) => tag.toLowerCase().includes(query));
      const matchesTag = tagFilter === null || tags.includes(tagFilter);
      return matchesQuery && matchesTag;
    },
    [query, tagFilter],
  );

  const visibleSections = React.useMemo(
    () =>
      genres
        .map((genre) => {
          const members = membersByGenre.get(genre) ?? [];
          const shown = filtering ? members.filter(matchesFilters) : members;
          return { genre, members, shown };
        })
        .filter((section) => !filtering || section.shown.length > 0),
    [genres, membersByGenre, filtering, matchesFilters],
  );

  // --- generated collection (the 746 static presets) --------------------
  // A separate shelf group below the bundled library. The compact index
  // is fetched lazily — the first time the group is opened or a search
  // is typed — and cached for the session by lib/generatedCollection.
  // Grouping is by series (the generated records carry no genre/tag
  // fields). Applying a card reuses the share-link resolution path via
  // onLoadGeneratedPreset.
  const [genFolds, setGenFolds] = React.useState<Record<string, boolean>>(loadShelfGeneratedFolds);
  const genGroupOpen = genFolds.__group ?? false;
  const setGenGroupOpen = React.useCallback((open: boolean) => {
    setGenFolds((prev) => (prev.__group === open ? prev : { ...prev, __group: open }));
    saveShelfGeneratedFold('__group', open);
  }, []);
  const setGenSeriesOpen = React.useCallback((seriesKey: string, open: boolean) => {
    setGenFolds((prev) => (prev[seriesKey] === open ? prev : { ...prev, [seriesKey]: open }));
    saveShelfGeneratedFold(seriesKey, open);
  }, []);
  const [genEntries, setGenEntries] = React.useState<GeneratedPresetEntry[] | null>(null);
  const [genStatus, setGenStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error' | 'unavailable'>('idle');
  const genLoadStartedRef = React.useRef(false);
  const [genApplyNote, setGenApplyNote] = React.useState('');

  const wantGenIndex = genGroupOpen || query.length > 0;
  React.useEffect(() => {
    if (!wantGenIndex || genLoadStartedRef.current) return;
    genLoadStartedRef.current = true;
    setGenStatus('loading');
    loadGeneratedCollectionIndex()
      .then(async (entries) => {
        if (!entries || entries.length === 0) {
          setGenStatus('error');
          return;
        }
        setGenEntries(entries);
        const available = await probeGeneratedCollectionAvailable(entries[0].id);
        setGenStatus(available ? 'ready' : 'unavailable');
      })
      .catch(() => setGenStatus('error'));
  }, [wantGenIndex]);

  const genSeries = React.useMemo(
    () => (genEntries ? deriveGeneratedSeries(genEntries) : []),
    [genEntries],
  );
  const genMembersBySeries = React.useMemo(() => {
    const map = new Map<string, GeneratedPresetEntry[]>();
    genSeries.forEach(({ key }) => map.set(key, []));
    (genEntries ?? []).forEach((entry) => {
      const list = map.get(entry.series);
      if (list) list.push(entry);
      else map.set(entry.series, [entry]);
    });
    return map;
  }, [genEntries, genSeries]);

  // Generated entries carry no tag metadata, so a tag filter excludes
  // them; text search matches name / id / series label.
  const genMatches = React.useMemo(() => {
    if (!genEntries) return [];
    if (tagFilter !== null) return [];
    if (query.length === 0) return genEntries;
    return genEntries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query)
        || entry.id.toLowerCase().includes(query)
        || generatedSeriesLabel(entry.series).toLowerCase().includes(query),
    );
  }, [genEntries, query, tagFilter]);

  const genVisibleSections = React.useMemo(
    () =>
      genSeries
        .map(({ key, label }) => {
          const members = genMembersBySeries.get(key) ?? [];
          const shown = filtering ? genMatches.filter((entry) => entry.series === key) : members;
          return { key, label, members, shown };
        })
        .filter((section) => !filtering || section.shown.length > 0),
    [genSeries, genMembersBySeries, genMatches, filtering],
  );

  const genActiveEntry = React.useMemo(
    () => (genEntries && activePresetId ? genEntries.find((entry) => entry.id === activePresetId) ?? null : null),
    [genEntries, activePresetId],
  );

  // Findability, mirroring the starter genres: when the active preset is
  // a generated one, keep its series section open.
  const [genAutoOpenedFor, setGenAutoOpenedFor] = React.useState<string | null>(null);
  if (genActiveEntry && genActiveEntry.id !== genAutoOpenedFor) {
    setGenAutoOpenedFor(genActiveEntry.id);
    if (genFolds[genActiveEntry.series] !== true) {
      setGenFolds((prev) => ({ ...prev, [genActiveEntry.series]: true }));
      saveShelfGeneratedFold(genActiveEntry.series, true);
    }
  }

  const handleGeneratedCard = (entry: GeneratedPresetEntry) => {
    if (!onLoadGeneratedPreset) return;
    setGenApplyNote('');
    void onLoadGeneratedPreset(entry.id).then((ok) => {
      if (!ok) setGenApplyNote('プリセットを取得できませんでした');
    });
  };

  const setAllGenSeriesOpen = (open: boolean) => {
    genSeries.forEach(({ key }) => saveShelfGeneratedFold(key, open));
    setGenFolds((prev) => {
      const next = { ...prev };
      genSeries.forEach(({ key }) => {
        next[key] = open;
      });
      return next;
    });
  };

  const showGeneratedGroup =
    !filtering || genMatches.length > 0 || genStatus === 'error' || genStatus === 'unavailable';

  const renderGeneratedCard = (entry: GeneratedPresetEntry) => {
    const isActive = entry.id === activePresetId;
    return (
      <button
        key={entry.id}
        type="button"
        data-generated-card={entry.id}
        data-testid={`generated-card-${entry.id}`}
        onClick={() => handleGeneratedCard(entry)}
        className={`h-full w-full text-left rounded-xl border p-3 transition-colors ${
          isActive ? 'border-white/40 bg-white/12' : 'border-white/10 bg-white/5 hover:bg-white/10'
        }`}
      >
        <img
          src={`/catalog/thumbs/${entry.id}.jpg`}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
          className="mb-2 h-20 w-full rounded-lg border border-white/10 object-cover"
        />
        <div className="text-xs font-semibold tracking-wide leading-snug">{entry.name}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="px-1.5 py-0.5 rounded bg-white/8 border border-white/10 text-[9px] uppercase tracking-wider text-white/55">
            {generatedSeriesLabel(entry.series)}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-white/8 border border-white/10 text-[9px] uppercase tracking-wider text-white/40">
            Generated
          </span>
        </div>
      </button>
    );
  };

  // --- genre chip jump ---------------------------------------------------
  const sectionRefs = React.useRef(new Map<string, HTMLDivElement>());
  const handleChip = (category: (typeof PRESET_CATEGORY_OPTIONS)[number]) => {
    if (category === 'All') {
      setJumpGenre(null);
      return;
    }
    setJumpGenre(category);
    setGenreOpen(category, true);
    // Scroll after the fold-open render has landed (two frames is
    // enough for the grid to expand); the section wrapper itself is
    // always mounted in browse mode, so this also works from closed.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sectionRefs.current.get(category)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  const renderCard = (preset: PresetRecord) => {
    const isActive = preset.id === activePresetId;
    const tier = getPresetPerformanceTier(preset);
    const isPinned = pins.includes(preset.id);
    return (
      <div key={preset.id} className="relative">
        <button
          onClick={() => onLoadPreset(preset.id)}
          className={`h-full w-full text-left rounded-xl border p-3 transition-colors ${
            isActive ? 'border-white/40 bg-white/12' : 'border-white/10 bg-white/5 hover:bg-white/10'
          }`}
        >
          <img
            src={`/catalog/thumbs/${preset.id}.jpg`}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            className="mb-2 h-20 w-full rounded-lg border border-white/10 object-cover"
          />
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide leading-snug">{preset.name}</span>
            <span
              className={`shrink-0 mt-0.5 h-2 w-2 rounded-full ${
                tier === 'heavy' ? 'bg-red-300/80' : tier === 'medium' ? 'bg-amber-200/80' : 'bg-emerald-200/80'
              }`}
              title={`Performance: ${tier}`}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {getPresetCategories(preset)
              .slice(0, 3)
              .map((category) => (
                <span
                  key={category}
                  className="px-1.5 py-0.5 rounded bg-white/8 border border-white/10 text-[9px] uppercase tracking-wider text-white/55"
                >
                  {category}
                </span>
              ))}
          </div>
          <div className="mt-2 text-[9px] uppercase tracking-widest text-white/35">
            {preset.config.layer2Type} / {preset.config.layer3Type}
          </div>
          {getPresetTags(preset).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
              {getPresetTags(preset).map((tag) => (
                <span key={tag} className="text-[9px] tracking-wide text-white/50">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </button>
        <button
          type="button"
          aria-label={isPinned ? 'ピン留めを外す' : 'ピン留め'}
          title={isPinned ? 'ピン留めを外す' : 'ピン留め'}
          onClick={() => togglePin(preset.id)}
          className={`absolute bottom-2 right-2 z-10 rounded-full px-1 text-sm leading-none transition-colors ${
            isPinned ? 'text-amber-300' : 'text-white/30 hover:text-amber-200'
          }`}
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    );
  };

  return (
    <section>
      {!bare && <SectionTitle icon={<Library size={12} />}>Preset Shelf · プリセット棚</SectionTitle>}
      {pinnedPresets.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[9px] uppercase tracking-widest text-amber-200/70">★ ピン留め</div>
          <div className="flex flex-wrap gap-1.5">
            {pinnedPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onLoadPreset(preset.id)}
                className={`rounded-full border px-2.5 py-1 text-[10px] tracking-wide transition-colors ${
                  preset.id === activePresetId
                    ? 'border-amber-200/70 bg-amber-200/15 text-amber-100'
                    : 'border-white/15 text-white/70 hover:border-amber-200/40 hover:text-white'
                }`}
              >
                ★ {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search presets, motions, or categories"
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs tracking-wide outline-none focus:border-white/40 mb-3"
      />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PRESET_CATEGORY_OPTIONS.map((category) => {
          const isJumped = category === 'All' ? jumpGenre === null : jumpGenre === category;
          return (
            <button
              key={category}
              data-testid={`shelf-chip-${category.toLowerCase()}`}
              onClick={() => handleChip(category)}
              className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider border transition-colors ${
                isJumped
                  ? 'bg-white text-black border-white'
                  : 'border-white/15 text-white/55 hover:border-white/35 hover:text-white'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
      {tagCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[9px] uppercase tracking-widest text-white/35 mr-1">Tags</span>
          {tagCounts.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setTagFilter((current) => (current === tag ? null : tag))}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                tagFilter === tag
                  ? 'bg-white/85 text-black border-white/85'
                  : 'border-white/15 text-white/50 hover:border-white/35 hover:text-white'
              }`}
            >
              #{tag} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          data-testid="shelf-genres-open-all"
          onClick={() => setAllGenresOpen(true)}
          className="text-[11px] tracking-wider text-white/50 transition-colors hover:text-white"
        >
          すべて開く
        </button>
        <button
          type="button"
          data-testid="shelf-genres-close-all"
          onClick={() => setAllGenresOpen(false)}
          className="text-[11px] tracking-wider text-white/50 transition-colors hover:text-white"
        >
          すべて閉じる
        </button>
        <span className="ml-auto text-[10px] tracking-wider text-white/35">
          {presets.length} presets · {genres.length} genres
        </span>
      </div>
      {visibleSections.length === 0 && genMatches.length === 0 ? (
        <p className="text-[11px] text-white/40">No presets match this filter.</p>
      ) : (
        visibleSections.map(({ genre, shown }) => {
          const open = filtering ? true : (genreFolds[genre] ?? genre === activePrimaryGenre);
          const containsActive = activePreset !== null && activeGenres.includes(genre);
          return (
            <div
              key={genre}
              ref={(el) => {
                if (el) sectionRefs.current.set(genre, el);
                else sectionRefs.current.delete(genre);
              }}
              data-testid={`shelf-genre-${genre.toLowerCase()}`}
              className="mb-3 scroll-mt-2"
            >
              <button
                type="button"
                data-testid={`shelf-genre-toggle-${genre.toLowerCase()}`}
                aria-expanded={open}
                onClick={() => setGenreOpen(genre, !open)}
                className="relative flex w-full items-center gap-2 rounded-lg bg-black/35 py-[9px] pl-3 pr-11 text-left transition-colors hover:bg-black/55"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">{genre}</span>
                <span className="shrink-0 text-[10px] tracking-wider text-white/40">{shown.length}</span>
                {containsActive && !open && activePreset && (
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] tracking-wide text-emerald-200/80">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                    <span className="truncate">{activePreset.name}</span>
                  </span>
                )}
                <span className="absolute right-[5px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition-colors">
                  {open ? <Minus size={15} /> : <Plus size={15} />}
                </span>
              </button>
              {open && <div className="mt-2 grid grid-cols-2 gap-2">{shown.map((preset) => renderCard(preset))}</div>}
            </div>
          );
        })
      )}
      {showGeneratedGroup && (
        <div data-testid="shelf-generated-group" className="mt-6 border-t border-white/10 pt-4">
          <button
            type="button"
            data-testid="shelf-generated-toggle"
            aria-expanded={genGroupOpen || (filtering && genMatches.length > 0)}
            onClick={() => setGenGroupOpen(!genGroupOpen)}
            className="relative flex w-full flex-wrap items-center gap-2 rounded-lg bg-black/35 py-[9px] pl-3 pr-11 text-left transition-colors hover:bg-black/55"
          >
            <Sparkles size={13} className="shrink-0 text-white/50" />
            <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.12em] text-white/70">生成コレクション · Generated</span>
            {genStatus === 'ready' && genEntries && (
              <span className="shrink-0 whitespace-nowrap text-[10px] tracking-wider text-white/40">
                {genEntries.length} presets · {genSeries.length} series
              </span>
            )}
            {genActiveEntry && !genGroupOpen && (
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] tracking-wide text-emerald-200/80">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                <span className="truncate">{genActiveEntry.name}</span>
              </span>
            )}
            <span className="absolute right-[5px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition-colors">
              {genGroupOpen || (filtering && genMatches.length > 0) ? <Minus size={15} /> : <Plus size={15} />}
            </span>
          </button>
          {(genGroupOpen || (filtering && genMatches.length > 0)) && (
            <div className="mt-3">
              {(genStatus === 'idle' || genStatus === 'loading') && (
                <p className="text-[11px] text-white/40">読み込み中…</p>
              )}
              {genStatus === 'error' && (
                <p className="text-[11px] text-white/40">生成コレクションを読み込めませんでした</p>
              )}
              {genStatus === 'unavailable' && (
                <p className="text-[11px] text-white/40">この環境では生成コレクションを利用できません（プリセットデータに接続できません）</p>
              )}
              {genStatus === 'ready' && (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <button
                      type="button"
                      data-testid="shelf-generated-open-all"
                      onClick={() => setAllGenSeriesOpen(true)}
                      className="text-[11px] tracking-wider text-white/50 transition-colors hover:text-white"
                    >
                      すべて開く
                    </button>
                    <button
                      type="button"
                      data-testid="shelf-generated-close-all"
                      onClick={() => setAllGenSeriesOpen(false)}
                      className="text-[11px] tracking-wider text-white/50 transition-colors hover:text-white"
                    >
                      すべて閉じる
                    </button>
                  </div>
                  {genApplyNote && <p className="mb-3 text-[11px] text-amber-200/80">{genApplyNote}</p>}
                  {genVisibleSections.length === 0 ? (
                    <p className="text-[11px] text-white/40">No generated presets match this filter.</p>
                  ) : (
                    genVisibleSections.map(({ key, label, shown }) => {
                      const open = filtering ? true : (genFolds[key] ?? false);
                      const containsActive = genActiveEntry !== null && genActiveEntry.series === key;
                      return (
                        <div key={key} data-testid={`shelf-generated-${key}`} className="mb-3 scroll-mt-2">
                          <button
                            type="button"
                            data-testid={`shelf-generated-toggle-${key}`}
                            aria-expanded={open}
                            onClick={() => setGenSeriesOpen(key, !open)}
                            className="relative flex w-full items-center gap-2 rounded-lg bg-black/35 py-[9px] pl-3 pr-11 text-left transition-colors hover:bg-black/55"
                          >
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">{label}</span>
                            <span className="shrink-0 text-[10px] tracking-wider text-white/40">{shown.length}</span>
                            {containsActive && !open && genActiveEntry && (
                              <span className="flex min-w-0 items-center gap-1.5 text-[10px] tracking-wide text-emerald-200/80">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                                <span className="truncate">{genActiveEntry.name}</span>
                              </span>
                            )}
                            <span className="absolute right-[5px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition-colors">
                              {open ? <Minus size={15} /> : <Plus size={15} />}
                            </span>
                          </button>
                          {open && <div className="mt-2 grid grid-cols-2 gap-2">{shown.map((entry) => renderGeneratedCard(entry))}</div>}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

type CoverageAxis = {
  label: string;
  gloss: string;
  covered: string[];
  targets: readonly string[];
  note?: string;
};

const SourceMotionCombos: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  allMotionTypeCount: number;
}> = ({ config, presets, allMotionTypeCount }) => {
  const data = React.useMemo(() => {
    const sourceFrequency = new Map<string, number>();
    const pairs = new Set<string>();
    const absorb = (cfg: ParticleConfig) => {
      const layers = [
        { enabled: cfg.layer2Enabled, source: cfg.layer2Source as string, type: cfg.layer2Type as string },
        { enabled: cfg.layer3Enabled, source: cfg.layer3Source as string, type: cfg.layer3Type as string },
      ];
      layers.forEach(({ enabled, source, type }) => {
        if (!enabled || !source || !type) return;
        sourceFrequency.set(source, (sourceFrequency.get(source) ?? 0) + 1);
        pairs.add(`${source}×${type}`);
      });
    };
    presets.forEach((preset) => absorb(preset.config));
    absorb(config);
    const sources = [...sourceFrequency.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => source);
    return { sources, pairs, sourceFrequency };
  }, [config, presets]);

  // Only enabled layers render anything, so only they get a row. This
  // matters in practice: the most common primary type in the library
  // (flow) sits in 236 layer slots but is enabled in none of them — it is
  // a placeholder for switched-off layers, and an all-dashed row for it
  // would misread as an untried combination.
  const rows = [
    { layer: 'Layer 2', type: config.layer2Type as string, enabled: config.layer2Enabled },
    { layer: 'Layer 3', type: config.layer3Type as string, enabled: config.layer3Enabled },
  ]
    .filter((row) => row.enabled)
    .filter((row, index, list) => list.findIndex((other) => other.type === row.type) === index);

  const theoretical = data.sources.length * allMotionTypeCount;

  return (
    <div className="mt-7 border-t border-white/10 pt-5">
      <div className="flex justify-between text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1.5">
        <span>Source × Motion · 発生源×運動</span>
        <span className="font-mono">
          {data.pairs.size}/{theoretical}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        系統や型が揃っていても、その組み合わせはまだ1割ほどしか試されていません。いま表示中の運動タイプについて、どの発生源と組んだプリセットがあるか（実線）／まだ無いか（破線）を示します。破線はそのまま「次の実験」の候補です。
      </p>
      {rows.length === 0 && (
        <p className="text-[11px] text-white/40 mb-4">
          現在の設定では Layer 2 / Layer 3 が両方とも無効です。有効なレイヤーの運動タイプについて組み合わせを表示します。
        </p>
      )}
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.layer}>
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">
              {row.layer} · <span className="text-white/80 normal-case tracking-normal">{row.type}</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {data.sources.map((source) =>
                data.pairs.has(`${source}×${row.type}`) ? (
                  <span
                    key={source}
                    className="px-1.5 py-0.5 rounded border border-white/25 bg-white/10 text-[9px] tracking-wide text-white/75"
                  >
                    {source}
                  </span>
                ) : (
                  <span
                    key={source}
                    className="px-1.5 py-0.5 rounded border border-dashed border-white/20 text-[9px] tracking-wide text-white/40"
                  >
                    {source}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/35 mt-4">
        使用頻度が最も低い発生源：
        {data.sources
          .slice(-4)
          .map((source) => `${source}（${data.sourceFrequency.get(source) ?? 0}）`)
          .join('、')}
      </p>
    </div>
  );
};

const ExpressionMap: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary?: boolean;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onSaveBredPreset }) => {
  const axes = React.useMemo<CoverageAxis[]>(() => {
    const unions = {
      motionFamilies: new Set<string>(),
      sourceFamilies: new Set<string>(),
      renderFamilies: new Set<string>(),
      postFamilies: new Set<string>(),
      computeBackends: new Set<string>(),
      solverFamilies: new Set<string>(),
    };
    const absorb = (cfg: ParticleConfig) => {
      const profile = getCoverageProfile(cfg);
      (Object.keys(unions) as (keyof typeof unions)[]).forEach((key) => {
        profile[key].forEach((entry) => unions[key].add(entry));
      });
    };
    presets.forEach((preset) => absorb(preset.config));
    absorb(config);
    const usedMotionTypes = new Set<string>();
    const absorbTypes = (cfg: ParticleConfig) => {
      usedMotionTypes.add(cfg.layer2Type);
      usedMotionTypes.add(cfg.layer3Type);
      cfg.layer2Motions.forEach((motion) => usedMotionTypes.add(motion));
      cfg.layer3Motions.forEach((motion) => usedMotionTypes.add(motion));
    };
    presets.forEach((preset) => absorbTypes(preset.config));
    absorbTypes(config);
    const allMotionTypes = MOTION_GROUPS.flatMap((group) => group.ids as unknown as string[]);
    return [
      { label: 'Motion Types', gloss: '運動の型', covered: [...usedMotionTypes], targets: allMotionTypes },
      { label: 'Motion', gloss: '運動系統', covered: [...unions.motionFamilies], targets: TARGET_MOTION_FAMILIES },
      { label: 'Sources', gloss: '発生源', covered: [...unions.sourceFamilies], targets: TARGET_SOURCE_FAMILIES },
      { label: 'Rendering', gloss: '描画', covered: [...unions.renderFamilies], targets: TARGET_RENDER_FAMILIES },
      { label: 'Post FX', gloss: '画面効果', covered: [...unions.postFamilies], targets: TARGET_POST_FAMILIES },
      { label: 'Compute', gloss: '計算', covered: [...unions.computeBackends], targets: TARGET_COMPUTE_BACKENDS },
      {
        label: 'Solvers',
        gloss: '物理',
        covered: [...unions.solverFamilies],
        targets: TARGET_SOLVER_FAMILIES,
        note: 'pbd-solver / mpm-material / destruction-fracture は、物理ソルバーそのものではなく、シェーダーモード（布・粘性・破砕などの見た目）による分類です。',
      },
    ];
  }, [config, presets]);

  return (
    <section>
      <SectionTitle icon={<Compass size={12} />}>Expression Map · 表現マップ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-5">
        ライブラリ全体（現在の設定を含む）が、表現の各系統をどこまで踏んでいるかの地図です。系統レベルはほぼ飽和していますが、「運動の型」レベルにはまだプリセット未使用の型が残っています。破線チップが未踏の領域です。
      </p>
      <div className="space-y-5">
        {axes.map((axis) => {
          const coveredCount = axis.targets.filter((target) => axis.covered.includes(target)).length;
          const gaps = axis.targets.filter((target) => !axis.covered.includes(target));
          const ratio = axis.targets.length === 0 ? 0 : coveredCount / axis.targets.length;
          return (
            <div key={axis.label}>
              <div className="flex justify-between text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1.5">
                <span>
                  {axis.label} · {axis.gloss}
                </span>
                <span className="font-mono">
                  {coveredCount}/{axis.targets.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2">
                <div className="h-full rounded-full bg-white/70" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
              {gaps.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {gaps.slice(0, 10).map((gap) => (
                    <span
                      key={gap}
                      className="px-1.5 py-0.5 rounded border border-dashed border-white/20 text-[9px] tracking-wide text-white/40"
                    >
                      {gap}
                    </span>
                  ))}
                  {gaps.length > 10 && (
                    <span className="px-1.5 py-0.5 text-[9px] text-white/35">+{gaps.length - 10} more</span>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-white/40">Fully covered by the current library.</p>
              )}
              {axis.note && <p className="text-[10px] leading-relaxed text-white/35 mt-1.5">{axis.note}</p>}
            </div>
          );
        })}
      </div>
      <SourceMotionCombos config={config} presets={presets} allMotionTypeCount={axes[0]?.targets.length ?? 0} />
      <CoverageGenerator
        config={config}
        presets={presets}
        isPublicLibrary={isPublicLibrary}
        onSaveBredPreset={onSaveBredPreset}
      />
    </section>
  );
};

const CoverageGenerator: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary?: boolean;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onSaveBredPreset }) => {
  const [axis, setAxis] = React.useState<'motion' | 'source'>('motion');
  const [motion, setMotion] = React.useState<string>(COVERAGE_MOTIONS[0]);
  const [source, setSource] = React.useState<string>(COVERAGE_SOURCES[0]);
  const [message, setMessage] = React.useState('');

  const covered = React.useMemo(
    () => getCoveredSourceMotionPairs(presets, config),
    [presets, config],
  );
  const totalPairs = COVERAGE_SOURCES.length * COVERAGE_MOTIONS.length;
  const request = React.useMemo(
    () => ({ axis, value: axis === 'motion' ? motion : source }),
    [axis, motion, source],
  );
  const uncovered = React.useMemo(
    () => listUncoveredPairs(covered, request),
    [covered, request],
  );
  const batchCount = Math.min(uncovered.length, COVERAGE_BATCH_LIMIT);

  const generate = () => {
    if (!onSaveBredPreset) return;
    const candidates = generateCoverageCandidates(presets, config, request);
    candidates.forEach((candidate) => onSaveBredPreset(candidate.config, candidate.name));
    setMessage(
      candidates.length > 0
        ? `${candidates.length} 件のプリセットを追加しました（${request.value} の未踏ペア ${uncovered.length} 件中）。カバー率は ${covered.size} → ${covered.size + candidates.length} / ${totalPairs} ペア相当です。`
        : '生成できる未踏ペアがありませんでした。',
    );
  };

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <p className="text-[11px] font-semibold tracking-wide">Coverage Completion · カバレッジ補完</p>
      <p className="text-[11px] leading-relaxed text-white/45">
        未踏の「発生源 × 運動」ペアを埋めるプリセットを自動生成してライブラリに追加します。その運動を使っている既存プリセットを土台に発生源だけを差し替える（無ければ逆）ので、調整済みの動きのまま新しい組み合わせを試せます。1回で最大 {COVERAGE_BATCH_LIMIT} 件まで。
      </p>
      <div className="flex items-center gap-2">
        {(['motion', 'source'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setAxis(option)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${axis === option ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option === 'motion' ? '運動から' : '発生源から'}
          </button>
        ))}
        {axis === 'motion' ? (
          <select
            value={motion}
            onChange={(event) => setMotion(event.target.value)}
            className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-white/40"
          >
            {COVERAGE_MOTIONS.map((id) => (
              <option key={id} value={id} className="bg-neutral-900">{id}</option>
            ))}
          </select>
        ) : (
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-white/40"
          >
            {GRAPH_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-neutral-900">{option.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={generate}
          disabled={isPublicLibrary || !onSaveBredPreset || batchCount === 0}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          未踏ペアを生成して追加（{batchCount}件）
        </button>
        <span className="font-mono text-[10px] text-white/40">
          covered {covered.size}/{totalPairs}
        </span>
      </div>
      {uncovered.length === 0 && (
        <p className="text-[11px] text-white/50">この{axis === 'motion' ? '運動' : '発生源'}のペアはすべて踏破済みです。</p>
      )}
      {isPublicLibrary && (
        <p className="text-[11px] text-white/50">公開ライブラリは読み取り専用のため生成できません。</p>
      )}
      {message && <p className="text-[11px] text-white/55">{message}</p>}
    </div>
  );
};

type ParentOption = { key: string; name: string; config: ParticleConfig };

const BreedingSection: React.FC<{
  presets: PresetRecord[];
  config: ParticleConfig;
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ presets, config, isPublicLibrary, onApplyConfig, onSaveBredPreset }) => {
  const [bredParents, setBredParents] = React.useState<ParentOption[]>([]);
  const [parentAKey, setParentAKey] = React.useState<string>('');
  const [parentBKey, setParentBKey] = React.useState<string>('');
  const [mutationScale, setMutationScale] = React.useState(1);
  const [children, setChildren] = React.useState<(BredChild & { key: string })[]>([]);
  const [savedKeys, setSavedKeys] = React.useState<Set<string>>(new Set());
  const [generation, setGeneration] = React.useState(0);
  // Evolution lab: batch size, real canvas screening results, culling.
  const [batchSize, setBatchSize] = React.useState(6);
  const [screenResults, setScreenResults] = React.useState<Record<string, ScreenMetrics>>({});
  const [screening, setScreening] = React.useState(false);
  const [labNote, setLabNote] = React.useState('');
  const screenAbort = React.useRef(0);

  const options = React.useMemo<ParentOption[]>(
    () => [
      ...bredParents,
      ...presets.map((preset) => ({ key: `preset:${preset.id}`, name: preset.name, config: preset.config })),
    ],
    [bredParents, presets],
  );

  React.useEffect(() => {
    if (options.length >= 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- repairs the parent selection when the option list changes (selected preset removed or list shrank); the selection must stay valid.
      if (!options.some((option) => option.key === parentAKey)) setParentAKey(options[0].key);
      if (!options.some((option) => option.key === parentBKey)) setParentBKey(options[1].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const parentA = options.find((option) => option.key === parentAKey) ?? options[0];
  const parentB = options.find((option) => option.key === parentBKey) ?? options[1];

  const handleBreed = () => {
    if (!parentA || !parentB || parentA.key === parentB.key) return;
    const batches = Math.max(1, Math.round(batchSize / 6));
    const all: (BredChild & { key: string })[] = [];
    for (let b = 0; b < batches; b += 1) {
      const seed = ((Date.now() & 0xffffff) ^ (generation * 7919) ^ (b * 104729)) >>> 0;
      const offspring = generateOffspring(parentA.name, parentA.config, parentB.name, parentB.config, seed, mutationScale);
      offspring.forEach((child, index) => all.push({ ...child, key: `gen${generation}b${b}-${index}` }));
    }
    setChildren(all);
    setScreenResults({});
    setLabNote('');
    setGeneration((value) => value + 1);
  };

  // Real screening: apply each child briefly, sample the live canvas
  // (lit% / mean luminance), then restore the config the user had.
  const handleScreen = async () => {
    if (!onApplyConfig || children.length === 0 || screening) return;
    const runId = screenAbort.current + 1;
    screenAbort.current = runId;
    setScreening(true);
    const original = config;
    const results: Record<string, ScreenMetrics> = {};
    try {
      for (const child of children) {
        if (screenAbort.current !== runId) break;
        onApplyConfig(child.config);
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        if (screenAbort.current !== runId) break;
        const metrics = sampleCanvasMetrics();
        if (metrics) results[child.key] = metrics;
      }
    } finally {
      if (screenAbort.current === runId) {
        onApplyConfig(original);
        setScreenResults(results);
        setLabNote(`スクリーニング完了: ${Object.keys(results).length} 件を実測しました`);
      }
      setScreening(false);
    }
  };

  const rankOf = (child: BredChild & { key: string }): number => {
    const screened = screenResults[child.key];
    if (screened) return screened.litPct * 2 + screened.meanLum * 0.2;
    return scoreChild(child.config).score;
  };

  const handleCull = () => {
    if (children.length <= 2) return;
    const ranked = [...children].sort((a, b) => rankOf(b) - rankOf(a));
    const keep = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));
    setChildren(keep);
    setLabNote(`淘汰: ${ranked.length} 件 → ${keep.length} 件（${Object.keys(screenResults).length > 0 ? '実測' : '適応度推定'}の上位を残しました）`);
  };

  const handleAdoptTop = () => {
    if (children.length === 0) return;
    const ranked = [...children].sort((a, b) => rankOf(b) - rankOf(a));
    if (ranked[0]) adoptAsParent(ranked[0], 'A');
    if (ranked[1] && ranked[1].key !== ranked[0]?.key) adoptAsParent(ranked[1], 'B');
    setLabNote('最上位2件を次世代の親にセットしました');
  };

  const adoptAsParent = (child: BredChild & { key: string }, slot: 'A' | 'B') => {
    const option: ParentOption = { key: `bred:${child.key}:${child.name}`, name: child.name, config: child.config };
    setBredParents((prev) => (prev.some((entry) => entry.key === option.key) ? prev : [option, ...prev]));
    if (slot === 'A') setParentAKey(option.key);
    else setParentBKey(option.key);
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Dna size={12} />}>Breeding · 交配と突然変異（進化ラボ）</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのプリセットを親にして、数値の補間と項目ごとの遺伝、それに突然変異で子をまとめて作ります。スクリーニングで各子を実際に描画して明るさを実測し、下位を淘汰して上位を次世代の親にする「進化ラボ」として使えます。気に入った子は保存すれば棚に増えます。
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Parent A</span>
          <select value={parentA?.key ?? ''} onChange={(event) => setParentAKey(event.target.value)} className={selectClass}>
            {options.map((option) => (
              <option key={option.key} value={option.key} className="bg-neutral-900">
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Parent B</span>
          <select value={parentB?.key ?? ''} onChange={(event) => setParentBKey(event.target.value)} className={selectClass}>
            {options.map((option) => (
              <option key={option.key} value={option.key} className="bg-neutral-900">
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Slider label="Mutation Scale · 変異の強さ" value={mutationScale} min={0} max={2} step={0.1} onChange={setMutationScale} />
      <label className="block mb-3">
        <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Batch · 子の数</span>
        <select data-testid="evo-batch" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} className={selectClass}>
          <option value={6} className="bg-neutral-900">6</option>
          <option value={12} className="bg-neutral-900">12</option>
          <option value={18} className="bg-neutral-900">18</option>
        </select>
      </label>
      <button
        onClick={handleBreed}
        disabled={!parentA || !parentB || parentA.key === parentB.key || screening}
        className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Breed · 交配する
      </button>
      {children.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="evo-screen"
            onClick={handleScreen}
            disabled={screening || !onApplyConfig}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {screening ? 'スクリーニング中…' : 'スクリーニング（実測）'}
          </button>
          <button
            type="button"
            data-testid="evo-cull"
            onClick={handleCull}
            disabled={screening || children.length <= 2}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            下位半分を淘汰
          </button>
          <button
            type="button"
            data-testid="evo-adopt-top"
            onClick={handleAdoptTop}
            disabled={screening}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            最上位2件を次世代の親に
          </button>
          {labNote ? <span className="w-full text-[10px] text-emerald-300/90" data-testid="evo-note">{labNote}</span> : null}
        </div>
      )}
      {children.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-4">
          {children.map((child) => {
            const isSaved = savedKeys.has(child.key);
            return (
              <div key={child.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs font-semibold tracking-wide leading-snug">{child.name}</div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  blend {Math.round(child.spec.t * 100)}% · mutation {Math.round(child.spec.mutation * mutationScale * 100)}%
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  {child.config.layer2Type} / {child.config.layer3Type}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  適応度 {scoreChild(child.config).score}
                  {screenResults[child.key]
                    ? ` · 実測 lit ${screenResults[child.key].litPct}% / 輝度 ${screenResults[child.key].meanLum}`
                    : ''}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1">
                  <button
                    onClick={() => onApplyConfig?.(child.config)}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    試す
                  </button>
                  <button
                    onClick={() => adoptAsParent(child, 'A')}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    親A
                  </button>
                  <button
                    onClick={() => adoptAsParent(child, 'B')}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    親B
                  </button>
                  <button
                    onClick={() => {
                      onSaveBredPreset?.(child.config, child.name);
                      setSavedKeys((prev) => new Set(prev).add(child.key));
                    }}
                    disabled={isPublicLibrary || isSaved || !onSaveBredPreset}
                    className="py-1.5 text-[9px] font-bold uppercase rounded bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {isSaved ? '保存済' : '保存'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {isPublicLibrary && (
        <p className="mt-3 text-[10px] text-white/40">Public build では保存できません（試す・交配は可能です）。</p>
      )}
    </section>
  );
};

const TAB_SHORT_LABELS: Record<string, string> = {
  global: 'Main',
  layer1: 'L1',
  layer2: 'L2',
  layer3: 'L3',
  ambient: 'Amb',
  audio: 'FX',
};

const ParameterSearchSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  onJumpToTab?: ControlPanelContentProps['onJumpToTab'];
}> = ({ config, updateConfig, onJumpToTab }) => {
  const [query, setQuery] = React.useState('');
  const results = React.useMemo(() => searchParameters(query, 30), [query]);
  const write = updateConfig as (key: keyof ParticleConfig, value: number) => void;

  return (
    <section>
      <SectionTitle icon={<Search size={12} />}>Parameter Search · パラメータ検索</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        詳細タブにある数値パラメータ {PARAMETER_CATALOG.length} 件を、名前やキーで横断検索できます。その場で値を変えるか、タブ名を押して本来の場所へ移動できます。⌘K（Ctrl+K）のコマンドパレットからも、プリセットとパラメータを横断検索できます。
      </p>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="e.g. gravity, bloom, flow speed, 粒子の重さ…"
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs tracking-wide outline-none focus:border-white/40 mb-3"
      />
      {query.trim() && results.length === 0 && (
        <p className="text-[11px] text-white/40">該当するパラメータがありません。</p>
      )}
      <div className="space-y-3">
        {results.map((entry) => {
          const raw = config[entry.key];
          const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : entry.min;
          return (
            <div key={`${entry.tab}:${entry.key}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-medium tracking-wide truncate">
                  {entry.label} <span className="text-white/30 font-mono text-[9px]">{entry.key}</span>
                </span>
                <button
                  onClick={() => onJumpToTab?.(entry.tab)}
                  className="shrink-0 px-2 py-0.5 rounded-full border border-white/20 text-[9px] uppercase tracking-wider text-white/60 hover:bg-white/10 hover:text-white"
                >
                  {TAB_SHORT_LABELS[entry.tab] ?? entry.tab} へ
                </button>
              </div>
              {entry.description && (
                <p className="text-[10px] leading-relaxed text-white/45 mb-1.5">{entry.description}</p>
              )}
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={entry.min}
                  max={entry.max}
                  step={entry.step}
                  value={Math.min(entry.max, Math.max(entry.min, value))}
                  onChange={(event) => write(entry.key, parseFloat(event.target.value))}
                  className="flex-1 h-1 bg-current rounded-lg appearance-none cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
                  style={{ accentColor: 'currentColor' }}
                />
                <span className="font-mono text-[10px] text-white/60 w-16 text-right">
                  {value.toFixed(entry.step < 0.1 ? 3 : 1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const XyPadSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [xKey, setXKey] = React.useState<keyof ParticleConfig>('layer2FlowSpeed');
  const [yKey, setYKey] = React.useState<keyof ParticleConfig>('layer2Complexity');
  const padRef = React.useRef<HTMLDivElement | null>(null);
  const write = updateConfig as (key: keyof ParticleConfig, value: number) => void;

  const xEntry = PARAMETER_CATALOG.find((entry) => entry.key === xKey) ?? PARAMETER_CATALOG[0];
  const yEntry = PARAMETER_CATALOG.find((entry) => entry.key === yKey) ?? PARAMETER_CATALOG[1];

  const normalize = (entry: ParameterCatalogEntry) => {
    const raw = config[entry.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : entry.min;
    return Math.min(1, Math.max(0, (value - entry.min) / (entry.max - entry.min || 1)));
  };
  const xRatio = xEntry ? normalize(xEntry) : 0;
  const yRatio = yEntry ? normalize(yEntry) : 0;

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || !xEntry || !yEntry) return;
    const rx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const ry = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    write(xEntry.key, xEntry.min + rx * (xEntry.max - xEntry.min));
    write(yEntry.key, yEntry.max - ry * (yEntry.max - yEntry.min));
  };

  const selectClass = 'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Gamepad2 size={12} />}>XY Pad · 演奏パッド</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのパラメータを指先で同時に弾くためのパッドです。横がX、縦がY（上が最大）に対応します。
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">X axis</span>
          <select value={xKey} onChange={(event) => setXKey(event.target.value as keyof ParticleConfig)} className={selectClass}>
            {PARAMETER_CATALOG.map((entry) => (
              <option key={`x:${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Y axis</span>
          <select value={yKey} onChange={(event) => setYKey(event.target.value as keyof ParticleConfig)} className={selectClass}>
            {PARAMETER_CATALOG.map((entry) => (
              <option key={`y:${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={padRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        className="relative h-44 rounded-xl border border-white/15 bg-white/5 overflow-hidden touch-none cursor-crosshair select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <div
          className="absolute h-4 w-4 -ml-2 -mt-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]"
          style={{ left: `${xRatio * 100}%`, top: `${(1 - yRatio) * 100}%` }}
        />
        <span className="absolute left-2 bottom-1.5 text-[9px] uppercase tracking-widest text-white/30">{xEntry?.label}</span>
        <span className="absolute right-2 top-1.5 text-[9px] uppercase tracking-widest text-white/30">{yEntry?.label}</span>
      </div>
    </section>
  );
};

const HistorySection: React.FC<{
  entries: ControlPanelContentProps['configHistoryEntries'];
  config: ParticleConfig;
  onApplyConfig?: (config: ParticleConfig) => void;
  onClearConfigHistory?: () => void;
}> = ({ entries, config, onApplyConfig, onClearConfigHistory }) => {
  const currentJson = React.useMemo(() => JSON.stringify(config), [config]);
  if (!entries || entries.length === 0) return null;
  const ordered = [...entries].reverse();
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle icon={<History size={12} />}>History · 履歴</SectionTitle>
        <button
          onClick={onClearConfigHistory}
          className="text-[9px] uppercase tracking-widest text-white/35 hover:text-white/70 -mt-4"
        >
          古い履歴を消す
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4 -mt-2">
        設定が落ち着くたびに自動で記録しています（最大{entries.length > 0 ? 16 : 16}件、このセッション限り）。カードを押すとその状態に戻ります。偶然できた形の回収用です。
      </p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {ordered.map((entry) => {
          const isCurrent = entry.json === currentJson;
          const time = new Date(entry.capturedAt).toLocaleTimeString('ja-JP', { hour12: false });
          return (
            <button
              key={entry.id}
              onClick={() => onApplyConfig?.(entry.config)}
              className={`shrink-0 w-32 text-left rounded-xl border p-2.5 transition-colors ${
                isCurrent ? 'border-white/45 bg-white/12' : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-white/70">{time}</span>
                {isCurrent && (
                  <span className="px-1.5 py-0.5 rounded bg-white text-black text-[8px] font-bold uppercase tracking-wider">
                    現在
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[9px] uppercase tracking-widest text-white/40 leading-relaxed">
                {entry.config.layer2Type}
                <br />
                {entry.config.layer3Type}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

const DataSourceSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const [text, setText] = React.useState('');
  const [layer, setLayer] = React.useState<2 | 3>(2);
  const [parsed, setParsed] = React.useState<ParsedData | null>(null);
  const [status, setStatus] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;

  const analyze = (input: string) => {
    const result = parseDataPoints(input);
    setParsed(result);
    if (!result) {
      setStatus(input.trim() ? '点を読み取れませんでした。x, y の2列が必要です。' : '');
      return;
    }
    setStatus(
      `${result.points.length.toLocaleString()} 点を読み取りました（X ${result.xRange[0]}〜${result.xRange[1]}、Y ${result.yRange[0]}〜${result.yRange[1]}${result.hasValue ? '、値あり' : ''}）。`,
    );
  };

  const applyParsed = (data: ParsedData) => {
    const map = buildDataLumaMap(data);
    getDataSourceUpdates(layer, map).forEach(([key, value]) => write(key, value));
    setStatus(`Layer ${layer} に適用しました。発生源は画像（データ）になり、現在の運動タイプのままデータの形を取ります。`);
  };

  const applySample = () => {
    const points = buildSampleDataPoints();
    const data: ParsedData = {
      points,
      hasValue: true,
      xRange: [0, 100],
      yRange: [0, 100],
    };
    setParsed(data);
    applyParsed(data);
  };

  return (
    <section>
      <SectionTitle icon={<Database size={12} />}>Data Source · データ発生源</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        CSV や JSON の点データを粒子の形にします。XY が形になり、値（または Z）が明るさになります。画像発生源の仕組みをそのまま使うので、運動や描画は現在の設定が引き継がれます。
      </p>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          analyze(event.target.value);
        }}
        placeholder={'x, y, value\n0, 0, 1\n10, 4, 0.6\n… または JSON 配列'}
        rows={4}
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono outline-none focus:border-white/40 mb-3"
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => setLayer(Number(event.target.value) as 2 | 3)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value={2} className="bg-neutral-900">Layer 2 に適用</option>
          <option value={3} className="bg-neutral-900">Layer 3 に適用</option>
        </select>
        <button
          onClick={() => parsed && applyParsed(parsed)}
          disabled={!parsed || isPublicLibrary}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
        >
          適用する
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
        >
          ファイルを選ぶ
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((content) => {
              setText(content);
              analyze(content);
            });
            event.target.value = '';
          }}
        />
        <button
          onClick={applySample}
          disabled={isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          サンプル（渦巻銀河）
        </button>
      </div>
      {status && <p className="text-[11px] text-white/55">{status}</p>}
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドでは適用できません。</p>}
      <p className="text-[10px] text-white/30 mt-2">
        現在の Layer {layer} 発生源：{layer === 2 ? config.layer2Source : config.layer3Source}
        {(layer === 2 ? config.layer2MediaLumaMap : config.layer3MediaLumaMap).length > 0 ? '（データ／画像マップあり）' : ''}
      </p>
    </section>
  );
};

const TextureThumb: React.FC<{ map: number[] }> = ({ map }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(TEXTURE_MAP_SIZE, TEXTURE_MAP_SIZE);
    for (let i = 0; i < TEXTURE_MAP_SIZE * TEXTURE_MAP_SIZE; i++) {
      const gray = Math.round(Math.min(1, Math.max(0, map[i] ?? 0)) * 255);
      image.data[i * 4] = gray;
      image.data[i * 4 + 1] = gray;
      image.data[i * 4 + 2] = gray;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [map]);
  return (
    <canvas
      ref={canvasRef}
      width={TEXTURE_MAP_SIZE}
      height={TEXTURE_MAP_SIZE}
      className="w-full aspect-square rounded bg-black border border-white/10"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

const TexturePackSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layer, setLayer] = React.useState<2 | 3>(2);
  const [applied, setApplied] = React.useState('');
  const maps = React.useMemo(
    () => TEXTURE_DEFINITIONS.map((definition) => ({ definition, map: definition.generate() })),
    [],
  );

  const applyTexture = (id: string, map: number[]) => {
    getDataSourceUpdates(layer, map).forEach(([key, value]) => write(key, value));
    const definition = getTextureDefinition(id);
    setApplied(`「${definition?.label ?? id}」を Layer ${layer} に適用しました`);
  };

  return (
    <section>
      <SectionTitle icon={<Grid3x3 size={12} />}>Texture Pack · モノクロ質感パック</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        白黒の模様を粒子の形として使えます。タイルを選ぶと、その模様が選んだレイヤーの発生源（画像）になります。運動や描画は現在の設定のままです。
      </p>
      <div className="flex items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => setLayer(Number(event.target.value) as 2 | 3)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value={2} className="bg-neutral-900">Layer 2 に適用</option>
          <option value={3} className="bg-neutral-900">Layer 3 に適用</option>
        </select>
        {applied && <p className="text-[11px] text-white/55">{applied}</p>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {maps.map(({ definition, map }) => (
          <button
            key={definition.id}
            onClick={() => applyTexture(definition.id, map)}
            disabled={isPublicLibrary}
            title={definition.description}
            className="group text-left disabled:opacity-40"
          >
            <TextureThumb map={map} />
            <span className="block mt-1 text-[10px] text-white/60 group-hover:text-white transition-colors">
              {definition.label}
            </span>
          </button>
        ))}
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-2">公開ビルドでは適用できません。</p>}
      <p className="text-[10px] text-white/30 mt-2">
        現在の Layer {layer} 発生源：{layer === 2 ? config.layer2Source : config.layer3Source}
        {(layer === 2 ? config.layer2MediaLumaMap : config.layer3MediaLumaMap).length > 0 ? '（マップあり）' : ''}
      </p>
    </section>
  );
};

interface MidiMessageEventLike {
  data: Uint8Array | null;
}
interface MidiInputLike {
  id: string;
  name?: string | null;
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
}
interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>;
  onstatechange: (() => void) | null;
}

const MidiSection: React.FC<{
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const supported =
    typeof navigator !== 'undefined' &&
    'requestMIDIAccess' in (navigator as unknown as Record<string, unknown>);
  const [connected, setConnected] = React.useState(false);
  const [inputs, setInputs] = React.useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = React.useState<MidiAssignment[]>(() =>
    loadMidiAssignments(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [targetValue, setTargetValue] = React.useState('macro:density');
  const [learning, setLearning] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState('');
  const [error, setError] = React.useState('');

  const assignmentsRef = React.useRef(assignments);
  assignmentsRef.current = assignments;
  const learnTargetRef = React.useRef<MidiTarget | null>(null);
  const accessRef = React.useRef<MidiAccessLike | null>(null);

  const applyTarget = React.useCallback(
    (target: MidiTarget, value: number) => {
      if (target.kind === 'macro') {
        const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
        if (!definition) return;
        getMacroUpdates(definition, value / 127).forEach(({ key, value: next }) => write(key, next));
        return;
      }
      const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
      if (!entry) return;
      const scaled = scaleCcValue(value, entry.min, entry.max);
      const stepped = Math.round(scaled / entry.step) * entry.step;
      write(entry.key, Number(stepped.toFixed(6)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMessage = React.useCallback(
    (event: MidiMessageEventLike) => {
      const data = event.data;
      if (!data || data.length < 3) return;
      const status = data[0];
      if ((status & 0xf0) !== 0xb0) return; // Control Change only
      const channel = status & 0x0f;
      const cc = data[1];
      const value = data[2];
      setLastEvent(`CH${channel + 1} CC${cc} = ${value}`);
      const learnTarget = learnTargetRef.current;
      if (learnTarget) {
        learnTargetRef.current = null;
        setLearning(false);
        setAssignments((prev) => {
          const next = [
            ...prev.filter((assignment) => !(assignment.cc === cc && assignment.channel === channel)),
            { channel, cc, target: learnTarget },
          ];
          saveMidiAssignments(window.localStorage, next);
          return next;
        });
        return;
      }
      const assignment = resolveAssignment(assignmentsRef.current, channel, cc);
      if (assignment) applyTarget(assignment.target, value);
    },
    [applyTarget],
  );

  const connect = async () => {
    setError('');
    try {
      const requestAccess = (
        navigator as unknown as { requestMIDIAccess: () => Promise<MidiAccessLike> }
      ).requestMIDIAccess.bind(navigator);
      const access = await requestAccess();
      accessRef.current = access;
      const attach = () => {
        const list: { id: string; name: string }[] = [];
        access.inputs.forEach((input: MidiInputLike) => {
          input.onmidimessage = handleMessage;
          list.push({ id: input.id, name: input.name ?? input.id });
        });
        setInputs(list);
      };
      attach();
      access.onstatechange = attach;
      setConnected(true);
    } catch {
      setError('MIDI へのアクセスが許可されませんでした。ブラウザの許可設定を確認してください。');
    }
  };

  React.useEffect(
    () => () => {
      accessRef.current?.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    },
    [],
  );

  const startLearning = () => {
    const [kind, rest] = targetValue.split(/:(.*)/).filter(Boolean);
    const target: MidiTarget | null =
      kind === 'macro'
        ? { kind: 'macro', id: rest }
        : kind === 'param'
          ? { kind: 'param', key: rest as keyof ParticleConfig }
          : null;
    if (!target) return;
    learnTargetRef.current = target;
    setLearning(true);
  };

  const removeAssignment = (index: number) => {
    setAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveMidiAssignments(window.localStorage, next);
      return next;
    });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Piano size={12} />}>MIDI Control · MIDI入力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        MIDIコントローラのノブやフェーダを、マクロやパラメータに割り当てて演奏できます。割り当てはこのブラウザに保存されます（プリセットには含まれません）。Playタブを開いている間だけ有効です。
      </p>
      {!supported && (
        <p className="text-[11px] text-white/40">
          このブラウザは Web MIDI に対応していません（Chrome / Edge などで利用できます）。
        </p>
      )}
      {supported && !connected && (
        <button
          onClick={connect}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
        >
          MIDI機器に接続
        </button>
      )}
      {error && <p className="text-[11px] text-red-300/80 mt-2">{error}</p>}
      {connected && (
        <div className="space-y-3">
          <p className="text-[11px] text-white/55">
            接続中：{inputs.length === 0 ? '入力機器が見つかりません（接続すると自動で表示されます）' : inputs.map((input) => input.name).join('、')}
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)} className={selectClass}>
              <optgroup label="マクロ">
                {MACRO_DEFINITIONS.map((macro) => (
                  <option key={macro.id} value={`macro:${macro.id}`} className="bg-neutral-900">
                    {macro.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="パラメータ">
                {PARAMETER_CATALOG.map((entry) => (
                  <option key={`${entry.tab}:${entry.key}`} value={`param:${entry.key}`} className="bg-neutral-900">
                    {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={startLearning}
              disabled={learning || isPublicLibrary}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40 ${
                learning ? 'bg-amber-200 text-black' : 'bg-white text-black hover:bg-gray-200'
              }`}
            >
              {learning ? 'ノブを動かしてください…' : 'Learn · 学習'}
            </button>
          </div>
          {assignments.length > 0 && (
            <ul className="space-y-1.5">
              {assignments.map((assignment, index) => (
                <li
                  key={`${assignment.channel}:${assignment.cc}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]"
                >
                  <span>
                    <span className="font-mono text-white/60">
                      CH{assignment.channel === null ? '*' : assignment.channel + 1} CC{assignment.cc}
                    </span>{' '}
                    → {describeMidiTarget(assignment.target)}
                  </span>
                  <button
                    onClick={() => removeAssignment(index)}
                    className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lastEvent && <p className="font-mono text-[10px] text-white/35">last: {lastEvent}</p>}
          {isPublicLibrary && <p className="text-[11px] text-white/35">公開ビルドでは割り当てを適用できません。</p>}
        </div>
      )}
    </section>
  );
};

const OscSection: React.FC<{
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [bridgeUrl, setBridgeUrl] = React.useState(DEFAULT_OSC_BRIDGE_URL);
  const [connected, setConnected] = React.useState(false);
  const [assignments, setAssignments] = React.useState<OscAssignment[]>(() =>
    loadOscAssignments(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [targetValue, setTargetValue] = React.useState('macro:density');
  const [learning, setLearning] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState('');
  const [error, setError] = React.useState('');

  const assignmentsRef = React.useRef(assignments);
  assignmentsRef.current = assignments;
  const learnTargetRef = React.useRef<OscTarget | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);

  const applyTarget = React.useCallback(
    (target: OscTarget, rawValue: number) => {
      const ratio = oscValueToRatio(rawValue);
      if (target.kind === 'macro') {
        const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
        if (!definition) return;
        getMacroUpdates(definition, ratio).forEach(({ key, value: next }) => write(key, next));
        return;
      }
      const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
      if (!entry) return;
      const scaled = scaleOscValue(ratio, entry.min, entry.max);
      const stepped = Math.round(scaled / entry.step) * entry.step;
      write(entry.key, Number(stepped.toFixed(6)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMessage = React.useCallback(
    (address: string, args: unknown[]) => {
      const numeric = args.find((arg): arg is number => typeof arg === 'number');
      setLastEvent(numeric !== undefined ? `${address} = ${numeric}` : `${address} (${args.length} args)`);
      const learnTarget = learnTargetRef.current;
      if (learnTarget) {
        learnTargetRef.current = null;
        setLearning(false);
        if (isValidOscAddress(address)) {
          setAssignments((prev) => {
            const next = [...prev.filter((assignment) => assignment.address !== address), { address, target: learnTarget }];
            saveOscAssignments(window.localStorage, next);
            return next;
          });
        }
        return;
      }
      if (numeric === undefined) return;
      const assignment = resolveOscAssignment(assignmentsRef.current, address);
      if (assignment) applyTarget(assignment.target, numeric);
    },
    [applyTarget],
  );

  const handleMessageRef = React.useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const connect = () => {
    setError('');
    let socket: WebSocket;
    try {
      socket = new WebSocket(bridgeUrl);
    } catch {
      setError('ブリッジのアドレスが不正です。');
      return;
    }
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      setConnected(false);
    };
    socket.onerror = () => {
      setError('ブリッジに接続できませんでした。先に node tools/osc-bridge/osc-bridge.mjs を起動してください。');
    };
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { type?: string; address?: string; args?: unknown[] };
        if (parsed.type === 'osc' && typeof parsed.address === 'string') {
          handleMessageRef.current(parsed.address, Array.isArray(parsed.args) ? parsed.args : []);
        }
      } catch {
        // Non-JSON frames from the bridge are ignored.
      }
    };
  };

  const disconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  };

  React.useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  const startLearning = () => {
    const [kind, rest] = targetValue.split(/:(.*)/).filter(Boolean);
    const target: OscTarget | null =
      kind === 'macro'
        ? { kind: 'macro', id: rest }
        : kind === 'param'
          ? { kind: 'param', key: rest as keyof ParticleConfig }
          : null;
    if (!target) return;
    learnTargetRef.current = target;
    setLearning(true);
  };

  const removeAssignment = (index: number) => {
    setAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveOscAssignments(window.localStorage, next);
      return next;
    });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Radio size={12} />}>OSC Control · OSC入力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        TouchOSC等のOSCコントローラから、マクロやパラメータを操作できます。ブラウザはOSC（UDP）を直接扱えないため、PC上で小さなブリッジ（node
        tools/osc-bridge/osc-bridge.mjs）を起動し、そこへ接続します。割り当てはこのブラウザに保存されます（プリセットには含まれません）。Playタブを開いている間だけ有効です。値は最初の引数を使い、0..1はそのまま、大きい値は0..127スケールとして読みます。
      </p>
      {!connected && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              value={bridgeUrl}
              onChange={(event) => setBridgeUrl(event.target.value)}
              className={selectClass}
              aria-label="OSCブリッジのWebSocketアドレス"
            />
            <button
              onClick={connect}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
            >
              ブリッジに接続
            </button>
          </div>
          {error && <p className="text-[11px] text-red-300/80">{error}</p>}
        </div>
      )}
      {connected && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/55">接続中：{bridgeUrl}（OSC受信ポートはブリッジ側の設定）</p>
            <button
              onClick={disconnect}
              className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
            >
              切断
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)} className={selectClass}>
              <optgroup label="マクロ">
                {MACRO_DEFINITIONS.map((macro) => (
                  <option key={macro.id} value={`macro:${macro.id}`} className="bg-neutral-900">
                    {macro.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="パラメータ">
                {PARAMETER_CATALOG.map((entry) => (
                  <option key={`${entry.tab}:${entry.key}`} value={`param:${entry.key}`} className="bg-neutral-900">
                    {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={startLearning}
              disabled={learning || isPublicLibrary}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40 ${
                learning ? 'bg-amber-200 text-black' : 'bg-white text-black hover:bg-gray-200'
              }`}
            >
              {learning ? 'OSCを送ってください…' : 'Learn · 学習'}
            </button>
          </div>
          {assignments.length > 0 && (
            <ul className="space-y-1.5">
              {assignments.map((assignment, index) => (
                <li
                  key={`${assignment.address}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]"
                >
                  <span>
                    <span className="font-mono text-white/60">{assignment.address}</span> → {describeOscTarget(assignment.target)}
                  </span>
                  <button
                    onClick={() => removeAssignment(index)}
                    className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lastEvent && <p className="font-mono text-[10px] text-white/35">last: {lastEvent}</p>}
          {isPublicLibrary && <p className="text-[11px] text-white/35">公開ビルドでは割り当てを適用できません。</p>}
        </div>
      )}
    </section>
  );
};

interface StageDeck {
  name: string;
  config: ParticleConfig;
}

const GpuDiagnosticsSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [report, setReport] = React.useState<GpuDiagnosticsReport | null>(null);
  const [running, setRunning] = React.useState(false);
  const [lightened, setLightened] = React.useState(false);
  const tierInfo = useGpuTierInfo();
  const tierRaymarchDefaults = getRaymarchDefaults(tierInfo.tier);
  const tierGpgpuCap = getMaxGpgpuTexSize(tierInfo.tier);

  const runDiagnostics = async () => {
    setRunning(true);
    try {
      setReport(await collectGpuDiagnostics());
    } finally {
      setRunning(false);
    }
  };

  const applyLighten = () => {
    updateConfig('layer2Count', Math.max(200, Math.floor(config.layer2Count * 0.5)));
    updateConfig('layer3Count', Math.max(200, Math.floor(config.layer3Count * 0.5)));
    updateConfig('gpgpuCount', Math.max(4096, Math.floor(config.gpgpuCount * 0.25)));
    setLightened(true);
  };

  const rows: Array<{ label: string; value: string; warn?: boolean }> = report ? [
    { label: 'WebGL2', value: report.webgl2 ? '対応' : '使えません', warn: !report.webgl2 },
    { label: 'Renderer', value: report.renderer ?? '不明' },
    { label: '描画方式', value: report.softwareRendering ? 'ソフトウェア描画（GPU未使用）' : 'GPU描画', warn: report.softwareRendering },
    { label: 'Float カラーバッファ', value: report.colorBufferFloat ? '対応（GPGPU可）' : report.colorBufferHalfFloat ? 'Half のみ' : 'なし', warn: !report.colorBufferFloat && !report.colorBufferHalfFloat },
    { label: '最大テクスチャ', value: report.maxTextureSize ? `${report.maxTextureSize}px` : '不明' },
    { label: 'Fragment 高精度 float', value: report.fragmentHighp ? '対応' : '非対応', warn: !report.fragmentHighp },
    { label: 'WebGPU', value: report.webgpu === 'supported' ? `対応（${report.webgpuAdapter ?? 'adapter'}）` : report.webgpu === 'no-adapter' ? 'アダプタなし → WebGL にフォールバック' : '非対応 → WebGL にフォールバック' },
  ] : [];

  return (
    <section className="space-y-4">
      <SectionTitle icon={<Monitor size={12} />}>GPU Diagnostics · GPU診断</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45">
        このブラウザと GPU で何が動くかを実測します。WebGL2 が土台で、WebGPU が使えない環境では WebGL に自動で落ちます。ソフトウェア描画の環境では粒子数を下げると滑らかになります。
      </p>
      <div className="space-y-1.5 rounded border border-white/10 bg-black/20 p-3">
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">GPUティア</span>
          <span className="text-right text-white/80">
            {GPU_TIER_LABELS_JA[tierInfo.tier]}
            <span className="text-white/40">（検出: {GPU_TIER_LABELS_JA[tierInfo.detectedTier]}{tierInfo.override ? '・手動で上書き中' : ''}）</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">Renderer</span>
          <span className="text-right text-white/75">{tierInfo.renderer ?? '不明'}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">レイマーチ既定</span>
          <span className="text-right text-white/75">スケール {tierRaymarchDefaults.renderScale} / ステップ {tierRaymarchDefaults.maxSteps}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">GPGPU上限テクスチャ</span>
          <span className="text-right text-white/75">{tierGpgpuCap}</span>
        </div>
        <p className="pt-1 text-[11px] leading-relaxed text-white/40">
          ティアは GPU 名からの判定（不明な場合は簡易ベンチマーク）で決まります。重い機能の既定値と推奨警告に使われます。判定が実機と違う場合は手動で上書きできます（新しいレイヤー・プリセットの既定値から反映されます）。
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {([null, 'entry', 'standard', 'high', 'flagship'] as Array<GpuTier | null>).map((option) => {
            const isActive = tierInfo.override === option;
            return (
              <button
                key={option ?? 'auto'}
                type="button"
                onClick={() => setGpuTierOverride(option)}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition ${isActive ? 'border-amber-200/50 bg-amber-200/15 text-amber-100' : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10'}`}
              >
                {option === null ? '自動' : GPU_TIER_LABELS_JA[option]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => redetectGpuTier()}
            className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/65 transition hover:bg-white/10"
          >
            再検出
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { void runDiagnostics(); }}
        disabled={running}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 transition hover:bg-white/10 disabled:opacity-40"
      >
        {running ? '診断中…' : report ? '再診断' : '診断する'}
      </button>
      {report && (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-white/40">{row.label}</span>
              <span className={`text-right ${row.warn ? 'text-amber-200/90' : 'text-white/75'}`}>{row.value}</span>
            </div>
          ))}
          {!report.webgl2 && (
            <p className="pt-1 text-[11px] leading-relaxed text-red-200/85">WebGL2 が使えないため、この環境では描画できません。別のブラウザをお試しください。</p>
          )}
          {report.webgl2 && report.softwareRendering && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] leading-relaxed text-amber-200/85">
                ソフトウェア描画です。動作はしますが重くなります。粒子数（Layer2/3 を半分、GPGPU を 1/4）を下げる軽量化を適用できます。
              </p>
              <button
                type="button"
                onClick={applyLighten}
                disabled={lightened}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 transition hover:bg-white/10 disabled:opacity-40"
              >
                {lightened ? '軽量化を適用しました' : '軽量化を適用'}
              </button>
            </div>
          )}
          {report.webgl2 && !report.softwareRendering && (
            <p className="pt-1 text-[11px] text-white/50">GPU 描画が使えています。この環境では全機能が動作する見込みです。</p>
          )}
        </div>
      )}
    </section>
  );
};

const CleanOutputSection: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    const timer = window.setInterval(() => setIsOpen(isCleanOutputOpen()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = () => {
    if (isCleanOutputOpen()) {
      closeCleanOutput();
      setIsOpen(false);
      setMessage('出力ウィンドウを閉じました。');
      return;
    }
    const status = openCleanOutput();
    if (status.state === 'open') {
      setIsOpen(true);
      setMessage('出力ウィンドウを開きました。プロジェクター側の画面へドラッグし、映像をクリックすると全画面になります。');
    } else if (status.state === 'blocked') {
      setMessage('ポップアップがブロックされました。ブラウザのポップアップ許可が必要です。');
    } else {
      setMessage('キャンバスが見つかりませんでした。シーンが表示されてから開いてください。');
    }
  };

  return (
    <section>
      <SectionTitle icon={<Monitor size={12} />}>Clean Output · クリーン出力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-3">
        UI の無いキャンバスだけの別ウィンドウを開きます。メイン画面の描画をそのまま鏡映しするので、操作はすべてこちら側で行い、出力側はプロジェクターや送出先の画面に置くだけです。映像のクリックで全画面を切り替えます（音声は出力されません）。
      </p>
      <button
        onClick={toggle}
        className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
      >
        {isOpen ? '出力ウィンドウを閉じる' : '出力ウィンドウを開く'}
      </button>
      {message && <p className="text-[11px] text-white/55 mt-2">{message}</p>}
    </section>
  );
};

const StageSection: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
}> = ({ config, presets, isPublicLibrary, onApplyConfig }) => {
  const [deckA, setDeckA] = React.useState<StageDeck | null>(null);
  const [deckB, setDeckB] = React.useState<StageDeck | null>(null);
  const [mix, setMix] = React.useState(0);
  const [fadeSeconds, setFadeSeconds] = React.useState(3);
  const fadeRef = React.useRef<number | null>(null);
  const mixRef = React.useRef(0);
  mixRef.current = mix;

  const stopFade = React.useCallback(() => {
    if (fadeRef.current !== null) {
      cancelAnimationFrame(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  React.useEffect(() => stopFade, [stopFade]);

  const applyMix = React.useCallback(
    (nextMix: number, deckAConfig: ParticleConfig | null, deckBConfig: ParticleConfig | null) => {
      const clamped = Math.min(1, Math.max(0, nextMix));
      setMix(clamped);
      if (deckAConfig && deckBConfig && onApplyConfig) {
        onApplyConfig(interpolateConfig(deckAConfig, deckBConfig, clamped));
      }
    },
    [onApplyConfig],
  );

  const loadPreset = (side: 'A' | 'B', presetId: string) => {
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    stopFade();
    if (side === 'A') {
      setDeckA({ name: preset.name, config: preset.config });
      if (deckB) applyMix(mixRef.current, preset.config, deckB.config);
    } else {
      setDeckB({ name: preset.name, config: preset.config });
      if (deckA) applyMix(mixRef.current, deckA.config, preset.config);
    }
  };

  const captureCurrent = (side: 'A' | 'B') => {
    stopFade();
    const deck = { name: '現在のシーン', config };
    if (side === 'A') {
      setDeckA(deck);
      if (deckB) applyMix(mixRef.current, deck.config, deckB.config);
    } else {
      setDeckB(deck);
      if (deckA) applyMix(mixRef.current, deckA.config, deck.config);
    }
  };

  const autoFade = (target: number) => {
    if (!deckA || !deckB || !onApplyConfig) return;
    stopFade();
    const from = mixRef.current;
    const durationMs = Math.max(100, fadeSeconds * 1000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / durationMs);
      const eased = applyTransitionEasing(linear, 'ease-in-out');
      applyMix(from + (target - from) * eased, deckA.config, deckB.config);
      if (linear < 1) {
        fadeRef.current = requestAnimationFrame(tick);
      } else {
        fadeRef.current = null;
      }
    };
    fadeRef.current = requestAnimationFrame(tick);
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';
  const canPerform = Boolean(deckA && deckB && onApplyConfig) && !isPublicLibrary;

  const deckCard = (side: 'A' | 'B', deck: StageDeck | null) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11px] font-semibold tracking-wide">Deck {side}</span>
        {deck && (
          <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-wider text-white/40">
            {deck.config.layer2Type} / {deck.config.layer3Type}
          </span>
        )}
      </div>
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) loadPreset(side, event.target.value);
        }}
        className={selectClass}
        aria-label={`Deck ${side} にプリセットを読み込む`}
      >
        <option value="" className="bg-neutral-900">
          {deck ? deck.name : 'プリセットを選ぶ…'}
        </option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id} className="bg-neutral-900">
            {preset.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => captureCurrent(side)}
        className="w-full py-1.5 rounded-lg border border-white/15 text-white/60 text-[10px] uppercase tracking-widest hover:bg-white/10 transition-colors"
      >
        現在のシーンを取り込む
      </button>
    </div>
  );

  return (
    <section>
      <SectionTitle icon={<ArrowLeftRight size={12} />}>Stage · A/Bデッキ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのプリセット（または今のシーン）をデッキA／Bに置き、クロスフェーダーで連続的に混ぜる演奏用セクションです。混ぜ合わせはシーケンスのモーフと同じ補間で、数値は滑らかに、種類の切り替えは中点で起こります。フェーダーを動かすとライブの設定が書き換わります（プリセット自体は変わりません）。気に入った中間状態はそのままプリセットとして保存できます。
      </p>
      <div className={isPublicLibrary ? 'pointer-events-none opacity-60' : ''}>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {deckCard('A', deckA)}
          {deckCard('B', deckB)}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-white/50">
            <span className="min-w-0 truncate" title={deckA?.name}>A {deckA?.name ?? '—'}</span>
            <span className="shrink-0 font-mono text-white/80">{Math.round(mix * 100)}%</span>
            <span className="min-w-0 truncate text-right" title={deckB?.name}>B {deckB?.name ?? '—'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(mix * 1000)}
            disabled={!canPerform}
            onChange={(event) => {
              stopFade();
              if (deckA && deckB) applyMix(Number(event.target.value) / 1000, deckA.config, deckB.config);
            }}
            className="w-full h-2 bg-current rounded-lg appearance-none cursor-pointer focus:outline-none opacity-70 hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
            style={{ accentColor: 'currentColor' }}
            aria-label="クロスフェーダー"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                stopFade();
                if (deckA && deckB) applyMix(0, deckA.config, deckB.config);
              }}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-40"
            >
              Aに切替
            </button>
            <button
              onClick={() => autoFade(mixRef.current < 0.5 ? 1 : 0)}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              自動フェード
            </button>
            <button
              onClick={() => {
                stopFade();
                if (deckA && deckB) applyMix(1, deckA.config, deckB.config);
              }}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-40"
            >
              Bに切替
            </button>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-white/40">
              {([1, 2, 4, 8] as const).map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => setFadeSeconds(seconds)}
                  className={`px-2 py-1 rounded-full ${fadeSeconds === seconds ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/60'}`}
                >
                  {seconds}s
                </button>
              ))}
            </span>
          </div>
        </div>
        {!onApplyConfig && <p className="text-[11px] text-white/35 mt-2">このビルドではデッキを適用できません。</p>}
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではステージ操作はできません。</p>}
    </section>
  );
};

const ModulationSection: React.FC<{
  isPublicLibrary: boolean;
}> = ({ isPublicLibrary }) => {
  const setup = useModulationSetup();
  const [nowSec, setNowSec] = React.useState(0);

  React.useEffect(() => {
    if (!setup.enabled) return;
    const id = window.setInterval(() => setNowSec(performance.now() / 1000), 120);
    return () => window.clearInterval(id);
  }, [setup.enabled]);

  const update = (next: ModulationSetup) => setModulationSetup(next);

  const setLfo = (index: number, patch: Partial<{ waveform: LfoWaveform; rate: number }>) => {
    update({ ...setup, lfos: setup.lfos.map((lfo, i) => (i === index ? { ...lfo, ...patch } : lfo)) });
  };

  const parseSource = (value: string): ModulationSource => {
    const [kind, rest] = value.split(/:(.*)/).filter(Boolean);
    return kind === 'audio'
      ? { kind: 'audio', band: rest as 'bass' | 'treble' | 'pulse' | 'bandA' | 'bandB' }
      : { kind: 'lfo', index: Number(rest) || 0 };
  };

  const sourceValue = (source: ModulationSource) =>
    source.kind === 'lfo' ? `lfo:${source.index}` : `audio:${source.band}`;

  const addRoute = () => {
    const route: ModulationRoute = {
      id: `route-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      source: { kind: 'lfo', index: 0 },
      target: 'layer2FlowSpeed',
      depth: 0.3,
    };
    update({ ...setup, enabled: true, routes: [...setup.routes, route] });
  };

  const addStarterRoutes = () => {
    const existing = new Set(setup.routes.map((route) => `${describeModulationSource(route.source)}->${route.target}`));
    const additions = createStarterModulationRoutes().filter(
      (route) => !existing.has(`${describeModulationSource(route.source)}->${route.target}`),
    );
    if (additions.length) update({ ...setup, enabled: true, routes: [...setup.routes, ...additions] });
  };

  const updateRoute = (id: string, patch: Partial<ModulationRoute>) => {
    update({ ...setup, routes: setup.routes.map((route) => (route.id === id ? { ...route, ...patch } : route)) });
  };

  const removeRoute = (id: string) => {
    update({ ...setup, routes: setup.routes.filter((route) => route.id !== id) });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';
  const tabOrder = ['global', 'layer1', 'layer2', 'layer3', 'ambient', 'audio'] as const;

  return (
    <section>
      <SectionTitle icon={<Activity size={12} />}>Modulation · モジュレーション</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        LFO（周期的な信号）や音声の帯域をパラメータに配線し、触っていない間もシーンを揺らし続ける仕組みです。変調は描画直前の実効値だけに重なり、プリセットや保存データは書き換えません。設定はこのブラウザに保存されます。一時停止中は変調も止まります。
      </p>
      <div className={isPublicLibrary ? 'pointer-events-none opacity-60' : ''}>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => update({ ...setup, enabled: !setup.enabled })}
            className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
              setup.enabled ? 'bg-white text-black hover:bg-gray-200' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {setup.enabled ? 'エンジン ON' : 'エンジン OFF'}
          </button>
          <button
            onClick={addStarterRoutes}
            className="px-4 py-2 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
          >
            おすすめセットを追加
          </button>
          {setup.routes.length > 0 && (
            <button
              onClick={() => update({ ...setup, routes: [] })}
              className="px-4 py-2 rounded-full text-white/35 text-[10px] uppercase tracking-widest hover:text-white/80"
            >
              全ルート削除
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {setup.lfos.map((lfo, index) => {
            const level = setup.enabled ? evaluateLfo(lfo, nowSec) : 0.5;
            return (
              <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold">LFO {index + 1}</span>
                  <span className="font-mono text-[10px] text-white/40">{level.toFixed(2)}</span>
                </div>
                <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                  <div className="h-full bg-white/80" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
                <select
                  value={lfo.waveform}
                  onChange={(event) => setLfo(index, { waveform: event.target.value as LfoWaveform })}
                  className={selectClass}
                  aria-label={`LFO ${index + 1} 波形`}
                >
                  {LFO_WAVEFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
                <Slider
                  label="Rate Hz"
                  value={lfo.rate}
                  min={0.01}
                  max={2}
                  step={0.01}
                  onChange={(v) => setLfo(index, { rate: v })}
                />
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          {setup.routes.map((route) => (
            <div key={route.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sourceValue(route.source)}
                  onChange={(event) => updateRoute(route.id, { source: parseSource(event.target.value) })}
                  className={selectClass}
                  aria-label="変調元"
                >
                  <optgroup label="LFO">
                    {setup.lfos.map((_, index) => (
                      <option key={index} value={`lfo:${index}`} className="bg-neutral-900">
                        LFO {index + 1}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="音声">
                    {AUDIO_BAND_OPTIONS.map((option) => (
                      <option key={option.value} value={`audio:${option.value}`} className="bg-neutral-900">
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <select
                  value={route.target}
                  onChange={(event) => updateRoute(route.id, { target: event.target.value as ModulationRoute['target'] })}
                  className={selectClass}
                  aria-label="変調先パラメータ"
                >
                  {tabOrder.map((tab) => (
                    <optgroup key={tab} label={TAB_SHORT_LABELS[tab] ?? tab}>
                      {PARAMETER_CATALOG.filter((entry) => entry.tab === tab).map((entry) => (
                        <option key={`${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                <Slider
                  label="深さ Depth"
                  value={route.depth}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(v) => updateRoute(route.id, { depth: v })}
                />
                <button
                  onClick={() => removeRoute(route.id)}
                  className="mt-4 text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={addRoute}
            className="w-full py-2 rounded-xl border border-dashed border-white/20 text-white/60 text-[11px] hover:bg-white/5 transition-colors"
          >
            ＋ ルートを追加（信号 → パラメータ）
          </button>
        </div>
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではモジュレーションを編集できません。</p>}
    </section>
  );
};


const PromptDraftSection: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onApplyConfig, onSaveBredPreset }) => {
  const [text, setText] = React.useState('');
  const [drafts, setDrafts] = React.useState<PromptDraft[]>([]);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [savedNames, setSavedNames] = React.useState<Set<string>>(new Set());

  const generate = () => {
    const result = generatePromptDrafts(text, presets, config);
    setDrafts(result.drafts);
    setNotes(result.notes);
    setSavedNames(new Set());
  };

  return (
    <section>
      <SectionTitle icon={<Sparkles size={12} />}>Prompt Draft · 言葉からプリセット</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-3">
        言葉でイメージを書くと、叩き台プリセットを3件作ります。外部AIは使わず、運動の語彙（渦・雲・結晶…）と気分の語彙（儚い・激しい・静か…）をローカルで解釈して、既存プリセットを土台にマクロを当て、種つき変異を加えたものです。解釈内容はすべて下に表示されます。
      </p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') generate(); }}
          placeholder="例: 渦巻いて上昇する儚い雲"
          className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-xs outline-none focus:border-white/40"
        />
        <button
          onClick={generate}
          className="shrink-0 px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
        >
          叩き台を生成
        </button>
      </div>
      {notes.length > 0 && (
        <ul className="mb-3 space-y-0.5">
          {notes.map((note) => (
            <li key={note} className="text-[10px] text-white/40">・{note}</li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        {drafts.map((draft) => {
          const isSaved = savedNames.has(draft.name);
          return (
            <div key={draft.name} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span className="min-w-0 truncate text-[11px] font-medium">{draft.name}</span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => onApplyConfig?.(draft.config)}
                  disabled={!onApplyConfig}
                  className="px-2.5 py-1 rounded-full border border-white/20 text-[9px] uppercase tracking-wider text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => {
                    onSaveBredPreset?.(draft.config, draft.name);
                    setSavedNames((prev) => new Set(prev).add(draft.name));
                  }}
                  disabled={isPublicLibrary || isSaved || !onSaveBredPreset}
                  className="px-2.5 py-1 rounded-full bg-white text-black text-[9px] font-bold uppercase tracking-wider disabled:opacity-40"
                >
                  {isSaved ? '保存済み' : '保存'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const GraphSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  updateMotionArray?: ControlPanelContentProps['updateMotionArray'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, updateMotionArray, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layout, setLayout] = React.useState(() =>
    loadGraphLayout(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [sizes, setSizes] = React.useState<Partial<Record<GraphNodeId, { w: number; h: number }>>>({});
  const canvasRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const next: Partial<Record<GraphNodeId, { w: number; h: number }>> = {};
    root.querySelectorAll<HTMLElement>('[data-gnode]').forEach((el) => {
      const id = el.dataset.gnode as GraphNodeId;
      next[id] = { w: el.offsetWidth, h: el.offsetHeight };
    });
    setSizes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layout, config]);

  const startDrag = (id: GraphNodeId) => (event: React.PointerEvent) => {
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = layout[id];
    const onMove = (ev: PointerEvent) => {
      setLayout((prev) => ({
        ...prev,
        [id]: { x: Math.max(0, origin.x + ev.clientX - startX), y: Math.max(0, origin.y + ev.clientY - startY) },
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLayout((prev) => {
        saveGraphLayout(window.localStorage, prev);
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetLayout = () => {
    setLayout({ ...DEFAULT_GRAPH_LAYOUT });
    saveGraphLayout(window.localStorage, { ...DEFAULT_GRAPH_LAYOUT });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';

  const paramSlider = (key: keyof ParticleConfig) => {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === key);
    const value = config[key];
    if (!entry || typeof value !== 'number') return null;
    return (
      <Slider
        key={key}
        label={entry.label}
        value={value}
        min={entry.min}
        max={entry.max}
        step={entry.step}
        onChange={(v) => write(key, v)}
      />
    );
  };

  const selectField = (key: keyof ParticleConfig, options: GraphOption[]) => (
    <select
      value={String(config[key])}
      onChange={(event) => write(key, event.target.value)}
      className={selectClass}
      aria-label={key}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-neutral-900">
          {option.label}
        </option>
      ))}
    </select>
  );

  const motionSelect = (key: 'layer2Type' | 'layer3Type') => (
    <select value={String(config[key])} onChange={(event) => write(key, event.target.value)} className={selectClass} aria-label={key}>
      {MOTION_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.ids.map((id) => (
            <option key={id} value={id} className="bg-neutral-900">
              {id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );


  const motionMixEditor = (layer: 2 | 3) => {
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const countKey = (layer === 2 ? 'layer2SourceCount' : 'layer3SourceCount') as 'layer2SourceCount' | 'layer3SourceCount';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixOn = Boolean(config[mixKey]);
    const sourceCount = Math.max(1, Math.min(8, Math.round(Number(config[countKey]) || 1)));
    const motions = config[motionsKey] as readonly string[];
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Mix · 発生源ごとの動き</span>
          <button
            onClick={() => write(mixKey, !mixOn)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${mixOn ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {mixOn ? 'On' : 'Off'}
          </button>
        </div>
        {mixOn && (
          <div className="mt-1.5 space-y-1">
            {Array.from({ length: sourceCount }, (_, index) => (
              <select
                key={index}
                value={String(motions[index] ?? config[typeKey])}
                onChange={(event) => updateMotionArray?.(motionsKey, index, event.target.value as Layer2Type)}
                className={selectClass}
                aria-label={`${motionsKey}[${index}]`}
              >
                {MOTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.ids.map((id) => (
                      <option key={id} value={id} className="bg-neutral-900">{id}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
            <p className="text-[9px] leading-relaxed text-white/35">発生源ごとに別の運動を配線します（エンジン標準の MotionMix）。</p>
          </div>
        )}
      </div>
    );
  };

  const motionChainEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionChainEnabled' : 'layer3MotionChainEnabled') as 'layer2MotionChainEnabled' | 'layer3MotionChainEnabled';
    const chainKey = (layer === 2 ? 'layer2MotionChain' : 'layer3MotionChain') as 'layer2MotionChain' | 'layer3MotionChain';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const chainOn = Boolean(config[enabledKey]);
    const chain = (config[chainKey] as readonly Layer2Type[]) ?? [];
    const stage1Types: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = stage1Types.some((type) => type && isDedicatedSystemMotionType(type));
    const hasPlacement = chain.some((entry) => isPlacementMotionType(entry));
    const setStage = (stageIndex: number, value: string) => {
      const next: (Layer2Type | null)[] = [chain[0] ?? null, chain[1] ?? null];
      next[stageIndex] = value === '' ? null : (value as Layer2Type);
      if (next[0] === null) next[1] = null;
      write(chainKey, next.filter((entry): entry is Layer2Type => entry !== null));
    };
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Chain · 直列チェーン</span>
          <button
            onClick={() => write(enabledKey, !chainOn)}
            disabled={dedicated}
            title={dedicated ? '第1段が専用システム系のため使えません' : ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${chainOn ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${dedicated ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {chainOn ? 'On' : 'Off'}
          </button>
        </div>
        {dedicated ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">第1段が専用システム系（堆積・成長・体積）のため、このレイヤーではチェーンを使えません。</p>
        ) : chainOn ? (
          <div className="mt-1.5 space-y-1">
            {[0, 1].map((stageIndex) => (
              <select
                key={stageIndex}
                value={String(chain[stageIndex] ?? '')}
                onChange={(event) => setStage(stageIndex, event.target.value)}
                disabled={stageIndex > 0 && !chain[0]}
                className={selectClass}
                aria-label={`${chainKey}[${stageIndex}]`}
              >
                <option value="" className="bg-neutral-900">Stage {stageIndex + 2} · — None —</option>
                {MOTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.ids.map((id) => (
                      <option key={id} value={id} className="bg-neutral-900">{id}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
            <p className="text-[9px] leading-relaxed text-white/35">第1段の出力に次のモーションを直列で重ねます（最大3段）。</p>
            {hasPlacement && (
              <p className="text-[9px] leading-relaxed text-white/35">配置系のモーションは前段の形状をそのまま変位させるのではなく、再配置します。</p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const routeEditor = (layer: 2 | 3, kind: 'motion' | 'source') => {
    const other = (layer === 2 ? 3 : 2) as 2 | 3;
    const enabledKey = (layer === 2
      ? (kind === 'motion' ? 'layer2MotionRouteEnabled' : 'layer2SourceRouteEnabled')
      : (kind === 'motion' ? 'layer3MotionRouteEnabled' : 'layer3SourceRouteEnabled')) as 'layer2MotionRouteEnabled' | 'layer3MotionRouteEnabled' | 'layer2SourceRouteEnabled' | 'layer3SourceRouteEnabled';
    const fromKey = (layer === 2
      ? (kind === 'motion' ? 'layer2MotionRouteFrom' : 'layer2SourceRouteFrom')
      : (kind === 'motion' ? 'layer3MotionRouteFrom' : 'layer3SourceRouteFrom')) as 'layer2MotionRouteFrom' | 'layer3MotionRouteFrom' | 'layer2SourceRouteFrom' | 'layer3SourceRouteFrom';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const otherTypeKey = (other === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const otherMixKey = (other === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const on = Boolean(config[enabledKey]);
    const from = (config[fromKey] as 'layer2' | 'layer3' | null) ?? null;
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const ownDedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    const sourceDedicated = kind === 'motion' && isDedicatedSystemMotionType(config[otherTypeKey] as Layer2Type);
    const disabledReason = ownDedicated
      ? '第1段が専用システム系（堆積・成長・体積）のため、このレイヤーでは使えません。'
      : sourceDedicated
        ? 'ルーティング元の第1段が専用システム系のため、借りられるモーションスタックがありません。'
        : null;
    const otherValue = `layer${other}` as 'layer2' | 'layer3';
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">{kind === 'motion' ? 'Motion Route · モーション経路' : 'Source Route · ソース形状'}</span>
          <button
            onClick={() => write(enabledKey, !on)}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${disabledReason ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {disabledReason ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">{disabledReason}</p>
        ) : on ? (
          <div className="mt-1.5 space-y-1">
            <select
              value={from ?? ''}
              onChange={(event) => write(fromKey, event.target.value === '' ? null : (event.target.value as 'layer2' | 'layer3'))}
              className={selectClass}
              aria-label={fromKey}
            >
              <option value="" className="bg-neutral-900">From · — None —</option>
              <option value={otherValue} className="bg-neutral-900">Layer {other}</option>
            </select>
            {kind === 'motion' ? (
              <p className="text-[9px] leading-relaxed text-white/35">
                相手レイヤーのモーションスタック（第1段＋チェーン）を、そのパラメータのまま自レイヤーの前段に実行します。
                {config[otherMixKey] ? 'ルーティング元が Mix のため、主タイプ（Type）が使われます。' : ''}
              </p>
            ) : (
              <p className="text-[9px] leading-relaxed text-white/35">粒子の初期配置（形・ソース配置・メディアマップ）を相手レイヤーのソース設定で生成します。粒子数やモーションは自レイヤーのままです。</p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const motionGraphEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionGraphEnabled' : 'layer3MotionGraphEnabled') as 'layer2MotionGraphEnabled' | 'layer3MotionGraphEnabled';
    const graphKey = (layer === 2 ? 'layer2MotionGraph' : 'layer3MotionGraph') as 'layer2MotionGraph' | 'layer3MotionGraph';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const on = Boolean(config[enabledKey]);
    const steps = (config[graphKey] as readonly MotionGraphStep[]) ?? [];
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    const patch = (index: number, part: Partial<MotionGraphStep>) => {
      write(graphKey, steps.map((step, i) => (i === index ? { ...step, ...part } : step)));
    };
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Graph · モーショングラフ</span>
          <button
            onClick={() => write(enabledKey, !on)}
            disabled={dedicated}
            title={dedicated ? '第1段が専用システム系のため使えません' : ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${dedicated ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {dedicated ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">第1段が専用システム系（堆積・成長・体積）のため、このレイヤーではグラフを使えません。</p>
        ) : on ? (
          <div className="mt-1.5 space-y-1.5">
            {steps.map((step, index) => (
              <div key={index} className="space-y-1 rounded border border-white/10 p-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-white/40">Step {index + 1}</span>
                  <span className="flex gap-1">
                    <button onClick={() => patch(index, { saveBranch: !step.saveBranch })} className={`px-1.5 py-0.5 rounded text-[8px] ${step.saveBranch ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/50'}`}>branch保存</button>
                    <button onClick={() => write(graphKey, steps.filter((_, i) => i !== index))} className="px-1.5 py-0.5 rounded bg-white/10 text-[8px]">✕</button>
                  </span>
                </div>
                <select value={step.motion} onChange={(event) => patch(index, { motion: event.target.value as Layer2Type })} className={selectClass} aria-label={`${graphKey}[${index}].motion`}>
                  {MOTION_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.ids.map((id) => (
                        <option key={id} value={id} className="bg-neutral-900">{id}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex gap-1">
                  <select value={step.input} onChange={(event) => patch(index, { input: event.target.value as MotionGraphStep['input'] })} className={selectClass} aria-label={`${graphKey}[${index}].input`}>
                    <option value="prev" className="bg-neutral-900">prev</option>
                    <option value="source" className="bg-neutral-900">source</option>
                    <option value="branch" className="bg-neutral-900">branch</option>
                  </select>
                  <select value={String(step.blend)} onChange={(event) => patch(index, { blend: Number(event.target.value) })} className={selectClass} aria-label={`${graphKey}[${index}].blend`}>
                    {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                      <option key={v} value={String(v)} className="bg-neutral-900">blend {v}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {steps.length < 8 && (
              <button onClick={() => write(graphKey, [...steps, { motion: 'flow', input: 'prev', blend: 1, saveBranch: false }])} className="w-full py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest">
                + Step（最大8）
              </button>
            )}
            <p className="text-[9px] leading-relaxed text-white/35">スタックの後段で動くステップ列。branch 保存で分岐し、source / branch から合流できます。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const positionFeedbackEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2PositionFeedbackEnabled' : 'layer3PositionFeedbackEnabled') as 'layer2PositionFeedbackEnabled' | 'layer3PositionFeedbackEnabled';
    const feedbackKey = (layer === 2 ? 'layer2PositionFeedback' : 'layer3PositionFeedback') as 'layer2PositionFeedback' | 'layer3PositionFeedback';
    const decayKey = (layer === 2 ? 'layer2PositionFeedbackDecay' : 'layer3PositionFeedbackDecay') as 'layer2PositionFeedbackDecay' | 'layer3PositionFeedbackDecay';
    const on = Boolean(config[enabledKey]);
    const feedback = typeof config[feedbackKey] === 'number' ? (config[feedbackKey] as number) : 0.85;
    const decay = typeof config[decayKey] === 'number' ? (config[decayKey] as number) : 0.1;
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Position Feedback · 位置フィードバック</span>
          <button
            onClick={() => write(enabledKey, !on)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {on ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              feedback
              <input type="range" min={0} max={1} step={0.05} value={feedback} onChange={(event) => write(feedbackKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{feedback.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              decay
              <input type="range" min={0} max={1} step={0.05} value={decay} onChange={(event) => write(decayKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{decay.toFixed(2)}</span>
            </label>
            <p className="text-[9px] leading-relaxed text-white/35">前フレームの位置を引きずる方式C。点の描画のみ・決定的書き出しでは自動無効。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const warpEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2WarpEnabled' : 'layer3WarpEnabled') as 'layer2WarpEnabled' | 'layer3WarpEnabled';
    const amountKey = (layer === 2 ? 'layer2WarpAmount' : 'layer3WarpAmount') as 'layer2WarpAmount' | 'layer3WarpAmount';
    const scaleKey = (layer === 2 ? 'layer2WarpScale' : 'layer3WarpScale') as 'layer2WarpScale' | 'layer3WarpScale';
    const on = Boolean(config[enabledKey]);
    const amount = typeof config[amountKey] === 'number' ? (config[amountKey] as number) : 18;
    const scale = typeof config[scaleKey] === 'number' ? (config[scaleKey] as number) : 0.012;
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Domain Warp · ドメインワープ</span>
          <button
            onClick={() => write(enabledKey, !on)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {on ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              amount
              <input type="range" min={0} max={60} step={1} value={amount} onChange={(event) => write(amountKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{amount.toFixed(0)}</span>
            </label>
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              scale
              <input type="range" min={0.002} max={0.05} step={0.001} value={scale} onChange={(event) => write(scaleKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{scale.toFixed(3)}</span>
            </label>
            <p className="text-[9px] leading-relaxed text-white/35">入力空間をノイズで歪めてから全モーション段を評価する。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const motionDagEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionDagEnabled' : 'layer3MotionDagEnabled') as 'layer2MotionDagEnabled' | 'layer3MotionDagEnabled';
    const dagKey = (layer === 2 ? 'layer2MotionDag' : 'layer3MotionDag') as 'layer2MotionDag' | 'layer3MotionDag';
    const outputKey = (layer === 2 ? 'layer2MotionDagOutput' : 'layer3MotionDagOutput') as 'layer2MotionDagOutput' | 'layer3MotionDagOutput';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    return (
      <PlayDagSection
        enabled={Boolean(config[enabledKey])}
        nodes={[...((config[dagKey] as readonly MotionDagNode[]) ?? [])]}
        output={typeof config[outputKey] === 'number' ? (config[outputKey] as number) : -1}
        dedicated={dedicated}
        onToggle={(v) => write(enabledKey, v)}
        onChange={(next) => write(dagKey, next)}
        onOutputChange={(next) => write(outputKey, next)}
        layoutKey={`layer${layer}`}
      />
    );
  };

  const nodeCard = (
    id: GraphNodeId,
    title: string,
    stage: string,
    enabled: boolean | null,
    enabledKey: keyof ParticleConfig | null,
    dimmed: boolean,
    children: React.ReactNode,
  ) => {
    const pos = layout[id];
    return (
      <div
        data-gnode={id}
        className={`absolute rounded-xl border border-white/12 bg-[#101014]/95 shadow-lg ${dimmed ? 'opacity-55' : ''}`}
        style={{ left: pos.x, top: pos.y, width: GRAPH_NODE_WIDTH }}
      >
        <div
          onPointerDown={startDrag(id)}
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 cursor-move select-none touch-none"
        >
          <span className="text-[11px] font-semibold tracking-wide">{title}</span>
          <span className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-widest text-white/40">{stage}</span>
            {enabled !== null && enabledKey && (
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => write(enabledKey, !enabled)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${
                  enabled ? 'bg-white text-black' : 'bg-white/10 text-white/50'
                }`}
              >
                {enabled ? 'On' : 'Off'}
              </button>
            )}
          </span>
        </div>
        <div className={`p-2.5 ${isPublicLibrary ? 'pointer-events-none opacity-60' : ''}`}>{children}</div>
      </div>
    );
  };

  const edgePath = (from: GraphNodeId, to: GraphNodeId) => {
    const a = layout[from];
    const b = layout[to];
    const ah = sizes[from]?.h ?? 120;
    const bh = sizes[to]?.h ?? 120;
    const x1 = a.x + GRAPH_NODE_WIDTH;
    const y1 = a.y + ah / 2;
    const x2 = b.x;
    const y2 = b.y + bh / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const layer2Off = !config.layer2Enabled;
  const layer3Off = !config.layer3Enabled;

  return (
    <section>
      <SectionTitle icon={<Network size={12} />}>Node Graph · ノードグラフ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        シーンの構成をノードのつながりとして見る編集画面です。各レイヤーは「発生源（Source）→
        動き（Motion）→ 描画（Render）」の直列で、全レイヤーが出力に合流します。ノード内のプルダウンとスライダーは通常のパネルと同じ設定を直接書き換えます（プリセットや保存データの形式は変わりません）。ノードは見出しをドラッグして並べ替えでき、配置はこのブラウザに保存されます。配線の順序そのものはエンジンの構造で固定です。
      </p>
      <div
        ref={canvasRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10"
        style={{
          height: 668,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.13) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundColor: 'rgba(255,255,255,0.02)',
        }}
      >
        <svg className="absolute inset-0 h-full w-full pointer-events-none">
          {GRAPH_EDGES.map(([from, to]) => (
            <path key={`${from}-${to}`} d={edgePath(from, to)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
          ))}
        </svg>
        {nodeCard('l2-source', 'Layer 2', 'Source', config.layer2Enabled, 'layer2Enabled', layer2Off, (
          <div className="space-y-1">
            {selectField('layer2Source', GRAPH_SOURCE_OPTIONS)}
            {paramSlider('layer2SourceSpread')}
            {routeEditor(2, 'source')}
          </div>
        ))}
        {nodeCard('l2-motion', 'Layer 2', 'Motion', null, null, layer2Off, (
          <div className="space-y-1">
            {motionSelect('layer2Type')}
            {paramSlider('layer2FlowSpeed')}
            {paramSlider('layer2Complexity')}
            {motionMixEditor(2)}
            {motionChainEditor(2)}
            {routeEditor(2, 'motion')}
            {motionGraphEditor(2)}
            {motionDagEditor(2)}
            {positionFeedbackEditor(2)}
            {warpEditor(2)}
          </div>
        ))}
        {nodeCard('l2-render', 'Layer 2', 'Render', null, null, layer2Off, (
          <div className="space-y-1">
            {selectField('layer2SpriteMode', GRAPH_SPRITE_OPTIONS)}
            {selectField('layer2ConnectionStyle', GRAPH_CONNECTION_OPTIONS)}
            {paramSlider('layer2Count')}
            {paramSlider('layer2BaseSize')}
          </div>
        ))}
        {nodeCard('l3-source', 'Layer 3', 'Source', config.layer3Enabled, 'layer3Enabled', layer3Off, (
          <div className="space-y-1">
            {selectField('layer3Source', GRAPH_SOURCE_OPTIONS)}
            {paramSlider('layer3SourceSpread')}
            {routeEditor(3, 'source')}
          </div>
        ))}
        {nodeCard('l3-motion', 'Layer 3', 'Motion', null, null, layer3Off, (
          <div className="space-y-1">
            {motionSelect('layer3Type')}
            {paramSlider('layer3FlowSpeed')}
            {paramSlider('layer3Complexity')}
            {motionMixEditor(3)}
            {motionChainEditor(3)}
            {routeEditor(3, 'motion')}
            {motionGraphEditor(3)}
            {motionDagEditor(3)}
            {positionFeedbackEditor(3)}
            {warpEditor(3)}
          </div>
        ))}
        {nodeCard('l3-render', 'Layer 3', 'Render', null, null, layer3Off, (
          <div className="space-y-1">
            {selectField('layer3SpriteMode', GRAPH_SPRITE_OPTIONS)}
            {selectField('layer3ConnectionStyle', GRAPH_CONNECTION_OPTIONS)}
            {paramSlider('layer3Count')}
            {paramSlider('layer3BaseSize')}
          </div>
        ))}
        {nodeCard('l1-core', 'Layer 1 · Core', 'SDF', config.layer1Enabled, 'layer1Enabled', !config.layer1Enabled, (
          <div className="space-y-1">
            {paramSlider('layer1Count')}
            {paramSlider('layer1SourceCount')}
            {paramSlider('layer1SourceSpread')}
          </div>
        ))}
        {nodeCard('gpgpu', 'GPGPU', 'Compute', config.gpgpuEnabled, 'gpgpuEnabled', !config.gpgpuEnabled, (
          <div className="space-y-1">
            {selectField('gpgpuEmitShape', GRAPH_EMIT_SHAPE_OPTIONS)}
            {paramSlider('gpgpuBounceRadius')}
            {paramSlider('gpgpuSeed')}
          </div>
        ))}
        {nodeCard('output', 'Output', 'Composite', null, null, false, (
          <p className="text-[11px] leading-relaxed text-white/50">
            全レイヤーを合成して描画します。ポストFX（残像・発光など）の調整は FX タブ側です。このノードは構成の終端を示す表示専用です。
          </p>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button onClick={resetLayout} className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest">
          ノード配置をリセット
        </button>
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではノードからの編集はできません。</p>}
    </section>
  );
};

const ExportSection: React.FC<{
  captureRef?: React.RefObject<PointCloudCaptureState>;
}> = ({ captureRef }) => {
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [svgPlane, setSvgPlane] = React.useState<SvgPlane>('xy');
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  const requestExport = (format: 'ply' | 'svg') => {
    const state = captureRef?.current;
    if (!state) {
      setStatus('書き出しチャネルが接続されていません。');
      return;
    }
    if (busy) return;
    state.requested = true;
    setBusy(true);
    setStatus('現在の粒子位置を取得しています…');
    const startedAt = state.capturedAt;
    let tries = 0;
    timerRef.current = window.setInterval(() => {
      tries++;
      if (state.capturedAt !== startedAt && state.buffer.current) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setBusy(false);
        const data = state.buffer.current;
        const count = countExportablePoints(data);
        if (count === 0) {
          setStatus('有効な粒子位置が取得できませんでした。');
          return;
        }
        let contents: string;
        let filename: string;
        let mime: string;
        if (format === 'ply') {
          contents = buildPlyPointCloud(data);
          filename = 'monosphere-particles.ply';
          mime = 'application/octet-stream';
        } else {
          const built = buildSvgPointCloud(data, { plane: svgPlane });
          contents = built.svg;
          filename = svgPlane === 'xy' ? 'monosphere-particles-front.svg' : 'monosphere-particles-top.svg';
          mime = 'image/svg+xml';
        }
        const blob = new Blob([contents], { type: mime });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        setStatus(
          format === 'ply'
            ? `${count.toLocaleString()} 点を PLY に書き出しました（位置 + 年齢）。`
            : `${count.toLocaleString()} 点を SVG に書き出しました（${svgPlane === 'xy' ? '前面 XY' : '上面 XZ'}投影、年齢で濃淡）。`,
        );
        return;
      }
      if (tries >= 20) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setBusy(false);
        setStatus('位置を取得できませんでした。GPGPU系の表示（粒子・メタボール等）が有効な状態でお試しください。WebGPU計算が有効な場合は WebGL 経路では書き出せません。');
      }
    }, 200);
  };

  return (
    <section>
      <SectionTitle icon={<FileDown size={12} />}>Export · 書き出し</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        いま表示している GPGPU 粒子の位置を書き出します。PLY は点群（位置＋年齢）で Blender や MeshLab、TouchDesigner などに持ち込めます。SVG は粒子を点として投影したベクター画像で、前面（XY）／上面（XZ）が選べ、年齢が濃淡になります。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => requestExport('ply')}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'PLY書き出し（GPGPU粒子）'}
        </button>
        <button
          onClick={() => requestExport('svg')}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'SVG書き出し'}
        </button>
        <select
          value={svgPlane}
          onChange={(event) => setSvgPlane(event.target.value as SvgPlane)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value="xy" className="bg-neutral-900">前面（XY）</option>
          <option value="xz" className="bg-neutral-900">上面（XZ）</option>
        </select>
      </div>
      {status && <p className="text-[11px] text-white/55 mt-3">{status}</p>}
      <DeterministicRenderControls />
    </section>
  );
};

const KeyboardShortcutsSection: React.FC = () => (
  <section>
    <SectionTitle icon={<Keyboard size={12} />}>Keyboard Shortcuts · ショートカット</SectionTitle>
    <ul className="space-y-1.5 text-[11px] leading-relaxed text-white/55">
      <li><span className="font-mono text-white/85">Space</span> — 再生 / 一時停止</li>
      <li><span className="font-mono text-white/85">[</span> / <span className="font-mono text-white/85">]</span> — 前 / 次のプリセット（棚の並び順）</li>
      <li><span className="font-mono text-white/85">F</span> — 全画面表示の切り替え</li>
      <li><span className="font-mono text-white/85">B</span> — コントロールシートの開閉</li>
    </ul>
    <p className="mt-3 text-[11px] leading-relaxed text-white/45">
      入力欄にフォーカスがある間はショートカットは効きません。
    </p>
  </section>
);

const DeterministicRenderControls: React.FC = () => {
  const [seconds, setSeconds] = React.useState(3);
  const [fps, setFps] = React.useState(24);
  const [format, setFormat] = React.useState<'zip' | VideoFormat>('zip');
  const [renderStatus, setRenderStatus] = React.useState('');
  const [rendering, setRendering] = React.useState(false);
  const frames = Math.min(MAX_DETERMINISTIC_FRAMES, Math.max(1, Math.round(seconds * fps)));

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const startRender = async () => {
    if (rendering) return;
    setRendering(true);
    setRenderStatus('決定的レンダリングを開始します…');
    try {
      if (format === 'zip') {
        const zip = await renderDeterministicSequence({ fps, frames }, (done, total) => {
          setRenderStatus(`レンダリング中… ${done} / ${total} フレーム`);
        });
        download(zip, 'monosphere-frames.zip');
        setRenderStatus(
          `${frames} フレームを ZIP に書き出しました（${fps}fps 固定ステップ）。ffmpeg -framerate ${fps} -i frame-%04d.png などで動画化できます。`,
        );
      } else {
        const video = await renderDeterministicVideo({ fps, frames }, format, (done, total) => {
          setRenderStatus(`レンダリング／エンコード中… ${done} / ${total} フレーム`);
        });
        download(video, `monosphere-render.${format}`);
        setRenderStatus(
          `${frames} フレームを ${format.toUpperCase()} 動画に書き出しました（${fps}fps 固定ステップ・フレーム時刻ちょうど）。`,
        );
      }
    } catch (error) {
      if (error instanceof VideoEncodeUnsupportedError) {
        setRenderStatus('このブラウザではその動画形式のエンコード（WebCodecs）に対応していません。PNG連番（ZIP）なら書き出せます。');
      } else {
        setRenderStatus('レンダリングに失敗しました。シーンが表示されている状態でもう一度お試しください。');
      }
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <p className="text-[11px] font-semibold tracking-wide">Deterministic Render · 決定的レンダリング</p>
      <p className="text-[11px] leading-relaxed text-white/45">
        シーンを初期状態に組み直し、時計を 0 に戻して、1フレーム = 1/{fps} 秒の固定ステップで進めながら PNG 連番を書き出します。機械の速さに依存せず、フレーム i は常にシミュレーション時刻 (i+1)/{fps} 秒の絵になります（通常の動画書き出しは実時間録画のため再現しません）。GPGPU の初期状態はシードで決まります。時間で動くオーバーレイ（テンポラルプロファイル／モジュレーション／音反応）は再現の範囲外なので、厳密な再現が必要なときは切ってください。GPUシミュレーションの粒子単位の完全一致は GPU の浮動小数点の決定性にも依存します（ソフトウェアGL環境では形状・個数・タイミングが一致しても粒子単位で数%ずれることを確認済み）。
      </p>
      <Slider label="Seconds · 長さ（秒）" value={seconds} min={1} max={8} step={1} onChange={setSeconds} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">FPS</span>
        {([12, 24, 30] as const).map((option) => (
          <button
            key={option}
            onClick={() => setFps(option)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${fps === option ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-white/40">{frames} frames</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">形式</span>
        {([
          { val: 'zip', label: 'PNG連番 ZIP' },
          { val: 'webm', label: 'WebM 動画' },
          { val: 'mp4', label: 'MP4 動画' },
        ] as const).map((option) => (
          <button
            key={option.val}
            onClick={() => setFormat(option.val)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${format === option.val ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        onClick={startRender}
        disabled={rendering}
        className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
      >
        {rendering ? 'レンダリング中…' : format === 'zip' ? 'PNG連番を書き出す（ZIP）' : `${format.toUpperCase()} 動画を書き出す`}
      </button>
      {renderStatus && <p className="text-[11px] text-white/55">{renderStatus}</p>}
    </div>
  );
};

const PERFORMANCE_MAX_MS = 120_000;
const PERFORMANCE_SAMPLE_MS = 150;

const PerformanceSection: React.FC<{
  config: ParticleConfig;
  onApplyConfig?: ControlPanelContentProps['onApplyConfig'];
}> = ({ config, onApplyConfig }) => {
  const [isRecording, setIsRecording] = React.useState(false);
  const [take, setTake] = React.useState<PerformanceTake | null>(null);
  const [recordElapsed, setRecordElapsed] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [loop, setLoop] = React.useState(true);
  const [playhead, setPlayhead] = React.useState(0);
  const [interpolate, setInterpolate] = React.useState(true);
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportNote, setExportNote] = React.useState('');
  const takeFileRef = React.useRef<HTMLInputElement | null>(null);

  const configRef = React.useRef(config);
  configRef.current = config;
  const recorderRef = React.useRef<PerformanceRecorder | null>(null);
  const recordStartRef = React.useRef(0);
  const playheadRef = React.useRef(0);
  playheadRef.current = playhead;

  const stopRecording = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const elapsed = Math.min(performance.now() - recordStartRef.current, PERFORMANCE_MAX_MS);
    recorder.sample(configRef.current, elapsed);
    setTake(recorder.finish(elapsed));
    recorderRef.current = null;
    setIsRecording(false);
    setPlayhead(0);
  }, []);

  React.useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      const t = performance.now() - recordStartRef.current;
      if (t >= PERFORMANCE_MAX_MS) {
        stopRecording();
        return;
      }
      recorder.sample(configRef.current, t);
      setRecordElapsed(t);
    }, PERFORMANCE_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [isRecording, stopRecording]);

  React.useEffect(() => {
    if (!isPlaying || !take || !onApplyConfig) return;
    const playback = {
      startStamp: performance.now(),
      startOffset: playheadRef.current >= take.durationMs ? 0 : playheadRef.current,
      lastIndex: -2,
    };
    if (playback.startOffset === 0) onApplyConfig(take.base);
    const timer = window.setInterval(() => {
      let t = playback.startOffset + (performance.now() - playback.startStamp);
      if (t >= take.durationMs) {
        if (loop && take.durationMs > 0) {
          onApplyConfig(take.base);
          playback.startStamp = performance.now();
          playback.startOffset = 0;
          playback.lastIndex = -2;
          t = 0;
        } else {
          setPlayhead(take.durationMs);
          setIsPlaying(false);
          return;
        }
      }
      setPlayhead(t);
      const index = frameIndexAt(take, t);
      if (interpolate) {
        // Interpolated playback: numeric keys move continuously, so the
        // config is applied on every tick, not only at keyframes.
        if (index >= 0) onApplyConfig(reconstructInterpolatedAt(take, t));
        playback.lastIndex = index;
      } else if (index !== playback.lastIndex) {
        playback.lastIndex = index;
        if (index >= 0) onApplyConfig(reconstructAt(take, t));
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [isPlaying, take, loop, onApplyConfig, interpolate]);

  const startRecording = () => {
    recorderRef.current = new PerformanceRecorder(configRef.current);
    recordStartRef.current = performance.now();
    setRecordElapsed(0);
    setIsPlaying(false);
    setIsRecording(true);
  };

  const scrub = (value: number) => {
    if (!take || !onApplyConfig) return;
    setIsPlaying(false);
    setPlayhead(value);
    onApplyConfig(interpolate ? reconstructInterpolatedAt(take, value) : reconstructAt(take, value));
  };

  const handleExportTake = () => {
    if (!take) return;
    const blob = new Blob([serializeTake(take)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kalokagathia_take_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTake = async (file: File) => {
    const parsed = parseTake(await file.text());
    if (!parsed) {
      setExportNote('テイクファイルを読み込めませんでした');
      return;
    }
    setIsPlaying(false);
    setTake(parsed);
    setPlayhead(0);
    setExportNote(`テイクを読み込みました（${parsed.frames.length} フレーム）`);
  };

  // Export the take through the deterministic render pipeline: the take
  // drives the config at exact frame timestamps while the scene is
  // stepped with a fixed timestep, producing a PNG sequence ZIP.
  const handleDeterministicExport = async () => {
    if (!take || !onApplyConfig || exportBusy) return;
    setExportBusy(true);
    setExportNote('');
    try {
      onApplyConfig(take.base);
      const fps = 30;
      const frames = Math.min(MAX_DETERMINISTIC_FRAMES, Math.max(1, Math.ceil((take.durationMs / 1000) * fps)));
      const zip = await renderDeterministicSequence(
        {
          fps,
          frames,
          applyAt: (tSec: number) => onApplyConfig(reconstructInterpolatedAt(take, tSec * 1000)),
        },
        (done, total) => setExportNote(`決定論的書き出し中 ${done}/${total}`),
      );
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kalokagathia_take_frames_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(`決定論的書き出しが完了しました（${frames} フレーム / 30fps${frames >= MAX_DETERMINISTIC_FRAMES ? '、上限で打ち切り' : ''}）`);
    } catch {
      setExportNote('決定論的書き出しに失敗しました');
    } finally {
      setExportBusy(false);
    }
  };

  const formatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const canPlay = Boolean(take && take.frames.length > 0 && onApplyConfig);

  return (
    <section>
      <SectionTitle icon={<Video size={12} />}>Performance · 演奏の記録</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        マクロや XY パッド、MIDI、プリセット切替の動きをそのまま録画して、再生・スクラブできます（最大2分）。キーフレームの時刻変更・削除ができるタイムライン編集、補間再生、テイクの JSON 書き出し/読み込み、決定論的レンダリングでの PNG 連番書き出しに対応します。
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {!isRecording ? (
          <button
            onClick={startRecording}
            className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
          >
            ● 録画開始
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-4 py-2 rounded-full bg-red-400 text-black text-[10px] font-bold uppercase tracking-widest hover:bg-red-300 transition-colors"
          >
            ■ 録画停止（{formatTime(recordElapsed)}）
          </button>
        )}
        {take && !isRecording && (
          <span className="text-[11px] text-white/55">
            テイク：{formatTime(take.durationMs)} / {take.frames.length} フレーム
          </span>
        )}
      </div>
      {take && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={() => canPlay && setIsPlaying(true)}
                disabled={!canPlay}
                className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
              >
                ▶ 再生
              </button>
            ) : (
              <button
                onClick={() => setIsPlaying(false)}
                className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
              >
                ❚❚ 一時停止
              </button>
            )}
            <button
              onClick={() => setLoop((prev) => !prev)}
              className={`px-3 py-2 rounded-full border text-[10px] uppercase tracking-widest transition-colors ${
                loop ? 'border-white/60 text-white' : 'border-white/15 text-white/40'
              }`}
            >
              ループ {loop ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setInterpolate((prev) => !prev)}
              data-testid="take-interpolate"
              title="数値キーをキーフレーム間でなめらかに補間して再生します"
              className={`px-3 py-2 rounded-full border text-[10px] uppercase tracking-widest transition-colors ${
                interpolate ? 'border-white/60 text-white' : 'border-white/15 text-white/40'
              }`}
            >
              補間再生 {interpolate ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setTake(null);
                setPlayhead(0);
              }}
              className="px-3 py-2 rounded-full border border-white/15 text-[10px] uppercase tracking-widest text-white/40 hover:bg-white/10"
            >
              テイクを消す
            </button>
            <span className="font-mono text-[11px] text-white/50">
              {formatTime(playhead)} / {formatTime(take.durationMs)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, take.durationMs)}
            step={10}
            value={Math.min(playhead, take.durationMs)}
            onChange={(event) => scrub(Number(event.target.value))}
            className="w-full accent-white"
            aria-label="再生位置（スクラブ）"
          />
          <p className="text-[10px] text-white/30">
            スライダーを動かすと、その瞬間の状態にスクラブできます。再生は録画開始時点の設定から始まります。
          </p>
          <div className="border-t border-white/10 pt-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/50">タイムライン編集（{take.frames.length} キーフレーム）</div>
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1" data-testid="take-timeline">
              {take.frames.map((frame, index) => (
                <div key={`${frame.t}-${index}`} className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    max={take.durationMs}
                    step={50}
                    value={frame.t}
                    onChange={(event) => setTake((prev) => (prev ? shiftTakeFrame(prev, index, Number(event.target.value)) : prev))}
                    className="w-20 rounded bg-black/40 px-1 py-0.5 font-mono text-[10px] text-white/85 outline-none"
                    aria-label="キーフレーム時刻 (ms)"
                  />
                  <span className="flex-1 truncate text-[10px] text-white/50">
                    {Object.keys(frame.changes).slice(0, 3).join(', ')}
                    {Object.keys(frame.changes).length > 3 ? ` ほか ${Object.keys(frame.changes).length - 3}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTake((prev) => (prev ? deleteTakeFrame(prev, index) : prev))}
                    className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/60 hover:bg-white/10"
                  >
                    削除
                  </button>
                </div>
              ))}
              {take.frames.length === 0 && <p className="text-[10px] text-white/35">キーフレームがありません。</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={handleExportTake}
              data-testid="take-export-json"
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10"
            >
              テイクを書き出す（JSON）
            </button>
            <button
              type="button"
              onClick={() => takeFileRef.current?.click()}
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10"
            >
              テイクを読み込む
            </button>
            <input
              ref={takeFileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportTake(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => void handleDeterministicExport()}
              disabled={exportBusy || !onApplyConfig}
              data-testid="take-export-deterministic"
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              {exportBusy ? '書き出し中…' : '決定論的書き出し（PNG ZIP）'}
            </button>
            {exportNote ? <span className="w-full text-[10px] text-emerald-300/90" data-testid="take-export-note">{exportNote}</span> : null}
          </div>
        </div>
      )}
    </section>
  );
};

type SourceLayerIndex = 1 | 2 | 3;

const SourceEditorSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layer, setLayer] = React.useState<SourceLayerIndex>(2);
  const [selected, setSelected] = React.useState(0);
  const padRef = React.useRef<HTMLDivElement | null>(null);
  const dragIndexRef = React.useRef<number | null>(null);

  const prefix = `layer${layer}` as 'layer1' | 'layer2' | 'layer3';
  const positionsKey = `${prefix}SourcePositions` as keyof ParticleConfig;
  const countKey = `${prefix}SourceCount` as keyof ParticleConfig;
  const spreadKey = `${prefix}SourceSpread` as keyof ParticleConfig;
  const positions = (config[positionsKey] as { x: number; y: number; z: number }[] | undefined) ?? [];
  const count = Math.max(1, Math.min(50, Math.round((config[countKey] as number) || 1)));
  const spread = (config[spreadKey] as number) || 0;
  const validSelected = Math.min(selected, count - 1);

  const offsetAt = (index: number) => positions[index] ?? { x: 0, y: 0, z: 0 };
  const effectiveAt = (index: number) => effectivePosition(offsetAt(index), index, count, spread);

  const moveSelectedTo = (index: number, worldX: number, worldZ: number) => {
    const current = offsetAt(index);
    const nextOffset = offsetFromEffective({ x: worldX, y: current.y, z: worldZ }, index, count, spread);
    write(positionsKey, withPosition(positions, count, index, nextOffset));
  };

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const ry = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const world = padToWorld(rx, ry);
    if (event.type === 'pointerdown' || dragIndexRef.current === null) {
      let nearest = 0;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i++) {
        const pad = worldToPad(effectiveAt(i));
        const d = (pad.rx - rx) ** 2 + (pad.ry - ry) ** 2;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = i;
        }
      }
      dragIndexRef.current = nearest;
      setSelected(nearest);
    }
    moveSelectedTo(dragIndexRef.current, world.x, world.z);
  };

  const endDrag = () => {
    dragIndexRef.current = null;
  };

  const selectedOffset = offsetAt(validSelected);
  const selectedEffective = effectiveAt(validSelected);

  const selectClass =
    'bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<LocateFixed size={12} />}>Source Editor · 発生源エディタ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        発生源（エミッタ）の配置を真上から見た図で直接ドラッグできます。点は実際の配置（手動オフセット＋Spread の円環配置）を表し、ドラッグするとオフセットに換算して保存されます。高さは下のスライダーで調整します。
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => {
            setLayer(Number(event.target.value) as SourceLayerIndex);
            setSelected(0);
          }}
          className={selectClass}
        >
          <option value={1} className="bg-neutral-900">Layer 1</option>
          <option value={2} className="bg-neutral-900">Layer 2</option>
          <option value={3} className="bg-neutral-900">Layer 3</option>
        </select>
        <span className="text-[11px] text-white/55">
          発生源 {count} 個 / Spread {spread}
        </span>
        {spread !== 0 && (
          <button
            onClick={() => write(spreadKey, 0)}
            className="px-3 py-1.5 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
          >
            Spread を 0 にする（絶対配置）
          </button>
        )}
      </div>
      <div
        ref={padRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="relative h-56 rounded-xl border border-white/15 bg-white/5 overflow-hidden touch-none cursor-crosshair select-none mb-3"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <span className="absolute right-2 top-1.5 text-[9px] uppercase tracking-widest text-white/30">X →</span>
        <span className="absolute left-2 bottom-1.5 text-[9px] uppercase tracking-widest text-white/30">↓ Z</span>
        {Array.from({ length: count }).map((_, index) => {
          const pad = worldToPad(effectiveAt(index));
          const isSelected = index === validSelected;
          return (
            <div
              key={index}
              className={`absolute -ml-2 -mt-2 flex items-center justify-center rounded-full text-[8px] font-bold ${
                isSelected
                  ? 'h-5 w-5 -ml-2.5 -mt-2.5 bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.8)] z-10'
                  : 'h-4 w-4 bg-white/35 text-black/70'
              }`}
              style={{ left: `${pad.rx * 100}%`, top: `${pad.ry * 100}%` }}
            >
              {index + 1}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">
            発生源 {validSelected + 1} の高さ Y（現在 {Math.round(selectedOffset.y)}）
          </span>
          <input
            type="range"
            min={-5000}
            max={5000}
            step={10}
            value={selectedOffset.y}
            onChange={(event) => {
              const y = Number(event.target.value);
              write(positionsKey, withPosition(positions, count, validSelected, { ...selectedOffset, y }));
            }}
            className="w-full accent-white"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">
            Spread（円環配置の半径、現在 {spread}）
          </span>
          <input
            type="range"
            min={0}
            max={20000}
            step={10}
            value={spread}
            onChange={(event) => write(spreadKey, Number(event.target.value))}
            className="w-full accent-white"
          />
        </label>
        <p className="font-mono text-[10px] text-white/35">
          #{validSelected + 1} 実配置 ({Math.round(selectedEffective.x)}, {Math.round(selectedEffective.y)},{' '}
          {Math.round(selectedEffective.z)}) / オフセット ({Math.round(selectedOffset.x)},{' '}
          {Math.round(selectedOffset.y)}, {Math.round(selectedOffset.z)})
        </p>
      </div>
    </section>
  );
};

const SimilaritySection: React.FC<{
  presets: PresetRecord[];
  activePresetId: string | null;
  onLoadPreset: (presetId: string) => void;
}> = ({ presets, activePresetId, onLoadPreset }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const effectiveSelectedId =
    selectedId && presets.some((preset) => preset.id === selectedId)
      ? selectedId
      : (activePresetId ?? presets[0]?.id ?? null);

  const vectors = React.useMemo(() => {
    const map = new Map<string, number[]>();
    for (const preset of presets) map.set(preset.id, buildPresetVector(preset.config));
    return map;
  }, [presets]);

  const points = React.useMemo(() => projectPresetsTo2D(presets), [presets]);
  const pointById = React.useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  const neighbors = React.useMemo(() => {
    if (!effectiveSelectedId) return [];
    const target = vectors.get(effectiveSelectedId);
    if (!target) return [];
    return presets
      .filter((preset) => preset.id !== effectiveSelectedId)
      .map((preset) => ({
        preset,
        similarity: cosineSimilarity(target, vectors.get(preset.id) ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);
  }, [presets, vectors, effectiveSelectedId]);

  const selectedPreset = presets.find((preset) => preset.id === effectiveSelectedId) ?? null;

  return (
    <section>
      <SectionTitle icon={<Network size={12} />}>Similarity Map · 類似マップ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        全プリセットを「パラメータの形」で地図化したものです。数値パラメータ355種を主成分2軸に圧縮して配置しているので、近くにある点同士は似た見た目・動きの傾向を持ちます。点を選ぶと、そのプリセットに最も似た8件を表示します。類似度は数値の形にモーションとソースの種類も加えて計算しています。
      </p>
      <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden mb-3">
        <svg viewBox="0 0 100 62" className="w-full block" role="img" aria-label="プリセット類似マップ">
          {points.map((point) => {
            const isSelected = point.id === effectiveSelectedId;
            const isActive = point.id === activePresetId;
            return (
              <circle
                key={point.id}
                cx={4 + point.x * 92}
                cy={4 + point.y * 54}
                r={isSelected ? 1.7 : 0.85}
                fill={isSelected ? '#ffffff' : isActive ? '#d4d4d4' : 'rgba(255,255,255,0.38)'}
                stroke={isActive ? '#ffffff' : 'none'}
                strokeWidth={isActive ? 0.35 : 0}
                className="cursor-pointer"
                onClick={() => setSelectedId(point.id)}
              >
                <title>{presets.find((preset) => preset.id === point.id)?.name ?? point.id}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      {selectedPreset && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/70 truncate">
              選択中：<span className="text-white font-medium">{selectedPreset.name}</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/35 ml-2">
                {selectedPreset.config.layer2Type} / {selectedPreset.config.layer3Type}
              </span>
            </p>
            <button
              onClick={() => onLoadPreset(selectedPreset.id)}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors shrink-0"
            >
              試す
            </button>
          </div>
          <ul className="divide-y divide-white/5">
            {neighbors.map(({ preset, similarity }) => (
              <li key={preset.id} className="flex items-center justify-between gap-2 py-1.5">
                <button onClick={() => setSelectedId(preset.id)} className="text-left min-w-0">
                  <span className="block truncate text-[11px] text-white/75 hover:text-white transition-colors">{preset.name}</span>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-white/35">
                    {preset.config.layer2Type} / {preset.config.layer3Type}
                  </span>
                </button>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] text-white/50">{Math.round(similarity * 100)}%</span>
                  <button
                    onClick={() => onLoadPreset(preset.id)}
                    className="px-2.5 py-1 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
                  >
                    試す
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {pointById.size === 0 && <p className="text-[11px] text-white/35">プリセットがありません。</p>}
        </div>
      )}
    </section>
  );
};

export const PlayTabContent: React.FC<ControlPanelContentProps> = (props) => (
  <div className="mg-flow-sub">
    {/* Four-edge layout: the preset shelf lives in the right-edge panel
        and the macros in the bottom transport bar (controlPanelChrome);
        the Play tab keeps the remaining sections. */}
    <StageSection config={props.config} presets={props.presets} isPublicLibrary={props.isPublicLibrary} onApplyConfig={props.onApplyConfig} />
    <CleanOutputSection />
    <GpuDiagnosticsSection config={props.config} updateConfig={props.updateConfig} />
    <ParameterSearchSection config={props.config} updateConfig={props.updateConfig} onJumpToTab={props.onJumpToTab} />
    <XyPadSection config={props.config} updateConfig={props.updateConfig} />
    <SourceEditorSection config={props.config} updateConfig={props.updateConfig} />
    <DataSourceSection config={props.config} updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <TexturePackSection config={props.config} updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <MidiSection updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <OscSection updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <ModulationSection isPublicLibrary={props.isPublicLibrary} />
    <PerformanceSection config={props.config} onApplyConfig={props.onApplyConfig} />
    <ExportSection captureRef={props.pointCloudCaptureRef} />
    <HistorySection
      entries={props.configHistoryEntries}
      config={props.config}
      onApplyConfig={props.onApplyConfig}
      onClearConfigHistory={props.onClearConfigHistory}
    />
    <BreedingSection
      presets={props.presets}
      config={props.config}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <PartialApplySection
      presets={props.presets}
      config={props.config}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <PromptDraftSection
      config={props.config}
      presets={props.presets}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <KeyboardShortcutsSection />
    <GraphSection config={props.config} updateConfig={props.updateConfig} updateMotionArray={props.updateMotionArray} isPublicLibrary={props.isPublicLibrary} />
    <SimilaritySection presets={props.presets} activePresetId={props.activePresetId} onLoadPreset={props.onLoadPreset} />
    <ExpressionMap config={props.config} presets={props.presets} isPublicLibrary={props.isPublicLibrary} onSaveBredPreset={props.onSaveBredPreset} />
  </div>
);
