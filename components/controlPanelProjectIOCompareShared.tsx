import React from 'react';
import { Eye, Lock, VolumeX } from 'lucide-react';
import type { LayerToggleState } from './controlPanelTypes';

export const LayerToggleRow: React.FC<{
  label: string;
  layerKey: keyof LayerToggleState;
  muted: boolean;
  locked: boolean;
  soloActive: boolean;
  onSolo: () => void;
  onToggleMute: (layer: keyof LayerToggleState) => void;
  onToggleLock: (layer: keyof LayerToggleState) => void;
}> = ({ label, layerKey, muted, locked, soloActive, onSolo, onToggleMute, onToggleLock }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">{label}</div>
      <button onClick={onSolo} className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${soloActive ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}>
        <Eye size={10} className="mr-1 inline" /> Solo
      </button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => onToggleMute(layerKey)} className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${muted ? 'border-amber-300/40 bg-amber-400/10 text-amber-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}>
        <VolumeX size={10} className="mr-1 inline" /> {muted ? 'Muted' : 'Mute'}
      </button>
      <button onClick={() => onToggleLock(layerKey)} className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${locked ? 'border-rose-300/40 bg-rose-400/10 text-rose-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}>
        <Lock size={10} className="mr-1 inline" /> {locked ? 'Locked' : 'Lock'}
      </button>
    </div>
  </div>
);
