import React from 'react';
import { Zap } from 'lucide-react';
import {
  EVENT_RULE_EVENT_TYPES,
  EVENT_RULE_VARIABLES,
  EVENT_RULES_MAX_RULES,
  createEventRule,
  loadEventRules,
  saveEventRules,
  validateEventRule,
  type EventRule,
  type EventRuleEventType,
  type SynthNoteAction,
} from '../lib/eventRules';
import { compileExpression } from '../lib/expression';
import { SectionTitle } from './controlPanelPlayTabShared';

/**
 * Event Rules editor (Phase 21 stage 2).
 *
 * Until this stage the rule model in lib/eventRules.ts could only
 * be fed by hand-written localStorage JSON: there was no editor,
 * and two of its four event types were never fired. This section is
 * the editor: rules persist through saveEventRules under the same
 * storage key the evaluators already read, so an edit takes effect
 * on the next event with no other wiring. With zero rules the
 * section is inert and every evaluator keeps its legacy behaviour.
 *
 * Editing discipline mirrors the model: a rule whose condition does
 * not compile is shown with its error and is dropped by validation
 * on save (it simply never fires), never blocking the other rules.
 */
export const EventRulesSection: React.FC<{ isPublicLibrary: boolean }> = ({ isPublicLibrary }) => {
  const [rules, setRules] = React.useState<EventRule[]>(() =>
    loadEventRules(typeof window !== 'undefined' ? window.localStorage : undefined),
  );

  const commit = React.useCallback((next: EventRule[]) => {
    setRules(next);
    saveEventRules(typeof window !== 'undefined' ? window.localStorage : undefined, next);
  }, []);

  const patchRule = (id: string, patch: Partial<EventRule>) => {
    commit(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const patchAction = (id: string, patch: Partial<SynthNoteAction>) => {
    commit(rules.map((rule) => {
      if (rule.id !== id) return rule;
      const first: SynthNoteAction = { ...(rule.actions[0] ?? { type: 'synth-note' }), ...patch, type: 'synth-note' };
      return { ...rule, actions: [first, ...rule.actions.slice(1)] };
    }));
  };

  const conditionError = (rule: EventRule): string | null => {
    if (!rule.condition) return null;
    const compiled = compileExpression(rule.condition, EVENT_RULE_VARIABLES);
    return compiled.ok ? null : '条件式が解釈できません（保存してもこのルールは発火しません）';
  };

  const inputCls = 'bg-white/10 rounded px-2 py-1 text-[11px] text-white/90 w-full';
  const labelCls = 'block text-[10px] uppercase tracking-wider text-white/50 mb-1';

  return (
    <section>
      <SectionTitle icon={<Zap size={12} />}>Event Rules · イベントルール</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/50 mb-3">
        「出来事 → 条件式 → シンセの音」というルールを編集します。出来事は5種: beat（拍ごと）/
        pattern-boundary（パターンの頭）/ midi-note（MIDIの音が来たとき）/
        predicate（条件式が成り立った瞬間だけ）/ rigid-contact（剛体が新しくぶつかったとき、
        vel に衝撃の大きさが入ります）。条件式で使える変数は{' '}
        {EVENT_RULE_VARIABLES.join(', ')} と x, t です。空欄なら無条件で発火します。
        音はオーディオが有効なときだけ鳴ります。
      </p>
      {rules.map((rule) => {
        const action = rule.actions[0] ?? { type: 'synth-note' as const };
        const error = conditionError(rule);
        const valid = validateEventRule(rule) !== null;
        return (
          <div key={rule.id} className="mb-3 rounded-lg border border-white/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-1 text-[11px] text-white/80">
                <input
                  type="checkbox"
                  checked={rule.enabled !== false}
                  onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })}
                />
                有効
              </label>
              <select
                className="bg-white/10 rounded px-2 py-1 text-[11px] text-white/90"
                value={rule.event}
                onChange={(e) => patchRule(rule.id, { event: e.target.value as EventRuleEventType })}
              >
                {EVENT_RULE_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {rule.event === 'midi-note' && (
                <label className="flex items-center gap-1 text-[11px] text-white/70">
                  音番号
                  <input
                    type="number"
                    min={0}
                    max={127}
                    placeholder="全て"
                    className="bg-white/10 rounded px-2 py-1 text-[11px] text-white/90 w-16"
                    value={rule.note ?? ''}
                    onChange={(e) => patchRule(rule.id, { note: e.target.value === '' ? undefined : Math.max(0, Math.min(127, Number(e.target.value))) })}
                  />
                </label>
              )}
              <button
                type="button"
                className="ml-auto text-[11px] text-white/60 hover:text-white"
                onClick={() => commit(rules.filter((r) => r.id !== rule.id))}
              >
                削除
              </button>
            </div>
            <label className={labelCls}>条件式（空欄 = 無条件）</label>
            <input
              type="text"
              className={inputCls}
              placeholder="例: velocity > 0.5"
              value={rule.condition ?? ''}
              onChange={(e) => patchRule(rule.id, { condition: e.target.value === '' ? undefined : e.target.value })}
            />
            {error && <p className="text-[11px] text-red-300 mt-1">{error}</p>}
            {!error && !valid && <p className="text-[11px] text-red-300 mt-1">このルールは検証を通らないため発火しません。</p>}
            <div className="grid grid-cols-4 gap-2 mt-2">
              <div>
                <label className={labelCls}>鳴らす音 (0-127)</label>
                <input
                  type="number"
                  min={0}
                  max={127}
                  placeholder="基準音"
                  className={inputCls}
                  value={action.note ?? ''}
                  onChange={(e) => patchAction(rule.id, { note: e.target.value === '' ? undefined : Math.max(0, Math.min(127, Number(e.target.value))) })}
                />
              </div>
              <div>
                <label className={labelCls}>半音ずらし</label>
                <input
                  type="number"
                  className={inputCls}
                  value={action.semitoneOffset ?? ''}
                  placeholder="0"
                  onChange={(e) => patchAction(rule.id, { semitoneOffset: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className={labelCls}>長さ (秒)</label>
                <input
                  type="number"
                  min={0.05}
                  max={2}
                  step={0.01}
                  className={inputCls}
                  value={action.durationSec ?? ''}
                  placeholder="0.28"
                  onChange={(e) => patchAction(rule.id, { durationSec: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className={labelCls}>強さ (0-1)</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className={inputCls}
                  value={action.gain ?? ''}
                  placeholder="1"
                  onChange={(e) => patchAction(rule.id, { gain: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        disabled={isPublicLibrary || rules.length >= EVENT_RULES_MAX_RULES}
        className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
        onClick={() => commit([...rules, createEventRule('midi-note')])}
      >
        ルールを追加
      </button>
      {isPublicLibrary && (
        <p className="text-[11px] text-white/50 mt-2">公開ビルドではルールの編集はロックされています。</p>
      )}
    </section>
  );
};
