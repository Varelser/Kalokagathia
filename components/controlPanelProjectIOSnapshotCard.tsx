import React from 'react';
import { Camera } from 'lucide-react';
import type { SnapshotSlot } from './controlPanelTypes';

export const SnapshotCard: React.FC<{
  slotIndex: number;
  slot: SnapshotSlot;
  onCaptureSnapshot: (slotIndex: number) => void;
  onLoadSnapshot: (slotIndex: number) => void;
  onMorphSnapshot: (slotIndex: number) => void;
  onClearSnapshot: (slotIndex: number) => void;
  onRenameSnapshot: (slotIndex: number, label: string) => void;
  onSetSnapshotNote: (slotIndex: number, note: string) => void;
}> = ({ slotIndex, slot, onCaptureSnapshot, onLoadSnapshot, onMorphSnapshot, onClearSnapshot, onRenameSnapshot, onSetSnapshotNote }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">{String.fromCharCode(65 + slotIndex)}</div>
      <button onClick={() => onCaptureSnapshot(slotIndex)} className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-white/65 hover:bg-white/5">
        <Camera size={10} className="mr-1 inline" /> Capture
      </button>
    </div>
    {slot ? (
      <>
        <input
          value={slot.label}
          onChange={(event) => onRenameSnapshot(slotIndex, event.target.value)}
          className="mb-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/80 outline-none focus:border-cyan-300/35"
          placeholder={`Snapshot ${String.fromCharCode(65 + slotIndex)}`}
        />
        <div className="mb-2 text-[10px] text-white/45">
          {new Date(slot.capturedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <textarea
          value={slot.note}
          onChange={(event) => onSetSnapshotNote(slotIndex, event.target.value)}
          rows={2}
          className="mb-2 w-full resize-none rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/75 outline-none focus:border-cyan-300/35"
          placeholder="What changed here?"
        />
      </>
    ) : (
      <div className="mb-2 min-h-[3.6rem] text-[10px] text-white/45">No snapshot captured yet.</div>
    )}
    <div className="grid grid-cols-3 gap-1">
      <button disabled={!slot} onClick={() => onLoadSnapshot(slotIndex)} className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-white/65 disabled:opacity-30 hover:bg-white/5">Load</button>
      <button disabled={!slot} onClick={() => onMorphSnapshot(slotIndex)} className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-white/65 disabled:opacity-30 hover:bg-white/5">Morph</button>
      <button disabled={!slot} onClick={() => onClearSnapshot(slotIndex)} className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-white/65 disabled:opacity-30 hover:bg-white/5">Clear</button>
    </div>
  </div>
);
