/**
 * egoKalman.ts — NAV v3 · L2 · HATA-DURUMLU EKF ÇEKİRDEĞİ (SAF · F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.2 · v2 §3.1–3.3 · ADR-N06.
 *
 * SAF: I/O YOK · timer YOK · scheduler YOK · React YOK · native/Capacitor YOK ·
 * `Date.now`/`performance.now` YOK · global durum YOK · sensör sahipliği YOK.
 * Zaman ve ölçüm DIŞARIDAN gelir → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DURUM VEKTÖRÜ (v2 §3.1 ile birebir) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   x = [pE, pN, ψ, v, b_ω]ᵀ
 *     pE, pN : yerel ENU teğet düzleminde konum (metre)
 *     ψ      : gidiş yönü (radyan, 0 = KUZEY, saat yönü pozitif)
 *     v      : boylamsal hız (m/s)
 *     b_ω    : jiro sapması (rad/s) — rastgele yürüyüş
 *
 * Süreç modeli:
 *   ṗE = v·sin ψ · ṗN = v·cos ψ · ψ̇ = ω_ölçüm − b_ω · v̇ = a_long · ḃ_ω = 0
 *
 * ── GEODEZİ: İKİNCİ OTORİTE KURULMADI ────────────────────────────────────
 * Teğet düzlem ölçeği, deponun mevcut `navigation/core/geo.ts` haversine
 * modeliyle **AYNI küresel yarıçapı** (R = 6 371 000 m) kullanır. Ayrı bir
 * elipsoid/geodezi modeli EKLENMEDİ — iki farklı ölçek, iki farklı konum
 * demektir.
 *
 * ── YENİ SENSÖR UYDURULMADI ──────────────────────────────────────────────
 * Ölçüm güncellemeleri yalnız depoda GERÇEKTEN var olan kaynaklar içindir:
 * GNSS konum/hız/yön · araç bus hızı · cihaz jiroskopu. Eksik sensör bir
 * hata değildir — o güncelleme ATLANIR ve belirsizlik BÜYÜR.
 *
 * ── REDDEDİLEN ÖLÇÜM BAŞARI SAYILMAZ ─────────────────────────────────────
 * Doğruluk tavanı veya Mahalanobis kapısı bir ölçümü reddederse durum
 * GÜNCELLENMEZ ve `accepted: false` döner. Reddedilen ölçüm "işlendi" gibi
 * sunulamaz (kilit test).
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';

/* ══════════════════════════════════════════════════════════════════════════
   0) BOYUT VE İNDEKSLER
   ══════════════════════════════════════════════════════════════════════════ */

export const EGO_N = 5;
export const IDX_PE = 0;
export const IDX_PN = 1;
export const IDX_PSI = 2;
export const IDX_V = 3;
export const IDX_BW = 4;

/** `navigation/core/geo.ts` ile AYNI küresel yarıçap (ikinci geodezi yok). */
export const EARTH_R_M = 6_371_000;

/** Teğet düzlem yeniden çapalama eşiği (v2 §3.1: > 10 km). */
export const TANGENT_REANCHOR_M = 10_000;

/* ══════════════════════════════════════════════════════════════════════════
   1) AYAR PARAMETRELERİ — v2 §3.2 BAŞLANGIÇ değerleri
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **DÜRÜSTLÜK NOTU (v2 §3.2 ile aynı):** bu sayılar literatür/başlangıç
 * değerleridir, **bizim sahamızdan ölçülmemiştir**. Kalibrasyon
 * `DEVICE_VALIDATION_LEDGER` maddesidir; kalibre edilmeden bu tablo "doğru"
 * SAYILMAZ.
 */
export interface EgoNoiseParams {
  /** Boylamsal ivme süreç gürültüsü (m/s²). */
  readonly sigmaAccel: number;
  /** Jiro gürültüsü (rad/s). */
  readonly sigmaGyro: number;
  /** Jiro sapması rastgele yürüyüşü (rad/s/√s). */
  readonly sigmaGyroBias: number;
  /** Jiro ölçümü YOKKEN yön için uygulanan ek belirsizlik (rad/s). */
  readonly sigmaHeadingNoGyro: number;
  /** GNSS doğruluğu bu değerin altına ŞİŞİRİLMEZ (m) — v2 §3.2 `max(acc, 3)`. */
  readonly gnssAccuracyFloorM: number;
}

export const DEFAULT_EGO_NOISE: EgoNoiseParams = {
  sigmaAccel: 1.0,
  sigmaGyro: (0.5 * Math.PI) / 180,
  sigmaGyroBias: (0.01 * Math.PI) / 180,
  sigmaHeadingNoGyro: (3.0 * Math.PI) / 180,
  gnssAccuracyFloorM: 3,
};

/** GNSS doğruluk tavanı — bunun üstü ÖLÇÜM SAYILMAZ (v2 §3.3). */
export const GNSS_ACCURACY_REJECT_M = 50;

/** χ² kapısı (2 sdb, %99) — v2 §3.3 `d² > 9.21` → reddet. */
export const MAHALANOBIS_GATE_2D = 9.21;

/** ZUPT: araç bus hızı 0 ve |ω| bu eşiğin altındaysa hız ölçümü 0 (v2 §3.3). */
export const ZUPT_YAW_RATE_MAX_RAD = (2 * Math.PI) / 180;
/** ZUPT ölçüm gürültüsü (m/s) — v2 §3.2 `R_zupt = (0.05)²`. */
export const ZUPT_SIGMA_MPS = 0.05;

/** Yön ölçümü ancak bu hızın üstünde GÜVENİLİR (durakta GNSS yönü gürültüdür). */
export const HEADING_TRUST_MIN_MPS = 5 / 3.6;

/* ══════════════════════════════════════════════════════════════════════════
   2) DURUM
   ══════════════════════════════════════════════════════════════════════════ */

export interface EgoKalmanState {
  /** [pE, pN, ψ, v, b_ω] — uzunluk 5. */
  readonly x: Float64Array;
  /** 5×5 kovaryans, satır-öncelikli — uzunluk 25. */
  readonly P: Float64Array;
  /** Teğet düzlem orijini. */
  readonly anchorLat: number;
  readonly anchorLon: number;
  /** Durumun geçerli olduğu monotonik an. */
  readonly tsMonoMs: MonotonicMs;
}

export interface EgoUpdateResult {
  readonly state: EgoKalmanState;
  /** Ölçüm KABUL edildi mi. `false` → durum DEĞİŞMEDİ. */
  readonly accepted: boolean;
  /** Reddedildiyse makine-okur gerekçe. */
  readonly rejectReason: EgoRejectReason | null;
  /** 2B konum güncellemesinde ölçülen Mahalanobis d²; yoksa `null`. */
  readonly mahalanobis: number | null;
}

export type EgoRejectReason =
  | 'BAD_INPUT'
  | 'ACCURACY_CEILING'
  | 'MAHALANOBIS_GATE'
  | 'NOT_APPLICABLE';

/* ══════════════════════════════════════════════════════════════════════════
   3) YARDIMCILAR
   ══════════════════════════════════════════════════════════════════════════ */

function _finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Açıyı `[-π, π)` aralığına sarar. */
export function wrapPi(a: number): number {
  if (!_finite(a)) return 0;
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

/** Enlemde metre/derece (küresel model — `geo.ts` ile aynı R). */
export function metersPerDegLat(): number {
  return (EARTH_R_M * Math.PI) / 180;
}

/** Boylamda metre/derece, verilen enlemde (küresel model). */
export function metersPerDegLon(latDeg: number): number {
  return (EARTH_R_M * Math.PI * Math.cos((latDeg * Math.PI) / 180)) / 180;
}

/** Coğrafi konumu teğet düzlem metrelerine çevirir. */
export function latLonToEN(
  lat: number, lon: number, anchorLat: number, anchorLon: number,
): { e: number; n: number } {
  const e = (lon - anchorLon) * metersPerDegLon(anchorLat);
  const n = (lat - anchorLat) * metersPerDegLat();
  return { e, n };
}

/** Teğet düzlem metrelerini coğrafi konuma çevirir. */
export function enToLatLon(
  e: number, n: number, anchorLat: number, anchorLon: number,
): { lat: number; lon: number } {
  const lat = anchorLat + n / metersPerDegLat();
  const mLon = metersPerDegLon(anchorLat);
  const lon = mLon === 0 ? anchorLon : anchorLon + e / mLon;
  return { lat, lon };
}

/** Durumun coğrafi konumu. */
export function egoLatLon(s: EgoKalmanState): { lat: number; lon: number } {
  return enToLatLon(s.x[IDX_PE], s.x[IDX_PN], s.anchorLat, s.anchorLon);
}

/**
 * Yatay konum belirsizliği (1σ, metre) — kovaryansın konum blokunun izinden.
 * `sqrt(P_EE + P_NN)` **dairesel** 1σ yarıçapının üst sınırıdır; kalite
 * kapıları bunu kullanır (kötümser taraf).
 */
export function egoSigmaHorizontalM(s: EgoKalmanState): number {
  const vEE = s.P[IDX_PE * EGO_N + IDX_PE];
  const vNN = s.P[IDX_PN * EGO_N + IDX_PN];
  const t = vEE + vNN;
  return t > 0 && Number.isFinite(t) ? Math.sqrt(t) : Number.POSITIVE_INFINITY;
}

/** Yön belirsizliği (1σ, radyan). */
export function egoSigmaHeadingRad(s: EgoKalmanState): number {
  const v = s.P[IDX_PSI * EGO_N + IDX_PSI];
  return v > 0 && Number.isFinite(v) ? Math.sqrt(v) : Number.POSITIVE_INFINITY;
}

/** Hız belirsizliği (1σ, m/s). */
export function egoSigmaSpeedMps(s: EgoKalmanState): number {
  const v = s.P[IDX_V * EGO_N + IDX_V];
  return v > 0 && Number.isFinite(v) ? Math.sqrt(v) : Number.POSITIVE_INFINITY;
}

/** Kovaryansı simetrikleştirir (sayısal sürüklenmeye karşı). */
function _symmetrize(P: Float64Array): Float64Array {
  for (let i = 0; i < EGO_N; i++) {
    for (let j = i + 1; j < EGO_N; j++) {
      const m = 0.5 * (P[i * EGO_N + j] + P[j * EGO_N + i]);
      P[i * EGO_N + j] = m;
      P[j * EGO_N + i] = m;
    }
  }
  return P;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) BAŞLATMA
   ══════════════════════════════════════════════════════════════════════════ */

export interface EgoInitInput {
  readonly lat: number;
  readonly lon: number;
  /** GNSS bildirilen doğruluk (m); `null` → kötümser tavan kullanılır. */
  readonly accuracyM: number | null;
  /** Başlangıç yönü (radyan); `null` → tam belirsiz. */
  readonly headingRad: number | null;
  /** Başlangıç hızı (m/s); `null` → 0 kabul edilir ama belirsizliği yüksek. */
  readonly speedMps: number | null;
  readonly tsMonoMs: MonotonicMs;
}

/**
 * İlk fix'ten durum kurar. Geçersiz koordinat → `null` (fail-closed;
 * uydurma başlangıç ÜRETİLMEZ).
 */
export function initEgoState(input: EgoInitInput): EgoKalmanState | null {
  if (!input || !_finite(input.lat) || !_finite(input.lon)) return null;
  if (input.lat < -90 || input.lat > 90 || input.lon < -180 || input.lon > 180) return null;

  const x = new Float64Array(EGO_N);
  const P = new Float64Array(EGO_N * EGO_N);

  const accM = _finite(input.accuracyM) && input.accuracyM > 0
    ? Math.max(input.accuracyM, DEFAULT_EGO_NOISE.gnssAccuracyFloorM)
    : GNSS_ACCURACY_REJECT_M;

  x[IDX_PE] = 0;
  x[IDX_PN] = 0;
  x[IDX_PSI] = _finite(input.headingRad) ? wrapPi(input.headingRad) : 0;
  x[IDX_V] = _finite(input.speedMps) && input.speedMps >= 0 ? input.speedMps : 0;
  x[IDX_BW] = 0;

  P[IDX_PE * EGO_N + IDX_PE] = accM * accM;
  P[IDX_PN * EGO_N + IDX_PN] = accM * accM;
  /* Yön bilinmiyorsa TAM belirsiz: (π/√3)² düzgün dağılımın varyansıdır. */
  const psiSigma = _finite(input.headingRad) ? (20 * Math.PI) / 180 : Math.PI / Math.sqrt(3);
  P[IDX_PSI * EGO_N + IDX_PSI] = psiSigma * psiSigma;
  P[IDX_V * EGO_N + IDX_V] = _finite(input.speedMps) ? 2 * 2 : 10 * 10;
  const bwSigma = (1 * Math.PI) / 180;
  P[IDX_BW * EGO_N + IDX_BW] = bwSigma * bwSigma;

  return {
    x, P,
    anchorLat: input.lat,
    anchorLon: input.lon,
    tsMonoMs: input.tsMonoMs,
  };
}

/**
 * Teğet düzlem orijini araçtan `TANGENT_REANCHOR_M`den uzaklaştıysa yeniden
 * çapalar. **Kovaryans TAŞINIR** (bilgi kaybı yok); yalnız orijin değişir.
 */
export function reanchorIfNeeded(s: EgoKalmanState): EgoKalmanState {
  const d = Math.hypot(s.x[IDX_PE], s.x[IDX_PN]);
  if (!(d > TANGENT_REANCHOR_M)) return s;
  const { lat, lon } = egoLatLon(s);
  const x = Float64Array.from(s.x);
  x[IDX_PE] = 0;
  x[IDX_PN] = 0;
  return { x, P: Float64Array.from(s.P), anchorLat: lat, anchorLon: lon, tsMonoMs: s.tsMonoMs };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) TAHMİN (predict)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Durumu `dtMs` kadar ileri taşır.
 *
 * @param yawRateRadPerSec ölçülen jiro sapma hızı; `null` = jiro YOK →
 *        `ω = 0` varsayılır ve yön süreç gürültüsü ŞİŞİRİLİR
 *        (belirsizlik büyür — sahte kesinlik üretilmez).
 *
 * Negatif/sıfır `dtMs` → durum aynen döner (geriye tahmin YASAK).
 */
export function predictEgo(
  s: EgoKalmanState,
  dtMs: number,
  yawRateRadPerSec: number | null,
  params: EgoNoiseParams = DEFAULT_EGO_NOISE,
): EgoKalmanState {
  if (!s || !_finite(dtMs) || dtMs <= 0) return s;
  const dt = dtMs / 1000;

  const x = Float64Array.from(s.x);
  const psi = x[IDX_PSI];
  const v = x[IDX_V];
  const hasGyro = _finite(yawRateRadPerSec);
  const omega = hasGyro ? (yawRateRadPerSec as number) - x[IDX_BW] : 0;

  /* Durum ilerletme. */
  x[IDX_PE] = x[IDX_PE] + v * Math.sin(psi) * dt;
  x[IDX_PN] = x[IDX_PN] + v * Math.cos(psi) * dt;
  x[IDX_PSI] = wrapPi(psi + omega * dt);
  /* v ve b_ω sabit — değişimleri süreç gürültüsüyle temsil edilir. */

  /* Jakobiyen F = I + dt·A (yalnız sıfır olmayan girdiler). */
  const F = new Float64Array(EGO_N * EGO_N);
  for (let i = 0; i < EGO_N; i++) F[i * EGO_N + i] = 1;
  F[IDX_PE * EGO_N + IDX_PSI] = v * Math.cos(psi) * dt;
  F[IDX_PE * EGO_N + IDX_V] = Math.sin(psi) * dt;
  F[IDX_PN * EGO_N + IDX_PSI] = -v * Math.sin(psi) * dt;
  F[IDX_PN * EGO_N + IDX_V] = Math.cos(psi) * dt;
  F[IDX_PSI * EGO_N + IDX_BW] = -dt;

  /* P' = F·P·Fᵀ + Q */
  const FP = new Float64Array(EGO_N * EGO_N);
  for (let i = 0; i < EGO_N; i++) {
    for (let j = 0; j < EGO_N; j++) {
      let acc = 0;
      for (let k = 0; k < EGO_N; k++) acc += F[i * EGO_N + k] * s.P[k * EGO_N + j];
      FP[i * EGO_N + j] = acc;
    }
  }
  const P = new Float64Array(EGO_N * EGO_N);
  for (let i = 0; i < EGO_N; i++) {
    for (let j = 0; j < EGO_N; j++) {
      let acc = 0;
      for (let k = 0; k < EGO_N; k++) acc += FP[i * EGO_N + k] * F[j * EGO_N + k];
      P[i * EGO_N + j] = acc;
    }
  }

  /* Süreç gürültüsü Q (köşegen — v2 §3.2 başlangıç modeli). */
  const posQ = Math.pow(0.5 * params.sigmaAccel * dt * dt, 2);
  const psiSigmaRate = hasGyro ? params.sigmaGyro : params.sigmaHeadingNoGyro;
  P[IDX_PE * EGO_N + IDX_PE] += posQ;
  P[IDX_PN * EGO_N + IDX_PN] += posQ;
  P[IDX_PSI * EGO_N + IDX_PSI] += Math.pow(psiSigmaRate * dt, 2);
  P[IDX_V * EGO_N + IDX_V] += Math.pow(params.sigmaAccel * dt, 2);
  P[IDX_BW * EGO_N + IDX_BW] += params.sigmaGyroBias * params.sigmaGyroBias * dt;

  return {
    x, P: _symmetrize(P),
    anchorLat: s.anchorLat,
    anchorLon: s.anchorLon,
    tsMonoMs: ((s.tsMonoMs as number) + dtMs) as MonotonicMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   6) GÜNCELLEME (update)
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek boyutlu (skaler) ölçüm güncellemesi. `H` seyrek: tek indeks, katsayı 1. */
function _updateScalar(
  s: EgoKalmanState, idx: number, innovation: number, r: number,
): EgoKalmanState {
  const S = s.P[idx * EGO_N + idx] + r;
  if (!(S > 0) || !Number.isFinite(S)) return s;

  /* K = P·Hᵀ / S → sütun idx */
  const K = new Float64Array(EGO_N);
  for (let i = 0; i < EGO_N; i++) K[i] = s.P[i * EGO_N + idx] / S;

  const x = Float64Array.from(s.x);
  for (let i = 0; i < EGO_N; i++) x[i] += K[i] * innovation;
  x[IDX_PSI] = wrapPi(x[IDX_PSI]);

  /* P' = (I − K·H)·P */
  const P = new Float64Array(EGO_N * EGO_N);
  for (let i = 0; i < EGO_N; i++) {
    for (let j = 0; j < EGO_N; j++) {
      P[i * EGO_N + j] = s.P[i * EGO_N + j] - K[i] * s.P[idx * EGO_N + j];
    }
  }
  return { x, P: _symmetrize(P), anchorLat: s.anchorLat, anchorLon: s.anchorLon, tsMonoMs: s.tsMonoMs };
}

/**
 * GNSS 2B konum güncellemesi — doğruluk tavanı + Mahalanobis kapısı ile.
 *
 * Reddedilirse durum **DEĞİŞMEZ** ve `accepted: false` döner.
 */
export function updateEgoPosition(
  s: EgoKalmanState,
  lat: number, lon: number, accuracyM: number | null,
  params: EgoNoiseParams = DEFAULT_EGO_NOISE,
): EgoUpdateResult {
  const fail = (reason: EgoRejectReason, d2: number | null = null): EgoUpdateResult =>
    ({ state: s, accepted: false, rejectReason: reason, mahalanobis: d2 });

  if (!s || !_finite(lat) || !_finite(lon)) return fail('BAD_INPUT');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return fail('BAD_INPUT');
  /* Doğruluk BİLİNMİYORSA ölçüm kabul edilmez — kötümserlik fail-closed'dır. */
  if (!_finite(accuracyM) || (accuracyM as number) <= 0) return fail('BAD_INPUT');
  if ((accuracyM as number) > GNSS_ACCURACY_REJECT_M) return fail('ACCURACY_CEILING');

  const acc = Math.max(accuracyM as number, params.gnssAccuracyFloorM);
  const r = acc * acc;

  const { e, n } = latLonToEN(lat, lon, s.anchorLat, s.anchorLon);
  const yE = e - s.x[IDX_PE];
  const yN = n - s.x[IDX_PN];

  /* S = H·P·Hᵀ + R (2×2, konum bloku). */
  const s00 = s.P[IDX_PE * EGO_N + IDX_PE] + r;
  const s01 = s.P[IDX_PE * EGO_N + IDX_PN];
  const s10 = s.P[IDX_PN * EGO_N + IDX_PE];
  const s11 = s.P[IDX_PN * EGO_N + IDX_PN] + r;
  const det = s00 * s11 - s01 * s10;
  if (!(Math.abs(det) > 1e-12) || !Number.isFinite(det)) return fail('BAD_INPUT');

  const i00 = s11 / det, i01 = -s01 / det, i10 = -s10 / det, i11 = s00 / det;
  const d2 = yE * (i00 * yE + i01 * yN) + yN * (i10 * yE + i11 * yN);
  if (!Number.isFinite(d2)) return fail('BAD_INPUT');
  if (d2 > MAHALANOBIS_GATE_2D) return fail('MAHALANOBIS_GATE', d2);

  /* K = P·Hᵀ·S⁻¹ (5×2) */
  const x = Float64Array.from(s.x);
  const K = new Float64Array(EGO_N * 2);
  for (let i = 0; i < EGO_N; i++) {
    const pE = s.P[i * EGO_N + IDX_PE];
    const pN = s.P[i * EGO_N + IDX_PN];
    K[i * 2 + 0] = pE * i00 + pN * i10;
    K[i * 2 + 1] = pE * i01 + pN * i11;
  }
  for (let i = 0; i < EGO_N; i++) x[i] += K[i * 2 + 0] * yE + K[i * 2 + 1] * yN;
  x[IDX_PSI] = wrapPi(x[IDX_PSI]);

  /* P' = (I − K·H)·P */
  const P = new Float64Array(EGO_N * EGO_N);
  for (let i = 0; i < EGO_N; i++) {
    for (let j = 0; j < EGO_N; j++) {
      P[i * EGO_N + j] = s.P[i * EGO_N + j]
        - K[i * 2 + 0] * s.P[IDX_PE * EGO_N + j]
        - K[i * 2 + 1] * s.P[IDX_PN * EGO_N + j];
    }
  }

  return {
    state: { x, P: _symmetrize(P), anchorLat: s.anchorLat, anchorLon: s.anchorLon, tsMonoMs: s.tsMonoMs },
    accepted: true,
    rejectReason: null,
    mahalanobis: d2,
  };
}

/** Hız ölçümü güncellemesi (GNSS Doppler · araç bus · ZUPT). */
export function updateEgoSpeed(
  s: EgoKalmanState, speedMps: number, sigmaMps: number,
): EgoUpdateResult {
  if (!s || !_finite(speedMps) || speedMps < 0 || !_finite(sigmaMps) || sigmaMps <= 0) {
    return { state: s, accepted: false, rejectReason: 'BAD_INPUT', mahalanobis: null };
  }
  const next = _updateScalar(s, IDX_V, speedMps - s.x[IDX_V], sigmaMps * sigmaMps);
  /* Negatif hız fiziksel değildir — kırp (durum tutarlılığı). */
  if (next.x[IDX_V] < 0) next.x[IDX_V] = 0;
  return { state: next, accepted: true, rejectReason: null, mahalanobis: null };
}

/**
 * Yön (heading) ölçümü güncellemesi.
 *
 * **Durakta GNSS yönü gürültüdür**: `HEADING_TRUST_MIN_MPS` altındaki hızda
 * ölçüm KABUL EDİLMEZ (`NOT_APPLICABLE`) — yanlış yön, yanlış eşleşme demektir.
 */
export function updateEgoHeading(
  s: EgoKalmanState, headingRad: number, sigmaRad: number, currentSpeedMps: number | null,
): EgoUpdateResult {
  if (!s || !_finite(headingRad) || !_finite(sigmaRad) || sigmaRad <= 0) {
    return { state: s, accepted: false, rejectReason: 'BAD_INPUT', mahalanobis: null };
  }
  const v = _finite(currentSpeedMps) ? (currentSpeedMps as number) : s.x[IDX_V];
  if (!(v >= HEADING_TRUST_MIN_MPS)) {
    return { state: s, accepted: false, rejectReason: 'NOT_APPLICABLE', mahalanobis: null };
  }
  const innovation = wrapPi(headingRad - s.x[IDX_PSI]);
  return {
    state: _updateScalar(s, IDX_PSI, innovation, sigmaRad * sigmaRad),
    accepted: true, rejectReason: null, mahalanobis: null,
  };
}

/**
 * ZUPT — araç bus hızı tam 0 ve jiro sakinse hız ölçümü 0 kabul edilir
 * (v2 §3.3). **Hayalet hız** (durakta GNSS'in ürettiği sahte hareket) burada
 * ölür.
 *
 * Koşullar sağlanmazsa `NOT_APPLICABLE` — zorla uygulanmaz.
 */
export function applyZupt(
  s: EgoKalmanState, busSpeedMps: number | null, yawRateRadPerSec: number | null,
): EgoUpdateResult {
  if (!s) return { state: s, accepted: false, rejectReason: 'BAD_INPUT', mahalanobis: null };
  if (!_finite(busSpeedMps) || busSpeedMps !== 0) {
    return { state: s, accepted: false, rejectReason: 'NOT_APPLICABLE', mahalanobis: null };
  }
  if (_finite(yawRateRadPerSec) && Math.abs(yawRateRadPerSec as number) >= ZUPT_YAW_RATE_MAX_RAD) {
    return { state: s, accepted: false, rejectReason: 'NOT_APPLICABLE', mahalanobis: null };
  }
  return updateEgoSpeed(s, 0, ZUPT_SIGMA_MPS);
}
