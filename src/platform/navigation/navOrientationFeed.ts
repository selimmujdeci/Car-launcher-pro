/**
 * navOrientationFeed.ts — navigasyonun JİRO BESLEME KÖPRÜSÜ (F3 · C1 borcu).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.1.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN L2'DE DEĞİL, BURADA ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F2 kilidi K2: **L2 ham sensör/native sağlayıcı SAHİPLENEMEZ.** Jiroyu
 * beslemek `devicemotion` aboneliği sahiplenmek demektir; bu yüzden abonelik
 * L2 ağacının (`navigation/ego/**`) DIŞINDA, tam olarak `navGpsPowerBridge`
 * ile aynı desende, runtime kenarında durur. L2 buradan yalnız SENKRON okur
 * (`readYawRate`) — hiçbir şey başlatmaz/durdurmaz (F2 kilidi K11).
 *
 * ── TEK ABONELİK, DENGELİ ÖMÜR ───────────────────────────────────────────
 * Abonelik `orientationSensorGate` üzerinden açılır (ikinci fiziksel listener
 * KURULMAZ — kapı zaten ref-count'lu multiplexer'dır). `acquire` ref-count'lu
 * ve idempotenttir; oturum kapanınca `release` fiziksel aboneliği düşürür.
 * Dengesiz acquire/release = sensör sızıntısı → kilit test bunu denetler.
 *
 * ── JİRO YOKSA SESSİZ KAL ────────────────────────────────────────────────
 * `rotationRate` olmayan cihazda (jiroskopsuz head unit) örnek REDDEDİLİR ve
 * sapma hızı `null` kalır. EKF bunu "jiro kanıtı yok" diye işler ve yön
 * belirsizliğini ŞİŞİRİR — sahte kesinlik değil, dürüst belirsizlik.
 *
 * ── İŞARET ÖĞRENİLİR, VARSAYILMAZ ────────────────────────────────────────
 * Düşey eksen izdüşümünün işareti GNSS yön değişimiyle korele edilerek
 * ÖĞRENİLİR (`yawRateModel`). Kanıt gelene kadar sapma hızı `null`dır.
 * Yön gözlemini tik sahibi iter (`noteHeadingObservation`) — bu dosya
 * konum/GPS sağlayıcısı SAHİPLENMEZ.
 */

import { subscribeMotion } from '../sensors';
import type { YawRateVerdict, PolarityDecision } from './ego/yawRateModel';
import {
  createYawRateState, noteMotionSample, noteHeadingObservation, resolveYawRate,
} from './ego/yawRateModel';
import { readMonotonicNow } from './time/navClock';

/* ══════════════════════════════════════════════════════════════════════════
   1) DURUM (runtime kenarı — tek örnek)
   ══════════════════════════════════════════════════════════════════════════ */

let _state = createYawRateState();
let _release: (() => void) | null = null;
let _holders = 0;
let _events = 0;
let _lastEventMonoMs: number | null = null;
let _lastPolarityDecision: PolarityDecision | null = null;

/* ══════════════════════════════════════════════════════════════════════════
   2) ABONELİK ÖMRÜ
   ══════════════════════════════════════════════════════════════════════════ */

function _onMotion(e: DeviceMotionEvent): void {
  try {
    const now = readMonotonicNow();
    _events++;
    _lastEventMonoMs = now;
    const r = e?.rotationRate;
    const a = e?.accelerationIncludingGravity;
    noteMotionSample(_state, {
      /* `rotationRate` cihaz eksenleri: alpha=Z · beta=X · gamma=Y. */
      rotXDps: r?.beta ?? null,
      rotYDps: r?.gamma ?? null,
      rotZDps: r?.alpha ?? null,
      accXMs2: a?.x ?? null,
      accYMs2: a?.y ?? null,
      accZMs2: a?.z ?? null,
      tsMonoMs: now,
    });
  } catch {
    /* Fail-soft: sensör olayındaki hata navigasyonu ASLA düşürmez. */
  }
}

/**
 * Jiro beslemesini aç. **Ref-count'ludur ve idempotenttir**: ikinci çağrı
 * yeni abonelik AÇMAZ. Dönen fonksiyon bir kez etkilidir (çift çağrı güvenli).
 */
export function acquireNavOrientationFeed(): () => void {
  _holders++;
  if (_holders === 1 && _release === null) {
    try {
      _release = subscribeMotion(_onMotion);
    } catch {
      /* Kapı yoksa/DOM yoksa: besleme YOK, sapma hızı `null` kalır. */
      _release = null;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    _holders = Math.max(0, _holders - 1);
    if (_holders === 0) _releasePhysical();
  };
}

function _releasePhysical(): void {
  if (_release !== null) {
    try { _release(); } catch { /* abonelik zaten düşmüş olabilir */ }
    _release = null;
  }
  /* Oturum bitti → biriken jiro geçmişi TAŞINMAZ (yeni oturum yeni kanıt).
     İşaret kilidi de düşer: cihaz araçtan sökülüp başka açıyla takılmış
     olabilir; eski işareti yeni oturuma taşımak yanlış yön öğretmektir. */
  _state = createYawRateState();
  _lastEventMonoMs = null;
  _lastPolarityDecision = null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BESLEME / OKUMA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * GNSS yön gözlemini iter — işaret öğrenmenin TEK kanıtı.
 * Tik sahibi çağırır; bu dosya GPS sağlayıcısı SAHİPLENMEZ.
 */
export function noteNavHeadingObservation(
  headingDeg: number | null,
  speedMps: number | null,
  tsMonoMs: number | null,
): void {
  try {
    _lastPolarityDecision = noteHeadingObservation(_state, headingDeg, speedMps, tsMonoMs);
  } catch {
    /* fail-soft */
  }
}

/** Senkron sapma hızı hükmü. Hiçbir şey BAŞLATMAZ. */
export function readYawRate(nowMonoMs: number | null): YawRateVerdict {
  try {
    return resolveYawRate(_state, nowMonoMs);
  } catch {
    return { radPerSec: null, reason: 'NO_SAMPLES', samples: 0, polarity: 0 };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) GÖZLEM (CAROS LAB — salt-okunur, koordinat/açı TAŞIMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavOrientationFeedSnapshot {
  /** Fiziksel abonelik ayakta mı. */
  readonly attached: boolean;
  /** Kaç yüzey besleme tutuyor (dengeli ömür kanıtı). */
  readonly holders: number;
  /** İşlenen `devicemotion` olayı sayısı. */
  readonly events: number;
  /** Son olayın üzerinden geçen süre (ms) — `null` = hiç olay yok. */
  readonly lastEventAgeMs: number | null;
  /** Kabul edilen jiro örneği sayısı. */
  readonly accepted: number;
  /** Jiro alanı olmadığı için reddedilen örnek sayısı. */
  readonly rejectedNoGyro: number;
  /** Yerçekimi kapısında reddedilen örnek sayısı. */
  readonly rejectedGravity: number;
  /** Zaman damgası olmadığı için reddedilen örnek sayısı. */
  readonly rejectedTime: number;
  /** İşaret kilidi: `-1`/`+1` = kilitli · `0` = KARAR YOK → sapma hızı susar. */
  readonly polarity: -1 | 0 | 1;
  readonly polarityDecisions: number;
  readonly lastPolarityDecision: PolarityDecision | null;
  readonly headingObservations: number;
  /** Şu anki hüküm — `null` = kanıt yok. */
  readonly yawRateRadPerSec: number | null;
  readonly yawReason: YawRateVerdict['reason'];
}

export function getNavOrientationFeedSnapshot(): NavOrientationFeedSnapshot {
  const now = readMonotonicNow();
  const v = readYawRate(now);
  return {
    attached: _release !== null,
    holders: _holders,
    events: _events,
    lastEventAgeMs: (now !== null && _lastEventMonoMs !== null)
      ? Math.max(0, Math.round(now - _lastEventMonoMs))
      : null,
    accepted: _state.accepted,
    rejectedNoGyro: _state.rejectedNoGyro,
    rejectedGravity: _state.rejectedGravity,
    rejectedTime: _state.rejectedTime,
    polarity: _state.polarity,
    polarityDecisions: _state.polarityDecisions,
    lastPolarityDecision: _lastPolarityDecision,
    headingObservations: _state.headingObservations,
    yawRateRadPerSec: v.radPerSec,
    yawReason: v.reason,
  };
}

/** @internal testler arası izolasyon — aboneliği ve durumu sıfırlar. */
export function _resetNavOrientationFeedForTest(): void {
  _holders = 0;
  _releasePhysical();
  _events = 0;
  _state = createYawRateState();
}
