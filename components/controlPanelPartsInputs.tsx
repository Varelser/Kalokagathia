import React from 'react';

export const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <div className="mb-4">
    <div className="flex justify-between mb-1.5 text-[10px] uppercase tracking-widest font-medium opacity-70">
      <span>{label}</span>
      <span className="font-mono">{value.toFixed(step < 0.1 ? 3 : 1)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-current rounded-lg appearance-none cursor-pointer focus:outline-none opacity-50 hover:opacity-100 transition-opacity"
      style={{ accentColor: 'currentColor' }}
    />
  </div>
);

export const Toggle = <T extends string | boolean | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; val: T }[];
  onChange: (val: T) => void;
}) => (
  <div className="mb-5">
    <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">
      {label}
    </div>
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={String(opt.val)}
          onClick={() => onChange(opt.val)}
          className={`flex-1 py-1.5 text-[10px] font-bold border uppercase transition-all duration-200 ${
            value === opt.val
              ? 'bg-white text-black border-transparent opacity-100'
              : 'border-white/30 bg-transparent text-white opacity-50 hover:opacity-80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

export const SynthPatternEditor: React.FC<{
  pattern: number[];
  onChange: (nextPattern: number[]) => void;
}> = ({ pattern, onChange }) => (
  <div className="mb-5">
    <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">
      Synth Pattern
    </div>
    <div className="grid grid-cols-4 gap-2">
      {pattern.map((value, index) => (
        <div key={index} className="rounded border border-white/10 bg-black/10 p-2">
          <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-white/45">
            <span>Step {index + 1}</span>
            <span className="font-mono">{value}</span>
          </div>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            value={value}
            onChange={(event) => {
              const nextPattern = [...pattern];
              nextPattern[index] = parseInt(event.target.value, 10);
              onChange(nextPattern);
            }}
            className="w-full h-1 bg-current rounded-lg appearance-none cursor-pointer focus:outline-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ accentColor: 'currentColor' }}
          />
        </div>
      ))}
    </div>
  </div>
);
