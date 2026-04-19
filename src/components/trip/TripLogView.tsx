import { memo, useCallback } from 'react';
import {
  Route, Clock, Zap, Fuel, Trash2,
  TrendingUp, Activity, AlertCircle,
} from 'lucide-react';
import { useTripState, deleteTrip, clearAllTrips, type TripRecord } from '../../platform/tripLogService';

/* ── Helpers ─────────────────────────────────────────────── */

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

/* ── Trip card ───────────────────────────────────────────── */

const TripCard = memo(function TripCard({ trip }: { trip: TripRecord }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-primary font-bold text-sm">{fmtDate(trip.startTime)}</div>
          <div className="text-slate-500 text-xs mt-0.5">
            {fmtTime(trip.startTime)} → {fmtTime(trip.endTime)}
          </div>
        </div>
        <button
          onClick={() => deleteTrip(trip.id)}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors active:scale-90"
          title="Seyahati sil"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2">
        <Stat icon={Route} color="blue" value={String(trip.distanceKm)} unit="km" label="Mesafe" />
        <Stat icon={Clock} color="purple" value={fmtDuration(trip.durationMin)} unit="" label="Süre" />
        <Stat icon={Zap} color="emerald" value={String(trip.avgSpeedKmh)} unit="km/h" label="Ort. Hız" />
        <Stat icon={Fuel} color="amber" value={`${trip.fuelCostTL}₺`} unit="" label="Yakıt" />
      </div>

      {/* Sub-stats */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5">
        <div className="text-[11px] text-slate-600">
          Maks <span className="text-slate-400 font-bold">{trip.maxSpeedKmh} km/h</span>
        </div>
        <div className="text-[11px] text-slate-600">
          Yakıt <span className="text-slate-400 font-bold">{trip.fuelConsumptionL} L</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-slate-600 uppercase tracking-wide">Sürüş</span>
          <span className={`text-xs font-black tabular-nums px-2 py-0.5 rounded-lg ${
            trip.drivingScore >= 80
              ? 'bg-emerald-500/15 text-emerald-400'
              : trip.drivingScore >= 60
              ? 'bg-amber-500/15 text-amber-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {trip.drivingScore}
          </span>
        </div>
      </div>
    </div>
  );
});

/* ── Stat cell ───────────────────────────────────────────── */

type StatColor = 'blue' | 'purple' | 'emerald' | 'amber';

const COLOR_MAP: Record<StatColor, { icon: string; bg: string; border: string }> = {
  blue:    { icon: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  purple:  { icon: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20' },
  emerald: { icon: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  amber:   { icon: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
};

function Stat({
  icon: Icon,
  color,
  value,
  unit,
  label,
}: {
  icon: typeof Route;
  color: StatColor;
  value: string;
  unit: string;
  label: string;
}) {
  const cfg = COLOR_MAP[color];
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl p-2 border ${cfg.bg} ${cfg.border}`}>
      <Icon className={`w-4 h-4 ${cfg.icon}`} />
      <span className="text-primary font-black text-sm tabular-nums leading-none">{value}</span>
      {unit && <span className="text-[9px] text-slate-600">{unit}</span>}
      <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
  );
}

/* ── Main view ───────────────────────────────────────────── */

function TripLogViewInner() {
  const trip = useTripState();

  const liveDurationMin = trip.active && trip.current
    ? trip.current.liveDurationMin
    : 0;

  const handleClearAll = useCallback(() => {
    if (window.confirm('Tüm seyahat geçmişi silinsin mi?')) clearAllTrips();
  }, []);


  return (
    <div className="flex flex-col gap-4 p-4 pb-6" data-editable="trip-log" data-editable-type="card">

      {/* ── Title ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Route className="w-5 h-5 text-blue-400" />
          <span className="text-primary font-black text-base uppercase tracking-widest">Seyir Defteri</span>
        </div>
        {trip.history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-slate-500 hover:text-red-400 text-[11px] uppercase tracking-widest transition-colors"
          >
            Temizle
          </button>
        )}
      </div>

      {/* ── Active trip ────────────────────────────────── */}
      {trip.active && trip.current && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-emerald-400 text-xs font-black uppercase tracking-widest">
              Aktif Sürüş
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-primary font-black text-2xl tabular-nums">
                {trip.current.distanceKm.toFixed(1)}
              </div>
              <div className="text-slate-500 text-[10px] uppercase mt-0.5">km</div>
            </div>
            <div>
              <div className="text-primary font-black text-2xl">
                {fmtDuration(liveDurationMin)}
              </div>
              <div className="text-slate-500 text-[10px] uppercase mt-0.5">süre</div>
            </div>
            <div>
              <div className="text-primary font-black text-2xl tabular-nums">
                {trip.current.maxSpeedKmh}
              </div>
              <div className="text-slate-500 text-[10px] uppercase mt-0.5">max km/h</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard
          icon={TrendingUp}
          color="blue"
          value={trip.totalDistanceKm.toFixed(0)}
          unit="km"
          label="Toplam Mesafe"
        />
        <SummaryCard
          icon={Activity}
          color="purple"
          value={String(trip.totalTrips)}
          unit=""
          label="Toplam Seyahat"
        />
      </div>

      {/* ── History ────────────────────────────────────── */}
      <div>
        <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-3">
          Geçmiş Seyahatler
        </div>

        {trip.history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-blue-400/70" />
            </div>
            <div className="text-slate-300 font-bold text-sm">
              Henüz kayıtlı seyahat yok
            </div>
            <div className="text-slate-500 text-xs leading-relaxed max-w-[240px]">
              OBD bağlantısı ile sürmeye başladığınızda seyahatler otomatik olarak kaydedilir
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {trip.history.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  color,
  value,
  unit,
  label,
}: {
  icon: typeof TrendingUp;
  color: StatColor;
  value: string;
  unit: string;
  label: string;
}) {
  const cfg = COLOR_MAP[color];
  return (
    <div className={`flex items-center gap-3 rounded-2xl p-4 border ${cfg.bg} ${cfg.border}`}>
      <Icon className={`w-8 h-8 flex-shrink-0 ${cfg.icon}`} />
      <div>
        <div className="text-primary font-black text-xl tabular-nums leading-none">
          {value}{unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
        </div>
        <div className="text-slate-500 text-xs mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export const TripLogView = memo(TripLogViewInner);


