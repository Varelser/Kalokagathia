import React from 'react';
import { Bot, Loader2, Send, Trash2, Undo2 } from 'lucide-react';
import type { ParticleConfig } from '../types';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import {
  AI_SPEC_BY_KEY,
  buildAiSystemPrompt,
  parseAiReply,
  validateAiPatch,
  type AiAppliedChange,
} from '../lib/aiControlCatalog';
import {
  aiPresetName,
  buildAiGenerateSystemPrompt,
  materialiseAiPreset,
  parseAiGenerateReply,
} from '../lib/aiPresetGeneration';
import { exitSharedView, isSharedView, subscribeSharedView } from '../lib/shareLink';
import {
  callGeminiDirect,
  callGroqDirect,
  cleanByokKey,
  loadByokKeys,
  saveByokKeys,
  testByokKey,
  type ByokKeys,
  type ByokProvider,
} from '../lib/byok';

type AiProvider = 'groq' | 'gemini';
type AiMode = 'adjust' | 'generate';

const GENERATE_EXAMPLES = ['夕焼けみたいな渦を作って', '静かな霧のプリセットを作って', '激しく砕ける結晶を作って', '深海に沈む光を作って'];

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  changes?: AiAppliedChange[];
  provider?: string;
  undone?: boolean;
}

const STORAGE_KEY = 'kalokagathia.aiChat.v1';
const USAGE_KEY = 'kalokagathia.aiUsage.v1';

interface AiUsageStats {
  requests: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  lastModel?: string;
  lastVia?: 'relay' | 'byok';
  lastRate?: { limit: number; remaining: number; windowSeconds: number } | null;
  lastAt?: number;
}

function loadUsage(): AiUsageStats {
  try {
    const j = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null') as AiUsageStats | null;
    if (j && typeof j.requests === 'number') {
      return {
        requests: j.requests,
        succeeded: j.succeeded ?? 0,
        failed: j.failed ?? 0,
        inputTokens: j.inputTokens ?? 0,
        outputTokens: j.outputTokens ?? 0,
        lastModel: j.lastModel,
        lastVia: j.lastVia,
        lastRate: j.lastRate ?? null,
        lastAt: j.lastAt,
      };
    }
  } catch { /* ignore */ }
  return { requests: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, lastRate: null };
}
const EXAMPLES = ['もっと混沌に', '静かな渦にして', 'ゆっくり漂わせて', '万華鏡っぽく', '線を太く長く', '粒を増やして濃く'];

let nextId = 1;

function loadStored(): { messages: ChatMessage[]; provider: AiProvider; mode: AiMode } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { messages?: ChatMessage[]; provider?: AiProvider; mode?: AiMode };
      const messages = Array.isArray(j.messages) ? j.messages.slice(-50) : [];
      for (const m of messages) nextId = Math.max(nextId, (m.id ?? 0) + 1);
      return { messages, provider: j.provider === 'gemini' ? 'gemini' : 'groq', mode: j.mode === 'generate' ? 'generate' : 'adjust' };
    }
  } catch { /* storage unavailable */ }
  return { messages: [], provider: 'groq', mode: 'adjust' };
}

const BYOK_PROVIDERS: { id: ByokProvider; label: string; placeholder: string; issueUrl: string; issueLabel: string }[] = [
  { id: 'groq', label: 'Groq', placeholder: 'gsk_…', issueUrl: 'https://console.groq.com/keys', issueLabel: 'console.groq.com で無料発行' },
  { id: 'gemini', label: 'Gemini', placeholder: 'AIza…', issueUrl: 'https://aistudio.google.com/apikey', issueLabel: 'Google AI Studio で無料発行' },
];

const ByokSettings: React.FC<{ keys: ByokKeys; onChange: (next: ByokKeys) => void; defaultOpen?: boolean }> = ({ keys, onChange, defaultOpen }) => {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const [draft, setDraft] = React.useState<ByokKeys>({ groq: '', gemini: '' });
  const [testNote, setTestNote] = React.useState<Partial<Record<ByokProvider, string>>>({});
  const [testing, setTesting] = React.useState<Partial<Record<ByokProvider, boolean>>>({});

  const runTest = async (provider: ByokProvider) => {
    const key = cleanByokKey(draft[provider]) || keys[provider];
    if (!key) return;
    setTesting((prev) => ({ ...prev, [provider]: true }));
    const res = await testByokKey(provider, key);
    setTesting((prev) => ({ ...prev, [provider]: false }));
    setTestNote((prev) => ({
      ...prev,
      [provider]: res.ok ? '接続OK（キーは有効です）' : `接続できませんでした（HTTP ${res.status || '—'}）。キーを確認してください`,
    }));
  };

  return (
    <div className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5" data-testid="byok-settings">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[11px] font-semibold tracking-wider text-white/75"
      >
        <span>APIキー設定（自分のキーを使う）</span>
        <span className="flex items-center gap-2 text-[10px] font-normal text-white/45">
          <span>{keys.groq ? 'Groq ●' : 'Groq ○'} {keys.gemini ? 'Gemini ●' : 'Gemini ○'}</span>
          <span>{open ? '−' : '+'}</span>
        </span>
      </button>
      {open ? (
        <div className="mt-2.5 space-y-3">
          {BYOK_PROVIDERS.map((p) => (
            <div key={p.id}>
              <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                <span>{p.label}{keys[p.id] ? '（設定済み）' : '（未設定）'}</span>
                <a href={p.issueUrl} target="_blank" rel="noreferrer" className="text-white/40 underline decoration-white/25 hover:text-white/70">{p.issueLabel}</a>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={draft[p.id]}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={keys[p.id] ? '変更する場合だけ入力' : p.placeholder}
                  autoComplete="off"
                  data-testid={`byok-input-${p.id}`}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-[11px] text-white/85 placeholder:text-white/30"
                />
                <button
                  type="button"
                  disabled={!cleanByokKey(draft[p.id])}
                  onClick={() => {
                    const cleaned = cleanByokKey(draft[p.id]);
                    const next = { ...keys, [p.id]: cleaned };
                    onChange(next);
                    setDraft((prev) => ({ ...prev, [p.id]: '' }));
                    // Read back what actually landed in storage: setItem can
                    // fail silently (private mode / quota) and the key would
                    // otherwise vanish on reload while claiming success.
                    const storedBack = loadByokKeys();
                    setTestNote((prev) => ({
                      ...prev,
                      [p.id]: storedBack[p.id] === cleaned
                        ? '保存しました'
                        : '保存できませんでした（ブラウザの保存領域が使えないようです）',
                    }));
                  }}
                  className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20 disabled:opacity-30"
                >保存</button>
                <button
                  type="button"
                  disabled={testing[p.id] || (!cleanByokKey(draft[p.id]) && !keys[p.id])}
                  onClick={() => runTest(p.id)}
                  data-testid={`byok-test-${p.id}`}
                  className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/15 disabled:opacity-30"
                >{testing[p.id] ? '…' : 'テスト'}</button>
                {keys[p.id] ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...keys, [p.id]: '' };
                      onChange(next);
                      setTestNote((prev) => ({ ...prev, [p.id]: '削除しました' }));
                    }}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/50 transition hover:bg-white/15"
                  >削除</button>
                ) : null}
              </div>
              {testNote[p.id] ? <p className="mt-1 text-[10px] text-white/45">{testNote[p.id]}</p> : null}
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-white/40">
            キーはこのブラウザの localStorage にだけ保存され、Groq / Gemini へ直接送られます。このサイトのサーバー（中継）には送られません。自分のキーを設定したプロバイダは、サイト側のキーではなくあなたの枠で動きます。共有端末では設定しないでください。
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const AiTabContent: React.FC<Pick<ControlPanelContentProps, 'config' | 'updateConfig' | 'presets' | 'onSaveBredPreset' | 'onApplyConfig'>> = ({ config, updateConfig, presets, onSaveBredPreset, onApplyConfig }) => {
  const [stored] = React.useState(loadStored);
  const [messages, setMessages] = React.useState<ChatMessage[]>(stored.messages);
  const [provider, setProvider] = React.useState<AiProvider>(stored.provider);
  const [mode, setMode] = React.useState<AiMode>(stored.mode);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [lastApply, setLastApply] = React.useState<{ messageId: number; changes: AiAppliedChange[] } | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const configRef = React.useRef(config);
  configRef.current = config;

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-50), provider, mode })); } catch { /* ignore */ }
  }, [messages, provider, mode]);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const [sharedView, setSharedView] = React.useState(isSharedView());
  React.useEffect(() => subscribeSharedView(() => setSharedView(isSharedView())), []);

  const [byokKeys, setByokKeys] = React.useState<ByokKeys>(loadByokKeys);
  const applyByokKeys = React.useCallback((next: ByokKeys) => {
    saveByokKeys(next);
    setByokKeys(next);
  }, []);
  const hasOwnKey = Boolean(byokKeys.groq || byokKeys.gemini);

  const applyValue = React.useCallback((key: keyof ParticleConfig, value: number | boolean | string) => {
    (updateConfig as (k: keyof ParticleConfig, v: never) => void)(key, value as never);
  }, [updateConfig]);

  const [usage, setUsage] = React.useState<AiUsageStats>(loadUsage);
  const recordUsage = React.useCallback((patch: Partial<AiUsageStats>) => {
    setUsage((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(USAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const callAi = React.useCallback(async (useProvider: AiProvider, payload: unknown): Promise<{ text: string; provider: string } | null> => {
    const messages = (payload as { messages: { role: string; content: string }[] }).messages;
    const ownKey = useProvider === 'groq' ? byokKeys.groq : byokKeys.gemini;
    if (ownKey) {
      // BYOK: call the provider directly with the visitor's own key. If it
      // fails we do not silently fall back to the site relay for this provider
      // (that would spend the owner's quota); send() may try the other one.
      // BYOK calls never touch the site relay, so relay rate limits and the
      // owner's quota do not apply to them.
      const direct = useProvider === 'groq'
        ? await callGroqDirect(ownKey, messages).catch(() => null)
        : await callGeminiDirect(ownKey, messages).catch(() => null);
      if (direct) recordUsage({ lastVia: 'byok', lastModel: direct.model, lastAt: Date.now() });
      return direct
        ? { text: direct.text, provider: `${useProvider === 'groq' ? 'Groq' : 'Gemini'} (${direct.model}) · 自分のキー` }
        : null;
    }
    if (sharedView) return null; // shared view: the site relay stays off
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(payload as Record<string, unknown>), provider: useProvider, jsonMode: true }),
    });
    const j = await r.json().catch(() => null) as {
      ok?: boolean; text?: string; provider?: string; model?: string; error?: string;
      retryAfterSeconds?: number;
      usage?: { inputTokens?: number | null; outputTokens?: number | null };
      rateLimit?: { limit: number; remaining: number; windowSeconds: number };
    } | null;
    if (r.status === 429 || j?.error === 'rate_limited') {
      throw new Error(`RATE_LIMITED:${j?.retryAfterSeconds ?? 60}`);
    }
    if (r.ok && j?.ok && typeof j.text === 'string') {
      setUsage((prev) => {
        const next: AiUsageStats = {
          ...prev,
          inputTokens: prev.inputTokens + (j.usage?.inputTokens ?? 0),
          outputTokens: prev.outputTokens + (j.usage?.outputTokens ?? 0),
          lastModel: j.model ?? prev.lastModel,
          lastVia: 'relay',
          lastRate: j.rateLimit ?? prev.lastRate ?? null,
          lastAt: Date.now(),
        };
        try { localStorage.setItem(USAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      return { text: j.text, provider: `${j.provider ?? useProvider}${j.model ? ` (${j.model})` : ''}` };
    }
    return null;
  }, [byokKeys, sharedView, recordUsage]);

  // Phase 2: natural-language -> brand-new preset. Two AI-directed routes
  // (breed from library parents / assemble within the catalog), validated
  // client-side with ONE automatic retry, then saved as a user preset with
  // an "AI:" prefix and applied so the result is visible immediately.
  const runGenerate = React.useCallback(async (text: string) => {
    recordUsage({ requests: usage.requests + 1 });
    const other: AiProvider = provider === 'groq' ? 'gemini' : 'groq';
    const system = buildAiGenerateSystemPrompt(configRef.current, presets ?? []);
    let feedback = '';
    for (let round = 0; round < 2; round += 1) {
      const userContent = feedback
        ? `${text}\n\n（注意：前回の出力は検証で使えませんでした：${feedback}。形式とルールを守って作り直してください）`
        : text;
      const payload = { messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }] };
      let result = await callAi(provider, payload).catch(() => null);
      if (!result) result = await callAi(other, payload).catch(() => null);
      if (!result) {
        recordUsage({ failed: usage.failed + 1 });
        setMessages((prev) => [...prev, { id: nextId++, role: 'assistant', text: 'AIに接続できなかったため、プリセットを作れませんでした。少し待ってからもう一度試してください。' }]);
        return;
      }
      const plan = parseAiGenerateReply(result.text);
      if (!plan) { feedback = 'JSONとして解釈できませんでした'; continue; }
      const outcome = materialiseAiPreset(plan, configRef.current, presets ?? [], (Date.now() & 0xffffff) ^ (round * 7919));
      if (!outcome.ok || !outcome.config) { feedback = outcome.reason ?? '検証に失敗しました'; continue; }
      const name = aiPresetName(plan);
      onSaveBredPreset?.(outcome.config, name);
      onApplyConfig?.(outcome.config);
      recordUsage({ succeeded: usage.succeeded + 1 });
      const routeNote = plan.mode === 'breed'
        ? `交配で作成：${(outcome.parentNames ?? []).join(' × ')}（位置 ${plan.t} / 変異 ${plan.mutation}）`
        : `新規組立で作成：${outcome.applied?.length ?? 0} 項目を変更`;
      setMessages((prev) => [...prev, {
        id: nextId++,
        role: 'assistant',
        text: `${plan.summary ? `${plan.summary}\n` : ''}プリセット「${name}」を作成して棚に追加し、適用しました。\n${routeNote}`,
        changes: plan.mode === 'assemble' ? outcome.applied : undefined,
        provider: result.provider,
      }]);
      return;
    }
    recordUsage({ failed: usage.failed + 1 });
    setMessages((prev) => [...prev, {
      id: nextId++, role: 'assistant',
      text: `プリセットを生成できませんでした（検証で2回とも使えませんでした：${feedback}）。指示を変えてもう一度試してください。`,
    }]);
  }, [callAi, provider, presets, onSaveBredPreset, onApplyConfig, usage, recordUsage]);

  const send = React.useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setBusy(true);
    const userMsg: ChatMessage = { id: nextId++, role: 'user', text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    if (mode === 'generate') {
      await runGenerate(text);
      setBusy(false);
      return;
    }
    const apiMessages = [
      { role: 'system', content: buildAiSystemPrompt(configRef.current) },
      ...history.slice(-7, -1).map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: text },
    ];
    const other: AiProvider = provider === 'groq' ? 'gemini' : 'groq';
    recordUsage({ requests: usage.requests + 1 });
    let rateLimitedSeconds = 0;
    const attempt = async (p: AiProvider) => callAi(p, { messages: apiMessages }).catch((e: unknown) => {
      const m = /^RATE_LIMITED:(\d+)$/.exec(e instanceof Error ? e.message : '');
      if (m) { rateLimitedSeconds = Number(m[1]); return null; }
      return null;
    });
    let result = await attempt(provider);
    let fallbackNote = '';
    if (!result && !rateLimitedSeconds) {
      result = await attempt(other);
      if (result) fallbackNote = `（${provider === 'groq' ? 'Groq' : 'Gemini'}が応答しなかったため、もう一方で実行しました）`;
    }
    if (rateLimitedSeconds && !result) {
      recordUsage({ failed: usage.failed + 1 });
      setMessages((prev) => [...prev, {
        id: nextId++, role: 'assistant',
        text: `短時間にリクエストが集中したため、サイト側AIの利用を一時制限しています。約${rateLimitedSeconds}秒待ってからもう一度試してください。自分のAPIキーを設定している場合は、そちらは制限の対象外です。`,
      }]);
      setBusy(false);
      return;
    }
    if (!result) {
      const ownKeyUsed = Boolean(provider === 'groq' ? byokKeys.groq : byokKeys.gemini)
        || Boolean(other === 'groq' ? byokKeys.groq : byokKeys.gemini);
      const hint = ownKeyUsed
        ? '\n自分のAPIキーを設定している場合は、キーが無効か上限に達している可能性があります。「APIキー設定」のテストで確認できます。'
        : '';
      recordUsage({ failed: usage.failed + 1 });
      setMessages((prev) => [...prev, { id: nextId++, role: 'assistant', text: `AIに接続できませんでした。少し待ってからもう一度試してください。${hint}` }]);
      setBusy(false);
      return;
    }
    const parsed = parseAiReply(result.text);
    if (!parsed) {
      setMessages((prev) => [...prev, { id: nextId++, role: 'assistant', text: `応答の形式を解釈できませんでした：${result.text.slice(0, 300)}`, provider: result.provider }]);
      setBusy(false);
      return;
    }
    recordUsage({ succeeded: usage.succeeded + 1 });
    const { applied, rejected } = validateAiPatch(parsed.patch, configRef.current);
    const id = nextId++;
    if (applied.length > 0) {
      for (const c of applied) applyValue(c.key, c.to);
      setLastApply({ messageId: id, changes: applied });
    }
    const parts: string[] = [];
    if (parsed.summary) parts.push(parsed.summary);
    if (applied.length === 0 && !parsed.summary) parts.push('変更はありませんでした。');
    if (rejected.length > 0) parts.push(`（使えない指定 ${rejected.length} 件は除きました）`);
    if (fallbackNote) parts.push(fallbackNote);
    setMessages((prev) => [...prev, { id, role: 'assistant', text: parts.join('\n'), changes: applied.length > 0 ? applied : undefined, provider: result.provider }]);
    setBusy(false);
  }, [busy, messages, provider, callAi, applyValue, byokKeys, usage, recordUsage, mode, runGenerate]);

  const undoLast = React.useCallback(() => {
    if (!lastApply) return;
    for (const c of lastApply.changes) {
      applyValue(c.key, c.from as number | boolean | string);
    }
    setMessages((prev) => prev.map((m) => (m.id === lastApply.messageId ? { ...m, undone: true } : m)));
    setLastApply(null);
  }, [lastApply, applyValue]);

  const clearHistory = React.useCallback(() => {
    setMessages([]);
    setLastApply(null);
  }, []);

  if (sharedView && !hasOwnKey) {
    return (
      <div className="space-y-4" data-testid="ai-panel">
        <div className="rounded-2xl border border-white/20 bg-[linear-gradient(165deg,rgba(255,255,255,0.11),rgba(255,255,255,0.02)_48%,rgba(255,255,255,0))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white/90">
            <Bot className="h-4 w-4" /> サイトのAIはオフです（共有表示）
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/60">
            共有リンクで開いているため、サイト側のキーを使うAI調整は無効になっています。下の「APIキー設定」で自分のキーを設定すれば、あなたのキーでAIが使えます。プリセットの鑑賞や手動の調整はそのままできます。
          </p>
          <div className="mt-3">
            <ByokSettings keys={byokKeys} onChange={applyByokKeys} defaultOpen />
          </div>
          <button
            type="button"
            onClick={exitSharedView}
            className="mt-3 rounded-full bg-[linear-gradient(180deg,#ffffff,#d4d4d4)] px-4 py-1.5 text-[11px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:brightness-95"
          >
            フル版で開く（AIを有効にする）
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ai-panel">
      <div className="rounded-2xl border border-white/20 bg-[linear-gradient(165deg,rgba(255,255,255,0.11),rgba(255,255,255,0.02)_48%,rgba(255,255,255,0))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white/90">
            <Bot className="h-4 w-4" /> AI アシスタント
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-white/15 text-[11px]">
              <button
                type="button"
                data-testid="ai-provider-groq"
                onClick={() => setProvider('groq')}
                className={`px-2.5 py-1 ${provider === 'groq' ? 'bg-white/85 text-black' : 'bg-white/5 text-white/70'}`}
              >Groq</button>
              <button
                type="button"
                data-testid="ai-provider-gemini"
                onClick={() => setProvider('gemini')}
                className={`px-2.5 py-1 ${provider === 'gemini' ? 'bg-white/85 text-black' : 'bg-white/5 text-white/70'}`}
              >Gemini</button>
            </div>
            <button type="button" onClick={clearHistory} title="会話を消す" className="rounded-lg border border-white/15 bg-white/5 p-1.5 text-white/60 hover:text-white">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2.5 flex overflow-hidden rounded-lg border border-white/15 text-[11px]" data-testid="ai-mode-toggle">
          <button
            type="button"
            data-testid="ai-mode-adjust"
            onClick={() => setMode('adjust')}
            className={`flex-1 px-2.5 py-1.5 ${mode === 'adjust' ? 'bg-white/85 font-semibold text-black' : 'bg-white/5 text-white/70'}`}
          >調整（今の見た目を変える）</button>
          <button
            type="button"
            data-testid="ai-mode-generate"
            onClick={() => setMode('generate')}
            className={`flex-1 px-2.5 py-1.5 ${mode === 'generate' ? 'bg-white/85 font-semibold text-black' : 'bg-white/5 text-white/70'}`}
          >プリセット生成（新しく作る）</button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-white/60">
          {mode === 'adjust' ? (
            <>言葉で指示すると、AIがパラメータを調整します（例：「もっと混沌に」「静かな渦」）。変更は即時反映され、直前の変更は「元に戻す」で取り消せます。</>
          ) : (
            <>言葉で頼むと、AIが新しいプリセットを1つ作ります。既存プリセットの交配か、カタログ内での新規組立かをAIが選び、検証を通ったものだけが「AI:」付きの名前で棚に追加され、そのまま適用されます。</>
          )}
        </p>
        <div className="mt-3">
          <ByokSettings keys={byokKeys} onChange={applyByokKeys} />
        </div>
        <div className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10.5px] leading-relaxed text-white/50" data-testid="ai-usage">
          <span className="font-semibold text-white/65">利用状況（このブラウザ）</span>
          {'：'}リクエスト {usage.requests} 回（成功 {usage.succeeded} / 失敗 {usage.failed}）
          {usage.lastModel ? <> ・ 前回モデル {usage.lastModel}{usage.lastVia === 'byok' ? '（自分のキー）' : ''}</> : null}
          {(usage.inputTokens + usage.outputTokens) > 0 ? <> ・ トークン 入力 {usage.inputTokens.toLocaleString()} / 出力 {usage.outputTokens.toLocaleString()}</> : null}
          {usage.lastRate ? <> ・ サイト中継の目安 残り約 {usage.lastRate.remaining} 回（{Math.round(usage.lastRate.windowSeconds / 60)} 分で最大 {usage.lastRate.limit} 回）</> : null}
          <br />サイト側AIは Groq / Gemini の無料枠で動いています（料金は発生しません）。短時間の連投は枠を守るため自動で制限されます。自分のキーを設定した場合は、そのプロバイダは制限・枠ともあなたのものになります。
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(mode === 'generate' ? GENERATE_EXAMPLES : EXAMPLES).map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => void send(ex)}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10 disabled:opacity-40"
            >{ex}</button>
          ))}
        </div>
      </div>

      <div ref={listRef} data-testid="ai-msg-list" className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="px-1 py-6 text-center text-[12px] text-white/40">まだ会話がありません。下の入力欄から指示してみてください。</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
              m.role === 'user' ? 'bg-white/85 text-black' : 'border border-white/[0.16] bg-[linear-gradient(165deg,rgba(255,255,255,0.09),rgba(255,255,255,0.02)_50%,rgba(255,255,255,0))] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.changes && m.changes.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-white/10 pt-2" data-testid="ai-applied">
                  {m.changes.map((c) => (
                    <div key={c.key as string} className="text-[11px] opacity-80">
                      {AI_SPEC_BY_KEY.get(c.key as string)?.gloss ?? (c.key as string)}：{String(c.from)} → {String(c.to)}
                    </div>
                  ))}
                  {m.undone && <div className="text-[11px] opacity-60">（元に戻しました）</div>}
                </div>
              )}
              {m.provider && <div className="mt-1.5 text-[10px] opacity-50">{m.provider}</div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 考え中…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          data-testid="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
          }}
          rows={2}
          placeholder={mode === 'generate' ? '例：夕焼けみたいな渦を作って' : '例：もっと混沌に / 静かな渦にして'}
          className="flex-1 resize-none rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="ai-send"
            disabled={busy || !input.trim()}
            onClick={() => void send(input)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-white via-white to-neutral-300 px-3.5 py-2 text-[12.5px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-8px_14px_-8px_rgba(0,0,0,0.28)] hover:brightness-95 disabled:opacity-40"
          ><Send className="h-3.5 w-3.5" /> 送信</button>
          <button
            type="button"
            data-testid="ai-undo"
            disabled={!lastApply || busy}
            onClick={undoLast}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-[12.5px] text-white/75 hover:bg-white/10 disabled:opacity-40"
          ><Undo2 className="h-3.5 w-3.5" /> 元に戻す</button>
        </div>
      </div>
    </div>
  );
};
