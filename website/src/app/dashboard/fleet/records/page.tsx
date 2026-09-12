'use client';

/**
 * KAYITLAR — yakıt ve servis/bakım takibi (#662).
 *
 * Sözleşme: "okunamadı" ≠ "kayıt yok". Toplamlar yalnız ÖLÇÜLEN satırlardan
 * kurulur ve kaç satırın eksik olduğu ekranda YAZAR; eksik veri sessizce 0
 * sayılmaz.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  fetchFuelLogs,
  fetchServiceRecords,
  type FuelLogRow,
  type ServiceRow,
} from '@/lib/console/consoleSources';
import {
  summarizeFuel,
  summarizeService,
  trDate,
} from '@/lib/console/recordsModel';
import { trNumber } from '@/lib/console/exportModel';
import { Panel, PanelHead, EmptyState, StatTile } from '@/components/console/primitives';
import DownloadCsvButton from '@/components/console/DownloadCsvButton';
import { vehicleTitle } from '@/lib/vehicleDisplay';

type Tab = 'fuel' | 'service';
type ReadState = 'loading' | 'ok' | 'unreadable';

export default function RecordsPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const [tab, setTab] = useState<Tab>('fuel');
  const [vehicleFilter, setVehicleFilter] = useState('all');

  const [fuel, setFuel] = useState<FuelLogRow[]>([]);
  const [service, setService] = useState<ServiceRow[]>([]);
  const [fuelState, setFuelState] = useState<ReadState>('loading');
  const [serviceState, setServiceState] = useState<ReadState>('loading');
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setFuelState('loading');
    setServiceState('loading');
    const [f, s] = await Promise.all([fetchFuelLogs(), fetchServiceRecords()]);
    if (!mountedRef.current) return;
    setNow(Date.now());
    if (f === null) setFuelState('unreadable');
    else { setFuel(f); setFuelState('ok'); }
    if (s === null) setServiceState('unreadable');
    else { setService(s); setServiceState('ok'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const nameOf = useCallback(
    (id: string) => {
      const v = vehicles.find((x) => x.id === id);
      return v ? vehicleTitle(v) : `Araç #${id.slice(0, 8)}`;
    },
    [vehicles],
  );

  const fuelRows = useMemo(
    () => (vehicleFilter === 'all' ? fuel : fuel.filter((r) => r.vehicleId === vehicleFilter)),
    [fuel, vehicleFilter],
  );
  const serviceRows = useMemo(
    () => (vehicleFilter === 'all' ? service : service.filter((r) => r.vehicleId === vehicleFilter)),
    [service, vehicleFilter],
  );

  const fuelSummary = useMemo(() => summarizeFuel(fuelRows), [fuelRows]);
  const serviceSummary = useMemo(() => summarizeService(serviceRows, now), [serviceRows, now]);

  const vehiclePicker = (
    <div className="flex items-center gap-2">
      <label className="cn-eyebrow" htmlFor="rec-veh">Araç</label>
      <select
        id="rec-veh"
        value={vehicleFilter}
        onChange={(e) => setVehicleFilter(e.target.value)}
        className="cn-num text-[11px] px-2 py-1 bg-bezel text-t1 border border-hair"
        style={{ borderRadius: 2 }}
      >
        <option value="all">Tümü</option>
        {vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleTitle(v)}</option>)}
      </select>
      <button
        onClick={() => void load()}
        className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
        style={{ borderRadius: 2 }}
      >
        YENİLE
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {/* Sekme + özet */}
      <div className="flex items-center gap-2">
        {(['fuel', 'service'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className="cn-num text-[10px] uppercase tracking-[0.16em] px-3 py-2 border"
            style={{
              borderRadius: 2,
              borderColor: tab === key ? 'var(--cn-copper)' : 'var(--cn-line)',
              color: tab === key ? 'var(--cn-copper)' : 'var(--cn-text-2)',
              background: tab === key ? 'var(--cn-copper-bg)' : 'var(--cn-bg-panel)',
            }}
          >
            {key === 'fuel' ? 'Yakıt' : 'Servis / Bakım'}
          </button>
        ))}
      </div>

      {tab === 'fuel' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
            <StatTile label="Dolum kaydı" count={fuelSummary.entries} token="copper" />
            <SummaryTile label="Toplam litre" value={fuelSummary.totalLiters} suffix=" L" digits={1} />
            <SummaryTile label="Toplam tutar" value={fuelSummary.totalCost} suffix=" ₺" digits={2} />
            <SummaryTile label="Ort. litre fiyatı" value={fuelSummary.avgPricePerL} suffix=" ₺/L" digits={2} />
          </div>

          <Panel>
            <PanelHead
              title="Yakıt dolumları"
              meta={
                fuelSummary.missingLiters > 0 || fuelSummary.missingPrice > 0
                  ? `${fuelSummary.missingLiters} kayıtta litre yok · ${fuelSummary.missingPrice} kayıtta fiyat yok`
                  : undefined
              }
              action={
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {vehiclePicker}
                  <DownloadCsvButton
                    filePrefix="yakit-kayitlari"
                    headers={['Araç', 'Tarih', 'Litre', 'Litre fiyatı', 'Tutar', 'Kilometre']}
                    rows={fuelRows.map((r) => [
                      nameOf(r.vehicleId),
                      trDate(r.filledOn),
                      trNumber(r.liters, 2),
                      trNumber(r.pricePerL, 2),
                      trNumber(r.liters !== null && r.pricePerL !== null ? r.liters * r.pricePerL : null, 2),
                      r.odometerKm ?? '',
                    ])}
                  />
                </div>
              }
            />
            {fuelState === 'loading' ? (
              <EmptyState title="KAYITLAR OKUNUYOR" />
            ) : fuelState === 'unreadable' ? (
              <EmptyState
                title="YAKIT KAYITLARI OKUNAMADI"
                detail="Tablo bu oturumda okunamıyor (yetki ya da bağlantı). Bu, 'kayıt yok' anlamına GELMEZ."
              />
            ) : fuelRows.length === 0 ? (
              <EmptyState title="KAYIT YOK" detail="Seçili kapsamda yakıt dolumu kaydı bulunmuyor." />
            ) : (
              <TableScroller>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hair">
                      {['Araç', 'Tarih', 'Litre', '₺/L', 'Tutar', 'Km'].map((h) => (
                        <th key={h} className="cn-eyebrow px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fuelRows.map((r) => (
                      <tr key={r.id} className="border-b border-hair-soft">
                        <td className="px-3 py-2 text-[12px] text-t1 whitespace-nowrap">{nameOf(r.vehicleId)}</td>
                        <td className="px-3 py-2 cn-num text-[11px] text-t2 whitespace-nowrap">{trDate(r.filledOn)}</td>
                        <Cell value={r.liters} digits={2} />
                        <Cell value={r.pricePerL} digits={2} />
                        <Cell
                          value={r.liters !== null && r.pricePerL !== null ? r.liters * r.pricePerL : null}
                          digits={2}
                        />
                        <Cell value={r.odometerKm} digits={0} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            )}
          </Panel>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
            <StatTile label="Servis kaydı" count={serviceSummary.entries} token="copper" />
            <StatTile label="Bakımı geçmiş" count={serviceSummary.overdue.length} token="critical" />
            <StatTile label="30 gün içinde" count={serviceSummary.dueSoon.length} token="warning" />
            <SummaryTile label="Toplam tutar" value={serviceSummary.totalCost} suffix=" ₺" digits={2} />
          </div>

          {(serviceSummary.overdue.length > 0 || serviceSummary.dueSoon.length > 0) && (
            <Panel>
              <PanelHead title="Bakım zamanı yaklaşan araçlar" />
              <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
                {[...serviceSummary.overdue, ...serviceSummary.dueSoon].map((r) => {
                  const overdue = serviceSummary.overdue.includes(r);
                  return (
                    <li key={`due-${r.id}`} className="flex items-center gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        style={{
                          width: 6, height: 24,
                          background: overdue ? 'var(--cn-critical)' : 'var(--cn-warning)',
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-t1">{nameOf(r.vehicleId)}</div>
                        <div className="cn-num text-[10px] text-t3">{r.kind ?? 'bakım türü belirtilmemiş'}</div>
                      </div>
                      <div
                        className="cn-num text-[11px] text-right"
                        style={{ color: overdue ? 'var(--cn-critical)' : 'var(--cn-warning)' }}
                      >
                        {trDate(r.nextDueOn)}
                        <span className="block text-[9px] uppercase tracking-[0.14em]">
                          {overdue ? 'GEÇTİ' : 'YAKLAŞIYOR'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <Panel>
            <PanelHead
              title="Servis / bakım kayıtları"
              meta={serviceSummary.missingCost > 0 ? `${serviceSummary.missingCost} kayıtta tutar yok` : undefined}
              action={
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {vehiclePicker}
                  <DownloadCsvButton
                    filePrefix="servis-kayitlari"
                    headers={['Araç', 'Tarih', 'Tür', 'Tutar', 'Kilometre', 'Sonraki bakım', 'Not']}
                    rows={serviceRows.map((r) => [
                      nameOf(r.vehicleId),
                      trDate(r.servicedOn),
                      r.kind ?? '',
                      trNumber(r.cost, 2),
                      r.odometerKm ?? '',
                      trDate(r.nextDueOn),
                      r.note ?? '',
                    ])}
                  />
                </div>
              }
            />
            {serviceState === 'loading' ? (
              <EmptyState title="KAYITLAR OKUNUYOR" />
            ) : serviceState === 'unreadable' ? (
              <EmptyState
                title="SERVİS KAYITLARI OKUNAMADI"
                detail="Tablo bu oturumda okunamıyor. Bu, 'kayıt yok' anlamına GELMEZ."
              />
            ) : serviceRows.length === 0 ? (
              <EmptyState title="KAYIT YOK" detail="Seçili kapsamda servis kaydı bulunmuyor." />
            ) : (
              <TableScroller>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-hair">
                      {['Araç', 'Tarih', 'Tür', 'Tutar', 'Km', 'Sonraki'].map((h) => (
                        <th key={h} className="cn-eyebrow px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {serviceRows.map((r) => (
                      <tr key={r.id} className="border-b border-hair-soft">
                        <td className="px-3 py-2 text-[12px] text-t1 whitespace-nowrap">{nameOf(r.vehicleId)}</td>
                        <td className="px-3 py-2 cn-num text-[11px] text-t2 whitespace-nowrap">{trDate(r.servicedOn)}</td>
                        <td className="px-3 py-2 text-[12px] text-t2">{r.kind ?? <Missing />}</td>
                        <Cell value={r.cost} digits={2} />
                        <Cell value={r.odometerKm} digits={0} />
                        <td className="px-3 py-2 cn-num text-[11px] text-t2 whitespace-nowrap">
                          {r.nextDueOn ? trDate(r.nextDueOn) : <Missing />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/* ── Yardımcı gösterimler ──────────────────────────────────────────────── */

function TableScroller({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function Missing() {
  return <span className="cn-num text-[10px] text-unknown">YOK</span>;
}

function Cell({ value, digits }: { value: number | null; digits: number }) {
  return (
    <td className="px-3 py-2 cn-num text-[12px] text-t1 whitespace-nowrap">
      {value === null ? <Missing /> : value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}
    </td>
  );
}

function SummaryTile({
  label,
  value,
  suffix,
  digits,
}: {
  label: string;
  value: number | null;
  suffix: string;
  digits: number;
}) {
  return (
    <div className="cn-panel px-4 py-3">
      <div className="cn-num text-2xl leading-none" style={{ color: value === null ? 'var(--cn-unknown)' : 'var(--cn-text-1)' }}>
        {value === null ? (
          <span className="text-[13px] tracking-[0.16em]">KANIT YOK</span>
        ) : (
          <>
            {value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}
            <span className="text-[13px] text-t3">{suffix}</span>
          </>
        )}
      </div>
      <div className="cn-eyebrow mt-2">{label}</div>
    </div>
  );
}
