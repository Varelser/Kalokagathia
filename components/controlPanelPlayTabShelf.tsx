import React from 'react';
import { Library, Minus, Plus, Sparkles } from 'lucide-react';
import type { PresetRecord } from '../types';
import { PRESET_CATEGORY_OPTIONS, getPresetCategories, getPresetPerformanceTier, getPresetSearchText } from '../lib/presetCatalog';
import { deriveGeneratedSeries, generatedSeriesLabel, loadGeneratedCollectionIndex, probeGeneratedCollectionAvailable, type GeneratedPresetEntry } from '../lib/generatedCollection';
import { getPresetTagCounts, getPresetTags } from '../lib/presetTags';
import { SectionTitle } from './controlPanelPlayTabShared';

export const PIN_STORAGE_KEY = 'kalokagathia.pins.v1';
export const loadPins = (): string[] => {
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
export const SHELF_GENRE_FOLD_PREFIX = 'shelf|genre|';
// Generated-collection folds share the same map under their own
// namespace (`shelf|generated|<seriesKey>`, plus `__group` for the
// group itself), so they can never collide with genre or sheet keys.
export const SHELF_GENERATED_FOLD_PREFIX = 'shelf|generated|';
export const SHELF_FOLD_STORAGE_KEY = 'kalokagathia.folds.v1';

export const readShelfFoldMap = (prefix: string): Record<string, boolean> => {
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

export const writeShelfFold = (prefix: string, key: string, open: boolean) => {
  try {
    const all = JSON.parse(localStorage.getItem(SHELF_FOLD_STORAGE_KEY) || '{}') as Record<string, unknown>;
    all[prefix + key] = open;
    localStorage.setItem(SHELF_FOLD_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
};

export const loadShelfGenreFolds = (): Record<string, boolean> => readShelfFoldMap(SHELF_GENRE_FOLD_PREFIX);

export const saveShelfGenreFold = (genre: string, open: boolean) => writeShelfFold(SHELF_GENRE_FOLD_PREFIX, genre, open);

export const loadShelfGeneratedFolds = (): Record<string, boolean> => readShelfFoldMap(SHELF_GENERATED_FOLD_PREFIX);

export const saveShelfGeneratedFold = (key: string, open: boolean) => writeShelfFold(SHELF_GENERATED_FOLD_PREFIX, key, open);

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

  // --- generated collection (the static generated presets) -------------
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

