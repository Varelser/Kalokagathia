import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

import { Slider, Toggle } from './controlPanelParts';
import {
  FREE_CURVE_MAX_POINTS,
  FREE_CURVE_MIN_POINTS,
  flattenFreeCurvePoints,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from '../lib/freeCurve';

/** Free curve editor (Phase AJ): per-point t / value sliders with
 *  add / remove, plus shape presets. Controlled entirely by the
 *  config value (the flat [t, v, …] asset). */
const FreeCurveEditor: React.FC<{
  points: FreeCurvePoint[];
  onChange: (points: FreeCurvePoint[]) => void;
}> = ({ points, onChange }) => {
  const updatePoint = (index: number, patch: Partial<FreeCurvePoint>) => {
    const next = points.map((point, i) => (i === index ? { ...point, ...patch } : point));
    onChange(normalizeFreeCurvePoints(flattenFreeCurvePoints(next)));
  };
  const presets: { label: string; points: FreeCurvePoint[] }[] = [
    { label: 'Flat（恒等）', points: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
    { label: 'Ramp（上昇）', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
    { label: 'Pulse（山）', points: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }] },
    { label: 'Gate（開閉）', points: [{ t: 0, v: 1 }, { t: 0.4, v: 1 }, { t: 0.5, v: 0 }, { t: 0.9, v: 0 }, { t: 1, v: 1 }] },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onChange(preset.points)}
            className="px-2 py-1 rounded-full border border-white/20 text-[9px] uppercase tracking-widest text-white/60 hover:bg-white/10"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {points.map((point, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Slider label={`点 ${index + 1} 位置 t`} value={point.t} min={0} max={1} step={0.01} onChange={(v) => updatePoint(index, { t: v })} />
          <Slider label={`点 ${index + 1} 値`} value={point.v} min={0} max={4} step={0.05} onChange={(v) => updatePoint(index, { v })} />
          {points.length > FREE_CURVE_MIN_POINTS && (
            <button
              onClick={() => onChange(points.filter((_, i) => i !== index))}
              className="pb-1 text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
            >
              削除
            </button>
          )}
        </div>
      ))}
      {points.length < FREE_CURVE_MAX_POINTS && (
        <button
          onClick={() => onChange(normalizeFreeCurvePoints(flattenFreeCurvePoints([...points, { t: 0.5, v: 1 }])))}
          className="w-full py-1.5 rounded border border-dashed border-white/20 text-white/60 text-[10px] hover:bg-white/5"
        >
          ＋ 制御点を追加（最大 {FREE_CURVE_MAX_POINTS} 点）
        </button>
      )}
    </div>
  );
};

export const GlobalDisplayGpgpuForcesCoreSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* N-Body */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="N-Body Gravity" value={config.gpgpuNBodyEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuNBodyEnabled', v)} />
      {config.gpgpuNBodyEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuNBodyStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuNBodyStrength', v)} />
          <Slider label="Repulsion Radius" value={config.gpgpuNBodyRepulsion} min={0.5} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuNBodyRepulsion', v)} />
          <Slider label="Softening" value={config.gpgpuNBodySoftening} min={0.1} max={20} step={0.1} onChange={(v) => updateConfig('gpgpuNBodySoftening', v)} />
          <Slider label="Sample Count" value={config.gpgpuNBodySampleCount} min={4} max={64} step={4} onChange={(v) => updateConfig('gpgpuNBodySampleCount', v)} />
        </>
      )}
    </div>

    {/* Velocity Color */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Velocity Color" value={config.gpgpuVelColorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVelColorEnabled', v)} />
      {config.gpgpuVelColorEnabled && (
        <>
          <Slider label="Hue Min (°)" value={config.gpgpuVelColorHueMin} min={0} max={360} step={1} onChange={(v) => updateConfig('gpgpuVelColorHueMin', v)} />
          <Slider label="Hue Max (°)" value={config.gpgpuVelColorHueMax} min={0} max={360} step={1} onChange={(v) => updateConfig('gpgpuVelColorHueMax', v)} />
          <Slider label="Saturation" value={config.gpgpuVelColorSaturation} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuVelColorSaturation', v)} />
        </>
      )}
    </div>

    {/* Life/Age */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Life System" value={config.gpgpuAgeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAgeEnabled', v)} />
      {config.gpgpuAgeEnabled && (
        <>
          <Slider label="Lifetime (s)" value={config.gpgpuAgeMax} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('gpgpuAgeMax', v)} />
          <Slider label="Fade In" value={config.gpgpuAgeFadeIn} min={0} max={0.5} step={0.01} onChange={(v) => updateConfig('gpgpuAgeFadeIn', v)} />
          <Slider label="Fade Out" value={config.gpgpuAgeFadeOut} min={0} max={0.5} step={0.01} onChange={(v) => updateConfig('gpgpuAgeFadeOut', v)} />
        </>
      )}
    </div>

    {/* Lifecycle grammar (Phase AB): spawn gate / kill / global drag+cap */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Lifecycle — Spawn / Kill / Drag （ライフサイクル文法 — Phase AB）</div>
      <Slider label="Spawn Burst （開始バースト）" value={config.gpgpuSpawnBurst} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnBurst', v)} />
      <Slider label="Spawn Rate （放出レート）" value={config.gpgpuSpawnRate} min={0.01} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnRate', v)} />
      <Slider label="Spawn Pulse Interval （周期バースト間隔・秒、0でOFF）" value={config.gpgpuSpawnPulseInterval} min={0} max={30} step={0.1} onChange={(v) => updateConfig('gpgpuSpawnPulseInterval', v)} />
      {config.gpgpuSpawnPulseInterval > 0 && (
        <Slider label="Spawn Pulse Duty （周期内の放出割合）" value={config.gpgpuSpawnPulseDuty} min={0.05} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSpawnPulseDuty', v)} />
      )}
      <Toggle label="Emission Curve （放出カーブ駆動 — Phase AJ）" value={config.gpgpuEmissionCurveEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuEmissionCurveEnabled', v)} />
      {config.gpgpuEmissionCurveEnabled && (
        <>
          <Slider label="Emission Curve Period （周期・秒）" value={config.gpgpuEmissionCurvePeriod} min={0.5} max={120} step={0.5} onChange={(v) => updateConfig('gpgpuEmissionCurvePeriod', v)} />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Free Curve （自由制御点カーブ — 放出の資産）</div>
          <FreeCurveEditor
            points={normalizeFreeCurvePoints(config.gpgpuFreeCurvePoints)}
            onChange={(points) => updateConfig('gpgpuFreeCurvePoints', flattenFreeCurvePoints(points))}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            年齢リスポーン（寿命での生まれ直し）を、周期の中でカーブの値の割合だけ通します。値 0 の区間は生まれ直しが止まり、寿命末尾の粒子が滞留します。Life System が OFF の間はリスポーン自体がないため無効です。全点 1（Flat）は有効でも従来同一です。
          </div>
        </>
      )}
      <Toggle label="Boundary Kill （境界キル）" value={config.gpgpuKillBoundary} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKillBoundary', v)} />
      <Toggle label="Mask Kill （マスクキル）" value={config.gpgpuKillMask} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKillMask', v)} />
      <Slider label="Global Drag （全体ドラッグ）" value={config.gpgpuDrag} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuDrag', v)} />
      <Slider label="Global Max Speed （全体の最高速度・0で無制限）" value={config.gpgpuMaxSpeed} min={0} max={350} step={1} onChange={(v) => updateConfig('gpgpuMaxSpeed', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        粒子の「生まれ方・消え方」の文法です。Spawn Burst は開始時に有効な粒子の割合（1＝全粒子で従来同一）、残りは Spawn Rate（プール割合/秒）で順に放出されます。境界キルは球境界の外へ出た粒子を跳ね返さず消滅→リスポーンさせます。マスクキルはラスタマスク（Morph の Mask 画像）の拒否域にいる粒子を消滅→リスポーンさせます（マスク画像が読み込めていない間は無効）。Global Drag 1.1・Max Speed 0 が従来同一です。
      </div>
    </div>

    {/* Curl Noise */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Curl Noise" value={config.gpgpuCurlEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuCurlEnabled', v)} />
      {config.gpgpuCurlEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuCurlStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuCurlStrength', v)} />
          <Slider label="Scale" value={config.gpgpuCurlScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuCurlScale', v)} />
          <Slider label="Speed (時間発展)" value={config.gpgpuCurlSpeed} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuCurlSpeed', v)} />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Field Mode (場の型)</div>
          <select
            value={config.gpgpuCurlMode}
            onChange={(e) => updateConfig('gpgpuCurlMode', e.target.value as typeof config.gpgpuCurlMode)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="curl">Curl (従来のカール)</option>
            <option value="ridged">Ridged (稜線状に尖る)</option>
            <option value="vortex">Vortex (渦巻きを加える)</option>
          </select>
          <Slider label="Octaves (重ね)" value={config.gpgpuCurlOctaves} min={1} max={3} step={1} onChange={(v) => updateConfig('gpgpuCurlOctaves', Math.round(v))} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            場の型とオクターブ合成は Kinetix の noiseMode / turbulenceOctaves の移植です。Curl + 1オクターブが従来の場そのものです。
          </div>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Field Symmetry</div>
          <select
            value={config.gpgpuCurlSymmetry}
            onChange={(e) => updateConfig('gpgpuCurlSymmetry', e.target.value as typeof config.gpgpuCurlSymmetry)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="none">None (対称なし)</option>
            <option value="mirrorX">Mirror X (Xミラー)</option>
            <option value="radial4">Radial 4 (放射4分割)</option>
            <option value="radial6">Radial 6 (放射6分割)</option>
            <option value="octahedral">Octahedral (八面体)</option>
          </select>
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            カール場のサンプリング座標を対称化します（Kinetix の対称サンプリングの移植）。粒子の位置や画面の対称とは別物で、場そのものが万華鏡状になります。
          </div>
          <Toggle label="Field Glyphs （場のグリフ表示）" value={config.gpgpuFieldGlyphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFieldGlyphEnabled', v)} />
          {config.gpgpuFieldGlyphEnabled && (
            <>
              <Slider label="Glyph Grid （格子数）" value={config.gpgpuFieldGlyphGrid} min={4} max={40} step={1} onChange={(v) => updateConfig('gpgpuFieldGlyphGrid', Math.round(v))} />
              <Slider label="Glyph Length （長さ）" value={config.gpgpuFieldGlyphLength} min={0.05} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuFieldGlyphLength', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Curl 場そのものを z=0 平面の線分グリフ格子で重ね描きします（向き＝場の方向、長さ＝場の強さ）。シミュレーションと同じ式・同じ時計で評価する表示専用オーバーレイです。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Boids */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Boids Flocking" value={config.gpgpuBoidsEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuBoidsEnabled', v)} />
      {config.gpgpuBoidsEnabled && (
        <>
          <Slider label="Separation" value={config.gpgpuBoidsSeparation} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsSeparation', v)} />
          <Slider label="Alignment" value={config.gpgpuBoidsAlignment} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsAlignment', v)} />
          <Slider label="Cohesion" value={config.gpgpuBoidsCohesion} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuBoidsCohesion', v)} />
          <Slider label="Radius" value={config.gpgpuBoidsRadius} min={5} max={200} step={5} onChange={(v) => updateConfig('gpgpuBoidsRadius', v)} />
        </>
      )}
    </div>

    {/* Strange Attractor */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Strange Attractor" value={config.gpgpuAttractorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAttractorEnabled', v)} />
      {config.gpgpuAttractorEnabled && (
        <>
          <Toggle
            label="Type"
            value={config.gpgpuAttractorType}
            options={[{ label: 'Lorenz', val: 'lorenz' }, { label: 'Rössler', val: 'rossler' }, { label: 'Thomas', val: 'thomas' }, { label: 'Halvorsen', val: 'halvorsen' }, { label: 'Chen', val: 'chen' }, { label: 'Lü', val: 'lu' }, { label: 'Aizawa', val: 'aizawa' }, { label: 'Sprott', val: 'sprott' }, { label: 'Rabinovich', val: 'rabinovich' }, { label: 'De Jong', val: 'dejong' }, { label: 'Ikeda', val: 'ikeda' }, { label: 'Chua', val: 'chua' }]}
            onChange={(v) => updateConfig('gpgpuAttractorType', v)}
          />
          <Slider label="Strength" value={config.gpgpuAttractorStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAttractorStrength', v)} />
          <Slider label="Scale" value={config.gpgpuAttractorScale} min={0.5} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuAttractorScale', v)} />
        </>
      )}
    </div>

    {/* Lévy flight */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Lévy Flight" value={config.gpgpuLevyEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuLevyEnabled', v)} />
      {config.gpgpuLevyEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuLevyStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuLevyStrength', v)} />
          <Slider label="Rate" value={config.gpgpuLevyRate} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('gpgpuLevyRate', v)} />
        </>
      )}
    </div>

    {/* Kuramoto sync */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Kuramoto Sync" value={config.gpgpuKuramotoEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuKuramotoEnabled', v)} />
      {config.gpgpuKuramotoEnabled && (
        <>
          <Slider label="Coupling" value={config.gpgpuKuramotoCoupling} min={0} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuKuramotoCoupling', v)} />
          <Slider label="Spread" value={config.gpgpuKuramotoSpread} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuKuramotoSpread', v)} />
          <Slider label="Radius" value={config.gpgpuKuramotoRadius} min={10} max={200} step={5} onChange={(v) => updateConfig('gpgpuKuramotoRadius', v)} />
          <Slider label="Influence" value={config.gpgpuKuramotoInfluence} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuKuramotoInfluence', v)} />
        </>
      )}
    </div>

    {/* Particle Life */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Particle Life" value={config.gpgpuParticleLifeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuParticleLifeEnabled', v)} />
      {config.gpgpuParticleLifeEnabled && (
        <>
          <Toggle
            label="Preset"
            value={config.gpgpuParticleLifePreset}
            options={[{ label: 'Cells', val: 'cells' }, { label: 'Snakes', val: 'snakes' }, { label: 'Community', val: 'community' }, { label: 'Random', val: 'random' }]}
            onChange={(v) => updateConfig('gpgpuParticleLifePreset', v)}
          />
          <Slider label="Species" value={config.gpgpuParticleLifeSpecies} min={2} max={6} step={1} onChange={(v) => updateConfig('gpgpuParticleLifeSpecies', Math.round(v))} />
          <Slider label="Strength" value={config.gpgpuParticleLifeStrength} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeStrength', v)} />
          <Slider label="Radius" value={config.gpgpuParticleLifeRadius} min={10} max={160} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeRadius', v)} />
          <Slider label="Friction" value={config.gpgpuParticleLifeFriction} min={0.5} max={0.99} step={0.01} onChange={(v) => updateConfig('gpgpuParticleLifeFriction', v)} />
          <div className="mt-1 mb-1 text-[10px] uppercase tracking-widest text-white/50">Behaviour （行動: 循環する捕食チェーン — 種 i は種 i+1 を追い、種 i-1 から逃げる）</div>
          <Slider label="Pursue （追跡）" value={config.gpgpuParticleLifePursue} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifePursue', v)} />
          <Slider label="Evade （逃避）" value={config.gpgpuParticleLifeEvade} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeEvade', v)} />
          <Slider label="Vision Range （視野距離）" value={config.gpgpuParticleLifeVisionRange} min={0} max={200} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeVisionRange', v)} />
          <Slider label="Vision Angle （視野角°）" value={config.gpgpuParticleLifeVisionAngle} min={10} max={360} step={5} onChange={(v) => updateConfig('gpgpuParticleLifeVisionAngle', v)} />
          <Slider label="Max Speed （最高速度・0で無制限）" value={config.gpgpuParticleLifeMaxSpeed} min={0} max={120} step={1} onChange={(v) => updateConfig('gpgpuParticleLifeMaxSpeed', v)} />
          <Slider label="Meander Amount （徘徊）" value={config.gpgpuParticleLifeMeanderAmount} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeMeanderAmount', v)} />
          <Slider label="Meander Scale （徘徊スケール）" value={config.gpgpuParticleLifeMeanderScale} min={0.1} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuParticleLifeMeanderScale', v)} />
          <Slider label="Avoid （障害物回避・SDF有効時）" value={config.gpgpuParticleLifeAvoid} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuParticleLifeAvoid', v)} />
          {config.gpgpuParticleLifePreset === 'random' && (
            <button
              onClick={() => updateConfig('gpgpuParticleLifeSeed', Math.floor(Math.random() * 1000000))}
              className="mb-4 px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
            >
              Random Matrix (Seed {config.gpgpuParticleLifeSeed})
            </button>
          )}
        </>
      )}
    </div>

    {/* Vortex */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Vortex Field" value={config.gpgpuVortexEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVortexEnabled', v)} />
      {config.gpgpuVortexEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuVortexStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVortexStrength', v)} />
          <Slider label="Axis Tilt (rad)" value={config.gpgpuVortexTilt} min={-Math.PI} max={Math.PI} step={0.05} onChange={(v) => updateConfig('gpgpuVortexTilt', v)} />
        </>
      )}
    </div>

    {/* Wind */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Wind Force" value={config.gpgpuWindEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWindEnabled', v)} />
      {config.gpgpuWindEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuWindStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuWindStrength', v)} />
          <Slider label="Direction X" value={config.gpgpuWindX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindX', v)} />
          <Slider label="Direction Y" value={config.gpgpuWindY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindY', v)} />
          <Slider label="Direction Z" value={config.gpgpuWindZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuWindZ', v)} />
          <Slider label="Gustiness" value={config.gpgpuWindGust} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuWindGust', v)} />
        </>
      )}
    </div>

    {/* Gravity Well */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Gravity Well" value={config.gpgpuWellEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWellEnabled', v)} />
      {config.gpgpuWellEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuWellStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuWellStrength', v)} />
          <Slider label="Softening" value={config.gpgpuWellSoftening} min={1} max={100} step={1} onChange={(v) => updateConfig('gpgpuWellSoftening', v)} />
          <Slider label="Orbit (tangential)" value={config.gpgpuWellOrbit} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuWellOrbit', v)} />
          <Slider label="Well Count (ウェル数)" value={config.gpgpuWellCount} min={1} max={4} step={1} onChange={(v) => updateConfig('gpgpuWellCount', Math.round(v))} />
          {config.gpgpuWellCount > 1 && (
            <>
              <Slider label="Well Spread (配置半径)" value={config.gpgpuWellSpread} min={10} max={300} step={5} onChange={(v) => updateConfig('gpgpuWellSpread', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                2〜4個のウェルがゆっくり回るリング上に並びます（Kinetix の多重ウェル）。1個が従来の中心ウェルです。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Elastic Spring */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Elastic Spring" value={config.gpgpuElasticEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuElasticEnabled', v)} />
      {config.gpgpuElasticEnabled && (
        <Slider label="Strength" value={config.gpgpuElasticStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuElasticStrength', v)} />
      )}
    </div>

    {/* Magnetic / Lorentz */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Magnetic Field" value={config.gpgpuMagneticEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMagneticEnabled', v)} />
      {config.gpgpuMagneticEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuMagneticStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticStrength', v)} />
          <Slider label="Field X" value={config.gpgpuMagneticBX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBX', v)} />
          <Slider label="Field Y" value={config.gpgpuMagneticBY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBY', v)} />
          <Slider label="Field Z" value={config.gpgpuMagneticBZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMagneticBZ', v)} />
        </>
      )}
    </div>

    {/* SPH Fluid */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="SPH Fluid" value={config.gpgpuSphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSphEnabled', v)} />
      {config.gpgpuSphEnabled && (
        <>
          <Slider label="Pressure" value={config.gpgpuSphPressure} min={0} max={20} step={0.1} onChange={(v) => updateConfig('gpgpuSphPressure', v)} />
          <Slider label="Viscosity" value={config.gpgpuSphViscosity} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuSphViscosity', v)} />
          <Slider label="Interaction Radius" value={config.gpgpuSphRadius} min={5} max={200} step={5} onChange={(v) => updateConfig('gpgpuSphRadius', v)} />
          <Slider label="Rest Density" value={config.gpgpuSphRestDensity} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSphRestDensity', v)} />
          <Slider label="Surface Tension （表面張力・近似）" value={config.gpgpuSphSurfaceTension} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuSphSurfaceTension', v)} />
        </>
      )}
    </div>

    {/* Vector Field */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Vector Field" value={config.gpgpuVFieldEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVFieldEnabled', v)} />
      {config.gpgpuVFieldEnabled && (
        <>
          <Toggle
            label="Field Type"
            value={config.gpgpuVFieldType}
            options={[{ label: 'Dipole', val: 'dipole' }, { label: 'Saddle', val: 'saddle' }, { label: 'Spiral', val: 'spiral' }, { label: 'Source', val: 'source' }, { label: 'ABC Flow', val: 'abc' }, { label: 'Double Gyre', val: 'gyre' }, { label: 'Worley', val: 'worley' }]}
            onChange={(v) => updateConfig('gpgpuVFieldType', v)}
          />
          <Slider label="Strength" value={config.gpgpuVFieldStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVFieldStrength', v)} />
          <Slider label="Scale" value={config.gpgpuVFieldScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuVFieldScale', v)} />
        </>
      )}
    </div>

    {/* Spring */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Spring (to Spawn)" value={config.gpgpuSpringEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSpringEnabled', v)} />
      {config.gpgpuSpringEnabled && (
        <Slider label="Strength" value={config.gpgpuSpringStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSpringStrength', v)} />
      )}
    </div>
  </>
);
