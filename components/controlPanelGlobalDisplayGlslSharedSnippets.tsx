import React from 'react';

import {
  serializeGlslSharedSnippetDefsForConfig,
  useResolvedGlslSharedSnippetDefs,
  validateGlslSharedSnippetDefs,
  type GlslSharedSnippetDef,
} from '../lib/glslSharedSnippets';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

// GLSL shared snippet definitions (Layer 1 WP11, phases A/C):
// the Scratch Pad editor. The definition set is authored into
// the work via the `glslSharedSnippets` config key (WP9 phase
// C sentinel discipline: '' = not authored = the empty set;
// '[]' = an explicitly emptied set). Every GLSL injection
// point resolves its snippet against this set — a whole-line
// `// @use <name>` directive expands the named definition
// before the point's own validation and compile check, under
// the point's own contract. Definitions nothing references
// are inert, and a configuration that never authors a set
// keeps byte-identical shaders.
//
// Same editing shape as the other GLSL blocks: a local draft
// with an explicit Apply button. Unlike the snippet blocks,
// Apply is blocked while the draft set is structurally
// invalid (duplicate names, unresolved references, cycles) —
// the set is one authored value, validated as a whole, and
// the reason is shown inline.
export const GlslSharedSnippetsBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const resolved = useResolvedGlslSharedSnippetDefs(config.glslSharedSnippets);
  const [draft, setDraft] = React.useState<GlslSharedSnippetDef[]>(resolved);
  const [open, setOpen] = React.useState(false);
  const validation = validateGlslSharedSnippetDefs(draft);
  const serialized = serializeGlslSharedSnippetDefsForConfig(draft);
  // The stored value's canonical form: '' (unauthored) and a
  // broken value both resolve to the empty set, whose
  // canonical serialisation is '[]'.
  const canonicalStored = serializeGlslSharedSnippetDefsForConfig(resolved);
  const dirty = serialized !== canonicalStored;
  const updateDef = (index: number, patch: Partial<GlslSharedSnippetDef>) => {
    setDraft((prev) => prev.map((def, i) => (i === index ? { ...def, ...patch } : def)));
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">GLSL Shared Snippets (Scratch Pad)</div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        全ての GLSL 差し込み口で共有できる名前付き定義です。各口の断片に「// @use 名前」と行全体で書くと、その定義が差し込み口自身の検証・コンパイル確認の前に展開されます（カスタムフォースでは定義内の ctrl() 宣言も断片に書いた場合と同様に働きます）。参照されない定義は何もしません。定義が無い構成では従来どおりのシェーダが生成されます。
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
        >
          {open ? '編集を閉じる' : `定義を編集（${resolved.length}件）`}
        </button>
        {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
      </div>
      {open && (
        <>
          {draft.map((def, index) => (
            <div key={index} className="mt-3 rounded border border-white/10 p-2">
              <div className="flex items-center gap-2">
                <input
                  value={def.name}
                  onChange={(event) => updateDef(index, { name: event.target.value })}
                  spellCheck={false}
                  placeholder="定義名（英字で始まる識別子）"
                  className="flex-1 rounded bg-black/40 border border-white/15 px-2 py-1 font-mono text-[10px] text-white/85 outline-none focus:border-white/40"
                />
                <button
                  onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
                  className="px-2 py-1 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  削除
                </button>
              </div>
              <textarea
                value={def.code}
                onChange={(event) => updateDef(index, { code: event.target.value })}
                spellCheck={false}
                rows={4}
                placeholder={'// 定義の GLSL（他の定義を // @use 名前 で参照できます）'}
                className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
              />
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setDraft((prev) => [...prev, { name: '', code: '' }])}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              定義を追加
            </button>
            <button
              onClick={() => updateConfig('glslSharedSnippets', serialized)}
              disabled={!dirty || !validation.ok}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
          </div>
          {!validation.ok && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">定義の集合が不正です: {validation.error}</p>
          )}
        </>
      )}
    </div>
  );
};
