/**
 * yawRateModel.ts — NAV v3 · L2 · JİRO → SAPMA HIZI ÇEKİRDEĞİ (SAF · F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.1 (F2 borcu **C1**).
 *
 * SAF: I/O YOK · timer YOK · abonelik YOK · React YOK · native YOK ·
 * `Date.now`/`performance.now` YOK · MODÜL DURUMU YOK. Zaman ve ölçüm
 * DIŞARIDAN gelir; durum çağıranındır → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── PROBLEM: HANGİ EKSEN "SAPMA"DIR? ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Cihaz jiroskopu üç ekseni CİHAZ çerçevesinde verir. Head unit her araçta
 * farklı açıyla monte edilir; "alpha ekseni = araç sapması" varsayımı bir
 * UYDURMADIR ve yanlış eksende düzeltme, EKF'in yönünü aktif olarak BOZAR
 * (jiro yokluğundan daha kötüdür).
 *
 * ── ÇÖZÜM 1: BÜYÜKLÜK — YERÇEKİMİNE İZDÜŞÜM ──────────────────────────────
 * Aracın sapması DÜŞEY eksen etrafındaki dönmedir. Düşey eksen her montajda
 * ölçülebilir: `accelerationIncludingGravity` durağan hâlde yerçekimi
 * doğrultusunu verir. Açısal hız vektörünün bu birim eksene İZDÜŞÜMÜ
 * (ω·û) montajdan BAĞIMSIZ olarak düşey eksen dönme hızıdır. Bu bir
 * varsayım değil, vektör cebiridir.
 *
 * ── ÇÖZÜM 2: İŞARET — SAHADA KANITLA, VARSAYMA ───────────────────────────
 * İzdüşümün İŞARETİ platform sözleşmesine bağlıdır (Android'de
 * `accelerationIncludingGravity` masada düz cihazda +z verir; başka
 * platformlarda ters). Bunu sabit varsaymak, dönüş yönünü ters öğretme
 * riskidir. Bu yüzden işaret **GNSS yön değişimiyle korele edilerek
 * ÖĞRENİLİR**: yeterince büyük ve tutarlı bir dönüş gözlenene kadar
 * `polarity = 0` kalır ve **sapma hızı `null` yayınlanır** (jiro yok gibi
 * davranılır). Kanıt gelene kadar susmak, yanlış işaret öğretmekten
 * daima daha güvenlidir (fail-closed).
 *
 * ── ÖLÇÜLMEMİŞ SAYI "KALİBRE" DEĞİLDİR ───────────────────────────────────
 * Aşağıdaki kapı sayıları literatür/mühendislik başlangıç değerleridir,
 * bizim sahamızdan ÖLÇÜLMEMİŞTİR (`DEVICE_VALIDATION_LEDGER` maddesi).
 */

import { wrapPi } from './egoKalman';

/* ══════════════════════════════════════════════════════════════════════════
   1) KAPI SAYILARI (politika — ölçülmüş kalibrasyon DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

/** Yerçekimi büyüklüğü bu bandın dışındaysa örnek REDDEDİLİR (m/s²). */
export const GRAVITY_MIN_MS2 = 8.5;
export const GRAVITY_MAX_MS2 = 11.0;

/** İki jiro örneği arası kabul edilen en büyük Δt (ms). Üstü = boşluk. */
export const YAW_SAMPLE_MAX_DT_MS = 250;

/** Sapma hızı ortalamasının alındığı iz penceresi (ms). */
export const YAW_WINDOW_MS = 600;

/** Halka tampon boyu — 60 Hz × ~1 s. */
export const YAW_RING_SIZE = 64;

/** İşaret kararı için gereken EN AZ GNSS yön değişimi (rad ≈ 15°). */
export const POLARITY_MIN_TURN_RAD = (15 * Math.PI) / 180;

/** Jiro integrali ile GNSS yön değişimi oranı bu bandın dışındaysa KARAR YOK. */
export const POLARITY_RATIO_MIN = 0.5;
export const POLARITY_RATIO_MAX = 2.0;

/** İşaret kilitlenmeden önce gereken ARDIŞIK tutarlı karar sayısı. */
export const POLARITY_LOCK_COUNT = 2;

/** Kilitli işareti bozmak için gereken ARDIŞIK çelişkili karar sayısı. */
export const POLARITY_UNLOCK_COUNT = 3;

/** GNSS yönü bu hızın altında güvenilmez (m/s ≈ 5 km/h) — F2 ile aynı eşik. */
export const HEADING_TRUST_MIN_MPS = 5 / 3.6;

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİLER
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek `devicemotion` okuması — CİHAZ çerçevesinde, ham birimlerde. */
export interface YawMotionSample {
  /** Jiro (deg/s) — cihaz X/Y/Z eksenleri. `null` = jiro YOK. */
  readonly rotXDps: number | null;
  readonly rotYDps: number | null;
  readonly rotZDps: number | null;
  /** Yerçekimi dâhil ivme (m/s²) — düşey ekseni ölçmek için. */
  readonly accXMs2: number | null;
  readonly accYMs2: number | null;
  readonly accZMs2: number | null;
  /** Okumanın MONOTONİK anı. `null` = saat yok → örnek reddedilir. */
  readonly tsMonoMs: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DURUM
   ══════════════════════════════════════════════════════════════════════════ */

export interface YawRateState {
  /* ── Halka tampon (ön-tahsisli — hot-path'te allocation YOK) ── */
  readonly ts: Float64Array;
  readonly rate: Float64Array;
  head: number;
  count: number;

  /** Son işlenen örneğin anı (Δt için). `null` = ilk örnek. */
  lastSampleTsMs: number | null;

  /* ── İşaret öğrenme ── */
  /** `-1` · `+1` = kilitli · `0` = KARAR YOK → sapma hızı YAYINLANMAZ. */
  polarity: -1 | 0 | 1;
  /** Kilitlenmeye doğru biriken ardışık tutarlı karar sayısı. */
  polarityAgree: number;
  /** Kilitli işarete karşı biriken ardışık çelişki sayısı. */
  polarityDisagree: number;
  /** Kilitsizken görülen SON aday işaret (`0` = henüz aday yok). */
  lastCandidate: -1 | 0 | 1;
  /** İşaret penceresinde biriken jiro integrali (rad, ham işaretli). */
  windowGyroIntegralRad: number;
  /** Son GNSS yön gözlemi (rad) ve anı. */
  lastHeadingRad: number | null;
  lastHeadingTsMs: number | null;

  /* ── Sayaçlar (gözlem) ── */
  accepted: number;
  rejectedNoGyro: number;
  rejectedGravity: number;
  rejectedTime: number;
  headingObservations: number;
  polarityDecisions: number;
}

export function createYawRateState(): YawRateState {
  return {
    ts: new Float64Array(YAW_RING_SIZE),
    rate: new Float64Array(YAW_RING_SIZE),
    head: 0,
    count: 0,
    lastSampleTsMs: null,
    polarity: 0,
    polarityAgree: 0,
    polarityDisagree: 0,
    lastCandidate: 0,
    windowGyroIntegralRad: 0,
    lastHeadingRad: null,
    lastHeadingTsMs: null,
    accepted: 0,
    rejectedNoGyro: 0,
    rejectedGravity: 0,
    rejectedTime: 0,
    headingObservations: 0,
    polarityDecisions: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) JİRO ÖRNEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

function _fin(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Bir `devicemotion` okumasını işler. Uydurma YOKTUR: jiro veya yerçekimi
 * okunamıyorsa örnek REDDEDİLİR ve sayaç artar (reddedilen ölçüm başarı
 * SAYILMAZ — F2 kuralıyla aynı).
 */
export function noteMotionSample(state: YawRateState, s: YawMotionSample): void {
  const t = _fin(s?.tsMonoMs);
  if (t === null) { state.rejectedTime++; return; }

  const gx = _fin(s.rotXDps);
  const gy = _fin(s.rotYDps);
  const gz = _fin(s.rotZDps);
  if (gx === null || gy === null || gz === null) { state.rejectedNoGyro++; return; }

  const ax = _fin(s.accXMs2);
  const ay = _fin(s.accYMs2);
  const az = _fin(s.accZMs2);
  if (ax === null || ay === null || az === null) { state.rejectedGravity++; return; }

  const g = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!(g >= GRAVITY_MIN_MS2 && g <= GRAVITY_MAX_MS2)) {
    /* Düşey eksen güvenilir ölçülemiyor (sert ivme/fren, bozuk sensör). */
    state.rejectedGravity++;
    return;
  }

  /* ω (rad/s) · û (birim düşey) → düşey eksen dönme hızı (ham işaretli). */
  const wx = (gx * Math.PI) / 180;
  const wy = (gy * Math.PI) / 180;
  const wz = (gz * Math.PI) / 180;
  const raw = (wx * ax + wy * ay + wz * az) / g;
  if (!Number.isFinite(raw)) { state.rejectedNoGyro++; return; }

  /* Δt yalnız MONOTONİK farktan — duvar saati YASAK. */
  const prev = state.lastSampleTsMs;
  const dtMs = prev === null ? null : t - prev;
  state.lastSampleTsMs = t;

  const i = state.head;
  state.ts[i] = t;
  state.rate[i] = raw;
  state.head = (i + 1) % YAW_RING_SIZE;
  if (state.count < YAW_RING_SIZE) state.count++;
  state.accepted++;

  /* İşaret penceresi integrali — boşluk varsa (uyku/arka plan) EKLENMEZ. */
  if (dtMs !== null && dtMs > 0 && dtMs <= YAW_SAMPLE_MAX_DT_MS) {
    state.windowGyroIntegralRad += raw * (dtMs / 1000);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) GNSS YÖN GÖZLEMİ — işaretin TEK kanıtı
   ══════════════════════════════════════════════════════════════════════════ */

export type PolarityDecision = 'LOCKED' | 'AGREE' | 'DISAGREE' | 'NO_EVIDENCE';

/**
 * GNSS yön gözlemi ekler ve mümkünse işaret kararı verir.
 *
 * Açı farkı **`±π` sarmalıyla** hesaplanır: 350° → 10° geçişi `+20°`dir,
 * `−340°` DEĞİL. Sarmasız fark tek bir kuzey geçişinde işareti ters öğretir.
 */
export function noteHeadingObservation(
  state: YawRateState,
  headingDeg: number | null,
  speedMps: number | null,
  tsMonoMs: number | null,
): PolarityDecision {
  const t = _fin(tsMonoMs);
  const h = _fin(headingDeg);
  const v = _fin(speedMps);

  /* Durakta / yavaşta GNSS yönü gürültüdür — kanıt SAYILMAZ. */
  if (t === null || h === null || v === null || v < HEADING_TRUST_MIN_MPS) {
    return 'NO_EVIDENCE';
  }

  const rad = (h * Math.PI) / 180;
  const prevRad = state.lastHeadingRad;
  const prevTs = state.lastHeadingTsMs;
  state.headingObservations++;

  /* Pencereyi HER gözlemde kapat: bir sonraki karar taze integralle verilir. */
  const gyroIntegral = state.windowGyroIntegralRad;
  state.windowGyroIntegralRad = 0;
  state.lastHeadingRad = rad;
  state.lastHeadingTsMs = t;

  if (prevRad === null || prevTs === null || t <= prevTs) return 'NO_EVIDENCE';

  /* Pusula yönü SAAT YÖNÜ pozitiftir; ψ̇ ile aynı işaret ailesindedir. */
  const headingDelta = wrapPi(rad - prevRad);
  if (Math.abs(headingDelta) < POLARITY_MIN_TURN_RAD) return 'NO_EVIDENCE';
  if (!Number.isFinite(gyroIntegral) || gyroIntegral === 0) return 'NO_EVIDENCE';

  const ratio = Math.abs(gyroIntegral) / Math.abs(headingDelta);
  if (ratio < POLARITY_RATIO_MIN || ratio > POLARITY_RATIO_MAX) {
    /* Büyüklükler uyuşmuyor → bu dönüş işaret kanıtı DEĞİLDİR. */
    return 'NO_EVIDENCE';
  }

  const candidate: -1 | 1 = (headingDelta * gyroIntegral) >= 0 ? 1 : -1;
  state.polarityDecisions++;

  if (state.polarity === 0) {
    /* Ardışık tutarlılık: aday işaret değişirse sayaç SIFIRDAN başlar. */
    if (state.lastCandidate === candidate) {
      state.polarityAgree++;
    } else {
      state.polarityAgree = 1;
      state.lastCandidate = candidate;
    }
    if (state.polarityAgree >= POLARITY_LOCK_COUNT) {
      state.polarity = candidate;
      state.polarityAgree = 0;
      state.polarityDisagree = 0;
      return 'LOCKED';
    }
    return 'AGREE';
  }

  if (candidate === state.polarity) {
    state.polarityDisagree = 0;
    return 'AGREE';
  }

  state.polarityDisagree++;
  if (state.polarityDisagree >= POLARITY_UNLOCK_COUNT) {
    /* Kanıt ısrarla çelişiyor → işaret DÜŞER, sapma hızı susar. */
    state.polarity = 0;
    state.polarityAgree = 0;
    state.polarityDisagree = 0;
    state.lastCandidate = 0;
  }
  return 'DISAGREE';
}

/* ══════════════════════════════════════════════════════════════════════════
   6) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type YawRateReason =
  | 'OK'
  | 'NO_SAMPLES'
  | 'STALE'
  | 'POLARITY_UNRESOLVED';

export interface YawRateVerdict {
  /** ψ̇ (rad/s, saat yönü pozitif). `null` = KANIT YOK → EKF jirosuz çalışır. */
  readonly radPerSec: number | null;
  readonly reason: YawRateReason;
  /** Ortalamaya giren örnek sayısı. */
  readonly samples: number;
  readonly polarity: -1 | 0 | 1;
}

const _NO_YAW: YawRateVerdict = {
  radPerSec: null, reason: 'NO_SAMPLES', samples: 0, polarity: 0,
};

/**
 * İz penceresindeki ortalama sapma hızı.
 *
 * ANLIK değil ORTALAMA döner: EKF tahmin adımı ψ̇'yi Δt boyunca integre eder,
 * bu yüzden aralığın ortalaması tek bir anlık örnekten daha doğrudur.
 * Fail-closed: taze örnek yoksa veya işaret çözülmediyse `null`.
 */
export function resolveYawRate(
  state: YawRateState,
  nowMonoMs: number | null,
  windowMs: number = YAW_WINDOW_MS,
): YawRateVerdict {
  const now = _fin(nowMonoMs);
  if (now === null || state.count === 0) return _NO_YAW;

  let sum = 0;
  let n = 0;
  for (let k = 0; k < state.count; k++) {
    const idx = (state.head - 1 - k + YAW_RING_SIZE * 2) % YAW_RING_SIZE;
    const age = now - state.ts[idx];
    if (age < 0 || age > windowMs) continue;
    sum += state.rate[idx];
    n++;
  }

  if (n === 0) {
    return { radPerSec: null, reason: 'STALE', samples: 0, polarity: state.polarity };
  }
  if (state.polarity === 0) {
    /* İşaret kanıtlanmadı → jiro YOK gibi davranılır (yanlış yön öğretmektense
       belirsizliğin dürüstçe büyümesi tercih edilir). */
    return { radPerSec: null, reason: 'POLARITY_UNRESOLVED', samples: n, polarity: 0 };
  }

  return {
    radPerSec: state.polarity * (sum / n),
    reason: 'OK',
    samples: n,
    polarity: state.polarity,
  };
}
