// BYOK (Bring Your Own Key): the visitor's own Groq / Gemini / OpenRouter API keys.
//
// Keys are stored only in this browser's localStorage and are sent only to
// the provider APIs themselves (api.groq.com / generativelanguage.googleapis.com /
// openrouter.ai), never to this site's relay. Calls mirror the relay worker's request
// shapes (same models and parameters) so behaviour matches the site-key route.
// OpenRouter is BYOK-only: the site relay does not offer it.

export type ByokProvider = 'groq' | 'gemini' | 'openrouter';

export interface ByokKeys {
  groq: string;
  gemini: string;
  openrouter: string;
}

const STORAGE_KEY = 'kalokagathia.byok.v1';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENROUTER_MODEL = 'openrouter/free';

export interface AiChatMessage {
  role: string;
  content: string;
}

// Keys are often pasted with surrounding quotes or stray whitespace /
// line breaks (which make the Authorization header invalid). Real keys never
// contain whitespace, so strip all of it plus surrounding quotes.
export function cleanByokKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').replace(/^["']+|["']+$/g, '');
}

function cleanKey(value: unknown): string {
  return cleanByokKey(value);
}

export function loadByokKeys(): ByokKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<ByokKeys>;
      return { groq: cleanKey(j.groq), gemini: cleanKey(j.gemini), openrouter: cleanKey(j.openrouter) };
    }
  } catch {
    /* storage unavailable */
  }
  return { groq: '', gemini: '', openrouter: '' };
}

export function saveByokKeys(keys: ByokKeys): void {
  try {
    if (!keys.groq && !keys.gemini && !keys.openrouter) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}

export async function callGroqDirect(
  key: string,
  messages: AiChatMessage[],
): Promise<{ text: string; model: string } | null> {
  const k = cleanByokKey(key);
  if (!k) return null;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: 1600,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });
  const j = (await r.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = j?.choices?.[0]?.message?.content ?? null;
  if (!r.ok || !text) return null;
  return { text, model: GROQ_MODEL };
}

export async function callOpenRouterDirect(
  key: string,
  messages: AiChatMessage[],
): Promise<{ text: string; model: string } | null> {
  const k = cleanByokKey(key);
  if (!k) return null;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: 1600,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });
  const j = (await r.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = j?.choices?.[0]?.message?.content ?? null;
  if (!r.ok || !text) return null;
  return { text, model: OPENROUTER_MODEL };
}

export async function callGeminiDirect(
  key: string,
  messages: AiChatMessage[],
): Promise<{ text: string; model: string } | null> {
  const k = cleanByokKey(key);
  if (!k) return null;
  let system = '';
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n' : '') + m.content;
      continue;
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const payload: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 2048, temperature: 0.4, responseMimeType: 'application/json' },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': k, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const j = (await r.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null;
  if (!r.ok || !text) return null;
  return { text, model: GEMINI_MODEL };
}

export async function testByokKey(
  provider: ByokProvider,
  key: string,
): Promise<{ ok: boolean; status: number }> {
  const k = cleanByokKey(key);
  if (!k) return { ok: false, status: 0 };
  try {
    if (provider === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_tokens: 128,
          temperature: 0,
        }),
      });
      const j = (await r.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
      return { ok: r.ok && Boolean(j?.choices?.[0]?.message?.content), status: r.status };
    }
    if (provider === 'openrouter') {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          max_tokens: 128,
          temperature: 0,
        }),
      });
      const j = (await r.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
      return { ok: r.ok && Boolean(j?.choices?.[0]?.message?.content), status: r.status };
    }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': k, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 128, temperature: 0 },
        }),
      },
    );
    const j = (await r.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null;
    return { ok: r.ok && Boolean(text), status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
