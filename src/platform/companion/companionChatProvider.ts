/**
 * companionChatProvider.ts — "Yol Arkadaşım" AI-FIRST sohbet hattı.
 *
 * MİMARİ (revizyon 2026-06-11 — kullanıcı onaylı yön değişikliği):
 *   Kullanıcı konuşur → Safety Filter (voiceService._voiceCogPaused)
 *     → Companion Router (voiceService: net komut ≥0.7 → komut yolu; gerisi buraya)
 *     → GEMİNİ (öncelikli, serbest sohbet) → TTS
 *   Offline'a YALNIZ şu durumlarda düşülür: internet yok · API key yok ·
 *   Gemini hata/timeout · 429 rate-limit (60 sn soğuma).
 *
 * Keyword listeleri ANA YOL DEĞİLDİR: classifySmalltalk yalnız offline
 * fallback'in kategori ipucudur. Companion açıkken komut olmayan HER cümle
 * önce Gemini'ye gider — "nasılsın" da, listede olmayan "bugün işler ters
 * gitti" de.
 *
 * Bağlam kuralı (Commit 2 garantisi): OBD/CAN HAM VERİSİ Gemini'ye GİTMEZ.
 * Prompt'a companionContext yorumlayıcılarının çıktısı girer
 * ("fuel=23" değil → "Yakıt azalıyor, yüzde 23. ... yaklaşık 150 kilometre").
 *
 * Gizlilik (mimari §2.5): konum/VIN/plaka prompt'a girmez; sohbet geçmişi
 * yalnız RAM (persist yok); kimlik alanları resolveCompanionIdentity'den
 * sanitize gelir (prompt injection yapısal engelli).
 *
 * Proaktif konuşmalar bu hatta DEĞİLDİR (§2.8): V1'de şablon kalır.
 */

import { useStore } from '../../store/useStore';
import { resolveCompanionIdentity, type CompanionIdentity } from './companionIdentity';
import { interpretFuel, interpretEngineTempConcern } from './companionContext';
import { tryOfflineConversation } from '../offlineConversationEngine';
import { onOBDData } from '../obdService';
import type { SemanticResult } from '../ai/semanticAiService';

/* ── Tipler ─────────────────────────────────────────────────── */

export type CompanionChatRoute = 'companion_gemini' | 'companion_offline';

export interface CompanionChatResult {
  response: string;
  route:    CompanionChatRoute;
}

export interface CompanionChatOpts {
  isDriving?: boolean;
  speedKmh?:  number;
  /** voiceService'in çözdüğü aktif provider ('gemini' dışında sohbet yok). */
  provider?:  string;
  /** resolveApiKey çıktısı — boş string = key yok. */
  apiKey?:    string;
  hasNet?:    boolean;
}

/* ── Offline kategori ipuçları (ANA YOL DEĞİL — yalnız fallback) ── */

/** offlineConversationEngine.norm ile aynı normalize (bağımlılık almadan). */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type SmalltalkKind = 'greeting' | 'howareyou' | 'bored' | 'chat' | 'fatigue' | 'thanks';

const SMALLTALK: ReadonlyArray<{ kind: SmalltalkKind; kw: readonly string[] }> = [
  { kind: 'howareyou', kw: ['nasilsin', 'nasil misin', 'naber', 'ne haber', 'ne var ne yok',
                            'iyi misin', 'keyifler nasil', 'keyfin nasil', 'gunun nasil'] },
  { kind: 'greeting',  kw: ['merhaba', 'selam', 'gunaydin', 'iyi aksamlar', 'iyi geceler'] },
  { kind: 'bored',     kw: ['canim sikildi', 'sikildim', 'cok sikici', 'moralim bozuk',
                            'kotu hissediyorum', 'can sikiyor'] },
  { kind: 'chat',      kw: ['sohbet edelim', 'sohbet et', 'muhabbet edelim', 'konusalim',
                            'bir sey anlat', 'bana bir sey anlat', 'hikaye anlat', 'anlat bana',
                            'benimle konus'] },
  { kind: 'fatigue',   kw: ['yorgunum', 'yoruldum', 'uykum geldi', 'uykum var'] },
  { kind: 'thanks',    kw: ['tesekkurler', 'tesekkur ederim', 'sagol', 'eyvallah'] },
];

/** Offline fallback kategori ipucu; eşleşme yoksa null. ROUTE KARARI DEĞİLDİR. */
export function classifySmalltalk(raw: string): SmalltalkKind | null {
  const n = norm(raw);
  if (!n) return null;
  for (const { kind, kw } of SMALLTALK) {
    for (const k of kw) {
      if (n === k || n.includes(k)) return kind;
    }
  }
  return null;
}

/* ── RAM sohbet geçmişi (persist YOK — gizlilik §2.5) ───────── */

interface ChatTurn { role: 'user' | 'model'; text: string }

const MAX_HISTORY_TURNS = 8; // 4 kullanıcı + 4 model
let _history: ChatTurn[] = [];

function pushHistory(role: ChatTurn['role'], text: string): void {
  _history.push({ role, text });
  if (_history.length > MAX_HISTORY_TURNS) _history = _history.slice(-MAX_HISTORY_TURNS);
}

/* ── 429 rate-limit soğuma penceresi ────────────────────────── */

export const RATE_LIMIT_COOLDOWN_MS = 60_000;
let _rateLimitedUntil = 0;

function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** @internal — testler arası izolasyon. */
export function _resetCompanionChatForTest(): void {
  _history = [];
  _offlineCounter = 0;
  _rateLimitedUntil = 0;
}

/* ── Yorumlanmış araç bağlamı (HAM VERİ DEĞİL) ──────────────── */

/**
 * OBD anlık verisini Commit 2 yorumlayıcılarından geçirip insan dili
 * bağlam cümlesi üretir. OBD yoksa/bozuksa boş string (prompt'a girmez).
 * Tek seferlik abone ol/ayrıl deseni: offlineConversationEngine.carSnapshot
 * ile aynı (senkron son-değer yakalama).
 */
function buildInterpretedVehicleContext(): string {
  let line = '';
  try {
    const unsub = onOBDData((d) => {
      const rangeKm = d.estimatedRangeKm >= 0 ? d.estimatedRangeKm
                    : (d.range >= 0 ? d.range : undefined);
      const parts = [
        interpretFuel(d.fuelLevel, rangeKm),
        interpretEngineTempConcern(d.engineTemp),
      ].filter((p): p is string => p !== null);
      line = parts.join(' ');
    });
    unsub();
  } catch { /* OBD bağlı değil — bağlamsız sohbet */ }
  return line;
}

/* ── Gemini sohbet çağrısı ──────────────────────────────────── */

const GEMINI_CHAT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_TIMEOUT_MS = 6000;

function buildCompanionSystemPrompt(id: CompanionIdentity, isDriving: boolean, vehicleContext: string): string {
  // Hitap her cümlede TEKRARLANMAZ — "her cümlede isim" robotik algının
  // ana kaynaklarından (saha geri bildirimi 2026-06-11).
  const callsign = id.userCallsign
    ? `Kullanıcıya ara sıra "${id.userCallsign}" diye hitap edebilirsin ama her cümlede kullanma.`
    : 'Kullanıcıya hitap kullanma.';
  const persona: Record<string, string> = {
    sessiz:      'Az ve öz konuş, yalnız sorulana cevap ver.',
    samimi:      'Sıcak ve doğal bir yol arkadaşı gibi konuş.',
    neseli:      'Enerjik ve pozitif konuş, hafif espri yapabilirsin.',
    profesyonel: 'Kısa, net ve resmi konuş.',
  };
  // Sürüşte kısa ama DOĞAL: "tek cümle robot" değil, 2-3 kısa cümle
  // (ISO 15008 dikkat sınırı korunur; eski "8 kelime" kuralı sohbeti öldürüyordu).
  const driving = isDriving
    ? 'Sürücü ŞU AN ARAÇ KULLANIYOR: en fazla 2-3 kısa cümleyle, sade ve net cevap ver.'
    : 'En fazla 3 doğal cümleyle cevap ver.';
  const lines = [
    `Sen "${id.assistantName}" adında, araçta sürücüye eşlik eden Türkçe konuşan bir yol arkadaşısın.`,
    'Doğal ve akıcı konuş; robotik, kalıp ya da tek kelimelik cevaplar verme.',
    persona[id.personality],
    callsign,
    driving,
    'Aynı açılış kalıplarını ve cümleleri tekrar etme.',
    'Liste, madde işareti, emoji, markdown kullanma; yalnız düz konuşma metni.',
  ];
  if (vehicleContext) {
    lines.push(`Araç bağlamı (yorumlanmış): ${vehicleContext} Bu bilgiyi yalnız konuyla ilgiliyse doğal biçimde kullan.`);
  } else {
    lines.push(
      'Araç verisine (hız, yakıt, sıcaklık) şu an erişimin yok. Sorulursa bunu teknik hata mesajı gibi değil, ' +
      'doğal bir dille söyle ("şu an araçtan veri alamıyorum ama sürüşü takip ediyorum" gibi); asla veri uydurma. ' +
      'Günlük sohbette araç verisinden hiç bahsetme.',
    );
  }
  return lines.join(' ');
}

async function askCompanionGemini(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
): Promise<string | null> {
  const contents = [
    ..._history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text }] },
  ];
  const body = {
    system_instruction: {
      parts: [{ text: buildCompanionSystemPrompt(id, isDriving, buildInterpretedVehicleContext()) }],
    },
    contents,
    generationConfig: {
      temperature:     0.7,
      // 2-3 doğal cümleye alan tanır (eski 60/120 cevapları ortadan kesiyordu);
      // üst sınır yine TTS kırpma katmanıyla (aşağıda) sigortalı.
      maxOutputTokens: isDriving ? 100 : 160,
    },
  };

  const resp = await fetch(`${GEMINI_CHAT_ENDPOINT}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (resp.status === 429) {
    // Rate limit: soğuma penceresi boyunca Gemini denenmez (kullanıcı faturası
    // + art arda başarısız istek gecikmesi). Pencere boyunca offline yanıtlar.
    _rateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS;
    return null;
  }
  if (!resp.ok) return null;

  const data = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  };
  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!raw) return null;
  // TTS güvenliği: tek satıra indir, aşırı uzunsa kırp (dikkat dağıtma — §2.1).
  // Kırpma cümle sınırında yapılır — yarıda kesilen cümle robotik algı yaratır.
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= 300) return flat;
  const head = flat.slice(0, 297);
  const lastSentenceEnd = Math.max(
    head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
  );
  return lastSentenceEnd > 120 ? head.slice(0, lastSentenceEnd + 1) : `${head}...`;
}

/* ── Offline fallback yanıtları ─────────────────────────────── */

// Deterministik rotasyon (Math.random yok → testler kararlı, tekrar hissi az)
let _offlineCounter = 0;

const OFFLINE_REPLIES: Record<SmalltalkKind, { full: string[]; short: string }> = {
  greeting: {
    full: ['Merhaba! Yolculuk boyunca buradayım.', 'Selam! Hazırsan yola devam.'],
    short: 'Merhaba!',
  },
  howareyou: {
    full: ['İyiyim, teşekkürler. Sen nasılsın, yolculuk nasıl gidiyor?',
           'Gayet iyiyim. Bir şeye ihtiyacın olursa söylemen yeter.'],
    short: 'İyiyim, teşekkürler!',
  },
  bored: {
    full: ['Anlıyorum. İstersen biraz müzik açalım, yol daha keyifli geçer.',
           'Olur öyle. Müzik ya da kısa bir mola iyi gelebilir.'],
    short: 'İstersen müzik açalım.',
  },
  chat: {
    full: ['Tabii, buradayım. Aklında ne var?',
           'Seve seve. Ne konuşmak istersin?'],
    short: 'Buradayım, dinliyorum.',
  },
  fatigue: {
    full: ['Yorgunluk yolun doğası. İlk uygun yerde kısa bir mola iyi gelir.',
           'Kendini ağır hissediyorsan mola verelim, acele etme.'],
    short: 'Uygun yerde mola verelim.',
  },
  thanks: {
    full: ['Rica ederim, her zaman.', 'Ne demek, iyi yolculuklar!'],
    short: 'Rica ederim!',
  },
};

function offlineCategoryReply(kind: SmalltalkKind, isDriving: boolean): string {
  const entry = OFFLINE_REPLIES[kind];
  if (isDriving) return entry.short;
  const reply = entry.full[_offlineCounter % entry.full.length];
  _offlineCounter++;
  return reply;
}

/**
 * Offline fallback zinciri:
 *  1. offlineConversationEngine (zengin: araç Q&A + sohbet + saat/tarih)
 *  2. kategori şablonu (engine'in kapsamadığı: canım sıkıldı, sohbet edelim...)
 *  3. null — anlamlı offline yanıt yoksa komut zinciri devam eder
 *     ("anlaşılamadı" + öneriler kullanıcıya generic sohbetten daha dürüst).
 */
function offlineCompanionReply(raw: string, opts: CompanionChatOpts): string | null {
  const conv = tryOfflineConversation(raw, opts.isDriving, opts.speedKmh);
  if (conv.handled) return conv.response;
  const kind = classifySmalltalk(raw);
  if (kind !== null) return offlineCategoryReply(kind, opts.isDriving === true);
  return null;
}

/* ── BİRLEŞİK ASİSTAN BEYNİ ("Siri mantığı", 2026-06-11) ──────
 * Tek Gemini çağrısı hem KOMUT hem SOHBET kararını verir:
 *   - komut → {"type":"action", intent, query…} → intentEngine'e köprülenir
 *   - sohbet → {"type":"chat", say} → TTS + takip dinlemesi
 * Kritik yetenek: metin KUSURLU cihaz-içi ASR'den gelir — prompt Gemini'den
 * bozulmuş özel isimleri (sanatçı/yer) en olası gerçeğe DÜZELTMESİNİ ister
 * ("leyla türk" → büyük olasılıkla "Leyla Göktürk"). Yerel parser'ın
 * tanıyamadığı her cümlede bu beyin tek yetkilidir; offline'da eski
 * fallback zinciri aynen geçerlidir. */

const BRAIN_INTENTS = new Set<string>([
  'SEARCH_POI',
  'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS',
  'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING',
  'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
  'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
  'OPEN_PHONE', 'OPEN_SETTINGS', 'SHOW_WEATHER',
  'CHECK_VEHICLE_HEALTH', 'CHECK_MAINTENANCE',
]);

export interface CompanionBrainAction {
  kind:     'action';
  semantic: SemanticResult; // fromSemanticResult ile AppIntent'e dönüşür
}
export interface CompanionBrainChat {
  kind:     'chat';
  response: string;
  route:    CompanionChatRoute;
}
export type CompanionBrainResult = CompanionBrainAction | CompanionBrainChat;

function buildBrainSystemPrompt(id: CompanionIdentity, isDriving: boolean, vehicleContext: string): string {
  const chatPersona = buildCompanionSystemPrompt(id, isDriving, vehicleContext);
  return [
    `Sen "${id.assistantName}" adlı Türkçe araç içi asistansın (Siri benzeri tek beyin).`,
    'Kullanıcı metni KUSURLU cihaz-içi konuşma tanımadan gelir: bozulmuş veya yanlış duyulmuş',
    'ÖZEL İSİMLERİ (sanatçı, şarkı, yer adı) en olası GERÇEK isme düzelt; emin değilsen olduğu gibi bırak.',
    'GÖREV: metnin bir ARAÇ KOMUTU mu yoksa SOHBET mi olduğuna karar ver. SADECE JSON döndür.',
    '',
    'KOMUT ise: {"type":"action","intent":"...","query":"...","destination":"...","category":"...","feedback":"kısa Türkçe onay (≤8 kelime)","confidence":0.0-1.0}',
    `intent yalnız şunlardan biri: ${[...BRAIN_INTENTS].join(' | ')}`,
    'Müzik istekleri ("X\'ten müzik aç", "X çal", "X dinleyelim") → PLAY_MUSIC_SEARCH + query=DÜZELTİLMİŞ sanatçı/şarkı adı.',
    'Yer/mekan aramaları → SEARCH_POI + category + query. Adres/yere gitme → NAVIGATE_ADDRESS + destination.',
    '',
    'SOHBET ise: {"type":"chat","say":"..."} — say için şu kişilik kuralları geçerli:',
    chatPersona,
    '',
    'ÖRNEKLER:',
    '"ibrahim tatlısesden müzik açar mısın" → {"type":"action","intent":"PLAY_MUSIC_SEARCH","query":"İbrahim Tatlıses","feedback":"İbrahim Tatlıses açılıyor","confidence":0.95}',
    '"acıktım bir şeyler yiyelim" → {"type":"action","intent":"SEARCH_POI","category":"RESTAURANT","query":"restoran","feedback":"Yakın restoranlar aranıyor","confidence":0.9}',
    '"nasılsın bugün" → {"type":"chat","say":"İyiyim, teşekkürler. Yol nasıl gidiyor?"}',
  ].join('\n');
}

interface BrainJson {
  type?:        string;
  intent?:      string;
  query?:       string;
  destination?: string;
  category?:    string;
  feedback?:    string;
  confidence?:  number;
  say?:         string;
}

function parseBrainJson(raw: string): CompanionBrainResult | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned) as BrainJson;
    if (obj.type === 'chat' && typeof obj.say === 'string' && obj.say.trim()) {
      const flat = obj.say.replace(/\s+/g, ' ').trim();
      return { kind: 'chat', response: flat.length > 300 ? `${flat.slice(0, 297)}...` : flat, route: 'companion_gemini' };
    }
    if (obj.type === 'action' && typeof obj.intent === 'string' && BRAIN_INTENTS.has(obj.intent)) {
      return {
        kind: 'action',
        semantic: {
          intent:      obj.intent as SemanticResult['intent'],
          category:    obj.category as SemanticResult['category'],
          query:       typeof obj.query === 'string' ? obj.query : undefined,
          destination: typeof obj.destination === 'string' ? obj.destination : undefined,
          feedback:    typeof obj.feedback === 'string' && obj.feedback ? obj.feedback : 'Yapılıyor',
          confidence:  typeof obj.confidence === 'number' ? obj.confidence : 0.85,
          source:      'direct_ai',
        },
      };
    }
    return null;
  } catch { return null; }
}

async function askCompanionBrain(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
): Promise<CompanionBrainResult | null> {
  const contents = [
    ..._history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text }] },
  ];
  const body = {
    system_instruction: {
      parts: [{ text: buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext()) }],
    },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature:      0.4,
      maxOutputTokens:  isDriving ? 160 : 220,
    },
  };
  const resp = await fetch(`${GEMINI_CHAT_ENDPOINT}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (resp.status === 429) { _rateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS; return null; }
  if (!resp.ok) return null;
  const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return parseBrainJson((data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim());
}

/**
 * Birleşik beyin girişi — voiceService router'ı parser <0.7 her cümlede
 * bunu çağırır. Gemini kullanılamıyorsa offline sohbet fallback'i (yalnız
 * chat) döner; o da yoksa null → eski zincir devam eder.
 */
export async function tryCompanionBrain(
  raw: string,
  opts: CompanionChatOpts = {},
): Promise<CompanionBrainResult | null> {
  const settings = useStore.getState().settings;
  if (settings.companionEnabled !== true) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isDriving = opts.isDriving === true;

  const geminiUsable =
    opts.provider === 'gemini' && !!opts.apiKey && opts.hasNet === true && _now() >= _rateLimitedUntil;

  if (geminiUsable) {
    try {
      const result = await askCompanionBrain(trimmed, opts.apiKey as string, resolveCompanionIdentity(settings), isDriving);
      if (result) {
        // Sohbet sürekliliği: aksiyon turları da geçmişe girer ("onu da çal" gibi
        // bağlamlı devam cümleleri için).
        pushHistory('user', trimmed);
        pushHistory('model', result.kind === 'chat' ? result.response : result.semantic.feedback);
        return result;
      }
    } catch { /* timeout / ağ / parse — offline'a düş */ }
  }

  // Offline fallback: yalnız sohbet (komut kararı offline'da yerel parser'ındır)
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { kind: 'chat', response: offline, route: 'companion_offline' };
  return null;
}

/* ── ASR müzik sorgu onarımı (yerel parser yakaladığında) ───── *
 * "leyla türkten müzik çal" yerel parser'da 0.93 ile yakalanır ama İSİM
 * ASR'de bozulmuş olabilir. Online'ken sorgu hızlı bir Gemini çağrısıyla
 * onarılır; zaman aşımında ham sorgu aynen kullanılır (komut GECİKMEZ). */

const REPAIR_TIMEOUT_MS = 1_800;

export async function repairMusicQuery(query: string, apiKey: string): Promise<string | null> {
  const q = query.trim();
  if (!q || q.length < 3) return null;
  try {
    const body = {
      system_instruction: { parts: [{ text:
        'Türkçe araç içi konuşma tanıma (ASR) çıktısından gelen müzik araması düzeltirsin. ' +
        'Verilen metin büyük olasılıkla bir sanatçı veya şarkı adıdır ama ASR bozmuş olabilir. ' +
        'En olası GERÇEK adı döndür; emin değilsen metni AYNEN döndür. SADECE JSON: {"q":"..."}',
      }] },
      contents: [{ role: 'user', parts: [{ text: q }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 50 },
    };
    const resp = await fetch(`${GEMINI_CHAT_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(REPAIR_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const obj = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')) as { q?: string };
    const fixed = typeof obj.q === 'string' ? obj.q.replace(/\s+/g, ' ').trim() : '';
    if (!fixed || fixed.length > 80) return null;
    return fixed === q ? null : fixed;
  } catch { return null; }
}

/* ── Ana giriş — Companion Router'ın sohbet ucu ─────────────── */

/**
 * Komut olmayan/belirsiz cümleyi companion hattında yanıtlar.
 *
 * AI-FIRST: companion açıkken cümle İÇERİĞİNE bakılmaz — Gemini'ye gider.
 * (Komut/sohbet ayrımını voiceService router'ı yapar: parser ≥0.7 buraya
 * hiç gelmez.) Gemini kullanılamıyorsa offline fallback zinciri.
 *
 * null dönerse çağıran zincire devam eder (semantic → AI intent → öneriler).
 */
export async function tryCompanionChat(
  raw: string,
  opts: CompanionChatOpts = {},
): Promise<CompanionChatResult | null> {
  const settings = useStore.getState().settings;
  if (settings.companionEnabled !== true) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isDriving = opts.isDriving === true;

  // ── Öncelikli yol: GERÇEK Gemini sohbeti ──
  const geminiUsable =
    opts.provider === 'gemini' &&
    !!opts.apiKey &&
    opts.hasNet === true &&
    _now() >= _rateLimitedUntil;

  if (geminiUsable) {
    try {
      const reply = await askCompanionGemini(trimmed, opts.apiKey as string, resolveCompanionIdentity(settings), isDriving);
      if (reply) {
        pushHistory('user', trimmed);
        pushHistory('model', reply);
        return { response: reply, route: 'companion_gemini' };
      }
    } catch { /* timeout / ağ / parse — sessizce offline'a düş */ }
  }

  // ── Offline fallback: internet yok · key yok · hata/timeout · 429 ──
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { response: offline, route: 'companion_offline' };
  return null;
}
