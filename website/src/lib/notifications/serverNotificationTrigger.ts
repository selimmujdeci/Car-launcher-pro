/**
 * serverNotificationTrigger — TÜKETİCİ bildiriminin SUNUCU TARAFI çekirdeği (F5.2B).
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * Bildirimin amacı kullanıcı uygulamayı AÇMADAN haberdar olmasıdır. Bu yüzden
 * karar tarayıcıda veriLEMEZ. Tek mevcut tetikleyici
 * `vehicleStore.startWatchdog` idi: tarayıcıda çalışır, Authorization taşımaz
 * ve sekme kapalıyken HİÇ çalışmaz — yani bildirim otoritesi OLAMAZ.
 *
 * ── İKİNCİ KARAR MOTORU YOK ──────────────────────────────────────────────
 * Bu dosya YENİ eşik/severity/health kuralı ÜRETMEZ. Üç MEVCUT otoriteyi
 * sırayla çağırır:
 *   1. `buildVehicleFreshness`        — tazelik otoritesi
 *   2. `buildVehicleHealthSummary`    — F2.2 sağlık hükmü
 *   3. `decideConsumerNotification`   — F5.2 bildirim politikası (yalnız daraltır)
 * Sunucu tarafında "temp > X", "DTC varsa critical" gibi kural YENİDEN
 * YAZILMAZ; yazılsaydı PWA ile sunucu zamanla ayrışır ve kullanıcı ekranda
 * başka, bildirimde başka bir gerçek görürdü.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · Supabase YOK.
 * Bu sayede hem Next tarafında hem Deno Edge Function içinde AYNI kod koşar.
 *
 * ── OLAY YAŞAM DÖNGÜSÜ (§5) ──────────────────────────────────────────────
 * Aynı durum her heartbeat'te bildirim ÜRETMEZ. Bildirim, "bildirilebilir
 * olmayan" → "bildirilebilir" GEÇİŞİNDE üretilir:
 *
 *   uygun değil        → RESOLVED (açık olay varsa kapanır)
 *   uygun + aynı kimlik→ DEDUPED  (ikinci bildirim yok)
 *   uygun + yeni kimlik→ NOTIFY   (gerçek yeni olay)
 *
 * Sorun düzelip SONRA gerçek kanıtla yeniden oluşursa tekrar bildirilir:
 * kapanışta saklanan kimlik temizlenir. Zaman damgasının değişmesi TEK BAŞINA
 * yeni olay DEĞİLDİR — kimlik durumdan türer, ölçüm anından değil (F5.2 §10).
 */

import {
  buildVehicleFreshness,
  type TelemetryRow,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  buildVehicleHealthSummary,
  type VehicleHealthSummary,
} from '@/lib/diagnostics/vehicleHealth';
import type { DtcOutcome, VoltageOutcome } from '@/lib/diagnostics/dtcResultContract';
import {
  decideConsumerNotification,
  type ConsumerNotification,
  type NotificationSkipReason,
} from './consumerNotificationPolicy';

/* ── Girdi ─────────────────────────────────────────────────────────────── */

export interface ServerTriggerInput {
  /** Değerlendirme anı — ÇAĞIRAN verir (bu modül saat okumaz). */
  readonly now: number;
  readonly vehicleId: string;
  /** Plaka/ad. Bilinmiyorsa `null` — UYDURULMAZ. */
  readonly vehicleLabel: string | null;
  /** `vehicle_telemetry` satırı. Satır YOKSA `null`. */
  readonly telemetryRow: TelemetryRow | null;
  /**
   * Satır OKUNABİLDİ mi? `false` = sorgu düştü/yetki yok.
   * "okunamadı" ile "hiç yok" AYNI ŞEY DEĞİLDİR (fail-closed).
   */
  readonly telemetryReadable: boolean;
  /** Aracın EN SON teşhis okuması; hiç yoksa `null`. */
  readonly dtc: DtcOutcome | null;
  /** Aracın EN SON voltaj ölçümü; hiç yoksa `null`. */
  readonly voltage: VoltageOutcome | null;
  /**
   * Bu araç için AÇIK olayın kimliği (dayanıklı depodan okunur).
   * Açık olay yoksa `null`. Bellek içi Set / localStorage / modül singleton
   * BU ALANIN KAYNAĞI OLAMAZ — süreç yeniden başlayınca dedupe kaybolurdu.
   */
  readonly openIncidentKey: string | null;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

export type ServerTriggerOutcome =
  /** Bildirim koşulu yok. Açık olay varsa KAPANIR (`clearIncident`). */
  | {
      readonly kind: 'NOT_ELIGIBLE';
      readonly reason: NotificationSkipReason;
      readonly clearIncident: boolean;
      readonly health: VehicleHealthSummary | null;
    }
  /** Aynı olay zaten bildirildi — ikinci bildirim YOK. */
  | {
      readonly kind: 'DEDUPED';
      readonly incidentKey: string;
      readonly health: VehicleHealthSummary;
    }
  /** Gerçek yeni olay — gönderim adayı. */
  | {
      readonly kind: 'NOTIFY';
      readonly incidentKey: string;
      readonly notification: ConsumerNotification;
      readonly health: VehicleHealthSummary;
    };

/* ── Değerlendirme ─────────────────────────────────────────────────────── */

/**
 * Tek aracın SUNUCU TARAFI değerlendirmesi.
 *
 * Hiçbir ağ/DB çağrısı yapmaz: çağıran satırları okur, bu fonksiyon hükmü
 * verir, çağıran sonucu uygular. Böylece karar mantığı Edge Function'dan
 * BAĞIMSIZ test edilebilir.
 */
export function evaluateVehicleNotification(
  input: ServerTriggerInput,
): ServerTriggerOutcome {
  const {
    now, vehicleId, vehicleLabel, telemetryRow, telemetryReadable,
    dtc, voltage, openIncidentKey,
  } = input;

  /* 1 — TAZELİK OTORİTESİ (kopya yok). */
  const freshness = buildVehicleFreshness({
    now,
    row: telemetryRow,
    readable: telemetryReadable,
  });

  /* 2 — F2.2 SAĞLIK HÜKMÜ (kopya yok). */
  const health = buildVehicleHealthSummary({ now, freshness, dtc, voltage });

  /* 3 — F5.2 BİLDİRİM POLİTİKASI (kopya yok, yalnız daraltır). */
  const decision = decideConsumerNotification({
    vehicleId,
    vehicleLabel,
    health,
    lastSentKey: openIncidentKey,
  });

  if (!decision.send) {
    /* DUPLICATE, "uygun ama zaten bildirildi" demektir — olay HÂLÂ AÇIKTIR,
       kapatılmaz. Diğer tüm sebepler olayın artık geçerli olmadığını
       gösterir → açık olay varsa kapanır ve sorun tekrarlarsa YENİDEN
       bildirilebilir hâle gelir (§5). */
    if (decision.reason === 'DUPLICATE') {
      return {
        kind: 'DEDUPED',
        incidentKey: decision.dedupeKey as string,
        health,
      };
    }
    return {
      kind: 'NOT_ELIGIBLE',
      reason: decision.reason,
      clearIncident: openIncidentKey !== null,
      health,
    };
  }

  return {
    kind: 'NOTIFY',
    incidentKey: decision.dedupeKey,
    notification: decision.notification,
    health,
  };
}

/* ── Teslimat sonucu (§11) ─────────────────────────────────────────────── */

/**
 * Gönderim denemesinin sonucu.
 *
 * `DELIVERED` / `SEEN` BİLİNÇLİ OLARAK YOKTUR: Web Push protokolü push
 * servisinin mesajı KABUL ettiğini söyler; kullanıcının cihazına ulaştığını
 * ya da GÖRDÜĞÜNÜ söylemez. Olmayan kanıt üretilmez (§8 · §11).
 */
export type DeliveryOutcome =
  | 'NOT_ELIGIBLE'         // politika gönderme dedi
  | 'DEDUPED'              // aynı olay zaten bildirildi
  | 'NO_RECIPIENT'         // araca bağlı kullanıcı/abonelik yok
  | 'QUEUED'               // gönderime hazırlandı
  | 'SENT'                 // push servisi KABUL etti (görüldü DEĞİL)
  | 'FAILED'               // gönderim düştü
  | 'EXPIRED_SUBSCRIPTION';// 404/410 → abonelik temizlenmeli
