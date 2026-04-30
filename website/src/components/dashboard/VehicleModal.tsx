'use client';

import { useEffect, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { supabaseBrowser } from '@/lib/supabase';

interface VehicleModalProps {
  vehicle: LiveVehicle;
  onClose: () => void;
  onRemove?: (id: string) => void;
}

const statusConfig = {
  online: { label: 'Online', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  offline: { label: 'Offline', dot: 'bg-white/30', text: 'text-white/40' },
  alarm: { label: 'Alarm', dot: 'bg-red-400 animate-pulse', text: 'text-red-400' },
};

export default function VehicleModal({ vehicle: v, onClose, onRemove }: VehicleModalProps) {
  const s = statusConfig[v.status];
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleRemove() {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setRemoving(true);
    try {
      const token = (await supabaseBrowser?.auth.getSession())?.data.session?.access_token;
      const res = await fetch(`/api/vehicles/${v.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        onRemove?.(v.id);
        onClose();
      }
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-lg bg-[#0a1628] border border-white/[0.1] rounded-t-3xl sm:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden max-h-[92dvh] sm:max-h-[85vh] flex flex-col">

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-white/[0.07] flex-shrink-0">
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
            className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-5 sm:px-6 flex flex-col gap-4">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Hız', value: `${v.speed} km/h`, warn: false },
              { label: 'RPM', value: v.rpm.toLocaleString(), warn: v.rpm > 3000 },
              { label: 'Motor °C', value: `${v.engineTemp}°`, warn: v.engineTemp > 100 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center">
                <p className={`text-base font-bold font-mono ${warn ? 'text-red-400' : 'text-white/85'}`}>{value}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Sürücü', value: v.driver },
              { label: 'Konum', value: v.location },
              { label: 'Son Görülme', value: v.lastSeen },
              { label: 'Kilometre', value: `${v.odometer.toLocaleString()} km` },
            ].map(({ label, value }) => (
              <div key={label} className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <p className="text-[10px] text-white/25 mb-1">{label}</p>
                <p className="text-sm text-white/70 font-medium truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Fuel bar */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs text-white/35">Yakıt Seviyesi</span>
              <span className={`text-sm font-mono font-semibold ${v.fuel < 20 ? 'text-red-400' : v.fuel < 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {v.fuel}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${v.fuel < 20 ? 'bg-red-400' : v.fuel < 35 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${v.fuel}%` }}
              />
            </div>
            {v.fuel < 20 && (
              <p className="text-[11px] text-red-400/80 mt-2">⚠ Yakıt ikmali gerekiyor</p>
            )}
          </div>

          {/* Safe bottom padding for mobile */}
          <div className="sm:hidden h-2" />
        </div>

        {/* Footer — remove button */}
        {onRemove && (
          <div className="flex-shrink-0 px-5 pb-5 sm:px-6 sm:pb-6 pt-3 border-t border-white/[0.07]">
            <button
              onClick={handleRemove}
              disabled={removing}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all border ${
                confirmRemove
                  ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                  : 'bg-white/[0.03] border-white/[0.07] text-white/40 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/[0.07]'
              }`}
            >
              {removing ? 'Kaldırılıyor…' : confirmRemove ? 'Emin misin? Tekrar tıkla' : 'Aracı Listeden Kaldır'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
