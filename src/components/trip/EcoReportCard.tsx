/**
 * EcoReportCard — Yakıt & CO₂ karnesi (Seyir Defteri).
 *
 * Hesap `ecoReportModel`de (SAF). Bu bileşen yalnız gösterir; ölçülmeyen değer
 * için sayı basmaz, NEDEN'ini yazar.
 */
import { memo, useMemo } from 'react';
import { Leaf, Info } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { TripRecord } from '../../platform/tripLogService';
import {
  buildEcoReport, tripEco, fuelTypeFromVehicle,
  type EcoFuelType, type TripEco, type WeekTotals,
} from '../../platform/trip/ecoReportModel';

/** Aktif araç profilinin yakıt tipi (profil yoksa 'unknown'). */
function useEcoFuelType(): EcoFuelType {
  return useStore((s) => {
    const id = s.settings.activeVehicleProfileId;
    const p = id ? s.settings.vehicleProfiles.find((x) => x.id === id) : undefined;
    return fuelTypeFromVehicle(p?.vehicleType);
  });
}

const CO2_REASON: Record<TripEco['co2Status'], string> = {
  OK: '',
  FUEL_NOT_MEASURED: 'yakıt ölçülmedi',
  FUEL_TYPE_UNKNOWN: 'yakıt tipi seçilmedi',
  EV_GRID_UNKNOWN: 'elektrikli — şebeke karışımı bilinmiyor',
};

function WeekCol({ title, w, fuel }: { title: string; w: WeekTotals; fuel: EcoFuelType }) {
  const l100 = w.measuredKm >= 1 ? ((w.fuelL / w.measuredKm) * 100).toFixed(1) : null;
  return (
    <div className="flex-1 min-w-0">
      <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">{title}</div>
      <div className="text-primary font-black text-lg tabular-nums leading-tight">
        {w.co2Kg !== null ? <>{w.co2Kg}<span className="text-xs font-bold text-slate-500 ml-1">kg CO₂</span></> : '—'}
      </div>
      <div className="text-slate-400 text-[11px] mt-0.5 tabular-nums">
        {w.trips} yolculuk · {w.km} km{l100 ? ` · ${l100} L/100` : ''}
      </div>
      {w.co2Kg === null && w.trips > 0 && (
        <div className="text-slate-500 text-[10px] mt-0.5">
          {fuel === 'ev' ? 'elektrikli' : fuel === 'unknown' ? 'yakıt tipi seçilmedi' : 'yakıt ölçülemedi'}
        </div>
      )}
    </div>
  );
}

function EcoReportCardInner({ history, nowMs }: { history: readonly TripRecord[]; nowMs: number }) {
  const fuel = useEcoFuelType();
  const report = useMemo(() => buildEcoReport(history, fuel, nowMs), [history, fuel, nowMs]);
  if (report.thisWeek.trips === 0 && report.lastWeek.trips === 0) return null;
  return (
    <div className="rounded-2xl p-4 border bg-[var(--oem-good-soft)] border-[var(--oem-good)]"
      data-editable="trip.eco-report" data-editable-type="card">
      <div className="flex items-center gap-2 mb-3">
        <Leaf className="w-4 h-4 text-[color:var(--oem-good)]" />
        <span className="text-primary font-black text-xs uppercase tracking-widest">Yakıt & CO₂ karnesi</span>
        {report.l100ChangePct !== null && (
          <span className={`ml-auto text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg ${
            report.l100ChangePct <= 0
              ? 'bg-[var(--oem-good-soft)] text-[color:var(--oem-good)]'
              : 'bg-[var(--oem-warn-soft)] text-[color:var(--oem-warn)]'}`}>
            {report.l100ChangePct > 0 ? '+' : ''}{report.l100ChangePct}% L/100
          </span>
        )}
      </div>
      <div className="flex gap-4">
        <WeekCol title="Bu hafta" w={report.thisWeek} fuel={fuel} />
        <WeekCol title="Geçen hafta" w={report.lastWeek} fuel={fuel} />
      </div>
      {report.insights.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-[var(--oem-line)]">
          {report.insights.map((i) => (
            <div key={i.kind} className="flex items-start gap-2 text-[12px] leading-snug text-slate-300">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[color:var(--oem-good)]" />
              <span>{i.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const EcoReportCard = memo(EcoReportCardInner);

/** Yolculuk kartı alt satırı: L/100 · CO₂ · sürüş tarzı farkı (kanıt yoksa neden). */
export const TripEcoLine = memo(function TripEcoLine({ trip, history }: { trip: TripRecord; history: readonly TripRecord[] }) {
  const fuel = useEcoFuelType();
  const e = useMemo(() => tripEco(trip, history, fuel), [trip, history, fuel]);
  const parts: string[] = [];
  if (e.l100 !== null) parts.push(`${e.l100} L/100`);
  parts.push(e.co2Kg !== null ? `${e.co2Kg} kg CO₂` : `CO₂ — ${CO2_REASON[e.co2Status]}`);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-[var(--oem-line)] text-[11px]">
      <span className="text-slate-400 tabular-nums">{parts.join(' · ')}</span>
      {e.styleDeltaPct !== null && e.baseline && (
        <span className={`font-bold tabular-nums ${e.styleDeltaPct > 5 ? 'text-[color:var(--oem-warn)]' : 'text-[color:var(--oem-good)]'}`}
          title={`Benzer hızdaki ${e.baseline.trips} sakin yolculuğunun ortancası: ${e.baseline.l100} L/100`}>
          {e.styleDeltaPct > 0 ? '+' : ''}{e.styleDeltaPct}% sakin sürüşüne göre
        </span>
      )}
      {e.idleFuelL && (
        <span className="text-slate-500">rölanti ~{e.idleFuelL.min}–{e.idleFuelL.max} L (tahmini)</span>
      )}
    </div>
  );
});
