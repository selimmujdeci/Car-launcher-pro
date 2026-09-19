/**
 * consumerNotificationPolicy — TÜKETİCİ bildirimi GÖNDERİLİR Mİ? (F5.2)
 *
 * ── YENİ OTORİTE KURULMADI ───────────────────────────────────────────────
 * Hüküm otoritesi F2.2 `buildVehicleHealthSummary` (o da `evidenceModel`
 * `judge`/`Verdict` ve `vehicleTelemetryFreshness` üstünde durur). Bu dosya
 * YENİ BİR SAĞLIK/SEVERITY MOTORU DEĞİLDİR: mevcut hükmü alır ve tek bir
 * soruyu yanıtlar — "bu, kullanıcının TELEFONUNU TİTRETMEYİ hak ediyor mu?"
 * Yeni eşik, yeni enum, yeni severity tablosu ÜRETİLMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 *
 * ── NEDEN AYRI BİR KAPI VAR ──────────────────────────────────────────────
 * Ekranda göstermek ile bildirim atmak AYNI ÇITA DEĞİLDİR. Uygulama açıkken
 * "akü ölçümü güncel değil" satırı yararlıdır; aynı şeyi gece 03:00'te push
 * olarak atmak zarardır. Bu kapı yalnız DARALTIR — hiçbir koşulda hükmü
 * yükseltmez.
 *
 * ── TEMEL İLKE ───────────────────────────────────────────────────────────
 * KANITSIZ BİLDİRİM YOKTUR. Bilinmeyen, bayat veya çevrimdışı durum bir
 * ARIZA İDDİASI DEĞİLDİR (§8/§9).
 */

import type { VehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

/**
 * Bildirim gönderilmeme sebepleri. Hepsi GÖZLEMLENEBİLİR olmalıdır ki
 * "neden bildirim gelmedi?" sorusu tahminle değil kayıtla yanıtlansın.
 */
export type NotificationSkipReason =
  | 'NO_HEALTH_READ'        // sağlık henüz okunmadı (LOADING ≠ kanıt yok)
  | 'NO_EVIDENCE'           // hüküm kanıtsız — yeşile de kırmızıya de boyanmaz
  | 'HEALTHY'               // kanıtlı sağlıklı
  | 'NOT_LIVE'              // hüküm bayat/çevrimdışı → arıza iddiası değil
  | 'WARNING_NOT_ACTIONABLE'// uyarı var ama araç bir arıza kodu bildirmedi
  | 'DUPLICATE';            // aynı durum için zaten bildirildi

export interface ConsumerNotificationInput {
  readonly vehicleId: string;
  /** Kullanıcıya gösterilecek araç adı/plakası. Yoksa `null` — UYDURULMAZ. */
  readonly vehicleLabel: string | null;
  /** F2.2 projeksiyonu. `null` = HENÜZ OKUNMADI (kanıt yok ile aynı şey değil). */
  readonly health: VehicleHealthSummary | null;
  /** Bu araç için en son gönderilen bildirimin dedupe anahtarı (yoksa `null`). */
  readonly lastSentKey: string | null;
}

export interface ConsumerNotification {
  readonly title: string;
  readonly body: string;
  /** Tüketici yüzeyi — filo paneli DEĞİL (§8). */
  readonly url: '/kumanda';
  /** Aynı durumun üst üste yığılmasını engelleyen tarayıcı etiketi. */
  readonly tag: string;
  readonly urgent: boolean;
  /** Bildirim HANGİ araca ait — çok araçlı hesapta karışmaması için (§12). */
  readonly vehicleId: string;
}

export type ConsumerNotificationDecision =
  | { readonly send: false; readonly reason: NotificationSkipReason; readonly dedupeKey: string | null }
  | { readonly send: true;  readonly notification: ConsumerNotification; readonly dedupeKey: string };

/* ── Dedupe kimliği ────────────────────────────────────────────────────── */

/**
 * Aynı DURUM için tek bildirim.
 *
 * Anahtar DURUMUN kimliğinden türer, ÖLÇÜM ANINDAN değil: telemetri 5 sn'de
 * bir gelse de durum değişmediyse anahtar AYNI kalır ve ikinci bildirim
 * gönderilmez. `measuredAt` bilinçli olarak DIŞARIDADIR — onu katmak her
 * ölçümü "yeni olay" yapardı (F5.2 §10).
 *
 * Yeni bir "bildirim geçmişi otoritesi" KURULMAZ: anahtar saf bir türevdir,
 * çağıran onu mevcut kalıcılığında saklar.
 */
export function buildDedupeKey(
  vehicleId: string,
  health: VehicleHealthSummary,
): string {
  const counted = health.evidence
    .filter((e) => e.countedInVerdict)
    .map((e) => `${e.id}:${e.verdict}`)
    .sort()
    .join(',');
  const codes = health.dtcs.map((d) => d.code).sort().join(',');
  return `${vehicleId}|${health.verdict}|${counted}|${codes}`;
}

/* ── Karar ─────────────────────────────────────────────────────────────── */

/** Hüküm CANLI kanıta mı dayanıyor? Bayat/çevrimdışı hüküm arıza iddiası değildir. */
function isLiveVerdict(health: VehicleHealthSummary): boolean {
  return health.freshness === 'LIVE';
}

/**
 * Araç GERÇEKTEN bir arıza kodu bildirdi mi?
 *
 * `WARNING` için kullanılır: eşik uyarısı (ör. sıcaklık sınırda) uygulamada
 * görünür ama telefonu titretmez; araç bir DTC bildirdiyse kullanıcı eylemi
 * (servise götürme) GEREKİR — bildirim adayı olur.
 */
function hasActionableDtc(health: VehicleHealthSummary): boolean {
  return health.dtcs.some((d) => d.severity === 'critical' || d.severity === 'warning');
}

/**
 * Tüketici bildirimi kararı.
 *
 * Sıra ÖNEMLİ: önce "kanıt var mı", sonra "canlı mı", en son "ne kadar ciddi".
 * Böylece kanıtsız/bayat hiçbir durum ciddiyet dalına ULAŞAMAZ.
 */
export function decideConsumerNotification(
  input: ConsumerNotificationInput,
): ConsumerNotificationDecision {
  const { vehicleId, vehicleLabel, health, lastSentKey } = input;

  /* LOADING ≠ "kanıt yok": henüz okunmamış sağlıktan hüküm çıkarılmaz. */
  if (health === null) {
    return { send: false, reason: 'NO_HEALTH_READ', dedupeKey: null };
  }

  const dedupeKey = buildDedupeKey(vehicleId, health);

  if (health.verdict === 'NO_EVIDENCE') {
    return { send: false, reason: 'NO_EVIDENCE', dedupeKey };
  }
  if (health.verdict === 'VERIFIED') {
    return { send: false, reason: 'HEALTHY', dedupeKey };
  }

  /* BAYAT/ÇEVRİMDIŞI HÜKÜM ARIZA DEĞİLDİR (§9). Araç çevrimdışı diye
     "aracınızda sorun var" demek, ölçülmemiş şeyi iddia etmektir. */
  if (!isLiveVerdict(health)) {
    return { send: false, reason: 'NOT_LIVE', dedupeKey };
  }

  if (health.verdict === 'WARNING' && !hasActionableDtc(health)) {
    return { send: false, reason: 'WARNING_NOT_ACTIONABLE', dedupeKey };
  }

  /* Aynı durum için ikinci kez bildirim YOK. */
  if (lastSentKey !== null && lastSentKey === dedupeKey) {
    return { send: false, reason: 'DUPLICATE', dedupeKey };
  }

  const critical = health.verdict === 'CRITICAL';
  /* Araç adı bilinmiyorsa UYDURULMAZ; nötr sözcük kullanılır. */
  const label = vehicleLabel && vehicleLabel.trim().length > 0
    ? vehicleLabel.trim()
    : 'Aracınız';

  return {
    send: true,
    dedupeKey,
    notification: {
      title: critical ? `${label} — dikkat gerekiyor` : `${label} — kontrol önerilir`,
      /* Gövde F2.2'nin KENDİ cümlesidir; burada yeni metin üretilmez. */
      body: health.headline,
      url: '/kumanda',
      /* Etiket dedupe anahtarından türer → aynı durum tarayıcıda YIĞILMAZ. */
      tag: `health-${dedupeKey}`,
      urgent: critical,
      vehicleId,
    },
  };
}
