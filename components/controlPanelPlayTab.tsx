import React from 'react';
import { PartialApplySection } from './controlPanelPartialApply';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { BreedingSection, ExpressionMap } from './controlPanelPlayTabGeneration';
import { CsgSection, ExportSection, GraphSection, KeyboardShortcutsSection, PromptDraftSection } from './controlPanelPlayTabGraph';
import { MidiSection, OscSection } from './controlPanelPlayTabIo';
import { EventRulesSection } from './controlPanelEventRules';
import { PerformanceSection, SimilaritySection, SourceEditorSection } from './controlPanelPlayTabRender';
import { CleanOutputSection, GpuDiagnosticsSection, ModulationSection, StageSection } from './controlPanelPlayTabStage';
import { DataSourceSection, HistorySection, ParameterSearchSection, PointCacheSection, TexturePackSection, XyPadSection } from './controlPanelPlayTabTools';
export { PresetShelf } from './controlPanelPlayTabShelf';
/**
 * Play tab (roadmap Phase 6A / 6C / 7A).
 *
 * The entrance to the panel: pick a preset from a simple shelf, bend it
 * with perceptual macro knobs, and see which regions of the expression
 * space the whole library has not covered yet. Everything here is
 * additive — the detailed tabs are untouched, and macros only write
 * ordinary config fields through updateConfig.
 */

/**
 * Perf stage 4: mount children only once the browser is idle (or after
 * a short timeout), so the Play sheet's first paint carries just the top
 * sections. The deferred sections are far below the fold of the 30dvh
 * sheet; each holds only local UI state, so mounting them a beat later
 * is invisible except for removing their render cost from the initial
 * mount (the sheet opens by default, so they used to mount at startup).
 */
const DeferredMount: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const win = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(() => { if (!cancelled) setReady(true); }, { timeout: 600 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(() => { if (!cancelled) setReady(true); }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return ready ? <>{children}</> : null;
};

export const PlayTabContent: React.FC<ControlPanelContentProps> = (props) => (
  <div className="mg-flow-sub">
    {/* Four-edge layout: the preset shelf lives in the right-edge panel
        and the macros in the bottom transport bar (controlPanelChrome);
        the Play tab keeps the remaining sections. */}
    <StageSection config={props.config} presets={props.presets} isPublicLibrary={props.isPublicLibrary} onApplyConfig={props.onApplyConfig} />
    <CleanOutputSection />
    <GpuDiagnosticsSection config={props.config} updateConfig={props.updateConfig} />
    <DeferredMount>
    <ParameterSearchSection config={props.config} updateConfig={props.updateConfig} onJumpToTab={props.onJumpToTab} />
    <XyPadSection config={props.config} updateConfig={props.updateConfig} />
    <SourceEditorSection config={props.config} updateConfig={props.updateConfig} />
    <DataSourceSection config={props.config} updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <PointCacheSection config={props.config} updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <TexturePackSection config={props.config} updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <MidiSection
      config={props.config}
      updateConfig={props.updateConfig}
      isPublicLibrary={props.isPublicLibrary}
      presets={props.presets}
      activePresetId={props.activePresetId}
      onLoadPreset={props.onLoadPreset}
      onRandomize={props.onRandomize}
      presetSequence={props.presetSequence}
      activeSequenceItemId={props.activeSequenceItemId}
      isSequencePlaying={props.isSequencePlaying}
      sequenceLoopEnabled={props.sequenceLoopEnabled}
      onLoadSequenceItem={props.onLoadSequenceItem}
      onStartSequencePlayback={props.onStartSequencePlayback}
      onStopSequencePlayback={props.onStopSequencePlayback}
    />
    <OscSection updateConfig={props.updateConfig} isPublicLibrary={props.isPublicLibrary} />
    <EventRulesSection isPublicLibrary={props.isPublicLibrary} />
    <ModulationSection isPublicLibrary={props.isPublicLibrary} config={props.config} updateConfig={props.updateConfig} />
    <PerformanceSection config={props.config} onApplyConfig={props.onApplyConfig} />
    <ExportSection captureRef={props.pointCloudCaptureRef} config={props.config} updateConfig={props.updateConfig} />
    <CsgSection config={props.config} updateConfig={props.updateConfig} />
    <HistorySection
      entries={props.configHistoryEntries}
      config={props.config}
      onApplyConfig={props.onApplyConfig}
      onClearConfigHistory={props.onClearConfigHistory}
    />
    <BreedingSection
      presets={props.presets}
      config={props.config}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <PartialApplySection
      presets={props.presets}
      config={props.config}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <PromptDraftSection
      config={props.config}
      presets={props.presets}
      isPublicLibrary={props.isPublicLibrary}
      onApplyConfig={props.onApplyConfig}
      onSaveBredPreset={props.onSaveBredPreset}
    />
    <KeyboardShortcutsSection />
    <GraphSection config={props.config} updateConfig={props.updateConfig} updateMotionArray={props.updateMotionArray} isPublicLibrary={props.isPublicLibrary} />
    <SimilaritySection presets={props.presets} activePresetId={props.activePresetId} onLoadPreset={props.onLoadPreset} />
    <ExpressionMap config={props.config} presets={props.presets} isPublicLibrary={props.isPublicLibrary} onSaveBredPreset={props.onSaveBredPreset} />
    </DeferredMount>
  </div>
);
