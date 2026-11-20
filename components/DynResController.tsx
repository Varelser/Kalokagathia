import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import { isCameraDeterminismLocked } from '../lib/cameraDeterminism';
import {
  DynResController as DynResCore,
  dynResSignature,
  loadDynResSettled,
  saveDynResSettled,
} from '../lib/dynres';
import { getAdaptiveDprRange } from './AppSceneCameraRig';

// Phase CX: measured dynamic resolution for the live view. Mounted
// only in the main scene (AppScene's dynResEnabled prop, set by
// AppRootLayout); embed / compare scenes keep the static DPR range
// exactly as before. The controller never runs while paused (an idle
// scene is not load), while the tab is hidden, or while a
// deterministic render job holds the camera determinism lock.
export const DynResController: React.FC<{ config: ParticleConfig; isPlaying: boolean }> = ({ config, isPlaying }) => {
  const setDpr = useThree((s) => s.setDpr);
  const initialDpr = useThree((s) => s.viewport.dpr);
  const signature = dynResSignature(config);
  const range = getAdaptiveDprRange(config);
  const coreRef = React.useRef<DynResCore | null>(null);
  if (coreRef.current === null) {
    const settled = loadDynResSettled()[signature];
    coreRef.current = new DynResCore(range, settled ?? initialDpr);
  }
  const stateRef = React.useRef({ signature, rangeKey: range.join('/') });
  const playingRef = React.useRef(isPlaying);
  playingRef.current = isPlaying;
  // The core owns the live DPR once it has applied a restored
  // settled value or issued a decision. Before that, an external
  // DPR (R3F resolving the dpr prop during boot) is adopted via
  // syncApplied instead of being fought.
  const authoritativeRef = React.useRef(false);

  // Mount: apply the remembered settled DPR for the opening signature
  // (the core was constructed with it; the canvas still starts at the
  // R3F default until this runs).
  React.useEffect(() => {
    const settled = loadDynResSettled()[stateRef.current.signature];
    if (settled !== undefined) {
      authoritativeRef.current = true;
      setDpr(coreRef.current!.applied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signature (or range) change: retarget from the remembered settled
  // value for the new signature and apply it immediately — switching
  // to a heavy preset starts at its last settled DPR instead of
  // re-running the adaptation transient at full resolution.
  React.useEffect(() => {
    const core = coreRef.current!;
    const rangeKey = range.join('/');
    if (stateRef.current.signature !== signature || stateRef.current.rangeKey !== rangeKey) {
      stateRef.current = { signature, rangeKey };
      const settled = loadDynResSettled()[signature];
      core.retarget(range, settled ?? null);
      // A remembered settled value applies at once; without one the
      // current canvas DPR stands until the loop's first decision.
      if (settled !== undefined) {
        authoritativeRef.current = true;
        setDpr(core.applied);
      }
    }
  }, [signature, range, setDpr]);

  useFrame((state, delta) => {
    if (!playingRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (isCameraDeterminismLocked()) return;
    const core = coreRef.current!;
    // R3F re-applies the dpr prop on config-driven re-renders,
    // which can stomp the controller's DPR without the core
    // knowing (found at the Phase CX real-GPU gate: a restored
    // settled DPR was raised back to the range maximum ~1.5s
    // after mount and never re-applied, because the core already
    // believed it was at its floor). Once the core is
    // authoritative, re-assert its value on divergence; before
    // that, adopt the external value as the starting point.
    const actual = state.viewport.dpr;
    if (Math.abs(actual - core.applied) > 0.01) {
      if (authoritativeRef.current) {
        setDpr(core.applied);
        return;
      }
      core.syncApplied(actual);
    }
    const next = core.feed(delta * 1000);
    if (next !== null) {
      authoritativeRef.current = true;
      setDpr(next);
      saveDynResSettled(stateRef.current.signature, next);
    }
  });
  return null;
};
