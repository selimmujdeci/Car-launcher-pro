import type { LiveVehicle } from '@/types/realtime';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';

interface VehicleListProps {
  vehicles: LiveVehicle[];
  onSelect?: (v: LiveVehicle) => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-verified', text: 'text-verified' },
  offline: { label: 'Offline', dot: 'bg-white/20', text: 'text-t3' },
  alarm: { label: 'Alarm', dot: 'bg-critical animate-pulse', text: 'text-critical' },
};

export default function VehicleList({ vehicles, onSelect }: VehicleListProps) {
  if (vehicles.length === 0) {
    return (
      <div className="rounded-sm bg-bezel border border-hair px-5 py-10 text-center text-sm text-t3">
        Araç bulunamadı.
      </div>
    );
  }

  return (
    <div className="rounded-sm bg-bezel border border-hair overflow-hidden divide-y divide-white/[0.04]">
      {vehicles.map((v) => {
        const s = statusConfig[v.status];
        return (
          <div
            key={v.id}
            onClick={() => onSelect?.(v)}
            className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${
              onSelect ? 'cursor-pointer hover:bg-bezel active:bg-bezel' : ''
            }`}
          >
            {/* Status dot */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />

            {/* Vehicle info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold text-t1 ${isFallbackTitle(v) ? '' : 'font-mono'}`}>
                  {vehicleTitle(v)}
                </span>
                {vehicleSubtitle(v) && (
                  <span className="text-[10px] text-t3 truncate">{vehicleSubtitle(v)}</span>
                )}
              </div>
              <div className="text-[11px] text-t3 mt-0.5 truncate">
                {v.location}
                {v.driver && <span className="text-t3"> · {v.driver}</span>}
              </div>
            </div>

            {/* Right-side metrics */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`text-[10px] font-semibold ${s.text}`}>{s.label}</span>
              <div className="flex items-center gap-2.5">
                <span className={`text-[11px] font-mono ${v.speed > 0 ? 'text-t2' : 'text-t3'}`}>
                  {v.speed}<span className="text-[9px] text-t3 ml-0.5">km/h</span>
                </span>
                <span className={`text-[11px] font-mono font-medium ${
                  v.fuel < 20 ? 'text-critical' : v.fuel < 35 ? 'text-warning' : 'text-t2'
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
