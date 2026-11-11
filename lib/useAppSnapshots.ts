import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ParticleConfig } from '../types';
import type { SnapshotSlot } from '../components/controlPanelTypes';

const createEmptySnapshotSlots = (): SnapshotSlot[] => Array.from({ length: 4 }, (): SnapshotSlot => null);
const createSnapshotLabel = (slotIndex: number) => `Snapshot ${String.fromCharCode(65 + slotIndex)}`;

interface UseAppSnapshotsOptions {
  applyConfigInstant: (nextConfig: ParticleConfig, activePresetId?: string | null) => void;
  applyConfigMorph: (nextConfig: ParticleConfig, durationSeconds: number, activePresetId?: string | null) => void;
  comparePreviewEnabled: boolean;
  comparePreviewSlotIndex: number;
  config: ParticleConfig;
  handleImportProject: (file: File) => Promise<void>;
  presetBlendDuration: number;
}

const cloneSnapshotConfig = (value: ParticleConfig): ParticleConfig => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as ParticleConfig;
};

export const useAppSnapshots = ({
  applyConfigInstant,
  applyConfigMorph,
  comparePreviewEnabled,
  comparePreviewSlotIndex,
  config,
  handleImportProject,
  presetBlendDuration,
}: UseAppSnapshotsOptions) => {
  const [snapshotSlots, setSnapshotSlots] = useState<SnapshotSlot[]>(() => createEmptySnapshotSlots());
  const snapshotBankRef = useRef<(ParticleConfig | null)[]>(Array.from({ length: 4 }, (): ParticleConfig | null => null));

  const handleProjectFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleImportProject(file);
    }
    event.target.value = '';
  }, [handleImportProject]);

  const handleCaptureSnapshot = useCallback((slotIndex: number) => {
    setSnapshotSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = {
        id: `snapshot-${slotIndex}-${Date.now()}`,
        label: prev[slotIndex]?.label?.trim() || createSnapshotLabel(slotIndex),
        note: prev[slotIndex]?.note ?? '',
        capturedAt: new Date().toISOString(),
      };
      return next;
    });
    snapshotBankRef.current[slotIndex] = cloneSnapshotConfig(config);
  }, [config]);

  const loadSnapshotConfig = useCallback((slotIndex: number) => {
    const snapshot = snapshotBankRef.current[slotIndex];
    return snapshot ? cloneSnapshotConfig(snapshot) : null;
  }, []);

  const handleLoadSnapshot = useCallback((slotIndex: number) => {
    const snapshot = loadSnapshotConfig(slotIndex);
    if (!snapshot) return;
    applyConfigInstant(snapshot, null);
  }, [applyConfigInstant, loadSnapshotConfig]);

  const handleMorphSnapshot = useCallback((slotIndex: number) => {
    const snapshot = loadSnapshotConfig(slotIndex);
    if (!snapshot) return;
    applyConfigMorph(snapshot, Math.max(0.4, presetBlendDuration), null);
  }, [applyConfigMorph, loadSnapshotConfig, presetBlendDuration]);

  const handleClearSnapshot = useCallback((slotIndex: number) => {
    setSnapshotSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
    snapshotBankRef.current[slotIndex] = null;
  }, []);

  const handleRenameSnapshot = useCallback((slotIndex: number, label: string) => {
    setSnapshotSlots((prev) => prev.map((slot, index) => {
      if (index !== slotIndex || !slot) return slot;
      return { ...slot, label: label.trim() || createSnapshotLabel(slotIndex) };
    }));
  }, []);

  const handleSetSnapshotNote = useCallback((slotIndex: number, note: string) => {
    setSnapshotSlots((prev) => prev.map((slot, index) => {
      if (index !== slotIndex || !slot) return slot;
      return { ...slot, note };
    }));
  }, []);

  const compareConfig = useMemo(() => {
    if (!comparePreviewEnabled) return null;
    return loadSnapshotConfig(comparePreviewSlotIndex);
  }, [comparePreviewEnabled, comparePreviewSlotIndex, loadSnapshotConfig]);

  return {
    compareConfig,
    handleCaptureSnapshot,
    handleClearSnapshot,
    handleLoadSnapshot,
    handleMorphSnapshot,
    handleProjectFileChange,
    handleRenameSnapshot,
    handleSetSnapshotNote,
    snapshotBankRef,
    snapshotSlots,
  };
};
