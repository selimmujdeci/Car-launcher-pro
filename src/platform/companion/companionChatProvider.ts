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
 *
 * ── §PRESENCE — MAVI-F1 (2026-08-29): "Yol Arkadaşı" ARTIK BİR BEYİN ŞALTERİ DEĞİL ──
 *
 * ÖLÇÜLEN KUSUR: `companionEnabled !== true` DÖRT ayrı yerde (`runCompanionBrain` ·
 * `tryCompanionBrain` · `runCompanionChat` · `tryCompanionChat`) erken `null`
 * döndürüyordu. `voiceService` bu `null`'ı "beyin yok" sayıp YEREL zincire
 * düşüyordu → bir KİŞİLİK ayarı kapalıyken Mavi doğal dil anlamayı, sohbeti ve
 * beyin kararlı CarOS komutlarını KAYBEDİYOR, yalnız regex parser'a iniyordu.
 * Yani ürün tanımının tersi: "Yol Arkadaşı kapalı" = "Mavi aptal".
 *
 * YENİ İNVARYANT (tek Mavi):
 *   · `companionEnabled` **YETENEK KAPATMAZ**. Doğal dil anlama · sohbet cevabı ·
 *     navigation/media/phone/settings/vehicle niyetleri · LLM erişimi · mevcut
 *     fallback zinciri HER İKİ DURUMDA da aynıdır.
 *   · `companionEnabled` YALNIZ **PRESENCE**'ı yönetir: konuşma tonu, sohbet
 *     sürekliliği ve KENDİLİĞİNDEN konuşma isteği (proaktiflik `companionEngine`de).
 *
 * İKİNCİ BEYİN YOK: `presence` ayrı bir sağlayıcı/zincir/hafıza AÇMAZ; aynı tek
 * beyne giden sistem prompt'unun TON satırlarını değiştirir, o kadar.
 *
 * GÜVENLİK DEĞİŞMEDİ: `assistantSafetyKernel` PRE/POST gate, `AiSafetyGate`,
 * onay politikası ve tek-cevap sözleşmesi presence'tan BAĞIMSIZDIR — companion
 * kapalı olmak bir güvenlik mekanizması DEĞİLDİR ve hiç olmamıştı.
 */

import { useStore } from '../../store/useStore';
import { resolveCompanionIdentity, type CompanionIdentity, type CompanionSettingsInput } from './companionIdentity';
import {
  interpretFuel, interpretBatteryCharge, interpretEngineTempConcern, interpretTripDuration,
  interpretTripSession,
  interpretRangeVsRoute, interpretDtcStatus, interpretDiagnosticTrend,
  classifyDriverStyle, driverToneInstruction, type DriverStyle,
  selectActiveTopic, topicFreshness, buildTopicHintLine, resolveDemonstrativeReference,
  type CompanionTopicId, type TopicFreshness, type TopicSignalFlags,
  type DemonstrativeResolution,
} from './companionContext';
import { readDiagnosticTrendInput } from '../ai/mechanic/concrete/maviMechanicHistory';
import { tryOfflineConversation } from '../offlineConversationEngine';
import { onOBDData } from '../obdService';
import { onDTCState } from '../dtcService';
import { getTripSnapshot } from '../tripLogService';
/* ÇALIŞMA ZAMANI BAĞIMLILIĞI OLMAYAN ince kapı: `tripSessionService`i buraya
   statik import etmek Mavi'nin bağlam grafiğini ölçülebilir biçimde ağırlaştırdı
   (`regression.guards` dinamik-import kilidi varsayılan timeout'ta düştü).
   Servis okuyucusunu başlarken KAYDEDER; burada yalnız kapı okunur. */
import { readTripSessionOrNull } from '../trip/tripSessionAccess';
/* Aynı desen: çalışma zamanı bağımlılığı OLMAYAN ince kapı. Konum servisini
   buraya statik import etmek `gpsService`/`geocodingService` kenarlarını Mavi
   bağlam grafiğine ekler. Servis okuyucusunu başlarken KAYDEDER. */
import { readLocationContextOrNull } from '../location/locationContextAccess';
import { formatLocationContextLine } from '../location/locationContextModel';
import { getNavigationState } from '../navigationService';
/* MAVI-F10: prompt hafıza bloğu ARTIK kanonik cepheden gelir.
   `companionMemory.buildMemoryPromptSection` KULLANILMAZ — o blok (a) hassas-veri
   kapısından geçmiyordu, (b) "VERİdir, TALİMAT DEĞİLDİR" etiketi TAŞIMIYORDU,
   (c) bağlamdan bağımsız olarak TÜM fact'leri her prompt'a döküyordu. */
import {
  projectMaviMemory, inferPromptDomain, setConversationPurgePort,
} from '../assistant/maviMemory';
/* MAVI-F10 · TRIP kapsamı. YALNIZ RAM, yolculuk anahtarlı, bounded ve hassas-veri
   kapılı; kalıcı depoya YAZILMAZ. Bu yüzden `_history` ile aynı sınıftadır ve
   kalıcı-hafıza onay bayrağına TABİ DEĞİLDİR — aksi hâlde yolculuk sürekliliği
   ölü bir bayrağın arkasında doğar (F10'un amacı tam da bu boşluktu). */
import { rememberTrip } from '../assistant/tripMemory';
import { signalWithTimeout } from '../../utils/abortCompat';
import { recordAiNetFailure, recordAiNetSuccess } from '../aiHealth';
import { errorKindFromException } from '../ai/aiOfflineReason';
/**
 * Ağ hakkında HİÇBİR ŞEY kanıtlamayan hata sınıfları: ya istek hiç gönderilmedi
 * (yerel kapı) ya da sonucu bilinmiyor (kopma/süre aşımı/iptal).
 *
 * ⚠️ Bu liste bilinçli olarak KARA LİSTEDİR (beyaz liste DEĞİL): "sunucu yanıt
 * verdi" durumları çeşitlidir (429/401/402/404/4xx/5xx/parse) ve beyaz liste
 * her yeni sınıfta sessizce eksik kalır. SAHA 2026-07-24: ilk denemede beyaz
 * liste kullanılmıştı ve `invalid_request` (OpenRouter 404 · Gemini 400)
 * listede olmadığı için sahte offline CİHAZDA DEVAM ETTİ. Bunun dışındaki her
 * sınıf sunucuyla temas kurulduğu = ağın canlı olduğu anlamına gelir.
 */
const NO_NET_EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  'no_provider', 'no_api_key', 'offline', 'circuit_open', 'network', 'timeout', 'aborted',
]);

/**
 * CEVAP TOKEN BÜTÇELERİ — "uzun anlatım yarıda kesiliyor" KÖKÜ (SAHA 2026-07-24).
 *
 * Cihazda kullanıcının anahtarıyla ÖLÇÜLDÜ (`gemini-3.1-flash-lite`, "Türkiye'nin
 * coğrafi bölgelerini detaylıca anlat"):
 *   maxOutputTokens=220  → `finishReason=MAX_TOKENS`, metin "…5. İç Anadolu Bölgesi:"
 *                          diye CÜMLE ORTASINDA bitiyor (bir ölçümde metin BOŞ bile geldi)
 *   maxOutputTokens=1200 → `finishReason=STOP`, 970-1058 karakter TAM cevap
 *
 * Yani kesilme TTS'te DEĞİL, cevabın KENDİSİNDEYDİ: model bütçeyi doldurup
 * susuyor, TTS o yarım metni sonuna kadar okuyup bitiriyordu. Kullanıcı bunu
 * "Mavi cümlenin ortasında kesiliyor" olarak yaşıyordu.
 *
 * SÜRÜŞ değerleri bilinçli olarak DÜŞÜK ama "yarım cümle" üretmeyecek kadar
 * geniş: sürüşte kısalık bir güvenlik tercihidir (ISO 15008 dikkat bütçesi),
 * ancak yarıda kesilen cümle hem güvensiz hem de tekrar sordurur.
 */
/* ── Cevap şekillendirme ──────────────────────────────────────
 * MAVI-F13/3: token bütçesi, karakter tavanı ve cümle-sınırında kırpma
 * `companionAnswerShaping`e TAŞINDI (SAF — durum·I/O·sağlayıcı bilgisi YOK).
 * Bütçeler ve kırpma kuralı DEĞİŞMEDİ; yalnız sahibi netleşti: bu bir
 * sağlayıcı işi değil, dikkat bütçesi politikasıdır. */
import { geminiChatEndpoint, GEMINI_MODEL_CHAIN } from '../ai/gateway/models';
import { tavilySearch } from '../webSearchService';
import { getWeatherNarrative, refreshWeather, onWeatherState, weatherQueryNamesCity, type WeatherState } from '../weatherService';
// MAVI-F5: beyin intent listesinin TEK KAYNAĞI (elle liste YASAK).
import { brainIntentAllowlist } from '../capability/fabric/carosCapabilityCatalog';
/* MAVI-F13/4: filler kapısı (`isGenericFiller`) ARTIK `companionBrainParser`
 * içindedir — kapı PARSE SINIRINDA olmalıydı ve oraya taşındı. */
import { isAiGatewayEnabled } from '../ai/gateway/aiGatewayFlag';
import {
  buildSafetyContext, evaluatePreGate, verifyResponse, type SafetyContext,
} from '../assistant/assistantSafetyKernel';
/* MAVI-F13/3 · cevap şekillendirme (SAF): token bütçesi + karakter tavanı +
   cümle-sınırında kırpma. Sağlayıcı işi değil, dikkat bütçesi politikası. */
import {
  answerTokens, trimForSpeech,
  brainPersonaRole, reaskReply, netDownReply,
} from './companionAnswerShaping';
/* MAVI-F13/4 · beyin çıktısı ayrıştırma (SAF · sağlayıcıdan bağımsız). */
import {
  parseBrainJson, MAX_PLAN_ITEMS,
  type BrainRaw, type CompanionBrainResult,
} from './companionBrainParser';
/* MAVI-F13/3 · proaktif alt sistemin test-sıfırlama kapısı (tek kapı). */
import { _resetProactiveAlertForTest } from './companionProactiveAlert';
/* MAVI-F13/3 · sağlayıcı sağlık/kota defteri (yaprak: ağ·rota·konuşma YOK). */
import {
  monotonicNow as _now,
  isProviderCoolingDown, noteProviderRateLimited,
  isGroundingCoolingDown, noteGroundingRateLimited, cooldownFromGemini429,
  noteProviderAuthFailure, noteGatewayFailureKind, noteGeminiAuthFailure,
  clearAuthFailure, resolveProviderFailureAnswer, RATE_LIMIT_REPLY,
  _resetProviderHealthForTest,
} from './companionProviderHealth';
/* MAVI-F13/3 · deterministik offline sınıflama + hazır cevap (yaprak · SAF). */
import {
  classifySmalltalk, offlineCategoryReply, _resetOfflineRepliesForTest,
  normalizeKeywordText as norm,
} from './companionOfflineReplies';
// Bağımlılıksız YAZMA çekirdeği (ağır obd/store zinciri modül grafiğine GİRMEZ —
// diagnosticTrailCore bilinçli olarak import'suzdur).
import { pushTrail } from '../diagnosticTrailCore';
// #699: Anthropic CORS duvarını aşan taşıma (native varsa native, yoksa fetch).
import { aiPostJson } from '../ai/nativeHttp';

/* ── Tipler ─────────────────────────────────────────────────── */

export type CompanionChatRoute = 'companion_gemini' | 'companion_groq' | 'companion_haiku' | 'companion_gateway' | 'companion_offline' | 'companion_rate_limited' | 'companion_key_invalid' | 'companion_net_down' | 'companion_safety' | 'companion_reask' | 'companion_no_credit';

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
   * MAVI-F4 · TOKEN AKIŞI TÜKETİCİSİ (opsiyonel).
   *
   * Verilirse ve seçilen yol GERÇEKTEN akış destekliyorsa (yalnız gateway →
   * OpenRouter/Gemini SSE) her token bu kancaya iletilir. **Bu sağlayıcı katmanı
   * KONUŞMAZ:** token'ı ne seslendirir ne yorumlar — yalnız yukarı taşır.
   * Seslendirme kararı ve yapısal/konuşulabilir ayrımı `voice/maviResponseStream`
   * sorumluluğundadır (LLM akışı OTORİTE DEĞİLDİR).
   *
   * Akış desteklemeyen yollarda (doğrudan Gemini `generateContent` · Groq ·
   * Haiku · offline) kanca HİÇ çağrılmaz — sahte streaming üretilmez.
   */
  onToken?: (token: string) => void;
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

/* ── Offline kategori ipuçları (ANA YOL DEĞİL — yalnız fallback) ──────────
 * MAVI-F13/3: anahtar kelime sınıflaması ve hazır cevap tablosu
 * `companionOfflineReplies`e TAŞINDI (yaprak · import·I/O·zaman YOK). Bir
 * sağlayıcı işi değil, ağ yokken konuşulacak deterministik yedektir.
 * Genel API buradan yeniden dışa verilir → mevcut tüketiciler değişmedi. */
export { classifySmalltalk } from './companionOfflineReplies';

/* ── RAM sohbet geçmişi (persist YOK — gizlilik §2.5) ───────── */

interface ChatTurn { role: 'user' | 'model'; text: string }

const MAX_HISTORY_TURNS = 8; // 4 kullanıcı + 4 model
let _history: ChatTurn[] = [];

function pushHistory(role: ChatTurn['role'], text: string): void {
  _history.push({ role, text });
  if (_history.length > MAX_HISTORY_TURNS) _history = _history.slice(-MAX_HISTORY_TURNS);
}

/**
 * MAVI-F10 · TURN kapsamının temizleme yolu. **Bu modül `_history`nin TEK
 * sahibidir** — kanonik hafıza cephesi burada bir KOPYA tutmaz, yalnız bu portu
 * çağırır. Kullanıcı "bunu unut" dediğinde ilgili turlar geçmişten de düşer;
 * aksi hâlde unutulan bilgi 8 tur daha prompt'a gitmeye devam ederdi (F10
 * öncesi ölçülen kusur).
 *
 * `needle` BOŞ ise "hepsini unut" demektir → geçmiş tamamen temizlenir.
 * Düşürülen tur adedini döner (sahte başarı yok).
 */
function _purgeHistoryMatching(needle: string): number {
  try {
    const before = _history.length;
    if (!needle) { _history = []; return before; }
    const words = needle.split(' ').filter((w) => w.length > 3);
    _history = _history.filter((t) => {
      const low = t.text.toLocaleLowerCase('tr');
      if (low.includes(needle)) return false;
      return !words.some((w) => low.includes(w));
    });
    return before - _history.length;
  } catch { return 0; }
}

/* Portu MODÜL YÜKLENİRKEN kaydeder: `_history` yalnız bu modül yüklendiğinde
   VARDIR, dolayısıyla port da tam o anda anlamlı olur. Yan etki bir timer,
   abonelik veya I/O DEĞİLDİR — tek bir referans ataması. */
setConversationPurgePort(_purgeHistoryMatching);

/* ── Sağlayıcı sağlık/kota defteri ────────────────────────────────────────
 * MAVI-F13/3: 429 soğuma pencereleri (sağlayıcı-bazlı), grounding penceresi,
 * kimlik reddi (401/403) ve kredi bitişi (402) işaretleri ile bunların dürüst
 * cevap metinleri `companionProviderHealth`e TAŞINDI. Bu bir sağlayıcı ÇAĞRISI
 * değil, çağrının SONUCUNU sınıflayan bir sağlık defteridir: ağa çıkmaz, rota
 * seçmez, konuşmaz, telemetri yazmaz.
 * `RATE_LIMIT_COOLDOWN_MS` ve `getProviderQuotaSnapshot` buradan yeniden dışa
 * verilir → LAB/tanı tüketicileri (maviConsoleSources · diagnosticSections)
 * değişmedi. */
export { RATE_LIMIT_COOLDOWN_MS, getProviderQuotaSnapshot } from './companionProviderHealth';

/** @internal — testler arası izolasyon. */
export function _resetCompanionChatForTest(): void {
  _history = [];
  /* MAVI-F13/3: offline yedek ve sağlayıcı sağlık defteri ARTIK kendi
     sahiplerinde — kökten tek tek sıfırlamak yerine tek kapı çağrılır. */
  _resetOfflineRepliesForTest();
  _resetProviderHealthForTest();
  _geminiModelIdx = 0;   // model zinciri testler arası SIZMASIN
  /* MAVI-F13/3: proaktif alt sistemin durumu ARTIK onun sahipliğinde —
     kökten tek tek sıfırlamak yerine tek kapı çağrılır. */
  _resetProactiveAlertForTest();
  _topicTurn = 0;              // kısa süreli bağlam testler arası SIZMASIN
  _activeTopic = null;
  _activeTopicTurn = 0;
  _hintTopic = null;
  _hintFreshness = 'expired';
}

/* ══════════════════════════════════════════════════════════════════════════
 * KISA SÜRELİ KONUŞMA BAĞLAMI — durum sahibi (YALNIZ RAM)
 *
 * Bu modül sohbet durumunun (`_history`) zaten sahibi; aktif konu da buraya
 * konur → İKİNCİ bir konuşma-durumu deposu KURULMAZ.
 *
 * SINIRLAR (görev sözleşmesi):
 *  · YALNIZ RAM — `safeStorage`/localStorage'a YAZILMAZ, tek oturumluk.
 *  · Timer/poll/abonelik YOK — bitiş PASİF (okuma anında tur farkı bakılır).
 *  · Konu kimliği ALLOWLIST birliğinden; serbest metin/ham veri TAŞIMAZ.
 *  · Sayaç TUR tabanlıdır (repo'da zaman-tabanlı konuşma TTL'i YOK; ölçü
 *    MAX_HISTORY_TURNS'ten türetildi — bkz. companionContext.TOPIC_MAX_TURN_AGE).
 * ════════════════════════════════════════════════════════════════════════ */

/** Kaçıncı bağlam turundayız (her giden istekte 1 artar). Yalnız RAM. */
let _topicTurn = 0;
/** Aktif konu ve hangi turda yazıldığı. */
let _activeTopic: CompanionTopicId | null = null;
let _activeTopicTurn = 0;
/**
 * Bu turun prompt'una girecek ÖNCEKİ konu — tur başında (yeni yorumlar
 * yazılmadan ÖNCE) fotoğraflanır. Böylece "takip sorusu" semantiği doğru olur:
 * prompt, bu turda üretilen konuyu değil BİR ÖNCEKİNİ ipucu olarak görür.
 */
let _hintTopic: CompanionTopicId | null = null;
let _hintFreshness: TopicFreshness = 'expired';

/**
 * Yeni bir bağlam turu açar: önceki konuyu (varsa ve TAZE ise) bu turun ipucu
 * olarak fotoğraflar. PASİF bitiş: süresi geçmiş konu burada bırakılır.
 */
function _beginTopicTurn(): void {
  _topicTurn++;
  const turnsAgo = _activeTopic !== null ? _topicTurn - _activeTopicTurn : Infinity;
  const fresh = topicFreshness(turnsAgo);
  if (_activeTopic === null || fresh === 'expired') {
    _hintTopic = null;
    _hintFreshness = 'expired';
    if (fresh === 'expired') _activeTopic = null;   // bayat konu RAM'den de düşer
    return;
  }
  _hintTopic = _activeTopic;
  _hintFreshness = fresh;
}

/** Bu turda üretilen yorumlardan aktif konuyu yazar (konu yoksa eskisi KORUNUR). */
function _writeActiveTopic(flags: TopicSignalFlags): void {
  const next = selectActiveTopic(flags);
  if (next === null) return;                        // yorum yok → uydurma konu YOK
  _activeTopic = next;
  _activeTopicTurn = _topicTurn;
  /* MAVI-F10: konu YOLCULUK hafızasına da düşer — "bu yolculukta neyi
     konuştuk" sorusunun tek bounded kanıtı. Taşınan ALLOWLIST KİMLİĞİDİR
     (serbest metin/transkript DEĞİL). Yolculuk yoksa sessizce düşer. */
  try { rememberTrip(next, 'topic', Date.now()); } catch { /* fail-soft */ }
}

/**
 * Aktif konu anlık görüntüsü — CAROS LAB / test gözlemi. PII YOK: yalnız
 * allowlist kimliği, tazelik sınıfı ve tur farkı.
 */
/**
 * @internal — testler için GERÇEK prompt funnel'ı. Kopya/paralel bir prompt
 * kurucusu DEĞİLDİR: üretimdeki sıranın (önce `buildInterpretedVehicleContext`,
 * sonra `buildCompanionSystemPrompt`) birebir aynısını çalıştırır. Bu sayede
 * "yazan → okuyan" dikey akışı gerçek zincir üzerinde doğrulanır.
 */
export function _buildPromptForTest(isDriving = false): string {
  const settings = useStore.getState().settings;
  const ctx = buildInterpretedVehicleContext();       // ← yazan (tur açar + konu yazar)
  return buildCompanionSystemPrompt(                  // ← okuyan (ipucu satırı)
    resolveIdentityWithDriverStyle(settings), isDriving, ctx,
  );
}

export function getActiveTopicSnapshot(): {
  topic: CompanionTopicId | null; freshness: TopicFreshness; turnsAgo: number | null;
} {
  const turnsAgo = _activeTopic !== null ? _topicTurn - _activeTopicTurn : null;
  return {
    topic: _activeTopic,
    freshness: turnsAgo === null ? 'expired' : topicFreshness(turnsAgo),
    turnsAgo,
  };
}

/**
 * Belirsiz zamirli eylem isteğini değerlendirir — çağıran bu sonuç
 * `needsClarification` ise HİÇBİR eylem yürütmemelidir (fail-closed).
 * Aktif konu yalnız SORUYU zenginleştirir; otomatik çözüm ÜRETMEZ.
 */
export function evaluateDemonstrativeRequest(text: string): DemonstrativeResolution {
  return resolveDemonstrativeReference(text, _activeTopic);
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
  // TUR BAŞI: önceki konuyu bu turun ipucu olarak fotoğrafla (yeni yorumlar
  // yazılmadan ÖNCE) → prompt "takip sorusu" bağlamını doğru görür.
  _beginTopicTurn();
  const topicFlags: {
    engineTemperature: boolean; diagnosticTrend: boolean;
    fuelLevel: boolean; batteryCharge: boolean;
  } = { engineTemperature: false, diagnosticTrend: false, fuelLevel: false, batteryCharge: false };
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
      if (fuel) { parts.push(fuel); topicFlags.fuelLevel = true; }
      if (battery) { parts.push(battery); topicFlags.batteryCharge = true; }
      if (temp) { parts.push(temp); topicFlags.engineTemperature = true; }
    });
    unsub();
  } catch { /* OBD bağlı değil — bağlamsız sohbet */ }
  /* (1b) KONUM — "neredeyiz?" sorusunun cevabı bağlamda OLMALI.
   *
   * Bu satır olmadan model nerede olduğunu BİLMİYORDU ve "haritayı açıyorum"
   * diye savuşturuyordu (halüsinasyon değil, bağlam açlığı). Kanıt yetersizse
   * satır HİÇ eklenmez → Mavi konum uydurmak yerine bilmediğini söyler.
   *
   * ⚠️ HAM KOORDİNAT BURAYA GİRMEZ: `formatLocationContextLine` yalnız
   * şehir/ilçe/yol taşır; `LocationContext` tipinde lat/lon alanı YOKTUR. */
  try {
    const locLine = formatLocationContextLine(readLocationContextOrNull());
    if (locLine) parts.push(locLine);
  } catch { /* konum katmanı yok — konumsuz bağlam (uydurma YOK) */ }

  // (2) Yolculuk süresi (World View): aktif trip varsa "ne zamandır yoldayız".
  //     getTripSnapshot CANLI current verir (onTripState immediate-emit null'dur).
  /*     OTURUM ÖNCELİKLİ: `tripLogService` tek yolculuğu anlatır ve mola onu
   *     kapattığı için mola sonrası SIFIRDAN sayardı ("40 dakikadır yoldayız"
   *     yerine "yeni çıktık"). `tripSessionService` molaları birleştirir ve
   *     hareket/mola ayrımını taşır. Oturum okunamazsa ESKİ satır aynen
   *     kullanılır (fail-soft — bağlam sessizce kaybolmaz). */
  try {
    let line: string | null = null;
    const ses = readTripSessionOrNull();
    if (ses) {
      line = interpretTripSession({
        elapsedMin: ses.elapsedMs / 60_000,
        movingMin:  ses.movingMs / 60_000,
        stoppedMin: ses.stoppedMs / 60_000,
        distanceKm: ses.distanceMeters / 1000,
      });
    }

    if (line === null) {
      const trip = getTripSnapshot().current;
      if (trip) line = interpretTripDuration(trip.liveDurationMin, trip.liveDistanceKm);
    }
    if (line) parts.push(line);
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
  // (5) DTC (arıza kodu) durumu — onDTCState senkron son-değer yakalama
  //     (onOBDData ile AYNI desen). Ham kod listesi DEĞİL, yalnız SAYI
  //     yorumlanır (interpretDtcStatus). 0 arıza → satır üretilmez (token
  //     tasarrufu, plan V2 "boşta sıfır maliyet" ilkesi).
  try {
    let dtcCount: number | undefined;
    const unsubDtc = onDTCState((s) => { dtcCount = s.codes.length; });
    unsubDtc();
    if (dtcCount !== undefined) {
      const dtc = interpretDtcStatus(dtcCount);
      if (dtc) parts.push(dtc);
    }
  } catch { /* DTC servisi yok — arıza bağlamı atlanır */ }
  // (5b) ARAÇ HAFIZASI — geçmişte tekrarlayan arıza EĞİLİMİ. Kaynak: aiCore'un
  //      ZATEN yayınladığı `ai.mechanic.report` olay halkası (yeni depo/abonelik/
  //      timer YOK, senkron okuma). Ham kod prompt'a GİRMEZ: interpretDiagnosticTrend
  //      yalnız kodun AİLESİNİ (P/B/C/U) Türkçe sistem adına çevirir. Geçmiş yoksa
  //      satır üretilmez (boşta sıfır token maliyeti).
  try {
    const trendInput = readDiagnosticTrendInput();
    const trend = interpretDiagnosticTrend(trendInput.historyCount, trendInput.lastDtcCode);
    if (trend) { parts.push(trend); topicFlags.diagnosticTrend = true; }
  } catch { /* olay halkası okunamadı — araç hafızası atlanır */ }
  // (6) Bakım uyarısı: BİLİNÇLİ OLARAK EKLENMEDİ (plan V2 kapsam kararı).
  //     vehicleMaintenanceService.getMaintenanceAssessment() zincirinin ucu
  //     sensitiveKeyStore (async şifreli depolama) — senkron anlık-değer yolu
  //     YOK. Bu fonksiyon HER beyin çağrısında SENKRON çalışır (await'siz);
  //     bakımı buraya bağlamak bağlam üretimini async'e çevirip beyin isteğini
  //     geciktirir ("boşta sıfır maliyet" + "beyin çağrısını asla geciktirme"
  //     ilkeleriyle çelişir). interpretMaintenanceDue yorumlayıcısı yine de
  //     yazıldı + unit-testli (companionContext.ts) — gelecekte zaten async
  //     çalışan bir katman (ör. companionEngine/proaktif motor) besleyebilir.
  // (3) Araç-tipi yetenek notu — olmayan özellik (EV'de RPM/yakıt) için Gemini'yi
  //     yapısal olarak susturur. EV'de canlı yorum boş olsa bile not eklenir.
  // TUR SONU: bu turda üretilen yorumlardan aktif konuyu yaz (yorum yoksa
  // eski konu KORUNUR — sahte konu üretilmez).
  _writeActiveTopic(topicFlags);
  const note = vehicleCapabilityNote(vehicleType);
  return note ? [note, ...parts].join(' ') : parts.join(' ');
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROAKTİF KRİTİK ARIZA UYARISI — MAVI-F13/3'te AYRI ALT SİSTEME TAŞINDI
 *
 * `companion/companionProactiveAlert.ts`. Buraya ait değildi: AĞA ÇIKMAZ, model
 * çağırmaz, sağlayıcı bilmez — kendi durumu, kapıları ve gözlem yüzeyi olan
 * bağımsız bir alt sistemdir. Sözleşme (debounce · karakter tavanı · fail-closed
 * güvenlik kapısı · susturma kaydı) BİREBİR korundu.
 *
 * Genel API buradan yeniden dışa verilir → mevcut tüketiciler değişmedi.
 * ════════════════════════════════════════════════════════════════════════ */
export {
  PROACTIVE_ALERT_DEBOUNCE_MS, PROACTIVE_ALERT_MAX_CHARS, PROACTIVE_MIN_CONFIDENCE,
  triggerProactiveDiagnosticAlert, getProactiveAlertDiagnostics,
  _testShouldEmitProactiveTrail, _testEmitProactiveTrail,
  _resetProactiveTrailAggregation, _resetProactiveAlertForTest,
  type ProactiveVerdictLike, type ProactiveAlertResult, type ProactiveAlertOpts,
} from './companionProactiveAlert';

/**
 * Aktif yolculuğun sert-manevra sayaçlarından sürüş stilini SENKRON okur.
 * Kaynak: `tripLogService` `harshBrakeEvents` / `harshAccelEvents` (canlı, RAM).
 * Aktif yolculuk yoksa / servis okunamazsa → `undefined` (stil BİLİNMİYOR;
 * "sakin" VARSAYILMAZ — kanıtsız olumlu hüküm de uydurmadır).
 */
function readDriverStyle(): DriverStyle | undefined {
  try {
    const trip = getTripSnapshot().current;
    if (!trip) return undefined;
    return classifyDriverStyle(trip.harshBrakeEvents, trip.harshAccelEvents) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Kimlik çözümü + Driver DNA enjeksiyonu — sohbet/beyin yollarının TEK kapısı.
 * Düz `resolveCompanionIdentity(settings)` yerine bu kullanılır ki üslup talimatı
 * her prompt'ta tutarlı olsun (dağınık kimlik kurulumu YOK).
 */
function resolveIdentityWithDriverStyle(settings: CompanionSettingsInput): CompanionIdentity {
  return resolveCompanionIdentity(settings, undefined, readDriverStyle());
}

/* ── Gemini sohbet çağrısı ──────────────────────────────────── */

// Model adı TEK KAYNAKTAN (models.ts GEMINI_MODEL_CHAIN). SAHA 2026-07-24: eski
// gömülü `gemini-flash-latest` kullanıcının anahtarında 429 (kota dolu) veriyor,
// aynı anahtarla `gemini-2.5-flash` 200 dönüyor → model adı URL'e gömülü kaldığı
// için asistan sebepsiz susuyordu. Kota MODEL-BAZLI olduğundan zincir şart.
/**
 * Zincirdeki AKTİF Gemini modeli (oturum-içi). Kota MODEL-BAZLI olduğu için bir
 * model 429/404/503 verdiğinde sağlayıcıyı tamamen susturmak yerine SIRADAKİ
 * modele geçilir — asistan kesintisiz kalır.
 */
let _geminiModelIdx = 0;

function _geminiEndpoint(): string {
  return geminiChatEndpoint(GEMINI_MODEL_CHAIN[_geminiModelIdx]);
}

/** Aktif Gemini modelinin adı (tanı/log için — anahtar içermez). */
export function getActiveGeminiModel(): string {
  return String(GEMINI_MODEL_CHAIN[_geminiModelIdx]);
}

/**
 * Model-bazlı arıza (429 kota · 404 emekli · 503 yoğunluk) → sıradaki modele geç.
 * @returns true = model değişti (istek YENİDEN denenebilir); false = zincir bitti.
 */
function _advanceGeminiModel(status: number): boolean {
  if (status !== 429 && status !== 404 && status !== 503) return false;
  if (_geminiModelIdx >= GEMINI_MODEL_CHAIN.length - 1) return false;
  _geminiModelIdx++;
  // Sessiz model değişimi YASAK: sahada "neden başka model?" kanıtla yanıtlanır.
  console.warn(
    `GEMINI_MODEL_SWITCH: status=${status} → ${getActiveGeminiModel()}` +
    ` (zincir ${_geminiModelIdx + 1}/${GEMINI_MODEL_CHAIN.length})`,
  );
  return true;
}

/** @internal — testler arası izolasyon. */
export function _resetGeminiModelForTest(): void { _geminiModelIdx = 0; }
// SAHA 2026-07-04: gemini-flash-latest artık gemini-3.5-flash'a çözülüyor; SICAK
// çağrı ~1-1.8sn ama DERİN SOĞUK BAŞLANGIÇ ~7sn (kullanıcı anahtarıyla ölçüldü).
// 6sn tavan soğuk başlangıcı kesip null→REASK ("of orayı kaçırdım") üretiyordu.
// 9sn'ye çıkarıldı; asıl çözüm warmupGemini (aşağıda) — mikrofon açılınca modeli
// ısıtır, gerçek komut sıcak gelir. MAVI-F2: bekleme artık ara sözle ÖRTÜLMEZ
// (I11) — ısıtma, gecikmeyi gizlemenin değil GERÇEKTEN AZALTMANIN yoludur.
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
  if (isProviderCoolingDown('gemini')) return;
  try {
    await fetch(_geminiEndpoint(), {
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
/**
 * MAVI-F1 · Mavi'nin PRESENCE (varlık) kipi — bir yetenek sınıfı DEĞİLDİR.
 *
 *  · `companion` → Yol Arkadaşı açık: sıcak, sohbeti sürdüren, yolculuğa eşlik eden ton.
 *  · `assistant` → Yol Arkadaşı kapalı: aynı Mavi, aynı yetenekler; sakin ve
 *    işlevsel ton, kendiliğinden sohbet uzatmaz.
 */
export type MaviPresenceMode = 'companion' | 'assistant';

/**
 * Şu anki presence kipi. Ayar okunamazsa NÖTR (`assistant`) kabul edilir —
 * bu fail-soft yön DOĞRUDUR: bilinmeyen durumda Mavi daha az konuşur, daha az
 * değil daha çok susar. YETENEK kararı DEĞİLDİR (yetenekler her iki kipte aynı).
 */
export function currentPresenceMode(): MaviPresenceMode {
  try {
    return useStore.getState().settings.companionEnabled === true ? 'companion' : 'assistant';
  } catch {
    return 'assistant';
  }
}

/**
 * @param userText MAVI-F10 · hafıza izdüşümünü daraltmak için KULLANICININ bu
 *   turdaki metni. Prompt'a GİRMEZ; yalnız hangi hafıza ALANININ taşınacağını
 *   belirler (navigasyon sorusu → rota tercihleri, müzik sorusu → müzik…).
 *   Verilmezse alan `general` olur ve süzgeç uygulanmaz (bilgi kaybı YOK).
 */
function buildCompanionSystemPrompt(
  id: CompanionIdentity, isDriving: boolean, vehicleContext: string, userText = '',
): string {
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
    // PARK: sabit cümle tavanı KALDIRILDI (SAHA 2026-07-24 — kullanıcı "uzun
    // anlatımlar yarıda kesiliyor"). Uzunluk artık SORUYA uyar: sohbet kısa,
    // "anlat/açıkla/detaylıca" gibi istekler kapsamlı. Sürüş kısıtı DEĞİŞMEDİ.
    : 'Araç PARK HALİNDE — acele yok: sohbet odaklı, derinlemesine ve içten konuş. Uzunluğu SORUYA göre ayarla: sıradan sohbette 2-4 cümle yeter, ama kullanıcı açıkça anlatım/açıklama/detay isterse (ör. "anlat", "açıkla", "detaylıca") konuyu BÖLMEDEN, baştan sona kapsamlı anlat — yarıda bırakma.';
  /* MAVI-F1 · PRESENCE: `id.enabled` (= companionEnabled) YALNIZ açılış kimliğini
   * ve sohbet sürdürme isteğini değiştirir. YETENEK, güvenlik, onay ve araç
   * bağlamı satırları HER İKİ KİPTE de AYNIDIR (aşağıda ortak). */
  const opening = id.enabled
    ? `Sen "${id.assistantName}" adında, araçta sürücüye eşlik eden Türkçe konuşan bir yol arkadaşısın — bu arabanın ruhusun, bir çağrı merkezi robotu değilsin.`
    : `Sen "${id.assistantName}" adında, araçtaki Türkçe konuşan asistansın — bu arabanın ruhusun, bir çağrı merkezi robotu değilsin. Sürücü şu an sohbet arkadaşlığı değil, işini gören bir asistan istiyor.`;
  const lines = [
    opening,
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
  /* MAVI-F1 · PRESENCE KAPALI: sohbet YETENEĞİ değil, sohbeti UZATMA İSTEĞİ kısılır.
   * Sorulan her şey (sohbet dahil) yine cevaplanır; Mavi yalnız kendiliğinden konu
   * açmaz ve karşılık soru sorarak muhabbeti sürdürmez. Güvenlik/araç uyarıları bu
   * satırdan ETKİLENMEZ — onlar aşağıdaki araç bağlamı bloğunda ve ayrı kanaldadır. */
  if (!id.enabled) {
    lines.push(
      'Sohbet edebilirsin ve sorulan her şeye doğal biçimde cevap verirsin, ama sohbeti KENDİN UZATMA: ' +
      'kendiliğinden yeni konu açma, gereksiz karşılık sorusu sorma, yolculuk muhabbeti başlatma. ' +
      'Cevabını ver ve dur. Bu bir yetenek kısıtı değildir — kullanıcı sessiz bir asistan tercih etmiştir.',
    );
  }
  // Driver DNA — sürüş stiline göre ÜSLUP talimatı. Stil bilinmiyorsa ya da
  // sakin sürüşteyse satır EKLENMEZ (varsayılan kişilik geçerli, sıfır token).
  const driverTone = driverToneInstruction(id.driverStyle);
  if (driverTone) lines.push(driverTone);
  // KISA SÜRELİ BAĞLAM — bu turun BAŞINDA fotoğraflanan ÖNCEKİ konu (bkz.
  // _beginTopicTurn). Konu yoksa/bayatsa satır EKLENMEZ. İpucu ZORLAYICI DEĞİL:
  // modele "kesin bunu varsay" demez, belirsizlikte soru sormasını söyler.
  const topicHint = buildTopicHintLine(_hintTopic, _hintFreshness);
  if (topicHint) lines.push(topicHint);
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
  /* MAVI-F10 · BAĞLAMA GÖRE DARALTILMIŞ HAFIZA İZDÜŞÜMÜ.
   * Her turda TÜM hafıza dökülmez: alan süzgeci (navigasyon / medya / araç /
   * kişisel) + kayıt tavanı + karakter tavanı uygulanır → prompt token şişmesi
   * yapısal olarak frenlenir. Blok "VERİdir, TALİMAT DEĞİLDİR" etiketiyle ve her
   * satırın KÖKENİ (beyan mı çıkarım mı) + güveni + çelişki işaretiyle girer.
   * Kayıt yoksa blok HİÇ EKLENMEZ. */
  const projection = projectMaviMemory(inferPromptDomain(userText), Date.now());
  if (projection.text) lines.push(projection.text);
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
      parts: [{ text: buildCompanionSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), text) }],
    },
    contents,
    generationConfig: {
      temperature:     0.7,
      // Bütçe tek kapıdan (ANSWER_TOKENS) — eski 100/160 uzun anlatımı cümle
      // ortasında kesiyordu (SAHA 2026-07-24, finishReason=MAX_TOKENS).
      maxOutputTokens: answerTokens('chat', isDriving),
      // flash-latest düşünen model: düşünme kapalı — küçük bütçeyi yemesin,
      // araç içi gecikme kısa kalsın (SAHA 2026-07-03).
      thinkingConfig:  { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(_geminiEndpoint(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body:    JSON.stringify(body),
    signal:  signalWithTimeout(GEMINI_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
  });
  if (resp.status === 429) {
    // Rate limit: soğuma penceresi boyunca Gemini denenmez (kullanıcı faturası
    // + art arda başarısız istek gecikmesi). Süre Google'ın söylediği kadar.
    noteProviderRateLimited('gemini', await cooldownFromGemini429(resp));
    return null;
  }
  if (!resp.ok) { await noteGeminiAuthFailure(resp); return null; }
  clearAuthFailure(); // Gemini 200 döndü — anahtar geçerli, işaret temizlenir

  const data = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  };
  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!raw) return null;
  // TTS güvenliği: tek satıra indir, tavanı aşarsa CÜMLE SINIRINDA kırp.
  // Tavan bağlama duyarlı (sürüş 300 / park 2400) — bkz. ANSWER_CHAR_LIMIT.
  return trimForSpeech(raw, isDriving);
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
      { role: 'system' as const, content: buildCompanionSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), text) },
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
    noteProviderRateLimited('groq');
    return null;
  }
  if (!resp.ok) return null;

  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!raw) return null;
  // TTS güvenliği: tek satıra indir, tavanı aşarsa cümle sınırında kırp (bağlama duyarlı).
  return trimForSpeech(raw, isDriving);
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
      { role: 'system' as const, content: buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), canGround, text) },
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
  if (resp.status === 429) { noteProviderRateLimited('groq'); return null; }
  // #698: kimlik reddi/bakiye SESSİZCE yutulmaz — dürüst cevabı besler.
  if (!resp.ok) { noteProviderAuthFailure('groq', resp.status); return null; }

  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const raw  = (data.choices?.[0]?.message?.content ?? '').trim();
  // Groq'tan gelen type:"web" kararı: canlı internet erişimi yok.
  // Kişiliğe uygun doğal bir sohbet yanıtına dönüştür (No Dead-Ends koruması).
  const parsed = parseBrainJson(raw, isDriving);
  if (parsed && parsed.kind === 'web') {
    // Hava sorgusu mu? → arama harcamadan ÖNCE yerel hava servisi denenir
    // (Groq'un "canlı bilgilere bakamıyorum" demesi böyle önlenir — hava zaten
    // cihazda gerçek veri olarak var).
    const localWeather = await tryLocalWeatherAnswer(parsed.query, text);
    if (localWeather) return { kind: 'chat', response: localWeather, route: 'companion_groq' };
    // İNTERNET kararı → ÖNCE Gemini google_search, GROUNDING soğumasındaysa Tavily.
    // Grounding kendi penceresindeyse (429 verdi) tekrar çağırıp boş yere 429 yemeyiz —
    // doğrudan Tavily'ye düşeriz (grounding cooldown BEYİN cooldown'ından ayrı).
    if (hasGeminiSearch && !isGroundingCoolingDown()) {
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

/* ── AI Gateway beyin çağrısı (sağlayıcı-BAĞIMSIZ) ────────────── *
 * Zincirdeki diğer adaylardan tek farkı: HANGİ MODELE gittiğini BİLMEZ.
 * Gateway hangi sağlayıcıyı (bugün OpenRouter, yarın Gemini Direct/Ollama)
 * kullanacağına kendi karar verir; burada sağlayıcı adı, endpoint, anahtar ya
 * da HTTP DETAYI GEÇMEZ. Prompt/geçmiş/parse AYNEN diğer adaylarla aynıdır —
 * yalnız TAŞIMA değişir.
 *
 * Grounding: gateway'in google_search muadili YOKTUR → system prompt Groq'un
 * anahtarsız hâliyle aynı biçimde (supportsGrounding=false) kurulur; beyin
 * yine de "web" derse yerel hava servisi denenir, o da yoksa DÜRÜST cevap
 * verilir (uydurma yok). Kota penceresi YOK: gateway kendi devre kesicisini
 * ve tekrar politikasını içeride yönetir.
 *
 * Modüller DİNAMİK import edilir → bayrak KAPALIYKEN gateway kodu hiç
 * yüklenmez (sıfır import-time maliyet, eski yolda performans etkisi yok). */

const GATEWAY_BRAIN_TIMEOUT_MS = 6000;

/** Dürüst "canlı bilgi yok" cevabı — Groq'un anahtarsız hâliyle aynı metin. */
const GATEWAY_NO_LIVE_INFO_REPLY =
  'Şu an canlı bilgilere bakamıyorum ama bildiğimce yardımcı olmaya çalışırım.';

async function askCompanionBrainGateway(
  text: string,
  id: CompanionIdentity,
  isDriving: boolean,
  timeoutMs?: number,
  onToken?: (token: string) => void,
): Promise<{ result: BrainRaw | null; netFailure: boolean; errorKind: string }> {
  const [{ getDefaultAiGateway }, { askGatewayChat }, { isMaviOrchestratorEnabled }] = await Promise.all([
    import('../ai/gateway/concrete/defaultAiGateway'),
    import('../ai/gateway/gatewayChatBridge'),
    import('../ai/gateway/aiGatewayFlag'),
  ]);

  const decisionMs = Math.min(timeoutMs ?? GATEWAY_BRAIN_TIMEOUT_MS, GATEWAY_BRAIN_TIMEOUT_MS);
  const chatParams = {
    gateway:     getDefaultAiGateway(),
    system:      buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), false, text),
    history:     historyToOpenAI(),
    user:        text,
    timeoutMs:   decisionMs,
    maxTokens:   answerTokens('brain', isDriving),
    temperature: 0.4,
    /* MAVI-F4: TEK gerçek akış yolu. `onToken` verilmezse istek akış kipine bile
     * geçmez (`aiGateway` `stream: onToken !== undefined` kurar) → davranış
     * bugünküyle BİREBİR aynı kalır. */
    ...(onToken ? { onToken } : {}),
  };

  /* ALT TERCİH: orchestrator açıkken aynı prompt/geçmiş orkestre edilmiş
     yürütücüden geçer (sağlayıcı/model zinciri). Kapalıyken davranış BİREBİR
     mevcut tek-sağlayıcı gateway yolu. Her iki yol da AYNI sonucu döndürür. */
  const outcome = isMaviOrchestratorEnabled()
    ? (await (await import('../ai/orchestrator/concrete/maviOrchestratedChat'))
        .askOrchestratedChat({
          ...chatParams,
          classifyText: text,
          /* MAVI-F13 · TEK İZDÜŞÜM. `buildBrainSystemPrompt` KANONİK araç
           * bağlamını ve KANONİK F10 hafıza izdüşümünü ZATEN içeriyor →
           * orkestratör İKİNCİ bir bağlam/hafıza bloğu EKLEMEZ. */
          systemCarriesCanonicalProjection: true,
        })).outcome
    : await askGatewayChat(chatParams);

  // errorKind yukarı taşınır: kesici bütçe timeout'unu gerçek ulaşılamazlıktan
  // ayrı ve yüksek eşikte sayar (aiHealth) — gateway yolu da bu ayrımdan yararlanır.
  if (!outcome.ok) return { result: null, netFailure: outcome.netFailure, errorKind: outcome.errorKind };
  return { result: parseBrainJson(outcome.text, isDriving), netFailure: false, errorKind: 'none' };
}

/**
 * Gateway beyin çağrısını yapıp başarılıysa geçmişe/devre-kesiciye işler.
 * `tryGroqBrainAndRecord` ile aynı desen; ek olarak `netFailure` bilgisini
 * yukarı taşır (gateway throw etmediği için kesici semantiği bayrakla korunur).
 */
async function tryGatewayBrainAndRecord(
  brainInput: string,
  cleanText:  string,
  id:         CompanionIdentity,
  isDriving:  boolean,
  timeoutMs?: number,
  onToken?:   (token: string) => void,
): Promise<{ result: CompanionBrainResult | null; netFailure: boolean; errorKind: string }> {
  const { result, netFailure, errorKind } =
    await askCompanionBrainGateway(brainInput, id, isDriving, timeoutMs, onToken);
  if (!result) return { result: null, netFailure, errorKind };

  recordAiNetSuccess(); // beyin cevap verdi → ağ sağlıklı, kesici sayacı sıfır

  if (result.kind === 'web') {
    // Canlı bilgi kararı: önce yerel hava servisi (gerçek veri), yoksa dürüst cevap.
    const localWeather = await tryLocalWeatherAnswer(result.query, cleanText);
    const response = localWeather ?? GATEWAY_NO_LIVE_INFO_REPLY;
    pushHistory('user', cleanText);
    pushHistory('model', response);
    return { result: { kind: 'chat', response, route: 'companion_gateway' }, netFailure: false, errorKind: 'none' };
  }

  // parseBrainJson CHAT'e her zaman 'companion_gemini' yazar (paylaşılan parser) —
  // gateway'den geldiğinde düzeltilir, aksi halde tanı/log'da yanlış görünür.
  const fixed: CompanionBrainResult =
    result.kind === 'chat' ? { ...result, route: 'companion_gateway' } : result;

  pushHistory('user', cleanText);
  pushHistory('model', fixed.kind === 'chat' ? fixed.response : fixed.semantic.feedback);
  return { result: fixed, netFailure: false, errorKind: 'none' };
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
    `${isDriving ? 'Sürüş halinde: 1-2 cümle, çok kısa.' : 'Sıradan sohbette 2-4 cümle; detay/anlatım istenirse konuyu yarıda bırakmadan kapsamlı anlat.'} ` +
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
    system:     buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), canGround, text),
    messages: [
      ...historyToOpenAI(),
      { role: 'user' as const, content: text },
    ],
  };

  /* #699: `fetch` DEĞİL native taşıma. `api.anthropic.com` WebView'dan CORS
     başlığı döndürmediği için `fetch` bu çağrıyı HTTP durumu bile oluşmadan
     öldürüyordu → geçerli anahtarla Haiku halkası HİÇ çalışmıyordu (cihazda
     kanıtlandı). Native yoksa (tarayıcı/dev) aynı istek `fetch`e düşer. */
  const resp = await aiPostJson(
    HAIKU_COMPANION_ENDPOINT,
    {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      /* #699 İKİNCİ KAPI: native taşıma yoksa (tarayıcı / `npm run dev`) istek
         `fetch`e düşer ve CORS duvarına ÇARPARDI. Bu header Anthropic'in
         tarayıcıdan doğrudan erişim izni; cihazda ölçüldü — headersiz `fetch`
         THROW ederken bu header'la GERÇEK 401 döndü. `credentialVerifiers`
         bunu ZATEN biliyordu, beyin çağrısı bilmiyordu (bilgi var, besleyen
         yok). Native yolda zararsızdır: sunucu fazladan header'ı yok sayar. */
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
    decisionMs,
    signalWithTimeout(decisionMs), // Chrome <103 WebView güvenli (abortCompat)
  );

  // 429: KENDİ penceresi — Gemini'yi kilitlemez (çapraz kirlenme yasak).
  if (resp.status === 429) { noteProviderRateLimited('haiku'); return null; }
  // #698: kimlik reddi/bakiye SESSİZCE yutulmaz — dürüst cevabı besler.
  if (!resp.ok) { noteProviderAuthFailure('haiku', resp.status); return null; }

  const data = await resp.json() as { content?: { type?: string; text?: string }[] };
  const raw  = (data.content?.find((c) => c.type === 'text')?.text ?? '').trim();
  const parsed = parseBrainJson(raw, isDriving);
  if (parsed && parsed.kind === 'web') {
    // Hava sorgusu mu? → yerel hava servisi aramadan ÖNCE denenir (bkz. Groq).
    const localWeather = await tryLocalWeatherAnswer(parsed.query, text);
    if (localWeather) return { kind: 'chat', response: localWeather, route: 'companion_haiku' };
    // İNTERNET → ÖNCE Gemini google_search, GROUNDING soğumasındaysa Tavily (bkz. Groq).
    if (hasGeminiSearch && !isGroundingCoolingDown()) {
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
    `${isDriving ? 'Sürüş halinde: 1-2 cümle, çok kısa.' : 'Sıradan sohbette 2-4 cümle; detay/anlatım istenirse konuyu yarıda bırakmadan kapsamlı anlat.'} ` +
    `Kaynak numarası/URL okuma.`;

  const body = {
    model:      HAIKU_COMPANION_MODEL,
    max_tokens: isDriving ? 120 : 240,
    system:     sysPrompt,
    messages: [{ role: 'user' as const, content: `Soru: ${userText}\n\n${ctxBlock}` }],
  };

  try {
    const resp = await aiPostJson(
      HAIKU_COMPANION_ENDPOINT,
      {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // #699 ikinci kapı (bkz. yukarısı)
      },
      body,
      HAIKU_COMPANION_TIMEOUT_MS,
      signalWithTimeout(HAIKU_COMPANION_TIMEOUT_MS),
    );
    if (!resp.ok) return search.answer || null;
    const data = await resp.json() as { content?: { type?: string; text?: string }[] };
    const out = (data.content?.find((c) => c.type === 'text')?.text ?? '').replace(/\s+/g, ' ').trim();
    return out || search.answer || null;
  } catch {
    return search.answer || null; // ağ hatası → Tavily özetine düş
  }
}

/* ── Offline fallback yanıtları ──────────────────────────────────────────
 * MAVI-F13/3: cevap tablosu ve deterministik rotasyon `companionOfflineReplies`
 * modülünde (yaprak · SAF). Burada yalnız ZİNCİR KOMPOZİSYONU kalır: hangi
 * yedeğin hangi sırayla denendiği bir sağlayıcı kararıdır. */
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

/**
 * MAVI-F5: Beynin üretebileceği intent kümesi. **ARTIK ELLE YAZILMAZ** —
 * capability kataloğundan TÜRETİLİR.
 *
 * ── NEDEN (ölçülen kusur, 2026-08-29) ───────────────────────────────────────
 * Aynı bilgi ÜÇ ayrı sabit listede tutuluyordu ve üçü de FARKLIYDI:
 *   · `BRAIN_INTENTS` (burası, canlı yol)      → 29
 *   · `ai/semanticAiService.VALID_INTENTS`     → 29 (5'i burada var, orada YOK)
 *   · `aiVoiceService.VALID_INTENTS`           → 26 (8'i burada var, orada YOK)
 * Bir intent eklendiğinde üçünün de güncellenmesi gerekiyordu; olmayınca beyin
 * geçerli bir komut üretiyor, doğrulayıcı onu sessizce DÜŞÜRÜYORDU.
 *
 * Artık katalog TEK KAYNAKTIR. Katalogda henüz karşılığı OLMAYAN intentler
 * aşağıda AÇIKÇA listelenir — böylece "kapsam dışı" ile "unutulmuş" ayrımı
 * görünür kalır (F5 kapsam ölçümü bu ayrımı sayar).
 */
/* Katalogda HENÜZ karşılığı olmayan intentler `carosCapabilityCatalog`ta
 * AÇIKÇA listelenir (`LEGACY_ONLY_BRAIN_INTENTS`) — böylece bu dosyada ikinci
 * bir kopya oluşmaz. Kilit testleri de kaynak metnini kazımak yerine
 * `brainIntentAllowlist()`ü çağırır. */
const BRAIN_INTENTS = new Set<string>(brainIntentAllowlist());

/* ── Beyin sonuç tipleri ve persona metinleri ─────────────────────────────
 * MAVI-F13/4: sonuç tipleri `companionBrainParser`e, persona'ya bağlı
 * deterministik metinler (`BRAIN_PERSONA_ROLE` · REASK · NET_DOWN)
 * `companionAnswerShaping`e TAŞINDI. İkisi de SAF: sağlayıcı bilmez, ağa
 * çıkmaz, durum tutmaz. */
/**
 * Beyin system prompt'u.
 * @param supportsGrounding true → Gemini (google_search grounding mevcut);
 *                          false → Groq gibi modeller (canlı internet YOK).
 */
function buildBrainSystemPrompt(
  id: CompanionIdentity, isDriving: boolean, vehicleContext: string,
  supportsGrounding = true,
  /** MAVI-F10 · hafıza izdüşümünü daraltan bağlam metni (prompt'a GİRMEZ). */
  userText = '',
): string {
  const chatPersona = buildCompanionSystemPrompt(id, isDriving, vehicleContext, userText);
  const personaRole = brainPersonaRole(id.personality);
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
    /* MAVI-F6: BİLEŞİK KOMUT. Tek cümlede birden fazla BAĞIMSIZ iş varsa model
     * tek intent seçip diğerlerini DÜŞÜRMEK yerine `actions` dizisi döner.
     * Kör bölme YASAK: bağlaç görmek tek başına yeterli değildir — her eleman
     * KENDİ BAŞINA yürütülebilir bir iş olmalıdır. */
    'BİRDEN FAZLA İŞ varsa: {"type":"action","actions":[{"intent":"...",...},{"intent":"...",...}]} — her eleman KENDİ alanlarını taşır, en fazla 5 adım.',
    'Dizi SADECE gerçekten AYRI işler için kullanılır. Tek iş varsa dizi KULLANMA. Aynı işi iki kez YAZMA. Kendini düzeltme ("yok, şuraya") TEK adım üretir — son hâli yaz.',
    '"Eve rota aç, müziği kıs ve annemi ara" → {"type":"action","actions":[{"intent":"OPEN_NAVIGATION","destination":"home"},{"intent":"VOLUME_DOWN"},{"intent":"OPEN_PHONE","contactName":"annem"}],"feedback":"Üç işi yapıyorum","confidence":0.9}',
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
    'Uygulama ÖZELLİĞİ aç/kapat → SET_SETTING settingKind="bool" settingAction ("on"|"off"|"toggle") + settingKey şunlardan biri: performanceMode (performans/güç modu), offlineMap (çevrimdışı harita), autoThemeEnabled (otomatik gece-gündüz teması), autoBrightnessEnabled (otomatik parlaklık), breakReminderEnabled (mola hatırlatma), dockAutoHide (dock otomatik gizle), smartContextEnabled (akıllı bağlam), obdAutoSleep (obd uyku), autoNavOnStart (açılışta navigasyon), companionEnabled (YOL ARKADAŞI SOHBET KİPİ — yalnız sohbet sıcaklığını ve kendiliğinden konuşmayı yönetir; seni KAPATMAZ, kapalıyken de her komutu anlar ve cevap verirsin), companionWakeWordEnabled (uyanma kelimesi/"beni dinle"), use24Hour (24 saat), showSeconds (saniye göster).',
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
    // ── MAVI-F4 · İLK CÜMLE ANLAM TAŞIR ──
    'İLK CÜMLE DOLU OLSUN: cevabına "Tabii", "Elbette", "Hemen söyleyeyim", "Şunu belirteyim ki" gibi içi boş girişlerle BAŞLAMA. İlk cümlen doğrudan istenen bilgiyi/cevabı versin ("Yaklaşık 83 kilometre kaldı." gibi), nezaket varsa SONRA gelsin. Sesli okunduğunda kullanıcı ilk saniyede işe yarar bir şey duymalı.',
    // ── MAVI-F2 · GECİKME ÖRTME YASAĞI (I11) ──
    'GECİKME ÖRTME YASAK: "bakıyorum", "düşünüyorum", "kontrol ediyorum", "bir saniye" gibi hiçbir bilgi taşımayan bekletme cümlesi ASLA kurma — ne "say" içinde ne "feedback" içinde. Sohbette doğrudan cevabı ver. Gerçek bir işlem başlıyorsa "feedback" NE YAPILDIĞINI söyler ("Kadıköy rotası açılıyor", "Yağ sıcaklığı okunuyor") ama BİTTİĞİNİ İDDİA ETMEZ ("rotayı açtım" DEME).',
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
    '"yağ sıcaklığı kaç" → {"type":"action","intent":"QUERY_SENSOR","sensorQuery":"yağ sıcaklığı","feedback":"Yağ sıcaklığı okunuyor","confidence":0.9}',
    '"şasi numarası nedir" → {"type":"action","intent":"QUERY_SENSOR","sensorQuery":"şasi numarası","feedback":"Şasi numarası okunuyor","confidence":0.85}',
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

/* ── Beyin çıktısı ayrıştırma ─────────────────────────────────────────────
 * MAVI-F13/4: `BrainJson` şeması, `parseBrainJson` ve `semanticFromBrainAction`
 * `companionBrainParser`e TAŞINDI (SAF: durum·I/O·ağ·sağlayıcı bilgisi YOK).
 * Ayrıştırma sağlayıcıya özgü DEĞİLDİR — dört çağrı yeri de (Gemini · Groq ·
 * Haiku · gateway) aynı fonksiyonu paylaşıyordu. Genel API buradan yeniden
 * dışa verilir → mevcut tüketiciler değişmedi. */
export { MAX_PLAN_ITEMS };
export type {
  CompanionBrainAction, CompanionBrainChat, CompanionBrainResult,
} from './companionBrainParser';

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
  /* `withThinking=false` → `thinkingConfig` alanı HİÇ gönderilmez. Bazı "lite"
     modeller bu alanı reddedip `400 Request contains an invalid argument` döner
     (SAHA 2026-07-24: `gemini-flash-lite-latest` · `gemini-3.5-flash-lite`),
     AYNI model alansız 200 verir. Model adından çıkarım yapılamadığı için
     (`gemini-3.1-flash-lite` alanı KABUL eder) 400'de alan düşürülüp bir kez
     yeniden denenir — sabit uyumluluk listesi tutmaya gerek kalmaz. */
  const mkBody = (withThinking: boolean): string => JSON.stringify({
    system_instruction: {
      // Gemini grounding'i destekler → supportsGrounding: true (varsayılan)
      parts: [{ text: buildBrainSystemPrompt(id, isDriving, buildInterpretedVehicleContext(), true, text) }],
    },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature:      0.4,
      maxOutputTokens:  answerTokens('brain', isDriving),
      // düşünen model bütçe koruması (SAHA 2026-07-03)
      ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });

  // Single Brain karar bütçesi: voiceService 2.5sn iletir. GEMINI_TIMEOUT_MS
  // tavanına clamp'lenir → beyin ASLA 6sn'den uzun bloklamaz; süre dolunca fetch
  // abort olur, çağıran (tryCompanionBrain) recordAiNetFailure + fallback'e düşer.
  const decisionMs = Math.min(timeoutMs ?? GEMINI_TIMEOUT_MS, GEMINI_TIMEOUT_MS);
  let _thinkingSupported = true;
  const send = (): Promise<Response> => fetch(_geminiEndpoint(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body:    mkBody(_thinkingSupported),
    signal:  signalWithTimeout(decisionMs), // Chrome <103 WebView güvenli (abortCompat)
  });

  let resp = await send();
  // PARAMETRE UYUMSUZLUĞU → alanı düşürüp BİR KEZ yeniden dene (model başına).
  // ⚠️ 400 İKİ AYRI ŞEY olabilir: (a) `API_KEY_INVALID` — anahtar gerçekten
  // geçersiz, KULLANICIYA DÜRÜSTÇE söylenmeli, yeniden denemek o mesajı yutar;
  // (b) `INVALID_ARGUMENT` — bizim gönderdiğimiz alan modelce desteklenmiyor.
  // Yalnız (b) yeniden denenir; gövde okunamıyorsa muhafazakâr davranıp DENEME.
  if (resp.status === 400 && _thinkingSupported) {
    let body = '';
    try { body = await resp.clone().text(); } catch { body = ''; }
    if (body && !/API_KEY_INVALID/i.test(body)) {
      _thinkingSupported = false;
      console.warn(`GEMINI_THINKING_UNSUPPORTED: ${getActiveGeminiModel()} → thinkingConfig düşürüldü`);
      resp = await send();
    }
  }
  // MODEL-BAZLI ARIZA → SIRADAKİ MODEL (SAHA 2026-07-24): kota model bazlıdır;
  // `gemini-flash-latest` 429 verirken AYNI anahtarla `gemini-2.5-flash` 200
  // dönüyordu. Sağlayıcıyı komple susturmak yerine önce zincirdeki sonraki
  // modeli dene — sağlayıcı cooldown'ı YALNIZ zincir tükendiğinde uygulanır.
  // Bütçe zaten `decisionMs` ile sınırlı; en fazla zincir uzunluğu kadar deneme.
  while (!resp.ok && _advanceGeminiModel(resp.status)) {
    resp = await send();
  }

  // 429: Google'ın söylediği kadar bekle (retryDelay) — sabit 60sn asistanı
  // gereksiz uzun "offline" bırakıyordu (SAHA 2026-07-04).
  if (resp.status === 429) { noteProviderRateLimited('gemini', await cooldownFromGemini429(resp)); return null; }
  if (!resp.ok) { await noteGeminiAuthFailure(resp); return null; }
  clearAuthFailure(); // Gemini 200 döndü — anahtar geçerli, işaret temizlenir
  const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return parseBrainJson((data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim(), isDriving);
}

/* ── GROUNDED yanıt (Google Search) — güncel/internet bilgisi ──
 * Beyin type:"web" dediğinde çağrılır. google_search aracı GERÇEK ZAMANLI web
 * sonucuna dayandırır (haber/döviz/hava/spor…). responseMimeType JSON ile
 * BİRLEŞMEZ → serbest metin döner; çok parçalı olabilir, hepsi birleştirilir.
 * Grounding çağrısı normal sohbetten yavaştır → ayrı (daha uzun) timeout. */
const GROUNDED_TIMEOUT_MS = 8000;

function buildGroundedSystemPrompt(id: CompanionIdentity, isDriving: boolean): string {
  const personaRole = brainPersonaRole(id.personality);
  const brevity = isDriving
    ? 'Sürücü ŞU AN ARAÇ KULLANIYOR: en fazla 2 kısa cümle, en kritik bilgiyi ver.'
    : 'Sıradan soruda 3-5 akıcı cümle; detaylı anlatım istenirse yarıda bırakmadan kapsamlı anlat. Haber/özet istenirse en önemli gelişmeleri tek paragrafta topla.';
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
    generationConfig: { temperature: 0.3, maxOutputTokens: answerTokens('grounded', isDriving), thinkingConfig: { thinkingBudget: 0 } },
  };
  try {
    const resp = await fetch(_geminiEndpoint(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify(body),
      signal:  signalWithTimeout(GROUNDED_TIMEOUT_MS), // Chrome <103 WebView güvenli (abortCompat)
    });
    // GROUNDING 429 → yalnız GROUNDING soğuması (beyin cooldown'ını KİRLETME).
    // Beyin karar/sentez çağrıları çalışmaya devam eder; grounding atlanır → Tavily.
    if (resp.status === 429) { noteGroundingRateLimited(await cooldownFromGemini429(resp)); return null; }
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
    noteGroundingRateLimited();
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
    `kullan, uydurma. ${isDriving ? 'Sürüş halinde: 1-2 cümle.' : 'Sıradan sohbette 2-4 cümle; detay/anlatım istenirse yarıda bırakmadan kapsamlı anlat.'} Kaynak numarası/URL okuma.`;
  try {
    const resp = await fetch(_geminiEndpoint(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body:    JSON.stringify({
        system_instruction: { parts: [{ text: sysPrompt }] },
        contents: [{ role: 'user', parts: [{ text: `Soru: ${userText}\n\n${ctxBlock}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: answerTokens('synth', isDriving), thinkingConfig: { thinkingBudget: 0 } },
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
/**
 * Beyin zinciri adayı. `gateway` SAĞLAYICI-BAĞIMSIZ hattır (hangi modele
 * gittiğini bilmez, anahtarını kendi çözer); diğerleri doğrudan sağlayıcı
 * çağrılarıdır ve kendi kota pencerelerini kullanır.
 */
type BrainCandidate = { provider: 'gemini' | 'groq' | 'haiku' | 'gateway'; apiKey: string };

async function runCompanionBrain(
  raw: string,
  opts: CompanionChatOpts,
  allowOnline: boolean,
): Promise<CompanionBrainResult | null> {
  /* MAVI-F1: `companionEnabled` KAPISI KALDIRILDI (bkz. modül başlığı §PRESENCE).
   * Beyin, Mavi'nin doğal dil anlama ve karar üretme çekirdeğidir; bir kişilik
   * ayarı onu kapatamaz. Presence yalnız TONU etkiler (buildCompanionSystemPrompt). */
  const settings = useStore.getState().settings;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isDriving = opts.isDriving === true;

  // Geriye uyum: chain verilmezse opts.provider/apiKey ile eski tek-sağlayıcı
  // davranışı üretilir (testler ve tryCompanionChat gibi diğer çağıranlar için).
  const baseChain: ReadonlyArray<{ provider: 'gemini' | 'groq' | 'haiku'; apiKey: string }> =
    opts.chain && opts.chain.length > 0
      ? opts.chain
      : (opts.provider === 'gemini' || opts.provider === 'groq' || opts.provider === 'haiku') && opts.apiKey
        ? [{ provider: opts.provider, apiKey: opts.apiKey }]
        : [];

  // AI GATEWAY (bayrak — VARSAYILAN KAPALI): açıkken zincirin BAŞINA sağlayıcı-
  // bağımsız gateway adayı eklenir; mevcut adaylar KALDIRILMAZ, arkada yedek
  // olarak durur (rollback tek şalter). Kapalıyken `chain` birebir eski dizidir
  // → tek satır davranış değişmez. Gateway anahtarını kendi çözer (BYOK), bu
  // yüzden apiKey alanı boştur ve anahtarsız kullanıcıda da zincire girebilir.
  const chain: ReadonlyArray<BrainCandidate> =
    isAiGatewayEnabled() ? [{ provider: 'gateway', apiKey: '' }, ...baseChain] : baseChain;

  // Safety Kernel PRE-GATE: allowOnline=false ise online zincir HİÇ denenmez;
  // offline fallback doğal olarak devreye girer (provider sırası korunur).
  const netUsable = allowOnline && opts.hasNet === true && chain.length > 0;
  let aiAttempted = false;
  // TÜM adaylar kota soğumasından atlandı (hiçbiri denenmedi) → aşağıda dürüst
  // kota cevabı (offline motorun söyleyecek sözü yoksa).
  let rateLimitedOnly = false;
  /* Bu turda ağ GERÇEKTEN ölü müydü? (throw/timeout var VE hiçbir sağlayıcıdan
     HTTP yanıtı gelmedi). Blok içindeki ölçüm dışarı TAŞINIR — #669. */
  let netDeathOnly = false;

  if (netUsable) {
    const id = resolveIdentityWithDriverStyle(settings);
    // ⚠️ AĞ hatası ≠ SAĞLAYICI hatası (SAHA 2026-07-04, "internetim var ama offline
    // sanıyor"): sunucudan HTTP yanıtı gelen HER durum (429 kota, 400/401, bozuk
    // JSON parse) ağın CANLI olduğunun kanıtıdır — devre kesiciye YAZILMAZ. Kesici
    // yalnız fetch'in THROW ettiği gerçek ağ ölümünde (timeout/DNS/kopma) sayar.
    // Eski davranış: sağlayıcı null'ları da sayılıyordu → 2 cümlede breaker açılıp
    // 90sn TÜM asistanı (STT dahil) offline'a kilitliyordu.
    let sawNetFailure = false;
    // ⚠️ TIMEOUT ≠ ULAŞILAMAZLIK (SAHA 2026-07-24, "sohbet ederken bir süre sonra
    // offline'a düşüyor"): buradaki throw'ların çoğu bizim KENDİ süre bütçemizin
    // (opts.timeoutMs — sürüşte 4.5sn) doldurduğu AbortError'dır. Gemini soğuk
    // başlangıçta ~7sn döndüğü için bu neredeyse HER komutta oluyor, 2 komutta
    // devre açılıp asistanı 90sn kapatıyordu. Hata TÜRÜ kesiciye taşınır; kesici
    // bütçe timeout'unu ayrı ve yüksek eşikte sayar (aiHealth).
    let netFailureKind: string | null = null;
    /* ⚠️ CORS/opaque HATA ≠ AĞ ÖLÜMÜ (SAHA 2026-07-24, canlı cihazda CDP ile
     * YAKALANDI): `api.anthropic.com` tarayıcıdan çağrıldığında (429 veya
     * tarayıcı-erişim kısıtı) yanıtta CORS başlığı gelmediği için fetch
     * **TypeError: Failed to fetch** atar. `errorKindFromException` bunu
     * kaçınılmaz olarak 'network' sayar → SERT kova → 2 turda 90sn offline.
     * Sahadan alınan iz: aynı turda openrouter 404 · gemini 400 · gemini 429 ·
     * groq 429 HTTP yanıtları geldi (ağ APAÇIK CANLI), ardından tek bir
     * anthropic TypeError'ı `OFFLINE_REASON: NETWORK_UNREACHABLE` tetikledi;
     * 10 sn sonra groq 200 döndü — yani asistan CANLI ağda 90sn kilitlendi.
     *
     * KURAL: bu turda HERHANGİ bir sağlayıcıdan HTTP yanıtı alındıysa ağın
     * canlı olduğu KANITLANMIŞTIR — o turda hiçbir hata "ağ öldü" sayılamaz.
     * (Kod bu ilkeyi zaten biliyordu ama yalnız sağlayıcı bazında uyguluyordu.) */
    let sawHttpResponse = false;
    // SERT sınıf (network/unknown) bir kez görüldüyse 'timeout' onu EZEMEZ:
    // zincirde biri gerçekten koptuysa tüm tur sert kovada sayılır.
    const noteNetFailureKind = (kind: string): void => {
      if (netFailureKind === null || netFailureKind === 'timeout') netFailureKind = kind;
    };
    // Künyede hangi sağlayıcının düştüğü görünsün (sahada "provider=?" teşhisi
    // imkânsız kılıyordu — sessiz offline yasağının ruhu künyenin DOLU olmasıdır).
    let netFailureProvider: string | undefined;
    const noteNetFailure = (e: unknown, provider?: string): void => {
      sawNetFailure = true;
      const kind = errorKindFromException(e);
      // Künye, kovayı belirleyen (sert) hatayla aynı sağlayıcıyı göstermeli.
      if (netFailureKind === null || netFailureKind === 'timeout') netFailureProvider = provider;
      noteNetFailureKind(kind);
    };
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
      if (cand.provider !== 'gateway' && isProviderCoolingDown(cand.provider)) {
        skippedByCooldown = true; continue;
      }
      aiAttempted = true;

      try {
        if (cand.provider === 'gateway') {
          // Sağlayıcı-bağımsız hat: gateway kendi tekrar/timeout/devre-kesici
          // politikasını içeride uygular. Başarısızsa zincirdeki eski adaylar
          // (Gemini/Groq/Haiku) aynen denenmeye devam eder.
          const gw = await tryGatewayBrainAndRecord(
            brainInput, trimmed, id, isDriving, opts.timeoutMs, opts.onToken);
          if (gw.result) return gw.result;
          // GERÇEK ağ ölümü → kesiciye say. Gateway throw ETMEZ; hata türü tipli
          // bayrakla taşınır, tür de kesiciye iletilir (timeout ayrı eşikte sayılır).
          /* #698: gateway'in ZATEN ürettiği ayrım (auth ↔ insufficient_credit —
             kütük #421'de sahada ölçülmüştü) dürüst cevap dalına TAŞINIR.
             Eskiden bu sınıflandırma burada okunmuyordu: kredisi bitmiş bir
             hesapta kullanıcı "kredi yükle" yerine "tekrar söyle" duyuyordu. */
          noteGatewayFailureKind(gw.errorKind ?? '');
          if (gw.netFailure) { sawNetFailure = true; noteNetFailureKind(gw.errorKind); }
          // Sunucudan yanıt gelmiş her hata sınıfı = ağ CANLI kanıtı (yerel kapı
          // ve sonucu-bilinmeyen sınıflar kanıt SAYILMAZ — bkz. NO_NET_EVIDENCE_KINDS).
          else if (!NO_NET_EVIDENCE_KINDS.has(gw.errorKind)) sawHttpResponse = true;
          continue;
        }

        if (cand.provider === 'gemini') {
          // Gemini attarsa (timeout/ağ hatası) zincirdeki sıradakini de
          // deneyebilmek için yalnız Gemini çağrısı kendi try/catch'inde izole
          // edilir — dıştaki catch yalnız TÜM zincir tükendiğinde bir kez sayar.
          let result: BrainRaw | null = null;
          let threw = false;
          try {
            result = await askCompanionBrain(brainInput, cand.apiKey, id, isDriving, opts.timeoutMs);
          } catch (e) { result = null; threw = true; noteNetFailure(e, 'gemini'); /* GERÇEK ağ hatası (throw) — sıradaki aday denenecek */ }
          // THROW YOKSA sunucudan yanıt alındı (200/429/4xx/parse) → ağ CANLI.
          if (!threw) sawHttpResponse = true;

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
              if (!isGroundingCoolingDown()) {
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
          sawHttpResponse = true; // throw etmedi → sunucudan yanıt geldi (ağ canlı)
          if (result) return result;
          continue; // null = HTTP-yanıtlı sağlayıcı hatası → ağ canlı, sayma
        }

        // cand.provider === 'haiku' — zincirin son halkası
        const result = await tryHaikuBrainAndRecord(brainInput, cand.apiKey, id, isDriving, opts.timeoutMs, opts.tavilyKey, opts.searchKey);
        sawHttpResponse = true; // throw etmedi → sunucudan yanıt geldi (ağ canlı)
        if (result) return result;
        // null → HTTP-yanıtlı sağlayıcı hatası; ağ canlı, sayma
      } catch (e) { noteNetFailure(e, cand.provider); /* bu adayda GERÇEK ağ hatası (throw) — sıradakine geç */ }
    }

    // Yalnız GERÇEK ağ hatası (throw/timeout) görüldüyse bir KEZ say — kesici
    // her adayda ayrı ayrı değil, tüm zincir tükendiğinde bir kez tetiklenir.
    // Sağlayıcı-null'ları (429/4xx/parse) buraya HİÇ girmez: internet varken
    // kesici açılmaz, asistan "internet yok" moduna düşmez.
    // AĞ CANLI KANITI KAZANIR: bu turda bir sağlayıcı HTTP yanıtı verdiyse (429/4xx/
    // 5xx/parse), başka bir sağlayıcının CORS/opaque TypeError'ı ağ ölümü SAYILMAZ.
    if (sawNetFailure && !sawHttpResponse) {
      recordAiNetFailure({ provider: netFailureProvider, exceptionType: netFailureKind ?? 'unknown' });
    }

    rateLimitedOnly = !aiAttempted && skippedByCooldown;
    /* AĞ CANLI KANITI KAZANIR: bir sağlayıcı HTTP yanıtı verdiyse ağ ölü DEĞİLDİR
       (429/4xx/5xx/parse hataları buraya girmez) — o durumda REASK doğrudur. */
    netDeathOnly = aiAttempted && sawNetFailure && !sawHttpResponse;
  }

  // Offline fallback: yalnız sohbet (komut kararı offline'da yerel parser'ındır)
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { kind: 'chat', response: offline, route: 'companion_offline' };

  // Geçersiz anahtar dürüstlüğü (SAHA 2026-07-05): bu turda Gemini denendi ve
  // 400 API_KEY_INVALID yediyse kullanıcı "internet gitti" değil GERÇEK nedeni
  // duyar (kota cevabıyla aynı ilke). İşaret taze olmalı (bu turun hatası) —
  // eski bir turdan kalma bayrak yeni turda konuşturmaz.
  /* #698: KREDİ bitişi anahtar geçersizliğinden ÖNCE sorulur — ikisi AYRI eylem
     gerektirir (bakiye yükle ↔ anahtar yenile) ve kredi bitişi daha spesifiktir. */
  const failure = aiAttempted ? resolveProviderFailureAnswer() : null;
  if (failure !== null) {
    /* Künye DOLU olmalı (sessiz arıza yasağının ruhu): hangi sağlayıcının
       reddettiği tanı izine yazılır. Anahtarın KENDİSİ asla yazılmaz — yalnız
       sağlayıcı ADI (gizlilik kuralı: VAR/YOK ve ADET). Künyeyi KÖK yazar:
       sağlık defteri telemetri kanalına bağlanmaz. */
    if (failure.kind === 'key_invalid') {
      pushTrail('action', 'mavi kimlik reddi', `provider=${failure.provider}`);
    }
    return {
      kind: 'chat', response: failure.response,
      route: failure.kind === 'no_credit' ? 'companion_no_credit' : 'companion_key_invalid',
    };
  }

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
  /* Ağ ölüyse "tekrar söyle" DEME (#669) — tekrar söylemek işe yaramaz ve
     kullanıcıyı döngüye sokar; gerçek nedeni söyle. */
  if (netDeathOnly) {
    /* Ton kişiliğe uyar (persona sözleşmesi korunur), içerik DÜRÜSTTÜR. */
    const personality = resolveIdentityWithDriverStyle(settings).personality;
    const reply = netDownReply(personality);
    return { kind: 'chat', response: reply, route: 'companion_net_down' };
  }

  /* SAHA (#697) — "Mavi HER ŞEYE 'of orayı kaçırdım' diyor": bu dal
     `companion_offline` rotasıyla dönüyordu ve çağıran (voiceService) onu
     GEÇERLİ bir sohbet cevabı sayıp turu KAPATIYORDU. Sonuç: online zincir
     null döndüğü her turda YEREL KOMUT PARSER'I ("müzik aç", "haritayı aç",
     "sesi kıs") HİÇ ÇALIŞMIYOR, kullanıcı çalışabilecek komutlarda bile
     tekrar-rica duyuyordu. Bu bir "no dead-end" değil, ÇIKMAZIN KENDİSİYDİ.

     Metin ve persona sözleşmesi AYNEN korunur; değişen tek şey ROTA: artık
     `companion_reask` — çağıran bunu "beyin karar veremedi, YEREL ZİNCİRİ
     dene; hiçbir şey tutmazsa BUNU söyle" olarak okur (bkz. voiceService
     `_pendingReask`). Böylece tekrar-rica çıkmazın sonunda söylenir, başında
     değil. */
  if (aiAttempted) {
    const reask = reaskReply(resolveIdentityWithDriverStyle(settings).personality);
    return { kind: 'chat', response: reask, route: 'companion_reask' };
  }
  return null;
}

/* ── Safety Kernel entegrasyonu (PR-A) ──────────────────────────
 * PRE-GATE: kritik araç durumunda online zincir hiç denenmez (allowOnline=false)
 * → aktif güvenlik durumunda yerel deterministic şablon; bilişsel/kernel-hata
 *   durumunda offline'a düşülür. POST-GATE: yalnız ONLINE üretilmiş CHAT metni
 *   doğrulanır (offline/rate/key/safety metni zaten yereldir → dokunulmaz). */

const ONLINE_ROUTES: ReadonlySet<CompanionChatRoute> = new Set<CompanionChatRoute>([
  'companion_gemini', 'companion_groq', 'companion_haiku', 'companion_gateway',
]);

/** Online CHAT cevabını POST-GATE'ten geçirir; değişirse yeni sonuç döner. */
function _postGateBrain(
  result: CompanionBrainResult | null,
  ctx: SafetyContext,
  isDriving: boolean,
): CompanionBrainResult | null {
  if (!result || result.kind !== 'chat' || !ONLINE_ROUTES.has(result.route)) return result;
  const pg = verifyResponse(result.response, ctx, { isDriving });
  if (pg.response === result.response) return result;
  return {
    kind: 'chat',
    response: pg.response,
    route: pg.action === 'replaced' ? 'companion_safety' : result.route,
  };
}

/**
 * Companion beyin girişi — Safety Kernel PRE/POST gate'li sarmalayıcı.
 * İç zincir (runCompanionBrain) ve SAĞLAYICI SIRASI DEĞİŞMEZ; kernel yalnız
 * online'ı kapatır (kritik durum) ve online CHAT cevabını doğrular. Fail-closed:
 * kernel throw ederse online AÇILMAZ (offline'a düşülür).
 */
export async function tryCompanionBrain(
  raw: string,
  opts: CompanionChatOpts = {},
): Promise<CompanionBrainResult | null> {
  // MAVI-F1: `companionEnabled` KAPISI KALDIRILDI — bkz. modül başlığı §PRESENCE.
  if (!raw.trim()) return null;
  const isDriving = opts.isDriving === true;

  let ctx: SafetyContext = {};
  let allowOnline = true;
  let safetyReply: string | null = null;
  try {
    ctx = buildSafetyContext();
    const pre = evaluatePreGate(ctx);
    allowOnline = pre.allowOnline;
    // Aktif fiziksel güvenlik durumu → yerel şablonu doğrudan konuş (online YOK).
    if (!pre.allowOnline && pre.deterministicResponse) safetyReply = pre.deterministicResponse;
  } catch {
    allowOnline = false; // fail-closed: kernel hatası online'ı AÇMAZ
  }
  if (safetyReply) return { kind: 'chat', response: safetyReply, route: 'companion_safety' };

  const result = await runCompanionBrain(raw, opts, allowOnline);
  const gated = _postGateBrain(result, ctx, isDriving);
  _noteSessionAction(gated);
  return gated;
}

/**
 * KISA DÖNEM HAFIZA (Faz-2 wiring): bu oturumda Mavi'nin GERÇEKTEN YAPTIĞI
 * işleri kaydeder — konuşma metnini DEĞİL.
 *
 * Neden yalnız aksiyonlar: ham konuşma zaten `_history` ile taşınıyor; onu
 * hafızaya da yazmak veriyi ÇOĞALTIR. "Bu oturumda ne yaptım" ise ayrı ve
 * yararlı bir sinyaldir ("onu tekrar aç" gibi devam cümleleri için).
 *
 * Gizlilik: yalnız hafıza özelliği AÇIK ve İZİN VERİLMİŞKEN yazılır
 * (kullanamayacağımız veriyi toplamayız); depo YALNIZ RAM'dir; her kayıt
 * hassas-veri kapısından geçer. Hata isteği ETKİLEMEZ (fail-soft).
 */
function _noteSessionAction(result: CompanionBrainResult | null): void {
  if (!result || result.kind !== 'action') return;
  const feedback = result.semantic?.feedback;
  if (typeof feedback !== 'string' || !feedback.trim()) return;
  /* MAVI-F10 · YOLCULUK HAFIZASI: bu yolculukta GERÇEKTEN yapılan iş kaydedilir
   * (spec §14.4). Kayıt RAM'dedir, yolculuk anahtarlıdır, hassas-veri kapısından
   * geçer ve `kind: 'action'`tır.
   *
   * ⚠️ **Bir TERCİH DEĞİLDİR (F6/F7 sınırı):** bir eylemin yapılmış/gözlenmiş
   * olması kullanıcının onu TERCİH ETTİĞİ anlamına gelmez. Bu kayıt uzun döneme
   * kendiliğinden TERFİ ETMEZ ve çıkarım üretmez. */
  try { rememberTrip(feedback, 'action', Date.now()); } catch { /* fail-soft */ }
  void (async () => {
    try {
      const [{ isMaviMemoryEnabled, getMaviMemoryConsent }, { rememberShortTerm }] = await Promise.all([
        import('../ai/gateway/aiGatewayFlag'),
        import('../ai/memory/shortTermMemory'),
      ]);
      if (!isMaviMemoryEnabled() || getMaviMemoryConsent() !== 'memory') return;
      rememberShortTerm(feedback, _now());
    } catch { /* hafıza yazımı asistanı ETKİLEMEZ */ }
  })();
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
    const resp = await fetch(_geminiEndpoint(), {
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
async function runCompanionChat(
  raw: string,
  opts: CompanionChatOpts,
  allowOnline: boolean,
): Promise<CompanionChatResult | null> {
  // MAVI-F1: `companionEnabled` KAPISI KALDIRILDI — bkz. modül başlığı §PRESENCE.
  const settings = useStore.getState().settings;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isDriving = opts.isDriving === true;

  // ── Öncelikli yol: GERÇEK AI sohbeti (Gemini veya Groq) — Safety Kernel
  //    PRE-GATE kapattıysa (allowOnline=false) online atlanır, offline'a düşülür.
  const geminiUsable =
    allowOnline &&
    opts.provider === 'gemini' &&
    !!opts.apiKey &&
    opts.hasNet === true &&
    !isProviderCoolingDown('gemini');

  const groqUsable =
    allowOnline &&
    opts.provider === 'groq' &&
    !!opts.apiKey &&
    opts.hasNet === true &&
    !isProviderCoolingDown('groq'); // Groq KENDİ penceresi (Gemini'ninki değil)

  if (geminiUsable) {
    try {
      const reply = await askCompanionGemini(trimmed, opts.apiKey as string, resolveIdentityWithDriverStyle(settings), isDriving);
      if (reply) {
        recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
        pushHistory('user', trimmed);
        pushHistory('model', reply);
        return { response: reply, route: 'companion_gemini' };
      }
    } catch (e) {
      // SESSİZ OFFLINE YASAK (SAHA 2026-07-22): sebep kodu + künye kaydedilir.
      recordAiNetFailure({ provider: 'gemini', exceptionType: errorKindFromException(e) });
    }
  } else if (groqUsable) {
    try {
      const reply = await askCompanionGroq(trimmed, opts.apiKey as string, resolveIdentityWithDriverStyle(settings), isDriving);
      if (reply) {
        recordAiNetSuccess(); // ağ sağlıklı — devre kesici sayacı sıfırla
        pushHistory('user', trimmed);
        pushHistory('model', reply);
        return { response: reply, route: 'companion_groq' };
      }
    } catch (e) {
      recordAiNetFailure({ provider: 'groq', exceptionType: errorKindFromException(e) });
    }
  }

  // ── Offline fallback: internet yok · key yok · hata/timeout · 429 ──
  const offline = offlineCompanionReply(trimmed, opts);
  if (offline !== null) return { response: offline, route: 'companion_offline' };
  return null;
}

/**
 * Companion sohbet girişi — Safety Kernel PRE/POST gate'li sarmalayıcı.
 * İç akış (runCompanionChat) ve sağlayıcı davranışı DEĞİŞMEZ. Fail-closed:
 * kernel throw ederse online AÇILMAZ.
 */
export async function tryCompanionChat(
  raw: string,
  opts: CompanionChatOpts = {},
): Promise<CompanionChatResult | null> {
  // MAVI-F1: `companionEnabled` KAPISI KALDIRILDI — bkz. modül başlığı §PRESENCE.
  if (!raw.trim()) return null;
  const isDriving = opts.isDriving === true;

  let ctx: SafetyContext = {};
  let allowOnline = true;
  let safetyReply: string | null = null;
  try {
    ctx = buildSafetyContext();
    const pre = evaluatePreGate(ctx);
    allowOnline = pre.allowOnline;
    if (!pre.allowOnline && pre.deterministicResponse) safetyReply = pre.deterministicResponse;
  } catch {
    allowOnline = false; // fail-closed
  }
  if (safetyReply) return { response: safetyReply, route: 'companion_safety' };

  const result = await runCompanionChat(raw, opts, allowOnline);
  if (result && ONLINE_ROUTES.has(result.route)) {
    const pg = verifyResponse(result.response, ctx, { isDriving });
    if (pg.response !== result.response) {
      return { response: pg.response, route: pg.action === 'replaced' ? 'companion_safety' : result.route };
    }
  }
  return result;
}
