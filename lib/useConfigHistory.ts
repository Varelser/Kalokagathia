import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParticleConfig } from '../types';

/**
 * Automatic config history (roadmap Phase 7D).
 *
 * Watches the live config and records a snapshot whenever it settles —
 * i.e. stops changing for `settleMs`. Because recording is settle-based,
 * preset morphs and slider drags only leave their final state in the
 * history, not every intermediate frame. Restoring an entry sets the
 * config back to that entry's JSON, which the watcher then recognizes as
 * the same state and does not record again. The history holds distinct
 * states: settling on a state that already exists anywhere in the strip
 * (for example by restoring an older card) does not append a duplicate.
 *
 * History is session-local (not persisted): it exists to catch "that
 * shape I had a minute ago" moments while working.
 */
export interface ConfigHistoryEntry {
  id: string;
  capturedAt: string;
  config: ParticleConfig;
  /** Cached serialization, used for identity comparisons. */
  json: string;
}

const MAX_ENTRIES = 16;
const SETTLE_MS = 900;

export function useConfigHistory(config: ParticleConfig) {
  const [entries, setEntries] = useState<ConfigHistoryEntry[]>(() => [
    {
      id: 'history-start',
      capturedAt: new Date().toISOString(),
      config,
      json: JSON.stringify(config),
    },
  ]);
  const timerRef = useRef<number | null>(null);
  const lastJsonRef = useRef<string>(JSON.stringify(config));

  useEffect(() => {
    const json = JSON.stringify(config);
    if (json === lastJsonRef.current) return;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      lastJsonRef.current = json;
      setEntries((prev) => {
        if (prev.some((entry) => entry.json === json)) return prev;
        const entry: ConfigHistoryEntry = {
          id: `history-${Date.now()}`,
          capturedAt: new Date().toISOString(),
          config,
          json,
        };
        return [...prev.slice(-(MAX_ENTRIES - 1)), entry];
      });
    }, SETTLE_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [config]);

  const clearHistory = useCallback(() => {
    setEntries((prev) => (prev.length > 0 ? [prev[prev.length - 1]] : prev));
  }, []);

  return { entries, clearHistory };
}
