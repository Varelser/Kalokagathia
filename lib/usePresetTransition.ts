import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from 'react';
import type { ParticleConfig, SequenceTransitionEasing } from '../types';
import { applyTransitionEasing, DEFAULT_SEQUENCE_EASING, interpolateConfig, normalizeConfig } from './appState';

type UsePresetTransitionArgs = {
  config: ParticleConfig;
  setActivePresetId: Dispatch<SetStateAction<string | null>>;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
  setIsPresetTransitioning: Dispatch<SetStateAction<boolean>>;
};

export function usePresetTransition({
  config,
  setActivePresetId,
  setConfig,
  setIsPresetTransitioning,
}: UsePresetTransitionArgs) {
  const latestConfigRef = useRef(config);
  const transitionFrameRef = useRef<number | null>(null);

  const stopPresetTransition = useCallback(() => {
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
      transitionFrameRef.current = null;
    }
    setIsPresetTransitioning(false);
  }, [setIsPresetTransitioning]);

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  const applyConfigInstant = useCallback((nextConfig: ParticleConfig, nextPresetId: string | null = null) => {
    stopPresetTransition();
    setConfig(normalizeConfig(nextConfig));
    setActivePresetId(nextPresetId);
    return true;
  }, [setActivePresetId, setConfig, stopPresetTransition]);

  const applyConfigMorph = useCallback((
    targetConfig: ParticleConfig,
    durationSeconds: number,
    nextPresetId: string | null = null,
    easing: SequenceTransitionEasing = DEFAULT_SEQUENCE_EASING,
  ) => {
    stopPresetTransition();

    const fromConfig = normalizeConfig(latestConfigRef.current);
    const toConfig = normalizeConfig(targetConfig);
    const durationMs = Math.max(50, durationSeconds * 1000);
    const startTime = performance.now();

    setActivePresetId(nextPresetId);
    setIsPresetTransitioning(true);

    const tick = (now: number) => {
      const linearProgress = Math.min(1, (now - startTime) / durationMs);
      const easedProgress = applyTransitionEasing(linearProgress, easing);

      setConfig(interpolateConfig(fromConfig, toConfig, easedProgress));

      if (linearProgress < 1) {
        transitionFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      transitionFrameRef.current = null;
      setConfig(toConfig);
      setIsPresetTransitioning(false);
    };

    transitionFrameRef.current = requestAnimationFrame(tick);
    return true;
  }, [setActivePresetId, setConfig, setIsPresetTransitioning, stopPresetTransition]);

  useEffect(() => () => {
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current);
    }
  }, []);

  return {
    applyConfigInstant,
    applyConfigMorph,
    latestConfigRef: latestConfigRef as MutableRefObject<ParticleConfig>,
    stopPresetTransition,
  };
}
