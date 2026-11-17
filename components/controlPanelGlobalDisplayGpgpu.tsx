import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuAdvancedRenderSection } from './controlPanelGlobalDisplayGpgpuAdvancedRender';
import { GlobalDisplayGpgpuForcesSection } from './controlPanelGlobalDisplayGpgpuForces';
import { GlobalDisplayGpgpuTrailsSection } from './controlPanelGlobalDisplayGpgpuTrails';
import { Slider, Toggle } from './controlPanelParts';

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
        </>
      )}
    </div>
  </>
);
