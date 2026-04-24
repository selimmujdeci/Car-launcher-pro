import type { LiveVehicle } from '@/types/realtime';

interface VehicleListProps {
  vehicles: LiveVehicle[];
  onSelect?: (v: LiveVehicle) => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', dot: 'bg-white/20', text: 'text-white/35' },
  alarm: { label: 'Alarm', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

export default function VehicleList({ vehicles, onSelect }: VehicleListProps) {
  if (vehicles.length === 0) {
    return (
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-5 py-10 text-center text-sm text-white/25">
        Araç bulunamadı.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden divide-y divide-white/[0.04]">
      {vehicles.map((v) => {
        const s = statusConfig[v.status];
        return (
          <div
            key={v.id}
            onClick={() => onSelect?.(v)}
            className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${
              onSelect ? 'cursor-pointer hover:bg-white/[0.03] active:bg-white/[0.05]' : ''
            }`}
          >
            {/* Status dot */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />

            {/* Vehicle info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-semibold text-white/85">{v.plate}</span>
                <span className="text-[10px] text-white/35 truncate">{v.name}</span>
              </div>
              <div className="text-[11px] text-white/30 mt-0.5 truncate">
                {v.location}
                {v.driver && <span className="text-white/20"> · {v.driver}</span>}
              </div>
            </div>

            {/* Right-side metrics */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`text-[10px] font-semibold ${s.text}`}>{s.label}</span>
              <div className="flex items-center gap-2.5">
                <span className={`text-[11px] font-mono ${v.speed > 0 ? 'text-white/60' : 'text-white/25'}`}>
                  {v.speed}<span className="text-[9px] text-white/20 ml-0.5">km/h</span>
                </span>
                <span className={`text-[11px] font-mono font-medium ${
                  v.fuel < 20 ? 'text-red-400' : v.fuel < 35 ? 'text-amber-400' : 'text-white/50'
                }`}>
                  {v.fuel}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
