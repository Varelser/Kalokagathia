import React from 'react';
import type { PresetSequenceItem, SequenceDriveMode, SequenceDriveStrengthMode, SequenceTransitionEasing } from '../types';
import { Slider, Toggle } from './controlPanelParts';

type ControlPanelSequenceItemEditableProps = {
  configScreenSequenceDriveStrength: number;
  item: PresetSequenceItem;
  onSequenceDriveModeChange: (itemId: string, mode: SequenceDriveMode) => void;
  onSequenceDriveMultiplierChange: (itemId: string, multiplier: number) => void;
  onSequenceDriveStrengthModeChange: (itemId: string, mode: SequenceDriveStrengthMode) => void;
  onSequenceDriveStrengthOverrideChange: (itemId: string, value: number) => void;
  onSequenceHoldChange: (itemId: string, holdSeconds: number) => void;
  onSequenceTransitionChange: (itemId: string, transitionSeconds: number) => void;
  onSequenceTransitionEasingChange: (itemId: string, transitionEasing: SequenceTransitionEasing) => void;
};

export const ControlPanelSequenceItemEditable: React.FC<ControlPanelSequenceItemEditableProps> = ({
  configScreenSequenceDriveStrength,
  item,
  onSequenceDriveModeChange,
  onSequenceDriveMultiplierChange,
  onSequenceDriveStrengthModeChange,
  onSequenceDriveStrengthOverrideChange,
  onSequenceHoldChange,
  onSequenceTransitionChange,
  onSequenceTransitionEasingChange,
}) => (
  <>
    <Slider label="Hold Seconds" value={item.holdSeconds} min={0.2} max={12} step={0.1} onChange={(value) => onSequenceHoldChange(item.id, value)} />
    <Slider label="Transition Seconds" value={item.transitionSeconds} min={0.05} max={8} step={0.05} onChange={(value) => onSequenceTransitionChange(item.id, value)} />
    <div className="mb-4">
      <div className="flex justify-between mb-1.5 text-[10px] uppercase tracking-widest font-medium opacity-70">
        <span>Transition Curve</span>
        <span className="font-mono">{item.transitionEasing}</span>
      </div>
      <select
        value={item.transitionEasing}
        onChange={(event) => onSequenceTransitionEasingChange(item.id, event.target.value as SequenceTransitionEasing)}
        className="w-full bg-black/20 border border-white/15 rounded px-3 py-2 text-[10px] font-bold uppercase tracking-widest outline-none focus:border-white/40"
      >
        <option value="linear">Linear</option>
        <option value="ease-in">Ease In</option>
        <option value="ease-out">Ease Out</option>
        <option value="ease-in-out">Ease In Out</option>
      </select>
    </div>
    <Toggle
      label="Drive Mode"
      value={item.screenSequenceDriveMode}
      options={[
        { label: 'Inherit', val: 'inherit' },
        { label: 'On', val: 'on' },
        { label: 'Off', val: 'off' },
      ]}
      onChange={(value) => onSequenceDriveModeChange(item.id, value as SequenceDriveMode)}
    />
    <Toggle
      label="Drive Strength"
      value={item.screenSequenceDriveStrengthMode}
      options={[
        { label: 'Inherit', val: 'inherit' },
        { label: 'Override', val: 'override' },
      ]}
      onChange={(value) => onSequenceDriveStrengthModeChange(item.id, value as SequenceDriveStrengthMode)}
    />
    {item.screenSequenceDriveStrengthMode === 'override' && (
      <Slider
        label="Drive Strength Value"
        value={item.screenSequenceDriveStrengthOverride ?? configScreenSequenceDriveStrength}
        min={0}
        max={1.5}
        step={0.01}
        onChange={(value) => onSequenceDriveStrengthOverrideChange(item.id, value)}
      />
    )}
    <Slider label="Drive Multiplier" value={item.screenSequenceDriveMultiplier} min={0} max={2} step={0.05} onChange={(value) => onSequenceDriveMultiplierChange(item.id, value)} />
  </>
);
