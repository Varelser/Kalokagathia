import React, { useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  dismissGpuTierWarning,
  getGpuTierWarnings,
  subscribeGpuTierWarnings,
} from '../lib/gpuTierWarnings';

/**
 * Renders queued GPU-tier warnings (lib/gpuTierWarnings.ts) as a small
 * stack of dismissible amber banners. Non-blocking by design: the canvas
 * and deck stay fully interactive underneath. Positioned top-right on
 * small screens (the deck is a bottom sheet there) and bottom-right on
 * larger screens.
 */
export const GpuTierWarningHost: React.FC = () => {
  const warnings = useSyncExternalStore(
    subscribeGpuTierWarnings,
    getGpuTierWarnings,
    getGpuTierWarnings,
  );
  if (warnings.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(92vw,22rem)] flex-col gap-2 sm:bottom-3 sm:top-auto">
      {warnings.map((warning) => (
        <div
          key={warning.id}
          className="pointer-events-auto rounded border border-amber-200/30 bg-black/85 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/90 shadow-lg"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="flex-1">{warning.message}</p>
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => dismissGpuTierWarning(warning.id, false)}
              className="shrink-0 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white/85"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => dismissGpuTierWarning(warning.id, true)}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/10"
            >
              今後表示しない
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
