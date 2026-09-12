'use client';

/**
 * UYARILAR — bildirim merkezi + geofence/hız ihlalleri (#662).
 *
 * Sözleşme:
 *  · "Okundu" yazması sunucuda DOĞRULANIR; satır etkilenmediyse hata gösterilir
 *    (PostgREST 200 ≠ satır etkilendi — sessiz başarı YOK).
 *  · Bildirim tablosu okunamıyorsa bu SÖYLENİR; "uyarı yok" DENMEZ.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  fetchAlerts,
  markAlertRead,
  fetchDecisionLog,
  type AlertItem,
  type DecisionEvent,
  type DecisionSeverity,
} from '@/lib/console/consoleSources';
import { agoLabel } from '@/lib/console/evidenceModel';
import {
  Panel,
  PanelHead,
  EmptyState,
  ErrorState,
  StatTile,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import { vehicleTitle } from '@/lib/vehicleDisplay';

type Filter = 'all' | 'unread' | 'critical' | 'warning';

const SEVERITY_TOKEN: Record<DecisionSeverity, 'critical' | 'warning' | 'unknown'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'unknown',
};

const SEVERITY_LABEL: Record<DecisionSeverity, string> = {
  critical: 'KRİTİK',
  warning: 'UYARI',
  info: 'BİLGİ',
};

/** İhlal sınıflandırması — olay tipinden okunur, uydurulmaz. */
function violationKind(kind: string): 'GEOFENCE' | 'SPEED' | 'CURFEW' | null {
  const k = kind.toLocaleLowerCase('en-US');
  if (k.includes('geofence') || k.includes('zone')) return 'GEOFENCE';
  if (k.includes('curfew')) return 'CURFEW';
  if (k.includes('speed') || k.includes('hiz')) return 'SPEED';
  return null;
}

export default function AlertsPage() {
  const vehicles = useVehicleStore((s) => s.getList());
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [violations, setViolations] = useState<DecisionEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'unreadable'>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [writeError, setWriteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    const [rows, log] = await Promise.all([fetchAlerts(150), fetchDecisionLog(150)]);
    if (!mountedRef.current) return;
    setNow(Date.now());
    if (rows === null) { setState('unreadable'); return; }
    setAlerts(rows);
    setViolations((log ?? []).filter((e) => violationKind(e.kind) !== null));
    setState('ok');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const nameOf = useCallback(
    (id: string | null) => {
      if (!id) return 'Filo geneli';
      const v = vehicles.find((x) => x.id === id);
      return v ? vehicleTitle(v) : `Araç #${id.slice(0, 8)}`;
    },
    [vehicles],
  );

  const counts = useMemo(
    () => ({
      total: alerts.length,
      unread: alerts.filter((a) => !a.read).length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
    }),
    [alerts],
  );

  const visible = useMemo(
    () =>
      alerts.filter((a) => {
        if (filter === 'unread') return !a.read;
        if (filter === 'critical') return a.severity === 'critical';
        if (filter === 'warning') return a.severity === 'warning';
        return true;
      }),
    [alerts, filter],
  );

  const onMarkRead = useCallback(async (id: string) => {
    setWriteError(null);
    const ok = await markAlertRead(id);
    if (!mountedRef.current) return;
    if (!ok) {
      setWriteError('Okundu işaretlenemedi: bu bildirim üzerinde yazma yetkiniz yok ya da bağlantı yok.');
      return;
    }
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  }, []);

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {writeError && <ErrorState message={writeError} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <StatTile label="Toplam bildirim" count={counts.total} token="copper"
          active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatTile label="Okunmamış" count={counts.unread} token="warning"
          active={filter === 'unread'} onClick={() => setFilter('unread')} />
        <StatTile label="Kritik" count={counts.critical} token="critical"
          active={filter === 'critical'} onClick={() => setFilter('critical')} />
        <StatTile label="Uyarı" count={counts.warning} token="warning"
          active={filter === 'warning'} onClick={() => setFilter('warning')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-3 lg:gap-4 items-start">
        <Panel>
          <PanelHead
            title="Bildirim merkezi"
            meta={`${visible.length} kayıt`}
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

          {state === 'loading' ? (
            <EmptyState title="BİLDİRİMLER OKUNUYOR" />
          ) : state === 'unreadable' ? (
            <EmptyState
              title="BİLDİRİMLER OKUNAMADI"
              detail="Bildirim tablosu bu oturumda okunamıyor (yetki ya da bağlantı). Bu, 'uyarı yok' anlamına GELMEZ."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title={counts.total === 0 ? 'BİLDİRİM YOK' : 'BU FİLTREDE BİLDİRİM YOK'}
              detail={counts.total === 0 ? 'Araçlardan henüz uyarı gelmedi.' : undefined}
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
              {visible.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="mt-1 flex-shrink-0"
                    style={{ width: 4, height: 32, background: TOKEN_COLOR[SEVERITY_TOKEN[a.severity]] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span
                        className="cn-num text-[9px] uppercase tracking-[0.14em]"
                        style={{ color: TOKEN_COLOR[SEVERITY_TOKEN[a.severity]] }}
                      >
                        {SEVERITY_LABEL[a.severity]}
                      </span>
                      <span className="text-[13px] text-t1">{a.title}</span>
                      {!a.read && (
                        <span
                          className="cn-num text-[9px] px-1.5 py-0.5"
                          style={{
                            color: 'var(--cn-copper)',
                            border: '1px solid var(--cn-copper)',
                            borderRadius: 2,
                          }}
                        >
                          YENİ
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-t2 mt-1 leading-relaxed">{a.message}</p>
                    <div className="cn-num text-[10px] text-t3 mt-1">
                      {a.vehicleId ? (
                        <Link href={`/dashboard/fleet/vehicles/${a.vehicleId}`} style={{ color: 'var(--cn-copper)' }}>
                          {nameOf(a.vehicleId)}
                        </Link>
                      ) : (
                        nameOf(null)
                      )}
                      {' · '}
                      {agoLabel(a.at > 0 ? now - a.at : null)}
                    </div>
                  </div>
                  {!a.read && (
                    <button
                      onClick={() => void onMarkRead(a.id)}
                      className="cn-num text-[9px] uppercase tracking-[0.14em] px-2 py-1 border border-hair text-t2 hover:text-t1 flex-shrink-0"
                      style={{ borderRadius: 2 }}
                    >
                      OKUNDU
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="xl:sticky xl:top-3">
          <PanelHead title="İhlal olayları" meta="geofence · curfew · hız" />
          {violations.length === 0 ? (
            <EmptyState
              title="İHLAL KAYDI YOK"
              detail="Olay günlüğünde geofence, curfew ya da hız ihlali bulunamadı."
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
              {violations.slice(0, 40).map((e) => {
                const kind = violationKind(e.kind);
                return (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="cn-num text-[9px] uppercase tracking-[0.14em]"
                        style={{ color: TOKEN_COLOR[SEVERITY_TOKEN[e.severity]] }}
                      >
                        {kind === 'GEOFENCE' ? 'BÖLGE' : kind === 'CURFEW' ? 'SAAT' : 'HIZ'}
                      </span>
                      <span className="cn-num text-[11px] text-t1 break-all">{e.kind}</span>
                      <span className="cn-num text-[9px] text-t3 ml-auto">
                        {agoLabel(e.at > 0 ? now - e.at : null)}
                      </span>
                    </div>
                    {e.detail && (
                      <p className="cn-num text-[10px] text-t2 mt-1 break-all">{e.detail}</p>
                    )}
                    {e.vehicleId && (
                      <Link
                        href={`/dashboard/fleet/vehicles/${e.vehicleId}`}
                        className="cn-num text-[10px] mt-1 inline-block"
                        style={{ color: 'var(--cn-copper)' }}
                      >
                        {nameOf(e.vehicleId)} →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
