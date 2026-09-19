/**
 * consumer-notify-scan — TÜKETİCİ bildiriminin SUNUCU TARAFI tetikleyicisi (F5.2B).
 *
 * ⚠️ YAZILDI, DEPLOY EDİLMEDİ.
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * Bildirimin amacı kullanıcı uygulamayı AÇMADAN haberdar olmasıdır. Tek
 * mevcut tetikleyici `vehicleStore.startWatchdog` idi: tarayıcıda koşar,
 * Authorization taşımaz ve sekme kapalıyken HİÇ çalışmaz — bildirim otoritesi
 * OLAMAZ. Bu fonksiyon o zinciri sunucuya taşır.
 *
 * ── İKİNCİ KARAR MOTORU YOK ──────────────────────────────────────────────
 * Hüküm burada YENİDEN YAZILMAZ. `@/lib/notifications/serverNotificationTrigger`
 * üzerinden PWA ile AYNI saf zincir koşar:
 *   buildVehicleFreshness → buildVehicleHealthSummary → decideConsumerNotification
 *
 * ÖLÇÜLDÜ (2026-09-19, Deno 2.8.2): `deno check` bu zinciri TEMİZ doğruladı ve
 * `deno run` gerçekten çalıştırdı. Tek gereksinim `deno.json`daki
 * `sloppy-imports` + `@/` eşlemesidir: zincirin iç importları uzantısız
 * (Next/Node stili), Deno ise açık `.ts` ister.
 *
 * ── ÇALIŞTIRMA ───────────────────────────────────────────────────────────
 * `retention-manager` ile AYNI desen: Supabase Cron veya dahili servis çağırır,
 * yetki `service_role` bearer'dır. Tarayıcı bu ucu tetikleyemez.
 *
 * POST /functions/v1/consumer-notify-scan
 * Header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * ── HER HEARTBEAT'TE PUSH YOK ────────────────────────────────────────────
 * Tarama periyodiktir ve karar DURUM GEÇİŞİNE bakar. Aynı olay için ikinci
 * bildirim `consumer_notification_state` defterindeki açık olay kimliğiyle
 * engellenir (bellek içi Set / singleton KULLANILMAZ — süreç yeniden
 * başlayınca dedupe kaybolurdu).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  evaluateVehicleNotification,
  type DeliveryOutcome,
} from '@/lib/notifications/serverNotificationTrigger';
import {
  durableScanToCurrentDtcEvidence,
  rowToDiagnosticScanRecord,
  type DiagnosticScanRow,
} from '@/lib/diagnostics/diagnosticHistory';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
/** Bildirimi fiilen gönderen fonksiyon (alıcıları O çözer). */
const PUSH_FN_URL = `${SUPABASE_URL}/functions/v1/consumer-push-notify`;

/** Bir taramada işlenecek azami araç — sınırsız tarama yok (bounded). */
const SCAN_LIMIT = 200;

/**
 * `vehicle_telemetry` satırının BU FONKSİYONUN okuduğu alanları.
 *
 * Tipsiz supabase-js istemcisi satırları birleşim tipiyle döndürür; şekil
 * BURADA açıkça yazılır ki alan adı sapması derlemede yakalansın (sessiz
 * `undefined` yerine hata).
 */
interface TelemetryRowDb {
  vehicle_id: string;
  updated_at: string | null;
  observed_at: string | null;
  received_at: string | null;
  gps_observed_at: string | null;
  obd_observed_at: string | null;
  health_observed_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  speed: number | null;
  rpm: number | null;
  temp: number | null;
  fuel: number | null;
  telemetry_source: string | null;
  location_source: string | null;
}

interface VehicleLabelRow { plate: string | null; name: string | null }
interface NotifyStateRow  { open_incident_key: string | null }

/** `vehicle_diagnostic_scans`ten okunan kolonlar (en az yetki ilkesi). */
const SCAN_COLUMNS =
  'vehicle_id, source_command_id, status, measured_at, completed_at, partial, ' +
  'completeness, permanent_supported, dtcs, failure_reason';

/**
 * Olay kimliğini OPAK özete çevirir.
 *
 * Saf dedupe anahtarı ham DTC kodlarını içerir; defter TEŞHİS İÇERİĞİ
 * TAŞIMAMALIDIR (§10). Eşitlik karşılaştırması için özet yeterlidir.
 */
async function digest(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const hash  = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  /* Yalnız sunucu/iç servis. Tarayıcı bildirim TETİKLEYEMEZ: abonelik KAYDI
     ayrı bir capability'dir, bildirim GÖNDERİMİ ayrı. */
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const tally: Record<string, number> = {};
  const note = (o: DeliveryOutcome | 'NOTIFY') => { tally[o] = (tally[o] ?? 0) + 1; };

  /* Yalnız TELEMETRİSİ OLAN araçlar taranır: satırı hiç olmayan araç için
     değerlendirilecek kanıt da yoktur. */
  const { data: rows, error } = await db
    .from('vehicle_telemetry')
    .select('vehicle_id, updated_at, observed_at, received_at, gps_observed_at, ' +
            'obd_observed_at, health_observed_at, lat, lng, accuracy_m, speed, rpm, ' +
            'temp, fuel, telemetry_source, location_source')
    .order('updated_at', { ascending: false })
    .limit(SCAN_LIMIT)
    .returns<TelemetryRowDb[]>();

  if (error) {
    /* Okunamadı ≠ kanıt yok: hiçbir hüküm verilmez, tarama düşer. */
    console.error('[consumer-notify-scan] telemetri okunamadı:', error.message);
    return new Response(JSON.stringify({ ok: false, reason: 'telemetry_unreadable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  for (const row of rows ?? []) {
    const vehicleId = row.vehicle_id;

    const [{ data: state }, { data: vehicle }, scanRes] = await Promise.all([
      db.from('consumer_notification_state')
        .select('open_incident_key').eq('vehicle_id', vehicleId)
        .maybeSingle().returns<NotifyStateRow>(),
      db.from('vehicles').select('plate, name').eq('id', vehicleId)
        .maybeSingle().returns<VehicleLabelRow>(),
      /* EN SON tarama — araç kapsamlı. Tablo bu kurulumda YOKSA (080
         uygulanmadı) sorgu hata döner; bu "arıza yok" DEĞİL, "kaynak yok"tur
         ve aşağıda `null` olarak geçilir. */
      db.from('vehicle_diagnostic_scans')
        .select(SCAN_COLUMNS)
        .eq('vehicle_id', vehicleId)
        .order('measured_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle().returns<DiagnosticScanRow>(),
    ]);

    /* Kaynak yok / okunamadı → kanıt YOK. Sessiz "sağlıklı" ÜRETİLMEZ. */
    const latestScan = scanRes.error
      ? null
      : rowToDiagnosticScanRecord(scanRes.data);

    const outcome = evaluateVehicleNotification({
      now,
      vehicleId,
      vehicleLabel: vehicle?.plate ?? vehicle?.name ?? null,
      telemetryRow: {
        updatedAt: row.updated_at, observedAt: row.observed_at,
        receivedAt: row.received_at, gpsObservedAt: row.gps_observed_at,
        obdObservedAt: row.obd_observed_at, healthObservedAt: row.health_observed_at,
        lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m,
        speed: row.speed, rpm: row.rpm, temp: row.temp, fuel: row.fuel,
        telemetrySource: row.telemetry_source, locationSource: row.location_source,
      },
      telemetryReadable: true,
      /* ── F5.4 · TEŞHİS KANITI ARTIK BAĞLI (ama GÜNCELLİK KAPISINDAN) ──────
       * Kalıcı geçmişteki son satır KÖRLEMESİNE güncel teşhis sayılmaz.
       * `durableScanToCurrentDtcEvidence` kanonik güven penceresini
       * (`DTC_HEALTH_MAX_AGE_MS`) uygular: pencere aşılmışsa sonuç `STALE`
       * olur ve F2.2 onu `NO_EVIDENCE` sayar. Yani ESKİ bir arıza kodu her
       * cron turunda yeniden bildirim ÜRETEMEZ.
       *
       * Kaynak yoksa/okunamazsa `null` kalır: "okunamadı" ile "arıza yok"
       * AYNI ŞEY DEĞİLDİR ve `null` hiçbir hüküm üretmez. */
      dtc: durableScanToCurrentDtcEvidence(latestScan, now),
      /* Voltajın kalıcı geçmişi HÂLÂ YOK — uydurulmaz. */
      voltage: null,
      openIncidentKey: state?.open_incident_key ?? null,
    });

    if (outcome.kind === 'DEDUPED') { note('DEDUPED'); continue; }

    if (outcome.kind === 'NOT_ELIGIBLE') {
      note('NOT_ELIGIBLE');
      /* Olay kapanır → aynı sorun gerçek kanıtla tekrarlarsa YENİDEN bildirilir. */
      if (outcome.clearIncident) {
        await db.from('consumer_notification_state').upsert({
          vehicle_id: vehicleId, open_incident_key: null, opened_at: null,
          last_outcome: 'NOT_ELIGIBLE', updated_at: new Date(now).toISOString(),
        }, { onConflict: 'vehicle_id' });
      }
      continue;
    }

    /* NOTIFY — gönderimi ALICI ÇÖZMEYEN bu fonksiyon yapmaz; alıcıları
       `consumer-push-notify` kanonik ilişkiden (vehicle_pairings ∪ owner_id)
       çözer. İstemci ya da bu tarama alıcı listesi DAYATMAZ (§8). */
    const key = await digest(outcome.incidentKey);
    let delivery: DeliveryOutcome = 'QUEUED';
    try {
      const res = await fetch(PUSH_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          event: 'health_alert',
          vehicleId,
          /* Metin POLİTİKANINDIR (F2.2 cümlesi) — taşıyıcı yeni metin üretmez.
             Ham DTC/VIN/ECU verisi BİLİNÇLİ OLARAK YOK (kilit ekranı gizliliği). */
          payload: {
            title:  outcome.notification.title,
            body:   outcome.notification.body,
            tag:    outcome.notification.tag,
            urgent: outcome.notification.urgent,
          },
        }),
      });
      /* `SENT` = push servisi KABUL etti. `DELIVERED`/`SEEN` ÜRETİLMEZ —
         Web Push böyle bir kanıt vermez (§11). */
      delivery = res.ok ? 'SENT' : 'FAILED';
    } catch {
      delivery = 'FAILED';
    }
    note(delivery);

    await db.from('consumer_notification_state').upsert({
      vehicle_id:        vehicleId,
      open_incident_key: key,
      opened_at:         new Date(now).toISOString(),
      last_notified_at:  new Date(now).toISOString(),
      last_outcome:      delivery,
      updated_at:        new Date(now).toISOString(),
    }, { onConflict: 'vehicle_id' });
  }

  console.log('[consumer-notify-scan] tarama bitti:', JSON.stringify(tally));
  return new Response(JSON.stringify({ ok: true, scanned: rows?.length ?? 0, tally }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
});
