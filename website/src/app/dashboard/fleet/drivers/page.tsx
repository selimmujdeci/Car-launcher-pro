'use client';

/**
 * /dashboard/fleet/drivers — SÜRÜCÜLER · OLUŞTUR · DÜZENLE · AKTİF/PASİF.
 *
 * ── AYRIM ─────────────────────────────────────────────────────────────
 * Sürücü, **Fleet kullanıcısı DEĞİLDİR.** Bir sürücünün CAROS hesabı
 * olmak zorunda değildir (`linkedUserId` nullable); bir Fleet kullanıcısı
 * da otomatik sürücü sayılmaz. Bu sayfa yalnız SÜRÜCÜ KAYITLARINI yönetir.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────
 * Tam ehliyet numarası **hiçbir zaman** gösterilmez — sunucu yalnız
 * maskeli (`•••1234`) gönderir. Telefon yalnız yöneticiye görünür.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import {
  StateCard, LoadingState, ErrorState, EmptyState, PermissionDeniedState,
} from '@/components/fleet/FleetUi';
import {
  buildDriverViews, driverStatusLabel, licenseValidity, licenseValidityLabel,
  type DriverView,
} from '@/lib/fleet/driverIdentity';
import {
  fetchFleetDrivers, createFleetDriver, updateFleetDriver,
  driverRpcReasonLabel,
} from '@/lib/fleet/drivers.service';
import {
  readDriverDna, readSubjectEvidence,
  type DriverDnaReading, type SubjectEvidenceReading,
} from '@/lib/lab/intelligenceLabSource';
import { DriverDnaCard } from '@/components/dashboard/DriverDnaCard';
import { DriverScoreCard } from '@/components/dashboard/DriverScoreCard';
import { SubjectEvidenceList } from '@/components/dashboard/SubjectEvidenceList';

function fmtDate(ms: number | null): string {
  if (ms === null) return 'Veri yok';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export default function FleetDriversPage() {
  const { userId, loading } = useSessionUser();
  const fleet = useFleet(userId);

  /* ── DNA + kanit paneli (DORMANT ACTIVATION P0) ──────────────────────
     SQL 053 ve 055/056 bunlari ZATEN uretiyordu; eksik olan tek sey
     okuma ucuydu. Surucu SECIMI aciktir: kart yalnizca kullanici bir
     surucu sectiginde okunur (acilista toplu okuma YOK). */
  const [dnaFor, setDnaFor]   = useState<string | null>(null);
  const [dna, setDna]         = useState<DriverDnaReading | null>(null);
  const [dnaEv, setDnaEv]     = useState<SubjectEvidenceReading | null>(null);
  const dnaMounted            = useRef(true);

  useEffect(() => {
    dnaMounted.current = true;
    return () => { dnaMounted.current = false; };
  }, []);

  const selectDriver = useCallback(async (driverId: string) => {
    const next = dnaFor === driverId ? null : driverId;   // ikinci tik kapatir
    setDnaFor(next);
    setDna(null);
    setDnaEv(null);
    if (next === null) return;
    /* Iki okuma birbirini BEKLEMEZ; biri duserse digeri gosterilir. */
    const [d, e] = await Promise.all([
      readDriverDna(userId, next),
      readSubjectEvidence(userId, 'DRIVER', next),
    ]);
    if (!dnaMounted.current) return;
    setDna(d);
    setDnaEv(e);
  }, [userId, dnaFor]);

  const [rows, setRows]       = useState<DriverView[] | null>(null);
  const [readable, setReadable] = useState<boolean | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [name, setName]       = useState('');
  const [code, setCode]       = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const mountedRef = useRef(true);

  const refresh = useCallback(async (includeArchived: boolean) => {
    const data = await fetchFleetDrivers(includeArchived);
    if (!mountedRef.current) return;
    const view = buildDriverViews(data);
    setReadable(view.readable);
    setRows(view.readable ? [...view.drivers] : null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(showArchived);
    return () => { mountedRef.current = false; };
  }, [refresh, showArchived]);

  if (loading || fleet.phase === 'loading') {
    return <LoadingState label="Sürücüler yükleniyor…" />;
  }
  if (fleet.phase === 'error' && fleet.errorMessage) {
    return <ErrorState message={fleet.errorMessage} />;
  }
  if (!fleet.company) {
    return <StateCard title="Filonuz yok">Önce bir filo oluşturmalısınız.</StateCard>;
  }
  /* Sürücü kayıtları şirket verisidir — okuma için üyelik yeter. */
  if (!fleet.can('member.read')) return <PermissionDeniedState />;

  /* Sürücü YÖNETİMİ yalnız yöneticide. Observer/member SALT-OKUR. */
  const canManage = fleet.can('member.invite');

  async function handleCreate() {
    if (name.trim().length === 0) { setNotice('Sürücü adı gerekli.'); return; }
    setBusy(true);
    const res = await createFleetDriver({
      displayName: name.trim(),
      employeeCode: code.trim().length > 0 ? code.trim() : null,
    });
    if (!mountedRef.current) return;
    setBusy(false);
    const err = driverRpcReasonLabel(res);
    if (err) { setNotice(err); return; }
    setName(''); setCode(''); setNotice('Sürücü eklendi.');
    void refresh(showArchived);
  }

  async function handleStatus(d: DriverView, status: string) {
    setBusy(true);
    const res = await updateFleetDriver({ driverId: d.driverId, status });
    if (!mountedRef.current) return;
    setBusy(false);
    const err = driverRpcReasonLabel(res);
    setNotice(err ?? 'Sürücü güncellendi.');
    void refresh(showArchived);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white/90">Sürücüler</h1>
          <p className="text-xs text-white/40">
            Sürücü kaydı, Fleet hesabından bağımsızdır — hesabı olmayan
            sürücüler de eklenebilir.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/50">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Arşivlenmişleri göster
        </label>
      </div>

      {notice && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
          {notice}
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col gap-2">
          <span className="text-xs text-white/50">Yeni sürücü</span>
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ad soyad"
              className="flex-1 min-w-[180px] rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-white/80"
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Personel kodu (opsiyonel)"
              className="w-48 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-white/80"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreate()}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white/80 disabled:opacity-40"
            >
              Ekle
            </button>
          </div>
          <p className="text-[10px] text-white/25">
            Ehliyet ve telefon bilgisi kişisel veridir; yalnız gerektiğinde
            ve sürücü düzenleme ekranından girilir.
          </p>
        </div>
      )}

      {/* Okunamadı ≠ sürücü yok — ikisi AYRI gösterilir. */}
      {readable === false && (
        <ErrorState message="Sürücü listesi okunamadı. Bu, sürücü olmadığı anlamına gelmez." />
      )}

      {readable === true && rows !== null && rows.length === 0 && (
        <EmptyState
          title="Henüz sürücü kaydı yok"
          hint="Sürücü ekleyip araca atadığınızda yolculuklar o sürücüye bağlanır."
        />
      )}

      {rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((d) => {
            const lic = licenseValidity(d.licenseExpiresAtMs, Date.now());
            return (
              <div
                key={d.driverId}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white/85">{d.displayName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    d.status === 'ACTIVE'
                      ? 'border-emerald-400/30 text-emerald-300/80'
                      : 'border-white/15 text-white/40'
                  }`}>
                    {driverStatusLabel(d.status)}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                  {[
                    { k: 'Personel kodu', v: d.employeeCode ?? 'Veri yok' },
                    /* Hesap bağı yalnız BİLGİDİR — sürücülükle ilgisi yok. */
                    { k: 'Bağlı hesap', v: d.hasLinkedAccount ? 'Var' : 'Yok' },
                    { k: 'Aktif araç', v: d.activeVehicleId ?? 'Atama yok' },
                    { k: 'Atama başlangıcı', v: fmtDate(d.activeSinceMs) },
                    { k: 'Ehliyet', v: `${d.licenseMasked ?? 'Veri yok'} · ${licenseValidityLabel(lic)}` },
                    { k: 'Son yolculuk', v: fmtDate(d.lastTripAtMs) },
                  ].map(({ k, v }) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[10px] text-white/25">{k}</span>
                      <span className={`text-[10px] font-mono ${
                        v === 'Veri yok' || v === 'Atama yok'
                          ? 'text-white/25' : 'text-white/65'
                      }`}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>

                {/* DNA + kanit acma/kapama — her role acik (salt-okunur). */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    data-testid={`driver-dna-toggle-${d.driverId}`}
                    onClick={() => void selectDriver(d.driverId)}
                    aria-expanded={dnaFor === d.driverId}
                    className="text-[11px] rounded-md border border-sky-400/25 px-2 py-1 text-sky-300/80"
                  >
                    {dnaFor === d.driverId ? 'Surucu DNA gizle' : 'Surucu DNA ve kanit'}
                  </button>
                </div>

                {dnaFor === d.driverId && (
                  <div className="flex flex-col gap-2 pt-1" data-testid="driver-dna-panel">
                    {dna === null ? (
                      <p className="text-[11px] text-white/40">Okunuyor…</p>
                    ) : !dna.readable ? (
                      <p className="text-[11px] text-amber-300/80">
                        Surucu DNA OKUNAMADI — bu &quot;veri yok&quot; demek degildir.
                        Yetki veya oturum eksik olabilir.
                      </p>
                    ) : dna.row === null ? (
                      <p className="text-[11px] text-white/40">
                        Bu surucu icin henuz yeterli yolculuk yok — DNA olusmadi.
                      </p>
                    ) : (
                      /* AD DEGIL, kisaltilmis referans (kart paylasilabilir olmali). */
                      <>
                        <DriverDnaCard row={dna.row} driverRef={`drv:${d.driverId.slice(0, 8)}`} />
                        {/* Skor AYRI kart: DNA "puan degil, kanit" der ve o
                            durusunu korur; skor ondan TURETILIR, yerine gecmez.
                            Ayni satirdan beslenir -> ikinci cekim/otorite YOK. */}
                        <DriverScoreCard row={dna.row} />
                      </>
                    )}

                    {dnaEv !== null && dnaEv.readable && (
                      <SubjectEvidenceList rows={dnaEv.rows} title="Surucu kaniti" />
                    )}
                    {dnaEv !== null && !dnaEv.readable && (
                      <p className="text-[11px] text-amber-300/80">
                        Kanit listesi OKUNAMADI — bu &quot;kanit yok&quot; demek degildir.
                      </p>
                    )}
                  </div>
                )}

                {canManage && (
                  <div className="flex gap-2 pt-1">
                    {d.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleStatus(d, 'INACTIVE')}
                        className="text-[11px] rounded-md border border-white/10 px-2 py-1 text-white/55 disabled:opacity-40"
                      >
                        Pasifleştir
                      </button>
                    ) : d.status !== 'ARCHIVED' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleStatus(d, 'ACTIVE')}
                        className="text-[11px] rounded-md border border-white/10 px-2 py-1 text-white/55 disabled:opacity-40"
                      >
                        Aktifleştir
                      </button>
                    ) : null}
                    {d.status !== 'ARCHIVED' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleStatus(d, 'ARCHIVED')}
                        className="text-[11px] rounded-md border border-white/10 px-2 py-1 text-white/40 disabled:opacity-40"
                      >
                        Arşivle
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-white/25">
            Sürücü kaydı silinmez, arşivlenir — geçmiş yolculukların sürücü
            bilgisi korunur.
          </p>
        </div>
      )}
    </div>
  );
}
