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
import type { LiveVehicle } from '@/types/realtime';
import type { VehicleStatus } from '@/lib/mockData';

const filters: { label: string; value: VehicleStatus | 'all' }[] = [
  { label: 'Tümü', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Alarm', value: 'alarm' },
  { label: 'Offline', value: 'offline' },
];

export default function VehiclesPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const [filter, setFilter] = useState<VehicleStatus | 'all'>('all');
  const [selected, setSelected]       = useState<LiveVehicle | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const filtered = filter === 'all' ? vehicles : vehicles.filter((v) => v.status === filter);

  return (
    <>
      {/* Filter bar + add button */}
      <div className="flex items-center gap-2 mb-6">
        {filters.map(({ label, value }) => {
          const count = value === 'all' ? vehicles.length : vehicles.filter((v) => v.status === value).length;
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                filter === value
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-white/[0.03] text-white/45 border border-white/[0.07] hover:text-white/70 hover:bg-white/[0.05]'
              }`}
            >
              {label}
              <span className="ml-2 text-[10px] text-white/25">{count}</span>
            </button>
          );
        })}

        <span className="ml-auto text-xs text-white/25">{filtered.length} araç</span>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-colors"
        >
          <_Plus className="w-4 h-4" />
          Araç Ekle
        </button>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
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
