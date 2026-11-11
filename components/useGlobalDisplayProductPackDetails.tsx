import React from 'react';

import type { ParticleConfig } from '../types';
import { getProductPackDetailGroups } from '../lib/productPackDetailControls';
import { Slider, Toggle } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelTabsShared';
import {
  EMPTY_DETAIL_GROUPS,
  getDetailGroupScope,
  type ProductPackDetailControl,
  type ProductPackDetailGroup,
  type ProductPackDetailScope,
} from './useGlobalDisplayProductPacksShared';

interface UseGlobalDisplayProductPackDetailsArgs {
  config: ParticleConfig;
  activeProductPackBasePatch: Partial<ParticleConfig> | null;
  updateConfig: UpdateConfig;
}

export interface GlobalDisplayProductPackDetailsState {
  activeProductPackDetailGroups: ProductPackDetailGroup[];
  deltaOnlyControls: boolean;
  setDeltaOnlyControls: React.Dispatch<React.SetStateAction<boolean>>;
  groupedDetailSections: Record<ProductPackDetailScope, ProductPackDetailGroup[]>;
  groupedDetailVisibleCounts: Record<ProductPackDetailScope, number>;
  activeDetailVisibleControlCount: number;
  activeDetailControlCount: number;
  activeDetailModifiedCount: number;
  getDetailGroupModifiedCount: (group: ProductPackDetailGroup) => number;
  getVisibleControlsForGroup: (group: ProductPackDetailGroup) => ProductPackDetailControl[];
  getDetailGroupModifiedPreview: (group: ProductPackDetailGroup) => string;
  resetDetailGroupToPackBase: (group: ProductPackDetailGroup) => void;
  renderProductPackDetailControl: (control: ProductPackDetailControl) => React.ReactNode;
}

export function useGlobalDisplayProductPackDetails({
  config,
  activeProductPackBasePatch,
  updateConfig,
}: UseGlobalDisplayProductPackDetailsArgs): GlobalDisplayProductPackDetailsState {
  const activeProductPackDetailGroups = React.useMemo(() => getProductPackDetailGroups(config), [config]);
  const [deltaOnlyControls, setDeltaOnlyControls] = React.useState(false);

  const controlHasBaseValue = React.useCallback((control: ProductPackDetailControl) => (
    Boolean(activeProductPackBasePatch && typeof activeProductPackBasePatch[control.key] !== 'undefined')
  ), [activeProductPackBasePatch]);

  const isDetailControlModified = React.useCallback((control: ProductPackDetailControl) => {
    if (!activeProductPackBasePatch || typeof activeProductPackBasePatch[control.key] === 'undefined') return false;
    return config[control.key] !== activeProductPackBasePatch[control.key];
  }, [activeProductPackBasePatch, config]);

  const getDetailGroupModifiedCount = React.useCallback((group: ProductPackDetailGroup) => (
    group.controls.filter((control) => isDetailControlModified(control)).length
  ), [isDetailControlModified]);

  const getVisibleControlsForGroup = React.useCallback((group: ProductPackDetailGroup) => (
    deltaOnlyControls
      ? group.controls.filter((control) => isDetailControlModified(control))
      : group.controls
  ), [deltaOnlyControls, isDetailControlModified]);

  const getDetailGroupModifiedPreview = React.useCallback((group: ProductPackDetailGroup) => {
    const modifiedLabels = group.controls
      .filter((control) => isDetailControlModified(control))
      .map((control) => control.label)
      .slice(0, 3);

    if (modifiedLabels.length > 0) {
      return `modified · ${modifiedLabels.join(' · ')}`;
    }

    return deltaOnlyControls ? 'no delta in this group' : 'base-aligned';
  }, [deltaOnlyControls, isDetailControlModified]);

  const groupedDetailSections = React.useMemo(() => activeProductPackDetailGroups.reduce<Record<ProductPackDetailScope, ProductPackDetailGroup[]>>((acc, group) => {
    const scope = getDetailGroupScope(group.id);
    acc[scope].push(group);
    return acc;
  }, {
    common: [...EMPTY_DETAIL_GROUPS.common],
    family: [...EMPTY_DETAIL_GROUPS.family],
    pack: [...EMPTY_DETAIL_GROUPS.pack],
    solver: [...EMPTY_DETAIL_GROUPS.solver],
  }), [activeProductPackDetailGroups]);

  const groupedDetailVisibleCounts = React.useMemo(() => ({
    common: groupedDetailSections.common.reduce((sum, group) => sum + getVisibleControlsForGroup(group).length, 0),
    family: groupedDetailSections.family.reduce((sum, group) => sum + getVisibleControlsForGroup(group).length, 0),
    pack: groupedDetailSections.pack.reduce((sum, group) => sum + getVisibleControlsForGroup(group).length, 0),
    solver: groupedDetailSections.solver.reduce((sum, group) => sum + getVisibleControlsForGroup(group).length, 0),
  }), [getVisibleControlsForGroup, groupedDetailSections]);

  const activeDetailControlCount = React.useMemo(
    () => activeProductPackDetailGroups.reduce((sum, group) => sum + group.controls.length, 0),
    [activeProductPackDetailGroups],
  );
  const activeDetailModifiedCount = React.useMemo(
    () => activeProductPackDetailGroups.reduce((sum, group) => sum + getDetailGroupModifiedCount(group), 0),
    [activeProductPackDetailGroups, getDetailGroupModifiedCount],
  );
  const activeDetailVisibleControlCount = React.useMemo(
    () => activeProductPackDetailGroups.reduce((sum, group) => sum + getVisibleControlsForGroup(group).length, 0),
    [activeProductPackDetailGroups, getVisibleControlsForGroup],
  );

  const resetDetailGroupToPackBase = React.useCallback((group: ProductPackDetailGroup) => {
    if (!activeProductPackBasePatch) return;
    group.controls.forEach((control) => {
      const nextValue = activeProductPackBasePatch[control.key];
      if (typeof nextValue !== 'undefined') {
        updateConfig(control.key, nextValue as ParticleConfig[keyof ParticleConfig]);
      }
    });
  }, [activeProductPackBasePatch, updateConfig]);

  const renderProductPackDetailControl = React.useCallback((control: ProductPackDetailControl) => {
    const modified = isDetailControlModified(control);
    const hasBaseValue = controlHasBaseValue(control);
    const baseValue = hasBaseValue && activeProductPackBasePatch ? activeProductPackBasePatch[control.key] : undefined;

    const input = control.kind === 'slider' ? (
      <Slider
        label={control.label}
        value={config[control.key] as number}
        min={control.min}
        max={control.max}
        step={control.step}
        onChange={(value) => updateConfig(control.key, value as ParticleConfig[keyof ParticleConfig])}
      />
    ) : (
      <Toggle
        label={control.label}
        value={config[control.key] as string | number | boolean}
        options={control.options}
        onChange={(value) => updateConfig(control.key, value as ParticleConfig[keyof ParticleConfig])}
      />
    );

    return (
      <div key={`${control.label}-${String(control.key)}`} className={`rounded border px-2 py-2 ${modified ? 'border-cyan-300/30 bg-cyan-400/5' : 'border-white/5 bg-black/10'}`}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.18em] text-white/35">
          <span>{String(control.key)}</span>
          <div className="flex items-center gap-2">
            {hasBaseValue ? <span className="font-mono text-white/35">base {String(baseValue)}</span> : <span className="text-white/20">base n/a</span>}
            {modified ? <span className="rounded border border-cyan-300/25 px-1 py-0.5 text-cyan-100">changed</span> : <span className="text-white/20">base</span>}
            {hasBaseValue ? (
              <button
                onClick={() => updateConfig(control.key, baseValue as ParticleConfig[keyof ParticleConfig])}
                className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em] text-white/55 hover:bg-white/10"
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>
        {input}
      </div>
    );
  }, [activeProductPackBasePatch, config, controlHasBaseValue, isDetailControlModified, updateConfig]);

  return {
    activeProductPackDetailGroups,
    deltaOnlyControls,
    setDeltaOnlyControls,
    groupedDetailSections,
    groupedDetailVisibleCounts,
    activeDetailVisibleControlCount,
    activeDetailControlCount,
    activeDetailModifiedCount,
    getDetailGroupModifiedCount,
    getVisibleControlsForGroup,
    getDetailGroupModifiedPreview,
    resetDetailGroupToPackBase,
    renderProductPackDetailControl,
  };
}
