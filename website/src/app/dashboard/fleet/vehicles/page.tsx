'use client';

/**
 * ARAÇ KAPSAMI — Kanıt Konsolu araç ızgarası (#662).
 *
 * Her kart bir HÜKÜM taşır. Kanıtı olmayan araç yeşil boyanmaz; kartı gri
 * kalır ve "KANIT YOK" der. Ölçüm okuması `vehicleStore`dan gelir.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  judgeVehicle,
  verdictLabel,
  verdictToken,
  agoLabel,
  evidenceLine,
  type Verdict,
} from '@/lib/console/evidenceModel';
import {
  Panel,
  PanelHead,
  EvidenceBadge,
  StatusDot,
  EmptyState,
  ErrorState,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';

type SortKey = 'verdict' | 'name' | 'lastSeen';

const VERDICT_ORDER: Record<Verdict, number> = {
  CRITICAL: 0, WARNING: 1, NO_EVIDENCE: 2, VERIFIED: 3,
};

export default function ConsoleVehiclesPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const loading = useVehicleStore((s) => s.loading);
  const error = useVehicleStore((s) => s.error);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('verdict');

  const rows = useMemo(() => {
    const judged = vehicles.map((v) => ({
      v,
      j: judgeVehicle(v.telemetry, v.batteryVoltage ?? null),
      offline: v.status === 'offline',
    }));

    const needle = query.trim().toLocaleLowerCase('tr-TR');
    const filtered = needle
      ? judged.filter(({ v }) =>
          `${vehicleTitle(v)} ${v.name} ${v.plate} ${v.driver}`
            .toLocaleLowerCase('tr-TR')
            .includes(needle),
        )
      : judged;

    return [...filtered].sort((a, b) => {
      if (sort === 'verdict') {
        const d = VERDICT_ORDER[a.j.verdict] - VERDICT_ORDER[b.j.verdict];
        if (d !== 0) return d;
        return vehicleTitle(a.v).localeCompare(vehicleTitle(b.v), 'tr');
      }
      if (sort === 'name') return vehicleTitle(a.v).localeCompare(vehicleTitle(b.v), 'tr');
      return (b.v.telemetry?.deviceLastSeenAt ?? b.v.lastTimestamp)
        - (a.v.telemetry?.deviceLastSeenAt ?? a.v.lastTimestamp);
    });
  }, [vehicles, query, sort]);

  if (loading) {
    return <Panel><EmptyState title="ARAÇ KAPSAMI YÜKLENİYOR" /></Panel>;
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {error && <ErrorState message={`Araç verisi okunamadı: ${error}`} />}

      <Panel>
        <PanelHead
          title="Araç kapsamı"
          meta={`${rows.length} araç`}
          action={
            <div className="flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ara: plaka, isim, sürücü"
                aria-label="Araç ara"
                className="cn-num text-[11px] px-2 py-1 bg-bezel text-t1 border border-hair w-40 sm:w-56 placeholder:text-t3"
                style={{ borderRadius: 2 }}
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sıralama"
                className="cn-num text-[11px] px-2 py-1 bg-bezel text-t1 border border-hair"
                style={{ borderRadius: 2 }}
              >
                <option value="verdict">Önce acil</option>
                <option value="name">Ada göre</option>
                <option value="lastSeen">Son görülme</option>
              </select>
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            title={vehicles.length === 0 ? 'FİLODA ARAÇ YOK' : 'ARAMAYA UYAN ARAÇ YOK'}
            detail={
              vehicles.length === 0
                ? 'Araç eşleştirildiğinde kapsam burada belirir.'
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 p-3">
            {rows.map(({ v, j, offline }) => {
              const token = offline ? 'unknown' : verdictToken(j.verdict);
              return (
                <Link
                  key={v.id}
                  href={`/dashboard/fleet/vehicles/${v.id}`}
                  className="cn-panel p-4 flex flex-col gap-3 hover:bg-bezel transition-colors"
                  style={{ borderColor: TOKEN_COLOR[token] }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot verdict={j.verdict} offline={offline} />
                      <div className="min-w-0">
                        <div className={`text-[15px] text-t1 truncate ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
                          {vehicleTitle(v)}
                        </div>
                        <div className="cn-num text-[10px] text-t3 truncate">
                          {vehicleSubtitle(v) ?? 'isim verilmedi'}
                        </div>
                      </div>
                    </div>
                    <EvidenceBadge verdict={offline ? 'NO_EVIDENCE' : j.verdict} compact />
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-hair-soft pt-3">
                    <MiniStat
                      label="Akü"
                      value={j.readings.battery.value}
                      unit="V"
                      precision={1}
                      verdict={j.readings.battery.verdict}
                    />
                    <MiniStat
                      label="Motor"
                      value={j.readings.engineTemp.value}
                      unit="°C"
                      precision={0}
                      verdict={j.readings.engineTemp.verdict}
                    />
                    <MiniStat
                      label="GPS"
                      value={j.readings.gpsFreshness.value}
                      unit="sn"
                      precision={0}
                      verdict={j.readings.gpsFreshness.verdict}
                    />
                  </div>

                  <div className="cn-num text-[10px] text-t3 leading-relaxed">
                    {offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict)} · {j.reason}
                    <span className="block">
                      ünite {agoLabel(v.telemetry?.deviceAgeMs ?? null)}
                      {v.driver && v.driver !== '—' && ` · ${v.driver}`}
                    </span>
                    <span className="block text-t3">{evidenceLine(j.readings.engineTemp)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
  precision,
  verdict,
}: {
  label: string;
  value: number | null;
  unit: string;
  precision: number;
  verdict: Verdict;
}) {
  const token = verdictToken(verdict);
  return (
    <div>
      <div className="cn-eyebrow">{label}</div>
      <div className="cn-num text-[15px] mt-1" style={{ color: TOKEN_COLOR[token] }}>
        {value === null ? <span className="text-[10px] text-unknown">YOK</span> : `${value.toFixed(precision)}${unit}`}
      </div>
    </div>
  );
}
