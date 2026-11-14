import React from 'react';
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  ClipboardCopy,
  Code,
  Download,
  ExternalLink,
  Globe,
  Haze,
  Layers,
  Library,
  LucideIcon,
  Maximize,
  Minimize,
  Moon,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  Redo2,
  RefreshCw,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Zap,
} from 'lucide-react';
import type { ParticleConfig, PresetRecord } from '../types';
import { ControlPanelTab } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelTabsShared';
import {
  getDocumentPictureInPicture,
  isDocumentPipSupported,
  isPngClipboardSupported,
  openCanvasPictureInPicture,
  toggleFullscreen,
} from '../lib/platformFeatures';
import { useWakeLock } from '../lib/useWakeLock';
import { MACRO_DEFINITIONS, getMacroUpdates, getMacroValue } from '../lib/macroControls';
import { NOTE_GUIDE_URL } from '../lib/noteBacklinks';
import { PresetShelf } from './controlPanelPlayTab';

export const CONTROL_PANEL_TABS: { id: ControlPanelTab; icon: LucideIcon; label: string; shortLabel: string; description: string }[] = [
  { id: 'play', icon: SlidersHorizontal, label: 'Play', shortLabel: 'Play', description: 'Pick a preset, bend it with macro knobs, and see the expression map.' },
  { id: 'global', icon: Globe, label: 'Main', shortLabel: 'Main', description: 'Presets, sequence flow, export, and global display controls.' },
  { id: 'layer1', icon: Layers, label: 'Layer 1', shortLabel: 'L1', description: 'Primary point cloud density, source layout, and motion tuning.' },
  { id: 'layer2', icon: Zap, label: 'Layer 2', shortLabel: 'L2', description: 'Secondary reactive structure, lines, and physics-driven accents.' },
  { id: 'layer3', icon: Sparkles, label: 'Layer 3', shortLabel: 'L3', description: 'Tertiary detail field, auxiliary sparks, and fine motion shaping.' },
  { id: 'ambient', icon: Haze, label: 'Ambient', shortLabel: 'Amb', description: 'Atmosphere, supporting particles, and space-filling texture.' },
  { id: 'audio', icon: Music, label: 'Audio FX', shortLabel: 'FX', description: 'Audio input, analysis, routing, and reactive deformation controls.' },
  { id: 'ai', icon: Bot, label: 'AI', shortLabel: 'AI', description: '言葉で指示してAIがパラメータを調整します。' },
];

/**
 * Progressive-disclosure tiers (roadmap Phase 6B). Play shows only the
 * Play tab; Design adds the everyday structure tabs (Main + layers);
 * Lab reveals everything, including the specialist Ambient and Audio FX
 * tabs. Tiers only filter which tabs are offered — no state or data is
 * tied to them.
 */
export type PanelTier = 'play' | 'design' | 'lab';

export const PANEL_TIERS: { id: PanelTier; label: string; gloss: string }[] = [
  { id: 'play', label: 'Play', gloss: '遊ぶ' },
  { id: 'design', label: 'Design', gloss: '作る' },
  { id: 'lab', label: 'Lab', gloss: '全開' },
];

const TAB_TIER: Record<ControlPanelTab, PanelTier> = {
  play: 'play',
  global: 'design',
  layer1: 'design',
  layer2: 'design',
  layer3: 'design',
  ambient: 'lab',
  audio: 'lab',
  ai: 'play',
};

const TIER_RANK: Record<PanelTier, number> = { play: 0, design: 1, lab: 2 };

export function getTabTier(tab: ControlPanelTab): PanelTier {
  return TAB_TIER[tab];
}

export function getTabsForTier(tier: PanelTier) {
  return CONTROL_PANEL_TABS.filter((tab) => TIER_RANK[TAB_TIER[tab.id]] <= TIER_RANK[tier]);
}

/**
 * Four-edge layout (2026-11-13): shared chrome for the edge panels.
 * Every edge is a gloss surface (Phase 2 Variant B tokens) that overlays
 * the canvas edge; the centre stays canvas-only. EdgeFx carries the
 * deck-wide hover/focus handlers (the idle auto-fade is deck-wide, as it
 * was for the single sheet), and mgGlassStyle applies the gloss-boost
 * tint sampled from the scene behind the deck.
 */
export interface EdgeFxProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onPointerDown: () => void;
  onFocusCapture: (event: React.FocusEvent) => void;
  onBlurCapture: (event: React.FocusEvent) => void;
}

export const MG_EDGE_PANEL_CLASS =
  'pointer-events-auto overflow-hidden rounded-[18px] border border-white/[0.12] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[20px]';

export const mgGlassStyle = (glossBoost: number): React.CSSProperties => ({
  backgroundImage: `linear-gradient(118deg, rgba(255,255,255,${(0.065 - 0.02 * glossBoost).toFixed(3)}), rgba(10,10,10,${(0.88 + 0.08 * glossBoost).toFixed(3)}) 45%, rgba(255,255,255,0.03))`,
});

export const mgFadeClass = (faded: boolean): string =>
  `transition-opacity duration-500 ${faded ? 'opacity-[0.22]' : 'opacity-100'}`;

/**
 * TOP edge — the slim header bar (~40px). Carries the scope/title, the
 * active preset name, the Play/Design/Lab tier switch, the Basic/Pro
 * deck-mode switch and the share action (moved out of the content
 * header). Collapsed it shrinks to a slim strip with just the title and
 * a restore chevron. The middle cluster scrolls horizontally when the
 * bar is too narrow; the title and the action cluster never scroll away.
 */
export const ControlPanelTopBar: React.FC<{
  activePresetName: string | null;
  collapsed: boolean;
  deckMode: 'basic' | 'pro';
  faded: boolean;
  fx: EdgeFxProps;
  glossBoost: number;
  isPublicLibrary: boolean;
  onDeckModeChange: (mode: 'basic' | 'pro') => void;
  onSelectTier: (tier: PanelTier) => void;
  onShare: () => void;
  /** Embed snippet copy (ultimate Wave 3). Optional: when the handler
   *  is absent the button is not rendered at all. */
  onCopyEmbed?: () => void;
  /** Stream URL copy (Phase 8): the OBS Browser Source URL for the
   *  current scene. Optional, same pattern as onCopyEmbed. */
  onCopyStream?: () => void;
  onToggleCollapsed: () => void;
  shareNote: string;
  tier: PanelTier;
  /** Global config undo/redo (ultimate Wave 2). Optional: when the
   *  handlers are absent the buttons are not rendered at all. */
  canRedo?: boolean;
  canUndo?: boolean;
  onRedo?: () => void;
  onUndo?: () => void;
}> = ({
  activePresetName,
  collapsed,
  deckMode,
  faded,
  fx,
  glossBoost,
  isPublicLibrary,
  onDeckModeChange,
  onSelectTier,
  onShare,
  onCopyEmbed,
  onCopyStream,
  onToggleCollapsed,
  shareNote,
  tier,
  canRedo = false,
  canUndo = false,
  onRedo,
  onUndo,
}) => {
  if (collapsed) {
    return (
      <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-topbar ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex h-7 shrink-0 items-center gap-2 px-3`}>
        <span className="h-1.5 w-1.5 rounded-full bg-[#9cffc1]" aria-hidden="true" />
        <span className="text-[10px] font-light uppercase tracking-[0.2em] text-white/70">Kalokagathia</span>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="top-expand"
          onClick={onToggleCollapsed}
          className="flex items-center justify-center rounded-md p-1 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          title="ヘッダーを開く"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }
  return (
    <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-topbar ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex h-10 shrink-0 items-center gap-2 px-3 sm:px-4`}>
      <div className="flex shrink-0 items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#9cffc1]" aria-hidden="true" />
        <span className="hidden text-[10px] uppercase tracking-[0.18em] text-white/45 min-[420px]:block">
          {isPublicLibrary ? 'Exhibition' : 'Studio'}
        </span>
        <span className="text-xs font-light uppercase tracking-[0.2em] text-white/80">Kalokagathia</span>
      </div>
      {activePresetName && (
        <div className="hidden min-w-0 max-w-[170px] shrink truncate text-[11px] tracking-wider text-white/50 md:block" title={activePresetName}>
          {activePresetName}
        </div>
      )}
      <div className="mg-topbar-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-1 rounded-md bg-[#171717] p-1" title="表示階層（Play / Design / Lab）">
          {PANEL_TIERS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelectTier(entry.id)}
              data-testid={`top-tier-${entry.id}`}
              className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.14em] transition-all ${
                tier === entry.id ? 'bg-[#f5f5f5] font-semibold text-black' : 'text-[#737373] hover:text-white'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div
          className="flex shrink-0 items-center gap-1 rounded-md bg-[#171717] p-1"
          title="Basic: 主要な設定だけ表示 / Pro: 全ての設定を表示（従来どおり）"
        >
          <button
            type="button"
            data-testid="top-mode-basic"
            onClick={() => onDeckModeChange('basic')}
            className={`rounded px-2 py-1 text-[10px] tracking-wider transition-colors ${
              deckMode === 'basic' ? 'bg-[#f5f5f5] text-black' : 'text-[#a3a3a3] hover:text-white'
            }`}
          >
            Basic 基本
          </button>
          <button
            type="button"
            data-testid="top-mode-pro"
            onClick={() => onDeckModeChange('pro')}
            className={`rounded px-2 py-1 text-[10px] tracking-wider transition-colors ${
              deckMode === 'pro' ? 'bg-[#f5f5f5] text-black' : 'text-[#a3a3a3] hover:text-white'
            }`}
          >
            Pro 詳細
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {shareNote && <span className="hidden text-[10px] tracking-wider text-emerald-300/90 lg:inline">{shareNote}</span>}
        {onUndo && (
          <button
            type="button"
            data-testid="top-undo"
            onClick={onUndo}
            disabled={!canUndo}
            className="flex items-center justify-center rounded-md p-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/75"
            title="元に戻す (Ctrl/Cmd+Z)"
          >
            <Undo2 size={14} />
          </button>
        )}
        {onRedo && (
          <button
            type="button"
            data-testid="top-redo"
            onClick={onRedo}
            disabled={!canRedo}
            className="flex items-center justify-center rounded-md p-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/75"
            title="やり直す (Ctrl/Cmd+Shift+Z)"
          >
            <Redo2 size={14} />
          </button>
        )}
        <button
          type="button"
          data-testid="top-share"
          onClick={onShare}
          className="flex items-center justify-center gap-1.5 rounded-md bg-[#171717] px-2.5 py-1.5 text-[10px] tracking-wider text-white/75 transition-colors hover:bg-[#f5f5f5] hover:text-black"
          title="いまのプリセット（または調整した設定）へのリンクを共有します（対応環境では共有シート、なければコピー）"
        >
          <Share2 size={13} />
          <span className="hidden sm:inline">共有</span>
        </button>
        {onCopyEmbed && (
          <button
            type="button"
            data-testid="top-embed"
            onClick={onCopyEmbed}
            className="flex items-center justify-center gap-1.5 rounded-md bg-[#171717] px-2.5 py-1.5 text-[10px] tracking-wider text-white/75 transition-colors hover:bg-[#f5f5f5] hover:text-black"
            title="いまのシーンを外部サイト（note・ブログ等）に貼るための埋め込みコード（iframe）をコピーします"
          >
            <Code size={13} />
            <span className="hidden sm:inline">埋め込み</span>
          </button>
        )}
        {onCopyStream && (
          <button
            type="button"
            data-testid="top-stream"
            onClick={onCopyStream}
            className="flex items-center justify-center gap-1.5 rounded-md bg-[#171717] px-2.5 py-1.5 text-[10px] tracking-wider text-white/75 transition-colors hover:bg-[#f5f5f5] hover:text-black"
            title="いまのシーンの配信URL（OBSのブラウザソース用・背景透過）をコピーします。クロマキー合成にしたい場合はURLに &bg=key を付けると緑背景＋フルPostFxになります"
          >
            <Clapperboard size={13} />
            <span className="hidden sm:inline">配信</span>
          </button>
        )}
        <button
          type="button"
          data-testid="top-collapse"
          onClick={onToggleCollapsed}
          className="flex items-center justify-center rounded-md p-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          title="ヘッダーをたたむ"
        >
          <ChevronUp size={15} />
        </button>
      </div>
    </div>
  );
};

/**
 * LEFT edge — the vertical rail (~52px). The tier-filtered tab switch
 * (PLAY / MAIN / L1 / L2 / L3 / Ambient / Audio FX / AI) as icon+label
 * buttons, and at its bottom the platform utility cluster from the tech
 * batch (Wake Lock, Document PiP, Fullscreen) plus the cinema toggle.
 * Collapsed it shrinks to a slim strip with a restore chevron. On small
 * screens it is a compact icon strip (labels hidden).
 */
export const ControlPanelRail: React.FC<{
  activeTab: ControlPanelTab;
  collapsed: boolean;
  faded: boolean;
  fx: EdgeFxProps;
  glossBoost: number;
  isPlaying: boolean;
  onSelectTab: (tab: ControlPanelTab) => void;
  onToggleCollapsed: () => void;
  tier: PanelTier;
}> = ({ activeTab, collapsed, faded, fx, glossBoost, isPlaying, onSelectTab, onToggleCollapsed, tier }) => {
  // Platform tech batch (2026-11-13): wake lock follows playback, the PiP
  // button mirrors the canvas into a Document PiP window, and the
  // fullscreen button tracks fullscreenchange. Each control hides itself
  // where the browser lacks the API.
  const wakeLock = useWakeLock(isPlaying);
  const pipSupported = isDocumentPipSupported();
  const [pipOpen, setPipOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  const handlePipToggle = async () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const opened = await openCanvasPictureInPicture(canvas, () => setPipOpen(false));
    if (opened) setPipOpen(Boolean(getDocumentPictureInPicture()?.window));
  };
  if (collapsed) {
    return (
      <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-rail ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex w-[26px] shrink-0 flex-col items-center py-2`}>
        <button
          type="button"
          data-testid="rail-expand"
          onClick={onToggleCollapsed}
          className="flex items-center justify-center rounded-md p-1 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          title="レールを開く"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }
  const utilityButtonClass = (active: boolean) =>
    `flex items-center justify-center rounded-md p-2 transition-colors ${
      active ? 'bg-[#f5f5f5] text-black' : 'text-white/75 hover:bg-[#f5f5f5] hover:text-black'
    }`;
  return (
    <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-rail ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex w-10 shrink-0 flex-col items-center gap-1 py-2 min-[641px]:w-[52px]`}>
      <button
        type="button"
        data-testid="rail-collapse"
        onClick={onToggleCollapsed}
        className="mb-1 flex shrink-0 items-center justify-center rounded-md p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        title="レールをたたむ"
      >
        <ChevronLeft size={14} />
      </button>
      {/* The tab list scrolls inside the rail when the middle row is
          short (detail sheet open, Lab tier shows eight tabs); the
          utility cluster below stays pinned and always reachable. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {getTabsForTier(tier).map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            data-testid={`rail-tab-${tab.id}`}
            className={`flex w-8 shrink-0 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 transition-colors min-[641px]:w-11 ${
              activeTab === tab.id
                ? 'bg-[#f5f5f5] font-semibold text-black'
                : 'text-[#a3a3a3] hover:bg-white/[0.08] hover:text-white'
            }`}
            title={tab.description}
          >
            <tab.icon size={15} />
            <span className="hidden text-[9px] uppercase tracking-wider min-[641px]:block">{tab.shortLabel}</span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
        {wakeLock.supported && (
          <button
            type="button"
            data-testid="rail-wakelock"
            aria-pressed={wakeLock.enabled}
            onClick={wakeLock.toggle}
            className={utilityButtonClass(wakeLock.enabled)}
            title={wakeLock.enabled ? '画面スリープ防止：オン（再生中のみ有効）' : '画面スリープ防止：オフ'}
          >
            <Moon size={16} />
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            data-testid="rail-pip"
            aria-pressed={pipOpen}
            onClick={() => { void handlePipToggle(); }}
            className={utilityButtonClass(pipOpen)}
            title="ミニ表示（Picture-in-Picture）"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        <button
          type="button"
          data-testid="rail-fullscreen"
          aria-pressed={isFullscreen}
          onClick={toggleFullscreen}
          className={utilityButtonClass(isFullscreen)}
          title={isFullscreen ? '全画面を終了' : '全画面表示'}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <button
          type="button"
          data-testid="cinema-toggle"
          onClick={() => window.dispatchEvent(new CustomEvent('kalokagathia:toggle-cinema'))}
          className="flex items-center justify-center rounded-md p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="鑑賞モード（UIを隠す）— 画面タップで戻る"
        >
          <Clapperboard size={16} />
        </button>
      </div>
    </div>
  );
};

/**
 * The macro mini-sliders for the bottom transport bar: the same eight
 * perceptual macros that used to head the Play tab (lib/macroControls
 * definitions, derived positions, writes through updateConfig), as
 * compact labelled range inputs in one horizontally scrolling row.
 */
const MacroStrip: React.FC<{
  config: ParticleConfig;
  isPublicLibrary: boolean;
  updateConfig: UpdateConfig;
}> = ({ config, isPublicLibrary, updateConfig }) => {
  const applyMacro = React.useCallback(
    (definitionId: string, position: number) => {
      const definition = MACRO_DEFINITIONS.find((entry) => entry.id === definitionId);
      if (!definition) return;
      const write = updateConfig as (key: keyof ParticleConfig, value: number) => void;
      getMacroUpdates(definition, position).forEach(({ key, value }) => write(key, value));
    },
    [updateConfig],
  );
  return (
    <div
      data-testid="transport-macros"
      className={`mg-macro-scroll flex min-w-0 flex-1 items-center gap-4 overflow-x-auto px-1 ${isPublicLibrary ? 'pointer-events-none opacity-50' : ''}`}
      title="マクロつまみ：大きな知覚単位のつまみです。裏では複数の詳細パラメータが連動して動きます。"
    >
      {MACRO_DEFINITIONS.map((definition) => (
        <label
          key={definition.id}
          className="flex shrink-0 items-center gap-2"
          title={`${definition.label} · ${definition.gloss}（${definition.lowLabel} → ${definition.highLabel}）`}
        >
          <span className="text-[9px] uppercase tracking-[0.14em] text-white/50">{definition.label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={getMacroValue(config, definition)}
            data-testid={`transport-macro-${definition.id}`}
            aria-label={`${definition.label} · ${definition.gloss}`}
            onChange={(event) => applyMacro(definition.id, Number(event.target.value))}
            className="w-[72px]"
          />
        </label>
      ))}
    </div>
  );
};

/**
 * BOTTOM edge — the slim transport bar (~48px): primary play/pause,
 * shuffle, reset, the macro mini-sliders, and the expand handle for the
 * detail sheet that opens upward above it.
 */
export const ControlPanelTransportBar: React.FC<{
  config: ParticleConfig;
  expanded: boolean;
  faded: boolean;
  fx: EdgeFxProps;
  glossBoost: number;
  isPlaying: boolean;
  isPublicLibrary: boolean;
  onRandomize: () => void;
  onReset: () => void;
  onToggleExpanded: () => void;
  togglePlay: () => void;
  updateConfig: UpdateConfig;
}> = ({
  config,
  expanded,
  faded,
  fx,
  glossBoost,
  isPlaying,
  isPublicLibrary,
  onRandomize,
  onReset,
  onToggleExpanded,
  togglePlay,
  updateConfig,
}) => (
  <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-transportbar ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex h-12 shrink-0 items-center gap-2 px-3 sm:px-4`}>
    <button
      onClick={togglePlay}
      data-testid="transport-play-toggle"
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-semibold transition-colors ${
        isPlaying
          ? 'bg-[#f5f5f5] text-black hover:bg-[#262626] hover:text-white'
          : 'bg-red-500/80 text-white hover:bg-red-500'
      }`}
      title={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? <Pause size={15} /> : <Play size={15} />}
      <span className="hidden text-[11px] uppercase sm:inline">{isPlaying ? 'Pause' : 'Play'}</span>
    </button>
    <button
      onClick={onRandomize}
      disabled={isPublicLibrary}
      data-testid="transport-randomize"
      className="flex shrink-0 items-center justify-center rounded-md bg-[#171717] p-2 text-white/75 transition-colors hover:bg-[#f5f5f5] hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
      title={isPublicLibrary ? 'Locked in public build' : 'Randomize'}
    >
      <Shuffle size={16} />
    </button>
    <button
      onClick={onReset}
      disabled={isPublicLibrary}
      data-testid="transport-reset"
      className="flex shrink-0 items-center justify-center rounded-md bg-[#171717] p-2 text-white/75 transition-colors hover:bg-[#f5f5f5] hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
      title={isPublicLibrary ? 'Locked in public build' : 'Reset'}
    >
      <RefreshCw size={16} />
    </button>
    <MacroStrip config={config} isPublicLibrary={isPublicLibrary} updateConfig={updateConfig} />
    <button
      type="button"
      data-testid="sheet-toggle"
      aria-expanded={expanded}
      onClick={onToggleExpanded}
      className="flex shrink-0 items-center justify-center gap-1 rounded-md p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      title={expanded ? '詳細パネルをたたむ' : '詳細パネルを開く'}
    >
      {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      <span className="hidden text-[11px] tracking-wider sm:inline">{expanded ? 'たたむ' : '詳細'}</span>
    </button>
  </div>
);

/**
 * RIGHT edge — the preset shelf as its own collapsible side panel
 * (~320px when open): header, the scrollable shelf (search, category
 * chips, tag chips, preset cards with pins), and the export cluster
 * (Save Image / Copy PNG / Transparent BG / Resolution — the deck
 * footer) pinned at the panel bottom. Collapsed it is a slim handle
 * strip on the right edge. On small screens the open panel becomes a
 * near-full-width overlay drawer (styles.css).
 */
export const ControlPanelShelf: React.FC<{
  activePresetId: string | null;
  config: ParticleConfig;
  faded: boolean;
  fx: EdgeFxProps;
  glossBoost: number;
  isPublicLibrary: boolean;
  onLoadPreset: (presetId: string) => void;
  onLoadGeneratedPreset?: (presetId: string) => Promise<boolean>;
  onSave: () => void;
  onToggleOpen: () => void;
  open: boolean;
  presets: PresetRecord[];
  updateConfig: UpdateConfig;
}> = ({
  activePresetId,
  config,
  faded,
  fx,
  glossBoost,
  isPublicLibrary,
  onLoadPreset,
  onLoadGeneratedPreset,
  onSave,
  onToggleOpen,
  open,
  presets,
  updateConfig,
}) => {
  if (!open) {
    return (
      <button
        type="button"
        {...fx}
        style={mgGlassStyle(glossBoost)}
        data-testid="shelf-open"
        onClick={onToggleOpen}
        className={`mg-edge mg-shelf-handle ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex h-full w-full flex-col items-center gap-2 py-3 text-white/70 transition-colors hover:text-white`}
        title="プリセット棚を開く"
      >
        <ChevronLeft size={14} />
        <Library size={15} />
        <span className="text-[9px] uppercase tracking-[0.2em] [writing-mode:vertical-rl]">Shelf</span>
      </button>
    );
  }
  return (
    <div {...fx} style={mgGlassStyle(glossBoost)} className={`mg-edge mg-shelf-panel ${MG_EDGE_PANEL_CLASS} ${mgFadeClass(faded)} flex h-full w-full flex-col`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-white/[0.02] px-4 py-2.5">
        <Library size={13} className="shrink-0 text-white/50" />
        <span className="min-w-0 text-[11px] font-semibold uppercase leading-[1.3] tracking-[0.14em] text-white/75">Preset Shelf · プリセット棚</span>
        <span className="flex-1" />
        <a
          href="/catalog/"
          target="_blank"
          rel="noreferrer"
          data-testid="shelf-catalog-link"
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          title="生成プリセットのカタログ（ギャラリー）を新しいタブで開く"
        >
          Catalog
          <ExternalLink size={12} />
        </a>
        <button
          type="button"
          data-testid="shelf-close"
          onClick={onToggleOpen}
          className="flex items-center justify-center rounded-md p-1.5 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          title="プリセット棚をたたむ"
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <PresetShelf bare presets={presets} activePresetId={activePresetId} onLoadPreset={onLoadPreset} onLoadGeneratedPreset={onLoadGeneratedPreset} />
      </div>
      <ControlPanelFooter config={config} isPublicLibrary={isPublicLibrary} onSave={onSave} updateConfig={updateConfig} />
    </div>
  );
};

export const ControlPanelFooter: React.FC<{
  config: ParticleConfig;
  isPublicLibrary: boolean;
  onSave: () => void;
  updateConfig: <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => void;
}> = ({ config, isPublicLibrary, onSave, updateConfig }) => {
  // Copy PNG (tech batch): rendered only where ClipboardItem PNG writes
  // exist. The capture itself runs inside the R3F ScreenshotManager, which
  // listens for the event and reports the outcome back.
  const copySupported = isPngClipboardSupported();
  const [copyNote, setCopyNote] = React.useState('');
  React.useEffect(() => {
    if (!copySupported) return undefined;
    const onResult = (event: Event) => {
      const ok = (event as CustomEvent<{ ok?: boolean }>).detail?.ok;
      setCopyNote(ok ? 'PNGをコピーしました' : 'コピーできませんでした');
      window.setTimeout(() => setCopyNote(''), 3000);
    };
    window.addEventListener('kalokagathia:copy-png-result', onResult);
    return () => window.removeEventListener('kalokagathia:copy-png-result', onResult);
  }, [copySupported]);
  return (
  <div className="mg-footer border-t border-white/10 bg-black/30 px-5 py-5 sm:px-6">
    <button
      onClick={onSave}
      data-testid="deck-save"
      className="mg-save-btn flex w-full items-center justify-center gap-2 rounded-lg bg-[#f5f5f5] py-3 text-black transition-colors hover:bg-[#262626] hover:text-white"
    >
      <Download size={16} /> Save Image (High-Res)
    </button>
    {copySupported && (
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          data-testid="deck-copy-png"
          onClick={() => {
            setCopyNote('コピー中…');
            window.dispatchEvent(new CustomEvent('kalokagathia:copy-png'));
          }}
          className="flex items-center justify-center gap-2 rounded-lg border border-white/25 px-4 py-2 text-[11px] tracking-wider text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="いまの画面をPNG画像としてクリップボードにコピーします"
        >
          <ClipboardCopy size={14} /> Copy PNG
        </button>
        {copyNote && <span className="text-[10px] tracking-wider text-emerald-300/90">{copyNote}</span>}
      </div>
    )}
    <div className="mg-footer-secondary mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="flex items-center justify-between rounded-lg bg-[#171717] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/45">
        <span>Transparent BG</span>
        <button
          onClick={() => updateConfig('exportTransparent', !config.exportTransparent)}
          disabled={isPublicLibrary}
          className={`relative h-5 w-9 rounded-full transition-colors ${config.exportTransparent ? 'bg-white' : 'bg-white/20'} disabled:cursor-not-allowed disabled:opacity-30`}
        >
          <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-black transition-all ${config.exportTransparent ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-[#171717] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/45 lg:justify-end lg:gap-4">
        <span>Resolution</span>
        <div className="flex gap-3 font-mono">
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 1)} className={`${config.exportScale === 1 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>1x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 2)} className={`${config.exportScale === 2 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>2x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 4)} className={`${config.exportScale === 4 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>4x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 8)} className={`${config.exportScale === 8 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>8x</button>
        </div>
      </div>
    </div>
    <div className="mt-4 text-center">
      <a
        href={NOTE_GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] tracking-wider text-white/45 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
      >
        技術・機能の網羅解説（note）→
      </a>
    </div>
  </div>
  );
};
