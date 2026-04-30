import { useSystemStore } from '../../store/useSystemStore';

export function GeofenceAlarmOverlay() {
  const alarm      = useSystemStore((s) => s.geofenceAlarm);
  const clearAlarm = useSystemStore((s) => s.setGeofenceAlarm);

  if (!alarm) return null;

  const time = new Date(alarm.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center"
      style={{ background: 'rgba(220,38,38,0.18)', backdropFilter: 'blur(6px)' }}
    >
      {/* Kırmızı alarm kutusu */}
      <div
        className="flex flex-col items-center gap-4 px-8 py-7 rounded-3xl text-center"
        style={{
          background: 'linear-gradient(145deg,#7f1d1d,#991b1b)',
          border:     '2px solid rgba(248,113,113,0.6)',
          boxShadow:  '0 0 60px rgba(239,68,68,0.5), 0 8px 40px rgba(0,0,0,0.6)',
          minWidth:   280,
          maxWidth:   420,
        }}
      >
        {/* İkon */}
        <div className="text-5xl animate-pulse">🚨</div>

        {/* Başlık */}
        <div>
          <div className="text-red-200 text-xs font-bold uppercase tracking-widest mb-1">
            Geofence İhlali
          </div>
          <div className="text-white text-xl font-black leading-tight">
            Araç bölgeden ayrıldı
          </div>
        </div>

        {/* Zona bilgisi */}
        <div
          className="px-4 py-2 rounded-xl text-sm font-semibold text-red-100"
          style={{ background: 'rgba(0,0,0,0.3)' }}
        >
          Bölge: <span className="text-white">{alarm.zoneName}</span>
          <span className="ml-2 text-red-300 text-xs">{time}</span>
        </div>

        {/* Kapat butonu */}
        <button
          onClick={() => clearAlarm(null)}
          className="mt-1 px-6 py-2 rounded-xl text-sm font-bold text-white active:scale-95 transition-transform"
          style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}
        >
          Tamam
        </button>
      </div>
    </div>
  );
}
