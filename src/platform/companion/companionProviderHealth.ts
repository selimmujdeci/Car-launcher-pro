/**
 * companionProviderHealth.ts — **MAVI-F13/3 · SAĞLAYICI SAĞLIK/KOTA POLİTİKASI.**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `companionChatProvider` bir DEEP sağlayıcıdır: sağlayıcı seçer, prompt kurar,
 * modeli çağırır, cevabı ayrıştırır. Ama içinde bunlardan HİÇBİRİ olmayan bir
 * alt sistem yaşıyordu: **hangi sağlayıcı ne kadar süreyle susturuldu, kim
 * kimlik reddetti, kimin kredisi bitti** — yani bir *sağlık/kota defteri*.
 *
 * O defterin altı ayrı mutable durumu, üç sahadan gelen dürüst cevap metni ve
 * LAB'ın okuduğu anlık görüntüsü vardı; hepsi 3000 satırlık sağlayıcı dosyasının
 * ortasına serpilmişti. Burada tek sahibe alındı.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) — BU MODÜL OTORİTE DEĞİLDİR ──────────────────────
 *  · **AĞA ÇIKMAZ.** `fetch` yapmaz, sağlayıcı çağırmaz. Yalnız *çağrının
 *    SONUCUNU* (HTTP durumu / 429 gövdesi) sınıflandırır.
 *  · **ROTA SEÇMEZ.** Hangi adayın deneneceğine zincir karar verir; bu modül
 *    yalnız "şu an soğumada mı?" sorusuna cevap verir.
 *  · **KONUŞMAZ.** `maviSpeech` bilmez, TTS çağırmaz. Dürüst arıza METNİNİ
 *    döner; söyleme kararı ve rota eşlemesi çağıranın (kökün) elindedir.
 *  · **TELEMETRİ YAZMAZ.** `pushTrail` · `reportVoiceDiag` çağırmaz — künyeyi
 *    kök yazar; bu modül yalnız **sağlayıcı ADINI** döner (anahtar/PII asla).
 *  · **DAVRANIŞ DEĞİŞMEDİ.** Pencereler, 10 sn tazelik kapısı, kredi-önce-anahtar
 *    sırası ve sahada ölçülmüş metinler `companionChatProvider`dan **birebir**
 *    taşındı.
 *
 * ── IMPORT SINIRI ───────────────────────────────────────────────────────────
 * Hiçbir platform modülü import EDİLMEZ (yaprak modül). Zincire geri bağımlılık
 * kurulursa döngü doğar ve "sağlık defteri" ikinci bir zincir otoritesine döner.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * ZAMAN — MONOTONİK (sistem saati sıçramasına bağışık)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Süre hesapları için monotonik zaman. `Date.now()` KULLANILMAZ: batarya
 * kopması / saat sıfırlaması soğuma pencerelerini geçmişe atardı
 * (CLAUDE.md · Clock Jump Protection).
 */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 429 KOTA SOĞUMA PENCERELERİ — SAĞLAYICI BAZLI
 * ════════════════════════════════════════════════════════════════════════ */

export const RATE_LIMIT_COOLDOWN_MS = 60_000;

/** Kota penceresi tutulan sağlayıcılar (gateway kendi devre kesicisini kullanır). */
export type QuotaProvider = 'gemini' | 'groq' | 'haiku';

/* ⚠️ SAĞLAYICI-BAZLI (SAHA 2026-07-04, "ilk istek online sonrakiler offline"):
 * eskiden TEK paylaşılan pencereydi — Groq/Haiku 429'u da bunu kuruyordu ve
 * GEMINI 60sn kilitleniyordu (çapraz kirlenme). Artık her sağlayıcının kendi
 * penceresi var; birinin kotası diğerini asla susturmaz. */
const _cooldownUntil: Record<QuotaProvider, number> = {
  gemini: 0,   // düzenli generateContent (beyin/sohbet) kotası
  groq:   0,
  haiku:  0,
};

/* google_search GROUNDING kotası soğuması AYRI (SAHA 2026-07-04): grounding
 * ücretsiz katmanda çok küçük kotalı, sık 429 verir. Eskiden bu 429 Gemini'nin
 * beyin penceresini kurup TÜM Gemini'yi 60sn öldürüyordu → "bir kere çalışıp
 * sonra ölüyor". Ayrı pencere: grounding kotası bitince yalnız grounding
 * atlanır (→ Tavily), beyin karar/sentez çağrıları çalışmaya devam eder. */
let _groundingCooldownUntil = 0;

/** Bu sağlayıcı ŞU AN kota soğumasında mı? (zincir adayı atlar) */
export function isProviderCoolingDown(provider: QuotaProvider): boolean {
  return monotonicNow() < _cooldownUntil[provider];
}

/** 429 görüldü → pencereyi kurar. Süre verilmezse varsayılan pencere. */
export function noteProviderRateLimited(
  provider: QuotaProvider, cooldownMs: number = RATE_LIMIT_COOLDOWN_MS,
): void {
  _cooldownUntil[provider] = monotonicNow() + cooldownMs;
}

/** google_search grounding penceresi açık mı? */
export function isGroundingCoolingDown(): boolean {
  return monotonicNow() < _groundingCooldownUntil;
}

/** Grounding 429 → yalnız grounding susar; beyin çağrıları etkilenmez. */
export function noteGroundingRateLimited(
  cooldownMs: number = RATE_LIMIT_COOLDOWN_MS,
): void {
  _groundingCooldownUntil = monotonicNow() + cooldownMs;
}

/**
 * Gemini 429 gövdesinden gerçek bekleme süresini okur (google.rpc.RetryInfo
 * retryDelay: "7s" gibi). RPM-tipi kotalarda Google çoğu zaman 5-30sn söyler —
 * sabit 60sn pencere asistanı gereksiz uzun "offline" bırakıyordu (SAHA
 * 2026-07-04: "ilk istek online, sonrakiler offline"). Okunamazsa/yoksa
 * varsayılan pencere; taban 5sn, tavan RATE_LIMIT_COOLDOWN_MS.
 */
export async function cooldownFromGemini429(resp: Response): Promise<number> {
  try {
    const data = await resp.json() as { error?: { details?: { retryDelay?: string }[] } };
    const d = data.error?.details?.find((x) => typeof x?.retryDelay === 'string');
    const m = d?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) {
      return Math.min(RATE_LIMIT_COOLDOWN_MS, Math.max(5_000, Math.round(parseFloat(m[1]) * 1000)));
    }
  } catch { /* gövde okunamadı → varsayılan pencere */ }
  return RATE_LIMIT_COOLDOWN_MS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DÜRÜST ARIZA METİNLERİ — "sahte aptallaşma" yasağı
 * ════════════════════════════════════════════════════════════════════════ */

/* Kota penceresinde dürüst cevap (SAHA 2026-07-04): zincirdeki TÜM adaylar
 * soğumadayken kullanıcı "offline'a düştü" sanıyordu — asistan sahte aptallaşma
 * yerine gerçek nedeni söyler; pencere kapanınca kendiliğinden normale döner. */
export const RATE_LIMIT_REPLY =
  'Yapay zeka kotam şu an dolu, bir dakikaya kalmaz toparlarım — birazdan tekrar sor.';

/* Geçersiz anahtar dürüstlüğü (SAHA 2026-07-05, "online asistan offline'a
 * düşüyor"): cihazdaki anahtar boş kalınca .env'e gömülü ESKİ anahtar devreye
 * girdi ve Google her isteğe 400 API_KEY_INVALID döndü — asistan bunu sessizce
 * yutup offline'a düşüyordu; kullanıcı "anahtarlar düzgün, internet var" diye
 * saatlerce yanlış yerde arıyordu. Kota cevabıyla AYNI ilke: sahte aptallaşma
 * yerine GERÇEK neden söylenir. */
const KEY_INVALID_REPLY =
  'Yapay zeka anahtarım geçersiz görünüyor. Ayarlar ekranından yapay zeka anahtarlarını kontrol etmen gerekiyor.';

/* SAHA (#698) — CİHAZDA CDP İLE ÖLÇÜLDÜ: kullanıcının zincirinde DÖRT halkanın
   dördü de kimlik doğrulamada ölüydü — OpenRouter **402 "Insufficient credits"**,
   Gemini **401**, Groq **401 "Invalid API Key"**, Anthropic CORS. Anahtarlar
   BOŞ DEĞİLDİ (`X-goog-api-key` 53 karakter dolu gitti) — yani depo/şifre çözme
   sağlamdı, kimlik bilgilerinin KENDİSİ geçersizdi.

   Ama kullanıcı bunların HİÇBİRİNİ duymadı, "of orayı kaçırdım" duydu: dürüst
   cevap dalı YALNIZ Gemini'nin **400/403 + gövdede API_KEY_INVALID** dar hâline
   bağlıydı. **401 hiç sınıflandırılmıyordu** (oysa 401 tanım gereği kimlik
   reddidir), Groq/Haiku'nun 401'i hiç bakılmıyordu, kredi bitişi (402) ise hiç
   bilinmiyordu. Sonuç: çözümü kullanıcının elinde olan bir arıza, çözümsüz bir
   "seni duyamadım" gibi görünüyordu — #697'nin düzelttiği çıkmazın ikizi. */
const NO_CREDIT_REPLY =
  'Yapay zeka servisimin kredisi bitmiş. Sağlayıcı hesabından kredi yükleyince yine buradayım.';

/* ══════════════════════════════════════════════════════════════════════════
 * KİMLİK / KREDİ İŞARETLERİ
 * ════════════════════════════════════════════════════════════════════════ */

let _authFailureAtMs = 0;
/** Kimlik reddi (401/403) HANGİ sağlayıcıda görüldü — künye için (metin değil ad). */
let _authFailureProvider: string | null = null;
/** Kredi/bakiye bitişi (402) işareti — anahtar geçerli ama ödeme yok. */
let _noCreditAtMs = 0;

/** İşaretin "bu turun hatası" sayıldığı tazelik penceresi. */
const FAILURE_FRESHNESS_MS = 10_000;

/** 401/403/402'yi sağlayıcı-BAĞIMSIZ sınıflandırır (Groq · Haiku · gateway).
 *  Gövde okumaz: 401/403 tanım gereği kimlik reddi, 402 tanım gereği bakiye. */
export function noteProviderAuthFailure(provider: string, status: number): void {
  if (status === 401 || status === 403) {
    _authFailureAtMs      = monotonicNow();
    _authFailureProvider  = provider;
  } else if (status === 402) {
    _noCreditAtMs = monotonicNow();
  }
}

/** Gateway'in bounded hata sınıfı → aynı iki işaret (HTTP durumu görünmez). */
export function noteGatewayFailureKind(kind: string, provider = 'gateway'): void {
  if (kind === 'auth') {
    _authFailureAtMs     = monotonicNow();
    _authFailureProvider = provider;
  } else if (kind === 'insufficient_credit') {
    _noCreditAtMs = monotonicNow();
  }
}

/** Gemini 400/401/403 gövdesini sınıflandırır — anahtar hatasıysa işaretler.
 *  **401 gövde KOŞULSUZ işaretlenir** (SAHA #698: Google 401'de `API_KEY_INVALID`
 *  reason'ı GÖNDERMEZ, "Expected OAuth 2 access token…" der; gövde koşulu aramak
 *  bu hâli sessizce yutuyordu). 400/403'te eski gövde koşulu AYNEN korunur —
 *  o kodlar anahtar dışı sebeplerle de gelebilir (yanlış alarm > sessizlik). */
export async function noteGeminiAuthFailure(resp: Response): Promise<void> {
  if (resp.status === 401) {
    _authFailureAtMs     = monotonicNow();
    _authFailureProvider = 'gemini';
    return;
  }
  if (resp.status !== 400 && resp.status !== 403) return;
  try {
    const data = await resp.json() as {
      error?: { message?: string; details?: { reason?: string }[] };
    };
    const reason = data.error?.details?.find((d) => typeof d?.reason === 'string')?.reason;
    if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(data.error?.message ?? '')) {
      _authFailureAtMs     = monotonicNow();
      _authFailureProvider = 'gemini';
    }
  } catch { /* gövde okunamadı — sınıflandırma yapılmaz */ }
}

/** Sağlayıcı 200 döndü → anahtar geçerli, kimlik işareti temizlenir. */
export function clearAuthFailure(): void {
  _authFailureAtMs     = 0;
  _authFailureProvider = null;
}

/** Dürüst arıza cevabının bounded sınıfı — rota eşlemesi ÇAĞIRANIN işi. */
export type ProviderFailureKind = 'no_credit' | 'key_invalid';

export interface ProviderFailureAnswer {
  readonly kind: ProviderFailureKind;
  readonly response: string;
  /** Yalnız SAĞLAYICI ADI — anahtarın kendisi asla (gizlilik: VAR/YOK ve ADET). */
  readonly provider: string;
}

/**
 * Bu turda kimlik/kredi arızası görüldüyse dürüst cevabı döner; yoksa `null`.
 *
 * İşaret TAZE olmalı (bu turun hatası) — eski bir turdan kalma bayrak yeni
 * turda konuşturmaz.
 *
 * #698: KREDİ bitişi anahtar geçersizliğinden ÖNCE sorulur — ikisi AYRI eylem
 * gerektirir (bakiye yükle ↔ anahtar yenile) ve kredi bitişi daha spesifiktir.
 */
export function resolveProviderFailureAnswer(): ProviderFailureAnswer | null {
  const now = monotonicNow();
  if (_noCreditAtMs > 0 && now - _noCreditAtMs < FAILURE_FRESHNESS_MS) {
    return { kind: 'no_credit', response: NO_CREDIT_REPLY, provider: 'unknown' };
  }
  if (_authFailureAtMs > 0 && now - _authFailureAtMs < FAILURE_FRESHNESS_MS) {
    return {
      kind: 'key_invalid',
      response: KEY_INVALID_REPLY,
      provider: _authFailureProvider ?? 'unknown',
    };
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * GÖZLEM YÜZEYİ (SALT-OKUNUR)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tanı raporu için AI sağlayıcı kota (429) pencereleri anlık görüntüsü.
 * Her sağlayıcı için kalan soğuma süresi (ms; 0 = açık/kotasız). PII yok.
 * Sağlayıcı-bazlı pencereler (çapraz kirlenme yok) — SAHA 2026-07-04 dersi.
 */
export function getProviderQuotaSnapshot(): {
  geminiCooldownMs: number; groqCooldownMs: number; haikuCooldownMs: number;
} {
  const now = monotonicNow();
  const left = (until: number): number => (until > now ? Math.round(until - now) : 0);
  return {
    geminiCooldownMs: left(_cooldownUntil.gemini),
    groqCooldownMs:   left(_cooldownUntil.groq),
    haikuCooldownMs:  left(_cooldownUntil.haiku),
  };
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetProviderHealthForTest(): void {
  _cooldownUntil.gemini = 0;
  _cooldownUntil.groq   = 0;
  _cooldownUntil.haiku  = 0;
  _groundingCooldownUntil = 0;
  _authFailureAtMs        = 0;
  _authFailureProvider    = null;   // #698 işaretleri testler arası SIZMASIN
  _noCreditAtMs           = 0;
}
