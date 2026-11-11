import React from 'react';
import { SourceSelector, Toggle } from './controlPanelParts';
import { PROCEDURAL_MODES } from './controlPanelProceduralModeSettings';
import { getLayerPerformanceSummary } from '../lib/performanceHints';
import { shouldShowModeSection } from '../lib/modeParameterSchema';
import { SharedLayerTabParticleSections } from './controlPanelLayerTabParticleSections';
import { SharedLayerTabSourceSections } from './controlPanelLayerTabSourceSections';
import {
  getLayerKey,
  type LayerArrayKey,
  type LayerBaseCountKey,
  type LayerMotionKey,
  type LayerPositionKey,
  type SharedLayerTabContentProps,
} from './controlPanelLayerTabSharedTypes';

export const SharedLayerTabContent: React.FC<SharedLayerTabContentProps> = ({ layerIndex, config, lockedPanelClass, updateConfig, updateLayerArray, updateMotionArray, updatePositionArray }) => {
  const layerName = `Layer ${layerIndex}`;
  const layerShortName = `L${layerIndex}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = <T = any>(suffix: string) => config[getLayerKey(layerIndex, suffix)] as T;
  const write = (suffix: string, value: unknown) => updateConfig(getLayerKey(layerIndex, suffix) as never, value as never);
  const baseCountKey = getLayerKey(layerIndex, 'Count') as LayerBaseCountKey;
  const sourcePositionsKey = getLayerKey(layerIndex, 'SourcePositions') as LayerPositionKey;
  const motionsKey = getLayerKey(layerIndex, 'Motions') as LayerMotionKey;
  const countsKey = getLayerKey(layerIndex, 'Counts') as LayerArrayKey;
  const sizesKey = getLayerKey(layerIndex, 'Sizes') as LayerArrayKey;
  const radiusScalesKey = getLayerKey(layerIndex, 'RadiusScales') as LayerArrayKey;
  const flowSpeedsKey = getLayerKey(layerIndex, 'FlowSpeeds') as LayerArrayKey;
  const flowAmpsKey = getLayerKey(layerIndex, 'FlowAmps') as LayerArrayKey;
  const flowFreqsKey = getLayerKey(layerIndex, 'FlowFreqs') as LayerArrayKey;
  const layerLoad = getLayerPerformanceSummary(config, layerIndex);
  const isProceduralMode = !read('MotionMix') && PROCEDURAL_MODES.has(read('Type'));
  const [showLegacyDynamics, setShowLegacyDynamics] = React.useState(false);
  const [compactProceduralUi, setCompactProceduralUi] = React.useState(true);
  const showSourceLayout = shouldShowModeSection(read('Type'), compactProceduralUi, 'source-layout');

  return (
    <div className={lockedPanelClass}>
      <div className="mb-6">
        <Toggle label={`${layerName} Enabled`} value={read('Enabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('Enabled', v)} />
      </div>
      {read('Enabled') && (
        <>
          <SourceSelector value={read('Source')} onChange={(v) => write('Source', v)} />
          <SharedLayerTabSourceSections
            config={config}
            layerIndex={layerIndex}
            layerName={layerName}
            layerShortName={layerShortName}
            read={read}
            write={write}
            updateConfig={updateConfig}
            updateLayerArray={updateLayerArray}
            updateMotionArray={updateMotionArray}
            updatePositionArray={updatePositionArray}
            baseCountKey={baseCountKey}
            sourcePositionsKey={sourcePositionsKey}
            motionsKey={motionsKey}
            countsKey={countsKey}
            sizesKey={sizesKey}
            radiusScalesKey={radiusScalesKey}
            flowSpeedsKey={flowSpeedsKey}
            flowAmpsKey={flowAmpsKey}
            flowFreqsKey={flowFreqsKey}
            layerLoad={layerLoad}
            showSourceLayout={showSourceLayout}
          />
          <SharedLayerTabParticleSections
            config={config}
            layerIndex={layerIndex}
            layerName={layerName}
            layerShortName={layerShortName}
            read={read}
            write={write}
            updateConfig={updateConfig}
            updateLayerArray={updateLayerArray}
            updateMotionArray={updateMotionArray}
            updatePositionArray={updatePositionArray}
            baseCountKey={baseCountKey}
            sourcePositionsKey={sourcePositionsKey}
            motionsKey={motionsKey}
            countsKey={countsKey}
            sizesKey={sizesKey}
            radiusScalesKey={radiusScalesKey}
            flowSpeedsKey={flowSpeedsKey}
            flowAmpsKey={flowAmpsKey}
            flowFreqsKey={flowFreqsKey}
            layerLoad={layerLoad}
            isProceduralMode={isProceduralMode}
            compactProceduralUi={compactProceduralUi}
            setCompactProceduralUi={setCompactProceduralUi}
            showLegacyDynamics={showLegacyDynamics}
            setShowLegacyDynamics={setShowLegacyDynamics}
          />
        </>
      )}
    </div>
  );
};
