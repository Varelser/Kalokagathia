import React from 'react';
import { Download, FolderOpen, Share2 } from 'lucide-react';
import { Toggle } from './controlPanelParts';
import { NoticeBanner } from './controlPanelTabsShared';
import { PresetSyncSection } from './controlPanelPresetSync';
import type { Notice } from '../lib/audioControllerTypes';
import type { PresetRecord } from '../types';

type ControlPanelPresetLibraryIOProps = {
  handleLibraryFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  libraryImportMode: 'append' | 'replace';
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  libraryNotice: Notice | null;
  onDismissLibraryNotice: () => void;
  onExportLibrary: () => void;
  setLibraryImportMode: React.Dispatch<React.SetStateAction<'append' | 'replace'>>;
  /** Sync (item 8): present only in the private build's wiring. */
  presets?: PresetRecord[];
  onSyncApplyPresets?: (presets: PresetRecord[]) => void;
  onSyncNotice?: (notice: Notice) => void;
};

export const ControlPanelPresetLibraryIO: React.FC<ControlPanelPresetLibraryIOProps> = ({
  handleLibraryFileChange,
  libraryImportMode,
  libraryInputRef,
  libraryNotice,
  onDismissLibraryNotice,
  onExportLibrary,
  setLibraryImportMode,
  presets,
  onSyncApplyPresets,
  onSyncNotice,
}) => (
  <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70 mb-1">
      <Share2 size={12} /> Library Backup / I/O
    </div>
    <p className="text-[10px] leading-relaxed text-white/50 mb-3">
      ユーザープリセットのバックアップと復元。Export JSON でライブラリ全体をファイルに保存し、Import JSON で読み戻せます（Append = 追加 / Replace = 置換）。
    </p>
    <input
      ref={libraryInputRef}
      type="file"
      accept="application/json"
      onChange={handleLibraryFileChange}
      className="hidden"
    />
    <div className="grid grid-cols-2 gap-2 mb-3">
      <button
        onClick={onExportLibrary}
        className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <Download size={12} /> Export JSON
      </button>
      <button
        onClick={() => libraryInputRef.current?.click()}
        className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <FolderOpen size={12} /> Import JSON
      </button>
    </div>
    <Toggle
      label="Import Mode"
      value={libraryImportMode}
      options={[{ label: 'Append', val: 'append' }, { label: 'Replace', val: 'replace' }]}
      onChange={(value) => setLibraryImportMode(value)}
    />
    {presets && onSyncApplyPresets && onSyncNotice && (
      <PresetSyncSection presets={presets} onApplyPresets={onSyncApplyPresets} onNotice={onSyncNotice} />
    )}
    <NoticeBanner notice={libraryNotice} onDismiss={onDismissLibraryNotice} className="" />
  </div>
);
