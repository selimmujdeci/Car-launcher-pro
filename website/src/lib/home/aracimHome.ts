/**
 * ARACIM — tüketici ana ekranının TEK projeksiyonu (F3).
 *
 * ── İKİNCİ OTORİTE KURULMADI ─────────────────────────────────────────────
 * Bu dosya hiçbir gerçeğin SAHİBİ değildir. Mevcut otoriteleri seçip tek bir
 * ekran diline çevirir:
 *   · sağlık   : F2.2 `VehicleHealthSummary` (kendisi `evidenceModel`e dayanır)
 *   · tazelik  : `vehicleTelemetryFreshness` (LIVE/STALE/OFFLINE/NEVER_SEEN)
 *   · kimlik   : `vehicleDisplay.vehicleTitle/vehicleSubtitle`
 *   · komut    : DOKUNULMAZ — `commandService` + F0.3 `commandEvidence`
 *   · aktif araç: `vehicleStore.getActiveVehicle`
 *
 * ── EKRANIN SÖYLEYEMEYECEKLERİ ───────────────────────────────────────────
 * UNKNOWN ≠ NORMAL · STALE ≠ CURRENT · ESTIMATE ≠ MEASUREMENT ·
 * COMMAND DELIVERED ≠ PHYSICAL STATE VERIFIED.
 * Bu yüzden burada `null` dönen her alan "yok" olarak GÖSTERİLİR; sahte sayı,
 * sahte tarih, sahte "park edildi" ve sahte "kilitli" ÜRETİLMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  ageLabel,
  freshnessLabel,
  measurementLabel,
  type FreshnessState,
  type Measurement,
  type VehicleFreshness,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import { vehicleSubtitle, vehicleTitle, type VehicleIdentityLike } from '@/lib/vehicleDisplay';
import type { VehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import type { Verdict } from '@/lib/console/evidenceModel';

/* ── Başlık ────────────────────────────────────────────────────────────── */

export interface HomeIdentity {
  readonly title: string;
  readonly subtitle: string | null;
}

/**
 * BAĞLANTI — aracın sağlığı DEĞİLDİR (§6).
 *
 * "Araç çevrimdışı" cümlesi bir arıza iddiası değildir; yalnız veri akmadığını
 * söyler. Ana başlıktaki "son veri" kanonik cihaz tazeliğinden gelir; sağlık ve
 * konum FARKLI yaşta olabilir ve tek sahte damgada BİRLEŞTİRİLMEZ (§18).
 */
export interface HomeConnection {
  readonly state: FreshnessState;
  readonly label: string;
  /** "8 dk önce" / "Bilinmiyor" — uydurma zaman YOK. */
  readonly lastDataLabel: string;
  readonly isOnline: boolean;
}

/* ── Yakıt / menzil ────────────────────────────────────────────────────── */

export type HomeFuel =
  | {
      readonly kind: 'MEASURED';
      readonly percent: number;
      readonly display: string;
      readonly freshness: FreshnessState;
      readonly ageLabel: string;
      /** Düşük yakıt yalnız GÜNCEL ölçümde bildirilir. */
      readonly low: boolean;
    }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

export type HomeRange =
  | {
      readonly kind: 'ESTIMATE';
      readonly km: number;
      readonly display: string;
      /** Tahminin NEYE dayandığı — ölçüm gibi sunulmaz. */
      readonly provenance: string;
      readonly sampleCount: number;
    }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

/**
 * Menzil kanıtı için asgari çıta.
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * Production ölçümü (2026-09-18, `vehicle_trips`): 157 yolculuğun YALNIZ 4'ünde
 * `fuel_used_percent` dolu, oran hesaplanabilir olan 2 tanesinin ortalama
 * mesafesi 2.9 km. Böyle bir tabandan "~410 km" yazmak UYDURMA olurdu.
 * Araç tarafı yakıt hesabını zaten reddediyor (`fuel_reject_reason` içinde
 * `NO_TANK_CAPACITY`).
 *
 * Çıta aşılmadıkça menzil GÖSTERİLMEZ. Araç tarafı gerçek yüzde tüketimi
 * yazmaya başladığı gün bu yüzey kendiliğinden açılır.
 */
export const RANGE_MIN_TRIPS = 5;
export const RANGE_MIN_DISTANCE_KM = 50;

/** Menzil kanıtı olarak kullanılabilecek yolculuk özeti. */
export interface RangeTripSample {
  /** Ölçülen mesafe (km). */
  readonly distanceKm: number | null;
  /** Yolculukta harcanan yakıt YÜZDESİ — depo hacmi GEREKTİRMEZ. */
  readonly fuelUsedPercent: number | null;
}

/* ── Konum ─────────────────────────────────────────────────────────────── */

/**
 * Konum — "PARK YERİ" DEĞİL, "SON KONUM".
 *
 * ── ÖLÇÜLEN GERÇEK (production, 2026-09-18) ──────────────────────────────
 * `vehicle_telemetry` şemasında park/kontak/kapı/kilit kolonu YOK. Yolculuk
 * bitiş gerekçesi 157 kaydın 138'inde `null`, 19'unda `IDLE_WINDOW` — yani bir
 * ZAMAN AŞIMI sezgisi, park OLAYI değil. Deterministic park kanıtı olmadığı
 * için son konum "park yeri" diye KESİN sunulmaz (§10).
 */
export type HomeLocation =
  | {
      readonly kind: 'LAST_KNOWN';
      readonly label: string;
      readonly ageLabel: string;
      readonly isLive: boolean;
      readonly latitude: number;
      readonly longitude: number;
    }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: string };

/* ── Uyarı ─────────────────────────────────────────────────────────────── */

/**
 * Ana ekranda TEK önemli aksiyon.
 *
 * Aynı uyarıyı hero + alert + teşhis diye üç kez tekrar etmemek için kural:
 * uyarı VARSA arıza kodlarının listesi HERO'da değil, burada durur (§11).
 */
export interface HomeAlert {
  readonly verdict: Verdict;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
}

export interface HomeRecentTrip {
  readonly distanceLabel: string;
  readonly durationLabel: string | null;
  readonly whenLabel: string;
}

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

export interface AracimHome {
  readonly identity: HomeIdentity;
  readonly connection: HomeConnection;
  /** F2.2 projeksiyonu; henüz okunmadıysa `null` (LOADING ≠ UNKNOWN, §19). */
  readonly health: VehicleHealthSummary | null;
  readonly fuel: HomeFuel;
  readonly range: HomeRange;
  readonly location: HomeLocation;
  readonly alert: HomeAlert | null;
  readonly recentTrip: HomeRecentTrip | null;
}

export interface AracimHomeInput {
  readonly now: number;
  readonly vehicle: VehicleIdentityLike & {
    readonly telemetry?: VehicleFreshness | undefined;
  };
  readonly health: VehicleHealthSummary | null;
  /** Menzil kanıtı; okunamadıysa `null` ("yolculuk yok" ile KARIŞTIRILMAZ). */
  readonly rangeTrips: readonly RangeTripSample[] | null;
  readonly recentTrip: { distanceKm: number | null; durationMin: number | null; endedAt: string | null } | null;
  /** Düşük yakıt eşiği — mevcut `TIMING`/`constants` değeriyle beslenir. */
  readonly lowFuelPct: number;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function buildFuel(m: Measurement | undefined, lowPct: number): HomeFuel {
  if (!m || m.value === null) {
    return { kind: 'UNAVAILABLE', reason: 'Yakıt seviyesi okunamadı' };
  }
  return {
    kind: 'MEASURED',
    percent: m.value,
    display: measurementLabel(m, '%'),
    freshness: m.state,
    ageLabel: ageLabel(m.ageMs),
    /* Bayat ölçümden "yakıtın bitiyor" uyarısı ÜRETİLMEZ — o ölçüm saatler
       önceki depoyu anlatıyor olabilir. */
    low: m.state === 'LIVE' && m.value <= lowPct,
  };
}

/**
 * Menzil tahmini — km/% oranından.
 *
 * Depo hacmi GEREKMEZ: yolculuk başına "kaç km'de yüzde kaç düştü" doğrudan
 * ölçülebilir bir orandır. Yine de kanıt çıtası aşılmadıkça sayı ÜRETİLMEZ.
 */
export function estimateRange(
  fuel: HomeFuel,
  trips: readonly RangeTripSample[] | null,
): HomeRange {
  if (fuel.kind !== 'MEASURED') {
    return { kind: 'UNAVAILABLE', reason: 'Yakıt seviyesi bilinmiyor' };
  }
  if (trips === null) {
    return { kind: 'UNAVAILABLE', reason: 'Yolculuk geçmişi okunamadı' };
  }

  let distance = 0;
  let percent = 0;
  let samples = 0;
  for (const t of trips) {
    const d = t.distanceKm;
    const p = t.fuelUsedPercent;
    if (d === null || p === null) continue;
    if (!Number.isFinite(d) || !Number.isFinite(p)) continue;
    if (d <= 0 || p <= 0) continue;
    distance += d;
    percent += p;
    samples += 1;
  }

  if (samples < RANGE_MIN_TRIPS || distance < RANGE_MIN_DISTANCE_KM || percent <= 0) {
    return {
      kind: 'UNAVAILABLE',
      reason: 'Menzil tahmini için yeterli tüketim verisi yok',
    };
  }

  const kmPerPercent = distance / percent;
  const km = Math.round(fuel.percent * kmPerPercent);
  if (!Number.isFinite(km) || km <= 0) {
    return { kind: 'UNAVAILABLE', reason: 'Menzil tahmini üretilemedi' };
  }

  return {
    kind: 'ESTIMATE',
    km,
    /* `~` işareti bilinçli: bu bir ÖLÇÜM DEĞİL, tahmindir. */
    display: `~${km} km`,
    provenance: `Son ${samples} yolculuğun gerçek tüketimine göre tahmin`,
    sampleCount: samples,
  };
}

function buildLocation(t: VehicleFreshness | undefined): HomeLocation {
  if (!t || t.latitude === null || t.longitude === null) {
    return { kind: 'UNAVAILABLE', reason: 'Araç konumu bilinmiyor' };
  }
  if (t.location === 'NEVER_SEEN' || t.location === 'UNKNOWN') {
    return { kind: 'UNAVAILABLE', reason: 'Araç konumu bilinmiyor' };
  }
  return {
    kind: 'LAST_KNOWN',
    /* Adres çözümlemesi YOK; ham koordinat da kullanıcıya DÖKÜLMEZ (§10).
       Etiket mevcut konum diline sadık kalır, "park yeri" İDDİA ETMEZ. */
    label: t.location === 'LIVE' ? 'Aracın güncel konumu' : 'Aracın son konumu',
    ageLabel: ageLabel(t.locationAgeMs),
    isLive: t.locationIsLive,
    latitude: t.latitude,
    longitude: t.longitude,
  };
}

/**
 * Tek önemli aksiyon — YALNIZ sağlık gerçekten uyarı üretiyorsa.
 *
 * `NO_EVIDENCE` bir uyarı DEĞİLDİR: kanıt yokluğu kullanıcıyı telaşlandıran
 * kırmızı bir karta dönüşmez (§5, §16).
 */
export function buildAlert(health: VehicleHealthSummary | null): HomeAlert | null {
  if (!health) return null;
  if (health.verdict !== 'WARNING' && health.verdict !== 'CRITICAL') return null;

  const codes = health.dtcs.map((d) => d.code).join(' · ');
  const detail = health.dtcs.length > 0
    ? `${codes} tespit edildi`
    : health.explanation;

  return {
    verdict: health.verdict,
    title: health.headline,
    detail,
    actionLabel: 'Detayları Gör',
  };
}

function buildRecentTrip(
  trip: AracimHomeInput['recentTrip'],
  now: number,
): HomeRecentTrip | null {
  if (!trip) return null;
  if (trip.distanceKm === null || !Number.isFinite(trip.distanceKm)) return null;

  const endedAt = trip.endedAt ? Date.parse(trip.endedAt) : NaN;
  return {
    distanceLabel: `${trip.distanceKm.toFixed(1)} km`,
    durationLabel: trip.durationMin !== null && Number.isFinite(trip.durationMin)
      ? `${Math.round(trip.durationMin)} dk`
      : null,
    /* Zaman bilinmiyorsa uydurulmaz. */
    whenLabel: Number.isFinite(endedAt) ? ageLabel(now - endedAt) : 'Zaman bilinmiyor',
  };
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildAracimHome(input: AracimHomeInput): AracimHome {
  const { now, vehicle, health, rangeTrips, lowFuelPct } = input;
  const t = vehicle.telemetry;

  const fuel = buildFuel(t?.fuelPercent, lowFuelPct);
  const deviceState: FreshnessState = t?.device ?? 'UNKNOWN';

  return {
    identity: {
      title: vehicleTitle(vehicle),
      subtitle: vehicleSubtitle(vehicle),
    },
    connection: {
      state: deviceState,
      label: freshnessLabel(deviceState),
      lastDataLabel: ageLabel(t?.deviceAgeMs ?? null),
      /* "Online" iddiası YALNIZ canlı heartbeat'ten çıkar. */
      isOnline: deviceState === 'LIVE',
    },
    health,
    fuel,
    range: estimateRange(fuel, rangeTrips),
    location: buildLocation(t),
    alert: buildAlert(health),
    recentTrip: buildRecentTrip(input.recentTrip, now),
  };
}
