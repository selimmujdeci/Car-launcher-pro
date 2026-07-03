/**
 * semanticAiService.ts — Semantic NLP Engine (The AI Brain)
 *
 * Görev: RegEx motorunun anlayamadığı doğal dil sorgularını yapılandırılmış
 * niyet + parametre setine dönüştürmek.
 *
 * aiVoiceService.ts'den farkı:
 *   - POI kategorisi (RESTAURANT, GAS_STATION …) çıkarır
 *   - Duygusal/bağlamsal sorguları yorumlar ("acıktım" → RESTAURANT)
 *   - Üç aşamalı provider zinciri: Edge Function → Direct AI → Offline
 *
 * Calling path:
 *   voiceService → semanticAiService.classify() → AppIntent (via fromSemanticResult)
 *   voiceService → semanticAiService.enrichBackground() → proaktif log
 */

import type { IntentType } from '../intentEngine';
import type { VehicleContext } from '../aiVoiceService';
import { resolveApiKey, type AIProvider } from '../aiVoiceService';
import { callProcessIntent } from '../supabaseClient';
import { buildPidRegistryIntegrityPromptBlock } from './pidDescriptionGate';
import { signalWithTimeout } from '../../utils/abortCompat';
import { recordAiNetFailure, recordAiNetSuccess } from '../aiHealth';

/* ── POI Kategorileri ────────────────────────────────────────── */

export type PoiCategory =
  | 'RESTAURANT' | 'CAFE' | 'FAST_FOOD' | 'BAKERY'
  | 'GAS_STATION' | 'PARKING' | 'CAR_WASH' | 'MECHANIC'
  | 'HOSPITAL'    | 'PHARMACY' | 'CLINIC'
  | 'HOTEL'       | 'MOTEL'
  | 'SHOPPING'    | 'SUPERMARKET' | 'ATM' | 'BANK'
  | 'GENERAL';

/* ── Sonuç tipi ──────────────────────────────────────────────── */

export interface SemanticResult {
  intent:       IntentType | 'SEARCH_POI';
  category?:    PoiCategory;   // yalnızca SEARCH_POI
  query?:       string;        // normalize edilmiş arama terimi
  destination?: string;        // navigasyon hedefi
  // SET_SETTING alanları (parlaklık/wifi/bluetooth/ses/tema… beyin üzerinden):
  settingKey?:    string;      // 'brightness' | 'wifi' | 'bluetooth' | AppSettings anahtarı
  settingKind?:   string;      // 'bool' | 'enum' | 'number' | 'openTab'
  settingAction?: string;      // 'on' | 'off' | 'inc' | 'dec' | 'set' | 'toggle' | 'open'
  settingValue?:  string;      // enum değeri ya da number (yüzde)
  appName?:     string;        // OPEN_APP: açılacak uygulamanın serbest adı
  screen?:      string;        // OPEN_SCREEN: iç ekran adı
  screenAction?: string;       // OPEN_SCREEN: 'open' | 'close'
  contactName?: string;        // OPEN_PHONE: aranacak kişinin adı ("Selim", "annem")
  memoryText?:  string;        // REMEMBER/FORGET: kalıcı kişisel fact metni
  feedback:     string;        // ≤8 kelime Türkçe
  confidence:   number;        // 0–1
  source:       'edge_fn' | 'direct_ai' | 'offline';
}

/* ── Geçerli intent listesi ──────────────────────────────────── */

const VALID_INTENTS = new Set<string>([
  'SEARCH_POI',
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS', 'NAVIGATE_PLACE',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_APP', 'OPEN_SCREEN', 'OPEN_SETTINGS', 'OPEN_FAVORITES',
  'ENABLE_NIGHT_MODE', 'SET_THEME', 'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE', 'SHOW_WEATHER',
  'CHECK_VEHICLE_HEALTH', 'CLEAR_DTC_CODES', 'CHECK_MAINTENANCE',
  'OPEN_APPOINTMENT_LINK', 'UNKNOWN',
]);

const VALID_CATEGORIES = new Set<string>([
  'RESTAURANT', 'CAFE', 'FAST_FOOD', 'BAKERY',
  'GAS_STATION', 'PARKING', 'CAR_WASH', 'MECHANIC',
  'HOSPITAL', 'PHARMACY', 'CLINIC',
  'HOTEL', 'MOTEL', 'SHOPPING', 'SUPERMARKET', 'ATM', 'BANK',
  'GENERAL',
]);

/* ── Sistem Promptu ──────────────────────────────────────────── */

const BASE_SYSTEM_PROMPT = `Sen bir araç içi sesli asistan için semantik niyet motoru'sun.
Türkçe serbest metin sorgusunu analiz et ve SADECE JSON yanıt ver. Başka hiçbir şey yazma.

GÖREV: Günlük konuşma dilindeki belirsiz ve doğal sorguları anlamlı niyetlere çevir.
Özellikle:
1. Mekan/POI aramalarını kategorize et
2. Duygusal/bağlamsal sorguları niyet'e dönüştür ("acıktım" → RESTAURANT)
3. Bölgesel dil özelliklerini anla ("kanka", "hoca", argo)

JSON FORMATI:
{
  "intent": "SEARCH_POI | NAVIGATE_ADDRESS | OPEN_NAVIGATION | FIND_NEARBY_GAS | FIND_NEARBY_PARKING | OPEN_MUSIC | OPEN_PHONE | OPEN_SETTINGS | SHOW_WEATHER | CHECK_VEHICLE_HEALTH | CHECK_MAINTENANCE | UNKNOWN",
  "category": "RESTAURANT | CAFE | FAST_FOOD | BAKERY | GAS_STATION | PARKING | CAR_WASH | MECHANIC | HOSPITAL | PHARMACY | CLINIC | HOTEL | MOTEL | SHOPPING | SUPERMARKET | ATM | BANK | GENERAL",
  "query": "normalize edilmiş arama terimi (Türkçe, küçük harf)",
  "destination": "navigasyon hedefi (opsiyonel)",
  "feedback": "≤8 kelime Türkçe geri bildirim",
  "confidence": 0.0-1.0
}

ÖRNEKLER:
- "kanka buralarda iyi bir kebapçı var mı?" → {"intent":"SEARCH_POI","category":"RESTAURANT","query":"kebap","feedback":"Yakın kebapçılar aranıyor","confidence":0.96}
- "biraz yoruldum" → {"intent":"SEARCH_POI","category":"PARKING","query":"dinlenme alanı","feedback":"Yakın mola noktaları aranıyor","confidence":0.78}
- "acıktım" → {"intent":"SEARCH_POI","category":"RESTAURANT","query":"restoran","feedback":"Yakın restoranlar aranıyor","confidence":0.85}
- "yakında benzin var mı" → {"intent":"FIND_NEARBY_GAS","query":"benzin istasyonu","feedback":"Yakın benzin istasyonları","confidence":0.97}
- "eve git" → {"intent":"OPEN_NAVIGATION","destination":"home","feedback":"Eve gidiyoruz","confidence":0.99}
- "hava nasıl" → {"intent":"SHOW_WEATHER","feedback":"Hava durumu gösteriliyor","confidence":0.98}
- "abim nerede oturur bilmiyorum" → {"intent":"UNKNOWN","feedback":"Anlayamadım","confidence":0.3}`;

function buildContextPrompt(ctx?: VehicleContext): string {
  const pidBlock = `\n\n${buildPidRegistryIntegrityPromptBlock()}`;
  if (!ctx) return BASE_SYSTEM_PROMPT + pidBlock;

  const lines = [`\n\n[ARAÇ BAĞLAMI]`, `Hız: ${ctx.speedKmh} km/h`];

  if (ctx.isDriving) {
    lines.push(
      `SÜRÜŞ GÜVENLİĞİ: "feedback" zorunlu ≤8 kelime, yalnızca seslendirilecek format.`,
    );
  }

  return BASE_SYSTEM_PROMPT + lines.join('\n') + pidBlock;
}

/* ── JSON ayrıştırıcı ────────────────────────────────────────── */

function parseSemanticJson(raw: string): SemanticResult | null {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const intent = obj['intent'] as string;
    if (!intent || !VALID_INTENTS.has(intent)) return null;

    const rawCategory = obj['category'] as string | undefined;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory)
      ? (rawCategory as PoiCategory)
      : undefined;

    return {
      intent:       intent as SemanticResult['intent'],
      category,
      query:        typeof obj['query']       === 'string' ? obj['query']       : undefined,
      destination:  typeof obj['destination'] === 'string' ? obj['destination'] : undefined,
      appName:      typeof obj['appName']     === 'string' ? obj['appName']     : undefined,
      screen:       typeof obj['screen']      === 'string' ? obj['screen']      : undefined,
      screenAction: typeof obj['screenAction'] === 'string' ? obj['screenAction'] : undefined,
      feedback:     typeof obj['feedback']    === 'string' ? obj['feedback']    : 'Anlaşıldı',
      confidence:   typeof obj['confidence']  === 'number' ? obj['confidence']  : 0.7,
      source:       'direct_ai',
    };
  } catch {
    return null;
  }
}

/* ── Gemini çağrısı ──────────────────────────────────────────── */

async function _askGemini(text: string, apiKey: string, ctx?: VehicleContext): Promise<SemanticResult | null> {
  // gemini-flash-latest: yeni "AQ." anahtarlarda sabit-adlı modeller 429 veriyor (SAHA 2026-07-03).
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildContextPrompt(ctx) }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      // thinkingBudget:0 — flash-latest düşünen model; bütçesizde düşünme token'ları
      // yiyip MAX_TOKENS ile metinsiz dönüyor (SAHA 2026-07-03).
      generationConfig: { responseMimeType: 'application/json', temperature: 0.05, maxOutputTokens: 128, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: signalWithTimeout(5_000), // Chrome <103 WebView güvenli (abortCompat)
  });

  if (!resp.ok) return null;
  const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const result = parseSemanticJson(raw);
  return result ? { ...result, source: 'direct_ai' } : null;
}

/* ── Claude Haiku çağrısı ────────────────────────────────────── */

async function _askHaiku(text: string, apiKey: string, ctx?: VehicleContext): Promise<SemanticResult | null> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: ctx?.isDriving ? 128 : 200,
      system:     buildContextPrompt(ctx),
      messages:   [{ role: 'user', content: text }],
    }),
    signal: signalWithTimeout(5_000), // Chrome <103 WebView güvenli (abortCompat)
  });

  if (!resp.ok) return null;
  const data = await resp.json() as { content?: { type?: string; text?: string }[] };
  const raw = data.content?.find((c) => c.type === 'text')?.text ?? '';
  const result = parseSemanticJson(raw);
  return result ? { ...result, source: 'direct_ai' } : null;
}

/* ── Offline geri dönüş ──────────────────────────────────────── */

function _offlineFallback(): SemanticResult {
  return {
    intent:     'UNKNOWN',
    feedback:   'İnternet yok, temel komutları kullanabilirsin',
    confidence: 0,
    source:     'offline',
  };
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Kullanıcı metnini tam anlamıyla sınıflandırır.
 * Üç aşamalı zincir:
 *   1. Supabase Edge Function `process_intent` (yapılandırıldıysa)
 *   2. Direct AI (Gemini veya Haiku)
 *   3. Offline fallback
 *
 * @param text      Ham kullanıcı metni
 * @param provider  AI sağlayıcısı (voiceService'den gelir)
 * @param apiKey    Çözümlenmiş API anahtarı
 * @param ctx       Araç bağlamı (sürüş modu, hız vb.)
 */
export async function classifySemantic(
  text:     string,
  provider: AIProvider,
  apiKey:   string,
  ctx?:     VehicleContext,
): Promise<SemanticResult> {
  // ── 1. Supabase Edge Function ───────────────────────────────
  try {
    const edgeResult = await callProcessIntent(text, {
      speedKmh:    ctx?.speedKmh,
      isDriving:   ctx?.isDriving,
      drivingMode: ctx?.drivingMode,
    });
    if (edgeResult) return { ...(edgeResult as unknown as SemanticResult), source: 'edge_fn' as const };
  } catch {
    // Edge function yapılandırılmamış veya ulaşılamıyor — devam
  }

  // ── 2. Direct AI ────────────────────────────────────────────
  if (!navigator.onLine) return _offlineFallback();

  const resolvedKey = resolveApiKey(provider, apiKey);
  if (provider === 'none' || !resolvedKey) return _offlineFallback();

  try {
    let result: SemanticResult | null = null;
    if (provider === 'gemini') result = await _askGemini(text, resolvedKey, ctx);
    if (provider === 'haiku')  result = await _askHaiku(text, resolvedKey, ctx);
    if (result) { recordAiNetSuccess(); return result; }
  } catch {
    recordAiNetFailure(); // ağ hatası/timeout — devre kesici art arda hatada AI'yı kapatır
  }

  // ── 3. Offline fallback ─────────────────────────────────────
  return _offlineFallback();
}

/**
 * Düşük güvenlikli (0.5–0.99) yerel eşleşmeleri arka planda semantik
 * servise göndererek proaktif bağlam logu oluşturur.
 * Sonuç beklenmez — fire-and-forget.
 */
export function enrichBackground(
  text:     string,
  provider: AIProvider,
  apiKey:   string,
  ctx?:     VehicleContext,
): void {
  if (!navigator.onLine) return;
  const resolvedKey = resolveApiKey(provider, apiKey);
  if (provider === 'none' || !resolvedKey) return;

  // Sessizce çalış — UI'a hiçbir etki yok
  void classifySemantic(text, provider, apiKey, ctx).catch(() => undefined);
}

/**
 * POI sorgusunu harita aramasına uygun Türkçe string'e dönüştürür.
 * Örn: { category: 'RESTAURANT', query: 'kebap' } → "yakın kebap restoranı"
 */
export function buildPoiSearchQuery(result: SemanticResult): string {
  const CAT_LABELS: Partial<Record<PoiCategory, string>> = {
    RESTAURANT:  'restoran',
    CAFE:        'kafe',
    FAST_FOOD:   'fast food',
    BAKERY:      'fırın',
    GAS_STATION: 'benzin istasyonu',
    PARKING:     'park yeri',
    CAR_WASH:    'oto yıkama',
    MECHANIC:    'oto tamir',
    HOSPITAL:    'hastane',
    PHARMACY:    'eczane',
    CLINIC:      'klinik',
    HOTEL:       'otel',
    MOTEL:       'motel',
    SHOPPING:    'alışveriş',
    SUPERMARKET: 'market',
    ATM:         'ATM',
    BANK:        'banka',
    GENERAL:     'yer',
  };

  const queryTerm = result.query ?? (result.category ? CAT_LABELS[result.category] : undefined) ?? 'yer';
  return `yakın ${queryTerm}`;
}
