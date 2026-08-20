'use client';

/**
 * HARİTA — Kanıt Konsolu dili (#663).
 *
 * ── DÜZELTİLEN YAPISAL KUSUR ──────────────────────────────────────────────
 * Bu ekran tam ekran ölçüleriyle KENDİ kabuğunu kuruyordu ve
 * içinde KENDİ yan menüsünü + KENDİ alt navigasyonunu çiziyordu — dashboard
 * kabuğunun içinde ikinci bir kabuk. Sonuç: telefonda iki alt menü üst üste
 * biniyordu ve o menüdeki düğmelerin hiçbiri bir yere GİTMİYORDU (dekoratif
 * `<button>`lardı, `href` yoktu). Sökülüp tek kabuğa alındı.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import LiveMap from '@/components/map/LiveMap';
import VehicleMapCard from '@/components/map/VehicleMapCard';
import VehicleIdentityEditor from '@/components/dashboard/VehicleIdentityEditor';
import { Panel, PanelHead, StatusDot, EmptyState, TOKEN_COLOR } from '@/components/console/primitives';
import { judgeVehicle, verdictToken, agoLabel } from '@/lib/console/evidenceModel';
import { vehicleTitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import type { LiveVehicle } from '@/types/realtime';

export default function MapPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [editing, setEditing] = useState<LiveVehicle | null>(null);

  const positioned = useMemo(
    () => vehicles.filter((v) => v.lat !== 0 && v.lng !== 0),
    [vehicles],
  );
  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) ?? null : null;

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) setFollowMode(false);
  }, []);

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <Panel className="relative overflow-hidden">
        <PanelHead
          title="Canlı konum"
          meta={
            connectionStatus === 'connected'
              ? `${positioned.length} araç konumlu`
              : 'bağlantı kopuk — konumlar bayat olabilir'
          }
          action={
            selected ? (
              <button
                onClick={() => setFollowMode((f) => !f)}
                aria-pressed={followMode}
                className="cn-num text-[9px] uppercase tracking-[0.16em] px-2.5 py-1.5 border"
                style={{
                  borderRadius: 2,
                  borderColor: followMode ? 'var(--cn-copper)' : 'var(--cn-line)',
                  color: followMode ? 'var(--cn-copper)' : 'var(--cn-text-2)',
                  background: followMode ? 'var(--cn-copper-bg)' : 'transparent',
                }}
              >
                {followMode ? 'TAKİP: AÇIK' : 'ARACI TAKİP ET'}
              </button>
            ) : null
          }
        />

        <div className="relative h-[60vh] min-h-[360px]">
          <LiveMap
            vehicles={vehicles}
            selectedId={selectedId}
            onSelect={handleSelect}
            followMode={followMode}
            showStyleToggle
            className="absolute inset-0 w-full h-full"
          />

          {selected && (
            <VehicleMapCard
              vehicle={selected}
              onClose={() => handleSelect(null)}
              onEditIdentity={() => setEditing(selected)}
            />
          )}

          {/* Lejant — renk tek başına anlam taşımasın diye etiketli */}
          {!selected && (
            <div
              className="absolute bottom-3 left-3 z-20 px-3 py-2.5 flex flex-col gap-2"
              style={{
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--cn-line)',
                borderRadius: 2,
              }}
            >
              {([
                ['verified', 'Kanıtlı'],
                ['warning', 'Uyarı'],
                ['critical', 'Kritik'],
                ['unknown', 'Kanıt yok / çevrimdışı'],
              ] as const).map(([token, label]) => (
                <div key={token} className="flex items-center gap-2">
                  <span aria-hidden style={{ width: 8, height: 8, background: TOKEN_COLOR[token] }} />
                  <span className="cn-num text-[9px] uppercase tracking-[0.14em] text-white/70">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* Araç şeridi */}
      <Panel>
        <PanelHead title="Araç seçimi" meta={`${vehicles.length} araç`} />
        {vehicles.length === 0 ? (
          <EmptyState title="ARAÇ YOK" detail="Araç eşleştirildiğinde haritada belirir." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
            {vehicles.map((v) => {
              const j = judgeVehicle(v.telemetry, v.batteryVoltage ?? null);
              const offline = v.status === 'offline';
              const hasFix = v.lat !== 0 && v.lng !== 0;
              const token = offline ? 'unknown' : verdictToken(j.verdict);
              return (
                <li key={v.id}>
                  <button
                    onClick={() => handleSelect(selectedId === v.id ? null : v.id)}
                    disabled={!hasFix}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-45 hover:bg-bezel"
                    style={{
                      background: selectedId === v.id ? 'var(--cn-copper-bg)' : undefined,
                    }}
                  >
                    <StatusDot verdict={j.verdict} offline={offline} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[13px] text-t1 truncate ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
                        {vehicleTitle(v)}
                      </div>
                      <div className="cn-num text-[10px] text-t3">
                        {hasFix ? `konum ${agoLabel(v.telemetry?.locationAgeMs ?? null)}` : 'konum kanıtı yok'}
                      </div>
                    </div>
                    <span
                      className="cn-num text-[10px] uppercase tracking-[0.14em] flex-shrink-0"
                      style={{ color: TOKEN_COLOR[token] }}
                    >
                      {offline ? 'ÇEVRİMDIŞI' : j.reason}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="px-4 py-3 border-t border-hair">
          <Link
            href="/dashboard/fleet"
            className="cn-num text-[10px] uppercase tracking-[0.16em]"
            style={{ color: 'var(--cn-copper)' }}
          >
            Filo genel bakışa git →
          </Link>
        </div>
      </Panel>

      {editing && <VehicleIdentityEditor vehicle={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
