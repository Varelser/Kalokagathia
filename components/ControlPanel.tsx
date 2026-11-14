import React from 'react';
import { flushSync } from 'react-dom';
import {
  ControlPanelRail,
  ControlPanelShelf,
  ControlPanelTopBar,
  ControlPanelTransportBar,
  MG_EDGE_PANEL_CLASS,
  getTabTier,
  getTabsForTier,
  mgFadeClass,
  mgGlassStyle,
  type EdgeFxProps,
  type PanelTier,
} from './controlPanelChrome';
import { ControlPanelContent, DECK_MODE_STORAGE_KEY, loadDeckMode, type DeckMode } from './controlPanelTabs';
import { CommandPalette } from './CommandPalette';
import { ControlPanelProps } from './controlPanelTypes';
import { useControlPanelState } from './useControlPanelState';
import { toggleFullscreen } from '../lib/platformFeatures';
import { encodeConfigPayload } from '../lib/shareLink';
import { buildEmbedSnippet } from '../lib/embedMode';
import { normalizeConfig } from '../lib/appStateConfig';

/**
 * Four-edge layout (2026-11-13): persisted collapse state for the
 * independently collapsible edges (top header, left rail, right shelf).
 * The detail sheet's open state stays App-owned (isOpen), as before.
 * Defaults: header + rail open; the shelf starts open on wide screens
 * (≥1024px, where it costs little canvas) and closed on narrow ones.
 */
const EDGES_STORAGE_KEY = 'kalokagathia.edges.v1';
type EdgeState = { header: boolean; rail: boolean; shelf: boolean };
const loadEdges = (): EdgeState => {
  const fallback: EdgeState = {
    header: true,
    rail: true,
    shelf: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  };
  try {
    const raw = localStorage.getItem(EDGES_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EdgeState>;
    return {
      header: typeof parsed.header === 'boolean' ? parsed.header : fallback.header,
      rail: typeof parsed.rail === 'boolean' ? parsed.rail : fallback.rail,
      shelf: typeof parsed.shelf === 'boolean' ? parsed.shelf : fallback.shelf,
    };
  } catch {
    return fallback;
  }
};

/**
 * Detail-sheet height (2026-11-13 addendum): the sheet's default height is
 * a CSS default (30dvh desktop / 45dvh mobile, styles.css --mg-sheet-h).
 * Dragging the sheet's top-edge grab handle stores a user-chosen height
 * (dvh, clamped 18–50) in this small settings key; ControlPanel applies it
 * as an inline --mg-sheet-h override on the deck root. Double-clicking the
 * handle clears the key and returns to the CSS default. Not an IndexedDB
 * payload key.
 */
const SHEET_HEIGHT_STORAGE_KEY = 'kalokagathia.sheetHeight.v1';
const SHEET_HEIGHT_MIN_VH = 18;
const SHEET_HEIGHT_MAX_VH = 50;
const clampSheetHeight = (vh: number) => Math.min(SHEET_HEIGHT_MAX_VH, Math.max(SHEET_HEIGHT_MIN_VH, vh));
const loadSheetHeight = (): number | null => {
  try {
    const raw = localStorage.getItem(SHEET_HEIGHT_STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? clampSheetHeight(value) : null;
  } catch {
    return null;
  }
};

/**
 * Phase 2: run a deck chrome update (open/close, tab/tier switch) inside a
 * View Transition when the browser supports it. Only the deck sheet carries
 * a view-transition-name (styles.css), so only the deck animates; the root
 * (including the WebGL canvas) swaps instantly and is never cross-faded.
 * Falls back to a plain update where startViewTransition is unavailable
 * (older Safari/Firefox) and for prefers-reduced-motion users.
 */
const runDeckTransition = (update: () => void) => {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduceMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof doc.startViewTransition === 'function' && !reduceMotion) {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } else {
    update();
  }
};

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
  // Four-edge layout (2026-11-13): the deck chrome is split across the
  // four screen edges (top header, left rail, right preset shelf, bottom
  // transport bar + detail sheet) and the centre is canvas-only. isOpen
  // (App-owned) is the detail sheet's expanded state. The Basic/Pro deck
  // mode is lifted here so the top header can switch it at any time —
  // same state, same localStorage key ControlPanelContent has always
  // used. Edge collapse state persists in kalokagathia.edges.v1.
  const [edges, setEdges] = React.useState<EdgeState>(loadEdges);
  const toggleEdge = React.useCallback((key: keyof EdgeState) => {
    runDeckTransition(() => {
      setEdges((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        try {
          localStorage.setItem(EDGES_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    });
  }, []);
  // Detail-sheet height override (null = CSS default 30dvh / 45dvh).
  const [sheetHeightVh, setSheetHeightVh] = React.useState<number | null>(loadSheetHeight);
  const sheetDragRef = React.useRef<{ startY: number; startVh: number } | null>(null);
  const handleSheetResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.closest('.mg-sheet-panel');
    const measured = panel ? (panel.getBoundingClientRect().height / window.innerHeight) * 100 : null;
    sheetDragRef.current = {
      startY: event.clientY,
      startVh: clampSheetHeight(sheetHeightVh ?? measured ?? 30),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture unsupported — move/up on the handle still work nearby */
    }
  }, [sheetHeightVh]);
  const handleSheetResizeMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag) return;
    const deltaVh = ((drag.startY - event.clientY) / window.innerHeight) * 100;
    setSheetHeightVh(clampSheetHeight(drag.startVh + deltaVh));
  }, []);
  const handleSheetResizeEnd = React.useCallback(() => {
    if (!sheetDragRef.current) return;
    sheetDragRef.current = null;
    setSheetHeightVh((current) => {
      if (current != null) {
        try {
          localStorage.setItem(SHEET_HEIGHT_STORAGE_KEY, String(Math.round(current * 10) / 10));
        } catch {
          /* storage unavailable */
        }
      }
      return current;
    });
  }, []);
  const handleSheetResizeReset = React.useCallback(() => {
    sheetDragRef.current = null;
    setSheetHeightVh(null);
    try {
      localStorage.removeItem(SHEET_HEIGHT_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [deckMode, setDeckMode] = React.useState<DeckMode>(loadDeckMode);
  const chooseDeckMode = React.useCallback((mode: DeckMode) => {
    setDeckMode(mode);
    try {
      localStorage.setItem(DECK_MODE_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [deckHover, setDeckHover] = React.useState(true);
  const [deckFocus, setDeckFocus] = React.useState(false);
  // Gloss auto-adjust (idea 6): sample the scene behind the deck and deepen the
  // glass tint on bright scenes so text stays readable; dark scenes keep v7 gloss.
  const [glossBoost, setGlossBoost] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const sample = () => {
      try {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvas || canvas.width === 0) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          try {
            const c2 = document.createElement('canvas');
            c2.width = 8;
            c2.height = 8;
            const ctx = c2.getContext('2d');
            if (!ctx) return;
            const w = canvas.width;
            const h = canvas.height;
            // The deck overlays the bottom edge now: sample the bottom band.
            ctx.drawImage(canvas, 0, h * 0.78, w, h * 0.22, 0, 0, 8, 8);
            const data = ctx.getImageData(0, 0, 8, 8).data;
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
              sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            }
            const lum = sum / 64;
            const boost = Math.max(0, Math.min(1, (lum - 0.35) / 0.5));
            const stepped = Math.round(boost * 20) / 20;
            setGlossBoost((prev) => (Math.abs(prev - stepped) >= 0.05 ? stepped : prev));
          } catch {
            /* sampling unavailable */
          }
        });
      } catch {
        /* ignore */
      }
    };
    sample();
    const id = window.setInterval(sample, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  const deckActive = deckHover || deckFocus;
  const {
    config,
    contactAmount,
    libraryScope,
    setConfig,
    isOpen,
    setIsOpen,
  } = props;
  const isPublicLibrary = libraryScope === 'public';
  const {
    activeTab,
    applyPerformancePreset,
    applyScreenFxPreset,
    audioActionLabel,
    draggingSequenceItemId,
    dropTargetSequenceItemId,
    editingPresetId,
    editingPresetName,
    formatPresetDate,
    handleCreatePreset,
    handleLibraryFileChange,
    handleSequenceDragEnd,
    handleSequenceDragOver,
    handleSequenceDragStart,
    handleSequenceDrop,
    handleStartRename,
    handleSubmitRename,
    libraryImportMode,
    libraryInputRef,
    lockedPanelClass,
    panelTier,
    presetName,
    setActiveTab,
    setPanelTier,
    setEditingPresetId,
    setEditingPresetName,
    setLibraryImportMode,
    setPresetName,
    updateConfig,
    updateLayer1Array,
    updateLayerArray,
    updateMotionArray,
    updatePositionArray,
  } = useControlPanelState({
    audioSourceMode: props.audioSourceMode,
    config,
    isAudioActive: props.isAudioActive,
    isPublicLibrary,
    onCreatePreset: props.onCreatePreset,
    onImportLibrary: props.onImportLibrary,
    onRenamePreset: props.onRenamePreset,
    onReorderSequenceItem: props.onReorderSequenceItem,
    layerLockState: props.layerLockState,
    setConfig,
  });

  const selectTier = (tier: PanelTier) => {
    setPanelTier(tier);
    if (!getTabsForTier(tier).some((tab) => tab.id === activeTab)) {
      setActiveTab('play');
    }
  };

  const handleSelectTier = (tier: PanelTier) => {
    runDeckTransition(() => selectTier(tier));
  };

  const jumpToTab = (tab: typeof activeTab) => {
    const needed = getTabTier(tab);
    const rank = { play: 0, design: 1, lab: 2 } as const;
    if (rank[needed] > rank[panelTier]) {
      setPanelTier(needed);
    }
    setActiveTab(tab);
  };

  const handleJumpToTab = (tab: typeof activeTab) => {
    runDeckTransition(() => jumpToTab(tab));
  };

  const activePresetName = props.presets.find((preset) => preset.id === props.activePresetId)?.name ?? null;

  // Share (four-edge layout: the action lives in the top header now; the
  // logic is unchanged from the deck-header era). Builds the cleanest
  // URL for the current scene — catalog share page when the config is
  // untouched, #p= when the preset is clean, an inline #c= payload
  // otherwise — then prefers the OS share sheet, falls back to the
  // clipboard, then to a prompt.
  const [shareNote, setShareNote] = React.useState('');
  // Shared resolution for the share link and the embed snippet: the
  // share hash for the current scene ('#p=<id>' for a clean preset,
  // '#c=<payload>' for an adjusted scene) plus whether the scene is an
  // untouched catalog preset (whose share URL is the /share/<id> page).
  const resolveSceneLink = async (): Promise<{ hash: string; catalogClean: boolean } | null> => {
    const { activePresetId, isPresetDirty } = props;
    // For catalog presets, decide clean/dirty against the normalized record:
    // the library's isPresetDirty stringifies the raw record, which never
    // matches the normalized live config for fetched/imported records.
    const canonical = (o: Record<string, unknown>) => Object.keys(o).sort().map((k) => `${k}=${JSON.stringify(o[k])}`).join('|');
    let catalogClean: boolean | null = null;
    if (activePresetId) {
      try {
        const r = await fetch(`/presets/${encodeURIComponent(activePresetId)}.json`);
        if ((r.headers.get('content-type') || '').includes('json')) {
          const rec = (await r.json()) as { config?: Record<string, unknown> } | null;
          if (rec?.config) {
            catalogClean = canonical(normalizeConfig(rec.config) as unknown as Record<string, unknown>)
              === canonical(config as unknown as Record<string, unknown>);
          }
        }
      } catch {
        catalogClean = null;
      }
    }
    if (activePresetId && catalogClean === true) {
      return { hash: `#p=${activePresetId}`, catalogClean: true };
    }
    if (activePresetId && catalogClean === null && !isPresetDirty) {
      return { hash: `#p=${activePresetId}`, catalogClean: false };
    }
    const payload = await encodeConfigPayload('Monosphere scene', config);
    if (payload) return { hash: `#c=${payload}`, catalogClean: false };
    return null;
  };
  const handleShare = async () => {
    const { activePresetId } = props;
    const origin = window.location.origin;
    const resolved = await resolveSceneLink();
    if (!resolved) {
      setShareNote('共有リンクを作れませんでした');
      return;
    }
    const url = resolved.catalogClean && activePresetId
      ? `${origin}/share/${activePresetId}`
      : `${origin}/${resolved.hash}`;
    // Web Share (tech batch): prefer the OS share sheet where the browser
    // offers one; a user dismissal (AbortError) ends the flow quietly, any
    // other failure falls back to the clipboard copy below.
    const navWithShare = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof navWithShare.share === 'function') {
      try {
        await navWithShare.share({ title: 'Kalokagathia', url });
        setShareNote('共有しました');
        window.setTimeout(() => setShareNote(''), 3000);
        return;
      } catch (error) {
        if ((error as DOMException | null)?.name === 'AbortError') {
          setShareNote('');
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareNote('共有リンクをコピーしました');
    } catch {
      window.prompt('共有リンク', url);
      setShareNote('');
      return;
    }
    window.setTimeout(() => setShareNote(''), 3000);
  };

  // Embed code (ultimate Wave 3): copy an <iframe> snippet for the
  // current scene, built from the same resolution as the share link —
  // the embed player URL (/?embed=1 + the share hash), never the
  // /share/<id> OGP page. Clipboard first, prompt fallback, mirroring
  // handleShare's notice pattern.
  const handleCopyEmbed = async () => {
    const resolved = await resolveSceneLink();
    if (!resolved) {
      setShareNote('埋め込みコードを作れませんでした');
      window.setTimeout(() => setShareNote(''), 3000);
      return;
    }
    const snippet = buildEmbedSnippet(window.location.origin, resolved.hash);
    try {
      await navigator.clipboard.writeText(snippet);
      setShareNote('埋め込みコードをコピーしました');
    } catch {
      window.prompt('埋め込みコード', snippet);
      setShareNote('');
      return;
    }
    window.setTimeout(() => setShareNote(''), 3000);
  };

  // Deck-wide hover/focus tracking for the idle auto-fade: every edge
  // panel spreads these handlers and shares the faded state.
  const edgeFx: EdgeFxProps = {
    onMouseEnter: () => setDeckHover(true),
    onMouseLeave: () => setDeckHover(false),
    onPointerDown: () => setDeckHover(true),
    onFocusCapture: (e) => { const t = e.target as HTMLElement; setDeckFocus(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); },
    onBlurCapture: (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDeckFocus(false); },
  };
  const deckFaded = !deckActive;

  const handleSelectBarTab = (tab: typeof activeTab) => {
    if (isOpen) {
      runDeckTransition(() => setActiveTab(tab));
    } else {
      runDeckTransition(() => {
        setIsOpen(true);
        setActiveTab(tab);
      });
    }
  };

  // Keyboard shortcuts (tech batch, desktop): Space = play/pause,
  // [ / ] = previous/next preset in shelf order, F = fullscreen,
  // B = expand/collapse the bottom sheet. Text entry is never hijacked:
  // the handler bows out when focus is in an input / textarea / select /
  // contenteditable, and with any modifier held. When a button has focus,
  // Space keeps its native meaning (it clicks that button — for the play
  // button that IS play/pause), so the shortcut only claims Space when
  // focus is on the canvas / page body.
  const shortcutStateRef = React.useRef({
    activePresetId: props.activePresetId,
    isOpen,
    onLoadPreset: props.onLoadPreset,
    presets: props.presets,
    togglePlay: props.togglePlay,
  });
  shortcutStateRef.current = {
    activePresetId: props.activePresetId,
    isOpen,
    onLoadPreset: props.onLoadPreset,
    presets: props.presets,
    togglePlay: props.togglePlay,
  };
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      const state = shortcutStateRef.current;
      if (event.code === 'Space') {
        if (event.repeat) return;
        if (target && target.tagName === 'BUTTON') return;
        event.preventDefault();
        state.togglePlay();
        return;
      }
      if (event.key === '[' || event.key === ']') {
        const list = state.presets;
        if (list.length === 0) return;
        const index = list.findIndex((preset) => preset.id === state.activePresetId);
        const nextIndex = event.key === ']'
          ? (index < 0 ? 0 : (index + 1) % list.length)
          : (index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length);
        const next = list[nextIndex];
        if (next && next.id !== state.activePresetId) state.onLoadPreset(next.id);
        return;
      }
      if (event.repeat) return;
      if (event.key === 'f' || event.key === 'F') {
        toggleFullscreen();
      } else if (event.key === 'b' || event.key === 'B') {
        runDeckTransition(() => setIsOpen(!shortcutStateRef.current.isOpen));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setIsOpen]);

  return (
    <div style={sheetHeightVh == null ? undefined : ({ '--mg-sheet-h': `${sheetHeightVh}dvh` } as React.CSSProperties)} className={`mg-deck pointer-events-none absolute inset-0 z-50 flex flex-col gap-2 p-2 text-white sm:p-3 ${edges.header ? 'mg-header-open' : ''}`}>
      <CommandPalette presets={props.presets} onLoadPreset={props.onLoadPreset} onJumpToTab={(tab) => { runDeckTransition(() => { setIsOpen(true); jumpToTab(tab); }); }} onRevealParameter={(entry) => { (window as unknown as { __mgPendingReveal?: unknown }).__mgPendingReveal = { ...entry, at: Date.now() }; window.dispatchEvent(new CustomEvent('kalokagathia:reveal-setting', { detail: entry })); }} />
      <ControlPanelTopBar
        activePresetName={activePresetName}
        collapsed={!edges.header}
        deckMode={deckMode}
        faded={deckFaded}
        fx={edgeFx}
        glossBoost={glossBoost}
        isPublicLibrary={isPublicLibrary}
        onDeckModeChange={chooseDeckMode}
        onSelectTier={handleSelectTier}
        onShare={() => { void handleShare(); }}
        onCopyEmbed={() => { void handleCopyEmbed(); }}
        onToggleCollapsed={() => toggleEdge('header')}
        shareNote={shareNote}
        tier={panelTier}
        canRedo={props.canRedoConfig ?? false}
        canUndo={props.canUndoConfig ?? false}
        onRedo={props.onRedoConfig}
        onUndo={props.onUndoConfig}
      />
      <div className="pointer-events-none flex min-h-0 flex-1 items-stretch gap-2">
        <ControlPanelRail
          activeTab={activeTab}
          collapsed={!edges.rail}
          faded={deckFaded}
          fx={edgeFx}
          glossBoost={glossBoost}
          isPlaying={props.isPlaying}
          onSelectTab={handleSelectBarTab}
          onToggleCollapsed={() => toggleEdge('rail')}
          tier={panelTier}
        />
        <div className="min-w-0 flex-1" aria-hidden="true" />
      </div>
      <div className={`mg-shelf-anchor pointer-events-none ${edges.shelf ? 'mg-shelf-anchor-open' : 'mg-shelf-anchor-closed'}`}>
        <ControlPanelShelf
          activePresetId={props.activePresetId}
          config={config}
          faded={deckFaded}
          fx={edgeFx}
          glossBoost={glossBoost}
          isPublicLibrary={isPublicLibrary}
          onLoadPreset={props.onLoadPreset}
          onLoadGeneratedPreset={props.onLoadGeneratedPreset}
          onSave={props.onSave}
          onToggleOpen={() => toggleEdge('shelf')}
          open={edges.shelf}
          presets={props.presets}
          updateConfig={updateConfig}
        />
      </div>
      {isOpen && (
        <div {...edgeFx} className={`mg-sheet w-full shrink-0 ${mgFadeClass(deckFaded)}`}>
          <div style={mgGlassStyle(glossBoost)} className={`mg-sheet-panel mg-panel-open ${MG_EDGE_PANEL_CLASS} flex w-full flex-col`}>
              <div
                id="sheet-resize-handle"
                data-testid="sheet-resize-handle"
                className="mg-sheet-resize"
                role="separator"
                aria-orientation="horizontal"
                aria-label="シートの高さをドラッグで調整（ダブルクリックで既定に戻す）"
                title="ドラッグで高さ調整 · ダブルクリックで既定に戻す"
                onPointerDown={handleSheetResizeStart}
                onPointerMove={handleSheetResizeMove}
                onPointerUp={handleSheetResizeEnd}
                onPointerCancel={handleSheetResizeEnd}
                onDoubleClick={handleSheetResizeReset}
              >
                <span className="mg-sheet-resize-grip" aria-hidden="true" />
              </div>
              <ControlPanelContent
                activeTab={activeTab}
                config={config}
                contactAmount={contactAmount}
                deckMode={deckMode}
                onDeckModeChange={chooseDeckMode}
                isPublicLibrary={isPublicLibrary}
                lockedPanelClass={lockedPanelClass}
                updateConfig={updateConfig}
                applyPerformancePreset={applyPerformancePreset}
                applyScreenFxPreset={applyScreenFxPreset}
                presetName={presetName}
                setPresetName={setPresetName}
                handleCreatePreset={handleCreatePreset}
                activePresetId={props.activePresetId}
                onOverwritePreset={props.onOverwritePreset}
                isPresetTransitioning={props.isPresetTransitioning}
                onStopPresetTransition={props.onStopPresetTransition}
                presetBlendDuration={props.presetBlendDuration}
                onPresetBlendDurationChange={props.onPresetBlendDurationChange}
                libraryInputRef={libraryInputRef}
                handleLibraryFileChange={handleLibraryFileChange}
                handleProjectFileChange={props.handleProjectFileChange}
                onDismissProjectNotice={props.onDismissProjectNotice}
                onExportLibrary={props.onExportLibrary}
                onExportProject={props.onExportProject}
                libraryImportMode={libraryImportMode}
                setLibraryImportMode={setLibraryImportMode}
                libraryNotice={props.libraryNotice}
                onDismissLibraryNotice={props.onDismissLibraryNotice}
                sequenceLoopEnabled={props.sequenceLoopEnabled}
                onSequenceLoopEnabledChange={props.onSequenceLoopEnabledChange}
                isSequencePlaying={props.isSequencePlaying}
                onStartSequencePlayback={props.onStartSequencePlayback}
                onStopSequencePlayback={props.onStopSequencePlayback}
                presetSequence={props.presetSequence}
                activeSequenceItemId={props.activeSequenceItemId}
                sequenceSinglePassDuration={props.sequenceSinglePassDuration}
                onLoadSequenceItem={props.onLoadSequenceItem}
                sequenceStepProgress={props.sequenceStepProgress}
                draggingSequenceItemId={draggingSequenceItemId}
                dropTargetSequenceItemId={dropTargetSequenceItemId}
                handleSequenceDragStart={handleSequenceDragStart}
                handleSequenceDragOver={handleSequenceDragOver}
                handleSequenceDrop={handleSequenceDrop}
                handleSequenceDragEnd={handleSequenceDragEnd}
                presets={props.presets}
                projectInputRef={props.projectInputRef}
                projectManifest={props.projectManifest}
                projectNotice={props.projectNotice}
                layerFocusMode={props.layerFocusMode}
                comparePreviewEnabled={props.comparePreviewEnabled}
                onSetComparePreviewEnabled={props.onSetComparePreviewEnabled}
                comparePreviewOrientation={props.comparePreviewOrientation}
                onSetComparePreviewOrientation={props.onSetComparePreviewOrientation}
                comparePreviewSlotIndex={props.comparePreviewSlotIndex}
                onSetComparePreviewSlotIndex={props.onSetComparePreviewSlotIndex}
                onSetLayerFocusMode={props.onSetLayerFocusMode}
                layerMuteState={props.layerMuteState}
                onToggleLayerMute={props.onToggleLayerMute}
                layerLockState={props.layerLockState}
                onToggleLayerLock={props.onToggleLayerLock}
                snapshotSlots={props.snapshotSlots}
                onCaptureSnapshot={props.onCaptureSnapshot}
                onLoadSnapshot={props.onLoadSnapshot}
                onMorphSnapshot={props.onMorphSnapshot}
                onClearSnapshot={props.onClearSnapshot}
                onRenameSnapshot={props.onRenameSnapshot}
                onSetSnapshotNote={props.onSetSnapshotNote}
                compareReferenceConfig={props.compareReferenceConfig}
                onRenameSequenceItem={props.onRenameSequenceItem}
                onSequenceHoldChange={props.onSequenceHoldChange}
                onSequenceTransitionChange={props.onSequenceTransitionChange}
                onSequenceTransitionEasingChange={props.onSequenceTransitionEasingChange}
                onSequenceDriveModeChange={props.onSequenceDriveModeChange}
                onSequenceDriveStrengthModeChange={props.onSequenceDriveStrengthModeChange}
                onSequenceDriveStrengthOverrideChange={props.onSequenceDriveStrengthOverrideChange}
                onSequenceDriveMultiplierChange={props.onSequenceDriveMultiplierChange}
                onCaptureSequenceKeyframe={props.onCaptureSequenceKeyframe}
                onResetSequenceKeyframe={props.onResetSequenceKeyframe}
                onDuplicateSequenceItem={props.onDuplicateSequenceItem}
                onMoveSequenceItem={props.onMoveSequenceItem}
                onRemoveSequenceItem={props.onRemoveSequenceItem}
                videoExportMode={props.videoExportMode}
                onVideoExportModeChange={props.onVideoExportModeChange}
                videoFps={props.videoFps}
                onVideoFpsChange={props.onVideoFpsChange}
                videoDurationSeconds={props.videoDurationSeconds}
                onVideoDurationSecondsChange={props.onVideoDurationSecondsChange}
                isVideoRecording={props.isVideoRecording}
                onStartVideoRecording={props.onStartVideoRecording}
                onStopVideoRecording={props.onStopVideoRecording}
                isFrameExporting={props.isFrameExporting}
                onStartFrameExport={props.onStartFrameExport}
                onStopFrameExport={props.onStopFrameExport}
                videoNotice={props.videoNotice}
                onDismissVideoNotice={props.onDismissVideoNotice}
                frameNotice={props.frameNotice}
                onDismissFrameNotice={props.onDismissFrameNotice}
                editingPresetId={editingPresetId}
                editingPresetName={editingPresetName}
                setEditingPresetId={setEditingPresetId}
                setEditingPresetName={setEditingPresetName}
                handleSubmitRename={handleSubmitRename}
                handleStartRename={handleStartRename}
                onLoadPreset={props.onLoadPreset}
                onRandomize={props.onRandomize}
                onApplyConfig={props.onApplyConfig}
                onSaveBredPreset={props.onSaveBredPreset}
                onSyncApplyPresets={props.onSyncApplyPresets}
                onSyncNotice={props.onSyncNotice}
                onJumpToTab={handleJumpToTab}
                configHistoryEntries={props.configHistoryEntries}
                onClearConfigHistory={props.onClearConfigHistory}
                pointCloudCaptureRef={props.pointCloudCaptureRef}
                formatPresetDate={formatPresetDate}
                isPresetDirty={props.isPresetDirty}
                onTransitionToPreset={props.onTransitionToPreset}
                onAddPresetToSequence={props.onAddPresetToSequence}
                onDuplicatePreset={props.onDuplicatePreset}
                onDeletePreset={props.onDeletePreset}
                updatePositionArray={updatePositionArray}
                updateLayerArray={updateLayerArray}
                updateLayer1Array={updateLayer1Array}
                updateMotionArray={updateMotionArray}
                audioSourceMode={props.audioSourceMode}
                onAudioSourceModeChange={props.onAudioSourceModeChange}
                audioLevelsRef={props.audioLevelsRef}
                isAudioActive={props.isAudioActive}
                stopAudio={props.stopAudio}
                startAudio={props.startAudio}
                audioActionLabel={audioActionLabel}
                audioNotice={props.audioNotice}
                onDismissAudioNotice={props.onDismissAudioNotice}
              />
          </div>
        </div>
      )}
      <ControlPanelTransportBar
        config={config}
        expanded={isOpen}
        faded={deckFaded}
        fx={edgeFx}
        glossBoost={glossBoost}
        isPlaying={props.isPlaying}
        isPublicLibrary={isPublicLibrary}
        onRandomize={props.onRandomize}
        onReset={props.onReset}
        onToggleExpanded={() => runDeckTransition(() => setIsOpen(!isOpen))}
        togglePlay={props.togglePlay}
        updateConfig={updateConfig}
      />
    </div>
  );
};
