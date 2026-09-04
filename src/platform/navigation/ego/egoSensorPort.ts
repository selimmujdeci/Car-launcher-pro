/**
 * egoSensorPort.ts — NAV v3 · L2 · SENSÖR SINIRI (SAF SÖZLEŞME · F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.1/F2.2.
 *
 * SAF: I/O YOK · timer YOK · React YOK · native YOK · saat OKUMAZ.
 *
 * ── NEDEN PORT ────────────────────────────────────────────────────────────
 * L2 **ham sensör/native sağlayıcı SAHİPLENEMEZ** (F2 mimari kilidi 2).
 * `navigator.geolocation`, Capacitor eklentisi, `deviceorientation` event'i
 * veya `watchPosition` L2'de BULUNMAZ. L2 yalnız MEVCUT otoritelerin
 * yayınladığı gözlemi bu sınırdan okur.
 *
 * ── EKSİK SENSÖR BİR HATA DEĞİLDİR ───────────────────────────────────────
 * Her alan `null` olabilir. `null` = "bu sensör bu anda kanıt vermedi" →
 * ilgili güncelleme ATLANIR ve belirsizlik BÜYÜR. Uydurma değer YASAK.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import type { EgoPositionProducer } from './egoModeModel';

/** Tek bir anlık sensör gözlemi — hepsi opsiyonel, hiçbiri uydurulmaz. */
export interface EgoSensorSample {
  /** Gözlemin okunduğu monotonik an. `null` = monotonik saat YOK (fail-closed). */
  readonly nowMonoMs: MonotonicMs | null;

  /* ── Konum (mevcut `gpsService.getLocationEvidence()` otoritesinden) ── */
  readonly lat: number | null;
  readonly lon: number | null;
  /** GNSS bildirilen doğruluk (m). `null` = bilinmiyor → ölçüm reddedilir. */
  readonly accuracyM: number | null;
  /** Fix'in MONOTONİK yaşı (ms). `null` = ölçülemedi. */
  readonly fixAgeMs: number | null;
  /** Konumu şu an kim üretiyor. */
  readonly producer: EgoPositionProducer;
  /** Bu oturumda hiç geçerli fix alındı mı. */
  readonly hasEverFixed: boolean;

  /* ── Yön / hız ── */
  /** GNSS gidiş yönü (derece). `null` = bilinmiyor / durakta güvenilmez. */
  readonly gnssHeadingDeg: number | null;
  /** GNSS Doppler hızı (m/s). `null` = bilinmiyor. */
  readonly gnssSpeedMps: number | null;
  /** Araç bus hızı (m/s) — VDL füzyonundan. `null` = kaynak yok. */
  readonly busSpeedMps: number | null;

  /* ── IMU ── */
  /**
   * Jiro sapma hızı (rad/s, saat yönü pozitif). `null` = jiro kanıtı YOK.
   *
   * **F3'te bağlandı (F2 borcu C1 kapandı).** Abonelik L2'de DEĞİL, runtime
   * kenarındaki `navOrientationFeed`tedir (F2 kilidi K2: L2 ham sağlayıcı
   * sahiplenemez); bu port oradan yalnız SENKRON okur.
   *
   * Üç durumda `null` KALIR ve bu bir arıza DEĞİLDİR:
   *   · cihazda jiroskop yok (`rotationRate` boş),
   *   · düşey eksen güvenilir ölçülemiyor (yerçekimi kapısı),
   *   · izdüşümün İŞARETİ henüz GNSS ile kanıtlanmadı.
   * Jiro yokken EKF `ω = 0` varsayar ve yön süreç gürültüsünü ŞİŞİRİR —
   * sahte kesinlik değil, dürüst belirsizlik.
   */
  readonly yawRateRadPerSec: number | null;
}

/** Hiçbir şey bilmeyen gözlem — fail-closed varsayılan. */
export const UNAVAILABLE_EGO_SAMPLE: EgoSensorSample = {
  nowMonoMs: null,
  lat: null,
  lon: null,
  accuracyM: null,
  fixAgeMs: null,
  producer: 'NONE',
  hasEverFixed: false,
  gnssHeadingDeg: null,
  gnssSpeedMps: null,
  busSpeedMps: null,
  yawRateRadPerSec: null,
};

/** L2'nin sensör dünyasına TEK bağlantısı. */
export interface EgoSensorPort {
  /** Senkron tek okuma. Abonelik AÇMAZ, timer KURMAZ, hiçbir şeyi BAŞLATMAZ. */
  read(): EgoSensorSample;
}

/** Test / boot öncesi. */
export const UNAVAILABLE_EGO_SENSOR_PORT: EgoSensorPort = {
  read: () => UNAVAILABLE_EGO_SAMPLE,
};
