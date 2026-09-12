'use client';

/**
 * ARAÇ DETAY — gösterge kümesi · kanıt defteri · zaman çizelgesi · konum (#662).
 *
 * Sözleşme:
 *  · Ölçüm okuması `vehicleStore`dan (tek otorite). Ek okumalar
 *    (`vehicle_events`, DTC) `consoleSources`ten ve okunamazsa BUNU SÖYLER.
 *  · Kanıt defteri her metrik için kaynak · örnek · yaş taşır.
 *  · DTC şeridinde "tarama yok" · "okunamadı" · "arıza yok" ÜÇ AYRI durumdur.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useVehicleStore } from '@/store/vehicleStore';
import RadialGauge from '@/components/console/RadialGauge';
import VehicleIdentityEditor from '@/components/dashboard/VehicleIdentityEditor';
import LiveMap from '@/components/map/LiveMap';
import {
  Panel,
  PanelHead,
  EvidenceBadge,
  LedgerRow,
  EmptyState,
  ErrorState,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import {
  judgeVehicle,
  evidenceLine,
  agoLabel,
  verdictToken,
  verdictLabel,
} from '@/lib/console/evidenceModel';
import {
  BATTERY_SCALE,
  ENGINE_TEMP_SCALE,
  GPS_FRESHNESS_SCALE,
} from '@/lib/console/gaugeModel';
import {
  fetchLatestDtc,
  fetchVehicleEvents,
  type DecisionEvent,
  type DtcReading,
} from '@/lib/console/consoleSources';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle, formatCoords } from '@/lib/vehicleDisplay';
import { locationLabel, dataSourceLabel, freshnessLabel } from '@/lib/fleet/vehicleTelemetryFreshness';

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>();
  const vehicleId = typeof params?.id === 'string' ? params.id : '';

  const vehicles = useVehicleStore((s) => s.getList());
  const loading = useVehicleStore((s) => s.loading);
  const storeError = useVehicleStore((s) => s.error);

  const vehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId) ?? null, [vehicles, vehicleId]);

  const [events, setEvents] = useState<DecisionEvent[] | null>(null);
  const [eventsUnreadable, setEventsUnreadable] = useState(false);
  const [dtc, setDtc] = useState<DtcReading | null>(null);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    const [rows, dtcReading] = await Promise.all([
      fetchVehicleEvents(vehicleId, 60),
      fetchLatestDtc(vehicleId),
    ]);
    if (!mountedRef.current) return;
    setNow(Date.now());
    setEventsUnreadable(rows === null);
    setEvents(rows ?? []);
    setDtc(dtcReading);
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Panel><EmptyState title="ARAÇ YÜKLENİYOR" /></Panel>;

  if (!vehicle) {
    return (
      <Panel>
        <EmptyState
          title="ARAÇ BULUNAMADI"
          detail="Bu araç kapsamınızda değil ya da kaldırılmış olabilir."
        />
        <div className="px-4 pb-4">
          <Link href="/dashboard/fleet/vehicles" className="cn-num text-[11px]" style={{ color: 'var(--cn-copper)' }}>
            ← Araç kapsamına dön
          </Link>
        </div>
      </Panel>
    );
  }

  const t = vehicle.telemetry;
  const j = judgeVehicle(t, vehicle.batteryVoltage ?? null);
  const token = verdictToken(j.verdict);

  const lat = t?.latitude ?? (vehicle.lat !== 0 ? vehicle.lat : null);
  const lng = t?.longitude ?? (vehicle.lng !== 0 ? vehicle.lng : null);
  const hasFix = lat !== null && lng !== null;

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {storeError && <ErrorState message={`Araç verisi okunamadı: ${storeError}`} />}

      {/* ── Başlık ── */}
      <Panel className="px-4 py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link
              href="/dashboard/fleet/vehicles"
              className="cn-num text-[10px] uppercase tracking-[0.16em] text-t3 hover:text-t1"
            >
              ← Araç kapsamı
            </Link>
            <h1 className={`mt-2 text-[26px] leading-none text-t1 ${isFallbackTitle(vehicle) ? 'cn-num' : 'cn-display'}`}>
              {vehicleTitle(vehicle)}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="cn-num text-[11px] text-t3">
                {vehicleSubtitle(vehicle) ?? 'isim verilmedi'}
              </span>
              <button
                onClick={() => setEditing(true)}
                className="cn-num text-[10px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--cn-copper)' }}
              >
                {isFallbackTitle(vehicle) ? 'İsim ver' : 'Düzenle'}
              </button>
            </div>
          </div>

          <div className="text-right">
            <EvidenceBadge verdict={j.verdict} />
            <div className="cn-num text-[10px] text-t3 mt-2">
              {verdictLabel(j.verdict)} · {j.reason}
            </div>
            <div className="cn-num text-[10px] text-t3">
              ünite {t ? freshnessLabel(t.device) : 'bilinmiyor'} · {agoLabel(t?.deviceAgeMs ?? null)}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Gösterge kümesi ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-3 lg:gap-4 items-start">
        <Panel className="p-4">
          <RadialGauge
            value={j.readings.battery.value}
            scale={BATTERY_SCALE}
            unit="volt"
            label="Akü voltajı"
            size="hero"
            precision={1}
            evidence={evidenceLine(j.readings.battery)}
          />
        </Panel>

        <div className="flex flex-col gap-3 lg:gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
            <Panel className="p-4">
              <RadialGauge
                value={j.readings.gpsFreshness.value}
                scale={GPS_FRESHNESS_SCALE}
                unit="saniye"
                label="GPS tazeliği"
                precision={0}
                evidence={evidenceLine(j.readings.gpsFreshness)}
              />
            </Panel>
            <Panel className="p-4">
              <RadialGauge
                value={j.readings.engineTemp.value}
                scale={ENGINE_TEMP_SCALE}
                unit="derece"
                label="Motor sıcaklığı"
                precision={0}
                evidence={evidenceLine(j.readings.engineTemp)}
              />
            </Panel>
          </div>

          {/* DTC şeridi */}
          <Panel>
            <PanelHead title="Arıza kodları (DTC)" meta={dtcMeta(dtc, now)} />
            <DtcStrip reading={dtc} />
          </Panel>
        </div>
      </div>

      {/* ── Kanıt defteri + konum ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 lg:gap-4 items-start">
        <Panel>
          <PanelHead title="Kanıt defteri" meta="her metrik: kaynak · örnek · yaş" />
          <LedgerRow metric="Akü voltajı" reading={j.readings.battery} unit="V" precision={1} />
          <LedgerRow metric="Motor sıcaklığı" reading={j.readings.engineTemp} unit="°C" precision={0} />
          <LedgerRow metric="GPS tazeliği" reading={j.readings.gpsFreshness} unit="sn" precision={0} />
          <LedgerRow metric="Hız" reading={j.readings.speed} unit="km/h" precision={0} />
          <div className="px-4 py-3 border-t border-hair">
            <div className="cn-eyebrow mb-2">Konum kanıtı</div>
            <div className="cn-num text-[11px] text-t2 leading-relaxed">
              {t ? locationLabel(t) : 'Konum durumu bilinmiyor'}
              {t && <span className="text-t3"> · {dataSourceLabel(t.locationSource)}</span>}
              {t?.accuracyM != null && <span className="text-t3"> · ±{Math.round(t.accuracyM)} m</span>}
              <span className="block text-t3">
                {hasFix ? formatCoords(lat as number, lng as number) : 'koordinat yok'}
              </span>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-hair">
            <div className="cn-eyebrow mb-2">Metrik geçmişi</div>
            <p className="cn-num text-[10px] text-t3 leading-relaxed">
              AÇIK BORÇ: telemetri tablosu araç başına TEK satır tutar (üzerine
              yazılır); ölçümlerin kronolojik geçmişi sunucuda SAKLANMIYOR.
              Bu yüzden burada metrik başına geçmiş liste gösterilmiyor —
              olmayan bir seriyi çizmek uydurma olurdu. Aşağıdaki zaman
              çizelgesi olay geçmişidir (ölçüm geçmişi değil).
            </p>
          </div>
          <div className="px-4 py-3 border-t border-hair grid grid-cols-2 gap-3">
            <div>
              <div className="cn-eyebrow">Kilometre</div>
              <div className="cn-num text-[15px] text-t1 mt-1">
                {vehicle.odometer > 0
                  ? `${vehicle.odometer.toLocaleString('tr-TR')} km`
                  : <span className="text-[10px] text-unknown">KANIT YOK</span>}
              </div>
            </div>
            <div>
              <div className="cn-eyebrow">Sürücü</div>
              <div className="cn-num text-[15px] text-t1 mt-1">
                {vehicle.driver && vehicle.driver !== '—'
                  ? vehicle.driver
                  : <span className="text-[10px] text-unknown">ATANMADI</span>}
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="Son bilinen konum"
            meta={t ? locationLabel(t) : undefined}
            action={
              hasFix ? (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="cn-num text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: 'var(--cn-copper)' }}
                >
                  Aracı bul →
                </a>
              ) : null
            }
          />
          {hasFix ? (
            <div className="relative h-[320px]">
              <LiveMap
                vehicles={[vehicle]}
                selectedId={vehicle.id}
                className="absolute inset-0 w-full h-full"
                showStyleToggle
              />
            </div>
          ) : (
            <EmptyState
              title="KONUM KANITI YOK"
              detail="Bu araçtan hiç konum alınmadı ya da konum okunamıyor. Harita uydurma bir nokta göstermez."
            />
          )}
        </Panel>
      </div>

      {/* ── Zaman çizelgesi ── */}
      <Panel>
        <PanelHead
          title="Araç geçmişi"
          meta={eventsUnreadable ? 'okunamadı' : events ? `${events.length} olay` : undefined}
          action={
            <button
              onClick={() => void load()}
              className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
              style={{ borderRadius: 2 }}
            >
              YENİLE
            </button>
          }
        />
        {eventsUnreadable ? (
          <EmptyState
            title="GEÇMİŞ OKUNAMADI"
            detail="Olay tablosu bu oturumda okunamıyor (yetki ya da bağlantı). Bu, 'olay yok' anlamına GELMEZ."
          />
        ) : !events || events.length === 0 ? (
          <EmptyState title="OLAY YOK" detail="Bu araçtan henüz kayıtlı olay gelmedi." />
        ) : (
          <ol className="p-4 flex flex-col gap-0">
            {events.map((e, i) => (
              <li key={e.id} className="grid grid-cols-[10px_1fr] gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    style={{
                      width: 7, height: 7, borderRadius: '50%', marginTop: 6,
                      background: TOKEN_COLOR[e.severity === 'critical' ? 'critical' : e.severity === 'warning' ? 'warning' : 'unknown'],
                    }}
                  />
                  {i < events.length - 1 && (
                    <span aria-hidden className="flex-1 w-px" style={{ background: 'var(--cn-line)' }} />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="cn-num text-[12px] text-t1 break-all">{e.kind}</span>
                    <span className="cn-num text-[10px] text-t3">
                      {agoLabel(e.at > 0 ? now - e.at : null)}
                    </span>
                  </div>
                  {e.detail && (
                    <p className="cn-num text-[10px] text-t2 mt-1 break-all leading-relaxed">{e.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {editing && (
        <VehicleIdentityEditor vehicle={vehicle} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/* ── DTC şeridi ────────────────────────────────────────────────────────── */

function dtcMeta(reading: DtcReading | null, now: number): string | undefined {
  if (!reading) return undefined;
  if (reading.kind === 'UNREADABLE') return 'okunamadı';
  if (reading.kind === 'NEVER_SCANNED') return 'tarama yok';
  return `son tarama ${agoLabel(reading.at > 0 ? now - reading.at : null)}`;
}

function DtcStrip({ reading }: { reading: DtcReading | null }) {
  if (!reading) return <EmptyState title="DTC OKUNUYOR" />;

  if (reading.kind === 'UNREADABLE') {
    return (
      <EmptyState
        title="DTC OKUNAMADI"
        detail="Komut tablosu bu oturumda okunamıyor. Bu, 'arıza yok' anlamına GELMEZ."
      />
    );
  }

  if (reading.kind === 'NEVER_SCANNED') {
    return (
      <EmptyState
        title="TARAMA YAPILMADI"
        detail="Bu araçta hiç arıza kodu taraması çalıştırılmadı. Tarama olmadan 'arıza yok' denemez."
      />
    );
  }

  if (reading.partial) {
    return (
      <EmptyState
        title="TARAMA TAMAMLANMADI"
        detail="Son tarama araç tarafında tamamlanmadı; sonuç kısmi. Boş liste 'arıza yok' SAYILMAZ."
      />
    );
  }

  if (reading.codes.length === 0) {
    return (
      <div className="px-4 py-5 flex items-center gap-3">
        <EvidenceBadge verdict="VERIFIED" />
        <span className="cn-num text-[12px] text-t2">
          Tarama tamamlandı, arıza kodu bulunamadı.
        </span>
      </div>
    );
  }

  return (
    <ul className="p-3 flex flex-wrap gap-2">
      {reading.codes.map((c, i) => (
        <li
          key={`${c.code}-${i}`}
          className="px-3 py-2"
          style={{
            border: '1px solid var(--cn-critical)',
            background: 'var(--cn-critical-bg)',
            borderRadius: 2,
          }}
        >
          <div className="cn-num text-[13px]" style={{ color: 'var(--cn-critical)' }}>{c.code}</div>
          {c.description && <div className="text-[11px] text-t2 mt-0.5 max-w-[240px]">{c.description}</div>}
        </li>
      ))}
    </ul>
  );
}
