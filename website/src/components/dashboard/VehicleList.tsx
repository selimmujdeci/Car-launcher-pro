import { Vehicle } from '@/lib/mockData';

interface VehicleListProps {
  vehicles: Vehicle[];
  onSelect?: (v: Vehicle) => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', dot: 'bg-white/20', text: 'text-white/35' },
  alarm: { label: 'Alarm', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

export default function VehicleList({ vehicles, onSelect }: VehicleListProps) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-white/[0.05] text-[11px] font-semibold tracking-wide text-white/25 uppercase">
        <div className="col-span-3">Araç / Plaka</div>
        <div className="col-span-2">Sürücü</div>
        <div className="col-span-2">Durum</div>
        <div className="col-span-3">Konum</div>
        <div className="col-span-1 text-right">Hız</div>
        <div className="col-span-1 text-right">Yakıt</div>
      </div>

      {/* Rows */}
      {vehicles.map((v) => {
        const s = statusConfig[v.status];
        return (
          <div
            key={v.id}
            onClick={() => onSelect?.(v)}
            className={`grid grid-cols-12 gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0 text-sm transition-colors ${
              onSelect ? 'cursor-pointer hover:bg-white/[0.03]' : ''
            }`}
          >
            {/* Plate + name */}
            <div className="col-span-3">
              <p className="font-mono text-white/80 text-xs">{v.plate}</p>
              <p className="text-[11px] text-white/35 mt-0.5">{v.name}</p>
            </div>

            {/* Driver */}
            <div className="col-span-2 flex items-center">
              <span className="text-xs text-white/50 truncate">{v.driver}</span>
            </div>

            {/* Status */}
            <div className="col-span-2 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
              <span className={`text-xs font-medium ${s.text}`}>{s.label}</span>
            </div>

            {/* Location */}
            <div className="col-span-3 flex items-center">
              <span className="text-xs text-white/45 truncate">{v.location}</span>
            </div>

            {/* Speed */}
            <div className="col-span-1 flex items-center justify-end">
              <span className={`text-xs font-mono font-medium ${v.speed > 0 ? 'text-white/70' : 'text-white/25'}`}>
                {v.speed} <span className="text-white/20 text-[10px]">km/h</span>
              </span>
            </div>

            {/* Fuel */}
            <div className="col-span-1 flex items-center justify-end">
              <span className={`text-xs font-mono font-medium ${
                v.fuel < 20 ? 'text-red-400' : v.fuel < 35 ? 'text-amber-400' : 'text-white/60'
              }`}>
                {v.fuel}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
