import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

import { Slider, Toggle } from './controlPanelParts';
import { AgeCurveBlock, MapSourceBlock, MaskSourceBlock } from './controlPanelGlobalDisplayGpgpuForcesMapBlocks';
import { FreeCurveEditor } from './controlPanelGlobalDisplayGpgpuForcesCore';
import { flattenFreeCurvePoints, normalizeFreeCurvePoints } from '../lib/freeCurve';
import { CustomForceBlock, SimpleLfoBlock } from './controlPanelGlobalDisplayGpgpuForcesCustom';
import { ParticleVertexGlslBlock } from './controlPanelGlobalDisplayParticleVertexCustom';
import { ParticleFragmentGlslBlock } from './controlPanelGlobalDisplayParticleFragmentCustom';
import { VolumeFogGlslBlock } from './controlPanelGlobalDisplayVolumeFogCustom';
import { GeomCustomFragmentGlslBlock, GeomCustomVertexGlslBlock } from './controlPanelGlobalDisplayGpgpuGeomCustom';

/** Age free curve (Grammar 2.0 stage 2, B4): one target's
 *  free-mode switch + the shared FreeCurveEditor (Phase AJ).
 *  While the free mode is on, the target's evaluation source
 *  is this free control-point asset instead of its 5 points;
 *  the editor is the same component the emission gate and
 *  the tube profiles use. Rendered only while the target
 *  itself is enabled. */
const AgeFreeCurveBlock: React.FC<{
  freeEnabled: boolean;
  freePoints: number[];
  onFreeToggle: (v: boolean) => void;
  onFreePoints: (v: number[]) => void;
}> = ({ freeEnabled, freePoints, onFreeToggle, onFreePoints }) => (
  <div className="mb-3 ml-3 border-l border-white/10 pl-3">
    <Toggle label="Free Curve（自由制御点で置き換え）" value={freeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={onFreeToggle} />
    {freeEnabled && (
      <FreeCurveEditor
        points={normalizeFreeCurvePoints(freePoints)}
        onChange={(pts) => onFreePoints(flattenFreeCurvePoints(pts))}
      />
    )}
  </div>
);

export const GlobalDisplayGpgpuForcesMapsSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
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
      {config.gpgpuAgeCurveSizeEnabled && (
        <AgeFreeCurveBlock
          freeEnabled={config.gpgpuAgeCurveSizeFreeEnabled}
          freePoints={config.gpgpuAgeCurveSizeFreePoints}
          onFreeToggle={(v) => updateConfig('gpgpuAgeCurveSizeFreeEnabled', v)}
          onFreePoints={(v) => updateConfig('gpgpuAgeCurveSizeFreePoints', v)}
        />
      )}
      <AgeCurveBlock
        title="Opacity Curve（不透明度）"
        enabled={config.gpgpuAgeCurveOpacityEnabled}
        points={config.gpgpuAgeCurveOpacityPoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveOpacityEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveOpacityPoints', v)}
      />
      {config.gpgpuAgeCurveOpacityEnabled && (
        <AgeFreeCurveBlock
          freeEnabled={config.gpgpuAgeCurveOpacityFreeEnabled}
          freePoints={config.gpgpuAgeCurveOpacityFreePoints}
          onFreeToggle={(v) => updateConfig('gpgpuAgeCurveOpacityFreeEnabled', v)}
          onFreePoints={(v) => updateConfig('gpgpuAgeCurveOpacityFreePoints', v)}
        />
      )}
      <AgeCurveBlock
        title="Velocity Curve（速度）"
        enabled={config.gpgpuAgeCurveVelocityEnabled}
        points={config.gpgpuAgeCurveVelocityPoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveVelocityEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveVelocityPoints', v)}
      />
      {config.gpgpuAgeCurveVelocityEnabled && (
        <AgeFreeCurveBlock
          freeEnabled={config.gpgpuAgeCurveVelocityFreeEnabled}
          freePoints={config.gpgpuAgeCurveVelocityFreePoints}
          onFreeToggle={(v) => updateConfig('gpgpuAgeCurveVelocityFreeEnabled', v)}
          onFreePoints={(v) => updateConfig('gpgpuAgeCurveVelocityFreePoints', v)}
        />
      )}
      <AgeCurveBlock
        title="Force Curve（フォース）"
        enabled={config.gpgpuAgeCurveForceEnabled}
        points={config.gpgpuAgeCurveForcePoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveForceEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveForcePoints', v)}
      />
      {config.gpgpuAgeCurveForceEnabled && (
        <AgeFreeCurveBlock
          freeEnabled={config.gpgpuAgeCurveForceFreeEnabled}
          freePoints={config.gpgpuAgeCurveForceFreePoints}
          onFreeToggle={(v) => updateConfig('gpgpuAgeCurveForceFreeEnabled', v)}
          onFreePoints={(v) => updateConfig('gpgpuAgeCurveForceFreePoints', v)}
        />
      )}
      <AgeCurveBlock
        title="Rotation Curve（回転・ジオメトリ自転）"
        enabled={config.gpgpuAgeCurveRotationEnabled}
        points={config.gpgpuAgeCurveRotationPoints}
        onToggle={(v) => updateConfig('gpgpuAgeCurveRotationEnabled', v)}
        onPoints={(v) => updateConfig('gpgpuAgeCurveRotationPoints', v)}
      />
      {config.gpgpuAgeCurveRotationEnabled && (
        <AgeFreeCurveBlock
          freeEnabled={config.gpgpuAgeCurveRotationFreeEnabled}
          freePoints={config.gpgpuAgeCurveRotationFreePoints}
          onFreeToggle={(v) => updateConfig('gpgpuAgeCurveRotationFreeEnabled', v)}
          onFreePoints={(v) => updateConfig('gpgpuAgeCurveRotationFreePoints', v)}
        />
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        年齢比 t = 0 / 0.25 / 0.5 / 0.75 / 1 の5点に倍率を持ち、間を線形補間します。カーブは従来の年齢系（Size over Lifetime、フェードイン／アウト）やシミュレーション（速度・内蔵フォース・ジオメトリ自転の速さ）に乗算されるため、全点 1.0 のままでは見た目は変わりません。フォースは重力〜モーフの内蔵フォースが対象で、衝突・マウス・流体・カスタムフォースには掛かりません。各カーブの Free Curve を On にすると、その対象の倍率は5点ではなく自由制御点カーブ（位置も自由、最大8点）で決まります。
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
        config={config}
        updateConfig={updateConfig}
      />
      <MapSourceBlock
        title="Opacity Map（不透明度専用）"
        source={config.gpgpuMapOpacitySource}
        onSource={(v) => updateConfig('gpgpuMapOpacitySource', v)}
        config={config}
        updateConfig={updateConfig}
      />
      <MapSourceBlock
        title="Color Map（色専用）"
        source={config.gpgpuMapColorSource}
        onSource={(v) => updateConfig('gpgpuMapColorSource', v)}
        config={config}
        updateConfig={updateConfig}
      />
      <MapSourceBlock
        title="Displace Map（変位専用）"
        source={config.gpgpuMapDisplaceSource}
        onSource={(v) => updateConfig('gpgpuMapDisplaceSource', v)}
        config={config}
        updateConfig={updateConfig}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        専用画像が未設定のプロパティは共通マップにフォールバックします。Color Map を設定すると、Image ドライバの入力はその画像になります（色は輝度ドライバとして消費されます）。
      </div>
    </div>

    {/* Noise Field Map (Phase AY): the scalar noise field (the
        same vnoise the curl force is built from) as a map source.
        The field value at the particle's own position drives
        size / displacement here, and colour through the Noise
        gradient driver. Evolve moves the field through time on
        the render clock — no rebake, no snapshot. Amounts 0 keep
        every consumer off. */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/70">Noise Field Map（ノイズ場マップ）</div>
      <Slider label="Noise Scale" value={config.gpgpuNoiseMapScale} min={0.001} max={0.1} step={0.001} onChange={(v) => updateConfig('gpgpuNoiseMapScale', v)} />
      <Toggle
        label="Noise Kind"
        value={config.gpgpuNoiseMapKind}
        options={[{ label: 'Perlin', val: 'perlin' }, { label: 'Ridge', val: 'ridge' }, { label: 'Turbulence', val: 'turbulence' }]}
        onChange={(v) => updateConfig('gpgpuNoiseMapKind', v)}
      />
      <Slider label="Noise Octaves" value={config.gpgpuNoiseMapOctaves} min={1} max={5} step={1} onChange={(v) => updateConfig('gpgpuNoiseMapOctaves', Math.round(v))} />
      <Slider label="Noise Evolve" value={config.gpgpuNoiseMapEvolve} min={0} max={4} step={0.01} onChange={(v) => updateConfig('gpgpuNoiseMapEvolve', v)} />
      <Slider label="Noise Supply Time （供給断面の時刻）" value={config.gpgpuNoiseFieldSupplyTime} min={0} max={120} step={0.5} onChange={(v) => updateConfig('gpgpuNoiseFieldSupplyTime', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        レイヤーマップやモーフへ供給されるノイズ場の断面を、場が発展した時刻の姿で切り取ります（Evolve が 0 のときは時刻を変えても断面は変わりません）。0 が従来の断面です。毎フレームの再生成はしません。
      </div>
      <Slider label="Noise Size Amount" value={config.gpgpuNoiseMapSizeAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuNoiseMapSizeAmount', v)} />
      <Slider label="Noise Displace Amount" value={config.gpgpuNoiseMapDisplaceAmount} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuNoiseMapDisplaceAmount', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        画像ではなく空間ノイズ場そのものをマップ源にします。粒子は自分の位置の場の値（0〜1）を引き、サイズ倍率・半径方向の変位に使います。色は Color Gradient の Driver を Noise Field にすると同じ場で決まります。Kind は場の読み方（Perlin＝通常／Ridge＝尾根／Turbulence＝乱流）、Octaves は細部の重ね数（fBm）で、Perlin＋1 では従来の場そのものです。Evolve は場の時間発展で、0 では静止した場、上げるほど色・大きさ・変位がゆっくり流れます（決定レンダーでも同じ時刻で同じ場になります）。変位は画像変位（上の Map Displace）が有効な間はそちらが優先されます。同じ場は内部供給「ノイズ場（静的スライス）」としてマスクや各 Map の源にも選べます（そちらは Scale／Kind／Octaves で決まる静止した断面で、Evolve は効きません）。
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
          <Toggle label="Multi-Touch (同時干渉)" value={config.gpgpuMouseMultiTouch} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMouseMultiTouch', v)} />
          {config.gpgpuMouseMultiTouch && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              最大4つのポインタ（タッチ／ペン／マウス）が同時に干渉します。強さ・半径・モードは全ポインタ共通で、2本指のカメラ操作中も干渉は入ります。WebGPU 経路は未対応のため、この設定では WebGL へ誘導されます。レイヤー2／3のポインタは従来どおり単一です。
            </div>
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
          <Toggle label="FLIP Layer (2D Pressure)" value={config.gpgpuFlipEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFlipEnabled', v)} />
          {config.gpgpuFlipEnabled && (
            <>
              <Slider label="FLIP Blend (PIC ↔ FLIP)" value={config.gpgpuFlipBlend} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuFlipBlend', v)} />
              <Slider label="Pressure Iterations" value={config.gpgpuFlipPressureIterations} min={0} max={32} step={1} onChange={(v) => updateConfig('gpgpuFlipPressureIterations', v)} />
              <Slider label="Transfer" value={config.gpgpuFlipTransfer} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuFlipTransfer', v)} />
              <div className="mt-1 text-[9px] text-white/40">2D planar FLIP on the field grid: particles &lt;-&gt; grid transfer + pressure projection (incompressible xz flow). No free surface / y-pressure — gravity, SPH and colliders still own the vertical.</div>
              <Toggle
                label="FLIP Mode (格子モード)"
                value={config.gpgpuFlipMode}
                options={[{ label: '2D (従来)', val: '2d' as const }, { label: '3D (完全化)', val: '3d' as const }]}
                onChange={(v) => updateConfig('gpgpuFlipMode', v)}
              />
              {config.gpgpuFlipMode === '3d' && (
                <>
                  <Slider label="3D Resolution (0=Auto)" value={config.gpgpuFlip3dResolution} min={0} max={96} step={1} onChange={(v) => updateConfig('gpgpuFlip3dResolution', v)} />
                  <Slider label="3D Viscosity" value={config.gpgpuFlipViscosity} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuFlipViscosity', v)} />
                  <Slider label="3D Surface Tension" value={config.gpgpuFlipSurfaceTension} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuFlipSurfaceTension', v)} />
                  <div className="mt-1 text-[9px] text-white/40">3D grid FLIP: y-pressure + free surface solved on the atlas grid; viscosity / surface tension are opt-in (0 = their passes do not exist). The grid-&gt;particle scale conversion differs from 2D, so 3D is aimed at new presets — existing presets keep the 2D mode. Whitewater follows this mode (foam spawns on the 3D free surface).</div>
                </>
              )}
              <Toggle label="Vorticity Confinement" value={config.gpgpuFlipVorticityEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFlipVorticityEnabled', v)} />
              {config.gpgpuFlipVorticityEnabled && (
                <Slider label="Vorticity ε" value={config.gpgpuFlipVorticityEpsilon} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuFlipVorticityEpsilon', v)} />
              )}
              <Toggle label="Whitewater (Foam)" value={config.gpgpuWhitewaterEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuWhitewaterEnabled', v)} />
              {config.gpgpuWhitewaterEnabled && (
                <>
                  <Slider label="Foam Amount" value={config.gpgpuWhitewaterAmount} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuWhitewaterAmount', v)} />
                  <Slider label="Foam Threshold" value={config.gpgpuWhitewaterThreshold} min={0.02} max={2} step={0.01} onChange={(v) => updateConfig('gpgpuWhitewaterThreshold', v)} />
                  <Slider label="Foam Life" value={config.gpgpuWhitewaterLife} min={0.1} max={2.5} step={0.05} onChange={(v) => updateConfig('gpgpuWhitewaterLife', v)} />
                  <Slider label="Foam Size" value={config.gpgpuWhitewaterSize} min={0.4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuWhitewaterSize', v)} />
                  <div className="mt-1 text-[9px] text-white/40">Foam points spawned where the field&apos;s vorticity + convergence pass the threshold, carried by the flow, short-lived. One-way only — foam never feeds back into the solver. Lives on the 2D field plane; no foam / spray split.</div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>

    {/* Custom GLSL Force */}
    <CustomForceBlock config={config} updateConfig={updateConfig} />

    {/* Particle Points Vertex GLSL (Phase CD) */}
    <ParticleVertexGlslBlock config={config} updateConfig={updateConfig} />

    {/* Particle Points Fragment GLSL (Phase CE) */}
    <ParticleFragmentGlslBlock config={config} updateConfig={updateConfig} />

    {/* Volume Fog Fragment GLSL (Phase CE) */}
    <VolumeFogGlslBlock config={config} updateConfig={updateConfig} />

    {/* GEOM Custom GLSL (Phase 16 stage 4) */}
    <GeomCustomVertexGlslBlock config={config} updateConfig={updateConfig} />
    <GeomCustomFragmentGlslBlock config={config} updateConfig={updateConfig} />

    {/* Simple LFO (B3, Kinetix-style single-target view of the modulation engine) */}
    <SimpleLfoBlock />
  </>
);
