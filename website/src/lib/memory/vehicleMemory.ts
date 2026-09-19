/**
 * ARAÇ HAFIZASI — tarihsel olayların TEK PROJEKSİYONU (F4.3).
 *
 * ── BU BİR GERÇEKLİK OTORİTESİ DEĞİLDİR ──────────────────────────────────
 * Hafıza hiçbir şey ÖLÇMEZ, hiçbir hüküm VERMEZ, hiçbir veriyi SAHİPLENMEZ.
 * Mevcut kanonik kaynakların satırlarını araç kimliğine göre tek bir zaman
 * çizelgesine ÇEVİRİR. Kaynakların sahipleri değişmez:
 *   · yolculuk       : `vehicle_trips` / `list_vehicle_trips` (trip authority)
 *   · yakıt kaydı    : `vehicle_fuel_logs` / `recordsService`
 *   · servis kaydı   : `vehicle_service_records` / `recordsService`
 *   · yetkilendirme  : Supabase RLS (istemci `vehicle_id` filtresi YETKİ DEĞİL)
 *
 * ── TEŞHİS GEÇMİŞİ (F5.3 · güncellendi 2026-09-19) ───────────────────────
 * `DIAGNOSTIC_SCAN` ARTIK VAR — çünkü kalıcı kaynağı tasarlandı:
 * `vehicle_diagnostic_scans` (migration 080, HAZIR/UYGULANMADI) ve onun
 * kod tarafı sözleşmesi `lib/diagnostics/diagnosticHistory`.
 *
 * Bu dosya yine hiçbir şey ÖLÇMEZ: tarama ARAÇTA yapılır, sınıflandırma
 * F2.1 `classifyDtcCommand`indir. Buradaki tek iş, kalıcı kaydı zaman
 * çizelgesine çevirmektir. Kayıt verilmezse (`undefined`) olay ÜRETİLMEZ;
 * yani migration uygulanana kadar çizelge eskisi gibi davranır.
 *
 * ── ESKİ ÖLÇÜM (neden bu kaynak gerekliydi, 2026-09-18) ──────────────────
 * `vehicle_commands` KALICI DEĞİLDİR: terminal durumdaki satırlar
 * **14 GÜN** sonra siliniyor (`cleanup` fonksiyonu). Production'da
 * tamamlanmış `read_dtc` sayısı ayrıca **0**. `vehicle_events` de çare değil:
 * anlamlı türleri (`obd_diag` · `critical_error` · `voice_diag` …) **30 GÜN**
 * sonra siliniyor; kalanlar (`heartbeat` 52k · `location_delta` 30k) telemetri
 * gürültüsüdür ve zaman çizelgesine DÖKÜLMEZ.
 *
 * Bu yüzden F4.3'te `DIAGNOSTIC` olayı ÜRETİLMİYORDU. F5.3 eksik kalıcılığı
 * kapattı; uydurma geçmiş üretmedi.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  summarizeScan,
  type DiagnosticScanRecord,
} from '@/lib/diagnostics/diagnosticHistory';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import type { FuelEntry, ServiceEntry } from '@/lib/recordsService';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

/**
 * Olay türü — KAPALI küme ve her biri GERÇEK bir kaynağa dayanır.
 *
 * Tür eklemek, o türün KALICI kaynağını kanıtlamayı gerektirir.
 * `DIAGNOSTIC_SCAN` kaynağı: `vehicle_diagnostic_scans` (080).
 */
export type MemoryEventType =
  | 'TRIP' | 'FUEL_RECORD' | 'SERVICE_RECORD' | 'DIAGNOSTIC_SCAN';

/**
 * Olayın kanıt gücü.
 *
 * Bu bir PROJEKSİYON SÖZLÜĞÜDÜR, ikinci bir provenance otoritesi değil:
 * değerler kaynağın KENDİ beyanından taşınır (`distance_source` gibi) ya da
 * kaydın doğasından gelir (kullanıcı formu → `USER_RECORDED`).
 *
 * `USER_RECORDED` asla `MEASURED`a yükseltilmez: kullanıcının girdiği
 * kilometre bir ECU okuması DEĞİLDİR (F4/F4.2 sınırı).
 */
export type MemoryProvenance = 'USER_RECORDED' | 'MEASURED' | 'DERIVED' | 'ESTIMATED';

export interface MemoryMeasurement {
  readonly label: string;
  readonly value: string;
  /** Bu TEK ölçümün kanıt gücü — olayınkinden farklı olabilir. */
  readonly provenance: MemoryProvenance;
}

export interface VehicleMemoryEvent {
  /** Kaynak satırla birlikte deterministik — sayfalama/anahtar için. */
  readonly id: string;
  readonly vehicleId: string;
  readonly type: MemoryEventType;
  /** Olayın GERÇEKLEŞTİĞİ an (epoch ms). Bilinmiyorsa olay HİÇ üretilmez. */
  readonly occurredAt: number;
  readonly title: string;
  readonly summary: string | null;
  readonly provenance: MemoryProvenance;
  /** Hangi kaynaktan geldiği — denetlenebilirlik. */
  readonly sourceRef: string;
  readonly measurements: readonly MemoryMeasurement[];
  /** Bu olayın NE SÖYLEMEDİĞİ — boş liste "her şey kesin" demek değildir. */
  readonly limitations: readonly string[];
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** PostgREST `numeric`i metin döndürür; boş metin `0` TUZAĞINA düşülmez. */
function finite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Zaman damgasını epoch ms'e çevirir. Geçersizse `null`.
 *
 * `Date.now()` YEDEĞİ YOKTUR: zamanı bilinmeyen bir kaydı "şimdi" diye
 * çizelgeye koymak, olmamış bir olayı bugün olmuş göstermektir.
 */
export function toEpochMs(v: string | null | undefined): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Kaynağın kendi beyanı → projeksiyon sözlüğü. Bilinmeyen beyan yükseltilmez. */
function metricProvenance(raw: string | null | undefined): MemoryProvenance {
  switch (raw) {
    case 'MEASURED': return 'MEASURED';
    case 'DERIVED':  return 'DERIVED';
    /* `ESTIMATED` ve tanınmayan/eksik beyan aynı kefeye konur: ikisi de
       "ölçülmedi" demektir ve MEASURED'a YÜKSELTİLMEZ. */
    default:         return 'ESTIMATED';
  }
}

function fmtKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

/* ── Yolculuk ──────────────────────────────────────────────────────────── */

/**
 * Yolculuk satırı → hafıza olayı.
 *
 * ── MESAFE ODOMETRE DEĞİLDİR ─────────────────────────────────────────────
 * `distance_km` O YOLCULUĞUN mesafesidir. Aracın toplam kilometresi
 * DEĞİLDİR ve öyle etiketlenemez (F4.2 sınırı). Etiket bu yüzden
 * "Mesafe"dir; "Kilometre"/"Toplam km" DEĞİL.
 */
export function tripToMemoryEvent(row: TripRow, vehicleId: string): VehicleMemoryEvent | null {
  const at = toEpochMs(row.ended_at ?? null);
  if (at === null) return null;   // zamanı bilinmeyen yolculuk çizelgeye GİRMEZ

  const distance = finite(row.distance_km);
  const duration = finite(row.duration_min);
  const distanceProv = metricProvenance(row.distance_source ?? null);

  const measurements: MemoryMeasurement[] = [];
  if (distance !== null) {
    measurements.push({ label: 'Mesafe', value: fmtKm(distance), provenance: distanceProv });
  }
  if (duration !== null) {
    measurements.push({ label: 'Süre', value: `${Math.round(duration)} dk`, provenance: 'MEASURED' });
  }

  /* YAKIT: yolculuğun litresi F3.2'den sonra YALNIZ kanıtlıysa dolu gelir.
     Kaynağı `ESTIMATED` ise ölçüm gibi GÖSTERİLMEZ. */
  const litres = finite(row.fuel_used_l);
  const fuelProv = metricProvenance(row.fuel_source ?? null);
  const limitations: string[] = [];
  if (litres !== null && fuelProv !== 'ESTIMATED') {
    measurements.push({ label: 'Yakıt', value: `${litres.toFixed(1)} L`, provenance: fuelProv });
  } else if (litres !== null) {
    limitations.push('Yakıt tüketimi ölçülmedi (tahmini değer gösterilmiyor)');
  }

  return {
    id: `trip:${row.trip_key ?? row.trip_id ?? String(at)}`,
    vehicleId,
    type: 'TRIP',
    occurredAt: at,
    title: 'Yolculuk',
    summary: distance !== null ? fmtKm(distance) : null,
    provenance: distanceProv,
    sourceRef: 'vehicle_trips',
    measurements,
    limitations,
  };
}

/* ── Yakıt kaydı ───────────────────────────────────────────────────────── */

/**
 * Kullanıcının YAKIT ALIMI kaydı → hafıza olayı.
 *
 * ── SATIN ALMA ≠ TÜKETİM ─────────────────────────────────────────────────
 * Bu kayıt "depoya şu kadar litre aldım"dır. Aracın O LİTREYİ HARCADIĞINI
 * söylemez; trip yakıt ölçümüyle (F3.1/F3.2) AYNI ŞEY DEĞİLDİR ve
 * karıştırılmaz. Kullanıcının girdiği kilometre de bir ECU okuması değildir.
 */
export function fuelEntryToMemoryEvent(
  entry: FuelEntry, vehicleId: string,
): VehicleMemoryEvent | null {
  const at = toEpochMs(entry.filledOn);
  if (at === null) return null;

  const measurements: MemoryMeasurement[] = [
    { label: 'Miktar', value: `${entry.liters.toFixed(1)} L`, provenance: 'USER_RECORDED' },
  ];
  if (entry.pricePerL !== null && Number.isFinite(entry.pricePerL)) {
    const total = entry.liters * entry.pricePerL;
    measurements.push({
      label: 'Tutar',
      value: `${Math.round(total).toLocaleString('tr-TR')} ₺`,
      provenance: 'USER_RECORDED',
    });
  }
  if (entry.odometerKm !== null && Number.isFinite(entry.odometerKm)) {
    /* Kullanıcının okuduğu gösterge değeri — ECU ölçümü DEĞİL. */
    measurements.push({
      label: 'Kilometre (kullanıcı)',
      value: `${Math.round(entry.odometerKm).toLocaleString('tr-TR')} km`,
      provenance: 'USER_RECORDED',
    });
  }

  return {
    id: `fuel:${entry.id}`,
    vehicleId,
    type: 'FUEL_RECORD',
    occurredAt: at,
    title: 'Yakıt alındı',
    summary: `${entry.liters.toFixed(1)} L`,
    provenance: 'USER_RECORDED',
    sourceRef: 'vehicle_fuel_logs',
    measurements,
    limitations: ['Bu kayıt yakıt ALIMIDIR; aracın tükettiği yakıt ölçümü değildir'],
  };
}

/* ── Servis kaydı ──────────────────────────────────────────────────────── */

/**
 * Kullanıcının SERVİS kaydı → hafıza olayı.
 *
 * Kayıt TARİHSEL BİR BEYANDIR: "yağ değişimi yapıldığı doğrulandı" DEĞİL,
 * "kullanıcı yağ değişimi kaydetti". Sensör/OEM doğrulaması yoktur.
 */
export function serviceEntryToMemoryEvent(
  entry: ServiceEntry, vehicleId: string, label: string,
): VehicleMemoryEvent | null {
  const at = toEpochMs(entry.performedOn);
  if (at === null) return null;

  const measurements: MemoryMeasurement[] = [];
  if (entry.odometerKm !== null && Number.isFinite(entry.odometerKm)) {
    measurements.push({
      label: 'Kilometre (kullanıcı)',
      value: `${Math.round(entry.odometerKm).toLocaleString('tr-TR')} km`,
      provenance: 'USER_RECORDED',
    });
  }

  return {
    id: `service:${entry.id ?? entry.clientRef ?? `${entry.serviceKey}:${entry.performedOn}`}`,
    vehicleId,
    type: 'SERVICE_RECORD',
    occurredAt: at,
    title: label,
    summary: null,
    provenance: 'USER_RECORDED',
    sourceRef: 'vehicle_service_records',
    measurements,
    limitations: ['Kullanıcı tarafından kaydedildi — araçtan doğrulanmadı'],
  };
}

/* ── Birleştirme ───────────────────────────────────────────────────────── */

/** Tek sayfada dönebilecek azami olay — sınırsız birleştirme YOK. */
export const MEMORY_PAGE_SIZE = 50;

export interface MemoryBuildInput {
  readonly vehicleId: string;
  /** `null` = OKUNAMADI ("kayıt yok" DEĞİL). */
  readonly trips: readonly TripRow[] | null;
  readonly fuel: readonly FuelEntry[] | null;
  readonly services: readonly ServiceEntry[] | null;
  /**
   * Kalıcı teşhis taramaları (F5.3).
   *   `undefined` = bu kaynak İSTENMEDİ (migration 080 uygulanmadan önceki hâl)
   *   `null`      = istendi ama OKUNAMADI → `unreadableSources`a düşer
   * İkisi AYNI ŞEY DEĞİLDİR: biri "sormadık", öteki "soramadık".
   */
  readonly diagnosticScans?: readonly DiagnosticScanRecord[] | null;
  /** Servis anahtarı → Türkçe etiket (mevcut kayıt ekranının sözlüğü). */
  readonly serviceLabels: Readonly<Record<string, string>>;
  readonly pageSize?: number;
}

export interface VehicleMemory {
  readonly vehicleId: string;
  readonly events: readonly VehicleMemoryEvent[];
  /** Hangi kaynaklar okunamadı — boş çizelge "geçmiş yok" demek olmasın. */
  readonly unreadableSources: readonly string[];
  /** Sayfa sınırı nedeniyle kırpıldı mı. */
  readonly truncated: boolean;
}

/**
 * Kaynakları tek çizelgede birleştirir — SAF.
 *
 * SIRALAMA DETERMİNİSTİKTİR: `occurredAt` azalan; eşitlikte `type` sonra `id`
 * ile kırılır. Aksi hâlde aynı gün içindeki iki olay her render'da yer
 * değiştirebilir ve sayfalama tutarsızlaşır.
 */
/**
 * Kalıcı teşhis taramasını çizelge olayına çevirir (F5.3).
 *
 * KURAL: zamanı bilinmeyen tarama çizelgeye GİRMEZ (`null` döner) — "ne zaman
 * olduğunu bilmiyoruz" ile "bugün oldu" AYNI ŞEY DEĞİLDİR.
 *
 * Metin `summarizeScan`ten gelir; burada YENİ CÜMLE KURULMAZ. Başarısız
 * tarama "arıza yok" DEMEZ, kısmi tarama TAM gibi sunulmaz.
 *
 * DTC kodları ölçüm olarak TAŞINIR: kullanıcı teknik ayrıntıyı görmek
 * isterse kod SAKLANMAZ (§18). Ham ECU/çerçeve verisi TAŞINMAZ.
 */
export function diagnosticScanToMemoryEvent(
  scan: DiagnosticScanRecord,
  vehicleId: string,
): VehicleMemoryEvent | null {
  const occurredAt = toEpochMs(scan.measuredAt) ?? toEpochMs(scan.completedAt);
  if (occurredAt === null) return null;

  const s = summarizeScan(scan);

  /* Kodlar ölçüm satırı olur. `MEASURED`: kodu ARAÇ bildirdi, kullanıcı değil. */
  const measurements: MemoryMeasurement[] = scan.dtcs.map((d) => ({
    label: d.code,
    value: d.desc && d.desc.trim().length > 0 ? d.desc : (d.system ?? '—'),
    provenance: 'MEASURED' as const,
  }));

  return {
    id: `diag:${scan.sourceCommandId}`,
    vehicleId,
    type: 'DIAGNOSTIC_SCAN',
    occurredAt,
    title: 'Arıza taraması',
    summary: s.headline,
    provenance: 'MEASURED',
    sourceRef: 'vehicle_diagnostic_scans',
    measurements,
    /* Kapsam sınırları KAYBOLMAZ; boş liste "her şey kapsandı" DEMEK DEĞİL. */
    limitations: s.limitations,
  };
}

export function buildVehicleMemory(input: MemoryBuildInput): VehicleMemory {
  const { vehicleId, trips, fuel, services, serviceLabels } = input;
  const limit = input.pageSize ?? MEMORY_PAGE_SIZE;
  const events: VehicleMemoryEvent[] = [];
  const unreadable: string[] = [];

  if (trips === null) unreadable.push('Yolculuklar');
  else for (const t of trips) {
    const e = tripToMemoryEvent(t, vehicleId);
    if (e) events.push(e);
  }

  if (fuel === null) unreadable.push('Yakıt kayıtları');
  else for (const f of fuel) {
    const e = fuelEntryToMemoryEvent(f, vehicleId);
    if (e) events.push(e);
  }

  if (services === null) unreadable.push('Servis kayıtları');
  else for (const s of services) {
    const e = serviceEntryToMemoryEvent(s, vehicleId, serviceLabels[s.serviceKey] ?? 'Servis kaydı');
    if (e) events.push(e);
  }

  /* `undefined` → kaynak istenmedi, sessizce atlanır (regresyonsuz).
     `null` → istendi ama okunamadı; bu KAYIT YOK demek DEĞİLDİR. */
  if (input.diagnosticScans === null) unreadable.push('Arıza taramaları');
  else if (input.diagnosticScans !== undefined) {
    for (const d of input.diagnosticScans) {
      const e = diagnosticScanToMemoryEvent(d, vehicleId);
      if (e) events.push(e);
    }
  }

  events.sort((a, b) =>
    b.occurredAt - a.occurredAt ||
    a.type.localeCompare(b.type) ||
    a.id.localeCompare(b.id));

  const truncated = events.length > limit;
  return {
    vehicleId,
    events: truncated ? events.slice(0, limit) : events,
    unreadableSources: unreadable,
    truncated,
  };
}

/* ── Gösterim yardımcıları ─────────────────────────────────────────────── */

/** Provenance → düz Türkçe. Teknik etiket kullanıcıya DAYATILMAZ. */
export function provenanceLabel(p: MemoryProvenance): string {
  switch (p) {
    case 'USER_RECORDED': return 'Kullanıcı kaydı';
    case 'MEASURED':      return 'Araçtan ölçüldü';
    case 'DERIVED':       return 'Araç verisinden türetildi';
    case 'ESTIMATED':     return 'Tahmini';
  }
}

/** Gün başlığı — aynı güne düşen olaylar tek başlık altında toplanır. */
export function memoryDayKey(occurredAt: number): string {
  return new Date(occurredAt).toISOString().slice(0, 10);
}
