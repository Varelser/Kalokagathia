import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

import { Slider, Toggle } from './controlPanelParts';
import { KINETIX_COLOR_GRADIENTS, getKinetixGradientPreset } from '../lib/kinetixGradients';
import { GradImageBlock } from './controlPanelGlobalDisplayGpgpuForcesMapBlocks';

export const GlobalDisplayGpgpuForcesAuxColorSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
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
        <option value="birthBurst">Birth Burst (誕生時に飛沫)</option>
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
            主粒子（親）のイベントで生まれる子エミッタ専用プールです（Kinetix auxMode の GPU 実装が土台）。子は独自のシミュレーションを持ち、上の Child 系キーで親と違う重力（0で無重力・負で反重力）・ドラッグ・渦・色で生きられます。既定（重力倍率1／ドラッグ0／渦0／色は継承）は従来の共有挙動と同一です。Death Burst と Birth Burst（Phase AB: 粒子が生まれた瞬間に飛沫）は Life System が On のときだけ発火します。レイヤー側の Aux/Spark（常時型）とは別系統で併存します。
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
                <option value="birthBurst">Birth Burst （子が誕生時に飛沫）</option>
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
          <div className="mt-2 flex gap-3">
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-widest opacity-60">1/4 Stop （追加）</span>
                {config.gpgpuGradQuarter
                  ? <button type="button" onClick={() => updateConfig('gpgpuGradQuarter', '')} className="text-[9px] text-white/50 underline hover:text-white">未指定に戻す</button>
                  : <span className="text-[9px] text-white/35">未指定</span>}
              </div>
              <input type="color" value={config.gpgpuGradQuarter || '#000000'} onChange={(e) => { updateConfig('gpgpuGradQuarter', e.target.value); updateConfig('gpgpuGradPreset', 'custom'); }} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-widest opacity-60">3/4 Stop （追加）</span>
                {config.gpgpuGradThreeQuarter
                  ? <button type="button" onClick={() => updateConfig('gpgpuGradThreeQuarter', '')} className="text-[9px] text-white/50 underline hover:text-white">未指定に戻す</button>
                  : <span className="text-[9px] text-white/35">未指定</span>}
              </div>
              <input type="color" value={config.gpgpuGradThreeQuarter || '#000000'} onChange={(e) => { updateConfig('gpgpuGradThreeQuarter', e.target.value); updateConfig('gpgpuGradPreset', 'custom'); }} className="h-8 w-full cursor-pointer rounded border border-white/20 bg-transparent p-0.5" />
            </div>
          </div>
          {(config.gpgpuGradQuarter || config.gpgpuGradThreeQuarter) && (
            <>
              {config.gpgpuGradQuarter && (
                <Slider label="1/4 Stop Position （位置・Phase AW）" value={config.gpgpuGradQuarterPos} min={0.02} max={0.48} step={0.01} onChange={(v) => updateConfig('gpgpuGradQuarterPos', v)} />
              )}
              {config.gpgpuGradThreeQuarter && (
                <Slider label="3/4 Stop Position （位置・Phase AW）" value={config.gpgpuGradThreeQuarterPos} min={0.52} max={0.98} step={0.01} onChange={(v) => updateConfig('gpgpuGradThreeQuarterPos', v)} />
              )}
            </>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            追加ストップ（Phase AH）: 1/4・3/4 位置に色を足して5点グラデーションにできます。両方とも未指定のときは従来の3点グラデーションと完全一致します。位置（Phase AW）は既定（0.25／0.75）で従来同一です。
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
  </>
);
