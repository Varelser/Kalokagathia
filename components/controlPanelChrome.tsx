import React from 'react';
import {
  Bot,
  ChevronRight,
  Download,
  Globe,
  Haze,
  Layers,
  LucideIcon,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Shuffle,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { ParticleConfig } from '../types';
import { ControlPanelTab } from './controlPanelParts';

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

export const PanelTierSwitch: React.FC<{
  tier: PanelTier;
  onSelectTier: (tier: PanelTier) => void;
}> = ({ tier, onSelectTier }) => (
  <div className="mg-tier-switch mb-3 grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1" title="表示階層（Play / Design / Lab）">
    {PANEL_TIERS.map((entry) => (
      <button
        key={entry.id}
        onClick={() => onSelectTier(entry.id)}
        className={`rounded-xl px-1 py-1.5 text-[9px] uppercase tracking-[0.14em] transition-all ${
          tier === entry.id ? 'bg-white text-black font-semibold' : 'text-white/50 hover:bg-white/[0.07] hover:text-white'
        }`}
      >
        {entry.label}
      </button>
    ))}
  </div>
);

export const ControlPanelTrigger: React.FC<{
  backgroundColor: ParticleConfig['backgroundColor'];
  activeTab: ControlPanelTab;
  onSelectTab: (tab: ControlPanelTab) => void;
  onOpen: () => void;
  tier?: PanelTier;
}> = ({ backgroundColor, activeTab, onSelectTab, onOpen, tier = 'lab' }) => {
  const dockClass = `absolute right-4 top-1/2 z-50 -translate-y-1/2 rounded-[24px] border px-2 py-3 shadow-2xl transition-all ${
    backgroundColor === 'white'
      ? 'bg-white/75 border-black/10 text-black'
      : 'bg-black/70 border-white/10 text-white'
  }`;
  const activeId = activeTab;

  return (
    <div className={dockClass}>
      <button
        onClick={onOpen}
        className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border transition-all ${
          backgroundColor === 'white'
            ? 'border-black/10 bg-black text-white hover:bg-black/85'
            : 'border-white/10 bg-white text-black hover:bg-white/85'
        }`}
        title="Open control panel"
      >
        <Settings2 size={18} />
      </button>
      <div className="flex flex-col gap-1.5">
        {getTabsForTier(tier).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onSelectTab(tab.id);
              onOpen();
            }}
            className={`flex h-11 w-12 items-center justify-center rounded-2xl border text-[10px] uppercase tracking-[0.2em] transition-all ${
              activeId === tab.id
                ? backgroundColor === 'white'
                  ? 'border-black/15 bg-black/10 text-black'
                  : 'border-white/20 bg-white/10 text-white'
                : backgroundColor === 'white'
                  ? 'border-black/5 text-black/55 hover:border-black/10 hover:bg-black/5 hover:text-black'
                  : 'border-white/5 text-white/45 hover:border-white/10 hover:bg-white/5 hover:text-white'
            }`}
            title={tab.label}
          >
            <tab.icon size={15} />
          </button>
        ))}
      </div>
    </div>
  );
};

export const ControlPanelRail: React.FC<{
  activeTab: ControlPanelTab;
  isWide: boolean;
  onClose: () => void;
  onSelectTab: (tab: ControlPanelTab) => void;
  onToggleWidth: () => void;
  tier?: PanelTier;
  onSelectTier?: (tier: PanelTier) => void;
}> = ({ activeTab, isWide, onClose, onSelectTab, onToggleWidth, tier = 'lab', onSelectTier }) => (
  <div className="mg-rail pointer-events-auto mr-3 hidden h-full w-[84px] shrink-0 rounded-[28px] border border-white/25 bg-[linear-gradient(165deg,rgba(255,255,255,0.13),rgba(255,255,255,0.02)_42%,rgba(0,0,0,0.10))] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.35),inset_0_22px_30px_-20px_rgba(255,255,255,0.28)] backdrop-blur-md backdrop-saturate-200 backdrop-blur-xl md:flex md:flex-col">
    <div className="mb-4 flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
      <Settings2 size={18} className="text-white/80" />
    </div>
    {onSelectTier && <PanelTierSwitch tier={tier} onSelectTier={onSelectTier} />}
    <div className="flex flex-1 flex-col gap-2">
      {getTabsForTier(tier).map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-[10px] uppercase tracking-[0.18em] transition-all ${
            activeTab === tab.id
              ? 'border-white/20 bg-white text-black shadow-[0_10px_40px_rgba(255,255,255,0.12)]'
              : 'border-white/5 bg-white/[0.03] text-white/55 hover:border-white/10 hover:bg-white/[0.07] hover:text-white'
          }`}
          title={tab.label}
        >
          <tab.icon size={16} />
          <span>{tab.shortLabel}</span>
        </button>
      ))}
    </div>
    <div className="mt-4 flex flex-col gap-2">
      <button
        onClick={onToggleWidth}
        className="flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        title={isWide ? 'Use compact width' : 'Use wide width'}
      >
        {isWide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <button
        onClick={onClose}
        className="flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        title="Collapse panel"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  </div>
);

export const ControlPanelHeader: React.FC<{
  activeTab: ControlPanelTab;
  isWide: boolean;
  isPublicLibrary: boolean;
  onClose: () => void;
  onToggleWidth: () => void;
}> = ({ activeTab, isWide, isPublicLibrary, onClose, onToggleWidth }) => {
  const activePanel = CONTROL_PANEL_TABS.find((tab) => tab.id === activeTab) ?? CONTROL_PANEL_TABS[0];
  return (
    <div className="mg-header border-b border-white/10 bg-white/[0.03] px-5 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mg-header-eyebrow mb-2 text-[10px] uppercase tracking-[0.35em] text-white/45">
            Kalokagathia Control Deck
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-light tracking-[0.12em] text-white">{activePanel.label}</h2>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
              {isPublicLibrary ? 'Exhibition' : 'Studio'}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
            {activePanel.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleWidth}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white md:hidden"
            title={isWide ? 'Use compact width' : 'Use wide width'}
          >
            {isWide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
            title="Collapse panel"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export const ControlPanelActions: React.FC<{
  isPlaying: boolean;
  isPublicLibrary: boolean;
  onRandomize: () => void;
  onReset: () => void;
  togglePlay: () => void;
}> = ({ isPlaying, isPublicLibrary, onRandomize, onReset, togglePlay }) => (
  <div className="mg-actions border-b border-white/10 px-5 py-4 sm:px-6">
    <div className="grid grid-cols-4 gap-2">
    <button
      onClick={togglePlay}
      data-testid="deck-play-toggle"
      className={`col-span-2 flex items-center justify-center gap-2 rounded-2xl py-3 font-semibold transition-colors ${
        isPlaying
          ? 'bg-gradient-to-b from-white via-white to-neutral-300 text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-10px_16px_-10px_rgba(0,0,0,0.28)] hover:brightness-95'
          : 'bg-red-500/80 text-white hover:bg-red-500'
      }`}
    >
      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      <span className="text-xs uppercase">{isPlaying ? 'Pause' : 'Play'}</span>
    </button>
    <button onClick={onRandomize} disabled={isPublicLibrary} className="col-span-1 flex items-center justify-center rounded-2xl border border-white/20 p-2 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30" title={isPublicLibrary ? 'Locked in public build' : 'Randomize'}>
      <Shuffle size={18} />
    </button>
    <button onClick={onReset} disabled={isPublicLibrary} className="col-span-1 flex items-center justify-center rounded-2xl border border-white/20 p-2 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30" title={isPublicLibrary ? 'Locked in public build' : 'Reset'}>
      <RefreshCw size={18} />
    </button>
    </div>
  </div>
);

export const ControlPanelTabBar: React.FC<{
  activeTab: ControlPanelTab;
  onSelectTab: (tab: ControlPanelTab) => void;
  tier?: PanelTier;
  onSelectTier?: (tier: PanelTier) => void;
}> = ({ activeTab, onSelectTab, tier = 'lab', onSelectTier }) => (
  <div className="mg-tabbar border-b border-white/10 md:hidden">
    {/* Mobile/touch (item 9): the tier switch lives only in the desktop
        rail, which is hidden below md — surface it here so tiers (and the
        Lab-only tabs) are reachable by tap on small screens. */}
    {onSelectTier && (
      <div className="px-4 pt-3">
        <PanelTierSwitch tier={tier} onSelectTier={onSelectTier} />
      </div>
    )}
    <div className="mg-tabbar-row flex gap-2 overflow-x-auto px-4">
      {getTabsForTier(tier).map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex flex-1 justify-center items-center gap-1.5 pb-3 text-[10px] uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === tab.id
              ? 'border-white text-white'
              : 'border-transparent text-white/40 hover:text-white/70'
          }`}
        >
          <tab.icon size={14} />
          {tab.label}
        </button>
      ))}
    </div>
  </div>
);

export const ControlPanelFooter: React.FC<{
  config: ParticleConfig;
  isPublicLibrary: boolean;
  onSave: () => void;
  updateConfig: <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => void;
}> = ({ config, isPublicLibrary, onSave, updateConfig }) => (
  <div className="mg-footer border-t border-white/10 bg-black/30 px-5 py-5 sm:px-6">
    <button
      onClick={onSave}
      data-testid="deck-save"
      className="mg-save-btn flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-white via-white to-neutral-300 py-3 text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-10px_16px_-10px_rgba(0,0,0,0.28)] transition hover:brightness-95"
    >
      <Download size={16} /> Save Image (High-Res)
    </button>
    <div className="mg-footer-secondary mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/45">
        <span>Transparent BG</span>
        <button
          onClick={() => updateConfig('exportTransparent', !config.exportTransparent)}
          disabled={isPublicLibrary}
          className={`relative h-5 w-9 rounded-full transition-colors ${config.exportTransparent ? 'bg-white' : 'bg-white/20'} disabled:cursor-not-allowed disabled:opacity-30`}
        >
          <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-black transition-all ${config.exportTransparent ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-white/45 lg:justify-end lg:gap-4">
        <span>Resolution</span>
        <div className="flex gap-3 font-mono">
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 1)} className={`${config.exportScale === 1 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>1x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 2)} className={`${config.exportScale === 2 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>2x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 4)} className={`${config.exportScale === 4 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>4x</button>
          <button disabled={isPublicLibrary} onClick={() => updateConfig('exportScale', 8)} className={`${config.exportScale === 8 ? 'text-white underline' : ''} disabled:no-underline disabled:opacity-30`}>8x</button>
        </div>
      </div>
    </div>
  </div>
);
