import React from 'react';
import { Crosshair, Plus, Trash2, Waypoints } from 'lucide-react';
import type { ParticleConfig, PresetSequenceItem, SequenceTransitionEasing } from '../types';
import {
  SEQUENCE_TRACK_CATALOG,
  addSequenceTrack,
  getSequenceItemStartTime,
  getSequenceTrackEntry,
  removeSequenceKeyframe,
  removeSequenceTrack,
  sequenceTimeAtPosition,
  setSequenceTracks,
  updateSequenceKeyframe,
  upsertSequenceKeyframe,
  useSequenceClockTime,
  useSequenceTracks,
  type SequenceTrack,
} from '../lib/sequenceTracks';

const EASING_OPTIONS: SequenceTransitionEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

/**
 * Sequence Tracks editor (Phase AN): keyframe tracks over numeric
 * config keys, evaluated against the sequence clock while a sequence
 * plays. The track set lives in the shared sequenceTracks store (the
 * modulation setup pattern), persisted under its own localStorage
 * key; this panel is only the editing surface. In the public build
 * the tracks still apply during playback, but editing is locked.
 */
export const SequenceTracksSection: React.FC<{
  config: ParticleConfig;
  isPublicLibrary: boolean;
  isSequencePlaying: boolean;
  presetSequence: PresetSequenceItem[];
  activeSequenceItemId: string | null;
  sequenceStepProgress: number;
  sequenceSinglePassDuration: number;
}> = ({
  config,
  isPublicLibrary,
  isSequencePlaying,
  presetSequence,
  activeSequenceItemId,
  sequenceStepProgress,
  sequenceSinglePassDuration,
}) => {
  const tracks = useSequenceTracks();
  const clockTime = useSequenceClockTime();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<{ trackId: string; index: number } | null>(null);

  const duration = Math.max(0, sequenceSinglePassDuration);
  const activeIndex = presetSequence.findIndex((item) => item.id === activeSequenceItemId);

  const playhead = React.useMemo(() => {
    if (isSequencePlaying) return Math.min(duration || clockTime, Math.max(0, clockTime));
    if (activeIndex >= 0) {
      const item = presetSequence[activeIndex];
      return sequenceTimeAtPosition(presetSequence, activeIndex, 'hold', sequenceStepProgress * Math.max(0, item.holdSeconds));
    }
    return 0;
  }, [isSequencePlaying, clockTime, duration, activeIndex, presetSequence, sequenceStepProgress]);

  const trackedKeys = React.useMemo(() => new Set(tracks.map((track) => track.key as string)), [tracks]);
  const candidates = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return SEQUENCE_TRACK_CATALOG
      .filter((entry) => !trackedKeys.has(entry.key as string))
      .filter((entry) => !query || entry.label.toLowerCase().includes(query) || (entry.key as string).toLowerCase().includes(query))
      .slice(0, 24);
  }, [search, trackedKeys]);

  const clampTime = (time: number) => Math.min(duration > 0 ? duration : time, Math.max(0, time));

  const handleAddTrack = (key: keyof ParticleConfig) => {
    const value = config[key];
    if (typeof value !== 'number') return;
    setSequenceTracks(addSequenceTrack(tracks, key, { time: clampTime(playhead), value, easing: 'linear' }));
    setSearch('');
  };

  const handleAddKeyframe = (track: SequenceTrack) => {
    const value = config[track.key];
    if (typeof value !== 'number') return;
    const time = clampTime(playhead);
    setSequenceTracks(upsertSequenceKeyframe(tracks, track.id, { time, value, easing: 'linear' }));
    setSelected({ trackId: track.id, index: track.keyframes.findIndex((kf) => kf.time === time) });
  };

  const commitNumber = (trackId: string, index: number, field: 'time' | 'value', raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    setSequenceTracks(updateSequenceKeyframe(tracks, trackId, index, field === 'time' ? { time: clampTime(parsed) } : { value: parsed }));
  };

  return (
    <div className="mt-3 rounded border border-white/10 bg-black/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70">
          <Waypoints size={12} /> Tracks
        </div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-white/45">
          {tracks.length} tracks · playhead {playhead.toFixed(2)}s
        </div>
      </div>
      {isPublicLibrary && (
        <div className="mb-2 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/50">
          Tracks apply during playback in the public build, but edits stay in the private workspace.
        </div>
      )}
      <div className="mb-2 flex gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={isPublicLibrary || duration <= 0}
          placeholder="Search a parameter to track…"
          className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] text-white/90 placeholder:text-white/35 disabled:opacity-30"
        />
      </div>
      {search.trim().length > 0 && (
        <div className="mb-2 grid max-h-36 gap-1 overflow-y-auto pr-1">
          {candidates.length === 0 ? (
            <div className="px-1 py-1 text-[10px] uppercase tracking-widest text-white/35">No matching parameter</div>
          ) : candidates.map((entry) => (
            <button
              key={entry.key as string}
              type="button"
              disabled={isPublicLibrary}
              onClick={() => handleAddTrack(entry.key)}
              className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/5 px-2 py-1 text-left text-[11px] text-white/80 transition-colors hover:bg-white/10 disabled:opacity-30"
            >
              <span className="truncate">{entry.label}</span>
              <span className="flex items-center gap-1 font-mono text-[9px] text-white/40"><Plus size={10} />{entry.key as string}</span>
            </button>
          ))}
        </div>
      )}
      {tracks.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded p-3 text-[10px] uppercase tracking-widest text-white/35">
          No tracks yet. Search a parameter above to add one.
        </div>
      ) : (
        <div className="space-y-3">
          {tracks.map((track) => {
            const entry = getSequenceTrackEntry(track.key);
            if (!entry) return null;
            return (
              <div key={track.id} className="rounded border border-white/10 bg-white/5 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold text-white/85">{entry.label}</div>
                    <div className="truncate font-mono text-[9px] text-white/40">{track.key as string} · {entry.min}…{entry.max}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={isPublicLibrary || duration <= 0}
                      onClick={() => handleAddKeyframe(track)}
                      title="Add a keyframe at the playhead with the current value"
                      className="flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/75 transition-colors hover:bg-white/10 disabled:opacity-30"
                    >
                      <Crosshair size={10} /> Key at playhead
                    </button>
                    <button
                      type="button"
                      disabled={isPublicLibrary}
                      onClick={() => setSequenceTracks(removeSequenceTrack(tracks, track.id))}
                      title="Remove track"
                      className="rounded border border-white/15 bg-white/5 p-1.5 text-white/60 transition-colors hover:bg-white/10 disabled:opacity-30"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <div className="relative mb-2 h-3 rounded-full border border-white/10 bg-black/20">
                  {duration > 0 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/50"
                      style={{ left: `${Math.min(100, Math.max(0, (playhead / duration) * 100))}%` }}
                    />
                  )}
                  {track.keyframes.map((kf, index) => (
                    <button
                      key={`${kf.time}-${index}`}
                      type="button"
                      disabled={isPublicLibrary}
                      onClick={() => setSelected({ trackId: track.id, index })}
                      title={`t=${kf.time.toFixed(2)}s · ${kf.value}`}
                      className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${selected?.trackId === track.id && selected.index === index ? 'border-black bg-white' : 'border-white/70 bg-white/40'} disabled:opacity-40`}
                      style={{ left: `${duration > 0 ? Math.min(100, Math.max(0, (kf.time / duration) * 100)) : 0}%` }}
                    />
                  ))}
                </div>
                <div className="space-y-1">
                  {track.keyframes.map((kf, index) => {
                    const isSelected = selected?.trackId === track.id && selected.index === index;
                    return (
                      <div
                        key={`${kf.time}-${index}`}
                        className={`flex items-center gap-1 rounded border px-1.5 py-1 ${isSelected ? 'border-white/40 bg-white/10' : 'border-white/5 bg-black/10'}`}
                      >
                        <input
                          type="number"
                          defaultValue={kf.time}
                          key={`t-${kf.time}`}
                          step={0.1}
                          min={0}
                          max={duration}
                          disabled={isPublicLibrary}
                          onBlur={(event) => commitNumber(track.id, index, 'time', event.target.value)}
                          className="w-16 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/85 disabled:opacity-30"
                          title="Time (sec)"
                        />
                        <input
                          type="number"
                          defaultValue={kf.value}
                          key={`v-${kf.value}`}
                          step={entry.step}
                          min={entry.min}
                          max={entry.max}
                          disabled={isPublicLibrary}
                          onBlur={(event) => commitNumber(track.id, index, 'value', event.target.value)}
                          className="w-20 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/85 disabled:opacity-30"
                          title="Value"
                        />
                        <select
                          value={kf.easing}
                          disabled={isPublicLibrary}
                          onChange={(event) => setSequenceTracks(updateSequenceKeyframe(tracks, track.id, index, { easing: event.target.value as SequenceTransitionEasing }))}
                          className="rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] text-white/85 disabled:opacity-30"
                          title="Easing toward this keyframe"
                        >
                          {EASING_OPTIONS.map((easing) => (
                            <option key={easing} value={easing} className="bg-neutral-900">{easing}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={isPublicLibrary}
                          onClick={() => setSequenceTracks(removeSequenceKeyframe(tracks, track.id, index))}
                          title="Remove keyframe"
                          className="ml-auto rounded border border-white/10 bg-white/5 p-1 text-white/55 transition-colors hover:bg-white/10 disabled:opacity-30"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {activeIndex >= 0 && (
                  <div className="mt-1 font-mono text-[9px] text-white/35">
                    item start {getSequenceItemStartTime(presetSequence, activeIndex).toFixed(2)}s
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
