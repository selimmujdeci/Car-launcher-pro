'use client';

/**
 * FİLO YÖNETİMİ — sürücü ataması · araç ekleme · roller · çevrimdışı kuyruk (#662).
 *
 * Sözleşme:
 *  · Yazma yolları MEVCUT RPC'leri kullanır (`create_vehicle_driver_assignment`,
 *    `end_vehicle_driver_assignment`) — paralel bir yazma yolu KURULMAZ.
 *  · RPC "başarısız" dönerse gerekçe GÖSTERİLİR; sessiz başarı YOK.
 *  · Sürücü listesi okunamıyorsa bu SÖYLENİR; "sürücü yok" DENMEZ.
 *  · Çevrimdışı kuyruk `useFleet` otoritesinden okunur; kuyruktaki işlem
 *    "tamamlandı" olarak GÖSTERİLMEZ.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  fetchFleetDrivers,
  createVehicleDriverAssignment,
  endVehicleDriverAssignment,
  driverRpcReasonLabel,
} from '@/lib/fleet/drivers.service';
import type { DriverRow } from '@/lib/fleet/driverIdentity';
import { fetchAssignments, type AssignmentRow } from '@/lib/console/consoleSources';
import { fetchVehicleTrips } from '@/lib/vehicles.service';
import { ShiftBoard } from '@/components/dashboard/ShiftBoard';
import type { AssignmentInput, TripWindowInput } from '@/lib/fleet/shiftView';
import AddVehicleModal from '@/components/dashboard/AddVehicleModal';
import {
  Panel,
  PanelHead,
  StatTile,
  EmptyState,
  ErrorState,
  EvidenceBadge,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import { agoLabel } from '@/lib/console/evidenceModel';
import { trDate } from '@/lib/console/recordsModel';
import { vehicleTitle } from '@/lib/vehicleDisplay';

const SUB_SCREENS = [
  { href: '/dashboard/fleet/company',          title: 'Şirket',            detail: 'Filo oluştur, ad değiştir, kapsamı gör' },
  { href: '/dashboard/fleet/members',          title: 'Roller ve yetkiler', detail: 'Yönetici · üye · gözlemci — RLS ile uyumlu' },
  { href: '/dashboard/fleet/drivers',          title: 'Sürücü kayıtları',   detail: 'Sürücü ekle, ehliyet ve kimlik bilgileri' },
  { href: '/dashboard/fleet/company-vehicles', title: 'Araç atamaları',     detail: 'Aracı şirkete ata / şirketten çıkar' },
  { href: '/dashboard/fleet/transfer',         title: 'Sahiplik devri',     detail: 'Aracı başka hesaba devret' },
  { href: '/dashboard/fleet/pending',          title: 'Bekleyen işlemler',  detail: 'Sunucu onayı bekleyen kuyruk' },
  { href: '/dashboard/fleet/conflicts',        title: 'Çakışmalar',         detail: 'Çevrimdışı çakışma çözümü' },
];

export default function FleetManagePage() {
  const { userId } = useSessionUser();
  const fleet = useFleet(userId);
  const vehicles = useVehicleStore((s) => s.getList());

  const [drivers, setDrivers] = useState<DriverRow[] | null>(null);
  const [driversUnreadable, setDriversUnreadable] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [assignmentsUnreadable, setAssignmentsUnreadable] = useState(false);

  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [endExisting, setEndExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ── Vardiya kapsamı için yolculuklar (V-16/6) ────────────────────────
     `null` = OKUNAMADI → pano "vardiya dışı sürüş HESAPLANAMADI" der,
     asla "0" DEMEZ. Araç başına bir çağrı yapılır; bu yüzden BİLİNÇLİ bir
     tavan vardır — tavan aşılırsa kapsam eksikliği AÇIKÇA yazılır, sessizce
     kırpılmaz. */
  const [tripWindows, setTripWindows] = useState<TripWindowInput[] | null>(null);
  const [tripScopeNote, setTripScopeNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([fetchFleetDrivers(false), fetchAssignments()]);
    if (!mountedRef.current) return;
    setNow(Date.now());
    setDriversUnreadable(d === null);
    setDrivers(d ?? []);
    setAssignmentsUnreadable(a === null);
    setAssignments(a ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Yolculuk pencereleri — vardiya kapsamı için. Araç listesi hazır olunca
     tavanla sınırlı biçimde çekilir; hiçbiri okunamazsa `null` bırakılır. */
  const TRIP_SCOPE_CAP = 25;
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (vehicles.length === 0) { setTripWindows(null); setTripScopeNote(null); return; }
      const scoped = vehicles.slice(0, TRIP_SCOPE_CAP);
      const results = await Promise.all(scoped.map((v) => fetchVehicleTrips(v.id, 50)));
      if (!alive) return;
      const readable = results.filter((r) => r !== null);
      if (readable.length === 0) {
        setTripWindows(null);
        setTripScopeNote('Hiçbir aracın yolculukları okunamadı.');
        return;
      }
      const rows: TripWindowInput[] = [];
      scoped.forEach((v, i) => {
        for (const t of results[i] ?? []) {
          rows.push({
            vehicle_id: v.id,
            started_at: (t as { started_at?: string }).started_at ?? null,
            ended_at: (t as { ended_at?: string }).ended_at ?? null,
            distance_km: (t as { distance_km?: number | string }).distance_km ?? null,
          });
        }
      });
      setTripWindows(rows);
      const missed = scoped.length - readable.length;
      const capped = vehicles.length - scoped.length;
      const notes: string[] = [];
      if (capped > 0) notes.push(`${capped} araç kapsam dışı (tavan ${TRIP_SCOPE_CAP}).`);
      if (missed > 0) notes.push(`${missed} aracın yolculukları okunamadı.`);
      setTripScopeNote(notes.length > 0
        ? `Kapsam EKSİK: ${notes.join(' ')} Vardiya dışı sürüş sayısı bu eksiklikle okunmalı.`
        : null);
    })();
    return () => { alive = false; };
  }, [vehicles]);

  /* Pano girdisi: okunamadıysa `null` GEÇİLİR ki "vardiya yok" ile
     karışmasın (ikisi AYRI hükümdür). */
  const shiftAssignments = useMemo<AssignmentInput[] | null>(() => {
    if (assignmentsUnreadable) return null;
    return (assignments ?? []).map((a) => ({
      assignment_id: a.id,
      vehicle_id: a.vehicleId || null,
      vehicle_name: a.vehicleName,
      driver_id: a.driverId,
      driver_name: a.driverName,
      starts_at: a.startedAt,
      ends_at: a.endedAt,
      status: a.status,
      assignment_type: a.assignmentType,
    }));
  }, [assignments, assignmentsUnreadable]);

  const activeByVehicle = useMemo(() => {
    const map = new Map<string, DriverRow>();
    for (const d of drivers ?? []) {
      if (d.active_vehicle_id) map.set(d.active_vehicle_id, d);
    }
    return map;
  }, [drivers]);

  const onAssign = useCallback(async () => {
    if (!vehicleId || !driverId || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const result = await createVehicleDriverAssignment({ vehicleId, driverId, endExisting });
    if (!mountedRef.current) return;
    setBusy(false);
    /* RPC sözleşmesi durum döndürür; `CREATED`/`UPDATED` dışındaki her şey
       BAŞARI DEĞİLDİR — `UNCHANGED` bile "atama yapıldı" demek değildir. */
    if (result.state === 'CREATED' || result.state === 'UPDATED') {
      setNotice('Atama sunucuda oluşturuldu.');
      setVehicleId('');
      setDriverId('');
      void load();
    } else {
      setError(driverRpcReasonLabel(result) ?? 'Atama oluşturulamadı. Yetki ya da bağlantı sorunu olabilir.');
    }
  }, [vehicleId, driverId, endExisting, busy, load]);

  const onEnd = useCallback(async (assignmentId: string) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    const result = await endVehicleDriverAssignment(assignmentId);
    if (!mountedRef.current) return;
    setBusy(false);
    if (result.state === 'UPDATED' || result.state === 'CREATED') {
      setNotice('Atama kapatıldı.');
      void load();
    } else {
      setError(driverRpcReasonLabel(result) ?? 'Atama kapatılamadı.');
    }
  }, [load]);

  const openAssignments = (assignments ?? []).filter((a) => a.endedAt === null);
  const pastAssignments = (assignments ?? []).filter((a) => a.endedAt !== null);

  const nameOf = useCallback(
    (id: string) => {
      const v = vehicles.find((x) => x.id === id);
      return v ? vehicleTitle(v) : `Araç #${id.slice(0, 8)}`;
    },
    [vehicles],
  );

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {error && <ErrorState message={error} />}
      {notice && (
        <div
          className="px-4 py-3 cn-num text-[11px]"
          style={{ color: 'var(--cn-verified)', background: 'var(--cn-verified-bg)', border: '1px solid var(--cn-verified)' }}
        >
          {notice}
        </div>
      )}

      {/* ── Kuyruk ve kapsam sayaçları ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <StatTile label="Filodaki araç" count={vehicles.length} token="copper" />
        <StatTile label="Kayıtlı sürücü" count={drivers?.length ?? 0} token="copper" />
        <StatTile label="Bekleyen işlem" count={fleet.pending.length}
          token={fleet.pending.length > 0 ? 'warning' : 'unknown'} />
        <StatTile label="Çakışma" count={fleet.conflicts.length}
          token={fleet.conflicts.length > 0 ? 'critical' : 'unknown'} />
      </div>

      {fleet.phase === 'offline' && (
        <div
          className="px-4 py-3 cn-num text-[11px]"
          style={{ color: 'var(--cn-warning)', background: 'var(--cn-warning-bg)', border: '1px solid var(--cn-warning)' }}
        >
          ÇEVRİMDIŞI — yapılan işlemler kuyruğa alınır ve sunucu onayı gelene kadar
          &quot;tamamlandı&quot; SAYILMAZ.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 lg:gap-4 items-start">
        {/* ── Sürücü atama ── */}
        <Panel>
          <PanelHead
            title="Sürücü ataması"
            meta="araç ↔ sürücü eşleştirme"
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

          {driversUnreadable ? (
            <EmptyState
              title="SÜRÜCÜ LİSTESİ OKUNAMADI"
              detail="Sürücü kayıtları bu oturumda okunamıyor (yetki ya da şema). Bu, 'sürücü yok' anlamına GELMEZ."
            />
          ) : (drivers ?? []).length === 0 ? (
            <EmptyState
              title="KAYITLI SÜRÜCÜ YOK"
              detail="Atama yapabilmek için önce sürücü kaydı oluşturulmalı."
            />
          ) : (
            <div className="p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="cn-eyebrow">Araç</span>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="cn-num text-[12px] px-3 py-2 bg-bezel text-t1 border border-hair"
                  style={{ borderRadius: 2 }}
                >
                  <option value="">Seçin…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleTitle(v)}
                      {activeByVehicle.get(v.id) ? ` — ${activeByVehicle.get(v.id)!.display_name}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="cn-eyebrow">Sürücü</span>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="cn-num text-[12px] px-3 py-2 bg-bezel text-t1 border border-hair"
                  style={{ borderRadius: 2 }}
                >
                  <option value="">Seçin…</option>
                  {(drivers ?? []).map((d) => (
                    <option key={d.driver_id ?? ''} value={d.driver_id ?? ''}>
                      {d.display_name ?? 'isimsiz sürücü'}
                      {d.employee_code ? ` (${d.employee_code})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endExisting}
                  onChange={(e) => setEndExisting(e.target.checked)}
                  className="accent-[var(--cn-copper)]"
                />
                <span className="text-[12px] text-t2">
                  Mevcut açık atamayı kapat (vardiya devri)
                </span>
              </label>

              <button
                onClick={() => void onAssign()}
                disabled={!vehicleId || !driverId || busy}
                className="cn-num text-[11px] uppercase tracking-[0.16em] px-4 py-2.5 disabled:opacity-40"
                style={{
                  borderRadius: 2,
                  background: 'var(--cn-copper)',
                  color: '#0A0A0C',
                }}
              >
                {busy ? 'İŞLENİYOR…' : 'ATAMAYI OLUŞTUR'}
              </button>
            </div>
          )}

          {/* Vardiya panosu (V-16/6) — AYNI atama satırlarından türetilir;
              ikinci bir çekim/otorite YOK. */}
          <div className="border-t border-hair p-4">
            <ShiftBoard
              assignments={shiftAssignments}
              trips={tripWindows}
              nowMs={now}
              tripScopeNote={tripScopeNote}
            />
          </div>

          {/* Açık atamalar */}
          <div className="border-t border-hair">
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="cn-eyebrow">Açık atamalar</span>
              <span className="cn-num text-[10px] text-t3">{openAssignments.length}</span>
            </div>
            {assignmentsUnreadable ? (
              <EmptyState title="ATAMALAR OKUNAMADI" detail="Atama listesi bu oturumda okunamıyor." />
            ) : openAssignments.length === 0 ? (
              <EmptyState title="AÇIK ATAMA YOK" />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
                {openAssignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-t1 truncate">{nameOf(a.vehicleId)}</div>
                      <div className="cn-num text-[10px] text-t3">
                        {a.driverName ?? 'sürücü adı gelmedi'} · başlangıç {trDate(new Date(a.startedAt).toISOString())}
                      </div>
                    </div>
                    <button
                      onClick={() => void onEnd(a.id)}
                      disabled={busy}
                      className="cn-num text-[9px] uppercase tracking-[0.14em] px-2 py-1 border border-hair text-t2 hover:text-t1 disabled:opacity-40"
                      style={{ borderRadius: 2 }}
                    >
                      KAPAT
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Geçmiş atamalar */}
          {pastAssignments.length > 0 && (
            <div className="border-t border-hair">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="cn-eyebrow">Geçmiş atamalar</span>
                <span className="cn-num text-[10px] text-t3">{pastAssignments.length}</span>
              </div>
              <ul className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: 'var(--cn-line-soft)' }}>
                {pastAssignments.slice(0, 40).map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <div className="text-[12px] text-t2 truncate">{nameOf(a.vehicleId)}</div>
                    <div className="cn-num text-[10px] text-t3">
                      {a.driverName ?? '—'} · {agoLabel(a.endedAt ? now - a.endedAt : null)} kapandı
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-3 lg:gap-4">
          {/* ── Araç ekleme ── */}
          <Panel>
            <PanelHead title="Araç ekle" meta="eşleştirme kodu ile" />
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[12px] text-t2 leading-relaxed">
                Araç ekranındaki <strong className="text-t1">eşleştirme kodunu</strong> girerek aracı
                bu hesaba bağlayın. Kod araç tarafında üretilir ve kısa sürede geçersiz olur.
              </p>
              <button
                onClick={() => setShowAdd(true)}
                className="cn-num text-[11px] uppercase tracking-[0.16em] px-4 py-2.5 self-start"
                style={{ borderRadius: 2, background: 'var(--cn-copper)', color: '#0A0A0C' }}
              >
                EŞLEŞTİRME KODUNU GİR
              </button>
            </div>
          </Panel>

          {/* ── Çevrimdışı kuyruk ── */}
          <Panel>
            <PanelHead
              title="Çevrimdışı kuyruk"
              meta={fleet.pending.length === 0 && fleet.conflicts.length === 0 ? 'temiz' : undefined}
              action={
                <EvidenceBadge
                  verdict={
                    fleet.conflicts.length > 0 ? 'CRITICAL'
                    : fleet.pending.length > 0 ? 'WARNING'
                    : 'VERIFIED'
                  }
                  compact
                />
              }
            />
            {fleet.pending.length === 0 && fleet.conflicts.length === 0 ? (
              <EmptyState
                title="KUYRUK BOŞ"
                detail="Sunucuya gönderilmeyi bekleyen işlem yok."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
                {[...fleet.conflicts, ...fleet.pending].slice(0, 20).map((item, i) => {
                  const conflict = fleet.conflicts.includes(item);
                  return (
                    <li key={item.id ?? `q-${i}`} className="flex items-center gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        style={{
                          width: 4, height: 26,
                          background: conflict ? TOKEN_COLOR.critical : TOKEN_COLOR.warning,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="cn-num text-[12px] text-t1 truncate">{item.operationType}</div>
                        <div className="cn-num text-[10px] text-t3">
                          {conflict ? 'ÇAKIŞMA — çözüm gerekiyor' : 'sunucu onayı bekleniyor'}
                          {item.failureCode ? ` · ${item.failureCode}` : ''}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {(fleet.pending.length > 0 || fleet.conflicts.length > 0) && (
              <div className="px-4 py-3 border-t border-hair flex gap-3">
                <Link href="/dashboard/fleet/pending" className="cn-num text-[10px]" style={{ color: 'var(--cn-copper)' }}>
                  Bekleyenler →
                </Link>
                <Link href="/dashboard/fleet/conflicts" className="cn-num text-[10px]" style={{ color: 'var(--cn-copper)' }}>
                  Çakışmalar →
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Alt ekranlar ── */}
      <Panel>
        <PanelHead title="Yönetim ekranları" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
          {SUB_SCREENS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="cn-bezel px-4 py-3 hover:bg-panel transition-colors"
            >
              <div className="text-[13px] text-t1">{s.title}</div>
              <div className="text-[11px] text-t3 mt-1 leading-relaxed">{s.detail}</div>
            </Link>
          ))}
        </div>
      </Panel>

      {showAdd && <AddVehicleModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
