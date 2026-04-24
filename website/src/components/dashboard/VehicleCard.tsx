import type { LiveVehicle } from '@/types/realtime';

interface VehicleCardProps {
  vehicle: LiveVehicle;
  onClick: (v: LiveVehicle) => void;
}

const statusConfig = {
  online: { label: 'Online', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', bg: 'bg-white/[0.03]', border: 'border-white/[0.07]', dot: 'bg-white/20', text: 'text-white/35' },
  alarm: { label: 'Alarm', bg: 'bg-red-500/[0.07]', border: 'border-red-500/25', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

export default function VehicleCard({ vehicle: v, onClick }: VehicleCardProps) {
  const s = statusConfig[v.status];

  return (
    <button
      onClick={() => onClick(v)}
      className={`w-full text-left p-5 rounded-2xl ${s.bg} border ${s.border} hover:brightness-110 transition-all duration-150 group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-mono text-sm text-white/80 font-medium">{v.plate}</p>
          <p className="text-xs text-white/40 mt-0.5">{v.name}</p>
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
          <p className="text-xs text-white/60 truncate">{v.location}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Hız</p>
          <p className={`text-xs font-mono font-medium ${v.speed > 0 ? 'text-white/70' : 'text-white/30'}`}>
            {v.speed} km/h
          </p>
        </div>
        <div>
          <p className="text-[10px] text-white/25 mb-0.5">Yakıt</p>
          <p className={`text-xs font-mono font-medium ${v.fuel < 20 ? 'text-red-400' : v.fuel < 35 ? 'text-amber-400' : 'text-white/70'}`}>
            {v.fuel}%
          </p>
        </div>
      </div>

      {/* Fuel bar */}
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${v.fuel < 20 ? 'bg-red-400' : v.fuel < 35 ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${v.fuel}%` }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <p className="text-[10px] text-white/25">Son görülme: {v.lastSeen}</p>
        <span className="text-[10px] text-accent/60 group-hover:text-accent transition-colors">Detay →</span>
      </div>
    </button>
  );
}
