import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuAdvancedRenderSection } from './controlPanelGlobalDisplayGpgpuAdvancedRender';
import { GlobalDisplayGpgpuForcesSection } from './controlPanelGlobalDisplayGpgpuForces';
import { GlobalDisplayGpgpuParticleRulesSection } from './controlPanelGlobalDisplayGpgpuParticleRules';
import { GlobalDisplayGpgpuTrailsSection } from './controlPanelGlobalDisplayGpgpuTrails';
import { Slider, Toggle } from './controlPanelParts';
import { resolveDistributionOps } from '../lib/gpgpuDistribution';

/** Distribution operators + shader seed (Grammar 2.0 stage 2,
 *  B5): the operator layer over the shape law (JSON list,
 *  draft + Apply like the B1 field editor) and the opt-in
 *  seed that reaches the respawn hash draws. Both are inert
 *  at their defaults ('' / 0): the placement stays legacy. */
const DistributionSection: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const [distDraft, setDistDraft] = React.useState<string | null>(null);
  const resolvedOps = resolveDistributionOps(config);
  return (
    <>
      <div className="mb-2 mt-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Distribution Operators （分布演算子 — 文法2.0第2段B5）</div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        形状法則で置いた点に、分布を変える演算を順に重ねます（ベイクとリスポーンの両方に同じ層がかかります）。power = 半径の冪（a: 指数）、invert = 半径の反転、stratify = 層化（a: 帯の数）、cluster = 方位のクラスタ（a: セクタ数、b: 強さ）。現在 {resolvedOps.length} 演算子が有効です。
      </div>
      <textarea
        value={distDraft ?? config.gpgpuEmitDistribution}
        onChange={(event) => setDistDraft(event.target.value)}
        spellCheck={false}
        rows={3}
        className="mt-1 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
        placeholder={'[{"op":"power","a":0.5},{"op":"stratify","a":4}]'}
      />
      {distDraft !== null && distDraft !== config.gpgpuEmitDistribution && (
        <button
          type="button"
          onClick={() => { updateConfig('gpgpuEmitDistribution', distDraft); setDistDraft(null); }}
          className="mt-1 rounded border border-white/25 px-2 py-1 text-[10px] text-white/85 hover:border-white/50"
        >
          演算子を適用
        </button>
      )}
      <Slider label="Shader Seed （シェーダ側シード・opt-in）" value={config.gpgpuShaderSeed} min={0} max={1000} step={1} onChange={(v) => updateConfig('gpgpuShaderSeed', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        0（既定）では何も変わりません。0 以外にするとリスポーンのハッシュ位相にシードが届き、再配置の散らばりがシード依存になります（CPU 側ベイクのシード gpgpuSeed とは別系統です）。
      </div>
    </>
  );
};

export const GlobalDisplayGpgpuSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">GPGPU Layer (GPU Particles)</div>
      <Toggle
        label="GPGPU Enabled"
        value={config.gpgpuEnabled}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => updateConfig('gpgpuEnabled', v)}
      />
      {config.gpgpuEnabled && (
        <>
          <Toggle
            label="Compute Backend"
            value={config.gpgpuExecutionPreference}
            options={[
              { label: 'Auto', val: 'auto' },
              { label: 'WebGL', val: 'webgl' },
              { label: 'WebGPU', val: 'webgpu' },
            ]}
            onChange={(v) => updateConfig('gpgpuExecutionPreference', v)}
          />
          <div className="mt-2 text-[10px] leading-relaxed text-white/55">WebGPU を要求しても、未対応の GPGPU 機能が有効な場合は自動で WebGL にフォールバックします。Diagnostics を有効にすると unsupported features を確認できます。</div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <Toggle
              label="Execution Diagnostics"
              value={config.executionDiagnosticsEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('executionDiagnosticsEnabled', v)}
            />
            {config.executionDiagnosticsEnabled && (
              <Toggle
                label="Verbose Diagnostics"
                value={config.executionDiagnosticsVerbose}
                options={[{ label: 'Verbose', val: true }, { label: 'Compact', val: false }]}
                onChange={(v) => updateConfig('executionDiagnosticsVerbose', v)}
              />
            )}
            <Toggle
              label="Hybrid SDF Surface"
              value={config.hybridSdfEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridSdfEnabled', v)}
            />
            <Toggle
              label="Hybrid Patch Surface"
              value={config.hybridPatchEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridPatchEnabled', v)}
            />
            <Toggle
              label="Hybrid Fiber Field"
              value={config.hybridFiberEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridFiberEnabled', v)}
            />
            <Toggle
              label="Hybrid Granular Field"
              value={config.hybridGranularEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridGranularEnabled', v)}
            />
            <Toggle
              label="Hybrid Membrane Surface"
              value={config.hybridMembraneEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridMembraneEnabled', v)}
            />
          </div>
          <Slider label="Particle Count" value={config.gpgpuCount} min={1024} max={1048576} step={1024} onChange={(v) => updateConfig('gpgpuCount', v)} />
          <Toggle
            label="Emit Shape"
            value={config.gpgpuEmitShape}
            options={[
              { label: 'Sphere', val: 'sphere' }, { label: 'Shell', val: 'shell' },
              { label: 'Disc', val: 'disc' },   { label: 'Ring', val: 'ring' },
              { label: 'Box', val: 'box' },     { label: 'Cone', val: 'cone' },
              { label: 'Light', val: 'light' },
            ]}
            onChange={(v) => updateConfig('gpgpuEmitShape', v)}
          />
          {config.gpgpuEmitShape === 'light' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Light 形状は下の 3D Light の位置から放出します（ライト自体の On/Off とは独立です）。
            </div>
          )}
          <Toggle
            label="Respawn Shape"
            value={config.gpgpuRespawnShape}
            options={[
              { label: 'Auto', val: 'auto' },
              { label: 'Sphere', val: 'sphere' }, { label: 'Shell', val: 'shell' },
              { label: 'Disc', val: 'disc' },   { label: 'Ring', val: 'ring' },
              { label: 'Box', val: 'box' },     { label: 'Cone', val: 'cone' },
              { label: 'Light', val: 'light' },
            ]}
            onChange={(v) => updateConfig('gpgpuRespawnShape', v)}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            リスポーン（寿命・キルでの再配置）の形状です。Auto は従来配置（原点の球、Emit Shape が Light の時はライト位置）。形状を指定するとベイクと同じ形状法則で再配置します。
          </div>
          <DistributionSection config={config} updateConfig={updateConfig} />
          <div className="mb-2 mt-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Emitter Frame</div>
          <Slider label="Emitter Pos X" value={config.gpgpuEmitterPosX} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuEmitterPosX', v)} />
          <Slider label="Emitter Pos Y" value={config.gpgpuEmitterPosY} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuEmitterPosY', v)} />
          <Slider label="Emitter Pos Z" value={config.gpgpuEmitterPosZ} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuEmitterPosZ', v)} />
          <Slider label="Emitter Rot X" value={config.gpgpuEmitterRotX} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuEmitterRotX', v)} />
          <Slider label="Emitter Rot Y" value={config.gpgpuEmitterRotY} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuEmitterRotY', v)} />
          <Slider label="Emitter Rot Z" value={config.gpgpuEmitterRotZ} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuEmitterRotZ', v)} />
          <Slider label="Emitter Scale" value={config.gpgpuEmitterScale} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuEmitterScale', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            エミッタ座標系（位置・回転・スケール）です。ベイク初期配置とリスポーンの両方に同じ変換がかかります（速度にはかかりません）。全て既定値のときは従来と同一です。
          </div>
          <div className="mb-2 mt-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Emitter Initial Velocity （初速 — 文法2.0第2段E2）</div>
          <Toggle
            label="Initial Velocity Mode"
            value={config.gpgpuEmitterVelMode}
            options={[
              { label: 'Cube', val: 'cube' },
              { label: 'Directed', val: 'directed' },
            ]}
            onChange={(v) => updateConfig('gpgpuEmitterVelMode', v)}
          />
          {config.gpgpuEmitterVelMode === 'directed' && (
            <>
              <Slider label="Vel Dir X" value={config.gpgpuEmitterVelDirX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuEmitterVelDirX', v)} />
              <Slider label="Vel Dir Y" value={config.gpgpuEmitterVelDirY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuEmitterVelDirY', v)} />
              <Slider label="Vel Dir Z" value={config.gpgpuEmitterVelDirZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuEmitterVelDirZ', v)} />
              <Slider label="Vel Speed （初速・直接指定）" value={config.gpgpuEmitterVelSpeed} min={0} max={50} step={0.1} onChange={(v) => updateConfig('gpgpuEmitterVelSpeed', v)} />
              <Slider label="Vel Spread （初速の広がり）" value={config.gpgpuEmitterVelSpread} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuEmitterVelSpread', v)} />
            </>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            Directed はスポーンイベントの初速指定を一般化したものです。ベイク初速と、放出ゲートの解放フレーム（バーストで絞った粒子が生まれる瞬間）に適用されます。年齢リスポーンでは従来どおり速度リセットはしません。Cube は従来同一です。
          </div>
          <div className="mb-2 mt-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Emission Source （放出源 — 文法2.0第2段E3）</div>
          <Toggle
            label="Emit Source"
            value={config.gpgpuEmitSource}
            options={[
              { label: 'Shape', val: 'shape' },
              { label: 'Morph Cloud', val: 'morph' },
              { label: 'Bitmap', val: 'bitmap' },
              { label: 'Path', val: 'path' },
            ]}
            onChange={(v) => updateConfig('gpgpuEmitSource', v)}
          />
          {config.gpgpuEmitSource === 'bitmap' && (
            <>
              <Slider label="Bitmap Threshold" value={config.gpgpuEmitBitmapThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuEmitBitmapThreshold', v)} />
              <Slider label="Bitmap Depth" value={config.gpgpuEmitBitmapDepth} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuEmitBitmapDepth', v)} />
              <Toggle
                label="Bitmap Invert"
                value={config.gpgpuEmitBitmapInvert}
                options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                onChange={(v) => updateConfig('gpgpuEmitBitmapInvert', v)}
              />
            </>
          )}
          {config.gpgpuEmitSource === 'path' && (
            <Slider label="Path Speed （パス接線方向の初速）" value={config.gpgpuEmitPathSpeed} min={0} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuEmitPathSpeed', v)} />
          )}
          <Toggle
            label="Emit Mask （マスクで発生を制限）"
            value={config.gpgpuEmitMaskEnabled}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(v) => updateConfig('gpgpuEmitMaskEnabled', v)}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            発生源です。Shape は従来の形状法則（Emit Shape）。Morph Cloud はモーフ目標のサンプル雲から発生します（モーフ On/Off とは独立に雲をベイクします）。Bitmap はレイヤー2のメディア輝度マップから雲を作ります。Path はステアリングのパス点列（Path Follow と同じ資産）の上に発生し、ベイク初速はパスの接線方向です（リスポーンでは速度リセットなし、従来どおり）。Emit Mask はラスタマスク（Mask の設定）で発生位置を制限します: ベイク側はマスクグリッド、リスポーン側はマスクテクスチャ（Mask Source が必要）で判定します。Shape + Mask Off は従来同一です。
          </div>
          <Slider label="Gravity" value={config.gpgpuGravity} min={0} max={2} step={0.01} onChange={(v) => updateConfig('gpgpuGravity', v)} />
          <Slider label="Turbulence" value={config.gpgpuTurbulence} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTurbulence', v)} />
          <Slider label="Bounce" value={config.gpgpuBounce} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuBounce', v)} />
          <Slider label="Boundary Radius" value={config.gpgpuBounceRadius} min={10} max={500} step={5} onChange={(v) => updateConfig('gpgpuBounceRadius', v)} />
          <Slider label="Seed" value={config.gpgpuSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuSeed', v)} />
          <Slider label="Particle Size" value={config.gpgpuSize} min={0.5} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSize', v)} />
          <Slider label="Speed" value={config.gpgpuSpeed} min={0.1} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuSpeed', v)} />
          <Slider label="Time Scale (全体)" value={config.timeScale} min={-2} max={3} step={0.05} onChange={(v) => updateConfig('timeScale', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            レイヤーと GPGPU の時間の進み方を全体で拡縮します（Kinetix timeScale）。負値で逆再生。決定論的レンダー書き出し中は自動で 1 に固定されます。
          </div>
          <Slider label="Opacity" value={config.gpgpuOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuOpacity', v)} />
          <Toggle label="Density Compensation" value={config.gpgpuDensityCompEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuDensityCompEnabled', v)} />
          {config.gpgpuDensityCompEnabled && (
            <Slider label="Density Target ρ" value={config.gpgpuDensityCompTarget} min={0.05} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuDensityCompTarget', v)} />
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            密度補償は粒子数・点サイズ・画面サイズが変わっても見かけの濃度を目標密度ρに揃えます（下げる方向のみ、上限1.0）。対象は points と solids です。
          </div>
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">GPGPU Color</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={config.gpgpuColor}
                onChange={(e) => updateConfig('gpgpuColor', e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
              />
              <span className="font-mono text-[10px] opacity-60">{config.gpgpuColor.toUpperCase()}</span>
              <button onClick={() => updateConfig('gpgpuColor', '#88aaff')} className="ml-auto rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase hover:bg-white/10">Reset</button>
            </div>
          </div>
          <div className="mb-4 rounded border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">GPGPU Light (3D)</div>
            <Toggle
              label="Light Enabled"
              value={config.gpgpuLightEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('gpgpuLightEnabled', v)}
            />
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              粒子の描画輝度だけを変える3Dライトです（物理には干渉しません）。PostFx の Lux とは別物です。
            </div>
            {(config.gpgpuLightEnabled || config.gpgpuEmitShape === 'light') && (
              <>
                <Slider label="Light Pos X" value={config.gpgpuLightPosX} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuLightPosX', v)} />
                <Slider label="Light Pos Y" value={config.gpgpuLightPosY} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuLightPosY', v)} />
                <Slider label="Light Pos Z" value={config.gpgpuLightPosZ} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuLightPosZ', v)} />
              </>
            )}
            {config.gpgpuLightEnabled && (
              <>
                <Slider label="Light Intensity" value={config.gpgpuLightIntensity} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuLightIntensity', v)} />
                <Slider label="Light Radius" value={config.gpgpuLightRadius} min={0} max={500} step={1} onChange={(v) => updateConfig('gpgpuLightRadius', v)} />
                <Toggle
                  label="Cone (Spotlight)"
                  value={config.gpgpuLightConeEnabled}
                  options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                  onChange={(v) => updateConfig('gpgpuLightConeEnabled', v)}
                />
                {config.gpgpuLightConeEnabled && (
                  <>
                    <Slider label="Cone Angle (deg)" value={config.gpgpuLightConeAngleDeg} min={0} max={180} step={1} onChange={(v) => updateConfig('gpgpuLightConeAngleDeg', v)} />
                    <Slider label="Cone Dir X" value={config.gpgpuLightDirX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuLightDirX', v)} />
                    <Slider label="Cone Dir Y" value={config.gpgpuLightDirY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuLightDirY', v)} />
                    <Slider label="Cone Dir Z" value={config.gpgpuLightDirZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuLightDirZ', v)} />
                  </>
                )}
              </>
            )}
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Light Units 2-4 (E4)</div>
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                追加の点光源です（コーンなし）。有効なユニットは描画輝度へ合成され、シャドウ（遮蔽マップ近似）の遮蔽ベイクにも光源として接続されます。体積光・軌跡・シャドウマップは Unit 1 専用のままです。
              </div>
              {([2, 3, 4] as const).map((n) => {
                const p = `gpgpuLight${n}` as 'gpgpuLight2' | 'gpgpuLight3' | 'gpgpuLight4';
                const rec = config as unknown as Record<string, number | boolean>;
                const enabled = rec[`${p}Enabled`] === true;
                return (
                  <div key={n} className="mt-2">
                    <Toggle
                      label={`Light Unit ${n}`}
                      value={enabled}
                      options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                      onChange={(v) => updateConfig(`${p}Enabled` as never, v as never)}
                    />
                    {enabled && (
                      <>
                        <Slider label={`Unit ${n} Pos X`} value={rec[`${p}PosX`] as number} min={-300} max={300} step={5} onChange={(v) => updateConfig(`${p}PosX` as never, v as never)} />
                        <Slider label={`Unit ${n} Pos Y`} value={rec[`${p}PosY`] as number} min={-300} max={300} step={5} onChange={(v) => updateConfig(`${p}PosY` as never, v as never)} />
                        <Slider label={`Unit ${n} Pos Z`} value={rec[`${p}PosZ`] as number} min={-300} max={300} step={5} onChange={(v) => updateConfig(`${p}PosZ` as never, v as never)} />
                        <Slider label={`Unit ${n} Intensity`} value={rec[`${p}Intensity`] as number} min={0} max={4} step={0.05} onChange={(v) => updateConfig(`${p}Intensity` as never, v as never)} />
                        <Slider label={`Unit ${n} Radius`} value={rec[`${p}Radius`] as number} min={0} max={500} step={1} onChange={(v) => updateConfig(`${p}Radius` as never, v as never)} />
                      </>
                    )}
                  </div>
                );
              })}
              <div className="mt-2">
                <Toggle
                  label="Emit Light Unit (発生源)"
                  value={config.gpgpuEmitLightUnit}
                  options={[{ label: '1', val: 1 }, { label: '2', val: 2 }, { label: '3', val: 3 }, { label: '4', val: 4 }]}
                  onChange={(v) => updateConfig('gpgpuEmitLightUnit', v)}
                />
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  発生形状 light がどのユニットの位置から生むかです（ユニットの On/Off とは独立した位置参照です）。
                </div>
              </div>
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Light Volume / Trail (Phase Y)</div>
              <Toggle
                label="Volume Enabled (見える光)"
                value={config.gpgpuLightVolumeEnabled}
                options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                onChange={(v) => updateConfig('gpgpuLightVolumeEnabled', v)}
              />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                ライトの位置に体積光を描きます（描画のみ）。深度との交差・遮蔽はしないため、輪郭は Softness でぼかします。PostFx の Lux とは別物です。
              </div>
              {config.gpgpuLightVolumeEnabled && (
                <>
                  <Toggle
                    label="Volume Shape"
                    value={config.gpgpuLightVolumeShape}
                    options={[{ label: 'Cone', val: 'cone' as const }, { label: 'Sphere', val: 'sphere' as const }]}
                    onChange={(v) => updateConfig('gpgpuLightVolumeShape', v)}
                  />
                  <Slider label="Volume Intensity" value={config.gpgpuLightVolumeIntensity} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuLightVolumeIntensity', v)} />
                  <Slider label="Volume Length / Radius" value={config.gpgpuLightVolumeLength} min={0} max={500} step={5} onChange={(v) => updateConfig('gpgpuLightVolumeLength', v)} />
                  {config.gpgpuLightVolumeShape === 'cone' && (
                    <Slider label="Volume Angle (deg, 半角)" value={config.gpgpuLightVolumeAngle} min={1} max={89} step={1} onChange={(v) => updateConfig('gpgpuLightVolumeAngle', v)} />
                  )}
                  <Slider label="Volume Steps (1-32)" value={config.gpgpuLightVolumeSteps} min={1} max={32} step={1} onChange={(v) => updateConfig('gpgpuLightVolumeSteps', Math.round(v))} />
                  <Slider label="Volume Softness" value={config.gpgpuLightVolumeSoftness} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuLightVolumeSoftness', v)} />
                </>
              )}
              <Slider label="Depth Occlusion （深度遮蔽・Phase 16）" value={config.gpgpuDepthOcclusion} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuDepthOcclusion', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                シーン深度で体積光と PostFx の Lux コーンを減衰させます（深度を書く不透明メッシュの背後に漏れません）。0 では深度キャプチャ自体を行わず従来と同一です。深度を書かない描画（粒子・加算パス等）は遮蔽しません。
              </div>
              <Toggle
                label="Light Trail (ライト軌跡リボン)"
                value={config.gpgpuLightTrailEnabled}
                options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                onChange={(v) => updateConfig('gpgpuLightTrailEnabled', v)}
              />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                ライトが動いた軌跡をリボンとして描きます（粒子への影響はありません）。ライト位置を動かすと軌跡が伸びます。
              </div>
              {config.gpgpuLightTrailEnabled && (
                <>
                  <Slider label="Trail Width" value={config.gpgpuLightTrailWidth} min={0} max={50} step={0.5} onChange={(v) => updateConfig('gpgpuLightTrailWidth', v)} />
                  <Slider label="Trail Fade" value={config.gpgpuLightTrailFade} min={0} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuLightTrailFade', v)} />
                </>
              )}
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Shadow / Fog Self-Shadow (Phase Z)</div>
              <Toggle
                label="Shadow Enabled (シャドウ（遮蔽マップ近似）)"
                value={config.gpgpuShadowEnabled}
                options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                onChange={(v) => updateConfig('gpgpuShadowEnabled', v)}
              />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                地形と OBJ から 3D ライトへの遮蔽をベイクし、粒子・地形・体積光を減衰させます。本格的なシャドウマップではなく遮蔽マップによる近似です。遮蔽はライトオブジェクトに対してのみ適用されます。
              </div>
              {config.gpgpuShadowEnabled && (
                <>
                  <Slider label="Shadow Strength" value={config.gpgpuShadowStrength} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuShadowStrength', v)} />
                  <Slider label="Shadow Softness" value={config.gpgpuShadowSoftness} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuShadowSoftness', v)} />
                  <Toggle
                    label="Source: Terrain (地形を遮蔽源)"
                    value={config.gpgpuShadowSourceTerrain}
                    options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                    onChange={(v) => updateConfig('gpgpuShadowSourceTerrain', v)}
                  />
                  <Toggle
                    label="Source: OBJ (OBJ を遮蔽源)"
                    value={config.gpgpuShadowSourceObj}
                    options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                    onChange={(v) => updateConfig('gpgpuShadowSourceObj', v)}
                  />
                </>
              )}
              <Slider label="Fog Self-Shadow (煙・霧の自己影)" value={config.gpgpuFogSelfShadow} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuFogSelfShadow', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                ボリューメトリック煙の内部で、ライト方向の密度積分により反対側が沈みます（Volumetric 表示用）。炎の色・温度はモノクロ方針のため対象外です。
              </div>
              {config.gpgpuFogSelfShadow > 0 && (
                <Slider label="Fog Shadow Steps (1-16)" value={config.gpgpuFogShadowSteps} min={1} max={16} step={1} onChange={(v) => updateConfig('gpgpuFogShadowSteps', Math.round(v))} />
              )}
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Shadow Map (シャドウマップ)</div>
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  3D ライトの視点から実深度を描き直す本方式です（上の遮蔽マップ近似とは別物）。第1段では地形メッシュだけが影を受け、粒子は影を落としません。
                </div>
                <Slider label="Shadow Map Strength" value={config.gpgpuShadowMapStrength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuShadowMapStrength', v)} />
                {config.gpgpuShadowMapStrength > 0 && (
                  <>
                    <Slider label="Shadow Map Bias" value={config.gpgpuShadowMapBias} min={0} max={0.01} step={0.0001} onChange={(v) => updateConfig('gpgpuShadowMapBias', v)} />
                    <Slider label="Shadow Map Softness (texels)" value={config.gpgpuShadowMapSoftness} min={0} max={4} step={0.25} onChange={(v) => updateConfig('gpgpuShadowMapSoftness', v)} />
                    <Toggle label="Cast Particles （粒子が影を落とす・自己影、第4段S4）" value={config.gpgpuShadowMapCastParticles} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuShadowMapCastParticles', v)} />
                    {config.gpgpuShadowMapCastParticles && (
                      <Slider label="Shadow Map Particle Size" value={config.gpgpuShadowMapParticleSize} min={0.1} max={8} step={0.05} onChange={(v) => updateConfig('gpgpuShadowMapParticleSize', v)} />
                    )}
                    <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                      自己影: ジオメトリ配置は実寸のインスタンス深度、ポイントは円形の深度スプライトで影を落とします。Particle Size はポイントのスプライト径の倍率で、ジオメトリ配置の影には効きません。
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <Toggle
            label="Audio Reactive"
            value={config.gpgpuAudioReactive}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(v) => updateConfig('gpgpuAudioReactive', v)}
          />
          {config.gpgpuAudioReactive && (
            <Slider label="Audio Blast" value={config.gpgpuAudioBlast} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuAudioBlast', v)} />
          )}

          <GlobalDisplayGpgpuTrailsSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuAdvancedRenderSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuForcesSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuParticleRulesSection config={config} updateConfig={updateConfig} />
        </>
      )}
    </div>
  </>
);
