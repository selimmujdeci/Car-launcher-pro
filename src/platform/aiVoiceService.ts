/**
 * AI Voice Service — Gemini ve Claude Haiku entegrasyonu.
 *
 * Her iki model de aynı JSON çıktı formatını döndürür:
 *   { intent, payload, confidence, feedback }
 *
 * fromAIResponse() (intentEngine.ts) bu yanıtı AppIntent'e çevirir.
 * İnternet yoksa veya API key yoksa null döner → offline fallback devreye girer.
 *
 * GÜVENLİK: API anahtarları localStorage'da DEĞİL, sensitiveKeyStore üzerinden
 * (native: Android Keystore + EncryptedSharedPreferences; web: AES-256-GCM)
 * saklanır. Sunucu yok — trafik doğrudan cihaz ↔ API arasında (BYOK).
 */

import {
  geminiChatEndpoint, DEFAULT_GEMINI_MODEL,
  geminiThinkingConfig, noteGeminiThinkingRejectedIf400,
} from './ai/gateway/models';
import type { IntentType } from './intentEngine';
import type { MaintenanceAssessment } from './vehicleMaintenanceService';
import type { DTCCode } from './dtcService';
import { buildPidRegistryIntegrityPromptBlock } from './ai/pidDescriptionGate';
import { signalWithTimeout } from '../utils/abortCompat';
import { recordAiNetFailure, recordAiNetSuccess } from './aiHealth';
import { errorKindFromException } from './ai/aiOfflineReason';

/* ── Types ─────────────────────────────────────────────────── */

export type AIProvider = 'gemini' | 'haiku' | 'groq' | 'none';

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
  /**
   * Anlık hız (km/h). **`null` = BİLİNMİYOR** — "0 km/h" DEĞİL (MAVI-M2).
   * Kanıtı olmayan hız sıfır yazılmaz; tüketici `null`u ayrı ele almalıdır.
   */
  speedKmh:    number | null;
  /** Sürüş modu — SUNUM etiketi (prompt/telemetri). Güvenlik kararı `motionState` iledir. */
  drivingMode: 'idle' | 'normal' | 'driving';
  /** DOĞRULANMIŞ hareket. `true` ise yanıt ≤ 8 kelime, saf TTS formatı. */
  isDriving:   boolean;
  /**
   * MAVI-M2 · ÜÇ DURUMLU hareket hükmü — `unknown` asla `false`a indirgenmez.
   * Riskli eylem kapıları `isDriving`e DEĞİL buna bakar ("veri yok" ≠ "araç duruyor").
   * Alan YOKSA (eski çağıranlar: uzak komut yolu) sözleşme değişmez — çağıran
   * geriye-uyumlu olarak `isDriving`e düşer. Kaynak: `assistant/maviVehicleContext`.
   */
  motionState?: 'moving' | 'stopped' | 'unknown';
  /** Hareket hükmünün kanıt kaynağı (gözlemlenebilirlik). */
  motionSource?: 'obd_speed' | 'gps_doppler' | 'none';
  /** Geri vites. `undefined` = BİLİNMİYOR (canlı kaynak yok) — `false` varsayılmaz. */
  reverseActive?: boolean;
  /** Kontak. `undefined` = BİLİNMİYOR — açık/kapalı varsayılmaz. */
  ignitionOn?: boolean;
  /** Araç telemetrisi tazelik penceresi içinde mi (protokol kadansına göre). */
  dataFresh?: boolean;
  /** Son gerçek telemetri paketinin yaşı (ms). `null` = hiç veri gelmedi. */
  lastPacketAgeMs?: number | null;
  /** Bağlamın çözüldüğü an (ms) — request boyunca değişmezliğin damgası. */
  resolvedAtMs?: number;
  /** Aktif DTC arıza kodları — AI teşhis bağlamı için (dtcService kanonik tipi). */
  activeDTCCodes?: DTCCode[];
  /** Bakım durumu — vehicleMaintenanceService'den gelen gerçek tip */
  maintenanceAssessments?: MaintenanceAssessment[];
}

/* ── System prompt ─────────────────────────────────────────── */

const INTENT_LIST = [
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'NAVIGATE_PLACE',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING', 'FIND_NEARBY_REST_AREA',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_SETTINGS', 'OPEN_FAVORITES',
  'ENABLE_NIGHT_MODE', 'SET_THEME', 'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE', 'SHOW_WEATHER',
  'CHECK_VEHICLE_HEALTH', 'CLEAR_DTC_CODES', 'CHECK_MAINTENANCE', 'OPEN_APPOINTMENT_LINK',
  'UNKNOWN',
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
- "biraz yoruldum mola versem" → {"intent":"FIND_NEARBY_REST_AREA","payload":{},"confidence":0.82,"feedback":"Yakın dinlenme tesisi aranıyor"}
- "araba park edecek yer bul" → {"intent":"FIND_NEARBY_PARKING","payload":{},"confidence":0.9,"feedback":"Yakın otopark aranıyor"}`;

/**
 * Anlık araç bağlamını + DTC teşhis verisini system prompt'a enjekte eder.
 *
 * Sürüş modunda sürücünün dikkatini dağıtmamak için AI'ya
 * kısa TTS yanıt formatı zorunlu kılınır (NHTSA §3.4 uyumlu).
 */
function buildSystemPrompt(ctx?: VehicleContext): string {
  if (!ctx) return BASE_SYSTEM_PROMPT;

  const contextLines: string[] = [];
  contextLines.push(`\n\n[ARAÇ BAĞLAMI]`);
  // MAVI-M2: hız BİLİNMİYORSA satır hiç yazılmaz — "null km/h"/"0 km/h" uydurulmaz.
  contextLines.push(
    typeof ctx.speedKmh === 'number' ? `Anlık hız: ${ctx.speedKmh} km/h` : `Anlık hız: bilinmiyor`,
  );
  contextLines.push(`Sürüş modu: ${ctx.drivingMode}`);

  if (ctx.isDriving) {
    contextLines.push(
      typeof ctx.speedKmh === 'number'
        ? `SÜRÜŞ GÜVENLİĞİ KURALI: Araç hareket halinde (${ctx.speedKmh} km/h).`
        : `SÜRÜŞ GÜVENLİĞİ KURALI: Araç hareket halinde.`,
      `"feedback" alanı ZORUNLU olarak ≤ 8 kelime, yalnızca sesli okunabilir formatta olmalı.`,
      `Ekranda gösterilecek uzun metin sürücünün dikkatini dağıtır — kesinlikle kısalt.`,
    );
  }

  if (ctx.activeDTCCodes && ctx.activeDTCCodes.length > 0) {
    contextLines.push(`\n[ARAÇ TEŞHİS KAYITLARI]`);
    contextLines.push(`Aktif arıza kodları (${ctx.activeDTCCodes.length} adet):`);
    for (const dtc of ctx.activeDTCCodes) {
      const sev = dtc.severity === 'critical' ? 'KRİTİK' : dtc.severity === 'warning' ? 'UYARI' : 'BİLGİ';
      contextLines.push(`  - ${dtc.code} | ${dtc.system} | ${sev}: ${dtc.description}`);
    }
    contextLines.push(
      ``,
      `AKILLI DOKTOR KURALI:`,
      `- Teknik jargon kullanma. "Katalitik konvertör verimliliği düşük" yerine "Egzoz sistemi sorunlu" de.`,
      `- Sürüş güvenliğini önceliklendir: KRİTİK → "Hemen dur, motoru söndür" / UYARI → "Müsait zamanda servise uğra".`,
      `- Kullanıcı "arabanın nesi var?" veya "arıza var mı?" sorarsa bu kodlara dayanarak yanıt ver.`,
      `- intent: CHECK_VEHICLE_HEALTH olarak döndür.`,
    );
  } else if (ctx.activeDTCCodes !== undefined) {
    contextLines.push(`\n[ARAÇ TEŞHİS KAYITLARI]`);
    contextLines.push(`Aktif arıza kodu yok — araç sistemleri temiz.`);
  }

  if (ctx.maintenanceAssessments && ctx.maintenanceAssessments.length > 0) {
    contextLines.push(`\n[BAKIM VE SERVİS DURUMU]`);
    for (const maint of ctx.maintenanceAssessments) {
      contextLines.push(`- ${maint.label}: ${maint.message} (Statü: ${maint.status})`);
      if (maint.appointmentSuggestion) {
        contextLines.push(`  → ${maint.appointmentSuggestion}`);
      }
    }
    contextLines.push(
      ``,
      `KURAL: Kullanıcı araç bakımıyla ilgili soru sorarsa yukarıdaki verileri baz al.`,
      `- KRİTİK durumlar için randevu önerisini doğrudan söyle (ör: "Yağ bakımına 200 km kaldı, servise randevu oluşturayım mı?").`,
      `- Randevu için intent: OPEN_APPOINTMENT_LINK döndür.`,
    );
  }

  return `${BASE_SYSTEM_PROMPT}${contextLines.join('\n')}\n\n${buildPidRegistryIntegrityPromptBlock()}`;
}

/* ── Response parser ───────────────────────────────────────── */

const VALID_INTENTS = new Set<string>([
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'NAVIGATE_PLACE',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING', 'FIND_NEARBY_REST_AREA',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_SETTINGS', 'OPEN_FAVORITES',
  'ENABLE_NIGHT_MODE', 'SET_THEME', 'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE', 'SHOW_WEATHER',
  'CHECK_VEHICLE_HEALTH', 'CLEAR_DTC_CODES', 'CHECK_MAINTENANCE', 'OPEN_APPOINTMENT_LINK',
  'UNKNOWN',
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
  // gemini-flash-latest: yeni "AQ." anahtarların ücretsiz katmanı sabit-adlı eski
  // modellerde (gemini-2.0-flash) anında 429 veriyor; flash-latest 200 dönüyor
  // (SAHA 2026-07-03: kullanıcı anahtarıyla iki model de canlı test edildi).
  geminiChatEndpoint();

async function askGemini(text: string, apiKey: string, ctx?: VehicleContext): Promise<AIVoiceResult | null> {
  const mkBody = (): unknown => ({
    system_instruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 256,
      // DÜŞÜNEN model: bütçesiz istekte düşünme 256 token'ı yiyip MAX_TOKENS +
      // markdown-sargılı yarım metin dönüyordu ("Geçersiz yanıt"). Araç içi
      // komutta gecikme > derinlik → düşünme kapalı (SAHA 2026-07-03).
      // SAHA 2026-09-11: alanı REDDEDEN modellerde bu 400 üretiyordu → alan artık
      // sahibine sorularak eklenir ve ret bir kez öğrenilince istek tekrarlanır.
      ...geminiThinkingConfig(DEFAULT_GEMINI_MODEL),
    },
  });

  const send = (): Promise<Response> => fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    /* Gövde HER denemede yeniden kurulur: ret öğrenildiyse ikinci istek alansız
       gider (sabit bir gövdeyi tekrar göndermek aynı 400'ü üretirdi). */
    body: JSON.stringify(mkBody()),
    signal: signalWithTimeout(3000), // Chrome <103 WebView güvenli (abortCompat)
  });

  let resp = await send();
  if (await noteGeminiThinkingRejectedIf400(DEFAULT_GEMINI_MODEL, resp)) resp = await send();

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

/* ── Groq (OpenAI-uyumlu) ──────────────────────────────────── */

// Groq endpoint — OpenAI Chat Completions formatını destekler.
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// Groq model adları değişebilir — güncel listeyi console.groq.com/docs adresinden doğrula.
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function askGroq(text: string, apiKey: string, ctx?: VehicleContext): Promise<AIVoiceResult | null> {
  const body = {
    model:           GROQ_MODEL,
    max_tokens:      ctx?.isDriving ? 128 : 256, // Sürüşte daha kısa yanıt → düşük gecikme
    temperature:     0.1,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system' as const, content: buildSystemPrompt(ctx) },
      { role: 'user'   as const, content: text },
    ],
  };

  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: signalWithTimeout(3000), // Chrome <103 WebView güvenli (abortCompat)
  });

  if (!resp.ok) return null;

  const data = await resp.json() as {
    choices?: { message?: { content?: string } }[]
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  return parseAIJson(raw);
}

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
      // WebView/tarayıcı CORS: bu header olmadan Anthropic API preflight'ı reddeder.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: signalWithTimeout(3000), // Chrome <103 WebView güvenli (abortCompat)
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

export function getEnvGroqKey(): string {
  return (import.meta.env['VITE_GROQ_API_KEY'] as string | undefined) ?? '';
}

/**
 * Resolve effective API key: settings key takes priority, env key is fallback.
 */
export function resolveApiKey(provider: AIProvider, settingsKey: string): string {
  if (settingsKey.trim()) return settingsKey.trim();
  if (provider === 'gemini') return getEnvGeminiKey();
  if (provider === 'haiku')  return getEnvHaikuKey();
  if (provider === 'groq')   return getEnvGroqKey();
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
    let result: AIVoiceResult | null = null;
    if (provider === 'gemini') result = await askGemini(text, key, ctx);
    if (provider === 'haiku')  result = await askHaiku(text, key, ctx);
    if (provider === 'groq')   result = await askGroq(text, key, ctx);
    if (result) recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
    return result;
  } catch (e) {
    // Ağ hatası/timeout — yerel zincire düşülür. SESSİZ DEĞİL: sebep kodu +
    // künye kaydedilir (SAHA 2026-07-22, "sessizce offline'a düşmek yasak").
    recordAiNetFailure({ provider, exceptionType: errorKindFromException(e) });
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
