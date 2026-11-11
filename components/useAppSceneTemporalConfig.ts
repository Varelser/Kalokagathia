import React from 'react';
import type { ParticleConfig } from '../types';
import { applyTemporalProfiles } from '../lib/temporalProfiles';
import { getLayerRuntimeTemporalSnapshot } from '../lib/sceneRenderRouting';
import { applyModulation, useModulationSetup } from '../lib/modulation';
import type { AudioLevels } from '../lib/audioControllerTypes';

export function useAppSceneTemporalConfig(
  config: ParticleConfig,
  isPlaying: boolean,
  audioRef?: React.MutableRefObject<AudioLevels>,
) {
  const [temporalTime, setTemporalTime] = React.useState(0);
  const temporalTimerRef = React.useRef(0);
  const modulation = useModulationSetup();

  const hasTemporalAnimation = React.useMemo(() => {
    const layer2Temporal = getLayerRuntimeTemporalSnapshot(config, 2);
    const layer3Temporal = getLayerRuntimeTemporalSnapshot(config, 3);
    return [layer2Temporal, layer3Temporal].some((snapshot) => snapshot.enabled && snapshot.profile !== 'steady' && snapshot.strength > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- field-grained deps are deliberate: the memo reads only the listed config fields, and a whole-config dep would recompute on every change.
  }, [
    config.layer2Enabled,
    config.layer2TemporalProfile,
    config.layer2TemporalStrength,
    config.layer3Enabled,
    config.layer3TemporalProfile,
    config.layer3TemporalStrength,
  ]);

  const modulationActive = modulation.enabled && modulation.routes.length > 0;
  const ticking = hasTemporalAnimation || modulationActive;

  React.useEffect(() => {
    if (!ticking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- when temporal animation turns off the accumulated time resets to 0; an intentional state reset on a mode change.
      setTemporalTime(0);
      return;
    }
    const intervalMs = modulationActive ? 50 : 83;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!last || now - last >= intervalMs) {
        last = now;
        temporalTimerRef.current = now / 1000;
        setTemporalTime(now / 1000);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [ticking, modulationActive]);

  return React.useMemo(() => {
    let effective = hasTemporalAnimation ? applyTemporalProfiles(config, temporalTime, isPlaying) : config;
    if (modulationActive && isPlaying) {
      effective = applyModulation(effective, modulation, temporalTime, audioRef?.current);
    }
    return effective;
  }, [config, hasTemporalAnimation, isPlaying, temporalTime, modulationActive, modulation, audioRef]);
}
