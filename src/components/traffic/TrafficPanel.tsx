import { useTrafficState, TRAFFIC_COLORS, type TrafficSource } from '../../platform/trafficService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { Signal, Clock } from 'lucide-react';
import { TrafficMapMini } from './TrafficMapMini';

const LEVEL_LABELS: Record<string, string> = {
  free: 'Akıcı', moderate: 'Orta', heavy: 'Yoğun', standstill: 'Tıkalı',
};

const SOURCE_META: Record<TrafficSource, { label: string; color: string }> = {
  here:      { label: 'HERE Canlı',   color: '#34d399' },
  tomtom:    { label: 'TomTom Canlı', color: '#34d399' },
  estimated: { label: 'Tahmini',      color: '#f59e0b' },
};

// İstanbul varsayılan — GPS yoksa
const DEFAULT_LAT = 41.015;
const DEFAULT_LNG = 28.979;

export function TrafficPanel() {
  const traffic  = useTrafficState();
  const s        = traffic.summary;
  const location = useUnifiedVehicleStore(st => st.location);

  const lat = location?.latitude  ?? DEFAULT_LAT;
  const lng = location?.longitude ?? DEFAULT_LNG;

  const meta = s ? SOURCE_META[s.source] : null;

  return (
    <div className="p-4 space-y-3">
      {/* ── Başlık ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-white text-xl font-bold">Trafik Durumu</h2>
        {meta && (
          <span
            className="flex items-center gap-1 text-[10px] border rounded px-2 py-0.5 uppercase tracking-widest font-bold"
            style={{ color: meta.color, borderColor: `${meta.color}40` }}
          >
            {s!.source === 'estimated' ? <Clock size={10} /> : <Signal size={10} />}
            {meta.label}
          </span>
        )}
      </div>

      {/* ── Mini harita ── */}
      {(lat !== DEFAULT_LAT || lng !== DEFAULT_LNG || s) && (
        <TrafficMapMini
          lat={lat}
          lng={lng}
          segments={s?.segments ?? []}
          tileUrl={traffic.tileLayerUrl || undefined}
        />
      )}

      {/* ── Yükleniyor ── */}
      {traffic.loading && !s && (
        <p className="text-white/60 text-sm">Trafik verisi alınıyor…</p>
      )}
      {!traffic.loading && !s && (
        <p className="text-white/60 text-sm">Veri yok — GPS bekleniyor</p>
      )}

      {/* ── Özet + segment listesi ── */}
      {s && (
        <>
          {/* Genel durum kartı */}
          <div
            className="flex items-center gap-3 p-3 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <span
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: TRAFFIC_COLORS[s.level] }}
            />
            <div>
              <p className="text-white font-semibold text-base">
                {LEVEL_LABELS[s.level] ?? s.level}
              </p>
              {s.delayMin > 0 && (
                <p className="text-white/60 text-sm">Tahmini gecikme: ~{s.delayMin} dk</p>
              )}
            </div>
          </div>

          {/* Segment listesi */}
          <div className="space-y-1.5">
            {s.segments.map((seg, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: TRAFFIC_COLORS[seg.level] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white/85 text-sm font-semibold truncate">{seg.label}</p>
                  {seg.direction && (
                    <p className="text-white/50 text-xs truncate">{seg.direction}</p>
                  )}
                </div>
                {seg.delayMin > 0 && (
                  <span className="text-white/55 text-xs flex-shrink-0">+{seg.delayMin} dk</span>
                )}
              </div>
            ))}
          </div>

          {/* Güncelleme zamanı */}
          <p className="text-white/35 text-xs text-center pt-1">
            {new Date(s.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} güncellendi
          </p>
        </>
      )}
    </div>
  );
}
