'use client';

/**
 * ARAÇLARIM — Kanıt Konsolu dili (#663).
 *
 * Kapsam farkı (bilinçli): bu ekran KULLANICININ araçlarını yönetir (ekle,
 * kaldır, kimlik ver). Filo → Araçlar ekranı ise FİLO KAPSAMINI hüküm
 * sırasına göre gösterir. İkisi aynı `vehicleStore` otoritesinden okur;
 * ikinci bir liste kaynağı KURULMAZ.
 */

import { useMemo, useState } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import VehicleCard from '@/components/dashboard/VehicleCard';
import VehicleModal from '@/components/dashboard/VehicleModal';
import AddVehicleModal from '@/components/dashboard/AddVehicleModal';
import { Panel, PanelHead, StatTile, EmptyState, ErrorState } from '@/components/console/primitives';
import { judgeVehicle, tallyFleet } from '@/lib/console/evidenceModel';
import { vehicleTitle } from '@/lib/vehicleDisplay';
import type { LiveVehicle, VehicleStatus } from '@/types/realtime';

const FILTERS: { label: string; value: VehicleStatus | 'all' }[] = [
  { label: 'Tümü', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Alarm', value: 'alarm' },
  { label: 'Offline', value: 'offline' },
];

export default function VehiclesPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const loading = useVehicleStore((s) => s.loading);
  const error = useVehicleStore((s) => s.error);
  const removeVehicle = useVehicleStore((s) => s.removeVehicle);

  const [filter, setFilter] = useState<VehicleStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LiveVehicle | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const tally = useMemo(
    () =>
      tallyFleet(
        vehicles.map((v) => ({
          verdict: judgeVehicle(v.telemetry, v.batteryVoltage ?? null).verdict,
          offline: v.status === 'offline',
        })),
      ),
    [vehicles],
  );

  const visible = useMemo(() => {
    const byStatus = filter === 'all' ? vehicles : vehicles.filter((v) => v.status === filter);
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle) return byStatus;
    return byStatus.filter((v) =>
      `${vehicleTitle(v)} ${v.name} ${v.plate} ${v.driver}`.toLocaleLowerCase('tr-TR').includes(needle),
    );
  }, [vehicles, filter, query]);

  if (loading) {
    return <Panel><EmptyState title="ARAÇLAR YÜKLENİYOR" /></Panel>;
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {error && <ErrorState message={`Supabase bağlantı hatası: ${error}`} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <StatTile label="Toplam araç" count={tally.total} token="copper" />
        <StatTile label="Kritik" count={tally.critical} token="critical" />
        <StatTile label="Uyarı" count={tally.warning} token="warning" />
        <StatTile label="Kanıt bekliyor" count={tally.noEvidence} token="unknown" />
      </div>

      <Panel>
        <PanelHead
          title="Araçlarım"
          meta={`${visible.length} / ${vehicles.length} gösteriliyor`}
          action={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ara"
                aria-label="Araç ara"
                className="cn-num text-[11px] px-2 py-1 bg-bezel text-t1 border border-hair w-28 sm:w-44 placeholder:text-t3"
                style={{ borderRadius: 2 }}
              />
              <button
                onClick={() => setShowAdd(true)}
                className="cn-num text-[10px] uppercase tracking-[0.16em] px-3 py-2"
                style={{ borderRadius: 2, background: 'var(--cn-copper)', color: '#0A0A0C' }}
              >
                ARAÇ EKLE
              </button>
            </div>
          }
        />

        {/* Durum filtreleri */}
        <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto border-b border-hair-soft">
          {FILTERS.map(({ label, value }) => {
            const count = value === 'all' ? vehicles.length : vehicles.filter((v) => v.status === value).length;
            const active = filter === value;
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={active}
                className="cn-num text-[10px] uppercase tracking-[0.14em] px-3 py-2 whitespace-nowrap border flex-shrink-0"
                style={{
                  borderRadius: 2,
                  borderColor: active ? 'var(--cn-copper)' : 'var(--cn-line)',
                  color: active ? 'var(--cn-copper)' : 'var(--cn-text-2)',
                  background: active ? 'var(--cn-copper-bg)' : 'transparent',
                }}
              >
                {label} <span className="text-t3">{count}</span>
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title={vehicles.length === 0 ? 'ARAÇ YOK' : 'BU FİLTREDE ARAÇ YOK'}
            detail={
              vehicles.length === 0
                ? 'Araç ekle düğmesiyle eşleştirme kodunu girerek aracınızı bağlayabilirsiniz.'
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 p-3">
            {visible.map((v) => (
              <VehicleCard key={v.id} vehicle={v} onClick={(x) => setSelected(x as LiveVehicle)} />
            ))}
          </div>
        )}
      </Panel>

      {selected && (
        <VehicleModal
          vehicle={selected}
          onClose={() => setSelected(null)}
          onRemove={(id) => { removeVehicle(id); setSelected(null); }}
        />
      )}
      {showAdd && <AddVehicleModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
