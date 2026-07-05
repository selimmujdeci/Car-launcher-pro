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
import { interpretFuel, interpretBatteryCharge, interpretEngineTempConcern, interpretTripDuration, interpretRangeVsRoute } from './companionContext';
import { tryOfflineConversation } from '../offlineConversationEngine';
import { onOBDData } from '../obdService';
import { getTripSnapshot } from '../tripLogService';
import { getNavigationState } from '../navigationService';
import { buildMemoryPromptSection } from './companionMemory';
import { signalWithTimeout } from '../../utils/abortCompat';
import { recordAiNetFailure, recordAiNetSuccess } from '../aiHealth';
import { tavilySearch } from '../webSearchService';
import { getWeatherNarrative, refreshWeather, onWeatherState, weatherQueryNamesCity, type WeatherState } from '../weatherService';
import type { SemanticResult } from '../ai/semanticAiService';

/* ── Tipler ─────────────────────────────────────────────────── */

export type CompanionChatRoute = 'companion_gemini' | 'companion_groq' | 'companion_haiku' | 'companion_offline' | 'companion_rate_limited';

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
  /** Tavily web-arama anahtarı (opsiyonel) — Groq/Haiku'ya internet grounding sağlar.
   *  Varsa Groq/Haiku da haber/döviz/canlı bilgi sorularını arayıp yanıtlar. */
  tavilyKey?: string;
  /**
   * Gemini ARAMA MOTORU anahtarı (opsiyonel). Groq/Haiku birincil beyinken bile
   * web/güncel bilgi sorguları HER ZAMAN Gemini google_search ile yanıtlanır —
   * yani "Groq asistan, Gemini yalnız arama" düzeni. Varsa Groq/Haiku type:"web"
   * üretebilir ve grounding Gemini'ye devredilir (Tavily'den ÖNCE denenir).
   * Boşsa eski davranış: Groq/Haiku canlı bilgi arayamaz (dürüst fallback).
   */
  searchKey?: string;
  /**
   * HİBRİT BEYİN ZİNCİRİ (SIRA SABİT): tryCompanionBrain adayları bu sırayla
   * dener — biri kota/hata/429 verirse (veya Gemini soğuma penceresindeyse)
   * sıradaki devreye girer. Yalnız anahtarı GİRİLMİŞ sağlayıcılar zincire girer
   * (voiceService._resolveAiKeys kurar). Boşsa/verilmezse `provider`+`apiKey`
   * alanlarıyla eski tek-sağlayıcı davranışına geriye-uyum sağlanır.
   */
  chain?: ReadonlyArray<{ provider: 'gemini' | 'groq' | 'haiku'; apiKey: string }>;
  /**
   * Single Brain karar bütçesi (ms). voiceService 2.5sn iletir: beyin bu süre
   * içinde ACTION/CHAT kararı veremezse fetch iptal edilir → yerel graceful
   * fallback zinciri zamanında devreye girer. Verilmezse GEMINI_TIMEOUT_MS.
   */
  timeoutMs?: number;
  /**
   * n-best: STT'nin ürettiği alternatif tanımalar (en olası ilk, `raw` ile aynı).
   * Verilirse (>1) prompt'a "sürücü şunlardan birini dedi, en anlamlısını yorumla"
   * diye eklenir → beyin STT belirsizliğini bağlamla çözer. Ekstra çağrı/gecikme YOK.
   */
  alternatives?: string[];
}

/* ── n-best: STT belirsizliğini prompt'a ipucu olarak ekle ─────
 * Beyne gönderilen kullanıcı metnini, STT'nin ürettiği diğer alternatiflerle
 * zenginleştirir → beyin bağlamla doğru yorumu seçer. Ekstra çağrı YOK; sadece
 * mevcut çağrının user içeriği. Tek/boş alternatif → metin AYNEN (eski davranış). */
export function _withAltHint(top: string, alternatives?: string[]): string {
  if (!alternatives || alternatives.length < 2) return top;
  const others = alternatives
    .slice(1, 5)
    .map((a) => (a ?? '').trim())
    .filter((a) => a && a.toLowerCase() !== top.toLowerCase());
  if (others.length === 0) return top;
  return `${top}\n\n(Not: ses tanıma kesin değil; olası alternatifler: ${others.join(' / ')}. En anlamlı olanı dikkate alıp yanıtla.)`;
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
// Gemini BEYİN/sohbet çağrısı (düzenli generateContent) kotası soğuması — Gemini
// adayını zincirde atlar.
// ⚠️ SAĞLAYICI-BAZLI (SAHA 2026-07-04, "ilk istek online sonrakiler offline"):
// eskiden TEK paylaşılan pencereydi — Groq/Haiku 429'u da bunu kuruyordu ve
// GEMINI 60sn kilitleniyordu (çapraz kirlenme). Artık her sağlayıcının kendi
// penceresi var; birinin kotası diğerini asla susturmaz.
let _rateLimitedUntil = 0;      // yalnız GEMINI
let _groqRateLimitedUntil  = 0; // yalnız GROQ
let _haikuRateLimitedUntil = 0; // yalnız HAIKU

/**
 * Gemini 429 gövdesinden gerçek bekleme süresini okur (google.rpc.RetryInfo
 * retryDelay: "7s" gibi). RPM-tipi kotalarda Google çoğu zaman 5-30sn söyler —
 * sabit 60sn pencere asistanı gereksiz uzun "offline" bırakıyordu (SAHA
 * 2026-07-04: "ilk istek online, sonrakiler offline"). Okunamazsa/yoksa
 * varsayılan pencere; taban 5sn, tavan RATE_LIMIT_COOLDOWN_MS.
 */
async function _cooldownFrom429(resp: Response): Promise<number> {
  try {
    const data = await resp.json() as { error?: { details?: { retryDelay?: string }[] } };
    const d = data.error?.details?.find((x) => typeof x?.retryDelay === 'string');
    const m = d?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) return Math.min(RATE_LIMIT_COOLDOWN_MS, Math.max(5_000, Math.round(parseFloat(m[1]) * 1000)));
  } catch { /* gövde okunamadı → varsayılan pencere */ }
  return RATE_LIMIT_COOLDOWN_MS;
}

/* Kota penceresinde dürüst cevap (SAHA 2026-07-04): zincirdeki TÜM adaylar
 * soğumadayken kullanıcı "offline'a düştü" sanıyordu — asistan sahte aptallaşma
 * yerine gerçek nedeni söyler; pencere kapanınca kendiliğinden normale döner. */
const RATE_LIMIT_REPLY =
  'Yapay zeka kotam şu an dolu, bir dakikaya kalmaz toparlarım — birazdan tekrar sor.';
// google_search GROUNDING kotası soğuması AYRI (SAHA 2026-07-04): grounding ücretsiz
// katmanda çok küçük kotalı, sık 429 verir. Eskiden bu 429 _rateLimitedUntil'ı
// kurup TÜM Gemini beynini 60sn öldürüyordu → "bir kere çalışıp sonra ölüyor".
// Ayrı pencere: grounding kotası bitince yalnız grounding atlanır (→ Tavily), beyin
// karar/sentez çağrıları (düzenli generateContent, 200 dönüyor) çalışmaya devam eder.
let _groundingCooldownUntil = 0;

function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** @internal — testler arası izolasyon. */
export function _resetCompanionChatForTest(): void {
  _history = [];
  _offlineCounter = 0;
  _rateLimitedUntil = 0;
  _groqRateLimitedUntil = 0;
  _haikuRateLimitedUntil = 0;
  _groundingCooldownUntil = 0;
}

/* ── Yorumlanmış araç bağlamı (HAM VERİ DEĞİL) ──────────────── */

/**
 * Araç-tipi YETENEK notu — Gemini'ye aracın FİZİKSEL OLARAK SAHİP OLMADIĞI
 * özelliği söyler (Zero Redundancy: olmayan özellikten bahsetme/uydurma).
 * Tip profilden gelir (setObdVehicleType), canlı OBD gerekmez. Turbo notu YOK:
 * boostPressure<0 "turbo yok" demek değildir (adaptör desteklemiyor olabilir) →
 * yanlış iddia üretmemek için yalnız güvenilir tip ayrımı (EV/hibrit) kullanılır.
 */
function vehicleCapabilityNote(vt?: string): string {
  if (vt === 'ev') {
    return 'ARAÇ ÖZELLİĞİ (önemli): Bu TAM ELEKTRİKLİ (EV) bir araç — motor devri (RPM), motor sıcaklığı ve benzin/yakıt YOK. Bunlardan ASLA bahsetme veya değer uydurma; menzili ve enerjiyi batarya şarjı (%) üzerinden konuş.';
  }
  if (vt === 'hybrid' || vt === 'phev') {
    return 'ARAÇ ÖZELLİĞİ: Bu HİBRİT bir araç — hem motor (RPM/yakıt) hem batarya verisi olabilir; yalnız MEVCUT olandan bahset, olmayan için veri uydurma.';
  }
  return '';
}

/**
 * OBD anlık verisini Commit 2 yorumlayıcılarından geçirip insan dili
 * bağlam cümlesi üretir. OBD yoksa/bozuksa boş string (prompt'a girmez).
 * Tek seferlik abone ol/ayrıl deseni: offlineConversationEngine.carSnapshot
 * ile aynı (senkron son-değer yakalama).
 */
function buildInterpretedVehicleContext(): string {
  const parts: string[] = [];
  let vehicleType: string | undefined;
  let capturedRangeKm: number | undefined; // rota köprüsü (adım 4) için son menzil
  // (1) OBD: yakıt + motor sıcaklığı (yorumlanmış — ham veri DEĞİL).
  try {
    const unsub = onOBDData((d) => {
      vehicleType = d.vehicleType;
      const rangeKm = d.estimatedRangeKm >= 0 ? d.estimatedRangeKm
                    : (d.range >= 0 ? d.range : undefined);
      capturedRangeKm = rangeKm;
      const fuel = interpretFuel(d.fuelLevel, rangeKm);
      const temp = interpretEngineTempConcern(d.engineTemp);
      // EV/hibrit enerji bağlamı: ICE'de batteryLevel=-1 → null (dokunmaz).
      // EV menzili d.range'den gelir (estimatedRangeKm yakıt-tabanlı, EV'de -1).
      const charging = d.chargingState === 'charging' || d.chargingState === 'fast_charging';
      const battery = interpretBatteryCharge(d.batteryLevel, d.range >= 0 ? d.range : undefined, charging);
      if (fuel) parts.push(fuel);
      if (battery) parts.push(battery);
      if (temp) parts.push(temp);
    });
    unsub();
  } catch { /* OBD bağlı değil — bağlamsız sohbet */ }
  // (2) Yolculuk süresi (World View): aktif trip varsa "ne zamandır yoldayız".
  //     getTripSnapshot CANLI current verir (onTripState immediate-emit null'dur).
  try {
    const trip = getTripSnapshot().current;
    if (trip) {
      const t = interpretTripDuration(trip.liveDurationMin, trip.liveDistanceKm);
      if (t) parts.push(t);
    }
  } catch { /* trip servisi yok — süresiz bağlam */ }
  // (4) Menzil vs. aktif rota: "yakıtım X'e yeter mi" gerçek veriyle. Yalnız
  //     navigasyon aktifken + geçerli menzil varken (aksi hâlde bağlama girmez).
  try {
    const nav = getNavigationState();
    if (nav.isNavigating && typeof nav.distanceMeters === 'number' && nav.distanceMeters > 0
        && capturedRangeKm !== undefined) {
      const line = interpretRangeVsRoute(
        capturedRangeKm, nav.distanceMeters / 1000, nav.destination?.name,
      );
      if (line) parts.push(line);
    }
  } catch { /* navigasyon servisi yok — rota köprüsü atlanır */ }
  // (3) Araç-tipi yetenek notu — olmayan özellik (EV'de RPM/yakıt) için Gemini'yi
  //     yapısal olarak susturur. EV'de canlı yorum boş olsa bile not eklenir.
  const note = vehicleCapabilityNote(vehicleType);
  return note ? [note, ...parts].join(' ') : parts.join(' ');
}

/* ── Gemini sohbet çağrısı ──────────────────────────────────── */

const GEMINI_CHAT_ENDPOINT =
  // gemini-flash-latest: yeni "AQ." anahtarların ücretsiz katmanı sabit-adlı eski
  // modellerde (gemini-2.0-flash) anında 429 veriyor; flash-latest çalışıyor
  // (SAHA 2026-07-03: kullanıcı anahtarıyla canlı doğrulandı). Model tek noktadan.
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
// SAHA 2026-07-04: gemini-flash-latest artık gemini-3.5-flash'a çözülüyor; SICAK
// çağrı ~1-1.8sn ama DERİN SOĞUK BAŞLANGIÇ ~7sn (kullanıcı anahtarıyla ölçüldü).
// 6sn tavan soğuk başlangıcı kesip null→REASK ("of orayı kaçırdım") üretiyordu.
// 9sn'ye çıkarıldı; asıl çözüm warmupGemini (aşağıda) — mikrofon açılınca modeli
// ısıtır, gerçek komut sıcak gelir. "Bir saniye..." ara sözü bekleme hissini örter.
const GEMINI_TIMEOUT_MS = 9000;

/**
 * Gemini modelini ÖNDEN ISITIR (fire-and-forget). Mikrofon açılınca çağrılır:
 * kullanıcı komutunu bitirene kadar model sıcak olur → gerçek beyin çağrısı
 * soğuk-başlangıç cezası (~7sn) yerine ~1sn'de döner. Sonuç önemsiz; hata yutulur.
 * Küçük istek (maxOutputTokens:1) → ihmal edilebilir kota.
 */
export async function warmupGemini(apiKey: string): Promise<void> {
  if (!apiKey || !apiKey.trim()) return;
  // Kota soğumasındayken ısıtma da atlanır — 429 penceresinde ekstra istek hem
  // boşa kota yakar hem pencereyi tazeleyebilir (SAHA 2026-07-04).
  if (_now() < _rateLimitedUntil) return;
  try {
    await fetch(GEMINI_CHAT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: signalWithTimeout(GEMINI_TIMEOUT_MS),
    });
  } catch { /* ısıtma best-effort — sonuç/hata önemsiz */ }
}

/**
 * "Yol Arkadaşı" ruhu (Faz 1, 2026-06-11): Siri'den ayrışma noktaları —
 * şive duyarlılığı (kelime değil NİYET), robotik kalıp yasağı, dost
 * tavsiyesiyle güvenlik reddi. Kişilik tonu kullanıcı seçimine saygılıdır
 * ("profesyonel" seçen kullanıcıya "kanka" denmez).
 */
function buildCompanionSystemPrompt(id: CompanionIdentity, isDriving: boolean, vehicleContext: string): string {
  // Hitap her cümlede TEKRARLANMAZ — "her cümlede isim" robotik algının
  // ana kaynaklarından (saha geri bildirimi 2026-06-11).
  const callsign = id.userCallsign
    ? `Kullanıcıya ara sıra "${id.userCallsign}" diye hitap edebilirsin ama her cümlede kullanma.`
    : 'Kullanıcıya hitap kullanma.';
  const persona: Record<string, string> = {
    sessiz:      'Az ve öz konuş, yalnız sorulana cevap ver.',
    samimi:      'Sıcak, senli benli bir yol arkadaşı gibi konuş — eski dost rahatlığında.',
    neseli:      'Enerjik ve pozitif konuş, hafif espri yapabilirsin.',
    profesyonel: 'Kısa, net ve saygılı konuş; argo ve laubalilik kullanma.',
  };
  // Sürüşte kısa ama DOĞAL: çoğu zaman birkaç kelimelik samimi tepki yeter;
  // "tek cümle robot" değil (ISO 15008 dikkat sınırı korunur).
  const driving = isDriving
    ? 'Sürücü ŞU AN ARAÇ KULLANIYOR: kısa tut — çoğu zaman birkaç kelimelik doğal tepki yeter ("Tamam, hallettim."), gerekirse en fazla 2-3 kısa cümle. Dikkatini dağıtma.'
    : 'Araç PARK HALİNDE — acele yok: en fazla 3 doğal cümleyle, ama daha sohbet odaklı, derinlemesine ve içten konuşabilirsin.';
  const lines = [
    `Sen "${id.assistantName}" adında, araçta sürücüye eşlik eden Türkçe konuşan bir yol arkadaşısın — bu arabanın ruhusun, bir çağrı merkezi robotu değilsin.`,
    'Doğal ve akıcı konuş; robotik, kalıp ya da tek kelimelik cevaplar verme.',
    '"İşleminiz tamamlandı", "Talebiniz alındı" gibi resmi kalıplar YASAK — "Tamam, hallettim.", "Oldu bil." gibi doğal tepkiler ver.',
    persona[id.personality],
    callsign,
    driving,
    // Şive duyarlılığı: kelimeye değil niyete odak (Faz 1 — Dialect Awareness)
    'Kullanıcı yerel şivelerle (Karadeniz, Ege, Doğu...) veya sokak ağzıyla konuşabilir ("birez", "kurban", "uşağum", "gardaş"). Kelimelere takılma; otomotiv bağlamına ve NİYETE odaklan. Asla "anlamadım" deyip bırakma — bağlamdan çıkarım yap, gerçekten gerekiyorsa tek kısa soruyla netleştir.',
    // Güvenlik: resmi nezaket değil, dost tavsiyesi
    'Tehlikeli istekleri (hız yapma, sürüşte video izleme, dikkat dağıtma) resmi nezaketle değil DOST TAVSİYESİYLE geri çevir ("Bence şimdi olmaz, yoldayız — varınca bakarız.").',
    'Aynı açılış kalıplarını ve cümleleri tekrar etme.',
    'Liste, madde işareti, emoji, markdown kullanma; yalnız düz konuşma metni.',
  ];
  if (vehicleContext) {
    // Faz 2 — güçlü bağlam enjeksiyonu: yorumlar "durum raporu" değil,
    // sürücünün O ANKİ HÂLİ olarak verilir. Kritik durum (az yakıt, ısınan
    // motor) kendiliğinden dile getirilir; gerisi yalnız konu açılınca.
    lines.push(
      `SÜRÜCÜNÜN MEVCUT DURUMU (araçtan canlı, yorumlanmış — doğrudur, sorgulama): ${vehicleContext}`,
      'Bu durumu bir dost gibi gözet: kritik bir şey varsa (az yakıt, ısınan motor, yorgunluk) lafı geçmişken kendiliğinden ve doğal biçimde hatırlat; diğer detayları yalnız konuyla ilgiliyse kullan. Rakam okuyan robot gibi davranma, durumu hissederek konuş.',
    );
  } else {
    lines.push(
      'Araç verisine (hız, yakıt, sıcaklık) şu an erişimin yok. Sorulursa bunu teknik hata mesajı gibi değil, ' +
      'doğal bir dille söyle ("şu an araçtan veri alamıyorum ama sürüşü takip ediyorum" gibi); asla veri uydurma. ' +
      'Günlük sohbette araç verisinden hiç bahsetme.',
    );
  }
  // Uzun-dönem kişisel hafıza — kullanıcının kalıcı fact'leri (varsa) enjekte
  // edilir; buildBrainSystemPrompt bunu chatPersona olarak sardığından hem sohbet
  // hem komut onayı bu bağlamı görür. Fact yoksa boş string (satır eklenmez).
  const memory = buildMemoryPromptSection();
  if (memory) lines.push(memory);
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
      // flash-latest düşünen model: düşünme kapalı — küçük bütçeyi yemesin,
      // araç içi gecikme kısa kalsın (SAHA 2026-07-03).
      thinkingConfig:  { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(GEMINI_CHAT_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body:    JSON.stringify(body),
    signal:  signalWithTimeout(GEMINI_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
  });
  if (resp.status === 429) {
    // Rate limit: soğuma penceresi boyunca Gemini denenmez (kullanıcı faturası
    // + art arda başarısız istek gecikmesi). Süre Google'ın söylediği kadar.
    _rateLimitedUntil = _now() + await _cooldownFrom429(resp);
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

/* ── Groq sohbet çağrısı (OpenAI-uyumlu) ───────────────────── */

// Groq timeout — Gemini ile aynı; abortCompat ile Chrome <103'te güvenli.
const GROQ_COMPANION_TIMEOUT_MS = 6000;
// Groq model adları değişebilir — güncel listeyi console.groq.com'dan doğrula.
const GROQ_COMPANION_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_COMPANION_MODEL    = 'llama-3.3-70b-versatile';

/** RAM geçmişini OpenAI messages formatına dönüştürür ('model' → 'assistant'). */
function historyToOpenAI(): { role: 'user' | 'assistant'; content: string }[] {
  return _history.map((t) => ({
    role:    t.role === 'model' ? 'assistant' : 'user',
    content: t.text,
  }));
}

async function askCompanionGroq(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
): Promise<string | null> {
  const body = {
    model:       GROQ_COMPANION_MODEL,
    temperature: 0.7,
    // 2-3 doğal cümleye alan tanır; üst sınır TTS kırpma katmanıyla sigortalı.
    max_tokens:  isDriving ? 100 : 160,
    messages: [
      { role: 'system' as const, content: buildCompanionSystemPrompt(id, isDriving, buildInterpretedVehicleContext()) },
      ...historyToOpenAI(),
      { role: 'user' as const, content: text },
    ],
  };

  const resp = await fetch(GROQ_COMPANION_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body:   JSON.stringify(body),
    signal: signalWithTimeout(GROQ_COMPANION_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
  });

  if (resp.status === 429) {
    // Rate limit: KENDİ penceresi — Gemini'yi kilitlemez (çapraz kirlenme yasak).
    _groqRateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS;
    return null;
  }
  if (!resp.ok) return null;

  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!raw) return null;
  // TTS güvenliği: tek satıra indir, aşırı uzunsa cümle sınırında kırp.
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= 300) return flat;
  const head = flat.slice(0, 297);
  const lastSentenceEnd = Math.max(
    head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
  );
  return lastSentenceEnd > 120 ? head.slice(0, lastSentenceEnd + 1) : `${head}...`;
}

/* ── Hava sorusu — beyin öncesi/web-kesişimi kısayolu ─────────
 * "hava durumu" tipi sorular beyne (Gemini/Groq/Haiku) HİÇ gitmeden ya da
 * beyin type:"web" dediğinde Tavily/grounded aramadan ÖNCE yerel hava
 * servisinden (weatherService) gerçek veriyle cevaplanır. Groq/Haiku gibi
 * kendi başına canlı internete erişemeyen sağlayıcılar "canlı bilgilere
 * bakamıyorum" diyordu (saha 2026-07-03) — hava zaten cihazda gerçek veri
 * olarak mevcut, AI'ya hiç ihtiyaç yok. Eşleşme yoksa null → çağıran mevcut
 * grounding/tavily/dürüst-fallback zincirine değişmeden devam eder. */
const WEATHER_QUERY_RE = /\b(hava|yagmur|kar yag|sicaklik|derece|ruzgar)\b/;

async function tryLocalWeatherAnswer(query: string, rawUserText?: string): Promise<string | null> {
  // Hava sorgusu mu? — beyin sorgusu VEYA ham kullanıcı metni "hava/sıcaklık…" içermeli.
  const isWeather = WEATHER_QUERY_RE.test(norm(query)) ||
    (rawUserText != null && WEATHER_QUERY_RE.test(norm(rawUserText)));
  if (!isWeather) return null;
  // BELİRLİ BİR ŞEHİR sorulduysa (İstanbul hava durumu) yerel/GPS havayı DÖNME —
  // null ver ki çağıran web aramasına (grounding/Tavily) gitsin; aksi halde
  // kullanıcı İstanbul sorup bulunduğu yerin (Tarsus) havasını duyuyordu.
  //
  // SAHA 2026-07-04 (KÖK NEDEN): şehir kontrolü YALNIZ beynin `query`'sine bakıyordu;
  // beyin "İstanbul hava durumu"nu web sorgusuna çevirirken şehri DÜŞÜREBİLİYOR
  // (temp 0.4 + biriken _history bağlamı "şehir anlaşıldı" sayıyor) → weatherQueryNamesCity
  // false → yerel Tarsus havası dönüyordu. Ham kullanıcı metni ("İstanbul hava durumu")
  // her zaman şehri içerir → ONU da kontrol et (biri şehir adı verirse yerel havayı DÖNME).
  if (weatherQueryNamesCity(query)) return null;
  if (rawUserText != null && weatherQueryNamesCity(rawUserText)) return null;
  const narrative = getWeatherNarrative();
  if (!/henüz alınamadı/i.test(narrative)) return narrative;
  try {
    refreshWeather().catch(() => { /* ignore */ });
    const s = await new Promise<WeatherState | null>((resolve) => {
      let done = false;
      const finish = (v: WeatherState | null) => {
        if (done) return;
        done = true;
        try { unsub(); } catch { /* ignore */ }
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 3500);
      const unsub = onWeatherState((st) => { if (st.weather) finish(st); });
    });
    return s?.weather ? getWeatherNarrative(s) : null;
  } catch { return null; }
}

async function askCompanionBrainGroq(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  timeoutMs?: number,
  tavilyKey?: string,
  searchKey?: string,
): Promise<CompanionBrainResult | null> {
  // Groq tek başına internete bakamaz. Arama motoru olarak Gemini (searchKey) VEYA
  // Tavily varsa type:"web" kararına izin ver (grounding aşağıda devredilir).
  // Yoksa eski davranış: type:"web" sohbete çevrilir (canlı bilgi yok).
  const hasGeminiSearch = !!searchKey && searchKey.trim().length > 8;
  const hasTavily       = !!tavilyKey && tavilyKey.trim().length > 8;
  const canGround = hasGeminiSearch || hasTavily;
  const decisionMs = Math.min(timeoutMs ?? GROQ_COMPANION_TIMEOUT_MS, GROQ_COMPANION_TIMEOUT_MS);
  const body = {
    model:           GROQ_COMPANION_MODEL,
    temperature:     0.4,
    max_tokens:      isDriving ? 160 : 220,
    // Groq JSON modu: response_format ile güvenli JSON çıktısı
    response_format: { type: 'json_object' as const },
    messages: [
      // supportsGrounding: Tavily anahtarı varsa true → internet sorularında type:"web" döner
      { role: 'system' as const, content: buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), canGround) },
      ...historyToOpenAI(),
      { role: 'user' as const, content: text },
    ],
  };

  const resp = await fetch(GROQ_COMPANION_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body:   JSON.stringify(body),
    signal: signalWithTimeout(decisionMs), // Chrome <103 WebView güvenli (abortCompat)
  });

  // 429: KENDİ penceresi — Gemini'yi kilitlemez (çapraz kirlenme yasak).
  if (resp.status === 429) { _groqRateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS; return null; }
  if (!resp.ok) return null;

  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const raw  = (data.choices?.[0]?.message?.content ?? '').trim();
  // Groq'tan gelen type:"web" kararı: canlı internet erişimi yok.
  // Kişiliğe uygun doğal bir sohbet yanıtına dönüştür (No Dead-Ends koruması).
  const parsed = parseBrainJson(raw);
  if (parsed && parsed.kind === 'web') {
    // Hava sorgusu mu? → arama harcamadan ÖNCE yerel hava servisi denenir
    // (Groq'un "canlı bilgilere bakamıyorum" demesi böyle önlenir — hava zaten
    // cihazda gerçek veri olarak var).
    const localWeather = await tryLocalWeatherAnswer(parsed.query, text);
    if (localWeather) return { kind: 'chat', response: localWeather, route: 'companion_groq' };
    // İNTERNET kararı → ÖNCE Gemini google_search, GROUNDING soğumasındaysa Tavily.
    // Grounding kendi penceresindeyse (429 verdi) tekrar çağırıp boş yere 429 yemeyiz —
    // doğrudan Tavily'ye düşeriz (grounding cooldown BEYİN cooldown'ından ayrı).
    if (hasGeminiSearch && _now() >= _groundingCooldownUntil) {
      const grounded = await askGroundedGemini(parsed.query, searchKey as string, id, isDriving);
      if (grounded) return { kind: 'chat', response: grounded, route: 'companion_groq' };
    }
    if (hasTavily) {
      const grounded = await groundGroqWithTavily(parsed.query, text, apiKey, id, isDriving, tavilyKey as string);
      if (grounded) return { kind: 'chat', response: grounded, route: 'companion_groq' };
      return { kind: 'chat', response: 'Aradım ama net bir sonuç bulamadım.', route: 'companion_groq' };
    }
    if (hasGeminiSearch) {
      // Gemini araması boş/başarısız döndü (ör. kota) ve Tavily yok → dürüst söyle.
      return { kind: 'chat', response: 'Aradım ama net bir sonuç bulamadım.', route: 'companion_groq' };
    }
    const reply = 'Şu an canlı bilgilere bakamıyorum ama bildiğimce yardımcı olmaya çalışırım.';
    return { kind: 'chat', response: reply, route: 'companion_groq' };
  }
  // parseBrainJson CHAT kararına HER ZAMAN 'companion_gemini' rotası yazar (paylaşılan
  // parser Gemini birincil çağrıyı varsayar) — Groq'tan geldiğinde burada düzeltilir,
  // aksi halde Groq'un cevabı tanı/log'larda yanlışlıkla Gemini'ye ait görünür.
  if (parsed && parsed.kind === 'chat') return { ...parsed, route: 'companion_groq' };
  return parsed;
}

/**
 * Groq beyin çağrısını yapıp başarılıysa geçmişe/devre-kesiciye işler.
 * tryCompanionBrain'de üç yerde (birincil Groq, Gemini-sonrası yedek, Gemini
 * soğuma-penceresi yedeği) aynı "çağır → başarılıysa kaydet" deseni tekrar
 * etmesin diye ortak noktaya alındı.
 */
async function tryGroqBrainAndRecord(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  timeoutMs?: number,
  tavilyKey?: string,
  searchKey?: string,
): Promise<CompanionBrainResult | null> {
  const result = await askCompanionBrainGroq(text, apiKey, id, isDriving, timeoutMs, tavilyKey, searchKey);
  if (!result) return null;
  recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
  pushHistory('user', text);
  pushHistory('model', result.kind === 'chat' ? result.response : result.semantic.feedback);
  return result;
}

/**
 * Groq grounding: Tavily ile web'i arar, sonuçları Groq'a verip doğal Türkçe
 * yanıt sentezletir. Hata/boş sonuçta null → çağıran dürüst fallback yapar.
 */
async function groundGroqWithTavily(
  searchQuery: string,
  userText: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  tavilyKey: string,
): Promise<string | null> {
  const search = await tavilySearch(searchQuery, tavilyKey);
  if (!search) return null;

  // Tavily hazır cevabı + kaynak özetleri → Groq sentezi (kişilik + kısa Türkçe + TTS güvenli)
  const ctxBlock = [
    search.answer ? `Özet: ${search.answer}` : '',
    search.context ? `Kaynaklar:\n${search.context}` : '',
  ].filter(Boolean).join('\n\n');

  const sysPrompt =
    `Sen ${id.assistantName} adlı araç asistanısın. Aşağıdaki GÜNCEL web arama sonuçlarına ` +
    `DAYANARAK kullanıcının sorusunu kısa, doğal Türkçe ile yanıtla. ` +
    `Sadece sonuçlardaki bilgiyi kullan, uydurma. Emin değilsen belirt. ` +
    `${isDriving ? 'Sürüş halinde: 1-2 cümle, çok kısa.' : 'En fazla 3-4 cümle.'} ` +
    `Kaynak numarası/URL okuma.`;

  const body = {
    model:       GROQ_COMPANION_MODEL,
    temperature: 0.3,
    max_tokens:  isDriving ? 120 : 240,
    messages: [
      { role: 'system' as const, content: sysPrompt },
      { role: 'user' as const, content: `Soru: ${userText}\n\n${ctxBlock}` },
    ],
  };

  try {
    const resp = await fetch(GROQ_COMPANION_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
      signal:  signalWithTimeout(GROQ_COMPANION_TIMEOUT_MS),
    });
    if (!resp.ok) {
      // Groq sentezi başarısız → en azından Tavily'nin hazır cevabını seslendir
      return search.answer || null;
    }
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const out = (data.choices?.[0]?.message?.content ?? '').replace(/\s+/g, ' ').trim();
    return out || search.answer || null;
  } catch {
    return search.answer || null; // ağ hatası → Tavily özetine düş
  }
}

/* ── Haiku (Anthropic) beyin çağrısı ────────────────────────── *
 * Hibrit zincirin son halkası: Gemini → Groq → Haiku. Anthropic Messages API
 * deseni aiVoiceService.askHaiku ile AYNI (endpoint/model/header'lar) — beyin
 * kararı burada da SADECE düz metin JSON talimatıyla istenir (responseMimeType
 * Anthropic'te yok, buildBrainSystemPrompt zaten "SADECE JSON" der). */

const HAIKU_COMPANION_ENDPOINT   = 'https://api.anthropic.com/v1/messages';
const HAIKU_COMPANION_MODEL      = 'claude-haiku-4-5-20251001';
const HAIKU_COMPANION_TIMEOUT_MS = 6000;

async function askCompanionBrainHaiku(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  timeoutMs?: number,
  tavilyKey?: string,
  searchKey?: string,
): Promise<CompanionBrainResult | null> {
  // Haiku da Groq gibi kendi başına canlı internete erişemez. Arama motoru olarak
  // Gemini (searchKey) VEYA Tavily varsa type:"web" üretebilir; grounding aşağıda
  // önce Gemini google_search'e devredilir (yoksa dürüst fallback).
  const hasGeminiSearch = !!searchKey && searchKey.trim().length > 8;
  const hasTavily       = !!tavilyKey && tavilyKey.trim().length > 8;
  const canGround = hasGeminiSearch || hasTavily;
  const decisionMs = Math.min(timeoutMs ?? HAIKU_COMPANION_TIMEOUT_MS, HAIKU_COMPANION_TIMEOUT_MS);
  const body = {
    model:      HAIKU_COMPANION_MODEL,
    max_tokens: isDriving ? 160 : 220,
    system:     buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), canGround),
    messages: [
      ...historyToOpenAI(),
      { role: 'user' as const, content: text },
    ],
  };

  const resp = await fetch(HAIKU_COMPANION_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body:   JSON.stringify(body),
    signal: signalWithTimeout(decisionMs), // Chrome <103 WebView güvenli (abortCompat)
  });

  // 429: KENDİ penceresi — Gemini'yi kilitlemez (çapraz kirlenme yasak).
  if (resp.status === 429) { _haikuRateLimitedUntil = _now() + RATE_LIMIT_COOLDOWN_MS; return null; }
  if (!resp.ok) return null;

  const data = await resp.json() as { content?: { type?: string; text?: string }[] };
  const raw  = (data.content?.find((c) => c.type === 'text')?.text ?? '').trim();
  const parsed = parseBrainJson(raw);
  if (parsed && parsed.kind === 'web') {
    // Hava sorgusu mu? → yerel hava servisi aramadan ÖNCE denenir (bkz. Groq).
    const localWeather = await tryLocalWeatherAnswer(parsed.query, text);
    if (localWeather) return { kind: 'chat', response: localWeather, route: 'companion_haiku' };
    // İNTERNET → ÖNCE Gemini google_search, GROUNDING soğumasındaysa Tavily (bkz. Groq).
    if (hasGeminiSearch && _now() >= _groundingCooldownUntil) {
      const grounded = await askGroundedGemini(parsed.query, searchKey as string, id, isDriving);
      if (grounded) return { kind: 'chat', response: grounded, route: 'companion_haiku' };
    }
    if (hasTavily) {
      const grounded = await groundHaikuWithTavily(parsed.query, text, apiKey, id, isDriving, tavilyKey as string);
      if (grounded) return { kind: 'chat', response: grounded, route: 'companion_haiku' };
      return { kind: 'chat', response: 'Aradım ama net bir sonuç bulamadım.', route: 'companion_haiku' };
    }
    if (hasGeminiSearch) {
      return { kind: 'chat', response: 'Aradım ama net bir sonuç bulamadım.', route: 'companion_haiku' };
    }
    const reply = 'Şu an canlı bilgilere bakamıyorum ama bildiğimce yardımcı olmaya çalışırım.';
    return { kind: 'chat', response: reply, route: 'companion_haiku' };
  }
  // parseBrainJson CHAT kararına HER ZAMAN 'companion_gemini' rotası yazar (paylaşılan
  // parser Gemini birincil çağrıyı varsayar) — Haiku'dan geldiğinde burada düzeltilir.
  if (parsed && parsed.kind === 'chat') return { ...parsed, route: 'companion_haiku' };
  return parsed;
}

/**
 * Haiku beyin çağrısını yapıp başarılıysa geçmişe/devre-kesiciye işler
 * (tryGroqBrainAndRecord ile aynı desen — hibrit zincirin son halkası).
 */
async function tryHaikuBrainAndRecord(
  text: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  timeoutMs?: number,
  tavilyKey?: string,
  searchKey?: string,
): Promise<CompanionBrainResult | null> {
  const result = await askCompanionBrainHaiku(text, apiKey, id, isDriving, timeoutMs, tavilyKey, searchKey);
  if (!result) return null;
  recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
  pushHistory('user', text);
  pushHistory('model', result.kind === 'chat' ? result.response : result.semantic.feedback);
  return result;
}

/**
 * Haiku grounding: Tavily ile web'i arar, sonuçları Haiku'ya (Anthropic) verip
 * doğal Türkçe yanıt sentezletir. Hata/boş sonuçta null → çağıran dürüst fallback yapar.
 */
async function groundHaikuWithTavily(
  searchQuery: string,
  userText: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  tavilyKey: string,
): Promise<string | null> {
  const search = await tavilySearch(searchQuery, tavilyKey);
  if (!search) return null;

  const ctxBlock = [
    search.answer ? `Özet: ${search.answer}` : '',
    search.context ? `Kaynaklar:\n${search.context}` : '',
  ].filter(Boolean).join('\n\n');

  const sysPrompt =
    `Sen ${id.assistantName} adlı araç asistanısın. Aşağıdaki GÜNCEL web arama sonuçlarına ` +
    `DAYANARAK kullanıcının sorusunu kısa, doğal Türkçe ile yanıtla. ` +
    `Sadece sonuçlardaki bilgiyi kullan, uydurma. Emin değilsen belirt. ` +
    `${isDriving ? 'Sürüş halinde: 1-2 cümle, çok kısa.' : 'En fazla 3-4 cümle.'} ` +
    `Kaynak numarası/URL okuma.`;

  const body = {
    model:      HAIKU_COMPANION_MODEL,
    max_tokens: isDriving ? 120 : 240,
    system:     sysPrompt,
    messages: [{ role: 'user' as const, content: `Soru: ${userText}\n\n${ctxBlock}` }],
  };

  try {
    const resp = await fetch(HAIKU_COMPANION_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify(body),
      signal:  signalWithTimeout(HAIKU_COMPANION_TIMEOUT_MS),
    });
    if (!resp.ok) return search.answer || null;
    const data = await resp.json() as { content?: { type?: string; text?: string }[] };
    const out = (data.content?.find((c) => c.type === 'text')?.text ?? '').replace(/\s+/g, ' ').trim();
    return out || search.answer || null;
  } catch {
    return search.answer || null; // ağ hatası → Tavily özetine düş
  }
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
  // SAHA 2026-07-03: "kamerayı aç", "radyoyu aç", "whatsapp aç" gibi GENEL uygulama
  // açma beyinde YOKTU → beyin sahte "açıyorum" deyip iş yapmıyordu. OPEN_APP eklendi
  // (appName ile herhangi bir yüklü uygulama; resolveAppByName isimle çözer).
  'OPEN_APP',
  // İÇ EKRAN/PANEL aç-kapat (trafik, klima, arıza kodları, yolculuk defteri, Gemini
  // QR…) — screenRegistry drawerBus/settingsFocusBus ile çözer. Uygulamanın kendi
  // yüzeyine sesli erişim (OPEN_APP yüklü Android uygulaması; OPEN_SCREEN iç ekran).
  'OPEN_SCREEN',
  'CHECK_VEHICLE_HEALTH', 'CHECK_MAINTENANCE',
  // Tema/görünüm (saha 2026-06-11: ASR bozuk "tema değiştir" yerel parser'ı
  // kaçırınca beyin devralabilmeli — eskiden listede yoktu, sohbete düşüyordu)
  'CYCLE_THEME', 'ENABLE_NIGHT_MODE',
  // SAHA 2026-07-03: "parlaklığı aç", "wifi'yi kapat" gibi AYAR komutları beyinde
  // YOKTU → beyin sahte "açıyorum" deyip iş yapmıyordu. SET_SETTING eklendi
  // (parlaklık/wifi/bluetooth/ses; alanlar parseBrainJson + fromSemanticResult ile taşınır).
  'SET_SETTING',
  // Yaygın istekler (VALID_INTENTS'te wired, beyinde eksikti → sohbete düşüyordu):
  'OPEN_FAVORITES', 'ENABLE_DRIVING_MODE', 'TOGGLE_SLEEP_MODE',
  // Uzun-dönem kişisel hafıza — kullanıcı AÇIKÇA "şunu unutma / aklında tut"
  // derse REMEMBER; "unut / hepsini unut" → FORGET (companionMemory store).
  'REMEMBER', 'FORGET',
  // V1 (ASSISTANT_VEHICLE_INTEGRATION_PLAN.md): araç SENSÖR DEĞERİ sorgusu.
  // Beyin DEĞER UYDURMAZ — yalnız QUERY_SENSOR + sensorQuery döner, gerçek
  // değeri sensorQueryService.querySensor okur (yerel parser zaten kaçırdı,
  // buraya yalnız TANIMADIĞI sensör adı düşer).
  'QUERY_SENSOR',
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

/**
 * Beynin "internet/grounding" kararı — DIŞA AÇIK DEĞİL. tryCompanionBrain bunu
 * ikinci grounded çağrıyla (Google Search) gerçek bir cevaba (CompanionBrainChat)
 * çözer; voiceService yalnız chat/action görür (dokunulmaz). query = aranacak
 * güncel bilgi.
 */
interface CompanionBrainWeb {
  kind:  'web';
  query: string;
}
type BrainRaw = CompanionBrainResult | CompanionBrainWeb;

/* Faz 3 — Persona Integration: kişilik beynin EN TEPESİNDE durur; hem sohbet
 * cevabının ("say") hem komut onayının ("feedback") tonunu belirler.
 * resolveCompanionIdentity dört değerden birini garanti eder; bilinmeyen
 * değer samimi'ye düşer (fail-soft). */
const BRAIN_PERSONA_ROLE: Record<string, string> = {
  sessiz:      'KİŞİLİĞİN (en öncelikli ton kuralı): SESSİZ YARDIMCI — az ve öz konuşursun, yalnız gerekeni söylersin.',
  samimi:      'KİŞİLİĞİN (en öncelikli ton kuralı): MAHALLE ARKADAŞI — sıcak, senli benli, eski dost rahatlığında konuşursun.',
  neseli:      'KİŞİLİĞİN (en öncelikli ton kuralı): NEŞELİ YOL ARKADAŞI — enerjik ve pozitifsin, yeri gelince espri yaparsın.',
  profesyonel: 'KİŞİLİĞİN (en öncelikli ton kuralı): MAKAM ASİSTANI — kısa, net ve saygılı konuşursun; argo ve laubalilik asla.',
};

/* Faz 3 — No Dead-Ends: beyin/ağ tamamen başarısız olsa bile kullanıcı "Hata"
 * duymaz; seçili kişiliğe uygun deterministik "tekrar rica" cümlesi söylenir
 * (yalnız ONLINE deneme başarısızken — offline'da null = eski dürüst zincir). */
const REASK_BY_PERSONALITY: Record<string, string> = {
  sessiz:      'Anlayamadım, tekrar eder misin?',
  samimi:      'Kusura bakma, tam yakalayamadım — bir daha söylesene.',
  neseli:      'Of, orayı kaçırdım! Hadi bir daha söyle.',
  profesyonel: 'Tam anlayamadım, tekrar alabilir miyim?',
};
const REASK_DEFAULT = 'Tam anlayamadım, bir daha söyler misin?';

/**
 * Beyin system prompt'u.
 * @param supportsGrounding true → Gemini (google_search grounding mevcut);
 *                          false → Groq gibi modeller (canlı internet YOK).
 */
function buildBrainSystemPrompt(id: CompanionIdentity, isDriving: boolean, vehicleContext: string, supportsGrounding = true): string {
  const chatPersona = buildCompanionSystemPrompt(id, isDriving, vehicleContext);
  const personaRole = BRAIN_PERSONA_ROLE[id.personality] ?? BRAIN_PERSONA_ROLE.samimi;
  return [
    `Sen "${id.assistantName}" adlı Türkçe araç içi asistansın.`,
    'Sen bir KOMUT ROBOTU DEĞİL, sürücüyle yol arkadaşlığı eden, aracın ve yolculuğun O ANKİ durumunu (DÜNYA GÖRÜŞÜN / World View — aşağıda verilir) sürekli bilen bir YARDIMCI PİLOTSUN. Bir komutu yerine getirirken bile bu bağlamı gözetir, önem taşıyan bir şey varsa kendiliğinden ve doğal biçimde değinirsin.',
    'Sen bu aracın TEK BEYNİSİN (Single Brain): arkanda başka bir ayrıştırıcı, parser ya da ikinci asistan katmanı YOK. Bu girdiye yalnız SEN cevap vereceksin — kararını tek başına ver.',
    'TEK KARAR: kullanıcı bir AKSİYON (araç komutu) mu yoksa SOHBET mi istiyor? İkisinden YALNIZ birini seç ve ona göre JSON döndür; asla ikisini birden döndürme.',
    personaRole,
    'Bu kişilik hem sohbet cevaplarının ("say") hem komut onaylarının ("feedback") tonunu belirler.',
    'Kullanıcı metni KUSURLU cihaz-içi konuşma tanımadan gelir: bozulmuş veya yanlış duyulmuş',
    'ÖZEL İSİMLERİ (sanatçı, şarkı, yer adı) en olası GERÇEK isme düzelt; emin değilsen olduğu gibi bırak.',
    'Yalnız özel isimler değil GENEL kelimeler de ASR\'de bozulur: sesçe en yakın anlamlı Türkçe ifadeye göre NİYETİ çöz ("birez muzuk ac" → "biraz müzik aç", "navü baş lat" → "navigasyonu başlat"). Harf/ses hatasına takılma; kullanıcının ne demek istediğine odaklan.',
    'ŞİVE DAYANIKLILIĞI: kullanıcı "birez", "kurban", "uşağum", "gardaş" gibi yöresel ifadeler kullanabilir.',
    'Bunları birer engel değil KARAKTER İPUCU olarak gör; komut niyetini bu şive katmanının altından cımbızla çek.',
    'GÖREV: metnin bir ARAÇ KOMUTU mu yoksa SOHBET mi olduğuna karar ver. SADECE JSON döndür.',
    '',
    'KOMUT ise: {"type":"action","intent":"...","query":"...","destination":"...","category":"...","feedback":"kısa Türkçe onay (≤8 kelime)","confidence":0.0-1.0}',
    `intent yalnız şunlardan biri: ${[...BRAIN_INTENTS].join(' | ')}`,
    'Müzik istekleri ("X\'ten müzik aç", "X çal", "X dinleyelim") → PLAY_MUSIC_SEARCH + query=DÜZELTİLMİŞ sanatçı/şarkı adı.',
    'Yer/mekan aramaları → SEARCH_POI + category + query. Adres/yere gitme → NAVIGATE_ADDRESS + destination.',
    'Tema/görünüm değiştirme ("temayı değiştir", "başka tema") → CYCLE_THEME; gece/karanlık mod → ENABLE_NIGHT_MODE.',
    // ── GENEL UYGULAMA AÇMA (OPEN_APP) ──
    'Bir uygulamayı açma ("X\'i aç", "X uygulamasını aç", "X\'i başlat") → OPEN_APP + appName=YALNIZ uygulamanın adı (fiil/ek yok, sadece ad: "kamera", "radyo", "whatsapp", "youtube", "hesap makinesi", "galeri").',
    'AMA şu özel durumlarda OPEN_APP KULLANMA, özel intent kullan: telefon/arama → OPEN_PHONE; müzik/çalar → OPEN_MUSIC; harita/navigasyon → OPEN_NAVIGATION; ayarlar → OPEN_SETTINGS. Bunların DIŞINDAKİ her uygulama adı için OPEN_APP.',
    // ── KİŞİ ADIYLA ARAMA (OPEN_PHONE + contactName) ──
    'Birini ARAMA ("X\'i ara", "X\'i telefonla ara", "annemi ara", "Selim\'e bağlan") → OPEN_PHONE + contactName=YALNIZ kişinin adı (fiil/ek yok: "Selim", "annem", "Ahmet Demir"). Ad rehberde aranır; feedback="X aranıyor".',
    'Kişi adı YOKSA, sadece "telefonu aç"/"arama ekranı" denmişse → OPEN_PHONE (contactName BOŞ bırak). Numarayı UYDURMA; yalnız adı taşı.',
    // ── İÇ EKRAN / PANEL AÇ-KAPAT (OPEN_SCREEN) ──
    'Uygulamanın KENDİ İÇ EKRANINI/panelini açma-kapatma → OPEN_SCREEN + screen=ekran adı + screenAction ("open"|"close"). İç ekranlar: "trafik", "hava durumu", "klima", "dashcam"/"araç kamerası"/"kayıt", "yolculuk defteri"/"seyir defteri", "arıza kodları"/"hata kodları", "bildirimler", "spor modu", "güvenlik", "eğlence", "bakım hatırlatma", "gemini qr"/"qr kodu".',
    'OPEN_SCREEN örnekleri: "trafiği aç", "klimayı aç", "arıza kodlarını göster", "yolculuk defterini aç", "gemini qr\'ı aç", "bildirimleri kapat". screen alanına YALNIZ ekran adını yaz (fiil/ek yok).',
    'AYRIM: yüklü bir Android uygulaması (kamera, whatsapp, youtube) → OPEN_APP. Uygulamanın kendi paneli/ekranı (trafik, klima, arıza kodları, gemini qr) → OPEN_SCREEN. Emin değilsen iç panel adıysa OPEN_SCREEN.',
    'Şive/sokak ağzı komutları da KOMUTTUR ("klimayı birez kıs kurban" gibi) — niyete odaklan, sohbete düşürme.',
    // ── AYAR KOMUTLARI (SET_SETTING) — parlaklık/wifi/bluetooth/ses ──
    'AYAR değiştirme → SET_SETTING + şu alanlar: settingKey ("brightness"|"wifi"|"bluetooth"|"volume"), settingKind ("number"|"bool"), settingAction ("inc"|"dec"|"on"|"off"|"toggle"|"set"), settingValue (opsiyonel, yüzde/enum).',
    'Örnekler: "ekran parlaklığını aç/artır" → SET_SETTING settingKey="brightness" settingKind="number" settingAction="inc". "parlaklığı kıs/azalt" → settingAction="dec". "wifi\'yi kapat" → settingKey="wifi" settingKind="bool" settingAction="off". "sesi aç" → settingKey="volume" settingKind="number" settingAction="inc".',
    // ── ÖZELLİK AÇ/KAPA TOGGLE\'LARI (SET_SETTING settingKind="bool") ──
    'Uygulama ÖZELLİĞİ aç/kapat → SET_SETTING settingKind="bool" settingAction ("on"|"off"|"toggle") + settingKey şunlardan biri: performanceMode (performans/güç modu), offlineMap (çevrimdışı harita), autoThemeEnabled (otomatik gece-gündüz teması), autoBrightnessEnabled (otomatik parlaklık), breakReminderEnabled (mola hatırlatma), dockAutoHide (dock otomatik gizle), smartContextEnabled (akıllı bağlam), obdAutoSleep (obd uyku), autoNavOnStart (açılışta navigasyon), companionEnabled (yol arkadaşı/asistan), companionWakeWordEnabled (uyanma kelimesi/"beni dinle"), use24Hour (24 saat), showSeconds (saniye göster).',
    'Özel modlar için özel intent kullan: gece modu → ENABLE_NIGHT_MODE; uyku modu → TOGGLE_SLEEP_MODE; sürüş modu → ENABLE_DRIVING_MODE. Bunları SET_SETTING yapma.',
    'Trafik/harita/navigasyon açma ("trafik panelini aç", "haritayı aç", "trafiğe bak") → OPEN_NAVIGATION.',
    // ── UZUN-DÖNEM KİŞİSEL HAFIZA (REMEMBER / FORGET) ──
    'HAFIZA: kullanıcı AÇIKÇA bir şeyi hatırlamanı isterse ("şunu unutma", "aklında tut", "not al", "beni ... olarak bil", "arabam dizel", "ben hep 95 alırım") → REMEMBER + memoryText=hatırlanacak KISA fact (sade cümle, "unutma ki" gibi ekleri at). Yalnız KALICI kişisel bilgi/tercih için; geçici komutları (aç/kapat) hafızaya YAZMA.',
    'HAFIZA SİLME: "unut", "aklından çıkar", "bunu unut", "hepsini unut", "hafızanı temizle" → FORGET + memoryText=unutulacak konu (hepsi için "hepsi").',
    'Kullanıcı "beni tanıyor musun / ne biliyorsun / neyi hatırlıyorsun" derse → HAFIZA bağlamındaki fact\'lerden doğal biçimde type:"chat" ile cevapla (yoksa dürüstçe "henüz bir şey not etmedim" de).',
    // ── ARAÇ SENSÖR DEĞERİ SORGUSU (QUERY_SENSOR) ──
    'ÇOK ÖNEMLİ — SENSÖR DEĞERİ UYDURMA: kullanıcı aracın GERÇEK ZAMANLI bir sensör/veri değerini sorarsa ("yağ sıcaklığı kaç", "turbo basıncı ne kadar", "akü voltajı nedir", "şasi numarası ne", "motor devri kaç") ASLA kafadan bir sayı/değer UYDURMA — sen bu veriye erişemezsin. Bunun yerine → QUERY_SENSOR + sensorQuery=sorulan sensörün adı (soru ekleri olmadan, sade: "yağ sıcaklığı", "turbo basıncı", "akü voltajı", "şasi numarası"). Gerçek değeri araç okur, sen asla söylemezsin.',
    'AYRIM: hız/yakıt/motor sıcaklığı/genel araç durumu gibi TEMEL sorular zaten yerel olarak cevaplanıyor (bu cümleler sana hiç ulaşmaz); buraya ulaşan sensör soruları senin BİLMEDİĞİN/tanımadığın özel sensörlerdir — yine de değer UYDURMA, QUERY_SENSOR döndür.',
    // ── SAHTE ONAY YASAĞI (SAHA 2026-07-03 — en kritik) ──
    'ÇOK ÖNEMLİ — SAHTE ONAY YASAK: bir ARAÇ EYLEMİ (aç/kapat/ayarla/göster) istendiğinde SADECE yukarıdaki intent listesinden GERÇEK bir karşılığı varsa type:"action" döndür. Karşılığı YOKSA sakın type:"chat" ile "tamam, açıyorum / açılıyor / hallettim" gibi YAPMIŞ GİBİ cevap verme — bu KULLANICIYI KANDIRMAKTIR. Onun yerine dürüstçe söyle: type:"chat" say="Bunu şu an yapamıyorum" (kişiliğine uygun). Var olmayan bir eylemi asla onaylama.',
    '',
    // ── İNTERNET / GÜNCEL BİLGİ (grounding) — supportsGrounding'e göre değişir ──
    ...(supportsGrounding ? [
      'İNTERNET ise: {"type":"web","query":"aranacak güncel bilgi (Türkçe, net)"}',
      'Şunlar İNTERNET\'tir → GÜNCEL, gerçek-zamanlı veya senin eğitim verinde olmayan/güncelliğini yitirmiş HER bilgi:',
      'haberler ve gündem özeti, son dakika, hava durumu detayı/tahmin, döviz/altın/borsa, maç sonucu/fikstür, bir kişi-yer-olay hakkında GÜNCEL gerçek, "bugün ne oldu", "X kaç para", "X kimdir/nedir" (güncel), film/etkinlik, açılış saatleri.',
      'Bu tür isteklerde ASLA kafadan cevap uydurma ve "erişimim yok" DEME — type:"web" döndür, query\'yi arama için en uygun biçimde yaz. Sistem aramayı yapıp cevabı senin yerine seslendirir.',
      'Genel/zamansız bilgi (matematik, tanım, nasıl yapılır, fıkra, bilmece, tavsiye) için web GEREKMEZ → doğrudan type:"chat" ile cevapla.',
    ] : [
      // Groq (ve grounding desteklemeyen modeller): canlı internet YOK.
      // type:"web" asla döndürme — bildiğin kadarıyla yanıtla, emin değilsen dürüstçe belirt.
      'Senin canlı/güncel internet erişimin YOK. Haber/döviz/hava/maç gibi anlık veri sorulursa bildiğin kadarıyla yanıtla ama emin olmadığında "kesin değil, değişmiş olabilir" diye dürüstçe belirt. ASLA type:"web" döndürme.',
    ]),
    '',
    'SOHBET ise: {"type":"chat","say":"..."} — say için şu kişilik kuralları geçerli:',
    chatPersona,
    '',
    // ── EĞLENCE & BİLGİ YETENEKLERİ (tam donanımlı asistan) ──
    'YETENEKLERİN (sohbet tarafında): sen tam donanımlı bir asistansın, bir komut robotu değil.',
    'Fıkra isteyince ("fıkra anlat", "bir şaka yap") → KISA, anlamlı, gerçekten komik ve Türk kültürüne uygun TEK bir fıkra anlat; saçma/anlamsız/yarım bırakma, başını-sonunu kur.',
    'Bilmece isteyince ("bilmece sor") → ZEKİCE tek bir bilmece SOR ve cevabı HEMEN verme; kullanıcı tahmin edince doğru/yanlış de ve doğru cevabı açıkla (geçmişten bilmeceyi hatırlarsın).',
    'Genel kültür/bilgi sorularını (zamansız olanları) net ve doğru yanıtla; tavsiye, hikâye, kelime oyunu, motivasyon da yapabilirsin. Hepsi düz konuşma metni — liste/madde/emoji yok.',
    '',
    'ASLA ÇIKMAZ YOK: metni hiç anlayamasan bile hata döndürme, boş dönme;',
    '{"type":"chat","say":"..."} ile kişiliğine uygun kısa bir tekrar-rica cümlesi üret ("Tam yakalayamadım, bir daha söyler misin?" gibi).',
    '',
    'ÖRNEKLER:',
    '"ibrahim tatlısesden müzik açar mısın" → {"type":"action","intent":"PLAY_MUSIC_SEARCH","query":"İbrahim Tatlıses","feedback":"İbrahim Tatlıses açılıyor","confidence":0.95}',
    '"acıktım bir şeyler yiyelim" → {"type":"action","intent":"SEARCH_POI","category":"RESTAURANT","query":"restoran","feedback":"Yakın restoranlar aranıyor","confidence":0.9}',
    '"uşağum şuralarda bi benzinlik bulsana" → {"type":"action","intent":"FIND_NEARBY_GAS","feedback":"Yakın benzinlikler aranıyor","confidence":0.9}',
    '"ekran parlaklığını aç" → {"type":"action","intent":"SET_SETTING","settingKey":"brightness","settingKind":"number","settingAction":"inc","feedback":"Parlaklık artırılıyor","confidence":0.9}',
    '"parlaklığı kıs" → {"type":"action","intent":"SET_SETTING","settingKey":"brightness","settingKind":"number","settingAction":"dec","feedback":"Parlaklık azaltılıyor","confidence":0.9}',
    '"haritayı aç" → {"type":"action","intent":"OPEN_NAVIGATION","feedback":"Harita açılıyor","confidence":0.9}',
    '"kamerayı aç" → {"type":"action","intent":"OPEN_APP","appName":"kamera","feedback":"Kamera açılıyor","confidence":0.92}',
    '"radyoyu açar mısın" → {"type":"action","intent":"OPEN_APP","appName":"radyo","feedback":"Radyo açılıyor","confidence":0.9}',
    '"whatsapp\'ı aç" → {"type":"action","intent":"OPEN_APP","appName":"whatsapp","feedback":"WhatsApp açılıyor","confidence":0.92}',
    '"hesap makinesini aç" → {"type":"action","intent":"OPEN_APP","appName":"hesap makinesi","feedback":"Hesap makinesi açılıyor","confidence":0.9}',
    '"Selim\'i ara" → {"type":"action","intent":"OPEN_PHONE","contactName":"Selim","feedback":"Selim aranıyor","confidence":0.93}',
    '"annemi telefonla ara" → {"type":"action","intent":"OPEN_PHONE","contactName":"annem","feedback":"Annem aranıyor","confidence":0.9}',
    '"arabam dizel, unutma" → {"type":"action","intent":"REMEMBER","memoryText":"Arabası dizel","feedback":"Aklımda tuttum","confidence":0.92}',
    '"ben hep 95 benzin alırım" → {"type":"action","intent":"REMEMBER","memoryText":"Hep 95 benzin alır","feedback":"Not ettim","confidence":0.9}',
    '"benzin tercihimi unut" → {"type":"action","intent":"FORGET","memoryText":"benzin","feedback":"Unuttum","confidence":0.9}',
    '"hakkımda ne biliyorsun" → {"type":"chat","say":"..."} (hafızandaki fact\'lerden doğal biçimde anlat)',
    // QUERY_SENSOR — sensör DEĞERİNİ ASLA uydurma, yalnız soruyu taşı.
    '"yağ sıcaklığı kaç" → {"type":"action","intent":"QUERY_SENSOR","sensorQuery":"yağ sıcaklığı","feedback":"Bakıyorum","confidence":0.9}',
    '"şasi numarası nedir" → {"type":"action","intent":"QUERY_SENSOR","sensorQuery":"şasi numarası","feedback":"Bakıyorum","confidence":0.85}',
    // OPEN_SCREEN — uygulamanın iç ekranları/panelleri.
    '"trafiği aç" → {"type":"action","intent":"OPEN_SCREEN","screen":"trafik","screenAction":"open","feedback":"Trafik paneli açılıyor","confidence":0.92}',
    '"klimayı aç" → {"type":"action","intent":"OPEN_SCREEN","screen":"klima","screenAction":"open","feedback":"Klima açılıyor","confidence":0.9}',
    '"arıza kodlarını göster" → {"type":"action","intent":"OPEN_SCREEN","screen":"arıza kodları","screenAction":"open","feedback":"Arıza kodları açılıyor","confidence":0.92}',
    '"gemini qr\'ı aç" → {"type":"action","intent":"OPEN_SCREEN","screen":"gemini qr","screenAction":"open","feedback":"Gemini QR açılıyor","confidence":0.92}',
    '"bildirimleri kapat" → {"type":"action","intent":"OPEN_SCREEN","screen":"bildirimler","screenAction":"close","feedback":"Bildirimler kapatılıyor","confidence":0.9}',
    // Özellik aç/kapa toggle'ları — SET_SETTING settingKind="bool".
    '"performans modunu aç" → {"type":"action","intent":"SET_SETTING","settingKey":"performanceMode","settingKind":"bool","settingAction":"on","feedback":"Performans modu açık","confidence":0.9}',
    '"uyku modunu kapat" → {"type":"action","intent":"TOGGLE_SLEEP_MODE","feedback":"Uyku modu değişti","confidence":0.9}',
    '"wifiyi kapat" → {"type":"action","intent":"SET_SETTING","settingKey":"wifi","settingKind":"bool","settingAction":"off","feedback":"Wi-Fi kapatılıyor","confidence":0.9}',
    '"nasılsın bugün" → {"type":"chat","say":"İyiyim, teşekkürler. Yol nasıl gidiyor?"}',
    '"bir fıkra anlat" → {"type":"chat","say":"Temel vapurda..."} (gerçek, başı-sonu olan kısa bir fıkra)',
    '"bana bir bilmece sor" → {"type":"chat","say":"Benden kaçar ama hep peşimdedir, nedir? Bil bakalım."} (cevabı verme, sor)',
    // Web örnek komutları yalnız grounding destekli modellere gösterilir.
    ...(supportsGrounding ? [
      '"bugünün haberlerini özetle" → {"type":"web","query":"bugün Türkiye gündem son dakika haber özeti"}',
      '"dolar kaç para" → {"type":"web","query":"güncel dolar TL kuru"}',
      '"hava yarın nasıl olacak" → {"type":"web","query":"yarın hava durumu tahmini"}',
      // ŞEHİR ADI geçen hava → web (SHOW_WEATHER yalnız BULUNDUĞUN yer içindir; şehir
      // adı verilince yerel hava YANLIŞ olur — İstanbul sorulup Tarsus dönüyordu).
      '"İstanbul için hava durumu" → {"type":"web","query":"İstanbul güncel hava durumu"}',
      '"Ankara\'da hava nasıl" → {"type":"web","query":"Ankara güncel hava durumu"}',
    ] : [
      '"bugünün haberlerini özetle" → {"type":"chat","say":"Güncel haberlere şu an bakamıyorum ama yardımcı olmaya çalışırım."}',
    ]),
  ].join('\n');
}

interface BrainJson {
  type?:        string;
  intent?:      string;
  query?:       string;
  destination?: string;
  category?:    string;
  settingKey?:    string;
  settingKind?:   string;
  settingAction?: string;
  settingValue?:  string;
  appName?:     string;
  screen?:      string;
  screenAction?: string;
  contactName?: string;
  memoryText?:  string;
  sensorQuery?: string;
  feedback?:    string;
  confidence?:  number;
  say?:         string;
}

function parseBrainJson(raw: string): BrainRaw | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned) as BrainJson;
    if (obj.type === 'web' && typeof obj.query === 'string' && obj.query.trim()) {
      return { kind: 'web', query: obj.query.replace(/\s+/g, ' ').trim().slice(0, 200) };
    }
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
          // SET_SETTING alanları — beyin parlaklık/wifi/bluetooth/ses ayarını taşır.
          settingKey:    typeof obj.settingKey === 'string' ? obj.settingKey : undefined,
          settingKind:   typeof obj.settingKind === 'string' ? obj.settingKind : undefined,
          settingAction: typeof obj.settingAction === 'string' ? obj.settingAction : undefined,
          settingValue:  typeof obj.settingValue === 'string' ? obj.settingValue : undefined,
          // OPEN_APP — açılacak uygulamanın serbest adı ("kamera", "radyo", "whatsapp").
          appName:     typeof obj.appName === 'string' ? obj.appName : undefined,
          // OPEN_SCREEN — iç ekran adı + eylem ("trafik" / "gemini qr", open|close).
          screen:      typeof obj.screen === 'string' ? obj.screen : undefined,
          screenAction: typeof obj.screenAction === 'string' ? obj.screenAction : undefined,
          // OPEN_PHONE — aranacak kişi adı ("Selim", "annem"); rehberde aranır.
          contactName: typeof obj.contactName === 'string' ? obj.contactName : undefined,
          // REMEMBER/FORGET — kalıcı kişisel fact metni (companionMemory).
          memoryText:  typeof obj.memoryText === 'string' ? obj.memoryText : undefined,
          // QUERY_SENSOR — sorulan sensörün adı (DEĞER YOK — şemada bilinçli eksik).
          sensorQuery: typeof obj.sensorQuery === 'string' ? obj.sensorQuery : undefined,
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
  timeoutMs?: number,
): Promise<BrainRaw | null> {
  const contents = [
    ..._history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text }] },
  ];
  const body = {
    system_instruction: {
      // Gemini grounding'i destekler → supportsGrounding: true (varsayılan)
      parts: [{ text: buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), true) }],
    },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature:      0.4,
      maxOutputTokens:  isDriving ? 160 : 220,
      thinkingConfig:   { thinkingBudget: 0 }, // düşünen model bütçe koruması (SAHA 2026-07-03)
    },
  };
  // Single Brain karar bütçesi: voiceService 2.5sn iletir. GEMINI_TIMEOUT_MS
  // tavanına clamp'lenir → beyin ASLA 6sn'den uzun bloklamaz; süre dolunca fetch
  // abort olur, çağıran (tryCompanionBrain) recordAiNetFailure + fallback'e düşer.
  const decisionMs = Math.min(timeoutMs ?? GEMINI_TIMEOUT_MS, GEMINI_TIMEOUT_MS);
  const resp = await fetch(GEMINI_CHAT_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body:    JSON.stringify(body),
    signal:  signalWithTimeout(decisionMs), // Chrome <103 WebView güvenli (abortCompat)
  });
  // 429: Google'ın söylediği kadar bekle (retryDelay) — sabit 60sn asistanı
  // gereksiz uzun "offline" bırakıyordu (SAHA 2026-07-04).
  if (resp.status === 429) { _rateLimitedUntil = _now() + await _cooldownFrom429(resp); return null; }
  if (!resp.ok) return null;
  const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return parseBrainJson((data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim());
}

/* ── GROUNDED yanıt (Google Search) — güncel/internet bilgisi ──
 * Beyin type:"web" dediğinde çağrılır. google_search aracı GERÇEK ZAMANLI web
 * sonucuna dayandırır (haber/döviz/hava/spor…). responseMimeType JSON ile
 * BİRLEŞMEZ → serbest metin döner; çok parçalı olabilir, hepsi birleştirilir.
 * Grounding çağrısı normal sohbetten yavaştır → ayrı (daha uzun) timeout. */
const GROUNDED_TIMEOUT_MS = 8000;

function buildGroundedSystemPrompt(id: CompanionIdentity, isDriving: boolean): string {
  const personaRole = BRAIN_PERSONA_ROLE[id.personality] ?? BRAIN_PERSONA_ROLE.samimi;
  const brevity = isDriving
    ? 'Sürücü ŞU AN ARAÇ KULLANIYOR: en fazla 2 kısa cümle, en kritik bilgiyi ver.'
    : 'En fazla 4-5 akıcı cümle; haber/özet istenirse en önemli 2-3 gelişmeyi tek paragrafta topla.';
  return [
    `Sen "${id.assistantName}" adlı, araçta sürücüye eşlik eden Türkçe konuşan bir sesli asistansın.`,
    'Sana verilen Google arama sonuçlarını kullanarak kullanıcının sorusunu GÜNCEL ve DOĞRU yanıtla.',
    'Cevabın SESLENDİRİLECEK: yalnız düz konuşma metni. Liste, madde işareti, markdown, emoji, başlık, parantez içi kaynak/URL OKUMA.',
    'Tarih ve rakamları doğal söyle ("dolar 32 lira 40 kuruş" gibi). Net bir sonuç yoksa bunu dürüstçe söyle, UYDURMA.',
    personaRole,
    brevity,
  ].join(' ');
}

async function askGroundedGemini(
  query: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
): Promise<string | null> {
  const body = {
    system_instruction: { parts: [{ text: buildGroundedSystemPrompt(id, isDriving) }] },
    contents: [
      ..._history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      { role: 'user', parts: [{ text: query }] },
    ],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3, maxOutputTokens: isDriving ? 140 : 360, thinkingConfig: { thinkingBudget: 0 } },
  };
  try {
    const resp = await fetch(GEMINI_CHAT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify(body),
      signal:  signalWithTimeout(GROUNDED_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
    });
    // GROUNDING 429 → yalnız GROUNDING soğuması (beyin cooldown'ını KİRLETME).
    // Beyin karar/sentez çağrıları çalışmaya devam eder; grounding atlanır → Tavily.
    if (resp.status === 429) { _groundingCooldownUntil = _now() + await _cooldownFrom429(resp); return null; }
    if (!resp.ok) return null;
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    // Grounded cevap birden çok text parçasına bölünebilir → hepsini birleştir.
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const raw = parts.map((p) => p.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    recordAiNetSuccess();
    if (raw.length <= 380) return raw;
    const head = raw.slice(0, 377);
    const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    return lastEnd > 150 ? head.slice(0, lastEnd + 1) : `${head}...`;
  } catch {
    // Grounding (ağır google_search) timeout/ağ hatası — beyin KARAR çağrısı hemen
    // ÖNCE başarılıydı (ağ ayakta). Bunu BEYİN devre kesicisine YAZMA: yazarsak tek
    // grounding timeout'u kesici sayacını kirletir ve FAIL_THRESHOLD=2 breaker'ı
    // 90sn açıp TÜM AI'yı offline'a kilitleyebilir ("iki istekte offline" bug'ı).
    // 429 ile aynı: yalnız grounding'i soğut → Tavily'ye düş.
    _groundingCooldownUntil = _now() + RATE_LIMIT_COOLDOWN_MS;
    return null;
  }
}

/**
 * GEMINI yolunda Tavily yedeği (SAHA 2026-07-04): Gemini google_search grounding
 * ücretsiz katmanda çok küçük kotalı → 429 veriyor. Eskiden Tavily YALNIZ Groq/Haiku
 * beynine bağlıydı; Gemini birincil olunca kullanıcının Tavily anahtarı HİÇ
 * kullanılmıyor, web araması komple ölüyordu. Bu yardımcı Tavily ile arar, sonucu
 * DÜZENLİ Gemini (429 olan google_search DEĞİL, sıradan generateContent) ile doğal
 * Türkçe cevaba sentezler. Sentez düşerse Tavily'nin hazır cevabına düşer.
 */
async function groundGeminiViaTavily(
  searchQuery: string,
  userText: string,
  apiKey: string,
  id: CompanionIdentity,
  isDriving: boolean,
  tavilyKey: string,
): Promise<string | null> {
  const search = await tavilySearch(searchQuery, tavilyKey);
  if (!search) return null;
  const ctxBlock = [
    search.answer ? `Özet: ${search.answer}` : '',
    search.context ? `Kaynaklar:\n${search.context}` : '',
  ].filter(Boolean).join('\n\n');
  const sysPrompt =
    `Sen ${id.assistantName} adlı araç asistanısın. Aşağıdaki GÜNCEL web arama sonuçlarına ` +
    `DAYANARAK kullanıcının sorusunu kısa, doğal Türkçe ile yanıtla. Sadece sonuçlardaki bilgiyi ` +
    `kullan, uydurma. ${isDriving ? 'Sürüş halinde: 1-2 cümle.' : 'En fazla 3-4 cümle.'} Kaynak numarası/URL okuma.`;
  try {
    const resp = await fetch(GEMINI_CHAT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify({
        system_instruction: { parts: [{ text: sysPrompt }] },
        contents: [{ role: 'user', parts: [{ text: `Soru: ${userText}\n\n${ctxBlock}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: isDriving ? 120 : 240, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: signalWithTimeout(GEMINI_TIMEOUT_MS),
    });
    if (!resp.ok) return search.answer || null; // sentez başarısız → Tavily özeti
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    return out || search.answer || null;
  } catch { return search.answer || null; }
}

/**
 * Birleşik beyin girişi — voiceService router'ı parser <0.7 her cümlede
 * bunu çağırır. HİBRİT ZİNCİR (SIRA SABİT): Gemini → Groq → Haiku — biri
 * kota/hata/429 verirse (veya Gemini soğuma penceresindeyse) sıradaki
 * dener. Zincirin tamamı düşerse offline sohbet fallback'i (yalnız chat)
 * döner; o da yoksa null → eski zincir devam eder.
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

  // Geriye uyum: chain verilmezse opts.provider/apiKey ile eski tek-sağlayıcı
  // davranışı üretilir (testler ve tryCompanionChat gibi diğer çağıranlar için).
  const chain: ReadonlyArray<{ provider: 'gemini' | 'groq' | 'haiku'; apiKey: string }> =
    opts.chain && opts.chain.length > 0
      ? opts.chain
      : (opts.provider === 'gemini' || opts.provider === 'groq' || opts.provider === 'haiku') && opts.apiKey
        ? [{ provider: opts.provider, apiKey: opts.apiKey }]
        : [];

  const netUsable = opts.hasNet === true && chain.length > 0;
  let aiAttempted = false;
  // TÜM adaylar kota soğumasından atlandı (hiçbiri denenmedi) → aşağıda dürüst
  // kota cevabı (offline motorun söyleyecek sözü yoksa).
  let rateLimitedOnly = false;

  if (netUsable) {
    const id = resolveCompanionIdentity(settings);
    // ⚠️ AĞ hatası ≠ SAĞLAYICI hatası (SAHA 2026-07-04, "internetim var ama offline
    // sanıyor"): sunucudan HTTP yanıtı gelen HER durum (429 kota, 400/401, bozuk
    // JSON parse) ağın CANLI olduğunun kanıtıdır — devre kesiciye YAZILMAZ. Kesici
    // yalnız fetch'in THROW ettiği gerçek ağ ölümünde (timeout/DNS/kopma) sayar.
    // Eski davranış: sağlayıcı null'ları da sayılıyordu → 2 cümlede breaker açılıp
    // 90sn TÜM asistanı (STT dahil) offline'a kilitliyordu.
    let sawNetFailure = false;
    // Kota teşhisi (SAHA 2026-07-04, "ilk istek online sonrakiler offline"):
    // adaylar 429 soğumasından atlanınca kullanıcı sahte "offline" yaşıyordu —
    // hepsi soğumadaysa aşağıda dürüst kota cevabı verilir.
    let skippedByCooldown = false;
    // n-best: beyne gönderilecek metin (STT alternatifleriyle zenginleştirilmiş).
    // pushHistory/local yollar TEMİZ `trimmed` kullanmaya devam eder — yalnız
    // sağlayıcı çağrılarının user içeriği ipuçlu olur.
    const brainInput = _withAltHint(trimmed, opts.alternatives);

    for (const cand of chain) {
      // KENDİ soğuma penceresindeki aday ATLANIR (sıradaki denenir). Pencereler
      // sağlayıcı-bazlıdır: birinin 429'u diğerini asla kilitlemez — eski paylaşılan
      // pencere Groq 429'unda Gemini'yi de susturuyordu (çapraz kirlenme).
      if (cand.provider === 'gemini' && _now() < _rateLimitedUntil)      { skippedByCooldown = true; continue; }
      if (cand.provider === 'groq'   && _now() < _groqRateLimitedUntil)  { skippedByCooldown = true; continue; }
      if (cand.provider === 'haiku'  && _now() < _haikuRateLimitedUntil) { skippedByCooldown = true; continue; }
      aiAttempted = true;

      try {
        if (cand.provider === 'gemini') {
          // Gemini attarsa (timeout/ağ hatası) zincirdeki sıradakini de
          // deneyebilmek için yalnız Gemini çağrısı kendi try/catch'inde izole
          // edilir — dıştaki catch yalnız TÜM zincir tükendiğinde bir kez sayar.
          let result: BrainRaw | null = null;
          try {
            result = await askCompanionBrain(brainInput, cand.apiKey, id, isDriving, opts.timeoutMs);
          } catch { result = null; sawNetFailure = true; /* GERÇEK ağ hatası (throw) — sıradaki aday denenecek */ }

          if (result) {
            recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
            // İNTERNET kararı: hava-benzeri sorguda önce yerel hava servisi,
            // yoksa ikinci grounded çağrıyla (Google Search) gerçek cevabı üret;
            // voiceService'e CHAT olarak dön (web tipini hiç görmez).
            if (result.kind === 'web') {
              const localWeather = await tryLocalWeatherAnswer(result.query, trimmed);
              if (localWeather) {
                pushHistory('user', trimmed);
                pushHistory('model', localWeather);
                return { kind: 'chat', response: localWeather, route: 'companion_gemini' };
              }
              // Grounding yalnız KENDİ soğuma penceresi dışındaysa denenir — kota
              // 429'unda tekrar tekrar 1sn yemeyip doğrudan Tavily'ye geçilir.
              if (_now() >= _groundingCooldownUntil) {
                const grounded = await askGroundedGemini(result.query, cand.apiKey, id, isDriving);
                if (grounded) {
                  pushHistory('user', trimmed);
                  pushHistory('model', grounded);
                  return { kind: 'chat', response: grounded, route: 'companion_gemini' };
                }
              }
              // Gemini google_search 429/başarısız/soğumada → TAVILY YEDEĞİ (SAHA 2026-07-04).
              // Gemini grounding ücretsiz kotası çok küçük; kullanıcının Tavily anahtarı
              // eskiden yalnız Groq/Haiku'ya bağlıydı → Gemini birincilken web ölüydü.
              const hasTavily = !!opts.tavilyKey && opts.tavilyKey.trim().length > 8;
              if (hasTavily) {
                const tav = await groundGeminiViaTavily(result.query, trimmed, cand.apiKey, id, isDriving, opts.tavilyKey as string);
                if (tav) {
                  pushHistory('user', trimmed);
                  pushHistory('model', tav);
                  return { kind: 'chat', response: tav, route: 'companion_gemini' };
                }
              }
              // grounding+Tavily boş/başarısız → CANLI VERİ alınamadı, ama BEYİN
              // BAŞARILIYDI (yukarıda recordAiNetSuccess, sayaç=0). Bu bir AĞ
              // hatası DEĞİL, yalnız güncel-bilgi eksiği → devre kesiciyi TETİKLEME.
              // Sıradaki adayı (Groq/Haiku + searchKey/Tavily) dene; o da yoksa
              // offline fallback dürüstçe cevap/tekrar-rica verir. Böylece tek
              // başarısız web sorgusu TÜM asistanı 90sn offline'a KİLİTLEMEZ.
              continue;
            }
            // Sohbet sürekliliği: aksiyon turları da geçmişe girer ("onu da çal" gibi
            // bağlamlı devam cümleleri için).
            pushHistory('user', trimmed);
            pushHistory('model', result.kind === 'chat' ? result.response : result.semantic.feedback);
            return result;
          }
          // result null ama THROW YOK = HTTP yanıtı alındı (429/4xx/parse) → ağ
          // canlı, kesiciye sayma; sıradaki adaya geç.
          continue;
        }

        if (cand.provider === 'groq') {
          const result = await tryGroqBrainAndRecord(brainInput, cand.apiKey, id, isDriving, opts.timeoutMs, opts.tavilyKey, opts.searchKey);
          if (result) return result;
          continue; // null = HTTP-yanıtlı sağlayıcı hatası → ağ canlı, sayma
        }

        // cand.provider === 'haiku' — zincirin son halkası
        const result = await tryHaikuBrainAndRecord(brainInput, cand.apiKey, id, isDriving, opts.timeoutMs, opts.tavilyKey, opts.searchKey);
        if (result) return result;
        // null → HTTP-yanıtlı sağlayıcı hatası; ağ canlı, sayma
      } catch { sawNetFailure = true; /* bu adayda GERÇEK ağ hatası (throw) — sıradakine geç */ }
    }

    // Yalnız GERÇEK ağ hatası (throw/timeout) görüldüyse bir KEZ say — kesici
    // her adayda ayrı ayrı değil, tüm zincir tükendiğinde bir kez tetiklenir.
    // Sağlayıcı-null'ları (429/4xx/parse) buraya HİÇ girmez: internet varken
    // kesici açılmaz, asistan "internet yok" moduna düşmez.
    if (sawNetFailure) recordAiNetFailure();

    rateLimitedOnly = !aiAttempted && skippedByCooldown;
  }

  // Offline fallback: yalnız sohbet (komut kararı offline'da yerel parser'ındır)
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { kind: 'chat', response: offline, route: 'companion_offline' };

  // Kota soğuması: sahte aptallaşma yerine DÜRÜST cevap (SAHA 2026-07-04, "ilk
  // istek online sonrakiler offline") — kullanıcı "internet gitti" değil gerçek
  // nedeni duyar; pencere kapanınca kendiliğinden normale döner. Smalltalk yukarıda
  // offline motora bırakıldı (o cevaplar zaten doğal), buraya yalnız bilgi/sohbet
  // soruları düşer.
  if (rateLimitedOnly) {
    return { kind: 'chat', response: RATE_LIMIT_REPLY, route: 'companion_rate_limited' };
  }

  // Faz 3 — No Dead-Ends: ONLINE deneme yapıldı ama beyin/ağ/parse başarısız
  // VE offline'ın da söyleyecek sözü yoksa kullanıcı "Hata/anlaşılamadı" değil,
  // kişiliğe uygun bir tekrar-rica duyar (takip dinlemesi açılır → tekrar söyler).
  // AI HİÇ denenmediyse (offline) null korunur: eski dürüst zincir
  // (yerel öneriler + offline müzik kapısı) bozulmaz.
  if (aiAttempted) {
    const reask = REASK_BY_PERSONALITY[resolveCompanionIdentity(settings).personality] ?? REASK_DEFAULT;
    return { kind: 'chat', response: reask, route: 'companion_offline' };
  }
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
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 50, thinkingConfig: { thinkingBudget: 0 } },
    };
    const resp = await fetch(GEMINI_CHAT_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify(body),
      signal:  signalWithTimeout(REPAIR_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const obj = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')) as { q?: string };
    const fixed = typeof obj.q === 'string' ? obj.q.replace(/\s+/g, ' ').trim() : '';
    if (!fixed || fixed.length > 80) return null;
    recordAiNetSuccess();
    return fixed === q ? null : fixed;
  } catch {
    // 1.8sn mikro-bütçeli OPSİYONEL süsleme çağrısı — timeout'u BEKLENEN durumdur
    // (soğuk modelde ~7sn). BEYİN devre kesicisine YAZILMAZ: eskiden iki müzik
    // komutu üst üste onarım timeout'u yiyince breaker 90sn TÜM asistanı offline'a
    // kilitliyordu ("ilk istek online, sonrakiler offline" — SAHA 2026-07-04).
    // Komut ham sorguyla aynen devam eder (fail-soft).
    return null;
  }
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

  // ── Öncelikli yol: GERÇEK AI sohbeti (Gemini veya Groq) ──
  const geminiUsable =
    opts.provider === 'gemini' &&
    !!opts.apiKey &&
    opts.hasNet === true &&
    _now() >= _rateLimitedUntil;

  const groqUsable =
    opts.provider === 'groq' &&
    !!opts.apiKey &&
    opts.hasNet === true &&
    _now() >= _groqRateLimitedUntil; // Groq KENDİ penceresi (Gemini'ninki değil)

  if (geminiUsable) {
    try {
      const reply = await askCompanionGemini(trimmed, opts.apiKey as string, resolveCompanionIdentity(settings), isDriving);
      if (reply) {
        recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
        pushHistory('user', trimmed);
        pushHistory('model', reply);
        return { response: reply, route: 'companion_gemini' };
      }
    } catch { recordAiNetFailure(); /* timeout / ağ — sessizce offline'a düş */ }
  } else if (groqUsable) {
    try {
      const reply = await askCompanionGroq(trimmed, opts.apiKey as string, resolveCompanionIdentity(settings), isDriving);
      if (reply) {
        recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
        pushHistory('user', trimmed);
        pushHistory('model', reply);
        return { response: reply, route: 'companion_groq' };
      }
    } catch { recordAiNetFailure(); /* timeout / ağ — sessizce offline'a düş */ }
  }

  // ── Offline fallback: internet yok · key yok · hata/timeout · 429 ──
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { response: offline, route: 'companion_offline' };
  return null;
}
