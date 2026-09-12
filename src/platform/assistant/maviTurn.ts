/**
 * maviTurn — Mavi'nin KULLANICI TURU kimliği, güncellik kapısı ve bounded sayaçları.
 * (MAVI-M5-REQUEST-GUARD · M1 #146 P1 "stale response" bulgusunu kapatır)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 kanıtladı: `processTextCommand` içinde istek kimliği YOKTU. Kullanıcı A
 * komutunu söyleyip cevabı beklemeden B komutunu söylediğinde, A'nın GEÇ dönen
 * sağlayıcı cevabı hâlâ `_aiHandlers`'ı çalıştırabiliyor, navigasyon/arama
 * başlatabiliyor, TTS üretebiliyor ve yeni turu bozabiliyordu.
 *
 * ── ANAYASA ────────────────────────────────────────────────────────────────
 *  1. **Yeni kullanıcı komutu, öncekinin EYLEM YETKİSİNİ iptal eder.** Turn
 *     kimliği tek otoritedir — `AbortError` tek başına stale kanıtı DEĞİLDİR
 *     (timeout da `AbortError` üretir; o durumda AYNI tur fallback'e düşebilir).
 *  2. **Stale bir HATA DEĞİLDİR.** Sessizce düşürülür; `errorBus`a gitmez,
 *     kullanıcıya konuşulmaz, fallback çalıştırmaz.
 *  3. **İki ayrı soru, iki ayrı yüklem:**
 *     · `isMaviTurnCurrent` → "daha yeni bir tur başladı mı?" (UI/durum sıfırlama)
 *     · `isMaviTurnActive`  → "hâlâ eylem/konuşma yetkisi var mı?" (yan etki + TTS)
 *     Tamamlanmış tur `current` olabilir ama `active` DEĞİLDİR → gecikmeli
 *     "Bir saniye…" ara sözü tur bittikten sonra KONUŞAMAZ.
 *  4. **Proaktif güvenlik hattı bu sayaca BAĞLANMAZ.** Kritik DTC uyarısı
 *     kullanıcı turu değişince susturulamaz (bkz. guard testi).
 *  5. SAF/İZOLE: store/localStorage'a yazmaz, timer kurmaz, `Date.now`u KİMLİK
 *     olarak kullanmaz (yalnız gözlem damgası). Uygulama yeniden başlarken
 *     sürmesi GEREKMEZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir kullanıcı komutunun kimliği. `id` süreç-içi monotonik sayaçtır. */
export interface MaviTurnToken {
  readonly id: number;
  /** Yalnız gözlem/tanı için — KİMLİK DEĞİL (saat geriye gitse bile `id` bozulmaz). */
  readonly startedAtMs: number;
}

export type MaviTurnState = 'active' | 'completed' | 'superseded';

/**
 * Sayaç tavanı. Pratikte ulaşılamaz (komut başına 1 artar); yine de davranış
 * TANIMLIDIR: tavana gelince 1'e sarılır ve sarılma anında aktif tur SUPERSEDED
 * olur → eski token yeni turla ÇAKIŞAMAZ (kimlik yeniden kullanımı güvenli).
 */
const MAX_TURN_ID = Number.MAX_SAFE_INTEGER;

/** Sayaç tavanı — bounded telemetri (log seli / taşma yok). */
const MAX_COUNTER = 1_000_000;

let _counter = 0;
let _activeId = 0;
let _activeState: MaviTurnState = 'completed';

/* ── Bounded sayaçlar (PII YOK — yalnız adet) ─────────────────────────────── */
let _turnsStarted = 0;
let _turnsCompleted = 0;
let _turnsSuperseded = 0;
let _staleProviderResultsDropped = 0;
let _staleActionsPrevented = 0;
let _staleFeedbackSuppressed = 0;

function _bump(v: number): number {
  return v >= MAX_COUNTER ? MAX_COUNTER : v + 1;   // saturating
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yeni kullanıcı turu başlatır. Önceki AKTİF tur derhal `superseded` olur →
 * o turun uçuştaki sağlayıcı cevabı artık eylem/konuşma yetkisine sahip değildir.
 *
 * ⚠️ YALNIZ gerçek, final kullanıcı komutu için çağrılır. Wake word tek başına,
 * partial/interim STT ve boş metin tur BAŞLATMAZ (çağıranın sözleşmesi —
 * `processTextCommand` boş metinde bu satıra hiç ulaşmaz).
 */
export function beginMaviTurn(nowMs: number = Date.now()): MaviTurnToken {
  if (_activeState === 'active') _turnsSuperseded = _bump(_turnsSuperseded);
  _counter = _counter >= MAX_TURN_ID ? 1 : _counter + 1;
  _activeId = _counter;
  _activeState = 'active';
  _turnsStarted = _bump(_turnsStarted);
  return Object.freeze({ id: _activeId, startedAtMs: Number.isFinite(nowMs) ? nowMs : 0 });
}

/** Daha yeni bir tur başlamadı mı? (UI/durum sıfırlama kapısı) */
export function isMaviTurnCurrent(token: MaviTurnToken | null | undefined): boolean {
  return !!token && typeof token.id === 'number' && token.id === _activeId;
}

/**
 * Hâlâ eylem/konuşma yetkisi var mı? **Yan etki · TTS · fallback için ASIL KAPI.**
 * Tamamlanmış veya devralınmış tur `false` döner.
 */
export function isMaviTurnActive(token: MaviTurnToken | null | undefined): boolean {
  return isMaviTurnCurrent(token) && _activeState === 'active';
}

/**
 * Turu tamamlar (nihai TTS/UI zarfı üretildi · dürüst no-response · fail-closed
 * ret iletildi · aynı-tur fallback bitti). İDEMPOTENT; devralınmış turu geri almaz.
 */
export function completeMaviTurn(token: MaviTurnToken | null | undefined): void {
  if (!isMaviTurnCurrent(token) || _activeState !== 'active') return;
  _activeState = 'completed';
  _turnsCompleted = _bump(_turnsCompleted);
}

/** Aktif turu dışarıdan devral (ör. kullanıcı barge-in). İdempotent. */
export function supersedeActiveMaviTurn(): void {
  if (_activeState !== 'active') return;
  _activeState = 'superseded';
  _turnsSuperseded = _bump(_turnsSuperseded);
}

/** Şu anki turun token'ı (yoksa null) — senkron handler'ların kimliği yakalaması için. */
export function getActiveMaviTurn(): MaviTurnToken | null {
  return _activeId === 0 ? null : Object.freeze({ id: _activeId, startedAtMs: 0 });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Stale düşürme + gözlemlenebilirlik
 * ════════════════════════════════════════════════════════════════════════ */

/** Ne tür bir stale olay düşürüldü (yalnız sayaç — metin/PII taşınmaz). */
export type MaviStaleKind = 'provider_result' | 'action' | 'feedback';

/**
 * Güncellik kapısı + sayaç. `true` → devam edilebilir. `false` → SESSİZCE düşür
 * (hata değildir; `errorBus`a gitmez, kullanıcıya konuşulmaz).
 */
export function continueIfTurnActive(
  token: MaviTurnToken | null | undefined,
  kind: MaviStaleKind,
): boolean {
  if (isMaviTurnActive(token)) return true;
  _countStale(kind);
  return false;
}

/**
 * **Kendi turunun GEÇ sonucu için** güncellik kapısı (M6 düzeltmesi).
 *
 * `continueIfTurnActive`ten farkı: TAMAMLANMIŞ turu da geçirir. M3'ün sonuç-temelli
 * ACK'i (`routeIntent(...).then(...)`) doğası gereği `completeMaviTurn`ten SONRA
 * çözülür; `isMaviTurnActive` kullanılırsa o dürüst cevap ("Bu araçta kapı kilitleme
 * bağlantısı henüz hazır değil") ÜRETİMDE HİÇ DUYULMAZDI. Susturulması gereken
 * DEVRALINMA'dır (yeni komut geldi), tamamlanma değil.
 *
 * ── MAVI-F12 DÜZELTMESİ ────────────────────────────────────────────────────
 * Yukarıdaki sözleşme "devralınma SUSTURULUR" diyordu ama uygulama YALNIZ
 * `isMaviTurnCurrent` (kimlik eşitliği) bakıyordu. Bu, devralınmanın HER ZAMAN
 * `beginMaviTurn` ile olduğu varsayımına dayanıyordu — o yolda `_activeId`
 * değiştiği için kapı zaten kapanıyordu. F12 barge-in'i devralınmayı YENİ KOMUT
 * BEKLEMEDEN yapar (`supersedeActiveMaviTurn`): kimlik AYNI kalır, durum
 * `superseded` olur. Kimlik kontrolü tek başına bırakılsaydı **kullanıcı Mavi'yi
 * kestikten sonra eski turun geç sağlayıcı cevabı yine konuşurdu** — F12'nin
 * kapatmak zorunda olduğu tam da budur. Kapı artık sözleşmenin KENDİ metnini
 * uygular; `beginMaviTurn` yolu için davranış BİREBİR aynıdır.
 */
export function continueIfTurnCurrent(
  token: MaviTurnToken | null | undefined,
  kind: MaviStaleKind,
): boolean {
  if (isMaviTurnCurrent(token) && _activeState !== 'superseded') return true;
  _countStale(kind);
  return false;
}

function _countStale(kind: MaviStaleKind): void {
  if (kind === 'provider_result')   _staleProviderResultsDropped = _bump(_staleProviderResultsDropped);
  else if (kind === 'action')       _staleActionsPrevented = _bump(_staleActionsPrevented);
  else                              _staleFeedbackSuppressed = _bump(_staleFeedbackSuppressed);
}

/** CAROS LAB gözlem yüzeyi — salt okunur, bounded, PII YOK (yalnız adet). */
export function getMaviTurnDiagnostics(): {
  activeTurnId: number;
  activeState: MaviTurnState;
  turnsStarted: number;
  turnsCompleted: number;
  turnsSuperseded: number;
  staleProviderResultsDropped: number;
  staleActionsPrevented: number;
  staleFeedbackSuppressed: number;
  countersSaturated: boolean;
} {
  return {
    activeTurnId: _activeId,
    activeState: _activeState,
    turnsStarted: _turnsStarted,
    turnsCompleted: _turnsCompleted,
    turnsSuperseded: _turnsSuperseded,
    staleProviderResultsDropped: _staleProviderResultsDropped,
    staleActionsPrevented: _staleActionsPrevented,
    staleFeedbackSuppressed: _staleFeedbackSuppressed,
    countersSaturated:
      _turnsStarted >= MAX_COUNTER || _turnsCompleted >= MAX_COUNTER ||
      _turnsSuperseded >= MAX_COUNTER || _staleProviderResultsDropped >= MAX_COUNTER ||
      _staleActionsPrevented >= MAX_COUNTER || _staleFeedbackSuppressed >= MAX_COUNTER,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetMaviTurnsForTest(): void {
  _counter = 0;
  _activeId = 0;
  _activeState = 'completed';
  _turnsStarted = 0;
  _turnsCompleted = 0;
  _turnsSuperseded = 0;
  _staleProviderResultsDropped = 0;
  _staleActionsPrevented = 0;
  _staleFeedbackSuppressed = 0;
}

/** @internal — sayaç sarılma davranışını test etmek için (üretimde ÇAĞRILMAZ). */
export function _setMaviTurnCounterForTest(value: number): void {
  _counter = value;
}
