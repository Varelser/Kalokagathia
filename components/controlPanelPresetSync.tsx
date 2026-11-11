import React from 'react';
import { Copy, Download, RefreshCw, Upload } from 'lucide-react';
import type { PresetRecord } from '../types';
import type { Notice } from '../lib/audioControllerTypes';
import {
  computeDeletedIds,
  formatSyncCode,
  generateSyncCode,
  isValidSyncCode,
  loadSyncState,
  mergePulledPresets,
  pullPresets,
  pushPresets,
  saveSyncState,
  stateAfterPull,
  stateAfterPush,
  type SyncState,
} from '../lib/presetSync';

// 端末間同期 (Sync) — programme item 8. Lives inside the shelf's
// "Library Backup / I/O" box. DEFAULT OFF: while disabled (or before a code
// is connected) this section renders controls only and makes zero network
// calls; Push/Pull run exclusively from the buttons below.
type PresetSyncSectionProps = {
  presets: PresetRecord[];
  onApplyPresets: (presets: PresetRecord[]) => void;
  onNotice: (notice: Notice) => void;
};

export const PresetSyncSection: React.FC<PresetSyncSectionProps> = ({ presets, onApplyPresets, onNotice }) => {
  const [state, setState] = React.useState<SyncState>(() => (
    typeof window === 'undefined' ? { enabled: false, code: null, lastSyncAt: null, syncedUpdatedAt: {} } : loadSyncState(window.localStorage)
  ));
  const [connectInput, setConnectInput] = React.useState('');
  const [busy, setBusy] = React.useState<'push' | 'pull' | null>(null);
  const [lastResult, setLastResult] = React.useState('');

  const update = React.useCallback((next: SyncState) => {
    setState(next);
    if (typeof window !== 'undefined') saveSyncState(window.localStorage, next);
  }, []);

  const presetsRef = React.useRef(presets);
  presetsRef.current = presets;
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const handleIssueCode = () => {
    const code = generateSyncCode();
    update({ ...stateRef.current, enabled: true, code });
    setLastResult('');
    onNotice({ tone: 'success', message: '同期コードを発行しました。このコードを他の端末で入力してください。' });
  };

  const handleConnect = () => {
    if (!isValidSyncCode(connectInput)) {
      onNotice({ tone: 'error', message: '同期コードの形式が正しくありません（英数字のコードを入力してください）。' });
      return;
    }
    update({ ...stateRef.current, enabled: true, code: formatSyncCode(connectInput) });
    setConnectInput('');
    setLastResult('');
    onNotice({ tone: 'success', message: '同期コードで接続しました。「ダウンロードして統合」で他の端末のプリセットを取り込めます。' });
  };

  const handleDisable = () => {
    update({ ...stateRef.current, enabled: false });
    setLastResult('');
  };

  const handleDisconnect = () => {
    update({ enabled: false, code: null, lastSyncAt: null, syncedUpdatedAt: {} });
    setLastResult('');
    onNotice({ tone: 'success', message: '同期を解除しました（この端末のプリセットはそのまま残ります）。' });
  };

  const handlePush = async () => {
    const current = stateRef.current;
    if (!current.enabled || !current.code || busy) return;
    setBusy('push');
    try {
      const local = presetsRef.current;
      const deletedIds = computeDeletedIds(current, local);
      const result = await pushPresets(current.code, local, deletedIds);
      update(stateAfterPush(stateRef.current, local));
      const message = `アップロード完了: ${result.received} 件を送信（サーバー保存 ${result.stored} 件${result.deleted ? `、削除 ${result.deleted} 件を反映` : ''}）`;
      setLastResult(message);
      onNotice({ tone: 'success', message });
    } catch (error) {
      const message = `アップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
      setLastResult(message);
      onNotice({ tone: 'error', message });
    } finally {
      setBusy(null);
    }
  };

  const handlePull = async () => {
    const current = stateRef.current;
    if (!current.enabled || !current.code || busy) return;
    setBusy('pull');
    try {
      const pulled = await pullPresets(current.code);
      const local = presetsRef.current;
      const result = mergePulledPresets(local, pulled.records, pulled.deletedIds, pulled.tombstoneUpdatedAt);
      if (result.added || result.updated || result.removed) {
        onApplyPresets(result.merged);
      }
      update(stateAfterPull(stateRef.current, result.merged, pulled.records));
      const message = pulled.records.length === 0 && result.removed === 0
        ? 'ダウンロード完了: サーバーにプリセットがありませんでした（コードが違う場合は空になります）'
        : `ダウンロードして統合しました: 追加 ${result.added} 件 / 更新 ${result.updated} 件 / 削除反映 ${result.removed} 件`;
      setLastResult(message);
      onNotice({ tone: 'success', message });
    } catch (error) {
      const message = `ダウンロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
      setLastResult(message);
      onNotice({ tone: 'error', message });
    } finally {
      setBusy(null);
    }
  };

  const handleCopyCode = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      onNotice({ tone: 'success', message: '同期コードをコピーしました。' });
    } catch {
      window.prompt('同期コード', state.code);
    }
  };

  const buttonClass = 'flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="mt-3 border-t border-white/10 pt-3" data-testid="preset-sync-section">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70 mb-1">
        <RefreshCw size={12} /> 端末間同期 (Sync)
      </div>
      <p className="text-[10px] leading-relaxed text-white/50 mb-3">
        プリセットライブラリを他の端末と同期します（任意機能・既定ではオフ）。同期コードがそのまま鍵になります。コードを知る人はライブラリを読み書きできるため、他人に教えたり公開したりしないでください。
      </p>

      {!state.enabled || !state.code ? (
        <div className="space-y-2">
          <button type="button" data-testid="sync-enable-issue" onClick={handleIssueCode} className={`${buttonClass} w-full`}>
            同期コードを発行して有効化
          </button>
          <div className="flex gap-2">
            <input
              type="text"
              value={connectInput}
              onChange={(event) => setConnectInput(event.target.value)}
              placeholder="既存の同期コードを入力"
              data-testid="sync-code-input"
              className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-2 text-[11px] tracking-wide outline-none focus:border-white/40"
            />
            <button type="button" data-testid="sync-connect" onClick={handleConnect} className={`${buttonClass} shrink-0 px-3`}>
              既存のコードで接続
            </button>
          </div>
          {state.enabled && !state.code && (
            <p className="text-[10px] text-white/40">同期は有効ですが、コードが未設定です。</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code data-testid="sync-code-display" className="flex-1 break-all rounded bg-black/30 px-2 py-1.5 font-mono text-[11px] tracking-wider text-emerald-200">
              {state.code}
            </code>
            <button type="button" data-testid="sync-copy" onClick={handleCopyCode} className={`${buttonClass} shrink-0 px-2`} title="同期コードをコピー">
              <Copy size={12} /> コピー
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" data-testid="sync-push" onClick={handlePush} disabled={busy !== null} className={buttonClass}>
              <Upload size={12} /> {busy === 'push' ? '送信中…' : 'アップロード'}
            </button>
            <button type="button" data-testid="sync-pull" onClick={handlePull} disabled={busy !== null} className={buttonClass}>
              <Download size={12} /> {busy === 'pull' ? '取得中…' : 'ダウンロードして統合'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase tracking-widest text-white/35">
              {state.lastSyncAt ? `最終同期: ${new Date(state.lastSyncAt).toLocaleString('ja-JP')}` : 'まだ同期していません'}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={handleDisable} className="text-[9px] uppercase tracking-widest text-white/40 hover:text-white/75">
                無効化
              </button>
              <button type="button" onClick={handleDisconnect} className="text-[9px] uppercase tracking-widest text-white/40 hover:text-red-200">
                コードを破棄
              </button>
            </span>
          </div>
        </div>
      )}
      {lastResult && <p data-testid="sync-result" className="mt-2 text-[10px] leading-relaxed text-white/55">{lastResult}</p>}
    </div>
  );
};
