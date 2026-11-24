import React from 'react';
import type { ParticleConfig } from '../types';
import {
  getErodedTerrainFieldBakeStats,
  isErodedTerrainFieldCurrent,
  rebakeErodedTerrainField,
  terrainFieldSeedFor,
} from '../lib/gpgpuMorphTargets';
import { terrainOptionsFromConfig } from '../lib/terrainDerivedMaps';

/**
 * Erosion manual rebake + status (Phase 21 stage 4).
 *
 * The erosion bake normally runs lazily on the first consumer that
 * needs the field and is cached under its parameter key. This block
 * adds the two things that were missing: a manual trigger (rebake
 * NOW with the current parameters — the bake is pure, so the
 * result is bit-identical) and a status line (whether the current
 * parameters are baked, how many bakes have run, and how long the
 * last one took). The bake itself stays a single synchronous pass:
 * the button first paints its "ベイク中" state, then runs the bake
 * on a deferred tick so the state is actually visible.
 */
export const ErosionRebakeBlock: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const [phase, setPhase] = React.useState<'idle' | 'baking' | 'done'>('idle');
  const [message, setMessage] = React.useState('');
  const [, setTick] = React.useState(0);

  const terrain = terrainOptionsFromConfig(config);
  const fieldSeed = terrainFieldSeedFor(config.gpgpuSeed, terrain.seed);
  const erosionActive = (config.gpgpuMorphTerrainErosionWater ?? 0) > 0 || (config.gpgpuMorphTerrainErosionThermal ?? 0) > 0;
  const current = erosionActive && isErodedTerrainFieldCurrent(terrain, fieldSeed);
  const stats = getErodedTerrainFieldBakeStats();

  // Keep the "current / pending" readout fresh while the panel is
  // open (bakes can also be triggered by scene consumers).
  React.useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 700);
    return () => window.clearInterval(id);
  }, []);

  const rebake = () => {
    if (phase === 'baking') return;
    setPhase('baking');
    setMessage('ベイク中…（侵食シミュレーションを実行しています）');
    window.setTimeout(() => {
      const started = performance.now();
      const field = rebakeErodedTerrainField(terrainOptionsFromConfig(config), terrainFieldSeedFor(config.gpgpuSeed, terrainOptionsFromConfig(config).seed));
      const ms = performance.now() - started;
      if (field) {
        setPhase('done');
        setMessage(`再ベイク完了: ${ms.toFixed(1)} ms（同じ設定では結果はビット単位で同一です）`);
      } else {
        setPhase('idle');
        setMessage('侵食が無効なためベイクしませんでした（Water / Thermal を 0 より大きくしてください）。');
      }
      setTick((t) => t + 1);
    }, 40);
  };

  return (
    <div className="mt-2">
      <div className="text-[10px] leading-relaxed text-white/60">
        {!erosionActive
          ? '状態: 侵食は無効です（Water / Thermal が両方 0）。'
          : current
            ? `状態: 現在の設定でベイク済みです（ベイク回数 ${stats.bakes} 回 / 前回 ${stats.lastDurationMs.toFixed(1)} ms）`
            : '状態: 現在の設定はまだベイクされていません（表示側が使うときに自動でベイクされます）。'}
      </div>
      <button
        type="button"
        onClick={rebake}
        disabled={!erosionActive || phase === 'baking'}
        className="mt-1 px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
      >
        {phase === 'baking' ? 'ベイク中…' : '今すぐ再ベイク'}
      </button>
      {message && <div className="mt-1 text-[10px] leading-relaxed text-white/60">{message}</div>}
    </div>
  );
};
