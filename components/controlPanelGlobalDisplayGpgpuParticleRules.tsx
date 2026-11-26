import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import {
  PARTICLE_RULES_MAX_RULES,
  createParticleRule,
  parseParticleRules,
  particleRuleConditionVariables,
  serializeParticleRules,
  validateParticleRule,
  type ParticleRule,
  type ParticleRuleAction,
  type ParticleRuleForceTarget,
  type ParticleRuleTarget,
} from '../lib/gpgpuParticleRules';
import { parseGpgpuGroups } from '../lib/gpgpuGroups';
import { normalizeAttrNames, normalizeAttrNames2 } from '../lib/gpgpuAttributes';
import { compileExpression } from '../lib/expression';

/**
 * Particle Rules editor (G10 stage 2): the row-list authoring
 * surface for the "condition -> application" grammar whose model
 * and baked evaluator live in lib/gpgpuParticleRules.ts (stage 1).
 *
 * The shape mirrors the Event Rules editor (one card per rule,
 * inline condition errors, add/remove, cap on the add button);
 * the persistence mirrors the named-groups editor instead:
 * every edit round-trips through the lib's parser/serializer
 * into the serialised config key `gpgpuParticleRules`, so the
 * stored form always stays valid and a preset/link carries the
 * rules with the rest of the scene. Broken rows never block the
 * others: a rule whose condition does not compile is kept, shown
 * with its error, and simply never matches (evaluator discipline,
 * design 2.3). Row order matters only for colour (last match
 * wins), hence the plain up/down buttons.
 */

const FORCE_OPTIONS: { label: string; val: ParticleRuleForceTarget }[] = [
  { label: '全フォース', val: 'all' },
  { label: '重力 gravity', val: 'gravity' },
  { label: '乱流 turbulence', val: 'turbulence' },
  { label: 'カール curl', val: 'curl' },
  { label: '風 wind', val: 'wind' },
  { label: 'モーフ morph', val: 'morph' },
];

const MODE_OPTIONS = [
  { label: '以上（low 以上）', val: 'above' },
  { label: '未満（low 未満）', val: 'below' },
  { label: '範囲（low〜high）', val: 'band' },
];

const rgbToHex = (color: [number, number, number]): string =>
  '#' + color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const RuleSelect: React.FC<{
  value: string;
  options: { label: string; val: string }[];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
  >
    {options.map((option) => (
      <option key={option.val} value={option.val}>{option.label}</option>
    ))}
  </select>
);

/** Decimal field with a local draft: typing "0.85" must not be
 *  fought by the controlled value snapping back to "0" mid-type.
 *  Only finite parses commit (clamped to 0..1, the predicate
 *  range); the draft resyncs from the value on blur. */
const RuleNumField: React.FC<{
  value: number;
  onCommit: (value: number) => void;
}> = ({ value, onCommit }) => {
  const [text, setText] = React.useState(() => String(value));
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className="w-16 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40"
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(String(value)); }}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(parsed)) {
          onCommit(Math.min(1, Math.max(0, parsed)));
        }
      }}
    />
  );
};

export const GlobalDisplayGpgpuParticleRulesSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => {
  const names = normalizeAttrNames(config.gpgpuAttrNames);
  const names2 = normalizeAttrNames2(config.gpgpuAttrNames2);
  const groupDefs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
  const stored = config.gpgpuParticleRules ?? '';

  const [rules, setRules] = React.useState<ParticleRule[]>(() => parseParticleRules(stored));
  const [note, setNote] = React.useState('');
  const lastWritten = React.useRef<string | null>(null);

  // Resync when the stored string changes from outside this
  // editor (preset load, scene link): anything that is not the
  // exact string this editor last wrote itself.
  React.useEffect(() => {
    if (lastWritten.current !== null && stored === lastWritten.current) return;
    setRules(parseParticleRules(stored));
  }, [stored]);

  const commit = React.useCallback((next: ParticleRule[]) => {
    setRules(next);
    const text = serializeParticleRules(next);
    if (next.length > 0 && text === '') {
      // Over the character cap: keep the on-screen edit, refuse
      // the save, say so (the named-groups precedent).
      setNote('ルールの保存容量上限を超えるため保存できませんでした。');
      return;
    }
    setNote('');
    lastWritten.current = text;
    updateConfig('gpgpuParticleRules', text);
  }, [updateConfig]);

  const patchRule = (id: string, patch: Partial<ParticleRule>) => {
    commit(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };
  const patchTarget = (id: string, target: ParticleRuleTarget) => patchRule(id, { target });
  const patchAction = (id: string, action: ParticleRuleAction) => patchRule(id, { action });
  const moveRule = (index: number, delta: number) => {
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    commit(next);
  };

  const switchTarget = (rule: ParticleRule, type: string) => {
    if (type === 'all') patchTarget(rule.id, { type: 'all' });
    else if (type === 'predicate') {
      patchTarget(rule.id, { type: 'predicate', slot: 0, mode: 'above', low: 0.5, high: 1, invert: false });
    } else {
      patchTarget(rule.id, { type: 'group', id: groupDefs[0]?.id ?? '' });
    }
  };
  const switchAction = (rule: ParticleRule, type: string) => {
    if (type === 'force-gate') {
      patchAction(rule.id, {
        type: 'force-gate',
        force: rule.action.type === 'force-gate' ? rule.action.force : 'all',
      });
    } else if (type === 'kill') patchAction(rule.id, { type: 'kill' });
    else patchAction(rule.id, { type: 'color', color: [1, 0.3, 0.1] });
  };

  const conditionError = (rule: ParticleRule): string | null => {
    if (!rule.condition.trim()) return null;
    const compiled = compileExpression(rule.condition, particleRuleConditionVariables(names, names2));
    return compiled.ok ? null : '条件式が解釈できません（保存してもこのルールは一致しません）';
  };

  const slotOptions = names.map((name, i) => ({ label: `Slot ${i + 1}（${name}）`, val: String(i) }));
  const groupOptions = groupDefs.map((def) => ({ label: def.name || def.id, val: def.id }));
  const inputCls = 'rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40';

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="text-[9px] uppercase tracking-widest opacity-60">
        Particle Rules — 条件→適用ルール（G10）
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/50">
        「対象＋条件式 → 適用」を1行1ルールで組み立てる汎用文法です。評価は属性ベイクの時点（初期状態）で行われ、
        条件で使えるのは属性スロットの値と名前、vel（初速の大きさ）・age・rad（初期位置）、g（対象の所属 0/1）です。
        フォース許可は「そのフォースのルールが1件でもあれば、一致した粒子だけに効く」という意味で、kill は一致した粒子を
        リスポーンさせ、色は最後に一致したルールが勝ちます（順序は ▲▼ で変更）。ルールが無いときは従来動作のままです。
      </p>
      <div className="mt-3">
        {rules.map((rule, index) => {
          const error = conditionError(rule);
          const structurallyValid = validateParticleRule(rule) !== null;
          const targetGroupId = rule.target.type === 'group' ? rule.target.id : null;
          const danglingGroup =
            targetGroupId !== null && targetGroupId !== '' && !groupDefs.some((d) => d.id === targetGroupId);
          return (
            <div key={rule.id} className="mb-3 rounded-lg border border-white/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-white/80">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })}
                  />
                  有効
                </label>
                <input
                  type="text"
                  className={`${inputCls} w-40`}
                  placeholder="名前（任意）"
                  value={rule.name ?? ''}
                  onChange={(e) => patchRule(rule.id, { name: e.target.value })}
                />
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    className="px-1 text-[11px] text-white/60 hover:text-white disabled:opacity-30"
                    onClick={() => moveRule(index, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={index === rules.length - 1}
                    className="px-1 text-[11px] text-white/60 hover:text-white disabled:opacity-30"
                    onClick={() => moveRule(index, 1)}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-white/60 hover:text-white"
                    onClick={() => commit(rules.filter((r) => r.id !== rule.id))}
                  >
                    削除
                  </button>
                </span>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/50">対象</span>
                <RuleSelect
                  value={rule.target.type}
                  options={[
                    { label: '全ての粒子', val: 'all' },
                    { label: '属性の条件（述語）', val: 'predicate' },
                    { label: '名前付きグループ', val: 'group' },
                  ]}
                  onChange={(v) => switchTarget(rule, v)}
                />
                {rule.target.type === 'predicate' && (
                  <>
                    <RuleSelect
                      value={String(rule.target.slot)}
                      options={slotOptions}
                      onChange={(v) =>
                        patchTarget(rule.id, { ...(rule.target as Extract<ParticleRuleTarget, { type: 'predicate' }>), slot: Number(v) })
                      }
                    />
                    <RuleSelect
                      value={rule.target.mode}
                      options={MODE_OPTIONS}
                      onChange={(v) =>
                        patchTarget(rule.id, {
                          ...(rule.target as Extract<ParticleRuleTarget, { type: 'predicate' }>),
                          mode: v as 'above' | 'below' | 'band',
                        })
                      }
                    />
                    <label className="flex items-center gap-1 text-[11px] text-white/70">
                      low
                      <RuleNumField
                        value={rule.target.low}
                        onCommit={(v) =>
                          patchTarget(rule.id, { ...(rule.target as Extract<ParticleRuleTarget, { type: 'predicate' }>), low: v })
                        }
                      />
                    </label>
                    {rule.target.mode === 'band' && (
                      <label className="flex items-center gap-1 text-[11px] text-white/70">
                        high
                        <RuleNumField
                          value={rule.target.high}
                          onCommit={(v) =>
                            patchTarget(rule.id, { ...(rule.target as Extract<ParticleRuleTarget, { type: 'predicate' }>), high: v })
                          }
                        />
                      </label>
                    )}
                    <label className="flex items-center gap-1 text-[11px] text-white/80">
                      <input
                        type="checkbox"
                        checked={rule.target.invert}
                        onChange={(e) =>
                          patchTarget(rule.id, {
                            ...(rule.target as Extract<ParticleRuleTarget, { type: 'predicate' }>),
                            invert: e.target.checked,
                          })
                        }
                      />
                      反転
                    </label>
                  </>
                )}
                {rule.target.type === 'group' && (
                  <>
                    {groupDefs.length > 0 ? (
                      <RuleSelect
                        value={rule.target.id}
                        options={groupOptions}
                        onChange={(v) => patchTarget(rule.id, { type: 'group', id: v })}
                      />
                    ) : (
                      <span className="text-[11px] text-amber-200/80">
                        名前付きグループが未定義です（Attributes の Named Groups で作成してください）
                      </span>
                    )}
                  </>
                )}
              </div>
              {danglingGroup && (
                <p className="mb-2 text-[11px] text-red-300">
                  参照しているグループが見つかりません（このルールは一致しません）。
                </p>
              )}

              <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">
                条件式（空欄 = 無条件）
              </label>
              <input
                type="text"
                className={`${inputCls} w-full`}
                placeholder="例: (slot1 > 0.8) * (vel < 0.2)"
                value={rule.condition}
                onChange={(e) => patchRule(rule.id, { condition: e.target.value })}
              />
              {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
              {!error && !structurallyValid && (
                <p className="mt-1 text-[11px] text-red-300">このルールは検証を通らないため適用されません。</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/50">適用</span>
                <RuleSelect
                  value={rule.action.type}
                  options={[
                    { label: 'フォースを許可', val: 'force-gate' },
                    { label: '消す（リスポーン）', val: 'kill' },
                    { label: '色を付ける', val: 'color' },
                  ]}
                  onChange={(v) => switchAction(rule, v)}
                />
                {rule.action.type === 'force-gate' && (
                  <RuleSelect
                    value={rule.action.force}
                    options={FORCE_OPTIONS}
                    onChange={(v) => patchAction(rule.id, { type: 'force-gate', force: v as ParticleRuleForceTarget })}
                  />
                )}
                {rule.action.type === 'color' && (
                  <label className="flex items-center gap-2 text-[11px] text-white/70">
                    <input
                      type="color"
                      value={rgbToHex(rule.action.color)}
                      onChange={(e) => patchAction(rule.id, { type: 'color', color: hexToRgb(e.target.value) })}
                    />
                    {rgbToHex(rule.action.color)}
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={rules.length >= PARTICLE_RULES_MAX_RULES}
        className="rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-gray-200 disabled:opacity-40"
        onClick={() => commit([...rules, createParticleRule()])}
      >
        ルールを追加
      </button>
      {note && <p className="mt-2 text-[11px] text-amber-200/80">{note}</p>}
      <p className="mt-2 text-[9px] leading-relaxed text-white/40">
        ルールはシーンの一部として保存されます（設定キー gpgpuParticleRules）。WebGPU 実行時はルールのある設定は
        WebGL へ自動で切り替わります。
      </p>
    </div>
  );
};
