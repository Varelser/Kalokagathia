import React from 'react';
import type { ParticleConfig } from '../types';
import { applyTemporalProfiles } from '../lib/temporalProfiles';
import { getLayerRuntimeTemporalSnapshot } from '../lib/sceneRenderRouting';
import { applyModulation, resolveModulationSetup, useModulationSetup } from '../lib/modulation';
import { applySequenceTracks, useSequenceClockTime, useSequenceTracks } from '../lib/sequenceTracks';
import type { AudioLevels } from '../lib/audioControllerTypes';

export function useAppSceneTemporalConfig(
  config: ParticleConfig,
  isPlaying: boolean,
  audioRef?: React.MutableRefObject<AudioLevels>,
  isSequencePlaying = false,
) {
  const [temporalTime, setTemporalTime] = React.useState(0);
  const temporalTimerRef = React.useRef(0);
  const modulation = useModulationSetup();
  const sequenceTracks = useSequenceTracks();
  const sequenceClockTime = useSequenceClockTime();

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

  // TD §7 face 4: a setup carried in the config (modulationGraph)
  // wins over the local performance setup; '' leaves the local one
  // in charge, exactly as before the key existed.
  const effectiveModulation = React.useMemo(
    () => resolveModulationSetup(config.modulationGraph, modulation),
    [config.modulationGraph, modulation],
  );
  const modulationActive = effectiveModulation.enabled && effectiveModulation.routes.length > 0;
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

  // Sequence tracks (Phase AN) sit after modulation in the effective
  // layer: the track is the sequence-side final word on its keys.
  // With an empty track set the evaluation is never called, and
  // outside sequence playback nothing is applied — the legacy path
  // stays byte-identical in both cases.
  const sequenceTracksActive = isSequencePlaying && sequenceTracks.length > 0;

  return React.useMemo(() => {
    let effective = hasTemporalAnimation ? applyTemporalProfiles(config, temporalTime, isPlaying) : config;
    if (modulationActive && isPlaying) {
      effective = applyModulation(effective, effectiveModulation, temporalTime, audioRef?.current);
    }
    if (sequenceTracksActive) {
      effective = applySequenceTracks(effective, sequenceTracks, sequenceClockTime);
    }
    return effective;
  }, [config, hasTemporalAnimation, isPlaying, temporalTime, modulationActive, effectiveModulation, audioRef, sequenceTracksActive, sequenceTracks, sequenceClockTime]);
}
