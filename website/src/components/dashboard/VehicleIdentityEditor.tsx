'use client';

/**
 * ARAÇ KİMLİĞİ DÜZENLEYİCİ — #661.
 *
 * Kullanıcı şikâyeti: *"araca isim koyma yok"*. Panelde araç, plaka alanında
 * kendi UUID'siyle görünüyordu ve kimliği düzenleyecek hiçbir yüzey yoktu.
 *
 * Sözleşme:
 *  - yazma TEK yerden (`updateVehicleIdentity` → `PATCH /api/vehicles/:id`),
 *  - sunucu 0 satır etkilerse hata GÖSTERİLİR (sessiz "kaydedildi" YOK),
 *  - yerel durum yalnız sunucu onayından SONRA tazelenir.
 */

import { useEffect, useRef, useState } from 'react';
import { updateVehicleIdentity } from '@/lib/vehicles.service';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  IDENTITY_LIMITS,
  validateIdentityPatch,
  vehicleShortId,
} from '@/lib/vehicleDisplay';
import type { LiveVehicle } from '@/types/realtime';

interface Props {
  vehicle: LiveVehicle;
  onClose: () => void;
  onSaved?: () => void;
}

function normalize(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '—' || trimmed === '-' || trimmed === '--') return '';
  if (trimmed === 'Araç') return '';
  return trimmed;
}

export default function VehicleIdentityEditor({ vehicle, onClose, onSaved }: Props) {
  const patchIdentity = useVehicleStore((s) => s.patchVehicleIdentity);

  const [plate,  setPlate]  = useState(() => normalize(vehicle.plate));
  const [name,   setName]   = useState(() => normalize(vehicle.name));
  const [driver, setDriver] = useState(() => normalize(vehicle.driver));
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function save() {
    setError(null);

    const validation = validateIdentityPatch({ plate, name, driver });
    if (!validation.ok) { setError(validation.error); return; }

    setSaving(true);
    const result = await updateVehicleIdentity(vehicle.id, { plate, name, driver });
    if (!mountedRef.current) return;
    setSaving(false);

    if (!result.ok) { setError(result.error); return; }

    patchIdentity(vehicle.id, {
      plate:  validation.patch.plate,
      name:   validation.patch.name,
      driver: validation.patch.driver_name,
    });
    onSaved?.();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-[#0a1628] border border-white/[0.1] rounded-t-3xl sm:rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 py-4 border-b border-white/[0.07]">
          <p className="text-sm font-semibold text-white">Araç kimliği</p>
          <p className="text-[11px] text-white/35 mt-0.5 font-mono">{vehicleShortId(vehicle.id)}</p>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {[
            { label: 'Plaka',  value: plate,  set: setPlate,  max: IDENTITY_LIMITS.PLATE_MAX,  ph: '06 ABC 123', mono: true  },
            { label: 'İsim',   value: name,   set: setName,   max: IDENTITY_LIMITS.NAME_MAX,   ph: 'Servis Aracı', mono: false },
            { label: 'Sürücü', value: driver, set: setDriver, max: IDENTITY_LIMITS.DRIVER_MAX, ph: 'İsteğe bağlı', mono: false },
          ].map(({ label, value, set, max, ph, mono }) => (
            <label key={label} className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/35 font-bold">{label}</span>
              <input
                value={value}
                maxLength={max}
                placeholder={ph}
                onChange={(e) => set(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.09] text-sm text-white/90 placeholder:text-white/20 outline-none focus:border-accent/50 transition-colors min-h-[44px] ${
                  mono ? 'font-mono uppercase' : ''
                }`}
              />
            </label>
          ))}

          <p className="text-[11px] text-white/25 leading-relaxed">
            Plaka veya isimden en az biri gerekli. Boş bırakılan alan silinir.
          </p>

          {error && (
            <p className="text-xs text-red-300/90 bg-red-500/[0.08] border border-red-500/20 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-3 rounded-xl text-sm font-medium bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white transition-colors min-h-[44px] disabled:opacity-40"
            >
              Vazgeç
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold bg-accent hover:bg-accent/90 text-white transition-colors min-h-[44px] disabled:opacity-40"
            >
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
