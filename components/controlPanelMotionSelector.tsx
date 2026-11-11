import React from 'react';
import type { Layer2Type } from '../types';
import { getModeExecutionManifestEntry } from '../lib/executionManifest';
import { getMotionArchitecture } from '../lib/motionArchitecture';
import { MOTION_GROUPS } from './motionCatalog';
import {
  DRIVER_LABELS,
  DRIVER_SECTION_ORDER,
  EDITING_PROFILE_LABELS,
  MOTION_OPTIONS_BY_ID,
  motionOptionMatchesQuery,
} from './controlPanelMotionCatalog';

export const MotionSelector: React.FC<{
  value: Layer2Type;
  onChange: (val: Layer2Type) => void;
}> = ({ value, onChange }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return (
    <div className="mb-5">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">
        Motion Type
      </div>
      <input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search motions"
        className="mb-3 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-xs outline-none focus:border-white/35"
      />
      <div className="space-y-3">
        {MOTION_GROUPS.map((group) => {
          const visibleOptions = group.ids
            .map((id) => MOTION_OPTIONS_BY_ID.get(id))
            .filter((option): option is NonNullable<typeof option> => Boolean(option))
            .filter((option) => motionOptionMatchesQuery(option.id, normalizedQuery, group.label));

          if (visibleOptions.length === 0) {
            return null;
          }

          const sections = DRIVER_SECTION_ORDER.map((driver) => ({
            driver,
            options: visibleOptions.filter((option) => getMotionArchitecture(option.id).driver === driver),
          })).filter((section) => section.options.length > 0);

          return (
            <div key={group.label}>
              <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white/45">
                <span>{group.label}</span>
                <span>{visibleOptions.length}</span>
              </div>
              <div className="space-y-2">
                {sections.map((section) => (
                  <div key={`${group.label}-${section.driver}`} className="rounded border border-white/8 bg-white/[0.02] p-2">
                    <div className="mb-2 flex items-center justify-between text-[8px] uppercase tracking-[0.18em] text-white/45">
                      <span>{DRIVER_LABELS[section.driver]}</span>
                      <span>{section.options.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                      {section.options.map((opt) => {
                        const architecture = getMotionArchitecture(opt.id);
                        const manifest = getModeExecutionManifestEntry(opt.id);
                        const isActive = value === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => onChange(opt.id)}
                            className={`flex min-h-[82px] flex-col items-start justify-start border px-2 py-2 text-left transition-all duration-200 ${
                              isActive
                                ? 'bg-white text-black border-transparent opacity-100 scale-[1.02] shadow-lg'
                                : 'border-white/20 bg-transparent text-white/70 hover:text-white hover:border-white/50'
                            }`}
                          >
                            <div className="mb-1 flex w-full items-center gap-2">
                              <opt.icon size={14} className="shrink-0" />
                              <span className="text-[8px] uppercase font-bold leading-none">{opt.label}</span>
                            </div>
                            <span className={`text-[7px] uppercase tracking-[0.16em] ${isActive ? 'text-black/70' : 'text-white/45'}`}>
                              {DRIVER_LABELS[architecture.driver]} · {EDITING_PROFILE_LABELS[architecture.editingProfile]}
                            </span>
                            <span className={`mt-1 text-[7px] uppercase tracking-[0.12em] ${isActive ? 'text-black/60' : 'text-white/40'}`}>
                              {manifest.requestedEngineId} · {manifest.pathId} · {manifest.adapterId}
                            </span>
                            <span className={`mt-1 text-[7px] uppercase tracking-[0.12em] ${isActive ? 'text-black/60' : 'text-white/35'}`}>
                              {manifest.sourceFieldKind} · {manifest.sourceFieldMode}
                            </span>
                            <span className={`mt-1 line-clamp-2 text-[8px] leading-tight ${isActive ? 'text-black/75' : 'text-white/55'}`}>
                              {architecture.depictionHint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
