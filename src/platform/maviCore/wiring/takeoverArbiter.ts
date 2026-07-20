/**
 * maviCore/wiring/takeoverArbiter.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4a TAKEOVER HAKEMİ.
 *
 * AMAÇ: Bir sesli komutun GERÇEK yürütmesinin hangi hatta ait olduğuna — eski hat
 * (useVoiceCommandHandler → intentEngine) mi, Mavi hattı mı — **tek, senkron, sıra-bağımsız**
 * karar veren hakem. Aynı istekte iki hattın birden çalışmasını (çift medya atlama / çift TTS)
 * yapısal olarak imkânsız kılar.
 *
 * NEDEN SIRA-BAĞIMSIZ (kritik): voiceService `_commandHandlers` bir `Set`'tir; eski hat React
 * mount'ta, Mavi köprüsü SystemBoot Wave-4'te kaydolur → **çağrı sırası garanti DEĞİLDİR**. Ayrıca
 * eski hat SENKRON, Mavi turu ASYNC'tir. Bu yüzden karar "kim önce claim etti" olamaz; karar
 * `(policy, aktiflik, kuşak tazeliği)` üzerinden SAF ve DETERMİNİSTİK bir sorudur: her iki hat
 * hangi sırada sorarsa sorsun AYNI cevabı alır.
 *
 * SAHİPLİK TUR-KAPSAMLIDIR (kalıcı global sahiplik YOK): sahiplik `generationId + sessionId +
 * commandId + actionId` dörtlüsüne bağlanır ve YALNIZ aktif tur boyunca yaşar. Tur bittiğinde
 * (completed/error/cancelled/timeout/stale/superseded) sahiplik OTOMATİK serbest kalır.
 * Doğruluk dispose'a BAĞLI DEĞİLDİR — dispose yalnızca ek bir güvenlik ağıdır:
 *   1. release(key, reason)            → açık serbest bırakma (idempotent)
 *   2. observeGeneration(newerGen)     → eski kuşak turu 'stale' ile otomatik düşer
 *   3. claim(newerKey)                 → önceki tur 'superseded' ile otomatik düşer
 *   4. TTL (lazy expiry)               → çağrı anında süresi dolan tur 'timeout' ile düşer
 * (4) TIMER KULLANMAZ: setInterval/setTimeout YOK — süre dolumu bir sonraki sorgu/claim anında
 * tembel değerlendirilir (CLAUDE.md: hot-path'e zamanlayıcı sokma + zero-leak).
 *
 * FAIL-OPEN (anayasal): hakem pasifse, politika SHADOW ise, kuşak bayatsa, anahtar geçersizse veya
 * hakemin KENDİSİ hata atarsa cevap DAİMA `false` → **eski hat çalışır**. Hakem hiçbir koşulda
 * eski hattı susturamaz; en kötü durumda bugünkü davranış birebir korunur.
 *
 * SAVUNMA DERİNLİĞİ: eligibility kararı `takeoverPolicy`ye delege edilir → allowlist dışı hiçbir
 * eylem (ve hiçbir `vehicle.*`/ecu/coding/adaptation/actuator eylemi) hangi config verilirse
 * verilsin Mavi-owned OLAMAZ. AiSafetyGate ayrı ve tek araç güvenlik otoritesi olarak kalır.
 *
 * SAF/YAN-ETKİSİZ: hiçbir platform servisi import edilmez; zaman DI'lıdır; import yan etkisi yoktur.
 */

import type { TakeoverPolicy } from './takeoverPolicy';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Sahiplik anahtarı — sahiplik SALT komut adına bağlanmaz. Aynı doğal dil komutunun FARKLI
 * kuşak/oturumda yeniden gelmesi yanlış dedup üretmemelidir; bu yüzden kimlik dörtlüdür.
 */
export interface TakeoverOwnershipKey {
  /** voiceService kuşağı — barge-in/yeni wake ile artar. Bayat kuşak sahiplik KAZANAMAZ. */
  readonly generationId: number;
  /** Dinleme oturumu kimliği (kuşakla birlikte artar). */
  readonly sessionId: number;
  /** Bu dispatch'e özgü tekil komut kimliği (aynı turdaki farklı komutları ayırır). */
  readonly commandId: string;
  /** Çözümlenmiş pilot eylem (ör. 'media.next') — eligibility bunun üzerinden sorulur. */
  readonly actionId: string;
}

/** Sahipliğin neden bırakıldığı (bounded tanı + telemetri; serbest metin YOK). */
export type TakeoverReleaseReason =
  | 'completed' | 'error' | 'cancelled' | 'timeout' | 'stale' | 'superseded' | 'disposed';

/**
 * claim sonucu:
 *  - `claimed`      → sahiplik BU çağrıyla alındı; çağıran turu YÜRÜTÜR.
 *  - `duplicate`    → aynı tur + aynı komut zaten sahipli; çağıran turu YÜRÜTMEZ (dedup).
 *  - `stale`        → kuşak bayat; sahiplik verilmez (eski tur asla devralamaz).
 *  - `not-eligible` → allowlist dışı / yasaklı eylem veya geçersiz anahtar.
 *  - `inactive`     → hakem pasif ya da politika SHADOW → eski hat çalışır (fail-open).
 */
export type TakeoverClaimOutcome = 'claimed' | 'duplicate' | 'stale' | 'not-eligible' | 'inactive';

/** Aktif turun salt-okuma görüntüsü (tanı). */
export interface TakeoverOwnedTurn {
  readonly key: TakeoverOwnershipKey;
  /** Monotonik claim anı (TTL hesabı clock-jump güvenli). */
  readonly claimedAt: number;
}

/** Bounded tanı sayaçları — sınırsız büyüyen liste YOK. */
export interface TakeoverArbiterStats {
  readonly active: boolean;
  readonly mode: 'shadow' | 'takeover' | 'inactive';
  readonly claimed: number;
  readonly duplicates: number;
  readonly staleRejected: number;
  readonly notEligible: number;
  readonly released: number;
  readonly timedOut: number;
  readonly superseded: number;
  readonly maxGeneration: number;
  readonly ownedActionId: string | null;
}

export interface TakeoverArbiter {
  /** Hakemi bir politikayla ETKİNLEŞTİR (idempotent; yeni politika mevcut turu 'superseded' düşürür). */
  activate(policy: TakeoverPolicy): void;
  /** Hakemi PASİFLEŞTİR — aktif tur 'disposed' ile serbest bırakılır. İdempotent. */
  deactivate(): void;
  /** Hakem şu an gerçek devralma yapabilecek durumda mı (aktif + politika takeover). */
  readonly active: boolean;

  /**
   * SENKRON, SIRA-BAĞIMSIZ karar: bu komut Mavi'ye mi ait? Her iki hat da bunu sorar ve
   * hangi sırada sorarsa sorsun AYNI cevabı alır (karar claim'e DEĞİL, saf politikaya bağlıdır).
   * Hata/pasiflik/bayatlık → `false` (fail-open → eski hat).
   */
  isMaviOwned(key: TakeoverOwnershipKey): boolean;

  /** Turu sahiplen (dedup + yaşam döngüsü). Yalnız Mavi hattı çağırır. */
  claim(key: TakeoverOwnershipKey): TakeoverClaimOutcome;

  /** Sahipliği bırak — İDEMPOTENT ve anahtar-eşleşmeli (geç gelen release yeni turu EZMEZ). */
  release(key: TakeoverOwnershipKey, reason: TakeoverReleaseReason): boolean;

  /**
   * voiceService kuşak ilerlemesini bildir (wake/yeni dinleme). Daha yeni bir kuşak gelirse
   * eski kuşağın açık turu 'stale' ile OTOMATİK serbest bırakılır.
   */
  observeGeneration(generationId: number, sessionId: number): void;

  /** Aktif turun görüntüsü (TTL süresi dolduysa tembel düşürülür) — tanı. */
  currentOwner(): TakeoverOwnedTurn | null;

  /** Bounded tanı sayaçları. */
  stats(): TakeoverArbiterStats;
}

export interface TakeoverArbiterOptions {
  /** Monotonik saat (DI — test + clock-jump güvenliği). Varsayılan performance.now. */
  readonly now?: () => number;
  /**
   * Tur yaşam süresi üst sınırı (ms). Bu süreyi aşan sahiplik bir sonraki çağrıda 'timeout' ile
   * tembel düşürülür → sahiplik ASLA kalıcı olamaz (timer kullanılmadan).
   */
  readonly turnTtlMs?: number;
}

/** Sesli tur için makul üst sınır: dinleme+plan+yürütme (bounded). */
const DEFAULT_TURN_TTL_MS = 15_000;

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Anahtar yapısal olarak geçerli mi (savunmacı — geçersiz anahtar sahiplik kazanamaz). */
function isValidKey(key: TakeoverOwnershipKey | null | undefined): key is TakeoverOwnershipKey {
  if (!key || typeof key !== 'object') return false;
  if (!Number.isFinite(key.generationId) || key.generationId < 0) return false;
  if (!Number.isFinite(key.sessionId) || key.sessionId < 0) return false;
  if (typeof key.commandId !== 'string' || key.commandId.length === 0) return false;
  if (typeof key.actionId !== 'string' || key.actionId.length === 0) return false;
  return true;
}

/** İki anahtar AYNI turun AYNI komutu mu (dedup kimliği — dördü de eşleşmeli). */
function sameKey(a: TakeoverOwnershipKey, b: TakeoverOwnershipKey): boolean {
  return a.generationId === b.generationId
    && a.sessionId === b.sessionId
    && a.commandId === b.commandId
    && a.actionId === b.actionId;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Uygulama
 * ════════════════════════════════════════════════════════════════════════ */

export function createTakeoverArbiter(options: TakeoverArbiterOptions = {}): TakeoverArbiter {
  const now = typeof options.now === 'function' ? options.now : defaultNow;
  const ttlMs = typeof options.turnTtlMs === 'number' && Number.isFinite(options.turnTtlMs) && options.turnTtlMs > 0
    ? options.turnTtlMs
    : DEFAULT_TURN_TTL_MS;

  let _policy: TakeoverPolicy | null = null;
  let _owned: TakeoverOwnedTurn | null = null;
  /** Görülen EN YÜKSEK kuşak — bayat kuşak reddinin tek referansı (monotonik). */
  let _maxGeneration = -1;

  // Bounded sayaçlar (liste değil — sınırsız büyüme yok).
  let _claimed = 0, _duplicates = 0, _staleRejected = 0, _notEligible = 0;
  let _released = 0, _timedOut = 0, _superseded = 0;

  /** Aktif tur varsa serbest bırak (iç yardımcı — sayaç etiketli). */
  function releaseOwned(reason: TakeoverReleaseReason): void {
    if (!_owned) return;
    _owned = null;
    _released++;
    if (reason === 'timeout') _timedOut++;
    else if (reason === 'superseded') _superseded++;
  }

  /** TEMBEL süre dolumu: timer YOK — her sorgu/claim anında değerlendirilir. */
  function expireIfNeeded(): void {
    if (!_owned) return;
    const elapsed = now() - _owned.claimedAt;
    // Saat geri giderse (negatif elapsed) düşürme — clock-jump güvenli.
    if (elapsed >= ttlMs) releaseOwned('timeout');
  }

  /** Politika gerçek devralmaya açık mı. */
  function isActive(): boolean {
    return _policy !== null && _policy.mode === 'takeover';
  }

  /** Eylem gerçekten devralınabilir mi (allowlist ∩ eligible — savunma derinliği politikada). */
  function isTakeoverAction(actionId: string): boolean {
    return _policy !== null && _policy.shouldTakeover(actionId);
  }

  return {
    get active(): boolean {
      try { return isActive(); } catch { return false; } // fail-open
    },

    activate(policy: TakeoverPolicy): void {
      try {
        if (!policy || typeof policy.shouldTakeover !== 'function') return;
        // Politika değişimi açık bir tur bırakmasın (sahiplik tur-kapsamlı kalır).
        if (_owned) releaseOwned('superseded');
        _policy = policy;
      } catch { /* fail-soft: hakem hatası hiçbir hattı bozmaz */ }
    },

    deactivate(): void {
      try {
        // Doğruluk dispose'a bağlı DEĞİL ama dispose yine de tam temizler (zero-leak).
        if (_owned) releaseOwned('disposed');
        _policy = null;
      } catch { /* fail-soft */ }
    },

    isMaviOwned(key: TakeoverOwnershipKey): boolean {
      try {
        if (!isActive()) return false;                       // pasif/SHADOW → eski hat
        if (!isValidKey(key)) return false;                  // geçersiz anahtar → eski hat
        if (key.generationId < _maxGeneration) return false; // BAYAT kuşak → asla sahiplenemez
        if (!isTakeoverAction(key.actionId)) return false;   // allowlist dışı → eski hat
        expireIfNeeded();
        return true;
      } catch {
        return false; // hakem hatası ESKİ HATTI SUSTURMAZ (anayasal fail-open)
      }
    },

    claim(key: TakeoverOwnershipKey): TakeoverClaimOutcome {
      try {
        if (!isActive()) return 'inactive';
        if (!isValidKey(key)) { _notEligible++; return 'not-eligible'; }
        if (!isTakeoverAction(key.actionId)) { _notEligible++; return 'not-eligible'; }
        if (key.generationId < _maxGeneration) { _staleRejected++; return 'stale'; }

        expireIfNeeded();

        // Aynı tur + aynı komut → DEDUP (ikinci çağrı yürütmez).
        if (_owned && sameKey(_owned.key, key)) { _duplicates++; return 'duplicate'; }

        // Daha yeni/farklı bir tur geldi → önceki sahiplik devrolur (barge-in semantiği).
        if (_owned) releaseOwned('superseded');

        if (key.generationId > _maxGeneration) _maxGeneration = key.generationId;
        _owned = Object.freeze({ key: Object.freeze({ ...key }), claimedAt: now() });
        _claimed++;
        return 'claimed';
      } catch {
        return 'inactive'; // fail-open → eski hat çalışır
      }
    },

    release(key: TakeoverOwnershipKey, reason: TakeoverReleaseReason): boolean {
      try {
        if (!_owned || !isValidKey(key)) return false;
        // Anahtar-eşleşmeli: GEÇ gelen bir release YENİ turu EZEMEZ.
        if (!sameKey(_owned.key, key)) return false;
        releaseOwned(reason);
        return true;
      } catch {
        return false;
      }
    },

    observeGeneration(generationId: number, sessionId: number): void {
      try {
        if (!Number.isFinite(generationId) || generationId < 0) return;
        if (!Number.isFinite(sessionId) || sessionId < 0) return;
        if (generationId > _maxGeneration) _maxGeneration = generationId;
        // Daha yeni kuşak geldi → eski kuşağın açık turu OTOMATİK stale (dispose beklenmez).
        if (_owned && _owned.key.generationId < _maxGeneration) releaseOwned('stale');
      } catch { /* fail-soft */ }
    },

    currentOwner(): TakeoverOwnedTurn | null {
      try { expireIfNeeded(); return _owned; } catch { return null; }
    },

    stats(): TakeoverArbiterStats {
      let ownedActionId: string | null = null;
      try { expireIfNeeded(); ownedActionId = _owned ? _owned.key.actionId : null; } catch { /* noop */ }
      return {
        active: _policy !== null && _policy.mode === 'takeover',
        mode: _policy === null ? 'inactive' : _policy.mode,
        claimed: _claimed,
        duplicates: _duplicates,
        staleRejected: _staleRejected,
        notEligible: _notEligible,
        released: _released,
        timedOut: _timedOut,
        superseded: _superseded,
        maxGeneration: _maxGeneration,
        ownedActionId,
      };
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Modül-seviye tekil hakem (iki hattın ORTAK karar noktası)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Eski hat (`useVoiceCommandHandler`) ile Mavi wiring'i AYRI modüllerdir; ortak kararı paylaşmak
 * için tek bir hakem örneği gerekir. Tembel oluşturulur → İMPORT YAN ETKİSİ YOK (timer/abonelik
 * yok, varsayılan PASİF → bu modülü import etmek davranışı DEĞİŞTİRMEZ).
 */
let _singleton: TakeoverArbiter | null = null;

export function getTakeoverArbiter(): TakeoverArbiter {
  if (!_singleton) _singleton = createTakeoverArbiter();
  return _singleton;
}

/** @internal — testler arası izolasyon (tekil hakemi sıfırlar). */
export function _resetTakeoverArbiterForTest(): void {
  if (_singleton) { try { _singleton.deactivate(); } catch { /* noop */ } }
  _singleton = null;
}
