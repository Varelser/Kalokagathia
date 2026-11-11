import React, { useState } from 'react';
import {
  Box,
  Cone,
  Cylinder,
  Disc,
  Dna,
  Globe,
  Grid,
  LifeBuoy,
  LocateFixed,
  LucideIcon,
  Orbit,
  Sliders,
  Sparkles,
  Square,
  Target,
} from 'lucide-react';
import type { Layer3Source } from '../types';
import { Slider } from './controlPanelPartsCore';

export const SourcePositionConfig: React.FC<{
  count: number;
  positions: {x: number, y: number, z: number}[];
  onChange: (index: number, axis: 'x'|'y'|'z', val: number) => void;
  currentTheme: 'white' | 'black';
}> = ({ count, positions = [], onChange, currentTheme }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const validIndex = Math.min(Math.max(0, selectedIndex), count - 1);
  const pos = positions?.[validIndex] || { x: 0, y: 0, z: 0 };

  return (
    <div className="mb-5 p-3 bg-white/5 rounded border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-70">
          <LocateFixed size={12} /> Source Position Offset
        </div>
        <select
          value={validIndex}
          onChange={(e) => setSelectedIndex(parseInt(e.target.value, 10))}
          className={`text-[10px] font-mono font-bold p-1 rounded border-none outline-none cursor-pointer ${
            currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
          }`}
        >
          {Array.from({ length: Math.min(count, 20) }).map((_, i) => (
            <option key={i} value={i}>Source {i + 1}</option>
          ))}
        </select>
      </div>
      <Slider label={`Src ${validIndex + 1} Offset X`} value={pos.x} min={-5000} max={5000} step={10} onChange={(v) => onChange(validIndex, 'x', v)} />
      <Slider label={`Src ${validIndex + 1} Offset Y`} value={pos.y} min={-5000} max={5000} step={10} onChange={(v) => onChange(validIndex, 'y', v)} />
      <Slider label={`Src ${validIndex + 1} Offset Z`} value={pos.z} min={-5000} max={5000} step={10} onChange={(v) => onChange(validIndex, 'z', v)} />
      <div className="text-[9px] text-white/40 text-center mt-1">
        Tip: Set 'Source Spread' to 0 for absolute manual positioning.
      </div>
    </div>
  );
};

export const LayerAttributeSettings: React.FC<{
  count: number;
  counts: number[];
  sizes: number[];
  radiusScales: number[];
  speeds: number[];
  amps: number[];
  freqs: number[];
  updateCount: (idx: number, v: number) => void;
  updateSize: (idx: number, v: number) => void;
  updateRadius: (idx: number, v: number) => void;
  updateSpeed: (idx: number, v: number) => void;
  updateAmp: (idx: number, v: number) => void;
  updateFreq: (idx: number, v: number) => void;
  currentTheme: 'white' | 'black';
}> = ({
  count, counts, sizes, radiusScales, speeds, amps, freqs,
  updateCount, updateSize, updateRadius, updateSpeed, updateAmp, updateFreq,
  currentTheme,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const validIndex = Math.min(Math.max(0, selectedIndex), count - 1);

  return (
    <div className="mb-5 p-3 bg-white/5 rounded border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-70">
          <Sliders size={12} /> Per-Source Factors (Multipliers)
        </div>
        <select
          value={validIndex}
          onChange={(e) => setSelectedIndex(parseInt(e.target.value, 10))}
          className={`text-[10px] font-mono font-bold p-1 rounded border-none outline-none cursor-pointer ${
            currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
          }`}
        >
          {Array.from({ length: Math.min(count, 20) }).map((_, i) => (
            <option key={i} value={i}>Source {i + 1}</option>
          ))}
        </select>
      </div>
      <Slider label={`Src ${validIndex + 1} Count`} value={counts[validIndex] ?? 5000} min={100} max={1000000} step={100} onChange={(v) => updateCount(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Size Scale`} value={sizes[validIndex] ?? 1.0} min={0.1} max={50.0} step={0.1} onChange={(v) => updateSize(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Radius Scale`} value={radiusScales[validIndex] ?? 1.0} min={0.1} max={50.0} step={0.01} onChange={(v) => updateRadius(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Speed Scale`} value={speeds[validIndex] ?? 1.0} min={0.1} max={20.0} step={0.1} onChange={(v) => updateSpeed(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Amp Scale`} value={amps[validIndex] ?? 1.0} min={0.1} max={20.0} step={0.1} onChange={(v) => updateAmp(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Freq Scale`} value={freqs[validIndex] ?? 1.0} min={0.1} max={20.0} step={0.1} onChange={(v) => updateFreq(validIndex, v)} />
    </div>
  );
};

export const Layer1SourceSettings: React.FC<{
  count: number;
  counts: number[];
  radii: number[];
  volumes: number[];
  jitters: number[];
  sizes: number[];
  pulseSpeeds: number[];
  pulseAmps: number[];
  updateCount: (idx: number, v: number) => void;
  updateRadius: (idx: number, v: number) => void;
  updateVolume: (idx: number, v: number) => void;
  updateJitter: (idx: number, v: number) => void;
  updateSize: (idx: number, v: number) => void;
  updatePulseSpeed: (idx: number, v: number) => void;
  updatePulseAmp: (idx: number, v: number) => void;
  currentTheme: 'white' | 'black';
}> = ({
  count, counts = [], radii = [], volumes = [], jitters = [], sizes = [], pulseSpeeds = [], pulseAmps = [],
  updateCount, updateRadius, updateVolume, updateJitter, updateSize, updatePulseSpeed, updatePulseAmp,
  currentTheme,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const validIndex = Math.min(Math.max(0, selectedIndex), count - 1);

  return (
    <div className="mb-5 p-3 bg-white/5 rounded border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-70">
          <Sliders size={12} /> Per-Source Factors (Multipliers)
        </div>
        <select
          value={validIndex}
          onChange={(e) => setSelectedIndex(parseInt(e.target.value, 10))}
          className={`text-[10px] font-mono font-bold p-1 rounded border-none outline-none cursor-pointer ${
            currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
          }`}
        >
          {Array.from({ length: Math.min(count, 20) }).map((_, i) => (
            <option key={i} value={i}>Source {i + 1}</option>
          ))}
        </select>
      </div>
      <Slider label={`Src ${validIndex + 1} Count`} value={counts[validIndex] ?? 5000} min={100} max={1000000} step={100} onChange={(v) => updateCount(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Radius Scale`} value={radii[validIndex] ?? 1.0} min={0.1} max={10.0} step={0.1} onChange={(v) => updateRadius(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Size Scale`} value={sizes[validIndex] ?? 1.0} min={0.1} max={10.0} step={0.1} onChange={(v) => updateSize(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Vol Density`} value={volumes[validIndex] ?? 1.0} min={0} max={1} step={0.001} onChange={(v) => updateVolume(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Chaos Scale`} value={jitters[validIndex] ?? 1.0} min={0.1} max={10.0} step={0.1} onChange={(v) => updateJitter(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Speed Scale`} value={pulseSpeeds[validIndex] ?? 1.0} min={0.1} max={10.0} step={0.1} onChange={(v) => updatePulseSpeed(validIndex, v)} />
      <Slider label={`Src ${validIndex + 1} Amp Scale`} value={pulseAmps[validIndex] ?? 1.0} min={0.1} max={10.0} step={0.1} onChange={(v) => updatePulseAmp(validIndex, v)} />
    </div>
  );
};

export const SourceSelector: React.FC<{
  value: Layer3Source;
  onChange: (val: Layer3Source) => void;
}> = ({ value, onChange }) => {
  const options: { id: Layer3Source; label: string; icon: LucideIcon }[] = [
    { id: 'sphere', label: 'Sphere', icon: Globe },
    { id: 'center', label: 'Center', icon: Target },
    { id: 'ring', label: 'Ring', icon: Disc },
    { id: 'cube', label: 'Cube', icon: Box },
    { id: 'cylinder', label: 'Cyl', icon: Cylinder },
    { id: 'cone', label: 'Cone', icon: Cone },
    { id: 'torus', label: 'Torus', icon: LifeBuoy },
    { id: 'spiral', label: 'Helix', icon: Dna },
    { id: 'galaxy', label: 'Galaxy', icon: Orbit },
    { id: 'grid', label: 'Grid', icon: Grid },
    { id: 'plane', label: 'Plane', icon: Square },
    { id: 'image', label: 'Image', icon: Square },
    { id: 'video', label: 'Video', icon: Square },
    { id: 'text', label: 'Text', icon: Square },
    { id: 'random', label: 'Rnd', icon: Sparkles },
  ];

  return (
    <div className="mb-5">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">
        Emitter Shape
      </div>
      <div className="grid grid-cols-4 gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`flex flex-col items-center justify-center py-2 border transition-all duration-200 ${
              value === opt.id
                ? 'bg-white text-black border-transparent opacity-100 scale-105 shadow-lg'
                : 'border-white/20 bg-transparent text-white/60 hover:text-white hover:border-white/50'
            }`}
          >
            <opt.icon size={14} className="mb-1" />
            <span className="text-[8px] uppercase font-bold">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
