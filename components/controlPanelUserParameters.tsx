import React from 'react';
import { Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { Slider, Toggle } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelTabsShared';
import {
  MAX_USER_PARAMETERS,
  USER_PARAMETER_TARGETS,
  addUserParameter,
  removeUserParameter,
  resolveUserParameterTarget,
  setUserParameters,
  updateUserParameter,
  useUserParameters,
  validateUserParameterValue,
  type UserParameterDeclaration,
} from '../lib/userParameters';
import { isSharedView, subscribeSharedView } from '../lib/shareLink';

/**
 * User Parameters (Phase AO): the declaration editor + public
 * surface. Users declare existing catalog keys as public
 * parameters (label / group / declared default); the declared
 * subset is what this surface — and the embed script API by name
 * — exposes. Declarations live in the userParameters store under
 * their own localStorage key; values read and write the target
 * keys through the normal config update path. With zero
 * declarations the section is just the (empty) declaration
 * editor: no surface, no writes.
 */
/**
 * Read-only public surface (Phase 18 stage 5): the generated
 * controls for the effective declarations — in shared / embed view
 * those are the declarations bundled with the link (session
 * overlay). No declaration editing (no add / remove / rename):
 * values change only, through the normal config update path and
 * the same validation the author surface uses. The Slider /
 * Toggle parts are shared with the author surface above.
 * Renders nothing when there are no declarations.
 */
export const UserParametersPublicSurface: React.FC<{
  config: ParticleConfig;
  updateConfig: UpdateConfig;
}> = ({ config, updateConfig }) => {
  const declarations = useUserParameters();
  if (declarations.length === 0) return null;

  const groups: { group: string; items: UserParameterDeclaration[] }[] = [];
  for (const declaration of declarations) {
    const bucket = groups.find((g) => g.group === declaration.group);
    if (bucket) bucket.items.push(declaration);
    else groups.push({ group: declaration.group, items: [declaration] });
  }

  const writeValue = (declaration: UserParameterDeclaration, value: unknown) => {
    const target = resolveUserParameterTarget(declaration.key as string);
    if (!target) return;
    const validated = validateUserParameterValue(target, value);
    if (validated === null) return;
    updateConfig(declaration.key, validated as ParticleConfig[typeof declaration.key]);
  };

  return (
    <div data-testid="user-parameters-public-surface" className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70">
        <SlidersHorizontal size={12} /> User Parameters
      </div>
      {groups.map(({ group, items }) => (
        <div key={group || '__ungrouped'} className="mb-3">
          {group && (
            <div className="mb-1 text-[9px] uppercase tracking-widest text-white/50">{group}</div>
          )}
          {items.map((declaration) => {
            const target = resolveUserParameterTarget(declaration.key as string);
            if (!target) return null;
            const current = config[declaration.key] as unknown;
            return (
              <div key={declaration.id} className="mb-2 rounded border border-white/10 bg-black/20 p-2">
                {target.kind === 'number' && (
                  <Slider
                    label={declaration.label}
                    value={typeof current === 'number' ? current : 0}
                    min={target.min ?? 0}
                    max={target.max ?? 1}
                    step={target.step ?? 0.01}
                    onChange={(v) => writeValue(declaration, v)}
                  />
                )}
                {target.kind === 'boolean' && (
                  <Toggle
                    label={declaration.label}
                    value={current === true}
                    options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                    onChange={(v) => writeValue(declaration, v)}
                  />
                )}
                {target.kind === 'enum' && (
                  <>
                    <div className="mb-1 text-[11px] text-white/80">{declaration.label}</div>
                    <select
                      value={typeof current === 'string' ? current : ''}
                      onChange={(e) => writeValue(declaration, e.target.value)}
                      className="mb-1 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
                      aria-label={declaration.label}
                    >
                      {(target.values ?? []).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => writeValue(declaration, declaration.defaultValue)}
                    className="flex items-center gap-1 rounded-full border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
                    title="宣言した既定値に戻す"
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                  <span className="text-[9px] text-white/35">{declaration.key}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export const UserParametersSection: React.FC<{
  config: ParticleConfig;
  isPublicLibrary: boolean;
  updateConfig: UpdateConfig;
}> = ({ config, isPublicLibrary, updateConfig }) => {
  // Phase 18 stage 5: in shared view the visitor gets the
  // read-only generated surface for the bundled declarations —
  // never the declaration editor.
  const [sharedView, setSharedView] = React.useState(isSharedView());
  React.useEffect(() => subscribeSharedView(() => setSharedView(isSharedView())), []);
  const declarations = useUserParameters();
  const [addKey, setAddKey] = React.useState<string>('');

  const declaredKeys = new Set(declarations.map((d) => d.key as string));
  const addable = USER_PARAMETER_TARGETS.filter((t) => !declaredKeys.has(t.key as string));

  // Groups in first-appearance order; '' renders without a heading.
  const groups: { group: string; items: UserParameterDeclaration[] }[] = [];
  for (const declaration of declarations) {
    const bucket = groups.find((g) => g.group === declaration.group);
    if (bucket) bucket.items.push(declaration);
    else groups.push({ group: declaration.group, items: [declaration] });
  }

  const writeValue = (declaration: UserParameterDeclaration, value: unknown) => {
    const target = resolveUserParameterTarget(declaration.key as string);
    if (!target) return;
    const validated = validateUserParameterValue(target, value);
    if (validated === null) return;
    updateConfig(declaration.key, validated as ParticleConfig[typeof declaration.key]);
  };

  // In shared view the visitor gets the read-only generated
  // surface for the bundled declarations — never the editor.
  if (sharedView) {
    return <UserParametersPublicSurface config={config} updateConfig={updateConfig} />;
  }

  return (
    <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70">
        <SlidersHorizontal size={12} /> User Parameters
      </div>
      <div className="mb-3 text-[9px] leading-relaxed text-white/40">
        公開パラメータの宣言です。既存のキーを名前・グループ・既定値つきで切り出すと、ここに公開面として並び、埋め込みスクリプト API からも名前で書けるようになります。宣言はこの端末にだけ保存されます（プロジェクトには含まれません）。
      </div>

      {declarations.length === 0 && (
        <div className="mb-3 text-[10px] text-white/50">宣言はまだありません。下でキーを選んで追加してください。</div>
      )}

      {groups.map(({ group, items }) => (
        <div key={group || '__ungrouped'} className="mb-3">
          {group && (
            <div className="mb-1 text-[9px] uppercase tracking-widest text-white/50">{group}</div>
          )}
          {items.map((declaration) => {
            const target = resolveUserParameterTarget(declaration.key as string);
            if (!target) return null;
            const current = config[declaration.key] as unknown;
            return (
              <div key={declaration.id} className="mb-2 rounded border border-white/10 bg-black/20 p-2">
                <div className="mb-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={declaration.label}
                    disabled={isPublicLibrary}
                    onChange={(e) => setUserParameters(updateUserParameter(declarations, declaration.id, { label: e.target.value }))}
                    className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40 disabled:opacity-40"
                    aria-label="Parameter label"
                  />
                  <input
                    type="text"
                    value={declaration.group}
                    disabled={isPublicLibrary}
                    placeholder="Group"
                    onChange={(e) => setUserParameters(updateUserParameter(declarations, declaration.id, { group: e.target.value }))}
                    className="w-24 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/90 outline-none focus:border-white/40 disabled:opacity-40"
                    aria-label="Parameter group"
                  />
                  {!isPublicLibrary && (
                    <button
                      type="button"
                      onClick={() => setUserParameters(removeUserParameter(declarations, declaration.id))}
                      className="rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                      title="宣言を削除"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {target.kind === 'number' && (
                  <Slider
                    label={target.catalogLabel}
                    value={typeof current === 'number' ? current : 0}
                    min={target.min ?? 0}
                    max={target.max ?? 1}
                    step={target.step ?? 0.01}
                    onChange={(v) => writeValue(declaration, v)}
                  />
                )}
                {target.kind === 'boolean' && (
                  <Toggle
                    label={target.catalogLabel}
                    value={current === true}
                    options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
                    onChange={(v) => writeValue(declaration, v)}
                  />
                )}
                {target.kind === 'enum' && (
                  <select
                    value={typeof current === 'string' ? current : ''}
                    onChange={(e) => writeValue(declaration, e.target.value)}
                    className="mb-1 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
                    aria-label={target.catalogLabel}
                  >
                    {(target.values ?? []).map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => writeValue(declaration, declaration.defaultValue)}
                    className="flex items-center gap-1 rounded-full border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
                    title="宣言した既定値に戻す"
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                  {!isPublicLibrary && (
                    <button
                      type="button"
                      onClick={() => {
                        const validated = validateUserParameterValue(target, current);
                        if (validated !== null) {
                          setUserParameters(updateUserParameter(declarations, declaration.id, { defaultValue: validated }));
                        }
                      }}
                      className="rounded-full border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
                      title="現在の値を宣言の既定値として記録する"
                    >
                      既定値 = 現在値
                    </button>
                  )}
                  <span className="text-[9px] text-white/35">{declaration.key}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {!isPublicLibrary && declarations.length < MAX_USER_PARAMETERS && (
        <div className="flex items-center gap-2">
          <select
            value={addKey}
            onChange={(e) => setAddKey(e.target.value)}
            className="min-w-0 flex-1 cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
            aria-label="Declare a parameter"
          >
            <option value="">パラメータを選んで宣言…</option>
            {addable.map((t) => (
              <option key={t.key as string} value={t.key as string}>{t.catalogLabel}（{t.key}）</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addKey}
            onClick={() => {
              if (!addKey) return;
              setUserParameters(addUserParameter(declarations, addKey as keyof ParticleConfig));
              setAddKey('');
            }}
            className="flex items-center gap-1 rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <Plus size={12} /> 追加
          </button>
        </div>
      )}
    </div>
  );
};
