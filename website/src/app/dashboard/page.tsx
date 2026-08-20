'use client';

/**
 * PANEL — Kanıt Konsolu ana ekranı (#663).
 *
 * #662'de filo bölümü konsol diline geçmişti; kullanıcı *"sadece filo değişmiş,
 * site komple değişecekti"* dedi. Bu ekran o turda dışarıda kalmıştı ve hâlâ
 * eski mavi/cam dilinde, yuvarlak kartlarla duruyordu.
 *
 * Sözleşme (konsolun tamamında aynı):
 *  · Ölçüm okuması `vehicleStore`dan gelir — İKİNCİ OTORİTE KURULMAZ.
 *  · Kanıtsız metrik yeşil boyanmaz; gösterge ibresi ölçüm yokken
 *    ortalamaya YASLANMAZ, "KANIT YOK" der.
 *  · Bağlantı kopukken araç sayısı canlı gibi sunulmaz.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import LiveMap from '@/components/map/LiveMap';
import VehicleMapCard from '@/components/map/VehicleMapCard';
import VehicleModal from '@/components/dashboard/VehicleModal';
import VehicleIdentityEditor from '@/components/dashboard/VehicleIdentityEditor';
import RadialGauge from '@/components/console/RadialGauge';
import { GeofenceAlertsPanel } from '@/components/dashboard/GeofenceAlertsPanel';
import { RemoteCommandPanel } from '@/components/dashboard/RemoteCommandPanel';
import { ProGate } from '@/components/plan/ProGate';
import {
  Panel,
  PanelHead,
  StatTile,
  StatusDot,
  EvidenceBadge,
  EmptyState,
  ErrorState,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import {
  judgeVehicle,
  tallyFleet,
  evidenceLine,
  agoLabel,
  verdictLabel,
  verdictToken,
} from '@/lib/console/evidenceModel';
import {
  BATTERY_SCALE,
  ENGINE_TEMP_SCALE,
  GPS_FRESHNESS_SCALE,
} from '@/lib/console/gaugeModel';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import type { LiveVehicle } from '@/types/realtime';

export default function DashboardPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const connectionStatus = useVehicleStore((s) => s.connectionStatus);
  const loading = useVehicleStore((s) => s.loading);
  const error = useVehicleStore((s) => s.error);

  const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveVehicle | null>(null);
  const [editing, setEditing] = useState<LiveVehicle | null>(null);

  const judged = useMemo(
    () =>
      vehicles.map((v) => ({
        v,
        j: judgeVehicle(v.telemetry, v.batteryVoltage ?? null),
        offline: v.status === 'offline',
      })),
    [vehicles],
  );

  const tally = useMemo(
    () => tallyFleet(judged.map((x) => ({ verdict: x.j.verdict, offline: x.offline }))),
    [judged],
  );

  const mapVehicles = useMemo(
    () => vehicles.filter((v) => v.lat !== 0 && v.lng !== 0),
    [vehicles],
  );

  const mapSelected = mapSelectedId
    ? vehicles.find((v) => v.id === mapSelectedId) ?? null
    : null;

  /* Odak araç: haritada seçilen → ilk çevrimiçi → ilk araç. */
  const focused = useMemo(
    () => mapSelected ?? vehicles.find((v) => v.status !== 'offline') ?? vehicles[0] ?? null,
    [mapSelected, vehicles],
  );
  const focusedJudgement = useMemo(
    () => (focused ? judgeVehicle(focused.telemetry, focused.batteryVoltage ?? null) : null),
    [focused],
  );

  if (loading) {
    return <Panel><EmptyState title="ARAÇ VERİSİ YÜKLENİYOR" detail="Kapsam ve telemetri okunuyor." /></Panel>;
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {error && <ErrorState message={`Supabase bağlantı hatası: ${error}`} />}

      {/* ── Hüküm şeridi ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <StatTile label="Toplam araç" count={tally.total} token="copper" />
        <StatTile label="Kritik" count={tally.critical} token="critical" />
        <StatTile label="Uyarı" count={tally.warning} token="warning" />
        <StatTile label="Kanıt bekliyor" count={tally.noEvidence} token="unknown" />
      </div>

      {/* ── Canlı harita ── */}
      <Panel className="relative overflow-hidden">
        <PanelHead
          title="Canlı konum"
          meta={
            connectionStatus === 'connected'
              ? `${mapVehicles.length} araç konumlu`
              : 'bağlantı kopuk — konumlar bayat olabilir'
          }
          action={
            <Link
              href="/dashboard/map"
              className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
              style={{ borderRadius: 2 }}
            >
              TAM EKRAN
            </Link>
          }
        />
        <div className="relative h-72 sm:h-96">
          <ProGate feature="live_location">
            <LiveMap
              vehicles={mapVehicles}
              selectedId={mapSelectedId}
              onSelect={(id) => setMapSelectedId(id)}
              showStyleToggle
              className="absolute inset-0 w-full h-full"
            />
            {mapSelected && (
              <VehicleMapCard
                vehicle={mapSelected}
                onClose={() => setMapSelectedId(null)}
                onOpenDetail={() => setDetail(mapSelected)}
                onEditIdentity={() => setEditing(mapSelected)}
              />
            )}
          </ProGate>
        </div>
      </Panel>

      {/* ── Odak araç: gösterge kümesi ── */}
      {focused && focusedJudgement ? (
        <Panel>
          <PanelHead
            title="Odak araç"
            meta={`${verdictLabel(focusedJudgement.verdict)} · ${focusedJudgement.reason}`}
            action={<EvidenceBadge verdict={focusedJudgement.verdict} compact />}
          />

          <div className="flex items-center gap-3 px-4 py-3 border-b border-hair-soft">
            <StatusDot verdict={focusedJudgement.verdict} offline={focused.status === 'offline'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-[15px] text-t1 ${isFallbackTitle(focused) ? 'cn-num' : 'cn-display'}`}>
                  {vehicleTitle(focused)}
                </span>
                <span className="cn-num text-[10px] text-t3 truncate">
                  {vehicleSubtitle(focused) ?? 'isim verilmedi'}
                </span>
                {isFallbackTitle(focused) && (
                  <button
                    onClick={() => setEditing(focused)}
                    className="cn-num text-[10px] uppercase tracking-[0.14em]"
                    style={{ color: 'var(--cn-copper)' }}
                  >
                    İsim ver
                  </button>
                )}
              </div>
              <div className="cn-num text-[10px] text-t3 mt-0.5">
                ünite {agoLabel(focused.telemetry?.deviceAgeMs ?? null)}
                {focused.driver && focused.driver !== '—' && ` · ${focused.driver}`}
              </div>
            </div>
            <Link
              href={`/dashboard/fleet/vehicles/${focused.id}`}
              className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1 flex-shrink-0"
              style={{ borderRadius: 2 }}
            >
              DETAY
            </Link>
          </div>

          <ProGate feature="telemetry">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
              <RadialGauge
                value={focusedJudgement.readings.battery.value}
                scale={BATTERY_SCALE}
                unit="volt"
                label="Akü voltajı"
                precision={1}
                evidence={evidenceLine(focusedJudgement.readings.battery)}
              />
              <RadialGauge
                value={focusedJudgement.readings.gpsFreshness.value}
                scale={GPS_FRESHNESS_SCALE}
                unit="saniye"
                label="GPS tazeliği"
                precision={0}
                evidence={evidenceLine(focusedJudgement.readings.gpsFreshness)}
              />
              <RadialGauge
                value={focusedJudgement.readings.engineTemp.value}
                scale={ENGINE_TEMP_SCALE}
                unit="derece"
                label="Motor sıcaklığı"
                precision={0}
                evidence={evidenceLine(focusedJudgement.readings.engineTemp)}
              />
            </div>
          </ProGate>
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            title="ARAÇ YOK"
            detail="Araç eşleştirildiğinde göstergeler burada canlanır. Filo → Yönetim ekranından eşleştirme kodu girebilirsiniz."
          />
        </Panel>
      )}

      {/* ── Uzaktan kontrol + geofence ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 lg:gap-4 items-start">
        <Panel>
          <PanelHead title="Uzaktan kontrol" meta={focused ? undefined : 'araç seçilmedi'} />
          {focused ? (
            <div className="p-4">
              <ProGate feature="remote_commands">
                <RemoteCommandPanel vehicleId={focused.id} />
              </ProGate>
            </div>
          ) : (
            <EmptyState title="ARAÇ SEÇİLMEDİ" />
          )}
        </Panel>

        <Panel>
          <PanelHead title="Hırsız savar — ihlal geçmişi" />
          <div className="p-4">
            <ProGate feature="geofence_alerts">
              <GeofenceAlertsPanel vehicleId={focused?.id} />
            </ProGate>
          </div>
        </Panel>
      </div>

      {/* ── Araç listesi ── */}
      <Panel>
        <PanelHead
          title="Araçlarım"
          meta={`${vehicles.length} araç`}
          action={
            <Link
              href="/dashboard/vehicles"
              className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
              style={{ borderRadius: 2 }}
            >
              TÜMÜ
            </Link>
          }
        />
        {judged.length === 0 ? (
          <EmptyState title="ARAÇ YOK" />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
            {judged.map(({ v, j, offline }) => {
              const token = offline ? 'unknown' : verdictToken(j.verdict);
              return (
                <li key={v.id}>
                  <button
                    onClick={() => { setMapSelectedId(v.id); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bezel transition-colors"
                  >
                    <StatusDot verdict={j.verdict} offline={offline} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-[13px] text-t1 ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
                          {vehicleTitle(v)}
                        </span>
                        {vehicleSubtitle(v) && (
                          <span className="cn-num text-[10px] text-t3 truncate">{vehicleSubtitle(v)}</span>
                        )}
                      </div>
                      <div className="cn-num text-[10px] text-t3 mt-0.5 truncate">{j.reason}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="cn-num text-[10px] uppercase tracking-[0.16em]"
                        style={{ color: TOKEN_COLOR[token] }}
                      >
                        {offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict)}
                      </div>
                      <div className="cn-num text-[10px] text-t3 mt-0.5">
                        {agoLabel(v.telemetry?.deviceAgeMs ?? null)}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {detail && <VehicleModal vehicle={detail} onClose={() => setDetail(null)} />}
      {editing && <VehicleIdentityEditor vehicle={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
