/**
 * AI Voice Service — Gemini ve Claude Haiku entegrasyonu.
 *
 * Her iki model de aynı JSON çıktı formatını döndürür:
 *   { intent, payload, confidence, feedback }
 *
 * fromAIResponse() (intentEngine.ts) bu yanıtı AppIntent'e çevirir.
 * İnternet yoksa veya API key yoksa null döner → offline fallback devreye girer.
 *
 * GÜVENLİK: API key'ler localStorage'da saklanır (Zustand persist).
 * Sunucu yok — trafik doğrudan cihaz ↔ API arasında.
 */

import type { IntentType } from './intentEngine';

/* ── Types ─────────────────────────────────────────────────── */

export type AIProvider = 'gemini' | 'haiku' | 'none';

export interface AIVoiceResult {
  intent:     IntentType;
  payload:    Record<string, unknown>;
  confidence: number;
  feedback:   string;
}

/**
 * Araç bağlamı — AI'ya anlık sürüş durumu aktarılır.
 *
 * ISO 15008 & NHTSA Distracted Driving Guidelines:
 *   Araç hareket halindeyken AI yanıtları kısa (≤ 8 kelime) ve
 *   yalnızca TTS ile seslendirilecek formatta olmalıdır.
 *   Uzun metin yanıtları sürücünün dikkatini ekrana çeker.
 */
export interface VehicleContext {
  /** Anlık hız (km/h) */
  speedKmh:    number;
  /** Sürüş modu tespiti */
  drivingMode: 'idle' | 'normal' | 'driving';
  /** true ise yanıt ≤ 8 kelime, saf TTS formatı */
  isDriving:   boolean;
}

/* ── System prompt ─────────────────────────────────────────── */

const INTENT_LIST = [
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'NAVIGATE_PLACE',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_SETTINGS', 'OPEN_FAVORITES',
  'ENABLE_NIGHT_MODE', 'SET_THEME', 'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE', 'SHOW_WEATHER', 'UNKNOWN',
].join(' | ');

const BASE_SYSTEM_PROMPT = `Sen bir araç içi sesli asistan komut ayrıştırıcısısın.
Türkçe kullanıcı girdisini analiz et ve SADECE aşağıdaki JSON formatında yanıt ver.
Başka hiçbir şey yazma, sadece JSON.

JSON formatı:
{
  "intent": "${INTENT_LIST}",
  "payload": {
    "destination": "navigasyon hedefi (opsiyonel)",
    "targetApp": "maps | spotify | youtube | phone (opsiyonel)",
    "mode": "dark | oled | driving (opsiyonel)",
    "searchQuery": "müzik arama sorgusu (opsiyonel)"
  },
  "confidence": 0.0-1.0,
  "feedback": "Kısa Türkçe geri bildirim (ör: Eve gidiyoruz)"
}

Örnekler:
- "eve git" → {"intent":"OPEN_NAVIGATION","payload":{"destination":"home","targetApp":"maps"},"confidence":0.97,"feedback":"Eve gidiyoruz"}
- "müziği aç" → {"intent":"OPEN_MUSIC","payload":{"targetApp":"spotify"},"confidence":0.95,"feedback":"Müzik başlatılıyor"}
- "biraz yoruldum mola versem" → {"intent":"FIND_NEARBY_PARKING","payload":{},"confidence":0.82,"feedback":"Yakın dinlenme alanı aranıyor"}`;

/**
 * Anlık araç bağlamını system prompt'a enjekte eder.
 *
 * Sürüş modunda sürücünün dikkatini dağıtmamak için AI'ya
 * kısa TTS yanıt formatı zorunlu kılınır (NHTSA §3.4 uyumlu).
 */
function buildSystemPrompt(ctx?: VehicleContext): string {
  if (!ctx) return BASE_SYSTEM_PROMPT;

  const contextLines: string[] = [];
  contextLines.push(`\n\n[ARAÇ BAĞLAMI]`);
  contextLines.push(`Anlık hız: ${ctx.speedKmh} km/h`);
  contextLines.push(`Sürüş modu: ${ctx.drivingMode}`);

  if (ctx.isDriving) {
    contextLines.push(
      `SÜRÜŞ GÜVENLİĞİ KURALI: Araç hareket halinde (${ctx.speedKmh} km/h).`,
      `"feedback" alanı ZORUNLU olarak ≤ 8 kelime, yalnızca sesli okunabilir formatta olmalı.`,
      `Ekranda gösterilecek uzun metin sürücünün dikkatini dağıtır — kesinlikle kısalt.`,
    );
  }

  return BASE_SYSTEM_PROMPT + contextLines.join('\n');
}

/* ── Response parser ───────────────────────────────────────── */

const VALID_INTENTS = new Set<string>([
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'NAVIGATE_PLACE',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_SETTINGS', 'OPEN_FAVORITES',
  'ENABLE_NIGHT_MODE', 'SET_THEME', 'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE', 'SHOW_WEATHER', 'UNKNOWN',
]);

function parseAIJson(text: string): AIVoiceResult | null {
  try {
    // Strip markdown code blocks if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const intent = obj['intent'] as string;
    if (!intent || !VALID_INTENTS.has(intent)) return null;

    return {
      intent:     intent as IntentType,
      payload:    (obj['payload'] as Record<string, unknown>) ?? {},
      confidence: typeof obj['confidence'] === 'number' ? obj['confidence'] : 0.75,
      feedback:   typeof obj['feedback'] === 'string' ? obj['feedback'] : 'Anlaşıldı',
    };
  } catch {
    return null;
  }
}

/* ── Gemini ────────────────────────────────────────────────── */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function askGemini(text: string, apiKey: string, ctx?: VehicleContext): Promise<AIVoiceResult | null> {
  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 256,
    },
  };

  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) return null;

  const data = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseAIJson(raw);
}

/* ── Claude Haiku ──────────────────────────────────────────── */

const HAIKU_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL    = 'claude-haiku-4-5-20251001';

async function askHaiku(text: string, apiKey: string, ctx?: VehicleContext): Promise<AIVoiceResult | null> {
  const body = {
    model:      HAIKU_MODEL,
    max_tokens: ctx?.isDriving ? 128 : 256, // Sürüşte daha kısa yanıt → düşük gecikme
    system:     buildSystemPrompt(ctx),
    messages:   [{ role: 'user', content: text }],
  };

  const resp = await fetch(HAIKU_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) return null;

  const data = await resp.json() as {
    content?: { type?: string; text?: string }[]
  };
  const raw = data.content?.find((c) => c.type === 'text')?.text ?? '';
  return parseAIJson(raw);
}

/* ── Public API ────────────────────────────────────────────── */

/**
 * Env-based key fallbacks — if no key is set in settings,
 * use VITE_GEMINI_API_KEY / VITE_CLAUDE_API_KEY from .env
 */
export function getEnvGeminiKey(): string {
  return (import.meta.env['VITE_GEMINI_API_KEY'] as string | undefined) ?? '';
}

export function getEnvHaikuKey(): string {
  return (import.meta.env['VITE_CLAUDE_API_KEY'] as string | undefined) ?? '';
}

/**
 * Resolve effective API key: settings key takes priority, env key is fallback.
 */
export function resolveApiKey(provider: AIProvider, settingsKey: string): string {
  if (settingsKey.trim()) return settingsKey.trim();
  if (provider === 'gemini') return getEnvGeminiKey();
  if (provider === 'haiku')  return getEnvHaikuKey();
  return '';
}

/**
 * Send text to AI provider. Returns null if:
 * - provider is 'none'
 * - no API key (neither settings nor env)
 * - network unavailable
 * - API error / timeout
 * - malformed response
 */
/**
 * AI'ya metin gönder ve yapılandırılmış intent al.
 *
 * @param text     Kullanıcı komutu (Türkçe serbest metin)
 * @param provider AI sağlayıcısı (gemini | haiku | none)
 * @param apiKey   API anahtarı (settings veya .env'den)
 * @param ctx      Araç bağlamı — sürüş modunda zorunlu kısa yanıt sağlar
 */
export async function askAI(
  text:     string,
  provider: AIProvider,
  apiKey:   string,
  ctx?:     VehicleContext,
): Promise<AIVoiceResult | null> {
  const key = resolveApiKey(provider, apiKey);
  if (provider === 'none' || !key || !navigator.onLine) return null;

  try {
    if (provider === 'gemini') return await askGemini(text, key, ctx);
    if (provider === 'haiku')  return await askHaiku(text, key, ctx);
    return null;
  } catch {
    // Network error, timeout, etc. — silent fallback
    return null;
  }
}

/**
 * Quick connectivity + key check — used by settings UI to show status.
 */
export async function testAIConnection(
  provider: AIProvider,
  apiKey:   string,
): Promise<{ ok: boolean; message: string }> {
  const key = resolveApiKey(provider, apiKey);
  if (!key) return { ok: false, message: 'API key girilmedi (.env veya ayarlardan)' };
  if (!navigator.onLine) return { ok: false, message: 'İnternet bağlantısı yok' };

  try {
    const result = await askAI('merhaba', provider, apiKey);
    if (result) return { ok: true, message: 'Bağlantı başarılı' };
    return { ok: false, message: 'Geçersiz yanıt — API key\'i kontrol edin' };
  } catch {
    return { ok: false, message: 'Bağlantı hatası' };
  }
}
