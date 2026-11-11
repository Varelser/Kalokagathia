import React from 'react';
import type { PresetSequenceItem } from '../types';

type ControlPanelSequenceItemReadonlyProps = {
  item: PresetSequenceItem;
};

export const ControlPanelSequenceItemReadonly: React.FC<ControlPanelSequenceItemReadonlyProps> = ({ item }) => (
  <div className="mb-4 grid gap-2 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
    <div className="flex items-center justify-between gap-2"><span>Hold</span><span className="font-mono">{item.holdSeconds.toFixed(2)} sec</span></div>
    <div className="flex items-center justify-between gap-2"><span>Transition</span><span className="font-mono">{item.transitionSeconds.toFixed(2)} sec</span></div>
    <div className="flex items-center justify-between gap-2"><span>Curve</span><span className="font-mono">{item.transitionEasing}</span></div>
    <div className="flex items-center justify-between gap-2"><span>Drive Mode</span><span className="font-mono">{item.screenSequenceDriveMode}</span></div>
    <div className="flex items-center justify-between gap-2"><span>Drive Strength</span><span className="font-mono">{item.screenSequenceDriveStrengthMode === 'override' && item.screenSequenceDriveStrengthOverride !== null ? item.screenSequenceDriveStrengthOverride.toFixed(2) : 'inherit'}</span></div>
    <div className="flex items-center justify-between gap-2"><span>Drive</span><span className="font-mono">x{item.screenSequenceDriveMultiplier.toFixed(2)}</span></div>
  </div>
);
