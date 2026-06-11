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
  const callsign = id.userCallsign ? `Kullanıcıya "${id.userCallsign}" diye hitap et.` : 'Kullanıcıya hitap kullanma.';
  const persona: Record<string, string> = {
    sessiz:      'Az ve öz konuş, yalnız sorulana cevap ver.',
    samimi:      'Sıcak ve doğal bir yol arkadaşı gibi konuş.',
    neseli:      'Enerjik ve pozitif konuş, hafif espri yapabilirsin.',
    profesyonel: 'Kısa, net ve resmi konuş.',
  };
  const driving = isDriving
    ? 'Sürücü ŞU AN ARAÇ KULLANIYOR: en fazla 8 kelimeyle cevap ver.'
    : 'En fazla 2 kısa cümleyle cevap ver.';
  const lines = [
    `Sen "${id.assistantName}" adında, araçta sürücüye eşlik eden Türkçe konuşan bir yol arkadaşısın.`,
    persona[id.personality],
    callsign,
    driving,
    'Liste, madde işareti, emoji, markdown kullanma; yalnız düz konuşma metni.',
  ];
  if (vehicleContext) {
    lines.push(`Araç bağlamı (yorumlanmış): ${vehicleContext} Bu bilgiyi yalnız konuyla ilgiliyse doğal biçimde kullan.`);
  } else {
    lines.push('Araç verisine (hız, yakıt, sıcaklık) şu an erişimin yok — sorulursa bunu söyle, asla uydurma.');
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
      maxOutputTokens: isDriving ? 60 : 120,
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
  // TTS güvenliği: tek satıra indir, aşırı uzunsa kırp (dikkat dağıtma — §2.1)
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 217)}...` : flat;
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
