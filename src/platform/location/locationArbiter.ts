/**
 * locationArbiter.ts — KAYNAK SEÇİMİ VE TİTREŞİM KONTROLÜ (SAF).
 *
 * ── §5 ANA PROBLEM ───────────────────────────────────────────────────
 * İki kaynak sırayla iyi/kötü olduğunda naif "en iyisini seç" mantığı
 * **titreşir** (flapping): harita ikonu iki konum arasında zıplar, hız
 * göstergesi seğirir, yön döner. Bu, tek GPS'li bugünkü durumda YOKTU;
 * çok kaynaklıya geçerken ÜRETİLMEMESİ gerekir.
 *
 * ── ÜÇ KAPI ──────────────────────────────────────────────────────────
 *  1. **Öncelik + uygunluk:** yalnız `available` ve GEÇERLİ örneği olan
 *     sağlayıcılar yarışır. Öncelik `EXTERNAL → HEAD_UNIT → PHONE_HUB →
 *     LAST_KNOWN` (§3).
 *  2. **Yükseltme serbest, düşürme GECİKMELİ:** daha yüksek önceliğe
 *     geçiş ANINDA olur (daha iyi kaynak geldi — bekletmenin anlamı yok).
 *     Daha düşük önceliğe düşüş `DEMOTE_GRACE_MS` boyunca mevcut kaynağın
 *     toparlanmasını bekler. Asimetri kasıtlıdır: iyiye hızlı, kötüye
 *     temkinli.
 *  3. **Minimum tutunma (dwell):** her geçişten sonra `MIN_DWELL_MS`
 *     boyunca yeni bir geçiş YAPILMAZ. Bu, iki kaynağın karşılıklı
 *     zıplamasını yapısal olarak imkânsız kılar (bounded switching).
 *
 * `LAST_KNOWN`'a düşüş de bir geçiştir ve aynı kapılara tabidir —
 * canlı kaynak bir saniye kesildi diye kalıcı konuma atlanmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 * Zaman DIŞARIDAN verilir; hakem yalnız durum makinesidir.
 */

import {
  providerPriority,
  type LocationProviderId,
  type LocationProviderStatus,
  type LocationSample,
  type RawLocationSample,
  type LocationErrorKind,
} from './locationProvider';
import {
  deriveConfidence,
  deriveLocationState,
  FRESHNESS_MS,
  type LocationState,
} from './locationConfidence';

/* ── Geçiş kapıları ────────────────────────────────────────────────────── */

/** Düşük önceliğe düşmeden önce mevcut kaynağa verilen toparlanma süresi. */
export const DEMOTE_GRACE_MS = 6_000;
/** Geçişten sonra zorunlu tutunma süresi (bounded switching). */
export const MIN_DWELL_MS = 4_000;
/**
 * Bir örneğin yarışa girebilmesi için üst yaş sınırı.
 * `STALE_AFTER`'dan büyük bir fix "aktif kaynak" olamaz — ama hiçbir kaynak
 * kalmadıysa `LAST_KNOWN` yolu devreye girer.
 */
export const CANDIDATE_MAX_AGE_MS = FRESHNESS_MS.STALE_AFTER;

/* ── Girdi / çıktı ─────────────────────────────────────────────────────── */

export interface ArbiterTickInput {
  readonly nowMs: number;
  /** Tüm sağlayıcıların anlık durumu (hakem hiçbirini BAŞLATMAZ). */
  readonly providers: readonly LocationProviderStatus[];
}

export interface ArbiterDecision {
  /** Seçilen konum — kanıt yoksa `null` (tahmin ÜRETİLMEZ). */
  readonly sample: LocationSample | null;
  readonly state: LocationState;
  readonly activeProvider: LocationProviderId | null;
  /** Bu tick'te kaynak değişti mi. */
  readonly switched: boolean;
  /** Geçiş, daha DÜŞÜK önceliğe mi oldu (fallback). */
  readonly fellBack: boolean;
  /** Geçiş engellendiyse gerekçe — sessiz davranış YOK. */
  readonly holdReason: ArbiterHoldReason | null;
}

export type ArbiterHoldReason =
  | 'DWELL'          // minimum tutunma süresi dolmadı
  | 'DEMOTE_GRACE'   // düşürme için toparlanma süresi bekleniyor
  | 'NO_CANDIDATE';  // yarışacak geçerli kaynak yok

/** LAB için salt-okunur sayaçlar (§7). */
export interface ArbiterSnapshot {
  readonly activeProvider: LocationProviderId | null;
  readonly state: LocationState;
  readonly sample: LocationSample | null;
  readonly switchCount: number;
  readonly fallbackCount: number;
  readonly holdReason: ArbiterHoldReason | null;
  /** Aktif kaynağın ardışık kabul edilmiş fix sayısı. */
  readonly streak: number;
  /** Sağlayıcı başına hata sayısı ve son hata SINIFI. */
  readonly providerErrors: Readonly<Record<string, {
    count: number; lastKind: LocationErrorKind | null;
  }>>;
  /** Sağlayıcı başına uygunluk — LAB'ın "neden bu kaynak" sorusuna yanıt. */
  readonly providerAvailability: Readonly<Record<string, boolean>>;
  /** Son karar anı (epoch ms); hiç karar verilmediyse `null`. */
  readonly lastDecisionAtMs: number | null;
}

/* ── Hakem ─────────────────────────────────────────────────────────────── */

export class LocationArbiter {
  private _active: LocationProviderId | null = null;
  private _activeSince = 0;
  /** Aktif kaynağın son GEÇERLİ örneğinin görüldüğü an. */
  private _activeLastGoodMs = 0;
  private _streak = 0;
  /** Aktif kaynağın son yayınlanan örneği — süreklilik ve tekrar tespiti için. */
  private _lastSample: LocationSample | null = null;

  private _switchCount = 0;
  private _fallbackCount = 0;
  private _holdReason: ArbiterHoldReason | null = null;
  private _state: LocationState = 'UNKNOWN';
  private _lastDecisionAtMs: number | null = null;

  private readonly _errors = new Map<
    LocationProviderId, { count: number; lastKind: LocationErrorKind | null }
  >();
  private readonly _availability = new Map<LocationProviderId, boolean>();

  /**
   * Bir tick değerlendirir ve kararı döndürür.
   *
   * ASLA FIRLATMAZ: bu yol konum akışının içindedir; buradan çıkan bir
   * istisna haritayı ve hız göstergesini durdurur.
   */
  tick(input: ArbiterTickInput): ArbiterDecision {
    try {
      return this._decide(input);
    } catch {
      /* Fail-soft: karar veremediysek SON bilinen kararı korur, uydurmaz. */
      return {
        sample: this._lastSample,
        state: this._lastSample === null ? 'UNKNOWN' : 'STALE',
        activeProvider: this._active,
        switched: false,
        fellBack: false,
        holdReason: this._holdReason,
      };
    }
  }

  private _decide(input: ArbiterTickInput): ArbiterDecision {
    const { nowMs, providers } = input;
    this._lastDecisionAtMs = nowMs;

    /* Hata ve uygunluk defterini güncelle (gözlemlenebilirlik). */
    for (const p of providers) {
      this._availability.set(p.id, p.available);
      const prev = this._errors.get(p.id);
      if (!prev || p.errorCount !== prev.count || p.lastErrorKind !== prev.lastKind) {
        this._errors.set(p.id, { count: p.errorCount, lastKind: p.lastErrorKind });
      }
    }

    /* ── Kapı 1: yarışabilir adaylar ─────────────────────────────────── */
    const candidates = providers
      .filter((p) => p.available && p.sample !== null)
      .filter((p) => {
        /* LAST_KNOWN yaş kapısına TABİ DEĞİL — o zaten "eski" olmak üzere var. */
        if (p.id === 'LAST_KNOWN') return true;
        const age = nowMs - (p.sample as RawLocationSample).timestampMs;
        /* Gelecekten gelen fix reddedilir (saat kayması). */
        return age >= -FRESHNESS_MS.FRESH && age <= CANDIDATE_MAX_AGE_MS;
      })
      .sort((a, b) => providerPriority(a.id) - providerPriority(b.id));

    if (candidates.length === 0) {
      /* Hiç aday yok: SON örneği korur ama durumunu dürüstçe düşürür. */
      this._holdReason = 'NO_CANDIDATE';
      this._state = this._lastSample === null
        ? 'UNKNOWN'
        : deriveLocationState({ sample: this._lastSample, nowMs, readable: true });
      return {
        sample: this._lastSample,
        state: this._state,
        activeProvider: this._active,
        switched: false,
        fellBack: false,
        holdReason: 'NO_CANDIDATE',
      };
    }

    const best = candidates[0];
    const activeStatus = this._active === null
      ? null
      : candidates.find((c) => c.id === this._active) ?? null;

    /* Aktif kaynak hâlâ geçerli örnek veriyorsa toparlanma çapasını ilerlet. */
    if (activeStatus !== null) this._activeLastGoodMs = nowMs;

    let target: LocationProviderId = best.id;
    let hold: ArbiterHoldReason | null = null;

    if (this._active !== null && best.id !== this._active) {
      const bestPrio = providerPriority(best.id);
      const activePrio = providerPriority(this._active);

      if (bestPrio < activePrio) {
        /* ── Kapı 3: YÜKSELTME — dwell'e tabidir ama grace'e DEĞİL.
           Daha iyi kaynak geldiğinde beklemenin faydası yok; yalnız
           karşılıklı zıplamayı önleyen dwell uygulanır. */
        if (nowMs - this._activeSince < MIN_DWELL_MS) {
          target = this._active;
          hold = 'DWELL';
        }
      } else {
        /* ── Kapı 2: DÜŞÜRME — mevcut kaynağa toparlanma süresi ver. */
        const quietFor = nowMs - this._activeLastGoodMs;
        if (quietFor < DEMOTE_GRACE_MS) {
          target = this._active;
          hold = 'DEMOTE_GRACE';
        } else if (nowMs - this._activeSince < MIN_DWELL_MS) {
          target = this._active;
          hold = 'DWELL';
        }
      }
    }

    /* Hedef aktif kaynaksa ama onun bu tick'te örneği YOKSA (grace/dwell
       içinde susmuş), SON örneği korur — uydurma konum üretmez. */
    const chosen = candidates.find((c) => c.id === target)
      ?? (target === this._active ? null : candidates[0]);

    if (chosen === null) {
      this._holdReason = hold;
      this._state = this._lastSample === null
        ? 'UNKNOWN'
        : deriveLocationState({ sample: this._lastSample, nowMs, readable: true });
      return {
        sample: this._lastSample,
        state: this._state,
        activeProvider: this._active,
        switched: false,
        fellBack: false,
        holdReason: hold,
      };
    }

    /* ── Geçiş muhasebesi ────────────────────────────────────────────── */
    const switched = this._active !== chosen.id;
    let fellBack = false;
    if (switched) {
      fellBack = this._active !== null
        && providerPriority(chosen.id) > providerPriority(this._active);
      this._switchCount += 1;
      if (fellBack) this._fallbackCount += 1;
      this._active = chosen.id;
      this._activeSince = nowMs;
      this._activeLastGoodMs = nowMs;
      /* Kaynak değişti → süreklilik kanıtı SIFIRLANIR. Yeni kaynağın ilk
         fix'i tek fix'tir ve §4 gereği HIGH olamaz. */
      this._streak = 0;
    }

    /* ── Süreklilik ──────────────────────────────────────────────────── */
    const raw = chosen.sample as RawLocationSample;
    const isNewFix = this._lastSample === null
      || raw.timestampMs !== this._lastSample.timestampMs
      || raw.provider !== this._lastSample.provider;
    if (isNewFix) {
      /* Taşma koruması: sayaç doygunlaşır (sınırsız büyüme yok). */
      this._streak = Math.min(this._streak + 1, 1_000);
    }

    const confidence = deriveConfidence({ sample: raw, nowMs, streak: this._streak });
    const sample: LocationSample = { ...raw, confidence };
    this._lastSample = sample;
    this._state = deriveLocationState({ sample: raw, nowMs, readable: true });
    this._holdReason = hold;

    return {
      sample,
      state: this._state,
      activeProvider: this._active,
      switched,
      fellBack,
      holdReason: hold,
    };
  }

  /** LAB salt-okur — ASLA fırlatmaz (gözlem yüzeyi). */
  getSnapshot(): ArbiterSnapshot {
    try {
      const errors: Record<string, { count: number; lastKind: LocationErrorKind | null }> = {};
      for (const [id, e] of this._errors) errors[id] = { ...e };
      const availability: Record<string, boolean> = {};
      for (const [id, a] of this._availability) availability[id] = a;
      return {
        activeProvider: this._active,
        state: this._state,
        sample: this._lastSample,
        switchCount: this._switchCount,
        fallbackCount: this._fallbackCount,
        holdReason: this._holdReason,
        streak: this._streak,
        providerErrors: errors,
        providerAvailability: availability,
        lastDecisionAtMs: this._lastDecisionAtMs,
      };
    } catch {
      return {
        activeProvider: null, state: 'UNKNOWN', sample: null,
        switchCount: 0, fallbackCount: 0, holdReason: null, streak: 0,
        providerErrors: {}, providerAvailability: {}, lastDecisionAtMs: null,
      };
    }
  }

  /** Yeniden başlatma / hesap değişimi için temiz durum (zero-leak yardımcısı). */
  reset(): void {
    this._active = null;
    this._activeSince = 0;
    this._activeLastGoodMs = 0;
    this._streak = 0;
    this._lastSample = null;
    this._holdReason = null;
    this._state = 'UNKNOWN';
    this._lastDecisionAtMs = null;
    this._errors.clear();
    this._availability.clear();
    /* Sayaçlar KORUNUR: `switchCount`/`fallbackCount` oturum boyu tanı
       verisidir; sıfırlamak gözlemi yalanlar. */
  }
}
