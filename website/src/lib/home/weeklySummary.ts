/**
 * HAFTALIK ARAÇ ÖZETİ — mevcut kayıtların TEK projeksiyonu (F5).
 *
 * ── BU DOSYA HİÇBİR ŞEYİN SAHİBİ DEĞİLDİR ────────────────────────────────
 * Özet ölçmez, hüküm vermez, veri türetmez. Yalnız ZATEN OKUNMUŞ kanonik
 * satırları bir zaman penceresine göre sayar:
 *   · yolculuk    : `vehicle_trips` (trip authority)
 *   · yakıt kaydı : `vehicle_fuel_logs` / `recordsService`
 *   · servis kaydı: `vehicle_service_records` / `recordsService`
 *
 * ── ÜÇ DURUM BİRBİRİNE KARIŞTIRILMAZ ─────────────────────────────────────
 *   `undefined` = BU YÜZEY O KAYNAĞI OKUMADI  → hakkında hiçbir şey söylenmez
 *   `null`      = OKUNAMADI                    → ayrıca bildirilir
 *   `[]`        = OKUNDU, KAYIT YOK            → "0" demek DÜRÜSTTÜR
 *
 * Okunmamış bir kaynak için "0 servis kaydı" yazmak, olmayan bir ölçümü
 * ölçülmüş göstermek olurdu (§8 · §19).
 *
 * ── ÜRETİLMEYEN İDDİALAR (kanıtı yok) ────────────────────────────────────
 *   · Toplam araç kilometresi — yolculuk mesafesi odometre DEĞİLDİR (F4.2).
 *   · Ortalama tüketim — production'da 157 yolculuğun yalnız 4'ünde yüzde
 *     tüketim var; böyle bir tabandan ortalama YAZILMAZ (F3.1/F3.2).
 *   · "Bu hafta hiç arıza olmadı" — kalıcı DTC geçmişi YOKTUR (F4.3).
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import type { FuelEntry, ServiceEntry } from '@/lib/recordsService';
import { toEpochMs } from '@/lib/memory/vehicleMemory';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

/** Kaynak okuma durumu: okunmadı / okunamadı / okundu. */
export type WeeklySource<T> = readonly T[] | null | undefined;

export interface WeeklyFact {
  readonly id: 'TRIPS' | 'DISTANCE' | 'FUEL_RECORDS' | 'SERVICE_RECORDS';
  readonly label: string;
  readonly value: string;
  /** Sayının NEYİ kapsamadığı — boşsa ek sınır yok demektir. */
  readonly detail: string | null;
}

export interface WeeklySummary {
  readonly windowLabel: string;
  /** Tek cümlelik özet; anlamlı bir şey söylenemiyorsa `null`. */
  readonly headline: string | null;
  readonly facts: readonly WeeklyFact[];
  /** Okunamayan kaynaklar — boş özet "hiçbir şey olmadı" DEMEK DEĞİLDİR. */
  readonly unreadableSources: readonly string[];
  /** Bu yüzeyin hiç okumadığı kaynaklar — haklarında sayı ÜRETİLMEZ. */
  readonly uncoveredSources: readonly string[];
  /** Pencerede gerçekten kanıt var mı. */
  readonly hasEvidence: boolean;
}

export interface WeeklySummaryInput {
  readonly now: number;
  /** Pencere genişliği; varsayılan 7 gün. */
  readonly windowMs?: number;
  readonly trips: WeeklySource<TripRow>;
  readonly fuel: WeeklySource<FuelEntry>;
  readonly services: WeeklySource<ServiceEntry>;
}

export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

/** `YYYY-MM-DD` ya da ISO → epoch ms; geçersizse `null` (uydurma tarih YOK). */
function dayToEpochMs(v: string | null | undefined): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const direct = toEpochMs(v);
  if (direct !== null) return direct;
  return toEpochMs(`${v.trim()}T00:00:00.000Z`);
}

function inWindow(at: number | null, from: number, to: number): boolean {
  return at !== null && at >= from && at <= to;
}

function fmtKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const windowMs = input.windowMs ?? WEEKLY_WINDOW_MS;
  const from = input.now - windowMs;
  const to = input.now;

  const facts: WeeklyFact[] = [];
  const unreadable: string[] = [];
  const uncovered: string[] = [];

  /* ── Yolculuklar ─────────────────────────────────────────────────────── */
  let tripCount: number | null = null;
  let distanceKm: number | null = null;

  if (input.trips === undefined) {
    uncovered.push('Yolculuklar');
  } else if (input.trips === null) {
    unreadable.push('Yolculuklar');
  } else {
    let count = 0;
    let distance = 0;
    let withDistance = 0;
    for (const t of input.trips) {
      if (!inWindow(toEpochMs(t.ended_at ?? null), from, to)) continue;
      count += 1;
      const d = finite(t.distance_km);
      /* Mesafesi ölçülmemiş yolculuk toplama `0` olarak GİRMEZ. */
      if (d !== null && d > 0) { distance += d; withDistance += 1; }
    }
    tripCount = count;
    distanceKm = withDistance > 0 ? distance : null;

    const missing = count - withDistance;
    facts.push({
      id: 'TRIPS',
      label: 'Yolculuk',
      value: String(count),
      detail: null,
    });
    facts.push({
      id: 'DISTANCE',
      label: 'Yol',
      /* Ölçüm yoksa sayı UYDURULMAZ. */
      value: distanceKm === null ? '—' : fmtKm(distanceKm),
      detail: distanceKm === null
        ? (count > 0 ? 'Bu yolculukların mesafesi ölçülmedi' : null)
        : (missing > 0 ? `${missing} yolculuğun mesafesi ölçülmedi` : null),
    });
  }

  /* ── Yakıt kayıtları (KULLANICI kaydı — tüketim ölçümü DEĞİL) ────────── */
  if (input.fuel === undefined) {
    uncovered.push('Yakıt kayıtları');
  } else if (input.fuel === null) {
    unreadable.push('Yakıt kayıtları');
  } else {
    let count = 0;
    let liters = 0;
    for (const f of input.fuel) {
      if (!inWindow(dayToEpochMs(f.filledOn), from, to)) continue;
      count += 1;
      if (Number.isFinite(f.liters)) liters += f.liters;
    }
    facts.push({
      id: 'FUEL_RECORDS',
      label: 'Yakıt kaydı',
      value: String(count),
      /* SATIN ALMA ≠ TÜKETİM: litre "harcanan yakıt" diye sunulmaz. */
      detail: count > 0 ? `${liters.toFixed(1)} L alındı (kendi kaydınız)` : null,
    });
  }

  /* ── Servis kayıtları ────────────────────────────────────────────────── */
  if (input.services === undefined) {
    uncovered.push('Servis kayıtları');
  } else if (input.services === null) {
    unreadable.push('Servis kayıtları');
  } else {
    let count = 0;
    for (const s of input.services) {
      if (!inWindow(dayToEpochMs(s.performedOn), from, to)) continue;
      count += 1;
    }
    facts.push({
      id: 'SERVICE_RECORDS',
      label: 'Servis kaydı',
      value: String(count),
      detail: count > 0 ? 'Kendi kaydınız — araçtan doğrulanmadı' : null,
    });
  }

  /* ── Tek cümle ───────────────────────────────────────────────────────── */
  let headline: string | null = null;
  if (tripCount !== null && tripCount > 0) {
    headline = distanceKm !== null
      ? `Bu hafta ${fmtKm(distanceKm)} yol yaptınız · ${tripCount} yolculuk`
      : `Bu hafta ${tripCount} yolculuk kaydedildi`;
  } else if (tripCount === 0) {
    /* "Araç kullanılmadı" İDDİA EDİLMEZ: kaydedilmemiş yolculuk da olabilir. */
    headline = 'Bu hafta kayıtlı yolculuk yok';
  }

  const hasEvidence = facts.some((f) => f.value !== '0' && f.value !== '—');

  return {
    windowLabel: 'Son 7 gün',
    headline,
    facts,
    unreadableSources: unreadable,
    uncoveredSources: uncovered,
    hasEvidence,
  };
}
