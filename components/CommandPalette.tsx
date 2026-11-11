// Command palette (⌘K / Ctrl+K): one search box over the whole app —
// presets by name (Enter loads one) and the numeric parameter catalog
// (Enter jumps to the tab that owns the parameter). It upgrades the Play
// tab's parameter search into a global, keyboard-first launcher: open
// with ⌘K from anywhere, type, ↑/↓ to choose, Enter to act, Esc to close.

import React from 'react';
import type { PresetRecord } from '../types';
import { searchParameters, type ParameterCatalogEntry } from '../lib/parameterCatalog';
import type { ControlPanelTab } from './controlPanelParts';

type PaletteItem =
  | { kind: 'preset'; id: string; title: string; hint: string; presetId: string }
  | { kind: 'parameter'; id: string; title: string; hint: string; entry: ParameterCatalogEntry };

const MAX_PRESETS = 8;
const MAX_PARAMETERS = 8;

export const CommandPalette: React.FC<{
  presets: PresetRecord[];
  onLoadPreset: (presetId: string) => void;
  onJumpToTab?: (tab: ControlPanelTab) => void;
  onRevealParameter?: (entry: ParameterCatalogEntry) => void;
}> = ({ presets, onLoadPreset, onJumpToTab, onRevealParameter }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((prev) => {
          if (!prev) {
            setQuery('');
            setSelectedIndex(0);
          }
          return !prev;
        });
      } else if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  const items = React.useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const presetItems: PaletteItem[] = presets
      .filter((preset) => q === '' || preset.name.toLowerCase().includes(q))
      .slice(0, MAX_PRESETS)
      .map((preset) => ({
        kind: 'preset' as const,
        id: `preset:${preset.id}`,
        title: preset.name,
        hint: 'プリセットを読み込む',
        presetId: preset.id,
      }));
    const parameterItems: PaletteItem[] = (q === '' ? [] : searchParameters(query, MAX_PARAMETERS)).map((entry) => ({
      kind: 'parameter' as const,
      id: `param:${entry.tab}:${entry.key}`,
      title: entry.label,
      hint: entry.description
        ? `${entry.description} · ${entry.tab} の設定へジャンプ`
        : `${entry.key} · ${entry.tab} の設定へジャンプ`,
      entry,
    }));
    return [...presetItems, ...parameterItems];
  }, [presets, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

  if (!isOpen) {
    return null;
  }

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === 'preset') {
      onLoadPreset(item.presetId);
    } else {
      onJumpToTab?.(item.entry.tab);
      onRevealParameter?.(item.entry);
    }
    setIsOpen(false);
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runItem(items[clampedIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh] px-4"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-900/95 text-white shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
          onKeyDown={onInputKeyDown}
          placeholder="プリセット名・パラメータ名で検索…（例: vortex, bloom）"
          className="w-full bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-white/30 border-b border-white/10"
        />
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <p className="px-4 py-3 text-[11px] text-white/40">該当するプリセット／パラメータがありません。</p>
          )}
          {items.map((item, index) => (
            <button
              key={item.id}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => runItem(item)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left ${index === clampedIndex ? 'bg-white/10' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{item.title}</span>
                <span className="block truncate font-mono text-[9px] text-white/35">{item.hint}</span>
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${item.kind === 'preset' ? 'border-white/25 text-white/60' : 'border-white/15 text-white/40'}`}>
                {item.kind === 'preset' ? 'Preset' : 'Param'}
              </span>
            </button>
          ))}
        </div>
        <p className="px-4 py-2 text-[10px] text-white/30 border-t border-white/10">
          ↑↓ 選択 · Enter 実行 · Esc 閉じる · ⌘K / Ctrl+K で開閉
        </p>
      </div>
    </div>
  );
};
