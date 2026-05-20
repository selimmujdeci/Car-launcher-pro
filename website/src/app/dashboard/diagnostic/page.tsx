'use client';

import { useVehicleStore } from '@/store/vehicleStore';

const severityConfig = {
  high:   { bg: 'bg-red-500/[0.08]',   border: 'border-red-500/25',   badge: 'bg-red-500/15 text-red-400 border-red-500/20',     label: 'Kritik' },
  medium: { bg: 'bg-amber-500/[0.06]', border: 'border-amber-500/20', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20', label: 'Orta'   },
  low:    { bg: 'bg-white/[0.03]',     border: 'border-white/[0.07]', badge: 'bg-white/[0.06] text-white/40 border-white/[0.1]',  label: 'Düşük'  },
};

export default function DiagnosticPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const alarmVehicle = vehicles.find((v) => v.status === 'alarm');

  return (
    <>
      {/* Aktif alarm */}
      {alarmVehicle && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/[0.08] border border-red-500/25 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2l7 13.5H2L9 2z" stroke="#f87171" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M9 8v3M9 13v.5" stroke="#f87171" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400">Aktif Alarm — {alarmVehicle.plate}</p>
            <p className="text-xs text-white/40 mt-0.5">
              Motor sıcaklığı {alarmVehicle.engineTemp}°C · Hız {alarmVehicle.speed} km/h
            </p>
          </div>
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
        </div>
      )}

      {/* Araç sağlık özeti */}
      {vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-white/30 text-sm">Henüz bağlı araç yok.</p>
          <p className="text-white/20 text-xs mt-2">Araçlar → Araç Bağla ile ekleyin.</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            {vehicles.map((v) => (
              <div key={v.id} className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-mono text-xs text-white/70">{v.plate || v.id.slice(0, 8)}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    v.status === 'alarm'  ? 'bg-red-500/15 text-red-400 border-red-500/25' :
                    v.status === 'online' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
                    'bg-white/[0.04] text-white/25 border-white/[0.08]'
                  }`}>
                    {v.status === 'alarm' ? 'Alarm' : v.status === 'online' ? 'Normal' : 'Offline'}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {[
                    { label: 'Motor Isısı', value: `${v.engineTemp}°C`, warn: v.engineTemp > 100 },
                    { label: 'RPM',         value: v.rpm.toLocaleString(), warn: v.rpm > 3000 },
                    { label: 'Yakıt',       value: `${v.fuel}%`, warn: v.fuel < 20 },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[11px] text-white/30">{label}</span>
                      <span className={`text-xs font-mono font-medium ${warn ? 'text-red-400' : 'text-white/60'}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* DTC kodları — şimdilik boş, araçtan veri gelince dolu olacak */}
          <h2 className="text-sm font-semibold text-white/70 mb-3">Arıza Kodları (DTC)</h2>
          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.07] text-center">
            <p className="text-white/30 text-sm">Araçtan henüz arıza kodu gelmedi.</p>
          </div>
        </>
      )}
    </>
  );
}
