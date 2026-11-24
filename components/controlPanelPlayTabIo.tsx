import React from 'react';
import { Piano, Radio } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { MACRO_DEFINITIONS, getMacroUpdates, getMacroValue } from '../lib/macroControls';
import { PARAMETER_CATALOG } from '../lib/parameterCatalog';
import { MIDI_NOTE_ACTIONS, describeMidiNote, describeMidiNoteAction, describeMidiTarget, loadMidiAssignments, loadMidiNoteAssignments, resolveAssignment, resolveNoteAssignment, saveMidiAssignments, saveMidiNoteAssignments, scaleCcValue, type MidiAssignment, type MidiNoteAction, type MidiNoteAssignment, type MidiTarget } from '../lib/midiControl';
import { MIDI_CLOCK_DIVISIONS, MidiClockTracker, SEQUENCE_SYNC_SOURCES, loadMidiClockSyncPrefs, saveMidiClockSyncPrefs, type MidiClockDivision, type MidiClockSnapshot, type MidiClockSyncPrefs, type SequenceSyncSource } from '../lib/midiClock';
import { INITIAL_LINK_STATE, LinkSyncClient, type LinkBridgeState } from '../lib/linkSync';
import { MidiOutputEngine, loadMidiOutputSettings, saveMidiOutputSettings, type MidiOutputPortLike, type MidiOutputSettings } from '../lib/midiOutput';
import { DEFAULT_OSC_BRIDGE_URL, describeOscTarget, isValidOscAddress, loadOscAssignments, oscValueToRatio, resolveOscAssignment, saveOscAssignments, scaleOscValue, type OscAssignment, type OscTarget } from '../lib/oscControl';
import { noteModulationMidiTrigger } from '../lib/modulation';
import { fireEventRulesLive } from '../lib/eventRules';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle, TAB_SHORT_LABELS } from './controlPanelPlayTabShared';

export interface MidiMessageEventLike {
  data: Uint8Array | null;
}
export interface MidiInputLike {
  id: string;
  name?: string | null;
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
}
export interface MidiOutputLike {
  id: string;
  name?: string | null;
  send: (data: number[]) => void;
}
export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>;
  outputs: Map<string, MidiOutputLike>;
  onstatechange: (() => void) | null;
}

export const MidiSection: React.FC<{
  config: ControlPanelContentProps['config'];
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
  presets: ControlPanelContentProps['presets'];
  activePresetId: ControlPanelContentProps['activePresetId'];
  onLoadPreset: ControlPanelContentProps['onLoadPreset'];
  onRandomize?: ControlPanelContentProps['onRandomize'];
  presetSequence: ControlPanelContentProps['presetSequence'];
  activeSequenceItemId: ControlPanelContentProps['activeSequenceItemId'];
  isSequencePlaying: ControlPanelContentProps['isSequencePlaying'];
  sequenceLoopEnabled: ControlPanelContentProps['sequenceLoopEnabled'];
  onLoadSequenceItem: ControlPanelContentProps['onLoadSequenceItem'];
  onStartSequencePlayback: ControlPanelContentProps['onStartSequencePlayback'];
  onStopSequencePlayback: ControlPanelContentProps['onStopSequencePlayback'];
}> = ({
  config,
  updateConfig,
  isPublicLibrary,
  presets,
  activePresetId,
  onLoadPreset,
  onRandomize,
  presetSequence,
  activeSequenceItemId,
  isSequencePlaying,
  sequenceLoopEnabled,
  onLoadSequenceItem,
  onStartSequencePlayback,
  onStopSequencePlayback,
}) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const supported =
    typeof navigator !== 'undefined' &&
    'requestMIDIAccess' in (navigator as unknown as Record<string, unknown>);
  const [connected, setConnected] = React.useState(false);
  const [inputs, setInputs] = React.useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = React.useState<MidiAssignment[]>(() =>
    loadMidiAssignments(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [targetValue, setTargetValue] = React.useState('macro:density');
  const [learning, setLearning] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState('');
  const [error, setError] = React.useState('');

  const assignmentsRef = React.useRef(assignments);
  assignmentsRef.current = assignments;
  const learnTargetRef = React.useRef<MidiTarget | null>(null);
  const accessRef = React.useRef<MidiAccessLike | null>(null);

  // --- Note assignments & MIDI Clock (Phase 6.5) ---------------------
  const [noteAssignments, setNoteAssignments] = React.useState<MidiNoteAssignment[]>(() =>
    loadMidiNoteAssignments(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [noteActionValue, setNoteActionValue] = React.useState<MidiNoteAction>('preset-next');
  const [learningNote, setLearningNote] = React.useState(false);
  const noteAssignmentsRef = React.useRef(noteAssignments);
  noteAssignmentsRef.current = noteAssignments;
  const learnNoteActionRef = React.useRef<MidiNoteAction | null>(null);

  const [clockPrefs, setClockPrefs] = React.useState(() =>
    loadMidiClockSyncPrefs(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const clockTrackerRef = React.useRef<MidiClockTracker | null>(null);
  if (clockTrackerRef.current === null) {
    clockTrackerRef.current = new MidiClockTracker(clockPrefs.division);
  }
  const [clockSnapshot, setClockSnapshot] = React.useState<MidiClockSnapshot>({
    running: false,
    hasClock: false,
    bpm: null,
    tickCount: 0,
  });

  // Everything the message handler needs, refreshed every render so
  // the single onmidimessage subscription never goes stale.
  const actionsRef = React.useRef({
    presets,
    activePresetId,
    onLoadPreset,
    onRandomize,
    presetSequence,
    activeSequenceItemId,
    isSequencePlaying,
    sequenceLoopEnabled,
    onLoadSequenceItem,
    onStartSequencePlayback,
    onStopSequencePlayback,
    clockSyncEnabled: clockPrefs.source === 'midi-clock',
  });
  actionsRef.current = {
    presets,
    activePresetId,
    onLoadPreset,
    onRandomize,
    presetSequence,
    activeSequenceItemId,
    isSequencePlaying,
    sequenceLoopEnabled,
    onLoadSequenceItem,
    onStartSequencePlayback,
    onStopSequencePlayback,
    clockSyncEnabled: clockPrefs.source === 'midi-clock',
  };

  /** One sequence step forward — the exact path a sequence-item click
   *  takes (onLoadSequenceItem). That helper stops the internal
   *  hold-timer playback, so a clock boundary can never double-advance
   *  alongside it: after the first boundary the clock is the driver. */
  const advanceSequenceStep = React.useCallback(() => {
    const state = actionsRef.current;
    const sequence = state.presetSequence;
    if (sequence.length === 0) return;
    const index = sequence.findIndex((item) => item.id === state.activeSequenceItemId);
    if (index < 0) {
      state.onLoadSequenceItem(sequence[0].id);
      return;
    }
    if (index >= sequence.length - 1 && !state.sequenceLoopEnabled) return;
    const next = sequence[(index + 1) % sequence.length];
    if (next) state.onLoadSequenceItem(next.id);
  }, []);

  const fireNoteAction = React.useCallback(
    (action: MidiNoteAction) => {
      const state = actionsRef.current;
      if (action === 'preset-next' || action === 'preset-prev') {
        // Same arithmetic as the [ / ] keyboard shortcuts in
        // ControlPanel (shelf order, wrap-around).
        const list = state.presets;
        if (list.length === 0) return;
        const index = list.findIndex((preset) => preset.id === state.activePresetId);
        const nextIndex =
          action === 'preset-next'
            ? index < 0
              ? 0
              : (index + 1) % list.length
            : index < 0
              ? list.length - 1
              : (index - 1 + list.length) % list.length;
        const next = list[nextIndex];
        if (next && next.id !== state.activePresetId) state.onLoadPreset(next.id);
        return;
      }
      if (action === 'sequence-next') {
        advanceSequenceStep();
        return;
      }
      if (action === 'sequence-play-stop') {
        if (state.isSequencePlaying) state.onStopSequencePlayback();
        else state.onStartSequencePlayback();
        return;
      }
      // action === 'randomize'
      state.onRandomize?.();
    },
    [advanceSequenceStep],
  );

  const setSyncPref = React.useCallback(
    (next: Partial<{ source: SequenceSyncSource; division: MidiClockDivision }>) => {
      setClockPrefs((prev) => {
        const source = next.source ?? prev.source;
        const merged: MidiClockSyncPrefs = {
          ...prev,
          ...next,
          source,
          // Keep the legacy Phase 6.5 field truthful for older builds.
          enabled: source === 'midi-clock',
        };
        saveMidiClockSyncPrefs(typeof window !== 'undefined' ? window.localStorage : undefined, merged);
        if (next.division) clockTrackerRef.current?.setDivision(next.division);
        return merged;
      });
    },
    [],
  );

  // Clock ticks arrive at 24 PPQN (every ~21ms at 120 BPM): never set
  // React state per tick. Poll the tracker a few times a second for
  // the status line instead.
  React.useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      const snap = clockTrackerRef.current?.snapshot;
      if (!snap) return;
      setClockSnapshot((prev) =>
        prev.running === snap.running &&
        prev.hasClock === snap.hasClock &&
        prev.tickCount === snap.tickCount &&
        (prev.bpm === null || snap.bpm === null
          ? prev.bpm === snap.bpm
          : Math.abs(prev.bpm - snap.bpm) < 0.05)
          ? prev
          : snap,
      );
    }, 400);
    return () => window.clearInterval(timer);
  }, [connected]);

  // --- Ableton Link sync (Phase 6.6) ----------------------------------
  // The Link client lives only while 'link' is the selected sync
  // source. Its step events take the exact same advanceSequenceStep()
  // path as the MIDI clock (sequence-item load), so the two sources
  // can never drive at once — the selector picks a single source, and
  // MIDI clock events additionally check source === 'midi-clock'.
  const linkClientRef = React.useRef<LinkSyncClient | null>(null);
  if (linkClientRef.current === null) {
    linkClientRef.current = new LinkSyncClient();
  }
  const [linkSnapshot, setLinkSnapshot] = React.useState<LinkBridgeState>(INITIAL_LINK_STATE);

  React.useEffect(() => {
    const client = linkClientRef.current;
    if (!client || clockPrefs.source !== 'link') return;
    client.callbacks = {
      onStep: () => advanceSequenceStep(),
      onPlayingChange: (playing) => {
        const state = actionsRef.current;
        if (playing) {
          // Mirror MIDI Start/Continue: if nothing in the sequence is
          // active yet, load its first item; an item already showing
          // is left alone (Link's timeline is shared, not a restart).
          if (
            state.presetSequence.length > 0 &&
            !state.presetSequence.some((item) => item.id === state.activeSequenceItemId)
          ) {
            state.onLoadSequenceItem(state.presetSequence[0].id);
          }
        } else if (state.isSequencePlaying) {
          state.onStopSequencePlayback();
        }
      },
    };
    client.start();
    return () => {
      client.callbacks = {};
      client.stop();
      setLinkSnapshot(INITIAL_LINK_STATE);
    };
  }, [clockPrefs.source, advanceSequenceStep]);

  React.useEffect(() => {
    linkClientRef.current?.setDivision(clockPrefs.division);
  }, [clockPrefs.division]);

  // Status line polling, same pattern as the MIDI clock snapshot:
  // the bridge broadcasts ~30 ms state, React renders a few times a
  // second at most.
  React.useEffect(() => {
    if (clockPrefs.source !== 'link') return;
    const timer = window.setInterval(() => {
      const snap = linkClientRef.current?.snapshot;
      if (!snap) return;
      setLinkSnapshot((prev) =>
        prev.connected === snap.connected &&
        prev.available === snap.available &&
        prev.reason === snap.reason &&
        prev.isPlaying === snap.isPlaying &&
        prev.numPeers === snap.numPeers &&
        (prev.bpm === null || snap.bpm === null
          ? prev.bpm === snap.bpm
          : Math.abs(prev.bpm - snap.bpm) < 0.05)
          ? prev
          : snap,
      );
    }, 400);
    return () => window.clearInterval(timer);
  }, [clockPrefs.source]);

  // --- MIDI output (Phase 6.7) ---------------------------------------
  // The engine mirrors the show back to a selected output device:
  // macro CC echo, a step-note pulse per sequence item, and a
  // Program Change per preset load. It reuses the SAME MIDIAccess
  // object the input side requested (accessRef) — no second
  // requestMIDIAccess call — and attach() keeps its port resolved.
  const [outputs, setOutputs] = React.useState<{ id: string; name: string }[]>([]);
  const [outputSettings, setOutputSettings] = React.useState<MidiOutputSettings>(() =>
    loadMidiOutputSettings(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const outputEngineRef = React.useRef<MidiOutputEngine | null>(null);
  if (outputEngineRef.current === null) {
    outputEngineRef.current = new MidiOutputEngine();
  }
  const outputPortsRef = React.useRef<Map<string, MidiOutputPortLike>>(new Map());
  const outputSettingsRef = React.useRef(outputSettings);
  outputSettingsRef.current = outputSettings;
  const configRef = React.useRef(config);
  configRef.current = config;

  const applyOutputSettings = React.useCallback((next: MidiOutputSettings) => {
    setOutputSettings(next);
    saveMidiOutputSettings(typeof window !== 'undefined' ? window.localStorage : undefined, next);
  }, []);

  React.useEffect(() => {
    const engine = outputEngineRef.current;
    if (!engine) return;
    engine.setSettings(outputSettings);
    const port = outputSettings.outputId
      ? (outputPortsRef.current.get(outputSettings.outputId) ?? null)
      : null;
    engine.setPort(port);
  }, [outputSettings, outputs]);

  // Macro CC echo: macros are derived from the config, so poll the
  // config a few dozen times a second while output is live and let
  // the engine coalesce (it only sends on change, ~30 ms per macro).
  React.useEffect(() => {
    if (!connected || !outputSettings.enabled || !outputSettings.outputId) return;
    const timer = window.setInterval(() => {
      const engine = outputEngineRef.current;
      if (!engine || !engine.active) return;
      const now = performance.now();
      const current = configRef.current;
      MACRO_DEFINITIONS.forEach((definition, index) => {
        engine.echoMacro(index, getMacroValue(current, definition), now);
      });
      engine.flushPending(now);
    }, 40);
    return () => window.clearInterval(timer);
  }, [connected, outputSettings.enabled, outputSettings.outputId]);

  // Step pulse: EVERY sequence advance lands on the item-load path
  // and changes the active item id — internal playback, MIDI clock,
  // Link, note actions and manual clicks alike — so watching the id
  // fires exactly one pulse per landed step and none for no-op
  // advances (e.g. last item with loop off never changes the id).
  const prevSequenceItemRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const prev = prevSequenceItemRef.current;
    prevSequenceItemRef.current = activeSequenceItemId;
    if (prev === undefined || prev === activeSequenceItemId) return;
    outputEngineRef.current?.triggerStepNote();
  }, [activeSequenceItemId]);

  // Program Change: a preset load (shelf click, [ / ] keys, note
  // actions — all end in onLoadPreset) changes the active preset id;
  // the PC number is its index in the current shelf order.
  const prevPresetIdRef = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    const prev = prevPresetIdRef.current;
    prevPresetIdRef.current = activePresetId;
    if (prev === undefined || prev === activePresetId || activePresetId === null) return;
    const index = actionsRef.current.presets.findIndex((preset) => preset.id === activePresetId);
    if (index >= 0) outputEngineRef.current?.sendProgramChange(index);
  }, [activePresetId]);

  React.useEffect(
    () => () => {
      outputEngineRef.current?.dispose();
    },
    [],
  );

  const applyTarget = React.useCallback(
    (target: MidiTarget, value: number) => {
      if (target.kind === 'macro') {
        const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
        if (!definition) return;
        getMacroUpdates(definition, value / 127).forEach(({ key, value: next }) => write(key, next));
        return;
      }
      const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
      if (!entry) return;
      const scaled = scaleCcValue(value, entry.min, entry.max);
      const stepped = Math.round(scaled / entry.step) * entry.step;
      write(entry.key, Number(stepped.toFixed(6)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMessage = React.useCallback(
    (event: MidiMessageEventLike) => {
      const data = event.data;
      if (!data || data.length === 0) return;
      const status = data[0];

      // Real-time messages (MIDI Clock / Start / Continue / Stop) are
      // single-byte and can arrive at any time — handle them BEFORE
      // the channel-message length/status filters below.
      if (status >= 0xf8) {
        const tracker = clockTrackerRef.current;
        if (!tracker) return;
        const clockEvent = tracker.feed(status, performance.now());
        if (!clockEvent) return;
        const state = actionsRef.current;
        if (clockEvent.type === 'start') {
          setLastEvent('MIDI Clock: Start');
          // Sync ON: Start restarts the sequence from its first item
          // through the item-load path (never the internal timer, so
          // the clock stays the only step driver).
          if (state.clockSyncEnabled && state.presetSequence.length > 0) {
            state.onLoadSequenceItem(state.presetSequence[0].id);
          }
          return;
        }
        if (clockEvent.type === 'continue') {
          setLastEvent('MIDI Clock: Continue');
          if (
            state.clockSyncEnabled &&
            state.presetSequence.length > 0 &&
            !state.presetSequence.some((item) => item.id === state.activeSequenceItemId)
          ) {
            state.onLoadSequenceItem(state.presetSequence[0].id);
          }
          return;
        }
        if (clockEvent.type === 'stop') {
          setLastEvent('MIDI Clock: Stop');
          if (state.clockSyncEnabled && state.isSequencePlaying) {
            state.onStopSequencePlayback();
          }
          return;
        }
        // tick: step the sequence on each division boundary.
        if (clockEvent.boundary && state.clockSyncEnabled) {
          advanceSequenceStep();
        }
        return;
      }

      if (data.length < 3) return;
      const messageType = status & 0xf0;
      const channel = status & 0x0f;

      if (messageType === 0x90) {
        // Note On. Velocity 0 is a Note Off in running-status form and
        // must never bind or trigger; Note Off (0x80) is ignored too.
        const note = data[1];
        const velocity = data[2];
        if (velocity === 0) return;
        // Modulation envelopes (Phase AC): every genuine note-on
        // fires the MIDI-triggered envelope sources. The clock is
        // the same performance.now()/1000 the modulation engine
        // evaluates against.
        noteModulationMidiTrigger(performance.now() / 1000);
        setLastEvent(`CH${channel + 1} Note ${note} (${describeMidiNote(note)}) vel ${velocity}`);
        // Phase 21 stage 2: event rules with a midi-note trigger
        // fire on every genuine note-on (a learn capture below
        // consumes its note instead). The live performer is the
        // audio controller's synth; with audio off nothing sounds.
        if (!learnNoteActionRef.current) {
          fireEventRulesLive({ type: 'midi-note', note }, { note, velocity: velocity / 127, vel: velocity / 127 });
        }
        const learnAction = learnNoteActionRef.current;
        if (learnAction) {
          learnNoteActionRef.current = null;
          setLearningNote(false);
          setNoteAssignments((prev) => {
            const next = [
              ...prev.filter((entry) => !(entry.note === note && entry.channel === channel)),
              { channel, note, action: learnAction },
            ];
            saveMidiNoteAssignments(window.localStorage, next);
            return next;
          });
          return;
        }
        const noteAssignment = resolveNoteAssignment(noteAssignmentsRef.current, channel, note);
        if (noteAssignment) fireNoteAction(noteAssignment.action);
        return;
      }

      if (messageType !== 0xb0) return; // below: Control Change only
      const cc = data[1];
      const value = data[2];
      setLastEvent(`CH${channel + 1} CC${cc} = ${value}`);
      const learnTarget = learnTargetRef.current;
      if (learnTarget) {
        learnTargetRef.current = null;
        setLearning(false);
        setAssignments((prev) => {
          const next = [
            ...prev.filter((assignment) => !(assignment.cc === cc && assignment.channel === channel)),
            { channel, cc, target: learnTarget },
          ];
          saveMidiAssignments(window.localStorage, next);
          return next;
        });
        return;
      }
      const assignment = resolveAssignment(assignmentsRef.current, channel, cc);
      if (assignment) applyTarget(assignment.target, value);
    },
    [applyTarget, advanceSequenceStep, fireNoteAction],
  );

  const connect = async () => {
    setError('');
    try {
      const requestAccess = (
        navigator as unknown as { requestMIDIAccess: () => Promise<MidiAccessLike> }
      ).requestMIDIAccess.bind(navigator);
      const access = await requestAccess();
      accessRef.current = access;
      const attach = () => {
        const list: { id: string; name: string }[] = [];
        access.inputs.forEach((input: MidiInputLike) => {
          input.onmidimessage = handleMessage;
          list.push({ id: input.id, name: input.name ?? input.id });
        });
        setInputs(list);
        // Outputs ride along on the same access object (Phase 6.7):
        // enumerate them for the selector and keep the engine's port
        // resolved against the persisted selection.
        const outList: { id: string; name: string }[] = [];
        const ports = new Map<string, MidiOutputPortLike>();
        access.outputs.forEach((output: MidiOutputLike) => {
          outList.push({ id: output.id, name: output.name ?? output.id });
          ports.set(output.id, output);
        });
        outputPortsRef.current = ports;
        setOutputs(outList);
        const selectedId = outputSettingsRef.current.outputId;
        outputEngineRef.current?.setPort(selectedId ? (ports.get(selectedId) ?? null) : null);
      };
      attach();
      access.onstatechange = attach;
      setConnected(true);
    } catch {
      setError('MIDI へのアクセスが許可されませんでした。ブラウザの許可設定を確認してください。');
    }
  };

  React.useEffect(
    () => () => {
      accessRef.current?.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    },
    [],
  );

  const startLearning = () => {
    const [kind, rest] = targetValue.split(/:(.*)/).filter(Boolean);
    const target: MidiTarget | null =
      kind === 'macro'
        ? { kind: 'macro', id: rest }
        : kind === 'param'
          ? { kind: 'param', key: rest as keyof ParticleConfig }
          : null;
    if (!target) return;
    learnTargetRef.current = target;
    setLearning(true);
  };

  const removeAssignment = (index: number) => {
    setAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveMidiAssignments(window.localStorage, next);
      return next;
    });
  };

  const startNoteLearning = () => {
    learnNoteActionRef.current = noteActionValue;
    setLearningNote(true);
  };

  const removeNoteAssignment = (index: number) => {
    setNoteAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveMidiNoteAssignments(window.localStorage, next);
      return next;
    });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Piano size={12} />}>MIDI Control · MIDI入出力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        MIDIコントローラのノブやフェーダを、マクロやパラメータに割り当てて演奏できます。ノートへの操作割り当てと、外部クロック／Ableton Link とのシーケンス同期にも対応します。割り当てはこのブラウザに保存されます（プリセットには含まれません）。Playタブを開いている間だけ有効です。マクロの動き・シーケンスのステップ・プリセット切替をMIDI出力としてDAWなどへ送り返すこともできます（下部の MIDI Output）。
      </p>
      {!supported && (
        <p className="text-[11px] text-white/40">
          このブラウザは Web MIDI に対応していません（Chrome / Edge などで利用できます）。
        </p>
      )}
      {supported && !connected && (
        <button
          onClick={connect}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
        >
          MIDI機器に接続
        </button>
      )}
      {error && <p className="text-[11px] text-red-300/80 mt-2">{error}</p>}
      {connected && (
        <div className="space-y-3">
          <p className="text-[11px] text-white/55">
            接続中：{inputs.length === 0 ? '入力機器が見つかりません（接続すると自動で表示されます）' : inputs.map((input) => input.name).join('、')}
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)} className={selectClass}>
              <optgroup label="マクロ">
                {MACRO_DEFINITIONS.map((macro) => (
                  <option key={macro.id} value={`macro:${macro.id}`} className="bg-neutral-900">
                    {macro.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="パラメータ">
                {PARAMETER_CATALOG.map((entry) => (
                  <option key={`${entry.tab}:${entry.key}`} value={`param:${entry.key}`} className="bg-neutral-900">
                    {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={startLearning}
              disabled={learning || isPublicLibrary}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40 ${
                learning ? 'bg-amber-200 text-black' : 'bg-white text-black hover:bg-gray-200'
              }`}
            >
              {learning ? 'ノブを動かしてください…' : 'Learn · 学習'}
            </button>
          </div>
          {assignments.length > 0 && (
            <ul className="space-y-1.5">
              {assignments.map((assignment, index) => (
                <li
                  key={`${assignment.channel}:${assignment.cc}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]"
                >
                  <span>
                    <span className="font-mono text-white/60">
                      CH{assignment.channel === null ? '*' : assignment.channel + 1} CC{assignment.cc}
                    </span>{' '}
                    → {describeMidiTarget(assignment.target)}
                  </span>
                  <button
                    onClick={() => removeAssignment(index)}
                    className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-white/10 pt-3 space-y-3">
            <p className="text-[11px] font-semibold tracking-wide">
              Note Actions · ノート割り当て
            </p>
            <p className="text-[11px] leading-relaxed text-white/45">
              鍵盤やパッドのノートに、プリセット送りやシーケンス操作を割り当てます（Note On のみ反応し、離鍵では発火しません）。
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={noteActionValue}
                onChange={(event) => setNoteActionValue(event.target.value as MidiNoteAction)}
                className={selectClass}
              >
                {MIDI_NOTE_ACTIONS.map((entry) => (
                  <option key={entry.id} value={entry.id} className="bg-neutral-900">
                    {entry.label}
                  </option>
                ))}
              </select>
              <button
                onClick={startNoteLearning}
                disabled={learningNote || isPublicLibrary}
                className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40 ${
                  learningNote ? 'bg-amber-200 text-black' : 'bg-white text-black hover:bg-gray-200'
                }`}
              >
                {learningNote ? 'キーを押してください…' : 'Learn · 学習'}
              </button>
            </div>
            {noteAssignments.length > 0 && (
              <ul className="space-y-1.5">
                {noteAssignments.map((entry, index) => (
                  <li
                    key={`${entry.channel}:${entry.note}:${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]"
                  >
                    <span>
                      <span className="font-mono text-white/60">
                        CH{entry.channel === null ? '*' : entry.channel + 1} Note {entry.note} ({describeMidiNote(entry.note)})
                      </span>{' '}
                      → {describeMidiNoteAction(entry.action)}
                    </span>
                    <button
                      onClick={() => removeNoteAssignment(index)}
                      className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-white/10 pt-3 space-y-3">
            <p className="text-[11px] font-semibold tracking-wide">
              Sequence Sync · シーケンス同期
            </p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="同期ソース">
              {SEQUENCE_SYNC_SOURCES.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setSyncPref({ source: entry.id })}
                  aria-pressed={clockPrefs.source === entry.id}
                  className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                    clockPrefs.source === entry.id
                      ? 'bg-white text-black'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
              <select
                value={clockPrefs.division}
                onChange={(event) => setSyncPref({ division: event.target.value as MidiClockDivision })}
                className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
                aria-label="同期の単位"
              >
                {MIDI_CLOCK_DIVISIONS.map((entry) => (
                  <option key={entry.id} value={entry.id} className="bg-neutral-900">
                    {entry.label}ごとに進める
                  </option>
                ))}
              </select>
            </div>
            {clockPrefs.source === 'midi-clock' && (
              <>
                <p className="font-mono text-[10px] text-white/50">
                  {clockSnapshot.hasClock
                    ? `clock: ${clockSnapshot.running ? 'running' : 'stopped'} · BPM ${
                        clockSnapshot.bpm !== null ? clockSnapshot.bpm.toFixed(1) : '—'
                      } · tick ${clockSnapshot.tickCount}`
                    : 'clock: 未受信（DAWやシーケンサーからクロックを送ると表示されます）'}
                </p>
                <p className="text-[11px] leading-relaxed text-white/45">
                  外部クロックの Start でシーケンスを先頭から始め、選択した単位の境界ごとに1ステップ進めます。ステップ送りはシーケンス項目のクリックと同じ経路（即時切り替え）を使うため、内蔵タイマーとの二重送りは起きません。Stop で再生を止めます。
                </p>
              </>
            )}
            {clockPrefs.source === 'link' && (
              <>
                <p className="font-mono text-[10px] text-white/50">
                  {!linkSnapshot.connected
                    ? 'Link: ブリッジ未接続（自動で再接続を試みています）'
                    : !linkSnapshot.available
                      ? `Link: ブリッジは応答中ですが Link を利用できません${linkSnapshot.reason ? `（${linkSnapshot.reason}）` : ''}`
                      : `Link: ${linkSnapshot.isPlaying ? 'playing' : 'stopped'} · BPM ${
                          linkSnapshot.bpm !== null ? linkSnapshot.bpm.toFixed(1) : '—'
                        } · peers ${linkSnapshot.numPeers !== null ? linkSnapshot.numPeers : '—'}`}
                </p>
                <p className="text-[11px] leading-relaxed text-white/45">
                  Ableton Link のセッションに同期します。ブリッジの起動が初回のみ必要です：
                  tools/link-bridge で <span className="font-mono">npm install</span>（初回だけ）、
                  以後は <span className="font-mono">node tools/link-bridge/link-bridge.mjs</span>。
                  セッションの再生開始でシーケンスを始め、選択した単位の境界ごとに1ステップ進め、停止で再生も止めます（MIDI
                  Clock と同じ送り経路）。ブリッジが切断されると送りは止まります — 内蔵タイマーが勝手に引き継ぐことはありません。
                </p>
              </>
            )}
            {clockPrefs.source === 'off' && (
              <p className="text-[11px] leading-relaxed text-white/45">
                外部同期はオフです。MIDI Clock（DAWやシーケンサーのクロック）か Ableton Link（ローカルブリッジ経由）を選ぶと、シーケンスを外部テンポに同期できます。
              </p>
            )}
          </div>
          <div className="border-t border-white/10 pt-3 space-y-3">
            <p className="text-[11px] font-semibold tracking-wide">
              MIDI Output · MIDI出力
            </p>
            <p className="text-[11px] leading-relaxed text-white/45">
              演奏の動きをMIDIで送り返します。マクロの位置は CC（基準CC＋マクロ番号、約30msに間引き）で、シーケンスが次の項目へ進むたびステップノートのパルスを、プリセットを読み込むたび棚順のプログラムチェンジを送ります。モーターフェーダーの追従や、DAW側の音色切替との連動に使えます。設定はこのブラウザに保存されます。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  applyOutputSettings({ ...outputSettings, enabled: !outputSettings.enabled })
                }
                aria-pressed={outputSettings.enabled}
                className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  outputSettings.enabled
                    ? 'bg-white text-black hover:bg-gray-200'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {outputSettings.enabled ? '出力 ON' : '出力 OFF'}
              </button>
              <select
                value={outputSettings.outputId ?? ''}
                onChange={(event) =>
                  applyOutputSettings({
                    ...outputSettings,
                    outputId: event.target.value === '' ? null : event.target.value,
                  })
                }
                className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
                aria-label="MIDI出力デバイス"
              >
                <option value="" className="bg-neutral-900">
                  出力先を選択…
                </option>
                {outputs.map((output) => (
                  <option key={output.id} value={output.id} className="bg-neutral-900">
                    {output.name}
                  </option>
                ))}
              </select>
            </div>
            {outputs.length === 0 && (
              <p className="text-[11px] text-white/40">
                出力機器が見つかりません（仮想MIDIポートやDAWを起動すると表示されます）。
              </p>
            )}
            {outputSettings.outputId !== null &&
              !outputs.some((output) => output.id === outputSettings.outputId) && (
                <p className="text-[11px] text-white/40">
                  選択中の出力機器が接続されていません（接続すると自動で再開します）。
                </p>
              )}
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">Channel</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={outputSettings.channel + 1}
                  onChange={(event) =>
                    applyOutputSettings({
                      ...outputSettings,
                      channel: Math.min(15, Math.max(0, (Number(event.target.value) || 1) - 1)),
                    })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">基準CC (＋0〜7)</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={outputSettings.baseCc}
                  onChange={(event) =>
                    applyOutputSettings({
                      ...outputSettings,
                      baseCc: Math.min(120, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">ステップノート</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={outputSettings.stepNote}
                  onChange={(event) =>
                    applyOutputSettings({
                      ...outputSettings,
                      stepNote: Math.min(127, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
                />
              </label>
            </div>
            <p className="font-mono text-[10px] text-white/50">
              {outputSettings.enabled
                ? outputSettings.outputId === null
                  ? 'output: 出力先が未選択です'
                  : `output: CH${outputSettings.channel + 1} · CC ${outputSettings.baseCc}–${outputSettings.baseCc + 7} (macros) · Note ${outputSettings.stepNote} (${describeMidiNote(outputSettings.stepNote)}) step · Program Change = プリセット棚順`
                : 'output: OFF'}
            </p>
          </div>
          {lastEvent && <p className="font-mono text-[10px] text-white/35">last: {lastEvent}</p>}
          {isPublicLibrary && <p className="text-[11px] text-white/35">公開ビルドでは割り当てを適用できません。</p>}
        </div>
      )}
    </section>
  );
};

export const OscSection: React.FC<{
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [bridgeUrl, setBridgeUrl] = React.useState(DEFAULT_OSC_BRIDGE_URL);
  const [connected, setConnected] = React.useState(false);
  const [assignments, setAssignments] = React.useState<OscAssignment[]>(() =>
    loadOscAssignments(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [targetValue, setTargetValue] = React.useState('macro:density');
  const [learning, setLearning] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState('');
  const [error, setError] = React.useState('');

  const assignmentsRef = React.useRef(assignments);
  assignmentsRef.current = assignments;
  const learnTargetRef = React.useRef<OscTarget | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);

  const applyTarget = React.useCallback(
    (target: OscTarget, rawValue: number) => {
      const ratio = oscValueToRatio(rawValue);
      if (target.kind === 'macro') {
        const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
        if (!definition) return;
        getMacroUpdates(definition, ratio).forEach(({ key, value: next }) => write(key, next));
        return;
      }
      const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
      if (!entry) return;
      const scaled = scaleOscValue(ratio, entry.min, entry.max);
      const stepped = Math.round(scaled / entry.step) * entry.step;
      write(entry.key, Number(stepped.toFixed(6)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMessage = React.useCallback(
    (address: string, args: unknown[]) => {
      const numeric = args.find((arg): arg is number => typeof arg === 'number');
      setLastEvent(numeric !== undefined ? `${address} = ${numeric}` : `${address} (${args.length} args)`);
      const learnTarget = learnTargetRef.current;
      if (learnTarget) {
        learnTargetRef.current = null;
        setLearning(false);
        if (isValidOscAddress(address)) {
          setAssignments((prev) => {
            const next = [...prev.filter((assignment) => assignment.address !== address), { address, target: learnTarget }];
            saveOscAssignments(window.localStorage, next);
            return next;
          });
        }
        return;
      }
      if (numeric === undefined) return;
      const assignment = resolveOscAssignment(assignmentsRef.current, address);
      if (assignment) applyTarget(assignment.target, numeric);
    },
    [applyTarget],
  );

  const handleMessageRef = React.useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const connect = () => {
    setError('');
    let socket: WebSocket;
    try {
      socket = new WebSocket(bridgeUrl);
    } catch {
      setError('ブリッジのアドレスが不正です。');
      return;
    }
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      setConnected(false);
    };
    socket.onerror = () => {
      setError('ブリッジに接続できませんでした。先に node tools/osc-bridge/osc-bridge.mjs を起動してください。');
    };
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { type?: string; address?: string; args?: unknown[] };
        if (parsed.type === 'osc' && typeof parsed.address === 'string') {
          handleMessageRef.current(parsed.address, Array.isArray(parsed.args) ? parsed.args : []);
        }
      } catch {
        // Non-JSON frames from the bridge are ignored.
      }
    };
  };

  const disconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  };

  React.useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  const startLearning = () => {
    const [kind, rest] = targetValue.split(/:(.*)/).filter(Boolean);
    const target: OscTarget | null =
      kind === 'macro'
        ? { kind: 'macro', id: rest }
        : kind === 'param'
          ? { kind: 'param', key: rest as keyof ParticleConfig }
          : null;
    if (!target) return;
    learnTargetRef.current = target;
    setLearning(true);
  };

  const removeAssignment = (index: number) => {
    setAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveOscAssignments(window.localStorage, next);
      return next;
    });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Radio size={12} />}>OSC Control · OSC入力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        TouchOSC等のOSCコントローラから、マクロやパラメータを操作できます。ブラウザはOSC（UDP）を直接扱えないため、PC上で小さなブリッジ（node
        tools/osc-bridge/osc-bridge.mjs）を起動し、そこへ接続します。割り当てはこのブラウザに保存されます（プリセットには含まれません）。Playタブを開いている間だけ有効です。値は最初の引数を使い、0..1はそのまま、大きい値は0..127スケールとして読みます。
      </p>
      {!connected && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              value={bridgeUrl}
              onChange={(event) => setBridgeUrl(event.target.value)}
              className={selectClass}
              aria-label="OSCブリッジのWebSocketアドレス"
            />
            <button
              onClick={connect}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
            >
              ブリッジに接続
            </button>
          </div>
          {error && <p className="text-[11px] text-red-300/80">{error}</p>}
        </div>
      )}
      {connected && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/55">接続中：{bridgeUrl}（OSC受信ポートはブリッジ側の設定）</p>
            <button
              onClick={disconnect}
              className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
            >
              切断
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)} className={selectClass}>
              <optgroup label="マクロ">
                {MACRO_DEFINITIONS.map((macro) => (
                  <option key={macro.id} value={`macro:${macro.id}`} className="bg-neutral-900">
                    {macro.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="パラメータ">
                {PARAMETER_CATALOG.map((entry) => (
                  <option key={`${entry.tab}:${entry.key}`} value={`param:${entry.key}`} className="bg-neutral-900">
                    {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={startLearning}
              disabled={learning || isPublicLibrary}
              className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40 ${
                learning ? 'bg-amber-200 text-black' : 'bg-white text-black hover:bg-gray-200'
              }`}
            >
              {learning ? 'OSCを送ってください…' : 'Learn · 学習'}
            </button>
          </div>
          {assignments.length > 0 && (
            <ul className="space-y-1.5">
              {assignments.map((assignment, index) => (
                <li
                  key={`${assignment.address}:${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]"
                >
                  <span>
                    <span className="font-mono text-white/60">{assignment.address}</span> → {describeOscTarget(assignment.target)}
                  </span>
                  <button
                    onClick={() => removeAssignment(index)}
                    className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lastEvent && <p className="font-mono text-[10px] text-white/35">last: {lastEvent}</p>}
          {isPublicLibrary && <p className="text-[11px] text-white/35">公開ビルドでは割り当てを適用できません。</p>}
        </div>
      )}
    </section>
  );
};

