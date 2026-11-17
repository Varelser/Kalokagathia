import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import { CUSTOM_FORCE_EXAMPLE, useCustomForceStatus } from '../lib/gpgpuCustomForce';
import { VEX_PRESETS } from '../lib/gpgpuVexPresets';
import { KINETIX_COLOR_GRADIENTS, getKinetixGradientPreset } from '../lib/kinetixGradients';
import { SAMPLE_SVG_STAR, sampleSvgPointCloud } from '../lib/svgMorph';
import { AGE_CURVE_POINT_MAX, AGE_CURVE_PRESETS, normalizeAgeCurvePoints } from '../lib/ageCurve';
import { SAMPLE_OBJ_SPHERE, SAMPLE_OBJ_TORUS_KNOT, parseObjGeometry, isObjClosedMesh } from '../lib/objMorph';
import { setModulationSetup, useModulationSetup } from '../lib/modulation';
import { extractLumaMap } from './controlPanelPartsSourceMediaUtils';
import type { ParticleConfig } from '../types';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const GlobalDisplayGpgpuForcesSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
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

    {/* Curl Noise */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Curl Noise" value={config.gpgpuCurlEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuCurlEnabled', v)} />
      {config.gpgpuCurlEnabled && (
        <>
          <Slider label="Strength" value={config.gpgpuCurlStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuCurlStrength', v)} />
          <Slider label="Scale" value={config.gpgpuCurlScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuCurlScale', v)} />
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

    {/* Morph Targets (Kinetix integration B1a) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Morph Targets" value={config.gpgpuMorphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphEnabled', v)} />
      {config.gpgpuMorphEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Target Shape</div>
          <select
            value={config.gpgpuMorphTarget}
            onChange={(e) => updateConfig('gpgpuMorphTarget', e.target.value as typeof config.gpgpuMorphTarget)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="trefoil">Trefoil (三つ葉結び)</option>
            <option value="torusKnot">Torus Knot (3,5)</option>
            <option value="galaxy">Galaxy (渦巻銀河)</option>
            <option value="mobius">Möbius (メビウス帯)</option>
            <option value="geodesic">Geodesic (測地ドーム)</option>
            <option value="crown">Crown (王冠)</option>
            <option value="blackhole">Black Hole (降着円盤+ジェット)</option>
            <option value="klein">Klein Bottle (クラインの壺)</option>
            <option value="cymatic">Cymatic (球面調和シェル)</option>
            <option value="gyroid">Gyroid (ジャイロイド曲面)</option>
            <option value="dnaRibbon">DNA Ribbon (二重螺旋)</option>
            <option value="hypercube">Hypercube (4次元立方体)</option>
            <option value="mandelbulb">Mandelbulb (点群近似)</option>
            <option value="shell">Shell (オウムガイ)</option>
            <option value="text">Text (レイヤー2のテキストマップ)</option>
            <option value="image">Image (レイヤー2の画像マップ)</option>
            <option value="svg">SVG (取り込んだロゴ/図形)</option>
            <option value="obj">OBJ (取り込んだ3Dメッシュ)</option>
            <option value="terrain">Terrain (地形・フラクタル高度場)</option>
          </select>
          {config.gpgpuMorphTarget === 'svg' && (
            <MorphSvgImportBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuMorphTarget === 'svg' && (
            <>
              <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Path （パス沿い配置）</div>
              <Toggle label="Mode" value={config.gpgpuMorphPathMode} options={[{ label: 'Off', val: 'off' as const }, { label: 'Along', val: 'along' as const }, { label: 'Write-on', val: 'writeOn' as const }, { label: 'Stamp', val: 'stamp' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathMode', v)} />
              {config.gpgpuMorphPathMode !== 'off' && (
                <>
                  <Toggle label="Subpaths （サブパス配分）" value={config.gpgpuMorphPathSubpathMode} options={[{ label: 'Proportional', val: 'proportional' as const }, { label: 'Even', val: 'even' as const }, { label: 'First', val: 'first' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathSubpathMode', v)} />
                  {config.gpgpuMorphPathMode === 'stamp' && (
                    <>
                      <Toggle label="Stamp Shape （スタンプ形状）" value={config.gpgpuMorphStampShape} options={[{ label: 'Disc', val: 'disc' as const }, { label: 'Ring', val: 'ring' as const }, { label: 'Star', val: 'star' as const }, { label: 'Diamond', val: 'diamond' as const }, { label: 'OBJ', val: 'obj' as const }]} onChange={(v) => updateConfig('gpgpuMorphStampShape', v)} />
                      <Slider label="Stamp Spacing （間隔・パス割合）" value={config.gpgpuMorphStampSpacing} min={0.02} max={0.5} step={0.005} onChange={(v) => updateConfig('gpgpuMorphStampSpacing', v)} />
                      <Slider label="Stamp Size （大きさ）" value={config.gpgpuMorphStampSize} min={0.02} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphStampSize', v)} />
                      <Toggle label="Stamp Align （接線に整列）" value={config.gpgpuMorphStampAlign} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphStampAlign', v)} />
                      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                        パス上に形状を等間隔（弧長）でスタンプします。OBJ 形状は取り込んだ OBJ の点群をスタンプに使います（OBJ 未取り込み時は Disc で代替）。
                      </div>
                    </>
                  )}
                  {config.gpgpuMorphPathMode === 'writeOn' && (
                    <>
                      <Slider label="Write-On Start （開始・割合）" value={config.gpgpuMorphPathWriteOnStart} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathWriteOnStart', v)} />
                      <Slider label="Write-On End （終了・割合）" value={config.gpgpuMorphPathWriteOnEnd} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathWriteOnEnd', v)} />
                    </>
                  )}
                  {config.gpgpuMorphPathMode !== 'stamp' && (
                  <Slider label="Taper （テーパー）" value={config.gpgpuMorphPathTaper} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathTaper', v)} />
                  )}
                  {config.gpgpuMorphPathTaper > 0 && (
                    <Toggle label="Taper Shape （形状）" value={config.gpgpuMorphPathTaperShape} options={[{ label: 'Linear', val: 'linear' as const }, { label: 'Smooth', val: 'smooth' as const }, { label: 'Bell', val: 'bell' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathTaperShape', v)} />
                  )}
                </>
              )}
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Off では従来どおり輪郭点群から無作為に抽出します。Along は粒子をパスの弧長順に割り当て、Write-on は窓［Start, End］の範囲だけを描いた状態にします。Taper はパスの法線方向へ配置帯を広げます（最大幅 0.1 固定、窓の始点基準）。複製（Replicas）と組み合わせると、複製ごとにパスの連続区間が割り当てられます。
              </div>
            </>
          )}
          {config.gpgpuMorphTarget === 'obj' && (
            <MorphObjImportBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuMorphTarget === 'terrain' && (
            <>
              <div className="mb-1 mt-1 text-[9px] uppercase tracking-widest opacity-60">Terrain （地形）</div>
              <Slider label="Amplitude （標高の振幅）" value={config.gpgpuMorphTerrainAmplitude} min={0} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainAmplitude', v)} />
              <Slider label="Frequency （周波数）" value={config.gpgpuMorphTerrainFrequency} min={0.4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainFrequency', v)} />
              <Slider label="Octaves （オクターブ）" value={config.gpgpuMorphTerrainOctaves} min={1} max={6} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainOctaves', Math.round(v))} />
              <Slider label="Terrain Seed （地形シード）" value={config.gpgpuMorphTerrainSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainSeed', Math.round(v))} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                シード付きフラクタル高度場（fBm）の表面に粒子を敷きます。同じ設定からは常に同じ地形になります。高さで色を変えるには Kinetix Color Gradient の Driver を Height にしてください（谷→山頂でグラデーションが進みます）。
              </div>
            </>
          )}
          <>
            <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Form Deformation （フォーム専用変形: 配置変形）</div>
            <Slider label="Disperse Amount （拡散量）" value={config.gpgpuMorphDisperseAmount} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphDisperseAmount', v)} />
            {config.gpgpuMorphDisperseAmount !== 0 && (
              <Toggle label="Disperse Direction （拡散方向）" value={config.gpgpuMorphDisperseDirection} options={[{ label: 'Radial', val: 'radial' as const }, { label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphDisperseDirection', v)} />
            )}
            <Slider label="Twist Amount （ねじり量）" value={config.gpgpuMorphTwistAmount} min={-4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTwistAmount', v)} />
            {config.gpgpuMorphTwistAmount !== 0 && (
              <Toggle label="Twist Axis （ねじり軸）" value={config.gpgpuMorphTwistAxis} options={[{ label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphTwistAxis', v)} />
            )}
            <Slider label="Fractal Amount （フラクタル変位量）" value={config.gpgpuMorphFractalAmount} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFractalAmount', v)} />
            {config.gpgpuMorphFractalAmount !== 0 && (
              <>
                <Slider label="Fractal Frequency （周波数）" value={config.gpgpuMorphFractalFrequency} min={0.2} max={8} step={0.1} onChange={(v) => updateConfig('gpgpuMorphFractalFrequency', v)} />
                <Slider label="Fractal Evolution （時間発展）" value={config.gpgpuMorphFractalEvolution} min={0} max={20} step={0.25} onChange={(v) => updateConfig('gpgpuMorphFractalEvolution', v)} />
              </>
            )}
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              モーフ配置そのものへの専用変形です（Flow／Vortex 等のモーションとは別系統）。全て 0 では従来と完全同一になります。
            </div>
          </>
          <Slider label="Strength" value={config.gpgpuMorphStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuMorphStrength', v)} />
          <Slider label="Scale" value={config.gpgpuMorphScale} min={0.1} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScale', v)} />
          <Slider label="Jitter" value={config.gpgpuMorphJitter} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphJitter', v)} />
          <Slider label="Orbit Speed" value={config.gpgpuMorphOrbitSpeed} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphOrbitSpeed', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            各粒子に割り当てた形状点群へバネ引力で集めます（Kinetix モーフの GPGPU 再実装）。Text はレイヤー2のテキスト設定、Image はレイヤー2に読み込んだ画像マップ、SVG は取り込んだ SVG の輪郭、OBJ は取り込んだ OBJ メッシュの表面、Terrain はシード付きフラクタル高度場の表面を使います。
          </div>
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Replicas （複製文法）</div>
          <Slider label="Replica Count" value={config.gpgpuMorphReplicaCount} min={1} max={8} step={1} onChange={(v) => updateConfig('gpgpuMorphReplicaCount', Math.round(v))} />
          {config.gpgpuMorphReplicaCount > 1 && (
            <>
              <Slider label="Spacing （間隔）" value={config.gpgpuMorphReplicaSpacing} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphReplicaSpacing', v)} />
              <Toggle label="Axis （並べる軸）" value={config.gpgpuMorphReplicaAxis} options={[{ label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphReplicaAxis', v)} />
              <Slider label="Rotation Step （回転増分°）" value={config.gpgpuMorphReplicaRotation} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuMorphReplicaRotation', v)} />
              <Slider label="Scale Step （等比）" value={config.gpgpuMorphReplicaScaleStep} min={0.5} max={1.6} step={0.02} onChange={(v) => updateConfig('gpgpuMorphReplicaScaleStep', v)} />
              <Slider label="Phase Step （位相ずらし°）" value={config.gpgpuMorphReplicaPhaseStep} min={0} max={360} step={5} onChange={(v) => updateConfig('gpgpuMorphReplicaPhaseStep', v)} />
              <Slider label="Age Step （年齢位相・周期比）" value={config.gpgpuMorphReplicaAgeStep} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphReplicaAgeStep', v)} />
              <Toggle label="Independent Sim （独立シム）" value={config.gpgpuMorphReplicaIndependent} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphReplicaIndependent', v)} />
              {config.gpgpuMorphReplicaIndependent && (
                <Slider label="Divergence （分岐度）" value={config.gpgpuMorphReplicaDivergence} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphReplicaDivergence', v)} />
              )}
            </>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            形状点群を複製して、間隔・回転・拡縮を累積させた連鎖にします。総点数は増えず、複製へ割り当てます。Phase Step は複製ごとの公転位相をずらす時間オフセット（Echospace 的な「遅れて追う連鎖」）です。Count 1 のときは従来と完全に同一です。Independent Sim を On にすると、各複製が独立したシミュレーション状態を持ち、力の場も複製ごとに分岐します（WebGL 経路のみ）。
          </div>
        </>
      )}
    </div>

    {/* Terrain Mesh (Phase P, Mir-style polygon terrain) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Terrain Mesh （地形メッシュ）" value={config.gpgpuTerrainMeshEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTerrainMeshEnabled', v)} />
      {config.gpgpuTerrainMeshEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Display （表示形態）</div>
          <Toggle label="Display" value={config.gpgpuTerrainMeshDisplay} options={[{ label: 'Shaded', val: 'shaded' as const }, { label: 'Wireframe', val: 'wireframe' as const }, { label: 'Points', val: 'points' as const }]} onChange={(v) => updateConfig('gpgpuTerrainMeshDisplay', v)} />
          <Toggle label="Tunnel （トンネル）" value={config.gpgpuTerrainMeshTunnel} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTerrainMeshTunnel', v)} />
          {config.gpgpuTerrainMeshTunnel && (
            <Slider label="Tunnel Speed （前進速度）" value={config.gpgpuTunnelSpeed} min={0} max={60} step={1} onChange={(v) => updateConfig('gpgpuTunnelSpeed', v)} />
          )}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Texture （表面テクスチャ）</div>
          <select
            value={config.gpgpuTerrainMeshTexture}
            onChange={(e) => updateConfig('gpgpuTerrainMeshTexture', e.target.value as typeof config.gpgpuTerrainMeshTexture)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="none">None (単色陰影)</option>
            <option value="gradient">Gradient (モノクロ+等高線)</option>
            <option value="grid">Grid (測量グリッド)</option>
            <option value="image">Image (地形専用画像／背景画像)</option>
          </select>
          {config.gpgpuTerrainMeshTexture === 'image' && (
            <TerrainTextureImageBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuTerrainMeshTexture !== 'none' && (
            <>
              <Slider label="Texture Repeat （繰り返し）" value={config.gpgpuTerrainTextureRepeat} min={0.25} max={8} step={0.25} onChange={(v) => updateConfig('gpgpuTerrainTextureRepeat', v)} />
              <Slider label="Texture Offset X" value={config.gpgpuTerrainTextureOffsetX} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTerrainTextureOffsetX', v)} />
              <Slider label="Texture Offset Y" value={config.gpgpuTerrainTextureOffsetY} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTerrainTextureOffsetY', v)} />
            </>
          )}
          <Slider label="Scale （大きさ）" value={config.gpgpuTerrainMeshScale} min={0.25} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshScale', v)} />
          <Slider label="Opacity （不透明度）" value={config.gpgpuTerrainMeshOpacity} min={0.05} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshOpacity', v)} />
          <Slider label="Brightness （明るさ）" value={config.gpgpuTerrainMeshBrightness} min={0.1} max={2.5} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshBrightness', v)} />
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Terrain Field （高度場・モーフ地形と共有）</div>
          <Slider label="Amplitude （標高の振幅）" value={config.gpgpuMorphTerrainAmplitude} min={0} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainAmplitude', v)} />
          <Slider label="Frequency （周波数）" value={config.gpgpuMorphTerrainFrequency} min={0.4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainFrequency', v)} />
          <Slider label="Octaves （オクターブ）" value={config.gpgpuMorphTerrainOctaves} min={1} max={6} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainOctaves', Math.round(v))} />
          <Slider label="Terrain Seed （地形シード）" value={config.gpgpuMorphTerrainSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainSeed', Math.round(v))} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            高度場で変位させたポリゴンメッシュに頂点法線の陰影を付けます（Trapcode Mir 型）。高度場はモーフ地形（terrain目標）と共有するため、点地形とメッシュ地形は同じ地形になります。トンネルは円筒内面に巻いた形状で、高度場は継ぎ目なく周期化されます。テクスチャの Image は地形専用画像が優先され、未設定時は Horizon 背景画像を流用します。Repeat / Offset は全テクスチャ種に効く UV 変換です。Tunnel Speed は地形の位相スクロールによる前進表現で、カメラ自体は動きません。速度 0 では従来の静止トンネルと完全に同一です。
          </div>
        </>
      )}
    </div>

    {/* OBJ Mesh (Phase V, Mir-style mesh side of the OBJ import) */}
    <ObjMeshBlock config={config} updateConfig={updateConfig} />

    {/* Verlet Integration */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Verlet Integration" value={config.gpgpuVerletEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVerletEnabled', v)} />
    </div>

    {/* SDF Collider */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="SDF Collider" value={config.gpgpuSdfEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSdfEnabled', v)} />
      {config.gpgpuSdfEnabled && (
        <>
          <Toggle
            label="Shape"
            value={config.gpgpuSdfShape}
            options={[{ label: 'Sphere', val: 'sphere' }, { label: 'Box', val: 'box' }, { label: 'Torus', val: 'torus' }, { label: 'Capsule', val: 'capsule' }, { label: 'Gyroid', val: 'gyroid' }]}
            onChange={(v) => updateConfig('gpgpuSdfShape', v)}
          />
          {config.gpgpuSdfShape === 'gyroid' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Gyroid: ジャイロイド曲面（TPMS）の内側が固体になる迷路状コライダです（Kinetix の gyro）。Size が周期の大きさを決めます。
            </div>
          )}
          <Slider label="Size" value={config.gpgpuSdfSize} min={5} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfSize', v)} />
          <Slider label="Bounce" value={config.gpgpuSdfBounce} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuSdfBounce', v)} />
          <Slider label="Center X" value={config.gpgpuSdfX} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfX', v)} />
          <Slider label="Center Y" value={config.gpgpuSdfY} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfY', v)} />
          <Slider label="Center Z" value={config.gpgpuSdfZ} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfZ', v)} />
        </>
      )}
    </div>

    {/* Floor Bounce (B3) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Floor Bounce (床)" value={config.gpgpuFloorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFloorEnabled', v)} />
      {config.gpgpuFloorEnabled && (
        <>
          <Slider label="Floor Y" value={config.gpgpuFloorY} min={-400} max={100} step={5} onChange={(v) => updateConfig('gpgpuFloorY', v)} />
          <Slider label="Restitution (反発)" value={config.gpgpuFloorBounce} min={0} max={1} step={0.02} onChange={(v) => updateConfig('gpgpuFloorBounce', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            GPGPU 粒子が水平な床で跳ね返ります（Kinetix floorBounce）。球境界だけだった GPGPU に床が増えます。
          </div>
        </>
      )}
    </div>

    {/* Aux Event Emission (B3) — Child Emitter (Phase Q) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Child Emitter — Aux Event Emission (子エミッタ / イベント放出)</div>
      <select
        value={config.gpgpuAuxMode}
        onChange={(e) => updateConfig('gpgpuAuxMode', e.target.value as typeof config.gpgpuAuxMode)}
        className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
      >
        <option value="none">None (なし)</option>
        <option value="deathBurst">Death Burst (死亡時に飛沫)</option>
        <option value="bounceSplash">Bounce Splash (バウンス時に飛沫)</option>
        <option value="sparkTrail">Spark Trail (火花を落としながら進む)</option>
      </select>
      {config.gpgpuAuxMode !== 'none' && (
        <>
          <Slider label="Pool Count" value={config.gpgpuAuxCount} min={256} max={16384} step={256} onChange={(v) => updateConfig('gpgpuAuxCount', Math.round(v))} />
          <Slider label="Intensity" value={config.gpgpuAuxIntensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAuxIntensity', v)} />
          <Slider label="Aux Life (s)" value={config.gpgpuAuxLife} min={0.1} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAuxLife', v)} />
          <Slider label="Aux Speed" value={config.gpgpuAuxSpeed} min={1} max={80} step={1} onChange={(v) => updateConfig('gpgpuAuxSpeed', v)} />
          <Slider label="Aux Size" value={config.gpgpuAuxSize} min={0.3} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuAuxSize', v)} />
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Child Physics / Look （子独自の物理・見た目 — Phase Q）</div>
          <Slider label="Child Gravity Scale （子の重力倍率）" value={config.gpgpuAuxGravityScale} min={-3} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAuxGravityScale', v)} />
          <Slider label="Child Drag （子の追加ドラッグ）" value={config.gpgpuAuxDrag} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAuxDrag', v)} />
          <Slider label="Child Curl （子の渦）" value={config.gpgpuAuxCurl} min={-5} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuAuxCurl', v)} />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Child Color （子の色）{config.gpgpuAuxColor ? '' : ' — 親と同じ（継承中）'}</div>
          <div className="flex items-center gap-2">
            <input type="color" value={config.gpgpuAuxColor || '#ffffff'} onChange={(e) => updateConfig('gpgpuAuxColor', e.target.value)} className="h-8 flex-1 cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            <button type="button" onClick={() => updateConfig('gpgpuAuxColor', '')} className="cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90">親を継承</button>
          </div>
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            主粒子（親）のイベントで生まれる子エミッタ専用プールです（Kinetix auxMode の GPU 実装が土台）。子は独自のシミュレーションを持ち、上の Child 系キーで親と違う重力（0で無重力・負で反重力）・ドラッグ・渦・色で生きられます。既定（重力倍率1／ドラッグ0／渦0／色は継承）は従来の共有挙動と同一です。Death Burst は Life System が On のときだけ発火します。レイヤー側の Aux/Spark（常時型）とは別系統で併存します。
          </div>
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Chain — Grandchild Emitters （連鎖・孫エミッタ — Phase W1）</div>
          <select
            value={String(config.gpgpuAuxDepth)}
            onChange={(e) => updateConfig('gpgpuAuxDepth', Number(e.target.value))}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="1">Depth 1 （子まで — 従来どおり）</option>
            <option value="2">Depth 2 （孫まで）</option>
            <option value="3">Depth 3 （ひ孫まで — 最大3段）</option>
          </select>
          {config.gpgpuAuxDepth >= 2 && (
            <>
              <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Grandchild Event （孫のイベント方式 — レベル2以上の共通設定）</div>
              <select
                value={config.gpgpuAux2Mode}
                onChange={(e) => updateConfig('gpgpuAux2Mode', e.target.value as typeof config.gpgpuAux2Mode)}
                className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
              >
                <option value="none">None （連鎖しない）</option>
                <option value="deathBurst">Death Burst （子の死亡時に飛沫）</option>
                <option value="bounceSplash">Bounce Splash （子のバウンス時に飛沫）</option>
                <option value="sparkTrail">Spark Trail （子が火花を落とす）</option>
              </select>
              {config.gpgpuAux2Mode !== 'none' && (
                <>
                  <Slider label="Grandchild Intensity" value={config.gpgpuAux2Intensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAux2Intensity', v)} />
                  <Slider label="Grandchild Life (s)" value={config.gpgpuAux2Life} min={0.1} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAux2Life', v)} />
                  <Slider label="Grandchild Speed" value={config.gpgpuAux2Speed} min={1} max={80} step={1} onChange={(v) => updateConfig('gpgpuAux2Speed', v)} />
                  <Slider label="Grandchild Size" value={config.gpgpuAux2Size} min={0.3} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuAux2Size', v)} />
                  <Slider label="Grandchild Gravity Scale （孫の重力倍率）" value={config.gpgpuAux2GravityScale} min={-3} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuAux2GravityScale', v)} />
                  <Slider label="Grandchild Drag （孫の追加ドラッグ）" value={config.gpgpuAux2Drag} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAux2Drag', v)} />
                  <Slider label="Grandchild Curl （孫の渦）" value={config.gpgpuAux2Curl} min={-5} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuAux2Curl', v)} />
                  <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Grandchild Color （孫の色）{config.gpgpuAux2Color ? '' : ' — 子と同じ（継承中）'}</div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={config.gpgpuAux2Color || '#ffffff'} onChange={(e) => updateConfig('gpgpuAux2Color', e.target.value)} className="h-8 flex-1 cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
                    <button type="button" onClick={() => updateConfig('gpgpuAux2Color', '')} className="cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90">子を継承</button>
                  </div>
                </>
              )}
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                子のイベントで孫が生まれる多段連鎖です（最大3段まで — テクスチャと描画のコストが段数に比例するため上限があります）。レベル2以上の設定は1セットを共有し、深さ3では孫の設定がひ孫にもそのまま再帰適用されます。深さ2以上で Aux2 が None のときは連鎖しません。プールは深さが届く段だけ確保されます。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Color over Lifetime */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Color over Lifetime" value={config.gpgpuAgeColorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAgeColorEnabled', v)} />
      {config.gpgpuAgeColorEnabled && (
        <div className="flex gap-3 mt-2">
          <div className="flex-1">
            <div className="mb-1 text-[9px] opacity-60 uppercase tracking-widest">Young</div>
            <input type="color" value={config.gpgpuAgeColorYoung} onChange={(e) => updateConfig('gpgpuAgeColorYoung', e.target.value)} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[9px] opacity-60 uppercase tracking-widest">Old</div>
            <input type="color" value={config.gpgpuAgeColorOld} onChange={(e) => updateConfig('gpgpuAgeColorOld', e.target.value)} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
          </div>
        </div>
      )}
    </div>

    {/* Kinetix Color gradient (B2, opt-in) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Kinetix Color Gradient" value={config.gpgpuGradEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGradEnabled', v)} />
      {config.gpgpuGradEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Driver</div>
          <select
            value={config.gpgpuGradDriver}
            onChange={(e) => updateConfig('gpgpuGradDriver', e.target.value as typeof config.gpgpuGradDriver)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="life">Life（寿命）</option>
            <option value="velocity">Velocity（速度）</option>
            <option value="spatial">Spatial（中心からの距離）</option>
            <option value="height">Height（高さ・ワールドY）</option>
            <option value="prism">Prism（色相環）</option>
            <option value="blackbody">Blackbody（黒体放射）</option>
            <option value="image">Image（画像から色）</option>
          </select>
          <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Gradient Preset</div>
          <select
            value={config.gpgpuGradPreset}
            onChange={(e) => {
              const preset = getKinetixGradientPreset(e.target.value);
              if (preset) {
                updateConfig('gpgpuGradPreset', preset.id);
                updateConfig('gpgpuGradStart', preset.start);
                updateConfig('gpgpuGradMid', preset.mid);
                updateConfig('gpgpuGradEnd', preset.end);
              } else {
                updateConfig('gpgpuGradPreset', 'custom');
              }
            }}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            {KINETIX_COLOR_GRADIENTS.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="mb-1 text-[9px] opacity-60 uppercase tracking-widest">Start</div>
              <input type="color" value={config.gpgpuGradStart} onChange={(e) => { updateConfig('gpgpuGradStart', e.target.value); updateConfig('gpgpuGradPreset', 'custom'); }} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-[9px] opacity-60 uppercase tracking-widest">Mid</div>
              <input type="color" value={config.gpgpuGradMid} onChange={(e) => { updateConfig('gpgpuGradMid', e.target.value); updateConfig('gpgpuGradPreset', 'custom'); }} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-[9px] opacity-60 uppercase tracking-widest">End</div>
              <input type="color" value={config.gpgpuGradEnd} onChange={(e) => { updateConfig('gpgpuGradEnd', e.target.value); updateConfig('gpgpuGradPreset', 'custom'); }} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            </div>
          </div>
          {config.gpgpuGradDriver === 'spatial' && (
            <Slider label="Spatial Scale" value={config.gpgpuGradSpatialScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuGradSpatialScale', v)} />
          )}
          {config.gpgpuGradDriver === 'height' && (
            <>
              <Slider label="Height Scale" value={config.gpgpuGradSpatialScale} min={0.001} max={0.05} step={0.001} onChange={(v) => updateConfig('gpgpuGradSpatialScale', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Height は粒子のワールドY（高さ）でグラデーションを引きます。谷（低い所）が Start、山頂（高い所）が End の色になります。Terrain モーフと組み合わせると地形の標高シェーディングになります。
              </div>
            </>
          )}
          {config.gpgpuGradDriver === 'prism' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Prism はグラデーション色を使わず、寿命と粒子ごとのシードで色相環を回します（Kinetix の prism と同義）。
            </div>
          )}
          {config.gpgpuGradDriver === 'blackbody' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Blackbody はグラデーション色を使わず、寿命と速度から熱（煙→煤→深紅→橙→白熱）を近似します（Kinetix の黒体ランプと同値）。
            </div>
          )}
          {config.gpgpuGradDriver === 'image' && (
            <GradImageBlock config={config} updateConfig={updateConfig} />
          )}
        </>
      )}
      <div className="mt-3">
        <Toggle
          label="Blend Mode"
          value={config.gpgpuBlendMode}
          options={[{ label: 'Additive', val: 'additive' }, { label: 'Normal', val: 'normal' }]}
          onChange={(v) => updateConfig('gpgpuBlendMode', v)}
        />
      </div>
    </div>

    {/* Size over Lifetime */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Size over Lifetime" value={config.gpgpuAgeSizeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuAgeSizeEnabled', v)} />
      {config.gpgpuAgeSizeEnabled && (
        <>
          <Toggle
            label="Curve"
            value={config.gpgpuAgeSizeCurve}
            options={[{ label: 'Linear', val: 'linear' }, { label: 'Bell', val: 'bell' }]}
            onChange={(v) => updateConfig('gpgpuAgeSizeCurve', v)}
          />
          <Slider label="Size at Birth" value={config.gpgpuAgeSizeStart} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAgeSizeStart', v)} />
          <Slider label="Size at Death" value={config.gpgpuAgeSizeEnd} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuAgeSizeEnd', v)} />
          {config.gpgpuAgeSizeCurve === 'bell' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Bell: 寿命の中間で「Size at Birth」の大きさまで膨らみ、両端では「Size at Death」の大きさになります（Kinetix の bell カーブ）。
            </div>
          )}
        </>
      )}
    </div>

    {/* Age Curves (Phase U): fixed-position 5-point curves over the
        normalised age. Each curve multiplies the legacy age path, so
        a flat curve changes nothing. */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/70">Age Curves（年齢カーブ・5点）</div>
      <AgeCurveBlock
        title="Size Curve（サイズ）"
        enabled={config.gpgpuAgeCurveSizeEnabled}
        points={config.gpgpuAgeCurveSizePoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveSizeEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveSizePoints', v)}
      />
      <AgeCurveBlock
        title="Opacity Curve（不透明度）"
        enabled={config.gpgpuAgeCurveOpacityEnabled}
        points={config.gpgpuAgeCurveOpacityPoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveOpacityEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveOpacityPoints', v)}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        年齢比 t = 0 / 0.25 / 0.5 / 0.75 / 1 の5点に倍率を持ち、間を線形補間します。カーブは従来の年齢系（Size over Lifetime、フェードイン／アウト）に乗算されるため、全点 1.0 のままでは見た目は変わりません。
      </div>
    </div>

    {/* Layer Maps (Phase U): the gradient image modulates size /
        opacity per property, sampled by particle position.
        Phase X: each property can carry its own image (unset =
        the common gradient image), displacement joins the set,
        and a raster mask section follows below. */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/70">Layer Maps（画像マップ）</div>
      <Slider label="Map Size Amount" value={config.gpgpuMapSizeAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMapSizeAmount', v)} />
      <Slider label="Map Opacity Amount" value={config.gpgpuMapOpacityAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMapOpacityAmount', v)} />
      <Slider label="Map Displace Amount" value={config.gpgpuMapDisplaceAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMapDisplaceAmount', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {config.gpgpuGradImageSource
          ? '共通マップは Color Gradient の Image ドライバと同じ画像（設定済み）を使います。粒子は自分の位置（XY 平面、バウンス範囲全体）で画像の輝度を引き、Amount 1 で輝度がそのまま倍率になります。変位は輝度で配置点を半径方向にずらします。'
          : '共通画像が未設定のため、専用画像を設定したプロパティ以外は Amount を上げても変調は効きません。Color Gradient の Driver を Image にして画像を設定すると、その画像が共通マップとして使われます。'}
      </div>
      <MapSourceBlock
        title="Size Map（サイズ専用）"
        source={config.gpgpuMapSizeSource}
        onSource={(v) => updateConfig('gpgpuMapSizeSource', v)}
      />
      <MapSourceBlock
        title="Opacity Map（不透明度専用）"
        source={config.gpgpuMapOpacitySource}
        onSource={(v) => updateConfig('gpgpuMapOpacitySource', v)}
      />
      <MapSourceBlock
        title="Color Map（色専用）"
        source={config.gpgpuMapColorSource}
        onSource={(v) => updateConfig('gpgpuMapColorSource', v)}
      />
      <MapSourceBlock
        title="Displace Map（変位専用）"
        source={config.gpgpuMapDisplaceSource}
        onSource={(v) => updateConfig('gpgpuMapDisplaceSource', v)}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        専用画像が未設定のプロパティは共通マップにフォールバックします。Color Map を設定すると、Image ドライバの入力はその画像になります（色は輝度ドライバとして消費されます）。
      </div>
    </div>

    {/* Raster Mask (Phase X): a luminance image that clips or
        shapes placement — baked into the morph targets and the
        layer media placement, and enforced live by the draw
        shader's fragment clip. */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/70">Raster Mask（ラスタマスク）</div>
      <Toggle
        label="Mask Mode"
        value={config.gpgpuMaskMode}
        options={[{ label: 'Off', val: 'off' }, { label: 'Clip', val: 'clip' }, { label: 'Shape', val: 'shape' }]}
        onChange={(v) => updateConfig('gpgpuMaskMode', v)}
      />
      {config.gpgpuMaskMode !== 'off' && (
        <>
          <Slider label="Mask Threshold" value={config.gpgpuMaskThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMaskThreshold', v)} />
          <Toggle label="Mask Invert" value={config.gpgpuMaskInvert} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMaskInvert', v)} />
        </>
      )}
      <MaskSourceBlock config={config} updateConfig={updateConfig} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        clip は閾値未満の領域を間引き（ベイク時はマスク内へ再配置、描画時はフラグメントを破棄）、shape は輝度を確率としてマスク形状そのものから配置をサンプリングします。モーフ目標の配置とレイヤーのメディア配置の両方に同じ意味で効きます。
      </div>
    </div>

    {/* Mouse Force */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Mouse Force" value={config.gpgpuMouseEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMouseEnabled', v)} />
      {config.gpgpuMouseEnabled && (
        <>
          <Toggle
            label="Mode"
            value={config.gpgpuMouseMode}
            options={[{ label: 'Attract', val: 'attract' }, { label: 'Repel', val: 'repel' }, { label: 'Swirl', val: 'swirl' }, { label: 'Paint', val: 'paint' }]}
            onChange={(v) => updateConfig('gpgpuMouseMode', v)}
          />
          <Slider label="Strength" value={config.gpgpuMouseStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuMouseStrength', v)} />
          <Slider label="Radius" value={config.gpgpuMouseRadius} min={10} max={500} step={10} onChange={(v) => updateConfig('gpgpuMouseRadius', v)} />
          {config.gpgpuMouseMode === 'paint' && (
            <>
              <Slider label="Paint Rate (描く量)" value={config.gpgpuMousePaintRate} min={0.05} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuMousePaintRate', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Paint: ポインタ位置から粒子が湧き出します（Kinetix の pointer paint）。プールの一部が毎ティック、ブラシ位置へ再放出されます。Strength が初速、Radius がブラシの広がりです。
              </div>
            </>
          )}
        </>
      )}
    </div>

    {/* Sort-based Transparency (GPU Bitonic Sort) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Depth Sort (Alpha)" value={config.gpgpuSortEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSortEnabled', v)} />
      {config.gpgpuSortEnabled && (
        <div className="mt-1 text-[9px] text-white/40">GPU bitonic sort — far particles drawn first. Switches to Normal blending.</div>
      )}
    </div>

    {/* Fluid Advection */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Fluid Advection" value={config.gpgpuFluidEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFluidEnabled', v)} />
      {config.gpgpuFluidEnabled && (
        <>
          <Slider label="Influence" value={config.gpgpuFluidInfluence} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuFluidInfluence', v)} />
          <Slider label="Strength" value={config.gpgpuFluidStrength} min={0} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuFluidStrength', v)} />
          <Slider label="Diffuse" value={config.gpgpuFluidDiffuse} min={0} max={0.2} step={0.002} onChange={(v) => updateConfig('gpgpuFluidDiffuse', v)} />
          <Slider label="Decay" value={config.gpgpuFluidDecay} min={0} max={0.1} step={0.001} onChange={(v) => updateConfig('gpgpuFluidDecay', v)} />
          <Slider label="Scale" value={config.gpgpuFluidScale} min={0.5} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuFluidScale', v)} />
          <Toggle label="Ext. Force (Vortex)" value={config.gpgpuFluidExtForce} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFluidExtForce', v)} />
        </>
      )}
    </div>

    {/* Custom GLSL Force */}
    <CustomForceBlock config={config} updateConfig={updateConfig} />

    {/* Simple LFO (B3, Kinetix-style single-target view of the modulation engine) */}
    <SimpleLfoBlock />
  </>
);

/**
 * One age curve (Phase U): an enable toggle, five sliders at the
 * fixed age positions t = 0 / .25 / .5 / .75 / 1, and preset chips
 * that write a whole point list at once. Deliberately NOT a curve
 * editor — the five sliders are the whole surface.
 */
const AgeCurveBlock: React.FC<{
  title: string;
  enabled: boolean;
  points: number[];
  onToggle: (v: boolean) => void;
  onPoints: (v: number[]) => void;
}> = ({ title, enabled, points, onToggle, onPoints }) => {
  const clean = normalizeAgeCurvePoints(points);
  const labels = ['t=0', 't=0.25', 't=0.5', 't=0.75', 't=1'];
  return (
    <div className="mb-3">
      <Toggle label={title} value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={onToggle} />
      {enabled && (
        <>
          <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
            {AGE_CURVE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onPoints([...preset.points])}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {clean.map((value, i) => (
            <Slider
              key={labels[i]}
              label={labels[i]}
              value={value}
              min={0}
              max={AGE_CURVE_POINT_MAX}
              step={0.05}
              onChange={(v) => {
                const next = [...clean];
                next[i] = v;
                onPoints(next);
              }}
            />
          ))}
        </>
      )}
    </div>
  );
};

/** Load an image file element from a picked file (shared helper). */
async function loadPickedImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscale an image to <= maxPx and return a JPEG data URL. */
function downscaledDataUrl(img: HTMLImageElement, maxPx: number): string {
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.87);
}

/**
 * One per-property Layer Map source (Phase X): same import flow
 * as the common gradient image (downscaled data URL in config),
 * with an explicit "未設定 = 共通マップ" state instead of a
 * silent fallback.
 */
const MapSourceBlock: React.FC<{
  title: string;
  source: string;
  onSource: (v: string) => void;
}> = ({ title, source, onSource }) => {
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadPickedImage(file);
      const url = downscaledDataUrl(img, 256);
      if (url) onSource(url);
    } catch {
      // Unreadable file: keep the previous source untouched.
    }
  };
  return (
    <div className="mb-2 mt-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/50">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />
            <button
              onClick={() => onSource('')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source ? '専用画像を設定済み: このプロパティは共通マップではなくこの画像を使います。' : '未設定: このプロパティは共通マップを使います。'}
      </div>
    </div>
  );
};

/**
 * Raster mask source (Phase X): importing an image stores both
 * the data URL (for the draw shader's fragment clip and the
 * preview) and the numeric luma map captured at <=128px (for the
 * deterministic bake and media placement), following the
 * layer2MediaLumaMap precedent. Clearing removes both.
 */
const MaskSourceBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMaskSource;
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadPickedImage(file);
      const url = downscaledDataUrl(img, 256);
      if (!url) return;
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const scale = Math.min(1, 128 / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const map = extractLumaMap(img, w, h);
      updateConfig('gpgpuMaskSource', url);
      updateConfig('gpgpuMaskMap', map);
      updateConfig('gpgpuMaskMapWidth', w);
      updateConfig('gpgpuMaskMapHeight', h);
    } catch {
      // Unreadable file: keep the previous mask untouched.
    }
  };
  const clear = () => {
    updateConfig('gpgpuMaskSource', '');
    updateConfig('gpgpuMaskMap', []);
    updateConfig('gpgpuMaskMapWidth', 0);
    updateConfig('gpgpuMaskMapHeight', 0);
  };
  return (
    <div className="mb-2 mt-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          マスク画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {(source || config.gpgpuMaskMap.length > 0) && (
          <>
            {source && <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />}
            <button
              onClick={clear}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? `マスク設定済み（輝度マップ ${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight} を取り込み時に抽出）。白い領域が残り、黒い領域が間引かれます。`
          : config.gpgpuMaskMap.length > 0
            ? `輝度マップのみ設定済み（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}、プリセット由来）。ベイクとメディア配置には効きますが、描画時のフラグメント clip には画像本体が必要です。`
            : 'マスク画像が未設定のため、Mode を切り替えてもマスクは効きません。'}
      </div>
    </div>
  );
};

/**
 * Image source controls for the gradient 'image' driver (Phase A).
 * The picked image is downscaled to <=256px and stored in the config
 * as a data URL (gpgpuGradImageSource), so — like the SVG morph
 * source — it persists with presets / projects. The point shader
 * samples the image by particle position (world XY over the bounce
 * sphere). While no image is set the driver falls back to the life
 * gradient; the status line below states that explicitly instead of
 * falling back silently.
 */
const GradImageBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuGradImageSource;
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = url;
      });
      const scale = Math.min(1, 256 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateConfig('gpgpuGradImageSource', canvas.toDataURL('image/jpeg', 0.87));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />
            <button
              onClick={() => updateConfig('gpgpuGradImageSource', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? '画像を設定済み: 粒子は自分の位置（XY 平面、バウンス範囲全体に画像を広げる）で画像の色を拾います。画像は 256px 以下に縮小され、config に保持されます。'
          : '画像が未設定のため、いまは Life グラデーションで代替しています。画像を設定すると、粒子が位置ごとに画像の色を拾うようになります。'}
      </div>
    </div>
  );
};

/**
 * SVG import controls for the morph 'svg' target (Pro-2). The SVG
 * source text is stored in the config itself (gpgpuMorphSvgSource),
 * so — like the TextMap text — it survives reloads with the project
 * and travels with presets. The point cloud is re-sampled from the
 * source at bake time; the status line below runs the same sampler
 * so what it reports is what the bake will use.
 */
const MorphSvgImportBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphSvgSource;
  const cloud = React.useMemo(() => (source ? sampleSvgPointCloud(source) : null), [source]);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    updateConfig('gpgpuMorphSvgSource', text.slice(0, 200_000));
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          SVG ファイルを開く
          <input
            type="file"
            accept=".svg,image/svg+xml,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => updateConfig('gpgpuMorphSvgSource', SAMPLE_SVG_STAR)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (星)
        </button>
        {source && (
          <button
            onClick={() => updateConfig('gpgpuMorphSvgSource', '')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            クリア
          </button>
        )}
      </div>
      <textarea
        value={source}
        onChange={(event) => updateConfig('gpgpuMorphSvgSource', event.target.value.slice(0, 200_000))}
        spellCheck={false}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
        placeholder={'<svg viewBox="0 0 100 100"><path d="M ..."/></svg> を貼り付け'}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? cloud
            ? `輪郭を ${cloud.length / 2} 点にサンプリングしました（弧長均等）。パス基本コマンド M/L/H/V/C/S/Q/T/A/Z と基本図形に対応。塗りつぶしは輪郭として扱います。`
            : '読み取れる図形がありません（path 等の図形要素が必要です）。'
          : 'SVG を取り込むと、その輪郭点群へ粒子が集まります（ロゴ・リビール用）。ソースは config に保持され、再読み込みでも消えません。'}
      </div>
    </div>
  );
};

/**
 * OBJ import controls for the morph 'obj' target (Phase J). Like the
 * SVG source, the OBJ source text is stored in the config itself
 * (gpgpuMorphObjSource), so it survives reloads with the project and
 * travels with presets. The surface cloud is re-sampled from the
 * source at bake time; the status line below runs the same parser so
 * what it reports is what the bake will use. When the source is empty
 * or unusable the bake falls back to a sphere shell — the status line
 * states that explicitly instead of failing silently.
 */
const MorphObjImportBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphObjSource;
  const geometry = React.useMemo(() => (source ? parseObjGeometry(source) : null), [source]);
  const sampleMode = config.gpgpuMorphObjSampleMode;
  // Volume needs a closed mesh to define an interior; the sampler
  // falls back to surface otherwise, and this block says so up front
  // (same verdict function the sampler itself uses).
  const volumeFallsBack = sampleMode === 'volume' && geometry !== null && !isObjClosedMesh(geometry);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    updateConfig('gpgpuMorphObjSource', text.slice(0, 200_000));
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          OBJ ファイルを開く
          <input
            type="file"
            accept=".obj,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => updateConfig('gpgpuMorphObjSource', SAMPLE_OBJ_SPHERE)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (球)
        </button>
        <button
          onClick={() => updateConfig('gpgpuMorphObjSource', SAMPLE_OBJ_TORUS_KNOT)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (結び目)
        </button>
        {source && (
          <button
            onClick={() => updateConfig('gpgpuMorphObjSource', '')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            クリア
          </button>
        )}
      </div>
      <textarea
        value={source}
        onChange={(event) => updateConfig('gpgpuMorphObjSource', event.target.value.slice(0, 200_000))}
        spellCheck={false}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
        placeholder={'v 0 0 0 / f 1 2 3 ... の OBJ テキストを貼り付け'}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? geometry
            ? `頂点 ${geometry.vertexCount}・面 ${geometry.faceCount}（三角形 ${geometry.triangleCount}）を読み取りました。8,192 点にサンプリングします（決定的）。`
            : '読み取れる頂点/面がありません（v と f の行が必要です）。現在は球シェルで代替しています。'
          : 'OBJ を取り込むと、その点群へ粒子が集まります（3Dモデル・ロゴ立体用）。未設定の間は球シェルで代替しています。ソースは config に保持され、再読み込みでも消えません。'}
      </div>
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Sample Mode （サンプリング方式）</div>
      <select
        value={sampleMode}
        onChange={(e) => updateConfig('gpgpuMorphObjSampleMode', e.target.value as typeof config.gpgpuMorphObjSampleMode)}
        className="mb-2 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
      >
        <option value="surface">Surface （表面・面積重み）</option>
        <option value="vertices">Vertices （頂点そのもの）</option>
        <option value="volume">Volume （内部を充填・閉メッシュのみ）</option>
      </select>
      <Slider label="Normal Speed （法線初速）" value={config.gpgpuMorphObjNormalSpeed} min={0} max={80} step={1} onChange={(v) => updateConfig('gpgpuMorphObjNormalSpeed', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {sampleMode === 'vertices'
          ? '頂点そのものに粒子を置きます（疎なモデルでは頂点の粗さがそのまま見えます）。'
          : sampleMode === 'volume'
            ? volumeFallsBack
              ? 'このメッシュは閉じていないため（内部を定義できません）、Volume は Surface にフォールバックしています。'
              : '閉メッシュの内部を一様に充填します（中身のある立体になります）。'
            : '表面を面積重みで一様にサンプリングします（Phase J からの従来方式）。'}
        {' '}法線初速は、配置時（開始時とリスポーン時）にサンプル法線の方向へ粒子を放つ初速です。常時かかる力ではないので、膨らんだ粒子はモーフの引力で形に戻ります。0 で無効です。
      </div>
    </div>
  );
};

/**
 * Dedicated terrain texture image controls (Phase V). Same
 * placement manners as the sprite image block: the picked image is
 * downscaled to <=256px and stored in the config as a data URL
 * (gpgpuTerrainTextureImage), so it persists with presets. While a
 * dedicated image is set it takes precedence over the Horizon
 * background image; while it is empty the background image is used
 * exactly as before Phase V — the status line says which source is
 * live instead of switching silently.
 */
const TerrainTextureImageBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuTerrainTextureImage;
  const fallback = config.backgroundImageSource;
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = url;
      });
      const scale = Math.min(1, 256 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateConfig('gpgpuTerrainTextureImage', canvas.toDataURL('image/png'));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Terrain Texture Image（地形専用画像）</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />
            <button
              onClick={() => updateConfig('gpgpuTerrainTextureImage', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? '地形専用画像を設定済み: 背景画像より優先して面の map になります。画像は 256px 以下に縮小され、config に保持されます。'
          : fallback
            ? '専用画像は未設定のため、Horizon 背景画像を流用しています。専用画像を設定するとそちらが優先されます。'
            : '専用画像も背景画像も未設定のため、設定されるまでは単色陰影で表示します。'}
      </div>
    </div>
  );
};

/**
 * OBJ Mesh controls (Phase V): the polygon face of the imported
 * OBJ. The data source is the morph import's gpgpuMorphObjSource —
 * shared, never duplicated — so this block carries only the mesh
 * system's own keys. With no usable source the scene component
 * draws nothing; the status line here says so explicitly, using
 * the same parser verdict as the renderer.
 */
const ObjMeshBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphObjSource;
  const geometry = React.useMemo(() => (source ? parseObjGeometry(source) : null), [source]);
  const enabled = config.gpgpuObjMeshEnabled;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="OBJ Mesh （OBJメッシュ描画）" value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuObjMeshEnabled', v)} />
      {enabled && (
        <>
          {!geometry && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              OBJ が未設定（または読み取れる頂点/面がない）ため、何も描きません。Morph の OBJ 取り込みで OBJ を設定してください（データ源はモーフと共有です）。
            </div>
          )}
          {geometry && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              {`頂点 ${geometry.vertexCount}・三角形 ${geometry.triangleCount} のメッシュを描きます。`}
            </div>
          )}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Display （表示形態）</div>
          <Toggle label="Display" value={config.gpgpuObjMeshDisplay} options={[{ label: 'Wireframe', val: 'wireframe' as const }, { label: 'Solid', val: 'solid' as const }]} onChange={(v) => updateConfig('gpgpuObjMeshDisplay', v)} />
          <Slider label="Repeat （反復）" value={config.gpgpuObjMeshRepeat} min={1} max={64} step={1} onChange={(v) => updateConfig('gpgpuObjMeshRepeat', Math.round(v))} />
          <Toggle label="Repeat Mode （反復配置）" value={config.gpgpuObjMeshRepeatMode} options={[{ label: 'Grid', val: 'grid' as const }, { label: 'Radial', val: 'radial' as const }]} onChange={(v) => updateConfig('gpgpuObjMeshRepeatMode', v)} />
          <Slider label="Repeat Rotation （反復ごとの回転°）" value={config.gpgpuObjMeshRepeatRotation} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuObjMeshRepeatRotation', v)} />
          <Slider label="Repeat Scale Step （反復ごとの拡縮比）" value={config.gpgpuObjMeshRepeatScaleStep} min={0.5} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshRepeatScaleStep', v)} />
          <Slider label="Scale （大きさ）" value={config.gpgpuObjMeshScale} min={0.25} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshScale', v)} />
          <Slider label="Position X" value={config.gpgpuObjMeshPosX} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosX', v)} />
          <Slider label="Position Y" value={config.gpgpuObjMeshPosY} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosY', v)} />
          <Slider label="Position Z" value={config.gpgpuObjMeshPosZ} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosZ', v)} />
          <Slider label="Rotation Y （回転°）" value={config.gpgpuObjMeshRotY} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuObjMeshRotY', v)} />
          <Slider label="Opacity （不透明度）" value={config.gpgpuObjMeshOpacity} min={0.05} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshOpacity', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            取り込み済み OBJ をポリゴンメッシュとして描きます（Trapcode Mir 型）。正規化と寸法はモーフ点群と一致するため、点群と重ねて表示できます。Repeat は格子状の複製で、モーフの複製文法（Replicas）とは独立です。
          </div>
        </>
      )}
    </div>
  );
};

const CustomForceBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useCustomForceStatus();
  const [draft, setDraft] = React.useState(config.gpgpuCustomForceCode);
  const dirty = draft !== config.gpgpuCustomForceCode;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Custom Force (GLSL)" value={config.gpgpuCustomForceEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuCustomForceEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        速度シミュレーションの最後に自分の GLSL を差し込みます（WebGL 経路）。pos / vel（vec3）、uTime / uDelta（float）が読めます。vel に加算してください。コンパイル確認を通ったコードだけが差し替わります。
      </div>
      {config.gpgpuCustomForceEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: vel.y += sin(pos.x * 0.05 + uTime) * 20.0 * uDelta;'}
          />
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">VEX Deform Presets (名前付き変形)</div>
          <div className="flex flex-wrap gap-2">
            {VEX_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => { setDraft(preset.code); updateConfig('gpgpuCustomForceCode', preset.code); }}
                title={preset.description}
                className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            Kinetix の VEX 変形4種を Custom Force のプリセットとして読み込みます（押すと即適用）。変形先の位置へ速度を寄せる方式で、他のフォースと併用できます。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('gpgpuCustomForceCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(CUSTOM_FORCE_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">カスタムフォース適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};

// Simple LFO (Kinetix integration B3): Kinetix exposes its modulator
// as one target + speed + amount. The modulation engine underneath is
// Kalokagathia's own (LFO x4 routed to any catalogued parameter); this
// block is only the single-target view of it — it owns one route
// (id below) on LFO 0 with a sine wave, and never touches other routes.
const SIMPLE_LFO_ROUTE_ID = 'kinetix-simple-lfo';
const SIMPLE_LFO_TARGETS: { value: keyof ParticleConfig; label: string }[] = [
  { value: 'gpgpuTurbulence', label: 'Turbulence' },
  { value: 'gpgpuVortexStrength', label: 'Swirl (Vortex Strength)' },
  { value: 'gpgpuMorphStrength', label: 'Morph Strength' },
  { value: 'gpgpuSize', label: 'Particle Size' },
  { value: 'gpgpuWellStrength', label: 'Attractor (Well Strength)' },
];

const SimpleLfoBlock: React.FC = () => {
  const setup = useModulationSetup();
  const route = setup.routes.find((r) => r.id === SIMPLE_LFO_ROUTE_ID);
  const lfo = setup.lfos[0] ?? { waveform: 'sine' as const, rate: 0.5 };
  const enabled = !!route;
  const write = (next: { target?: keyof ParticleConfig; rate?: number; depth?: number; on?: boolean }) => {
    const on = next.on ?? enabled;
    const routes = setup.routes.filter((r) => r.id !== SIMPLE_LFO_ROUTE_ID);
    if (on) {
      routes.push({
        id: SIMPLE_LFO_ROUTE_ID,
        source: { kind: 'lfo', index: 0 },
        target: next.target ?? route?.target ?? 'gpgpuTurbulence',
        depth: next.depth ?? route?.depth ?? 0.35,
      });
    }
    const lfos = setup.lfos.slice();
    while (lfos.length < 4) lfos.push({ waveform: 'sine', rate: 0.5 });
    lfos[0] = { waveform: 'sine', rate: next.rate ?? lfo.rate };
    setModulationSetup({ ...setup, enabled: on ? true : setup.enabled, lfos, routes });
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Simple LFO (簡易LFO)" value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write({ on: v })} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        1つのパラメータを正弦波で揺らす簡易版です（Kinetix の LFO の見せ方）。実体はモジュレーション基盤の LFO 0 + 専用ルートで、Play タブの詳細なルーティングと併存します。
      </div>
      {enabled && route && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Target</div>
          <select
            value={route.target}
            onChange={(e) => write({ target: e.target.value as keyof ParticleConfig })}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            {SIMPLE_LFO_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <Slider label="Rate (Hz)" value={lfo.rate} min={0.05} max={3} step={0.05} onChange={(v) => write({ rate: v })} />
          <Slider label="Amount (深さ)" value={route.depth} min={0} max={1} step={0.01} onChange={(v) => write({ depth: v })} />
        </>
      )}
    </div>
  );
};
