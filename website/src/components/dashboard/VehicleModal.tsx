'use client';

import { useEffect } from 'react';
import { Vehicle } from '@/lib/mockData';

interface VehicleModalProps {
  vehicle: Vehicle;
  onClose: () => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', dot: 'bg-white/30', text: 'text-white/40' },
  alarm: { label: 'Alarm', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

export default function VehicleModal({ vehicle: v, onClose }: VehicleModalProps) {
  const s = statusConfig[v.status];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#0a1628] border border-white/[0.1] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.07]">
          <div>
            <div className="flex items-center gap-3">
              <p className="font-mono text-base font-semibold text-white">{v.plate}</p>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </div>
            </div>
            <p className="text-xs text-white/35 mt-0.5">{v.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Hız', value: `${v.speed} km/h`, warn: false },
              { label: 'RPM', value: v.rpm.toLocaleString(), warn: v.rpm > 3000 },
              { label: 'Motor Isısı', value: `${v.engineTemp}°C`, warn: v.engineTemp > 100 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
                <p className={`text-base font-bold font-mono ${warn ? 'text-red-400' : 'text-white/85'}`}>{value}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Sürücü', value: v.driver },
              { label: 'Konum', value: v.location },
              { label: 'Son Görülme', value: v.lastSeen },
              { label: 'Kilometre', value: `${v.odometer.toLocaleString()} km` },
            ].map(({ label, value }) => (
              <div key={label} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <p className="text-[10px] text-white/25 mb-1">{label}</p>
                <p className="text-sm text-white/70 font-medium truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Fuel bar */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/35">Yakıt Seviyesi</span>
              <span className={`text-sm font-mono font-semibold ${v.fuel < 20 ? 'text-red-400' : v.fuel < 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {v.fuel}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${v.fuel < 20 ? 'bg-red-400' : v.fuel < 35 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${v.fuel}%` }}
              />
            </div>
            {v.fuel < 20 && (
              <p className="text-[11px] text-red-400/80 mt-2">⚠ Yakıt ikmali gerekiyor</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
