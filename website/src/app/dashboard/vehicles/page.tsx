'use client';

import { useState } from 'react';
import React from 'react';
import { Plus } from 'lucide-react';
type SvgFC = React.FC<{ className?: string }>;
const _Plus = Plus as unknown as SvgFC;
import { useVehicleStore } from '@/store/vehicleStore';
import VehicleCard from '@/components/dashboard/VehicleCard';
import VehicleModal from '@/components/dashboard/VehicleModal';
import AddVehicleModal from '@/components/dashboard/AddVehicleModal';
import type { LiveVehicle, VehicleStatus } from '@/types/realtime';

const filters: { label: string; value: VehicleStatus | 'all' }[] = [
  { label: 'Tümü', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Alarm', value: 'alarm' },
  { label: 'Offline', value: 'offline' },
];

export default function VehiclesPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const loading = useVehicleStore((s) => s.loading);
  const error = useVehicleStore((s) => s.error);
  const [filter, setFilter] = useState<VehicleStatus | 'all'>('all');
  const [selected, setSelected] = useState<LiveVehicle | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const filtered = filter === 'all' ? vehicles : vehicles.filter((v) => v.status === filter);

  if (loading) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60">Araçlar yükleniyor...</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-6 text-sm text-red-300/90">Supabase bağlantı hatası: {error}</div>;
  }

  return (
    <>
      {/* Filter bar + add button */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* Filter chips — horizontally scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 pb-0.5">
          {filters.map(({ label, value }) => {
            const count = value === 'all' ? vehicles.length : vehicles.filter((v) => v.status === value).length;
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all min-h-[44px] ${
                  filter === value
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-white/[0.03] text-white/45 border border-white/[0.07] hover:text-white/70 hover:bg-white/[0.05]'
                }`}
              >
                {label}
                <span className="text-[10px] text-white/25 bg-white/[0.06] rounded-full px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Add button — full width on mobile, auto on desktop */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-accent hover:bg-accent/90 text-white transition-colors min-h-[44px] sm:w-auto w-full"
        >
          <_Plus className="w-4 h-4 flex-shrink-0" />
          Araç Ekle
        </button>
      </div>

      {/* Result count */}
      <p className="text-xs text-white/25 mb-4">{filtered.length} araç gösteriliyor</p>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} onClick={(v) => setSelected(v as LiveVehicle)} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-16 text-center text-white/25 text-sm">
            Bu filtre için araç bulunamadı.
          </div>
        )}
      </div>

      {selected && <VehicleModal vehicle={selected} onClose={() => setSelected(null)} />}
      {showAddModal && <AddVehicleModal onClose={() => setShowAddModal(false)} />}
    </>
  );
}
