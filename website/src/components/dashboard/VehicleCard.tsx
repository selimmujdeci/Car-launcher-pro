import type { LiveVehicle } from '@/types/realtime';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import {
  measurementLabel,
  locationLabel,
  ageLabel,
  dataSourceLabel,
  type Measurement,
  type VehicleFreshness,
} from '@/lib/fleet/vehicleTelemetryFreshness';

interface VehicleCardProps {
  vehicle: LiveVehicle;
  onClick: (v: LiveVehicle) => void;
}

const statusConfig = {
  online: { label: 'Online', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', bg: 'bg-white/[0.03]', border: 'border-white/[0.07]', dot: 'bg-white/20', text: 'text-white/35' },
  alarm: { label: 'Alarm', bg: 'bg-red-500/[0.07]', border: 'border-red-500/25', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

/** Ölçüm rengi. Bilinmeyen veri UYARI RENGİ ALMAZ — sahte alarm yasak. */
function measurementTone(m: Measurement | undefined, warnBelow?: number, alertBelow?: number): string {
  if (!m || m.value === null) return 'text-white/30';       // veri yok → nötr
  if (m.state !== 'LIVE') return 'text-white/40';           // eski veri → soluk
  if (alertBelow !== undefined && m.value < alertBelow) return 'text-red-400';
  if (warnBelow  !== undefined && m.value < warnBelow)  return 'text-amber-400';
  return 'text-white/70';
}

export default function VehicleCard({ vehicle: v, onClick }: VehicleCardProps) {
  const s = statusConfig[v.status];
  const t: VehicleFreshness | undefined = v.telemetry;

  /* Yakıt çubuğu: değer BİLİNMİYORSA çubuk çizilmez.
     Önceden bilinmeyen yakıt `0` olduğu için kart KIRMIZI BOŞ çubuk
     gösteriyordu — yani "yakıt bitti" sahte alarmı üretiyordu. */
  const fuel = t?.fuelPercent;
  const fuelKnown = fuel?.value !== null && fuel?.value !== undefined;
  const fuelPct = fuelKnown ? Math.max(0, Math.min(100, fuel!.value as number)) : 0;
  const fuelBarTone =
    !fuelKnown ? 'bg-white/10'
    : fuel!.state !== 'LIVE' ? 'bg-white/25'
    : fuelPct < 20 ? 'bg-red-400'
    : fuelPct < 35 ? 'bg-amber-400'
    : 'bg-emerald-400';

  return (
    <button
      onClick={() => onClick(v)}
      className={`w-full text-left p-5 rounded-2xl ${s.bg} border ${s.border} hover:brightness-110 transition-all duration-150 group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className={`text-sm text-white/80 font-medium ${isFallbackTitle(v) ? '' : 'font-mono'}`}>
            {vehicleTitle(v)}
          </p>
          <p className="text-xs text-white/40 mt-0.5">{vehicleSubtitle(v) ?? 'İsim verilmedi'}</p>
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] font-medium ${s.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
          {s.label}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Sürücü</p>
          <p className="text-xs text-white/60 truncate">{v.driver}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Konum</p>
          {/* Bayat konum "şu anki konum" gibi sunulmaz. */}
          <p className="text-xs text-white/60 truncate" title={t ? dataSourceLabel(t.locationSource) : undefined}>
            {t ? locationLabel(t) : v.location}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Hız</p>
          <p className={`text-xs font-mono font-medium ${measurementTone(t?.speedKmh)}`}>
            {t ? measurementLabel(t.speedKmh, 'km/h') : 'Veri yok'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Yakıt</p>
          <p className={`text-xs font-mono font-medium ${measurementTone(fuel, 35, 20)}`}>
            {t ? measurementLabel(t.fuelPercent, '%').replace(' %', '%') : 'Veri yok'}
          </p>
        </div>
      </div>

      {/* Fuel bar — bilinmeyen yakıt için dolgu ÇİZİLMEZ */}
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        {fuelKnown && (
          <div
            className={`h-full rounded-full transition-all ${fuelBarTone}`}
            style={{ width: `${fuelPct}%` }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <p className="text-[10px] text-white/25">
          Son görülme: {t ? ageLabel(t.deviceAgeMs) : v.lastSeen}
        </p>
        <span className="text-[10px] text-accent/60 group-hover:text-accent transition-colors">Detay →</span>
      </div>
    </button>
  );
}
