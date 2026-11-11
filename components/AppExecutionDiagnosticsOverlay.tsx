import React, { useMemo } from 'react';
import type { ParticleConfig } from '../types';
import { getExecutionDiagnostics } from '../lib/executionDiagnostics';

export const AppExecutionDiagnosticsOverlay: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const entries = useMemo(() => getExecutionDiagnostics(config), [config]);
  if (!config.executionDiagnosticsEnabled) return null;
  return (
    <div className="mg-diagnostics pointer-events-none fixed bottom-3 left-3 z-50 flex flex-col gap-2">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded border border-white/15 bg-black/75 px-3 py-2 text-[10px] text-white/80 shadow-lg">
          <div className="font-semibold tracking-wide text-white">{entry.label} · {entry.mode}</div>
          <div>engine: {entry.engine} · path: {entry.path}{entry.hybridKind ? ` · hybrid: ${entry.hybridKind}` : ''}</div>
          <div>requested: {entry.requestedEngine} · override: {entry.overrideId}</div>
          {entry.capabilityFlags.length > 0 ? <div>flags: {entry.capabilityFlags.join(', ')}</div> : null}
          {entry.sceneBranches.length > 0 ? <div>scene: {entry.sceneBranches.join(', ')}</div> : null}
          {config.executionDiagnosticsVerbose ? <div>reason: {entry.reason}</div> : null}
          {config.executionDiagnosticsVerbose && entry.notes.length ? <div>notes: {entry.notes.join(', ')}</div> : null}
          {config.executionDiagnosticsVerbose && entry.features?.length ? <div>features: {entry.features.join(', ')}</div> : null}
          {config.executionDiagnosticsVerbose && entry.supportedFeatures?.length ? <div>supported: {entry.supportedFeatures.join(', ')}</div> : null}
          {config.executionDiagnosticsVerbose && entry.unsupportedFeatures?.length ? <div className="text-amber-300">unsupported: {entry.unsupportedFeatures.join(', ')}</div> : null}
        </div>
      ))}
    </div>
  );
};
