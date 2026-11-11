import React from 'react';
import { Copy, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import type { PresetRecord } from '../types';

type ControlPanelPresetCardProps = {
  activePresetId: string | null;
  categories: string[];
  editingPresetId: string | null;
  editingPresetName: string;
  formatPresetDate: (value: string) => string;
  handleStartRename: (preset: PresetRecord) => void;
  handleSubmitRename: (presetId: string) => void;
  isPresetDirty: boolean;
  isPublicLibrary: boolean;
  onAddPresetToSequence: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onDuplicatePreset: (presetId: string) => void;
  onLoadPreset: (presetId: string) => void;
  onTransitionToPreset: (presetId: string) => void;
  performanceTier: 'light' | 'medium' | 'heavy';
  preset: PresetRecord;
  setEditingPresetId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingPresetName: React.Dispatch<React.SetStateAction<string>>;
};

export const ControlPanelPresetCard: React.FC<ControlPanelPresetCardProps> = ({
  activePresetId,
  categories,
  editingPresetId,
  editingPresetName,
  formatPresetDate,
  handleStartRename,
  handleSubmitRename,
  isPresetDirty,
  isPublicLibrary,
  onAddPresetToSequence,
  onDeletePreset,
  onDuplicatePreset,
  onLoadPreset,
  onTransitionToPreset,
  performanceTier,
  preset,
  setEditingPresetId,
  setEditingPresetName,
}) => {
  const isActive = preset.id === activePresetId;
  const isEditing = editingPresetId === preset.id;

  return (
    <div className={`rounded border transition-colors ${isActive ? 'border-white/35 bg-white/10' : 'border-white/10 bg-white/5'}`}>
      {isEditing ? (
        <div className="p-3 space-y-2">
          <input
            type="text"
            value={editingPresetName}
            onChange={(e) => setEditingPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmitRename(preset.id);
              }
              if (e.key === 'Escape') {
                setEditingPresetId(null);
                setEditingPresetName('');
              }
            }}
            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-xs outline-none focus:border-white/40"
          />
          <div className="flex gap-2">
            <button onClick={() => handleSubmitRename(preset.id)} className="flex-1 py-2 text-[10px] font-bold uppercase rounded bg-white text-black">
              Apply
            </button>
            <button
              onClick={() => {
                setEditingPresetId(null);
                setEditingPresetName('');
              }}
              className="flex-1 py-2 text-[10px] font-bold uppercase rounded border border-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button onClick={() => onLoadPreset(preset.id)} className="w-full text-left p-3 hover:bg-white/5 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide truncate">{preset.name}</div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/40">
                  Updated {formatPresetDate(preset.updatedAt)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {categories.slice(0, 4).map((category) => (
                    <span key={category} className="px-1.5 py-0.5 text-[8px] uppercase tracking-widest rounded border border-white/10 text-white/55">
                      {category}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full ${
                  performanceTier === 'heavy'
                    ? 'border border-red-300/30 text-red-200'
                    : performanceTier === 'medium'
                      ? 'border border-white/20 text-white/70'
                      : 'border border-white/10 text-white/45'
                }`}>
                  {performanceTier}
                </span>
                {isActive && (
                  <span className="px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full bg-white text-black">
                    Active
                  </span>
                )}
                {isActive && isPresetDirty && (
                  <span className="px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full border border-white/20 text-white/70">
                    Modified
                  </span>
                )}
              </div>
            </div>
          </button>
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={() => onLoadPreset(preset.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
            >
              <FolderOpen size={12} /> Load
            </button>
            <button
              onClick={() => onTransitionToPreset(preset.id)}
              className="flex-1 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
            >
              Morph
            </button>
            <button
              onClick={() => onAddPresetToSequence(preset.id)}
              disabled={isPublicLibrary}
              className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={isPublicLibrary ? 'Locked in public build' : 'Add to sequence'}
            >
              <Plus size={12} />
            </button>
            {!isPublicLibrary && (
              <>
                <button
                  onClick={() => onDuplicatePreset(preset.id)}
                  className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
                  title="Duplicate preset"
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => handleStartRename(preset)}
                  className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
                  title="Rename preset"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => onDeletePreset(preset.id)}
                  className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-red-400/30 text-red-200 hover:bg-red-400/10 transition-colors"
                  title="Delete preset"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
