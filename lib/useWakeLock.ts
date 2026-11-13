import { useCallback, useEffect, useRef, useState } from 'react';
import { isWakeLockSupported } from './platformFeatures';

// Wake Lock (tech batch, 2026-11-13): keep the screen awake while the app
// is playing. The toggle is a small standalone settings key — deliberately
// NOT one of the four IndexedDB payload keys (project / presets / sequence
// / product packs), so it stays a plain localStorage flag.
export const WAKE_LOCK_STORAGE_KEY = 'kalokagathia.wakeLock.v1';

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

const loadWakeLockEnabled = (): boolean => {
  try {
    return localStorage.getItem(WAKE_LOCK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export function useWakeLock(isPlaying: boolean) {
  const supported = isWakeLockSupported();
  const [enabled, setEnabledState] = useState<boolean>(loadWakeLockEnabled);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  const release = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel && !sentinel.released) {
      void sentinel.release().catch(() => { /* already released */ });
    }
  }, []);

  const request = useCallback(async () => {
    if (!supported || sentinelRef.current) return;
    try {
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLock) return;
      const sentinel = await wakeLock.request('screen');
      // The toggle may have been switched off while the request was in
      // flight; release immediately instead of leaking a held lock.
      if (!enabledRef.current || !playingRef.current) {
        void sentinel.release().catch(() => { /* ignore */ });
        return;
      }
      sentinelRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
      });
    } catch {
      // Permission / visibility errors are expected in background tabs and
      // headless browsers — the lock simply stays unheld, never an error.
    }
  }, [supported]);

  // Acquire while enabled + playing + visible; release on pause / disable.
  useEffect(() => {
    if (enabled && isPlaying && document.visibilityState === 'visible') {
      void request();
    } else {
      release();
    }
  }, [enabled, isPlaying, request, release]);

  // The browser drops the lock when the tab hides; re-acquire on return.
  useEffect(() => {
    if (!supported) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && enabledRef.current && playingRef.current) {
        void request();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [supported, request, release]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(WAKE_LOCK_STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: the toggle still applies for this session */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled(!enabledRef.current);
  }, [setEnabled]);

  return { supported, enabled, setEnabled, toggle };
}
