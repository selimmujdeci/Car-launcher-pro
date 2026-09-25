/**
 * ecoReportModel — Yakıt & CO₂ karnesi (SAF).
 *
 * I/O · timer · `Date.now` · `Math.random` · global durum YOK; saat ve veri
 * dışarıdan verilir → testler deterministiktir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * · CO₂ ve L/100 km YALNIZ ölçülmüş/türetilmiş yakıttan (`fuelSource` MEASURED
 *   | DERIVED). `ESTIMATED`/`UNAVAILABLE`/`null` → sayı YOK, sebep VAR.
 * · Yakıt tipi bilinmiyorsa CO₂ UYDURULMAZ (benzin mi dizel mi — katsayı %16 fark).
 * · Elektrikli araç: şebeke karışımı bilinmediği için CO₂ gösterilmez.
 * · Rölanti bedeli literatür aralığıyla TAHMİNDİR ve öyle etiketlenir.
 * · "Sürüş tarzının bedeli" formülden DEĞİL sürücünün KENDİ ölçülmüş geçmişinden:
 *   bir yolculuk yalnız BENZER ORTALAMA HIZDAKİ (±15 km/sa) sakin yolculuklarla
 *   kıyaslanır — şehir içi ile otoyol farkı "kötü sürüş" sayılmaz.
 */
import type { TripRecord } from '../tripLogService';

export type EcoFuelType = 'petrol' | 'diesel' | 'ev' | 'unknown';

/** Tank-to-wheel CO₂ (kg/L) — yaygın kabul gören değerler. */
export const CO2_KG_PER_L: Readonly<Record<'petrol' | 'diesel', number>> = { petrol: 2.31, diesel: 2.68 };
/** Rölanti tüketimi (L/sa) — binek araç literatür aralığı; TAHMİN. */
export const IDLE_L_PER_H: Readonly<Record<'petrol' | 'diesel', { min: number; max: number }>> = {
  petrol: { min: 0.6, max: 1.0 },
  diesel: { min: 0.5, max: 0.9 },
};

/** Kıyas için en kısa yolculuk (km) — kısa yolculukta soğuk motor tüketimi baskındır. */
export const MIN_COMPARE_KM = 5;
/** "Sakin" yolculuk: 10 km'de en fazla bu kadar sert olay. */
export const CALM_HARSH_PER_10KM = 0.5;
/** Kıyas bandı: ortalama hız farkı (km/sa). */
export const SPEED_BAND_KMH = 15;
/** Kıyas için gereken en az benzer sakin yolculuk. */
export const MIN_BASELINE_TRIPS = 3;

const WEEK_MS = 7 * 24 * 3600_000;

export function fuelTypeFromVehicle(vehicleType: string | undefined | null): EcoFuelType {
  switch (vehicleType) {
    case 'ice': case 'hybrid': case 'phev': return 'petrol';
    case 'diesel': return 'diesel';
    case 'ev': return 'ev';
    default: return 'unknown';
  }
}

/** Yakıt ölçülmüş/türetilmiş mi — tahmin ve bilinmeyen HARİÇ. */
function measuredFuelL(t: TripRecord): number | null {
  const src = t.fuelSource;
  if (src !== 'MEASURED' && src !== 'DERIVED') return null;
  const l = t.fuelConsumptionL;
  return typeof l === 'number' && Number.isFinite(l) && l >= 0 ? l : null;
}

function harshPer10Km(t: TripRecord): number | null {
  if (t.harshAccelCount === undefined && t.harshBrakeCount === undefined) return null;
  if (!(t.distanceKm > 0)) return null;
  return (((t.harshAccelCount ?? 0) + (t.harshBrakeCount ?? 0)) / t.distanceKm) * 10;
}

function l100(t: TripRecord): number | null {
  const l = measuredFuelL(t);
  if (l === null || !(t.distanceKm >= 1)) return null;
  return (l / t.distanceKm) * 100;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export type Co2Status = 'OK' | 'FUEL_NOT_MEASURED' | 'FUEL_TYPE_UNKNOWN' | 'EV_GRID_UNKNOWN';
export type StyleStatus = 'OK' | 'NOT_MEASURED' | 'TOO_SHORT' | 'NOT_ENOUGH_HISTORY';

export interface TripEco {
  l100: number | null;
  co2Kg: number | null;
  co2Status: Co2Status;
  /** Rölanti bedeli (L) — TAHMİN aralığı; rölanti süresi bilinmiyorsa null. */
  idleFuelL: { min: number; max: number } | null;
  /** Benzer hızdaki sakin yolculuklarına göre tüketim farkı (%). */
  styleDeltaPct: number | null;
  styleStatus: StyleStatus;
  /** Kıyasta kullanılan temel (L/100 km) ve kaç yolculuktan. */
  baseline: { l100: number; trips: number } | null;
}

function co2For(fuelL: number | null, fuel: EcoFuelType): { co2Kg: number | null; co2Status: Co2Status } {
  if (fuel === 'ev') return { co2Kg: null, co2Status: 'EV_GRID_UNKNOWN' };
  if (fuelL === null) return { co2Kg: null, co2Status: 'FUEL_NOT_MEASURED' };
  if (fuel === 'unknown') return { co2Kg: null, co2Status: 'FUEL_TYPE_UNKNOWN' };
  return { co2Kg: r2(fuelL * CO2_KG_PER_L[fuel]), co2Status: 'OK' };
}

/** Tek yolculuğun karnesi. `history` kıyas temeli için (yolculuğun kendisi dahil olabilir, hariç tutulur). */
export function tripEco(t: TripRecord, history: readonly TripRecord[], fuel: EcoFuelType): TripEco {
  const fuelL = measuredFuelL(t);
  const own = l100(t);
  const { co2Kg, co2Status } = co2For(fuelL, fuel);

  const idleFuelL = (fuel === 'petrol' || fuel === 'diesel') && typeof t.idleMin === 'number' && t.idleMin > 0
    ? { min: r2((t.idleMin / 60) * IDLE_L_PER_H[fuel].min), max: r2((t.idleMin / 60) * IDLE_L_PER_H[fuel].max) }
    : null;

  let styleStatus: StyleStatus = 'OK';
  let styleDeltaPct: number | null = null;
  let baseline: TripEco['baseline'] = null;
  if (own === null) styleStatus = 'NOT_MEASURED';
  else if (t.distanceKm < MIN_COMPARE_KM) styleStatus = 'TOO_SHORT';
  else {
    const calm = history.filter((h) => {
      if (h.id === t.id || h.distanceKm < MIN_COMPARE_KM) return false;
      const hp = harshPer10Km(h);
      const hl = l100(h);
      return hl !== null && hp !== null && hp <= CALM_HARSH_PER_10KM
        && Math.abs(h.avgSpeedKmh - t.avgSpeedKmh) <= SPEED_BAND_KMH;
    }).map((h) => l100(h) as number);
    if (calm.length < MIN_BASELINE_TRIPS) styleStatus = 'NOT_ENOUGH_HISTORY';
    else {
      const b = median(calm);
      baseline = { l100: r1(b), trips: calm.length };
      styleDeltaPct = Math.round(((own - b) / b) * 100);
    }
  }
  return { l100: own === null ? null : r1(own), co2Kg, co2Status, idleFuelL, styleDeltaPct, styleStatus, baseline };
}

export interface WeekTotals {
  trips: number;
  km: number;
  /** Yalnız ölçülmüş yakıtlı yolculukların toplamı. */
  measuredTrips: number;
  measuredKm: number;
  fuelL: number;
  co2Kg: number | null;
  idleMin: number;
}

function weekTotals(trips: readonly TripRecord[], fuel: EcoFuelType): WeekTotals {
  let km = 0, mTrips = 0, mKm = 0, fuelL = 0, idle = 0;
  for (const t of trips) {
    km += t.distanceKm;
    idle += t.idleMin ?? 0;
    const l = measuredFuelL(t);
    if (l !== null) { mTrips++; mKm += t.distanceKm; fuelL += l; }
  }
  const co2 = mTrips > 0 ? co2For(fuelL, fuel).co2Kg : null;
  return { trips: trips.length, km: r1(km), measuredTrips: mTrips, measuredKm: r1(mKm), fuelL: r1(fuelL), co2Kg: co2 === null ? null : r1(co2), idleMin: Math.round(idle) };
}

export interface EcoInsight { kind: 'idle' | 'style' | 'trend' | 'coverage'; text: string }

export interface EcoReport {
  fuel: EcoFuelType;
  thisWeek: WeekTotals;
  lastWeek: WeekTotals;
  /** Ölçülmüş L/100 km değişimi (%) — iki haftada da ölçüm yoksa null. */
  l100ChangePct: number | null;
  insights: EcoInsight[];
}

/** Haftalık karne + kanıta dayalı öneriler (en çok 3). */
export function buildEcoReport(history: readonly TripRecord[], fuel: EcoFuelType, nowMs: number): EcoReport {
  const thisWeekTrips = history.filter((t) => t.endTime > nowMs - WEEK_MS && t.endTime <= nowMs);
  const lastWeekTrips = history.filter((t) => t.endTime > nowMs - 2 * WEEK_MS && t.endTime <= nowMs - WEEK_MS);
  const thisWeek = weekTotals(thisWeekTrips, fuel);
  const lastWeek = weekTotals(lastWeekTrips, fuel);
  const wl = (w: WeekTotals) => (w.measuredKm >= 1 ? (w.fuelL / w.measuredKm) * 100 : null);
  const a = wl(thisWeek), b = wl(lastWeek);
  const l100ChangePct = a !== null && b !== null && b > 0 ? Math.round(((a - b) / b) * 100) : null;

  const insights: EcoInsight[] = [];

  // 1) Sürüş tarzı — yalnız kendi ölçülmüş geçmişinden, benzer hız bandında
  const styled = thisWeekTrips
    .map((t) => ({ t, e: tripEco(t, history, fuel), hp: harshPer10Km(t) }))
    .filter((x) => x.e.styleDeltaPct !== null && x.hp !== null && x.hp > CALM_HARSH_PER_10KM);
  if (styled.length >= 2) {
    const avg = Math.round(styled.reduce((s, x) => s + (x.e.styleDeltaPct as number), 0) / styled.length);
    if (avg >= 8) {
      insights.push({ kind: 'style', text: `Sert hızlanma/frenli ${styled.length} yolculukta tüketim, benzer hızdaki sakin sürüşüne göre ortalama %${avg} fazlaydı.` });
    }
  }

  // 2) Rölanti — tahmin, öyle söylenir
  if ((fuel === 'petrol' || fuel === 'diesel') && thisWeek.idleMin >= 10) {
    const lo = r1((thisWeek.idleMin / 60) * IDLE_L_PER_H[fuel].min);
    const hi = r1((thisWeek.idleMin / 60) * IDLE_L_PER_H[fuel].max);
    insights.push({ kind: 'idle', text: `Bu hafta ${thisWeek.idleMin} dk rölantide bekledin — tahminen ${lo}–${hi} L yakıt.` });
  }

  // 3) Haftalık trend
  if (l100ChangePct !== null && Math.abs(l100ChangePct) >= 5) {
    insights.push({ kind: 'trend', text: l100ChangePct < 0
      ? `Ölçülen tüketimin geçen haftaya göre %${-l100ChangePct} düştü.`
      : `Ölçülen tüketimin geçen haftaya göre %${l100ChangePct} arttı.` });
  }

  // 4) Kapsama — ölçülemeyen veri gizlenmez
  if (thisWeek.trips > 0 && thisWeek.measuredTrips / thisWeek.trips < 0.5) {
    const pct = Math.round((1 - thisWeek.measuredTrips / thisWeek.trips) * 100);
    insights.push({ kind: 'coverage', text: `Bu haftaki yolculukların %${pct}'inde yakıt ölçülemedi; karne ölçülenlere dayanıyor.` });
  }

  return { fuel, thisWeek, lastWeek, l100ChangePct, insights: insights.slice(0, 3) };
}
