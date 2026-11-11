import React from 'react';
import type { SequenceTransitionEasing } from '../types';

const getEasingPreviewValue = (progress: number, easing: SequenceTransitionEasing) => {
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-in':
      return progress * progress * progress;
    case 'ease-out':
      return 1 - Math.pow(1 - progress, 3);
    case 'ease-in-out':
    default:
      return progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }
};

export const EasingPreview: React.FC<{ easing: SequenceTransitionEasing }> = ({ easing }) => {
  const points = Array.from({ length: 25 }, (_, index) => {
    const progress = index / 24;
    const eased = getEasingPreviewValue(progress, easing);
    const x = 6 + progress * 108;
    const y = 42 - eased * 32;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="rounded border border-white/10 bg-black/10 px-3 py-2">
      <div className="mb-2 flex items-center justify-between text-[9px] uppercase tracking-[0.24em] text-white/45">
        <span>Curve Preview</span>
        <span>{easing}</span>
      </div>
      <svg viewBox="0 0 120 48" className="h-12 w-full overflow-visible">
        <path d="M6 42 L114 42" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <path d="M6 42 L6 10" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points}
          className="text-white/80"
        />
        <circle cx="6" cy="42" r="2" className="fill-white/55" />
        <circle cx="114" cy="10" r="2" className="fill-white" />
      </svg>
    </div>
  );
};
