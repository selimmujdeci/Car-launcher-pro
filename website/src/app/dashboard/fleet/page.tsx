'use client';

/**
 * FİLO GENEL BAKIŞ — Kanıt Konsolu ana ekranı (#662).
 *
 * Ekran sözleşmesi:
 *  · Araç/telemetri okuması `vehicleStore`dan gelir — İKİNCİ OTORİTE KURULMAZ.
 *  · Karar günlüğü ek okumadır (`consoleSources`) ve okunamazsa bunu SÖYLER;
 *    "olay yok" ile "okunamadı" aynı görünmez.
 *  · Sayaçlar hükümdür: kanıtsız araç "sağlıklı" sayılmaz, ayrı sütunda durur.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  judgeVehicle,
  tallyFleet,
  verdictLabel,
  verdictToken,
  agoLabel,
  type Verdict,
} from '@/lib/console/evidenceModel';
import {
  fetchDecisionLog,
  type DecisionEvent,
} from '@/lib/console/consoleSources';
import {
  Panel,
  PanelHead,
  StatTile,
  StatusDot,
  EmptyState,
  ErrorState,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import { vehicleTitle, vehicleSubtitle } from '@/lib/vehicleDisplay';
import type { LiveVehicle } from '@/types/realtime';

type FilterKey = 'all' | Verdict | 'offline';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'Tümü',
  CRITICAL: 'Kritik',
  WARNING: 'Uyarı',
  VERIFIED: 'Kanıtlı',
  NO_EVIDENCE: 'Kanıt bekliyor',
  offline: 'Çevrimdışı',
};

/** Günlük yenileme aralığı — ürün ekranı, kullanıcı kapatabilir. */
const LOG_REFRESH_MS = 20_000;

export default function FleetOverviewPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const loading = useVehicleStore((s) => s.loading);
  const storeError = useVehicleStore((s) => s.error);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [log, setLog] = useState<DecisionEvent[] | null>(null);
  const [logState, setLogState] = useState<'idle' | 'loading' | 'unreadable'>('idle');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadLog = useCallback(async () => {
    setLogState('loading');
    const rows = await fetchDecisionLog(60);
    if (!mountedRef.current) return;
    setNow(Date.now());
    if (rows === null) { setLogState('unreadable'); return; }
    setLog(rows);
    setLogState('idle');
  }, []);

  useEffect(() => { void loadLog(); }, [loadLog]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => { void loadLog(); }, LOG_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, loadLog]);

  /* Hükümler — araç başına bir kez hesaplanır, listede yeniden hesaplanmaz. */
  const judged = useMemo(
    () =>
      vehicles.map((v) => ({
        vehicle: v,
        judgement: judgeVehicle(v.telemetry, v.batteryVoltage ?? null),
        offline: v.status === 'offline',
      })),
    [vehicles],
  );

  const tally = useMemo(
    () => tallyFleet(judged.map((j) => ({ verdict: j.judgement.verdict, offline: j.offline }))),
    [judged],
  );

  const drivers = useMemo(() => {
    const set = new Set<string>();
    for (const v of vehicles) if (v.driver && v.driver !== '—') set.add(v.driver);
    return Array.from(set).sort();
  }, [vehicles]);

  const visible = useMemo(
    () =>
      judged.filter((j) => {
        if (driverFilter !== 'all' && j.vehicle.driver !== driverFilter) return false;
        if (filter === 'all') return true;
        if (filter === 'offline') return j.offline;
        return j.judgement.verdict === filter;
      }),
    [judged, filter, driverFilter],
  );

  if (loading) {
    return (
      <Panel>
        <EmptyState title="ARAÇ VERİSİ YÜKLENİYOR" detail="Filo kapsamı ve telemetri okunuyor." />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {storeError && <ErrorState message={`Araç verisi okunamadı: ${storeError}`} />}

      {/* ── Üst şerit: hüküm sayaçları (aynı zamanda filtre) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 lg:gap-3">
        <StatTile label="Toplam araç" count={tally.total} token="copper"
          active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatTile label="Kritik" count={tally.critical} token="critical"
          active={filter === 'CRITICAL'} onClick={() => setFilter('CRITICAL')} />
        <StatTile label="Uyarı" count={tally.warning} token="warning"
          active={filter === 'WARNING'} onClick={() => setFilter('WARNING')} />
        <StatTile label="Kanıtlı sağlıklı" count={tally.verified} token="verified"
          active={filter === 'VERIFIED'} onClick={() => setFilter('VERIFIED')} />
        <StatTile label="Kanıt bekliyor" count={tally.noEvidence} token="unknown"
          active={filter === 'NO_EVIDENCE'} onClick={() => setFilter('NO_EVIDENCE')} />
        <StatTile label="Çevrimdışı" count={tally.offline} token="unknown"
          active={filter === 'offline'} onClick={() => setFilter('offline')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-3 lg:gap-4 items-start">
        {/* ── Araç listesi ── */}
        <Panel>
          <PanelHead
            title="Araç kapsamı"
            meta={`${visible.length} / ${tally.total} gösteriliyor`}
            action={
              drivers.length > 0 ? (
                <label className="flex items-center gap-2">
                  <span className="cn-eyebrow">Sürücü</span>
                  <select
                    value={driverFilter}
                    onChange={(e) => setDriverFilter(e.target.value)}
                    className="cn-num text-[11px] px-2 py-1 bg-bezel text-t1 border border-hair"
                    style={{ borderRadius: 2 }}
                  >
                    <option value="all">Tümü</option>
                    {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              ) : null
            }
          />

          {visible.length === 0 ? (
            <EmptyState
              title={tally.total === 0 ? 'FİLODA ARAÇ YOK' : `${FILTER_LABEL[filter]} FİLTRESİNDE ARAÇ YOK`}
              detail={
                tally.total === 0
                  ? 'Araç eşleştirildiğinde kapsam burada belirir. Yönetim sekmesinden araç ekleyebilirsiniz.'
                  : 'Filtreyi değiştirerek diğer araçları görebilirsiniz.'
              }
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
              {visible.map(({ vehicle, judgement, offline }) => (
                <VehicleRow
                  key={vehicle.id}
                  vehicle={vehicle}
                  verdict={judgement.verdict}
                  reason={judgement.reason}
                  offline={offline}
                />
              ))}
            </ul>
          )}
        </Panel>

        {/* ── Karar omurgası günlüğü ── */}
        <Panel className="xl:sticky xl:top-3">
          <PanelHead
            title="Karar omurgası"
            meta={logState === 'loading' ? 'okunuyor…' : log ? `${log.length} kayıt` : undefined}
            action={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAutoRefresh((a) => !a)}
                  className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair"
                  style={{
                    borderRadius: 2,
                    color: autoRefresh ? 'var(--cn-verified)' : 'var(--cn-text-3)',
                    background: autoRefresh ? 'var(--cn-verified-bg)' : 'transparent',
                  }}
                  aria-pressed={autoRefresh}
                >
                  {autoRefresh ? 'CANLI' : 'DURDU'}
                </button>
                <button
                  onClick={() => void loadLog()}
                  className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
                  style={{ borderRadius: 2 }}
                >
                  YENİLE
                </button>
              </div>
            }
          />
          <DecisionLog state={logState} rows={log} now={now} />
        </Panel>
      </div>
    </div>
  );
}

/* ── Araç satırı ───────────────────────────────────────────────────────── */

function VehicleRow({
  vehicle: v,
  verdict,
  reason,
  offline,
}: {
  vehicle: LiveVehicle;
  verdict: Verdict;
  reason: string;
  offline: boolean;
}) {
  const token = offline ? 'unknown' : verdictToken(verdict);
  return (
    <li>
      <Link
        href={`/dashboard/fleet/vehicles/${v.id}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-bezel transition-colors"
      >
        <StatusDot verdict={verdict} offline={offline} />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="cn-display text-[14px] text-t1">{vehicleTitle(v)}</span>
            {vehicleSubtitle(v) && (
              <span className="cn-num text-[10px] text-t3 truncate">{vehicleSubtitle(v)}</span>
            )}
          </div>
          <div className="cn-num text-[10px] text-t3 mt-0.5 truncate">
            {reason}
            {v.driver && v.driver !== '—' && <span> · {v.driver}</span>}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div
            className="cn-num text-[10px] uppercase tracking-[0.16em]"
            style={{ color: TOKEN_COLOR[token] }}
          >
            {offline ? 'ÇEVRİMDIŞI' : verdictLabel(verdict)}
          </div>
          <div className="cn-num text-[10px] text-t3 mt-0.5">
            {v.telemetry ? agoLabel(v.telemetry.deviceAgeMs) : v.lastSeen}
          </div>
        </div>
      </Link>
    </li>
  );
}

/* ── Karar günlüğü (terminal akışı) ────────────────────────────────────── */

const SEVERITY_TOKEN = {
  critical: 'critical',
  warning: 'warning',
  info: 'unknown',
} as const;

function DecisionLog({
  state,
  rows,
  now,
}: {
  state: 'idle' | 'loading' | 'unreadable';
  rows: DecisionEvent[] | null;
  now: number;
}) {
  if (state === 'unreadable') {
    return (
      <EmptyState
        title="GÜNLÜK OKUNAMADI"
        detail="Olay ve bildirim tabloları bu oturumda okunamıyor (yetki ya da bağlantı). Bu, 'olay yok' anlamına GELMEZ."
      />
    );
  }
  if (rows === null) {
    return <EmptyState title="GÜNLÜK YÜKLENİYOR" />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="KAYIT YOK"
        detail="Araçlardan henüz olay ya da bildirim gelmedi. Kayıt geldikçe burada zaman sırasıyla listelenir."
      />
    );
  }

  return (
    <div className="max-h-[520px] overflow-y-auto" style={{ background: 'var(--cn-bg-void)' }}>
      <ul>
        {rows.map((e) => {
          const token = SEVERITY_TOKEN[e.severity];
          return (
            <li
              key={e.id}
              className="px-3 py-2 border-b"
              style={{ borderColor: 'var(--cn-line-soft)' }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="cn-num text-[9px] uppercase tracking-[0.14em] flex-shrink-0"
                  style={{ color: TOKEN_COLOR[token] }}
                >
                  {e.origin === 'EVENT' ? 'EVT' : 'NTF'}
                </span>
                <span className="cn-num text-[11px] text-t1 break-all">{e.kind}</span>
                <span className="cn-num text-[9px] text-t3 ml-auto flex-shrink-0">
                  {agoLabel(e.at > 0 ? now - e.at : null)}
                </span>
              </div>
              {e.detail && (
                <p className="cn-num text-[10px] text-t2 mt-1 break-all leading-relaxed">{e.detail}</p>
              )}
              {e.vehicleId && (
                <p className="cn-num text-[9px] text-t3 mt-0.5">araç: {e.vehicleId.slice(0, 8)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
