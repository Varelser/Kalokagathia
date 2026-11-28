import React from 'react';

import { Toggle } from './controlPanelParts';
import {
  GpgpuScriptBakeStore,
  SCRIPT_FORMAT_VERSION,
  SCRIPT_SOURCE_MAX_LENGTH,
  SCRIPT_TARGETS,
  hashScriptSource,
  staticCheckScript,
  validateScriptConfig,
  type GpgpuScriptConfigSlice,
  type GpgpuScriptTarget,
} from '../lib/gpgpuScriptBake';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

const TARGET_LABELS: Record<GpgpuScriptTarget, string> = {
  attrBake: '属性ベイク',
  initialState: '初期状態生成',
  fieldBake: 'フィールドベイク',
};

// Script bake (Layer 1 WP11, phases B/C): the authoring panel
// for the six gpgpuScript* keys — the C1 (Pyodide) receptacle.
// The script's role is bake-stage computation only (attribute
// bake / initial-state generation / validation support); it
// never enters a real-time shader path.
//
// This panel is authoring + inspection only: source editing
// under the same draft + Apply discipline as the GLSL blocks,
// the static check and the whole-slice validation shown live,
// and the recorded state (source hash / output hash / format
// version). Running the script (the Worker) is the bake
// side's responsibility and is NOT wired here — no execution
// happens from this panel.
//
// The share contract (design §3) is displayed from the
// validated store itself: a share payload excludes the source
// by default, and a payload that includes it is marked
// requiresRunConfirmation — the receiving side must confirm
// before running.
export const ScriptBakeBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const slice: GpgpuScriptConfigSlice = {
    gpgpuScriptEnabled: config.gpgpuScriptEnabled,
    gpgpuScriptTarget: config.gpgpuScriptTarget,
    gpgpuScriptSource: config.gpgpuScriptSource,
    gpgpuScriptSeed: config.gpgpuScriptSeed,
    gpgpuScriptFormatVersion: config.gpgpuScriptFormatVersion,
    gpgpuScriptOutputHash: config.gpgpuScriptOutputHash,
  };
  const [draft, setDraft] = React.useState(config.gpgpuScriptSource);
  const dirty = draft !== config.gpgpuScriptSource;
  const draftCheck = staticCheckScript(draft);
  const sliceValidation = validateScriptConfig(slice);
  const shareInfo = React.useMemo(() => {
    try {
      const store = new GpgpuScriptBakeStore(slice);
      return { excluded: store.toSharePayload(false), included: store.toSharePayload(true) };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slice は6キーの寄せ集めで毎レンダー新しい参照になるため、値で依存させる
  }, [config.gpgpuScriptEnabled, config.gpgpuScriptTarget, config.gpgpuScriptSource, config.gpgpuScriptSeed, config.gpgpuScriptFormatVersion, config.gpgpuScriptOutputHash]);
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Script Bake (Python / C1)</div>
      <Toggle label="Script Bake (Python)" value={config.gpgpuScriptEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuScriptEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        ベイク段の計算（属性ベイク／初期状態生成／検証支援）だけに使う Python スクリプトの受け皿です。リアルタイムのシェーダ経路には入りません。取り込み時に静的検査（import は計算系のホワイトリストのみ、os／sys／eval／exec／open 等は禁止）を行い、検査・実行に失敗した場合は直前の動作版のベイク出力を維持します。この面は著述と検査・状態の表示のみで、スクリプトの実行（Worker）はベイク側の担当として未接続です。
      </div>
      {config.gpgpuScriptEnabled && (
        <>
          <Toggle
            label="Target (対象)"
            value={config.gpgpuScriptTarget}
            options={SCRIPT_TARGETS.map((target) => ({ label: TARGET_LABELS[target], val: target }))}
            onChange={(v) => updateConfig('gpgpuScriptTarget', v)}
          />
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium text-white/65">Seed (シード)</div>
            <input
              type="number"
              value={config.gpgpuScriptSeed}
              min={0}
              max={4294967295}
              step={1}
              onChange={(event) => {
                const next = Math.floor(Number(event.target.value));
                if (Number.isFinite(next)) updateConfig('gpgpuScriptSeed', Math.min(4294967295, Math.max(0, next)));
              }}
              className="w-full rounded bg-black/40 border border-white/15 px-2 py-1.5 font-mono text-[10px] text-white/85 outline-none focus:border-white/40"
            />
          </div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={9}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'# 例: import math\n# 属性ベイクでは宣言チャンネルごとの列を返します'}
          />
          <div className="mt-1 text-[9px] text-white/40">
            {draft.length} / {SCRIPT_SOURCE_MAX_LENGTH} 文字
            {draftCheck.ok
              ? ' ・ 静的検査: 合格'
              : ` ・ 静的検査: ${draftCheck.error}`}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('gpgpuScriptSource', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          <div className="mt-3 text-[9px] leading-relaxed text-white/40">
            <div>保存形式バージョン: {config.gpgpuScriptFormatVersion}（現行 {SCRIPT_FORMAT_VERSION}）</div>
            <div>ソースのハッシュ (SHA-256): {config.gpgpuScriptSource ? hashScriptSource(config.gpgpuScriptSource) : '—'}</div>
            <div>出力ハッシュ (gpgpuScriptOutputHash): {config.gpgpuScriptOutputHash || '—（まだベイク出力が記録されていません）'}</div>
            {shareInfo && (
              <div>
                共有ペイロードの契約: 既定ではソースを含みません（含まれる場合の gpgpuScriptIncluded: {String(shareInfo.included.gpgpuScriptIncluded)}）。
                ソースを含む場合は requiresRunConfirmation: {String(shareInfo.included.requiresRunConfirmation ?? false)} となり、受信側は実行前に確認が必要です。
              </div>
            )}
            {!sliceValidation.ok && (
              <div className="text-red-300/90">現在の設定が検証で拒否されています: {sliceValidation.error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
