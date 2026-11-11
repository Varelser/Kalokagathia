import React from 'react';

import type { ParticleConfig } from '../types';
import {
  createCustomProductPackRecord,
  duplicateCustomProductPackRecord,
  inferActiveCustomProductPackRecordId,
  loadCustomProductPackRecords,
  refreshCustomProductPackRecord,
  saveCustomProductPackRecords,
  type CustomProductPackRecord,
} from '../lib/productPackCustomLibrary';
import type { ProductPackBundle } from '../lib/productPackLibrary';

interface UseGlobalDisplayProductPackCustomPacksArgs {
  config: ParticleConfig;
  isPublicLibrary: boolean;
  activeProductPackBundle: ProductPackBundle | null;
  activeProductPackBaseConfig: ParticleConfig;
  applyConfigSnapshot: (nextConfig: ParticleConfig) => void;
}

export interface GlobalDisplayProductPackCustomPacksState {
  customProductPacks: CustomProductPackRecord[];
  activeCustomProductPack: CustomProductPackRecord | null;
  activeCustomProductPackId: string | null;
  saveCurrentAsCustomProductPack: () => void;
  duplicateCurrentProductPackState: () => void;
  formatCustomPackDate: (value: string) => string;
  applyCustomProductPackRecord: (record: CustomProductPackRecord) => void;
  overwriteCustomProductPack: (record: CustomProductPackRecord) => void;
  duplicateCustomProductPack: (record: CustomProductPackRecord) => void;
  deleteCustomProductPack: (recordId: string) => void;
}

export function useGlobalDisplayProductPackCustomPacks({
  config,
  isPublicLibrary,
  activeProductPackBundle,
  activeProductPackBaseConfig,
  applyConfigSnapshot,
}: UseGlobalDisplayProductPackCustomPacksArgs): GlobalDisplayProductPackCustomPacksState {
  const [customProductPacks, setCustomProductPacks] = React.useState<CustomProductPackRecord[]>(() => loadCustomProductPackRecords());

  React.useEffect(() => {
    saveCustomProductPackRecords(customProductPacks);
  }, [customProductPacks]);

  const activeCustomProductPackId = React.useMemo(
    () => inferActiveCustomProductPackRecordId(config, customProductPacks),
    [config, customProductPacks],
  );
  const activeCustomProductPack = React.useMemo(
    () => customProductPacks.find((record) => record.id === activeCustomProductPackId) ?? null,
    [activeCustomProductPackId, customProductPacks],
  );

  const saveCurrentAsCustomProductPack = React.useCallback(() => {
    if (isPublicLibrary || typeof window === 'undefined') return;
    const suggestedLabel = activeProductPackBundle ? `${activeProductPackBundle.label} Variant ${customProductPacks.length + 1}` : `Custom Product Pack ${customProductPacks.length + 1}`;
    const label = window.prompt('Custom product pack name', suggestedLabel)?.trim();
    if (!label) return;
    const record = createCustomProductPackRecord({
      label,
      baseProductPackId: activeProductPackBundle?.id ?? null,
      baseProductPackLabel: activeProductPackBundle?.label ?? null,
      config,
      baseConfig: activeProductPackBaseConfig,
    });
    setCustomProductPacks((prev) => [record, ...prev]);
  }, [activeProductPackBaseConfig, activeProductPackBundle, config, customProductPacks.length, isPublicLibrary]);

  const duplicateCurrentProductPackState = React.useCallback(() => {
    if (isPublicLibrary) return;
    if (activeCustomProductPack) {
      setCustomProductPacks((prev) => [duplicateCustomProductPackRecord(activeCustomProductPack), ...prev]);
      return;
    }
    const label = activeProductPackBundle ? `${activeProductPackBundle.label} Copy` : 'Custom Product Pack Copy';
    const record = createCustomProductPackRecord({
      label,
      baseProductPackId: activeProductPackBundle?.id ?? null,
      baseProductPackLabel: activeProductPackBundle?.label ?? null,
      config,
      baseConfig: activeProductPackBaseConfig,
    });
    setCustomProductPacks((prev) => [record, ...prev]);
  }, [activeCustomProductPack, activeProductPackBaseConfig, activeProductPackBundle, config, isPublicLibrary]);

  const applyCustomProductPackRecord = React.useCallback((record: CustomProductPackRecord) => {
    applyConfigSnapshot(record.config);
  }, [applyConfigSnapshot]);

  const duplicateCustomProductPack = React.useCallback((record: CustomProductPackRecord) => {
    if (isPublicLibrary) return;
    setCustomProductPacks((prev) => [duplicateCustomProductPackRecord(record), ...prev]);
  }, [isPublicLibrary]);

  const overwriteCustomProductPack = React.useCallback((record: CustomProductPackRecord) => {
    if (isPublicLibrary) return;
    setCustomProductPacks((prev) => prev.map((entry) => (
      entry.id === record.id
        ? refreshCustomProductPackRecord(entry, { config, baseConfig: activeProductPackBaseConfig })
        : entry
    )));
  }, [activeProductPackBaseConfig, config, isPublicLibrary]);

  const deleteCustomProductPack = React.useCallback((recordId: string) => {
    if (isPublicLibrary) return;
    setCustomProductPacks((prev) => prev.filter((entry) => entry.id !== recordId));
  }, [isPublicLibrary]);

  const formatCustomPackDate = React.useCallback((value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  return {
    customProductPacks,
    activeCustomProductPack,
    activeCustomProductPackId,
    saveCurrentAsCustomProductPack,
    duplicateCurrentProductPackState,
    formatCustomPackDate,
    applyCustomProductPackRecord,
    overwriteCustomProductPack,
    duplicateCustomProductPack,
    deleteCustomProductPack,
  };
}
