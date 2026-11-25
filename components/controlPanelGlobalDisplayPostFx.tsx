import React from 'react';

import type { ParticleConfig } from '../types';
import { buildPostFxStackPatch, getPostFxStackBundleById, POST_FX_STACK_BUNDLES, inferPostFxStackBundleId } from '../lib/postFxLibrary';
import { getOrderedActivePostFxStageIds } from '../lib/postFxStack';
import { Slider, Toggle } from './controlPanelParts';
import { CustomPostGlslBlock } from './controlPanelGlobalDisplayPostFxCustom';
import { PostFxStackGraph } from './controlPanelPostFxStackGraph';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// TD §7 stage 3 (Phase 35): the PostFx unit coexists as
// the classic slider section (節) and the stage-order
// graph (グラフ), switched here at the unit level.
const POSTFX_VIEW_STORAGE_KEY = 'kalokagathia.postFxView.v1';
type PostFxView = 'panel' | 'graph';
const loadPostFxView = (): PostFxView => {
  try {
    return localStorage.getItem(POSTFX_VIEW_STORAGE_KEY) === 'graph' ? 'graph' : 'panel';
  } catch {
    return 'panel';
  }
};

export const GlobalDisplayPostFxSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => {
  const [view, setView] = React.useState<PostFxView>(loadPostFxView);
  const changeView = (next: PostFxView) => {
    setView(next);
    try { localStorage.setItem(POSTFX_VIEW_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  };
  const activePostStackBundle = getPostFxStackBundleById(inferPostFxStackBundleId(config));
  const activePostStages = getOrderedActivePostFxStageIds(config).map((stage) => stage.replace(/-/g, ' '));

  const applyPostFxStackBundle = (bundleId: string) => {
    const patch = buildPostFxStackPatch(bundleId);
    (Object.keys(patch) as Array<keyof typeof patch>).forEach((key) => {
      const value = patch[key];
      if (typeof value !== 'undefined') {
        updateConfig(key as keyof ParticleConfig, value as ParticleConfig[keyof ParticleConfig]);
      }
    });
  };

  return (
    <>
      <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
        <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">Post Processing</div>
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-white/45">PostFx 表示</span>
          <span className="flex items-center gap-1 rounded-md bg-[#171717] p-1" title="PostFx 節の表示: 節（スライダ）/ グラフ（段の順序）">
            {(['panel', 'graph'] as PostFxView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={`rounded px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                  view === v ? 'bg-white/[0.14] text-white' : 'text-[#a3a3a3] hover:text-white'
                }`}
              >
                {v === 'panel' ? '節' : 'グラフ'}
              </button>
            ))}
          </span>
        </div>
        {view === 'graph' ? (
          <PostFxStackGraph config={config} updateConfig={updateConfig} />
        ) : (
          <>
        <Toggle
          label="Stack Profile"
          value={config.postFxStackProfile}
          options={[
            { label: 'Manual', val: 'manual' },
            { label: 'Touch', val: 'touch-feedback' },
            { label: 'Particular', val: 'particular-glow' },
            { label: 'Retro', val: 'retro-feedback' },
            { label: 'Dream', val: 'dream-smear' },
          ]}
          onChange={(v) => updateConfig('postFxStackProfile', v)}
        />
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
            <span>Independent post stacks</span>
            <span>{activePostStackBundle ? activePostStackBundle.label : 'Custom'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {POST_FX_STACK_BUNDLES.map((bundle) => {
              const active = activePostStackBundle?.id === bundle.id;
              return (
                <button
                  key={bundle.id}
                  onClick={() => applyPostFxStackBundle(bundle.id)}
                  title={bundle.summary}
                  className={`rounded border px-2 py-2 text-left transition-colors ${active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/10 text-white/70 hover:bg-white/5'}`}
                >
                  <div className="text-[9px] uppercase tracking-widest">{bundle.label}</div>
                  <div className="mt-1 text-[9px] leading-relaxed text-white/45">{bundle.emphasis.join(' · ')}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[9px] text-white/40">
            Active order · {activePostStages.length > 0 ? activePostStages.join(' → ') : 'No post stages enabled'}
          </div>
        </div>
        <Toggle
          label="Bloom"
          value={config.postBloomEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postBloomEnabled', v)}
        />
        {config.postBloomEnabled && (
          <>
            <Slider label="Bloom Intensity" value={config.postBloomIntensity} min={0} max={5} step={0.05} onChange={(v) => updateConfig('postBloomIntensity', v)} />
            <Slider label="Bloom Radius" value={config.postBloomRadius} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postBloomRadius', v)} />
            <Slider label="Luminance Threshold" value={config.postBloomThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postBloomThreshold', v)} />
          </>
        )}
        <Toggle
          label="Chromatic Aberration"
          value={config.postChromaticAberrationEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postChromaticAberrationEnabled', v)}
        />
        {config.postChromaticAberrationEnabled && (
          <Slider label="CA Offset" value={config.postChromaticAberrationOffset} min={0} max={0.01} step={0.0001} onChange={(v) => updateConfig('postChromaticAberrationOffset', v)} />
        )}
        <Toggle label="Depth of Field" value={config.postDofEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('postDofEnabled', v)} />
        {config.postDofEnabled && (
          <>
            <Slider label="Focus Distance" value={config.postDofFocusDistance} min={0} max={1} step={0.001} onChange={(v) => updateConfig('postDofFocusDistance', v)} />
            <Slider label="Focal Length" value={config.postDofFocalLength} min={0.001} max={0.3} step={0.001} onChange={(v) => updateConfig('postDofFocalLength', v)} />
            <Slider label="Bokeh Scale" value={config.postDofBokehScale} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('postDofBokehScale', v)} />
          </>
        )}
        <Toggle
          label="Noise"
          value={config.postNoiseEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postNoiseEnabled', v)}
        />
        {config.postNoiseEnabled && (
          <Slider label="Noise Opacity" value={config.postNoiseOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postNoiseOpacity', v)} />
        )}
        <Toggle
          label="Vignette"
          value={config.postVignetteEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postVignetteEnabled', v)}
        />
        {config.postVignetteEnabled && (
          <>
            <Slider label="Vignette Offset" value={config.postVignetteOffset} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postVignetteOffset', v)} />
            <Slider label="Vignette Darkness" value={config.postVignetteDarkness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postVignetteDarkness', v)} />
          </>
        )}
        <Toggle
          label="Brightness / Contrast"
          value={config.postBrightnessContrastEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postBrightnessContrastEnabled', v)}
        />
        {config.postBrightnessContrastEnabled && (
          <>
            <Slider label="Brightness" value={config.postBrightness} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('postBrightness', v)} />
            <Slider label="Contrast" value={config.postContrastAmount} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('postContrastAmount', v)} />
          </>
        )}
        <Toggle
          label="Feedback (GPU)"
          value={config.postFeedbackEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postFeedbackEnabled', v)}
        />
        {config.postFeedbackEnabled && (
          <>
            <Slider label="Feedback Decay" value={config.postFeedbackDecay} min={0} max={0.97} step={0.01} onChange={(v) => updateConfig('postFeedbackDecay', v)} />
            <Slider label="Feedback Zoom" value={config.postFeedbackZoom} min={0.95} max={1.05} step={0.001} onChange={(v) => updateConfig('postFeedbackZoom', v)} />
            <Slider label="Feedback Rotation" value={config.postFeedbackRotation} min={-0.1} max={0.1} step={0.001} onChange={(v) => updateConfig('postFeedbackRotation', v)} />
            <Toggle
              label="Feedback Mask （マスクで残像を変調・Phase AF）"
              value={config.postFeedbackMaskEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('postFeedbackMaskEnabled', v)}
            />
            {config.postFeedbackMaskEnabled && (
              <>
                <Slider label="Feedback Mask Strength" value={config.postFeedbackMaskStrength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postFeedbackMaskStrength', v)} />
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  {config.gpgpuMaskSource
                    ? 'ラスタマスクのソースで残像の残り方を空間変調します（白い領域だけ残像が残ります）。ソースはマスク節で設定します。'
                    : 'マスクソースが未設定のため変調は効きません。マスク節で画像／地形派生／文字／パス／エッジのいずれかを設定してください。'}
                </div>
              </>
            )}
          </>
        )}
        <Toggle
          label="Kaleidoscope / Mirror"
          value={config.postKaleidoscopeEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postKaleidoscopeEnabled', v)}
        />
        {config.postKaleidoscopeEnabled && (
          <>
            <Slider label="Kaleidoscope Segments" value={config.postKaleidoscopeSegments} min={2} max={16} step={1} onChange={(v) => updateConfig('postKaleidoscopeSegments', v)} />
            <Slider label="Kaleidoscope Rotation" value={config.postKaleidoscopeRotation} min={-3.14} max={3.14} step={0.01} onChange={(v) => updateConfig('postKaleidoscopeRotation', v)} />
          </>
        )}
        <Toggle
          label="Fractal （脱出時間フラクタル・Phase AL）"
          value={config.postFractalEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postFractalEnabled', v)}
        />
        {config.postFractalEnabled && (
          <>
            <Toggle
              label="Fractal Kind"
              value={config.postFractalKind}
              options={[{ label: 'Mandelbrot', val: 'mandelbrot' as const }, { label: 'Julia', val: 'julia' as const }]}
              onChange={(v) => updateConfig('postFractalKind', v)}
            />
            <Slider label="Fractal Center X" value={config.postFractalCenterX} min={-2} max={2} step={0.01} onChange={(v) => updateConfig('postFractalCenterX', v)} />
            <Slider label="Fractal Center Y" value={config.postFractalCenterY} min={-2} max={2} step={0.01} onChange={(v) => updateConfig('postFractalCenterY', v)} />
            <Slider label="Fractal Zoom" value={config.postFractalZoom} min={0.05} max={1000} step={0.05} onChange={(v) => updateConfig('postFractalZoom', v)} />
            <Slider label="Fractal Iterations" value={config.postFractalIterations} min={1} max={256} step={1} onChange={(v) => updateConfig('postFractalIterations', Math.round(v))} />
            {config.postFractalKind === 'julia' && (
              <>
                <Slider label="Julia Constant X" value={config.postFractalJuliaX} min={-2} max={2} step={0.005} onChange={(v) => updateConfig('postFractalJuliaX', v)} />
                <Slider label="Julia Constant Y" value={config.postFractalJuliaY} min={-2} max={2} step={0.005} onChange={(v) => updateConfig('postFractalJuliaY', v)} />
              </>
            )}
            <Slider label="Fractal Mix" value={config.postFractalMix} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postFractalMix', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              複素平面の脱出時間場をモノクロで描くポスト段です。内部（非脱出）は白、脱出は反復回数で階調化します。Mix 0 では入力フレームそのものになります。
            </div>
          </>
        )}
        <Toggle
          label="Composite （2層コンポジット・Phase AM）"
          value={config.postCompositeEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postCompositeEnabled', v)}
        />
        {config.postCompositeEnabled && (
          <>
            <Toggle
              label="Composite Source （第2層）"
              value={config.postCompositeSource}
              options={[{ label: 'Text Raster', val: 'text-raster' as const }, { label: 'Path Raster', val: 'path-raster' as const }, { label: 'Edge Output', val: 'edge-output' as const }, { label: 'Noise Field', val: 'noise-field' as const }]}
              onChange={(v) => updateConfig('postCompositeSource', v)}
            />
            <Toggle
              label="Composite Mode （ブレンド）"
              value={config.postCompositeMode}
              options={[{ label: 'Normal', val: 'normal' as const }, { label: 'Multiply', val: 'multiply' as const }, { label: 'Screen', val: 'screen' as const }, { label: 'Overlay', val: 'overlay' as const }, { label: 'Soft Light', val: 'soft-light' as const }, { label: 'Difference', val: 'difference' as const }, { label: 'Add', val: 'add' as const }, { label: 'Subtract', val: 'subtract' as const }]}
              onChange={(v) => updateConfig('postCompositeMode', v)}
            />
            <Slider label="Composite Mix" value={config.postCompositeMix} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postCompositeMix', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              フレームと第2層（供給テクスチャ）をブレンドモードで合成するポスト段です。第2層が未準備の間は入力をそのまま通します。Edge Output は前フレームのエッジ抽出結果を読みます。Noise Field はノイズ場の静的スライス（場の定義キーで決まる静止した断面）です。
            </div>
          </>
        )}
        <Toggle
          label="Glitch （グリッチ・Phase AM）"
          value={config.postGlitchEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postGlitchEnabled', v)}
        />
        {config.postGlitchEnabled && (
          <>
            <Slider label="Glitch Amount" value={config.postGlitchAmount} min={0} max={0.25} step={0.005} onChange={(v) => updateConfig('postGlitchAmount', v)} />
            <Slider label="Glitch Bands" value={config.postGlitchBands} min={2} max={128} step={1} onChange={(v) => updateConfig('postGlitchBands', Math.round(v))} />
            <Slider label="Glitch Rate" value={config.postGlitchRate} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('postGlitchRate', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              横バンドの一部を決定的ハッシュで水平にずらします（データモッシュ＝フレーム間の動き転送は対象外）。パターン時間はパス内部のフレームカウンタで量子化するため、決定的レンダーで再現します。
            </div>
          </>
        )}
        <Toggle
          label="Pixel Sort （ピクセルソート・Phase AM）"
          value={config.postPixelSortEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postPixelSortEnabled', v)}
        />
        {config.postPixelSortEnabled && (
          <>
            <Toggle
              label="Pixel Sort Direction"
              value={config.postPixelSortDirection}
              options={[{ label: 'Horizontal', val: 'horizontal' as const }, { label: 'Vertical', val: 'vertical' as const }]}
              onChange={(v) => updateConfig('postPixelSortDirection', v)}
            />
            <Slider label="Pixel Sort Low" value={config.postPixelSortLow} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postPixelSortLow', v)} />
            <Slider label="Pixel Sort High" value={config.postPixelSortHigh} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postPixelSortHigh', v)} />
            <Slider label="Pixel Sort Passes" value={config.postPixelSortPasses} min={1} max={64} step={1} onChange={(v) => updateConfig('postPixelSortPasses', Math.round(v))} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              輝度スパン [Low, High] の内側だけ、行（または列）方向に輝度順へ並べ替えます。スパン外のピクセルは動かず壁になります。Passes は並べ替えの到達距離です。
            </div>
          </>
        )}
        <Toggle
          label="Cellular （離散セルオートマトン・Phase AM）"
          value={config.postCellularEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postCellularEnabled', v)}
        />
        {config.postCellularEnabled && (
          <>
            <Toggle
              label="Cellular Rule"
              value={config.postCellularRule}
              options={[{ label: 'Life', val: 'life' as const }, { label: 'HighLife', val: 'highlife' as const }, { label: 'Day & Night', val: 'daynight' as const }, { label: 'Seeds', val: 'seeds' as const }, { label: 'Maze', val: 'maze' as const }, { label: 'Coral', val: 'coral' as const }]}
              onChange={(v) => updateConfig('postCellularRule', v)}
            />
            <Slider label="Cellular Cell Size" value={config.postCellularCellSize} min={1} max={16} step={1} onChange={(v) => updateConfig('postCellularCellSize', Math.round(v))} />
            <Slider label="Cellular Seed Threshold" value={config.postCellularSeedThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postCellularSeedThreshold', v)} />
            <Slider label="Cellular Mix" value={config.postCellularMix} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postCellularMix', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              低解像度の状態テクスチャを B/S ルールで1フレーム1世代ずつ発展させます。種は有効化時とルール／セルサイズ／閾値の変更時に、現在フレームの輝度から取り直します。
            </div>
          </>
        )}
        <Toggle
          label="Slit Scan (temporal bands)"
          value={config.postSlitScanEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postSlitScanEnabled', v)}
        />
        {config.postSlitScanEnabled && (
          <>
            <Slider label="Slit Scan Bands" value={config.postSlitScanBands} min={4} max={64} step={1} onChange={(v) => updateConfig('postSlitScanBands', v)} />
            <Slider label="Slit Scan Cycle" value={config.postSlitScanCycle} min={2} max={120} step={1} onChange={(v) => updateConfig('postSlitScanCycle', v)} />
          </>
        )}
        <Toggle
          label="Radial Blur"
          value={config.postRadialBlurEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postRadialBlurEnabled', v)}
        />
        {config.postRadialBlurEnabled && (
          <Slider label="Radial Blur Strength" value={config.postRadialBlurStrength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postRadialBlurStrength', v)} />
        )}
        <div className="mb-1 mt-4 text-[9px] uppercase tracking-widest opacity-60">LightFX (Shine / Starglow / Lux)</div>
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          光源位置（画面UV）を共有する光のポスト段（Phase D）。筋とグリントは画面自身の高輝度部から抽出するのでモノクロのまま色は付かず、ブランド単色やグラデーションの色はそのまま受け継ぎます。全て既定 OFF で、OFF の間は段自体が無く従来出力と同一です。
        </div>
        <Slider label="Light Position X" value={config.postLightX} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postLightX', v)} />
        <Slider label="Light Position Y" value={config.postLightY} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postLightY', v)} />
        <Toggle
          label="Shine (放射光)"
          value={config.postShineEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postShineEnabled', v)}
        />
        {config.postShineEnabled && (
          <>
            <Slider label="Shine Intensity" value={config.postShineIntensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('postShineIntensity', v)} />
            <Slider label="Shine Length" value={config.postShineLength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postShineLength', v)} />
            <Slider label="Shine Threshold" value={config.postShineThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postShineThreshold', v)} />
            <Slider label="Shine Density Attenuation" value={config.postShineDensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postShineDensity', v)} />
          </>
        )}
        <Toggle
          label="Starglow (十字グリント)"
          value={config.postStarglowEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postStarglowEnabled', v)}
        />
        {config.postStarglowEnabled && (
          <>
            <Slider label="Starglow Intensity" value={config.postStarglowIntensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('postStarglowIntensity', v)} />
            <Slider label="Starglow Length" value={config.postStarglowLength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postStarglowLength', v)} />
            <Slider label="Starglow Threshold" value={config.postStarglowThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postStarglowThreshold', v)} />
            <Slider label="Starglow Shimmer (きらめき)" value={config.postStarglowShimmer} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postStarglowShimmer', v)} />
            <Slider label="Starglow Shimmer Speed" value={config.postStarglowShimmerSpeed} min={0.1} max={4} step={0.05} onChange={(v) => updateConfig('postStarglowShimmerSpeed', v)} />
            <Toggle
              label="Starglow Diagonal (8方向)"
              value={config.postStarglowDiagonal}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('postStarglowDiagonal', v)}
            />
          </>
        )}
        <Toggle
          label="Lux (光源の可視化)"
          value={config.postLuxEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postLuxEnabled', v)}
        />
        {config.postLuxEnabled && (
          <>
            <Slider label="Lux Intensity" value={config.postLuxIntensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('postLuxIntensity', v)} />
            <Slider label="Lux Size" value={config.postLuxSize} min={0.02} max={1} step={0.01} onChange={(v) => updateConfig('postLuxSize', v)} />
            <Slider label="Lux Cone Length (0=グローonly)" value={config.postLuxConeLength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postLuxConeLength', v)} />
            {config.postLuxConeLength > 0.001 && (
              <>
                <Slider label="Lux Cone Angle (deg)" value={config.postLuxConeAngle} min={0} max={360} step={1} onChange={(v) => updateConfig('postLuxConeAngle', v)} />
                <Slider label="Lux Cone Spread (deg)" value={config.postLuxConeSpread} min={5} max={90} step={1} onChange={(v) => updateConfig('postLuxConeSpread', v)} />
              </>
            )}
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              光源位置は上の Light Position で指定します（手動UV。GPGPU の井戸位置とは連動しません — シミュレーション時刻とポスト段の時刻が独立なため、投影すると決定レンダーでずれる恐れがある設計判断です）。角度は 0=右 / 90=上 / 270=下（画面下向きが既定）。
            </div>
          </>
        )}
        <div className="mb-1 mt-4 text-[9px] uppercase tracking-widest opacity-60">Tone Grade / Edge / Displace (Phase AD)</div>
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          印刷的な階調仕上げと輪郭・変位のポスト段（Phase AD）。全て既定 OFF で、OFF の間は段自体が無く従来出力と同一です。Displace はグラデーション画像（GPGPU の Image ドライバと同じ入力）を変位マップに使います。
        </div>
        <Toggle
          label="Posterize (階調圧縮)"
          value={config.postPosterizeEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postPosterizeEnabled', v)}
        />
        {config.postPosterizeEnabled && (
          <Slider label="Posterize Levels" value={config.postPosterizeLevels} min={2} max={64} step={1} onChange={(v) => updateConfig('postPosterizeLevels', v)} />
        )}
        <Toggle
          label="Ordered Dither (規則ディザ)"
          value={config.postDitherEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postDitherEnabled', v)}
        />
        {config.postDitherEnabled && (
          <>
            <Toggle
              label="Dither Mode （方式・Phase AW）"
              value={config.postDitherMode}
              options={[{ label: 'Bayer', val: 'bayer' as const }, { label: 'Diffusion', val: 'diffusion' as const }]}
              onChange={(v) => updateConfig('postDitherMode', v)}
            />
            <Slider label="Dither Strength" value={config.postDitherStrength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postDitherStrength', v)} />
            <Toggle
              label="Dither Anchor （固定先）"
              value={config.postDitherAnchor}
              options={[{ label: 'Screen', val: 'screen' as const }, { label: 'World', val: 'world' as const }]}
              onChange={(v) => updateConfig('postDitherAnchor', v)}
            />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Diffusion は Floyd–Steinberg 誤差拡散の単一パス近似です（シェーダでは逐次走査ができないため、走査済み近傍の量子化誤差から推定します）。Bayer が従来の規則ディザです。Anchor の World は、Bayer の模様をワールド原点の投影位置へ固定します（カメラをパン／ズームしても被写体上の模様が泳ぎません。回転では近似になります）。Screen が従来の画面固定です。
            </div>
          </>
        )}
        <Toggle
          label="Moire （モアレ干渉・Phase AW）"
          value={config.postMoireEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postMoireEnabled', v)}
        />
        {config.postMoireEnabled && (
          <>
            <Toggle
              label="Moire Pattern"
              value={config.postMoirePattern}
              options={[{ label: 'Grid', val: 'grid' as const }, { label: 'Rings', val: 'rings' as const }, { label: 'Lines', val: 'lines' as const }]}
              onChange={(v) => updateConfig('postMoirePattern', v)}
            />
            <Slider label="Moire Spacing (px)" value={config.postMoireSpacing} min={2} max={64} step={0.5} onChange={(v) => updateConfig('postMoireSpacing', v)} />
            <Slider label="Moire Angle (deg)" value={config.postMoireAngle} min={-45} max={45} step={0.1} onChange={(v) => updateConfig('postMoireAngle', v)} />
            <Slider label="Moire Phase" value={config.postMoirePhase} min={0} max={6.2832} step={0.01} onChange={(v) => updateConfig('postMoirePhase', v)} />
            <Slider label="Moire Mix" value={config.postMoireMix} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postMoireMix', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              規則パターンを角度・位相をずらして重ねた積がモアレ（干渉のうねり）になります。角度0・位相0では干渉は消えます。フレームに乗算で合成します。
            </div>
          </>
        )}
        <Toggle
          label="Halftone (網点)"
          value={config.postHalftoneEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postHalftoneEnabled', v)}
        />
        {config.postHalftoneEnabled && (
          <>
            <Slider label="Halftone Cell Size (px)" value={config.postHalftoneCellSize} min={3} max={64} step={1} onChange={(v) => updateConfig('postHalftoneCellSize', v)} />
            <Slider label="Halftone Angle (deg)" value={config.postHalftoneAngle} min={0} max={90} step={1} onChange={(v) => updateConfig('postHalftoneAngle', v)} />
          </>
        )}
        <Toggle
          label="Edge Detect (輪郭抽出)"
          value={config.postEdgeEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postEdgeEnabled', v)}
        />
        {config.postEdgeEnabled && (
          <>
            <Slider label="Edge Threshold" value={config.postEdgeThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postEdgeThreshold', v)} />
            <Toggle
              label="Edge Mode"
              value={config.postEdgeMode}
              options={[{ label: 'Overlay', val: 'overlay' }, { label: 'Edge Only', val: 'only' }]}
              onChange={(v) => updateConfig('postEdgeMode', v)}
            />
          </>
        )}
        <Toggle
          label="Displace (画像変位)"
          value={config.postDisplaceEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postDisplaceEnabled', v)}
        />
        {config.postDisplaceEnabled && (
          <>
            <Slider label="Displace Amount" value={config.postDisplaceAmount} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('postDisplaceAmount', v)} />
            <Toggle
              label="Displace Channel"
              value={config.postDisplaceChannel}
              options={[
                { label: 'R→X / G→Y', val: 'red-green' },
                { label: 'Luma', val: 'luma' },
                { label: 'Red', val: 'red' },
                { label: 'Green', val: 'green' },
                { label: 'Blue', val: 'blue' },
              ]}
              onChange={(v) => updateConfig('postDisplaceChannel', v)}
            />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              変位マップはグラデーション画像（未設定の間は変位なし＝素通し）。Feedback より前に適用されるので、残像は変位した画面をなぞります。
            </div>
          </>
        )}
        <div className="mb-1 mt-4 text-[9px] uppercase tracking-widest opacity-60">Output Grade</div>
        <Toggle
          label="Tone Mapping"
          value={config.postToneMapping}
          options={[{ label: 'Legacy', val: 'legacy' }, { label: 'ACES', val: 'aces' }]}
          onChange={(v) => updateConfig('postToneMapping', v)}
        />
        <Slider label="Exposure" value={config.postExposure} min={0.1} max={3} step={0.01} onChange={(v) => updateConfig('postExposure', v)} />
        {(Math.abs(config.postExposure - 1) > 0.001 || config.postToneMapping === 'aces') && (
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            出力グレード段が有効です（露出 ×{config.postExposure.toFixed(2)}{config.postToneMapping === 'aces' ? ' + ACES' : ''}）。既定（露出1.0 / Legacy）では段自体が無効で従来出力と一致します。
          </div>
        )}
        <Toggle
          label="Brand Color (単色デュオトーン)"
          value={config.postBrandColorEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postBrandColorEnabled', v)}
        />
        {config.postBrandColorEnabled && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(config.postBrandColor) ? config.postBrandColor : '#c8372d'}
                onChange={(e) => updateConfig('postBrandColor', e.target.value)}
                className="h-8 w-14 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
              />
              <div className="flex-1 text-[10px] text-white/50">Brand color {config.postBrandColor}</div>
            </div>
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              画面全体の輝度を 黒 → ブランド色 → 白 の3点ランプに写す単色デュオトーン（Pro-2、業務用）。ランプの中点はブランド色自体の輝度に合わせます。案件ごとの opt-in 機能で、既定は OFF（従来のモノクロ出力）。
            </div>
          </>
        )}
        <Toggle
          label="Reserved Palette （予約パレット）"
          value={config.postReservedPaletteEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postReservedPaletteEnabled', v)}
        />
        {config.postReservedPaletteEnabled && (
          <>
            <Slider label="Reserved Floor （黒の予約枠）" value={config.postReservedFloor} min={0} max={0.45} step={0.01} onChange={(v) => updateConfig('postReservedFloor', v)} />
            <Slider label="Reserved Ceiling （白の予約枠）" value={config.postReservedCeiling} min={0.55} max={1} step={0.01} onChange={(v) => updateConfig('postReservedCeiling', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              完成画面を [Floor, Ceiling] の範囲へ写し直す予約枠です。出力グレード段の最後に効くので、露出や ACES で押しても純白・純黒には届かず、白飛びと黒つぶれが構造的に起きません。トーンマッピング（ACES）と束ねて使うのが前提の設計です。OFF の間は従来と完全一致します。
            </div>
          </>
        )}
        <div className="mb-1 mt-4 text-[9px] uppercase tracking-widest opacity-60">Chroma Key （色キー抜き）</div>
        <Toggle
          label="Chroma Key"
          value={config.postChromaKeyEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postChromaKeyEnabled', v)}
        />
        {config.postChromaKeyEnabled && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(config.postChromaKeyColor) ? config.postChromaKeyColor : '#00ff00'}
                onChange={(e) => updateConfig('postChromaKeyColor', e.target.value)}
                className="h-8 w-14 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
              />
              <div className="flex-1 text-[10px] text-white/50">Key color {config.postChromaKeyColor}</div>
            </div>
            <Slider label="Similarity （キー色との距離のしきい値）" value={config.postChromaKeySimilarity} min={0} max={1} step={0.005} onChange={(v) => updateConfig('postChromaKeySimilarity', v)} />
            <Slider label="Smoothness （境界のなめらかさ）" value={config.postChromaKeySmoothness} min={0} max={0.5} step={0.005} onChange={(v) => updateConfig('postChromaKeySmoothness', v)} />
            <Slider label="Spill （色かぶり除去）" value={config.postChromaKeySpill} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postChromaKeySpill', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              完成画面の最後で、キー色に近い部分を透明にする段です。透明度が効くのは PNG 書き出しと透明背景キャプチャで、動画書き出しは不透明のままです。背景色自体をキー色にすると背景だけが抜けます。OFF の間は段自体が無く、出力は従来と完全一致します。
            </div>
          </>
        )}
        <div className="mb-1 mt-4 text-[9px] uppercase tracking-widest opacity-60">Brush Accumulation （筆の蓄積）</div>
        <Toggle
          label="Brush Accumulation"
          value={config.layer1BrushAccumEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('layer1BrushAccumEnabled', v)}
        />
        {config.layer1BrushAccumEnabled && (
          <>
            <Slider label="Decay （残像の減衰）" value={config.layer1BrushAccumDecay} min={0} max={0.99} step={0.01} onChange={(v) => updateConfig('layer1BrushAccumDecay', v)} />
            <Slider label="Strength （蓄積の強さ）" value={config.layer1BrushAccumStrength} min={0} max={2} step={0.05} onChange={(v) => updateConfig('layer1BrushAccumStrength', v)} />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              ブラシ線（レイヤー2のブラシ接続スタイル）だけを専用の蓄積バッファに残し、筆が通った跡が残って重なっていく段です。ライブ表示専用で、決定論書き出しには入りません（フィードバック段と同じ扱い）。OFF の間は段自体が無く、出力は従来と完全一致します。
            </div>
          </>
        )}
        <CustomPostGlslBlock config={config} updateConfig={updateConfig} />
          </>
        )}
      </div>
    </>
  );
};
