import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { ParticleConfig, PresetRecord, PresetSequenceItem, ProjectData, ProjectManifest } from '../types';
import { buildProjectManifest, buildProjectData, saveProjectData } from './projectState';
import {
  buildProjectExportFileName,
  buildProjectImportNotice,
  inspectProjectDataText,
  prepareImportedProjectData,
  serializeProjectData,
} from './projectTransferShared';
import type { Notice } from './audioControllerTypes';
import { saveBlobFile } from './platformFeatures';

type UseProjectTransferArgs = {
  activePresetId: string | null;
  config: ParticleConfig;
  isPanelOpen: boolean;
  isPlaying: boolean;
  isPublicLibraryMode: boolean;
  presetBlendDuration: number;
  presetSequence: PresetSequenceItem[];
  presets: PresetRecord[];
  sequenceLoopEnabled: boolean;
  setActivePresetId: Dispatch<SetStateAction<string | null>>;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
  setIsPanelOpen: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPresetBlendDuration: Dispatch<SetStateAction<number>>;
  setPresetSequence: Dispatch<SetStateAction<PresetSequenceItem[]>>;
  setPresets: Dispatch<SetStateAction<PresetRecord[]>>;
  setSequenceLoopEnabled: Dispatch<SetStateAction<boolean>>;
  setVideoDurationSeconds: Dispatch<SetStateAction<number>>;
  setVideoExportMode: Dispatch<SetStateAction<'current' | 'sequence'>>;
  setVideoFps: Dispatch<SetStateAction<number>>;
  stopPresetTransition: () => void;
  stopSequencePlayback: () => void;
  validPresetIds: Set<string>;
  videoDurationSeconds: number;
  videoExportMode: 'current' | 'sequence';
  videoFps: number;
};

export function useProjectTransfer({
  activePresetId,
  config,
  isPanelOpen,
  isPlaying,
  isPublicLibraryMode,
  presetBlendDuration,
  presetSequence,
  presets,
  sequenceLoopEnabled,
  setActivePresetId,
  setConfig,
  setIsPanelOpen,
  setIsPlaying,
  setPresetBlendDuration,
  setPresetSequence,
  setPresets,
  setSequenceLoopEnabled,
  setVideoDurationSeconds,
  setVideoExportMode,
  setVideoFps,
  stopPresetTransition,
  stopSequencePlayback,
  videoDurationSeconds,
  videoExportMode,
  videoFps,
}: UseProjectTransferArgs) {
  const [projectNotice, setProjectNotice] = useState<Notice | null>(null);

  const buildSnapshot = useCallback((name?: string): ProjectData => buildProjectData({
    name,
    config,
    activePresetId,
    presetBlendDuration,
    sequenceLoopEnabled,
    presets,
    presetSequence,
    ui: {
      isPlaying,
      isPanelOpen,
      videoExportMode,
      videoDurationSeconds,
      videoFps,
    },
  }), [
    activePresetId,
    config,
    isPanelOpen,
    isPlaying,
    presetBlendDuration,
    presetSequence,
    presets,
    sequenceLoopEnabled,
    videoDurationSeconds,
    videoExportMode,
    videoFps,
  ]);

  // Perf stage 4: the manifest is a display-only statistics snapshot for
  // one section of the Main tab, but buildProjectManifest walks the whole
  // library (coverage scorecards over every preset config). Computing it
  // synchronously on every render taxed the initial mount and every
  // animation frame of a preset morph. It is now computed off the render
  // path: debounced 300ms after the inputs settle, reading the latest
  // inputs from a ref, and null until the first computation lands.
  const [projectManifest, setProjectManifest] = useState<ProjectManifest | null>(null);
  const manifestInputsRef = useRef({ config, presets, presetSequence });
  manifestInputsRef.current = { config, presets, presetSequence };
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const latest = manifestInputsRef.current;
      setProjectManifest(buildProjectManifest(latest.config, latest.presets, latest.presetSequence));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [config, presets, presetSequence]);

  useEffect(() => {
    if (isPublicLibraryMode) return;
    saveProjectData(buildSnapshot('Autosave Project'));
  }, [buildSnapshot, isPublicLibraryMode]);

  const handleExportProject = useCallback(async () => {
    if (isPublicLibraryMode) {
      setProjectNotice({ tone: 'error', message: 'Project export is disabled in the public build.' });
      return;
    }

    const payload = buildSnapshot('Workspace Project');
    const blob = new Blob([serializeProjectData(payload)], { type: 'application/json' });
    // File System Access picker where available; anchor download else.
    const result = await saveBlobFile(blob, buildProjectExportFileName(payload.exportedAt), {
      description: 'JSON project',
      accept: { 'application/json': ['.json'] },
    });
    if (result !== 'cancelled') {
      setProjectNotice({ tone: 'success', message: 'Project exported.' });
    }
  }, [buildSnapshot, isPublicLibraryMode]);

  const handleImportProject = useCallback(async (file: File) => {
    if (isPublicLibraryMode) {
      setProjectNotice({ tone: 'error', message: 'Project import is disabled in the public build.' });
      return;
    }

    try {
      const text = await file.text();
      const inspection = inspectProjectDataText(text);
      if (!inspection.parsed) {
        setProjectNotice({ tone: 'error', message: inspection.message ?? 'Invalid project JSON.' });
        return;
      }
      const parsed = inspection.parsed;

      stopSequencePlayback();
      stopPresetTransition();

      const prepared = prepareImportedProjectData(parsed, {
        importMode: 'replace',
      });

      setPresets(prepared.importedPresets);
      setPresetSequence(prepared.importedSequence);
      setConfig(prepared.project.currentConfig);
      setActivePresetId(prepared.remappedActivePresetId);
      setPresetBlendDuration(prepared.project.presetBlendDuration);
      setSequenceLoopEnabled(prepared.project.sequenceLoopEnabled);
      setIsPlaying(prepared.project.ui.isPlaying);
      setIsPanelOpen(prepared.project.ui.isPanelOpen);
      setVideoExportMode(prepared.project.ui.videoExportMode);
      setVideoDurationSeconds(prepared.project.ui.videoDurationSeconds);
      setVideoFps(prepared.project.ui.videoFps);
      setProjectNotice({
        tone: 'success',
        message: buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics),
      });
    } catch (error) {
      console.error('Project import failed:', error);
      setProjectNotice({ tone: 'error', message: 'Project import failed.' });
    }
  }, [
    isPublicLibraryMode,
    setActivePresetId,
    setConfig,
    setIsPanelOpen,
    setIsPlaying,
    setPresetBlendDuration,
    setPresetSequence,
    setPresets,
    setSequenceLoopEnabled,
    setVideoDurationSeconds,
    setVideoExportMode,
    setVideoFps,
    stopPresetTransition,
    stopSequencePlayback,
  ]);

  const dismissProjectNotice = useCallback(() => setProjectNotice(null), []);

  return {
    dismissProjectNotice,
    handleExportProject,
    handleImportProject,
    projectManifest,
    projectNotice,
  };
}
