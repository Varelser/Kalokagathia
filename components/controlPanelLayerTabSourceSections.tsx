import React from 'react';
import { Copy, Shuffle } from 'lucide-react';
import {
  LayerAttributeSettings,
  LayerRouteConfig,
  MotionChainConfig,
  MotionGraphConfig,
  PositionFeedbackConfig,
  WarpConfig,
  MotionSelector,
  PerSourceMotionConfig,
  Slider,
  SourceMediaSettings,
  SourcePositionConfig,
  Toggle,
} from './controlPanelParts';
import { MotionDagConfig } from './controlPanelDagEditor';
import { isDedicatedSystemMotionType } from '../lib/motionChain';
import { getLayerKey } from './controlPanelLayerTabSharedTypes';
import type { Layer2Type, MotionDagNode, MotionGraphStep } from '../types';
import type { SharedLayerSourceSectionsProps } from './controlPanelLayerTabSharedTypes';

export const SharedLayerTabSourceSections: React.FC<SharedLayerSourceSectionsProps> = ({
  config,
  read,
  write,
  updateConfig,
  updateLayerArray,
  updateMotionArray,
  updatePositionArray,
  sourcePositionsKey,
  motionsKey,
  countsKey,
  sizesKey,
  radiusScalesKey,
  flowSpeedsKey,
  flowAmpsKey,
  flowFreqsKey,
  baseCountKey,
  layerIndex,
  layerLoad,
  layerName,
  showSourceLayout,
}) => {
  const stage1Types: Layer2Type[] = read('MotionMix') ? (read('Motions') as Layer2Type[]) : [read('Type') as Layer2Type];
  const chainDisabledReason = stage1Types.some((type) => type && isDedicatedSystemMotionType(type))
    ? '第1段が専用システム系（堆積・成長・体積）のモーションのため、このレイヤーではチェーンを使えません。'
    : null;
  const otherLayerIndex = (layerIndex === 2 ? 3 : 2) as 2 | 3;
  const otherStage1Type = config[getLayerKey(otherLayerIndex, 'Type')] as Layer2Type;
  const otherUsesMix = Boolean(config[getLayerKey(otherLayerIndex, 'MotionMix')]);
  const motionRouteDisabledReason = chainDisabledReason
    ? '第1段が専用システム系（堆積・成長・体積）のモーションのため、このレイヤーではモーションルーティングを使えません。'
    : otherStage1Type && isDedicatedSystemMotionType(otherStage1Type)
      ? 'ルーティング元の第1段が専用システム系のため、借りられるモーションスタックがありません。'
      : null;
  const sourceRouteDisabledReason = chainDisabledReason
    ? '第1段が専用システム系（堆積・成長・体積）のモーションのため、このレイヤーではソースルーティングを使えません。'
    : null;
  const motionGraphDisabledReason = chainDisabledReason
    ? '第1段が専用システム系（堆積・成長・体積）のモーションのため、このレイヤーではモーショングラフを使えません。'
    : null;
  const motionDagDisabledReason = chainDisabledReason
    ? '第1段が専用システム系（堆積・成長・体積）のモーションのため、このレイヤーではモーションDAGを使えません。'
    : null;
  return (
  <>
    <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Execution Engine</div>
      <Toggle
        label={`${layerName} Engine`}
        value={read('ExecutionEngineOverride')}
        options={[
          { label: 'Auto', val: 'auto' },
          { label: 'CPU', val: 'cpu-geometry' },
          { label: 'Particle', val: 'webgl-particle' },
          { label: 'Procedural', val: 'webgl-procedural-surface' },
          { label: 'GPGPU', val: 'webgl-gpgpu' },
          { label: 'WebGPU', val: 'webgpu-compute' },
          { label: 'Hybrid', val: 'hybrid-runtime' },
        ]}
        onChange={(v) => write('ExecutionEngineOverride', v)}
      />
    </div>
    {(read('Source') === 'image' || read('Source') === 'video' || read('Source') === 'text') && (
      <SourceMediaSettings
        mode={read('Source') === 'video' ? 'video' : read('Source') === 'text' ? 'text' : 'image'}
        currentTheme={config.backgroundColor}
        threshold={read('MediaThreshold')}
        depth={read('MediaDepth')}
        invert={read('MediaInvert')}
        frameRate={read('MediaFrameRate')}
        mapWidth={read('MediaMapWidth')}
        mapHeight={read('MediaMapHeight')}
        hasMap={read('MediaLumaMap').length > 0}
        onThresholdChange={(v) => write('MediaThreshold', v)}
        onDepthChange={(v) => write('MediaDepth', v)}
        onInvertChange={(v) => write('MediaInvert', v)}
        onFrameRateChange={(v) => write('MediaFrameRate', v)}
        onMapChange={(map, width, height) => {
          write('MediaLumaMap', map);
          write('MediaMapWidth', width);
          write('MediaMapHeight', height);
        }}
        onClear={() => {
          write('MediaLumaMap', []);
          write('MediaMapWidth', 0);
          write('MediaMapHeight', 0);
        }}
        textValue={read('TextMapText')}
        onTextValueChange={(v) => write('TextMapText', v)}
        textFontFamily={read('TextMapFontFamily')}
        onTextFontFamilyChange={(v) => write('TextMapFontFamily', v)}
        textWeight={read('TextMapWeight')}
        onTextWeightChange={(v) => write('TextMapWeight', v)}
        textSize={read('TextMapSize')}
        onTextSizeChange={(v) => write('TextMapSize', v)}
        textPadding={read('TextMapPadding')}
        onTextPaddingChange={(v) => write('TextMapPadding', v)}
        textInvert={read('TextMapInvert')}
        onTextInvertChange={(v) => write('TextMapInvert', v)}
      />
    )}
    {showSourceLayout && (
      <div className="border-b border-white/10 pb-4 mb-4">
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Copy size={12} /> Multi-Emitter Settings
        </h3>
        <Slider label="Source Count" value={read('SourceCount')} min={1} max={50} step={1} onChange={(v) => write('SourceCount', v)} />
        <Slider label="Source Spread" value={read('SourceSpread')} min={0} max={20000} step={10} onChange={(v) => write('SourceSpread', v)} />
        {read('SourceCount') > 1 && (
          <SourcePositionConfig
            count={read('SourceCount')}
            positions={read('SourcePositions')}
            onChange={(idx, axis, val) => updatePositionArray(sourcePositionsKey, idx, axis, val)}
            currentTheme={config.backgroundColor}
          />
        )}
        {read('SourceCount') > 1 && (
          <LayerAttributeSettings
            count={read('SourceCount')}
            counts={read('Counts')}
            sizes={read('Sizes')}
            radiusScales={read('RadiusScales')}
            speeds={read('FlowSpeeds')}
            amps={read('FlowAmps')}
            freqs={read('FlowFreqs')}
            updateCount={(idx, v) => updateLayerArray(countsKey, idx, v, baseCountKey, read('SourceCount'))}
            updateSize={(idx, v) => updateLayerArray(sizesKey, idx, v, baseCountKey, read('SourceCount'))}
            updateRadius={(idx, v) => updateLayerArray(radiusScalesKey, idx, v, baseCountKey, read('SourceCount'))}
            updateSpeed={(idx, v) => updateLayerArray(flowSpeedsKey, idx, v, baseCountKey, read('SourceCount'))}
            updateAmp={(idx, v) => updateLayerArray(flowAmpsKey, idx, v, baseCountKey, read('SourceCount'))}
            updateFreq={(idx, v) => updateLayerArray(flowFreqsKey, idx, v, baseCountKey, read('SourceCount'))}
            currentTheme={config.backgroundColor}
          />
        )}
      </div>
    )}
    {showSourceLayout && (
      <>
        <div className="mb-6 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
            <Shuffle size={14} />
            <span>Mix Motions per Source</span>
          </div>
          <button
            onClick={() => write('MotionMix', !read('MotionMix'))}
            className={`w-10 h-5 rounded-full relative transition-colors ${read('MotionMix') ? 'bg-white' : 'bg-white/20'}`}
            disabled={read('SourceCount') <= 1}
            title={read('SourceCount') <= 1 ? 'Requires multiple sources' : ''}
          >
            <div className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${read('MotionMix') ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        {read('MotionMix') ? (
          <PerSourceMotionConfig count={read('SourceCount')} motions={read('Motions')} onChange={(idx, val) => updateMotionArray(motionsKey, idx, val)} currentTheme={config.backgroundColor} />
        ) : (
          <MotionSelector value={read('Type')} onChange={(v) => write('Type', v)} />
        )}
      </>
    )}
    {showSourceLayout && (
      <MotionChainConfig
        enabled={Boolean(read('MotionChainEnabled'))}
        chain={(read('MotionChain') as Layer2Type[]) ?? []}
        onToggle={(v) => write('MotionChainEnabled', v)}
        onChange={(next) => write('MotionChain', next)}
        disabledReason={chainDisabledReason}
        currentTheme={config.backgroundColor}
      />
    )}
    {showSourceLayout && (
      <LayerRouteConfig
        title="Motion Route"
        enabled={Boolean(read('MotionRouteEnabled'))}
        from={(read('MotionRouteFrom') as 'layer2' | 'layer3' | null) ?? null}
        layerIndex={layerIndex}
        onToggle={(v) => write('MotionRouteEnabled', v)}
        onChange={(next) => write('MotionRouteFrom', next)}
        disabledReason={motionRouteDisabledReason}
        note={otherUsesMix
          ? 'ルーティング元が Mix のため、主タイプ（Type）のモーションスタックが使われます。'
          : '相手レイヤーのモーションスタック（第1段＋チェーン）を、そのパラメータのまま自レイヤーの前段に実行します。'}
        currentTheme={config.backgroundColor}
      />
    )}
    {showSourceLayout && (
      <LayerRouteConfig
        title="Source Route"
        enabled={Boolean(read('SourceRouteEnabled'))}
        from={(read('SourceRouteFrom') as 'layer2' | 'layer3' | null) ?? null}
        layerIndex={layerIndex}
        onToggle={(v) => write('SourceRouteEnabled', v)}
        onChange={(next) => write('SourceRouteFrom', next)}
        disabledReason={sourceRouteDisabledReason}
        note="粒子の初期配置（形・ソース配置・メディアマップ）を相手レイヤーのソース設定で生成します。粒子数やモーションは自レイヤーのままです。"
        currentTheme={config.backgroundColor}
      />
    )}
    {showSourceLayout && (
      <MotionGraphConfig
        enabled={Boolean(read('MotionGraphEnabled'))}
        steps={(read('MotionGraph') as MotionGraphStep[]) ?? []}
        onToggle={(v) => write('MotionGraphEnabled', v)}
        onChange={(next) => write('MotionGraph', next)}
        disabledReason={motionGraphDisabledReason}
        currentTheme={config.backgroundColor}
      />
    )}
    {showSourceLayout && (
      <MotionDagConfig
        enabled={Boolean(read('MotionDagEnabled'))}
        nodes={(read('MotionDag') as MotionDagNode[]) ?? []}
        output={typeof read('MotionDagOutput') === 'number' ? (read('MotionDagOutput') as number) : -1}
        onToggle={(v) => write('MotionDagEnabled', v)}
        onChange={(next) => write('MotionDag', next)}
        onOutputChange={(next) => write('MotionDagOutput', next)}
        disabledReason={motionDagDisabledReason}
        currentTheme={config.backgroundColor}
        layoutKey={`layer${layerIndex}`}
      />
    )}
    {showSourceLayout && (
      <PositionFeedbackConfig
        enabled={Boolean(read('PositionFeedbackEnabled'))}
        feedback={typeof read('PositionFeedback') === 'number' ? (read('PositionFeedback') as number) : 0.85}
        decay={typeof read('PositionFeedbackDecay') === 'number' ? (read('PositionFeedbackDecay') as number) : 0.1}
        onToggle={(v) => write('PositionFeedbackEnabled', v)}
        onChange={(fb, dc) => { write('PositionFeedback', fb); write('PositionFeedbackDecay', dc); }}
        disabledReason={null}
      />
    )}
    {showSourceLayout && (
      <WarpConfig
        enabled={Boolean(read('WarpEnabled'))}
        amount={typeof read('WarpAmount') === 'number' ? (read('WarpAmount') as number) : 18}
        scale={typeof read('WarpScale') === 'number' ? (read('WarpScale') as number) : 0.012}
        onToggle={(v) => write('WarpEnabled', v)}
        onChange={(amt, sc) => { write('WarpAmount', amt); write('WarpScale', sc); }}
        disabledReason={null}
      />
    )}
    {showSourceLayout && (
      <div className="mb-4 rounded border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-white/70">
          <span>Layer Load</span>
          <span className="font-mono">{layerLoad.tier}</span>
        </div>
        <div className="mb-3 text-[10px] text-white/45">
          {layerLoad.suggestions[0] ?? 'Current count and simulation budget are in a comfortable range.'}
        </div>
        <Toggle
          label="Viewport Quality"
          value={config.renderQuality}
          options={[
            { label: 'Draft', val: 'draft' },
            { label: 'Balanced', val: 'balanced' },
            { label: 'Cinematic', val: 'cinematic' },
          ]}
          onChange={(v) => updateConfig('renderQuality', v)}
        />
      </div>
    )}
  </>
  );
};
