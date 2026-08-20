'use client';

/**
 * /dashboard/fleet/company-vehicles — FİLO ARAÇLARI · ATA · ÇIKAR + ÇEVRİMDIŞI DURUM.
 *
 * #662: Kanıt Konsolu'nun "Araçlar" sekmesi araç KAPSAMINI gösterir; bu ekran
 * ŞİRKET ATAMASINI yönetir. İçerik DEĞİŞMEDİ, yalnız rota ayrıştı.
 *
 * Her araç kartı DÜRÜST durum gösterir: son görülme, sahiplik doğrulaması,
 * eşleştirme doğrulaması, bekleyen filo işlemi, bekleyen konum/olay, bekleyen
 * komutlar (evre evre), senkron durumu ve çakışma. Araç çevrimdışıyken
 * yapılamayacak işlem "başarılı" gibi GÖSTERİLMEZ.
 *
 * Tüm türetme `vehicleOfflineStatus` saf modelindedir — bu dosya yalnız
 * gösterir. Okunamayan alan "okunamadı" yazar; sahte 0 ÜRETİLMEZ.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import {
  ConfirmDialog, StateCard, LoadingState, ErrorState, EmptyState,
  PermissionDeniedState, OfflineBanner, PendingSyncBanner,
} from '@/components/fleet/FleetUi';
import {
  buildVehicleOfflineStatus, connectivityLabel, lastSeenLabel,
  ownershipLabel, pairingLabel, syncStateLabel, commandPhaseLabel,
  COMMAND_PHASES, type VehicleCommandRow, type CommandPhase,
} from '@/lib/offline/vehicleOfflineStatus';
import { readVehicleCommands } from '@/lib/offline/vehicleCommandSource';

const UNREADABLE = 'Okunamadı';

/** Sayı ya da "okunamadı" — sahte 0 YAZILMAZ. */
function countText(value: number | null, zeroLabel = 'Yok'): string {
  if (value === null) return UNREADABLE;
  return value === 0 ? zeroLabel : String(value);
}

export default function FleetVehiclesPage() {
  const { userId, loading } = useSessionUser();
  const fleet = useFleet(userId);
  const [vehicleId, setVehicleId] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);
  const [commands, setCommands] =
    useState<Readonly<Record<string, readonly VehicleCommandRow[]>> | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Komutlar: açılışta TEK okuma; abonelik/timer YOK (elle yenilenir).
  const ids = fleet.vehicles.map((v) => v.vehicle_id).join(',');
  const loadCommands = useCallback(async () => {
    const list = ids.length > 0 ? ids.split(',') : [];
    const reading = await readVehicleCommands(list, Date.now());
    if (mountedRef.current) setCommands(reading.byVehicle);
  }, [ids]);
  useEffect(() => { void loadCommands(); }, [loadCommands]);

  if (loading || fleet.phase === 'loading') return <LoadingState label="Araçlar yükleniyor…" />;
  if (fleet.phase === 'error' && fleet.errorMessage) return <ErrorState message={fleet.errorMessage} />;
  if (!fleet.company) {
    return <StateCard title="Filonuz yok">Araç atamak için önce bir filo oluşturun.</StateCard>;
  }
  if (!fleet.can('vehicle.read')) return <PermissionDeniedState />;

  async function run(action: () => Promise<{ ok: boolean; queued: boolean; message: string | null }>) {
    setBusy(true);
    const r = await action();
    setBusy(false);
    setNotice(r.ok ? (r.queued ? r.message : 'İşlem tamamlandı.') : r.message);
  }

  const now = Date.now();

  return (
    <div className="space-y-5">
      {fleet.phase === 'offline' ? <OfflineBanner pendingCount={fleet.pending.length} /> : null}
      <PendingSyncBanner count={fleet.pending.length} onSync={() => void fleet.sync()} />

      {fleet.can('vehicle.assign') ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold text-white">Aracı filoya ata</h3>
          <p className="mt-1 text-sm text-white/60">
            Yalnızca size veya filodaki bir üyeye ait araçlar filoya eklenebilir.
            Henüz kimseye bağlanmamış bir araç önce eşleştirilmelidir.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              placeholder="Araç kimliği"
              className="flex-1 rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !vehicleId.trim()}
              onClick={() => void run(async () => {
                const r = await fleet.assignVehicle(vehicleId.trim());
                if (r.ok) setVehicleId('');
                return r;
              })}
              className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              Filoya ata
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <StateCard tone="info" title="Bilgi">{notice}</StateCard> : null}

      {fleet.vehicles.length === 0 ? (
        <EmptyState
          title="Filoda araç yok"
          hint="Araçlarınızı eşleştirdikten sonra buradan filoya atayabilirsiniz."
        />
      ) : (
        <div className="space-y-3">
          {fleet.vehicles.map((v) => {
            const status = buildVehicleOfflineStatus({
              vehicleId:  v.vehicle_id,
              lastSeen:   v.last_seen,
              ownerId:    v.owner_id,
              viewerId:   userId,
              queueItems: fleet.queueItems,
              commands:   commands === null ? null : (commands[v.vehicle_id] ?? []),
              now,
            });
            const online = status.connectivity === 'ONLINE';

            return (
              <div
                key={v.vehicle_id}
                data-testid="vehicle-card"
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/25'}`} />
                      <p className="truncate font-medium text-white">
                        {v.name ?? v.plate ?? 'İsimsiz araç'}
                      </p>
                    </div>
                    <p className="truncate text-xs text-white/40">{v.vehicle_id}</p>

                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <Row label="Durum" value={connectivityLabel(status.connectivity)} />
                      <Row
                        label="Son görülme"
                        value={
                          status.connectivity === 'NEVER_CONNECTED'
                            ? 'Hiç bağlanmadı'
                            : lastSeenLabel(status.lastSeenAt, now)
                        }
                      />
                      <Row label="Sahiplik doğrulaması" value={ownershipLabel(status.ownership)} />
                      <Row label="Eşleştirme doğrulaması" value={pairingLabel(status.pairing)} />
                      <Row label="Bekleyen filo işlemi" value={countText(status.pendingFleetOps)} />
                      <Row
                        label="Bekleyen konum / olay"
                        value={
                          status.pendingLocationEvents === null || status.pendingVehicleEvents === null
                            ? UNREADABLE
                            : `${status.pendingLocationEvents} konum · ${status.pendingVehicleEvents} olay`
                        }
                      />
                      <Row label="Bekleyen komut" value={countText(status.activeCommands)} />
                      <Row label="Senkron" value={syncStateLabel(status.syncState)} />
                    </dl>

                    <CommandBreakdown byPhase={status.commandsByPhase} unknown={status.unknownCommands} />
                  </div>

                  {fleet.can('vehicle.remove') ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmRemove({
                        id: v.vehicle_id, label: v.name ?? v.plate ?? v.vehicle_id,
                      })}
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                    >
                      Filodan çıkar
                    </button>
                  ) : null}
                </div>

                {!online && (status.activeCommands ?? 0) > 0 ? (
                  <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100">
                    Araç şu anda çevrimdışı. Bekleyen komutlar araca <strong>henüz
                    ulaşmadı</strong> ve araç bağlanana kadar uygulanmayacak.
                  </p>
                ) : null}

                {(status.conflicts ?? 0) > 0 ? (
                  <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-xs text-red-100">
                    Bu araçla ilgili {status.conflicts} işlem sunucudaki durumla çakıştı.
                    Çakışmalar sayfasından karar vermeniz gerekiyor.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Aracı filodan çıkar"
        description={`${confirmRemove?.label ?? ''} filodan çıkarılacak. Araç SİLİNMEZ ve sahibi değişmez; yalnızca filo ile bağlantısı kesilir. Filo üyeleri artık bu aracı göremez.`}
        confirmLabel="Evet, çıkar"
        danger
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          const target = confirmRemove?.id;
          setConfirmRemove(null);
          if (target) void run(() => fleet.removeVehicle(target));
        }}
      />
    </div>
  );
}

/**
 * Komut evrelerinin kırılımı — "gönderildi" ile "araç gerçekten yaptı" AYRI
 * gösterilir. Sıfır olan evre yazılmaz (gürültü); hiç komut yoksa bölüm çıkmaz.
 */
function CommandBreakdown({
  byPhase, unknown,
}: {
  byPhase: Readonly<Record<CommandPhase, number>> | null;
  unknown: number | null;
}) {
  if (byPhase === null) {
    return (
      <p className="mt-3 text-xs text-white/45">
        Komut durumu okunamadı — bu alan boş sayılmamalıdır.
      </p>
    );
  }
  const shown = COMMAND_PHASES.filter((p) => byPhase[p] > 0);
  if (shown.length === 0 && !unknown) return null;

  return (
    <div className="mt-3">
      <p className="text-xs text-white/45">
        Komutlar (yalnız sizin gönderdikleriniz)
      </p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {shown.map((p) => (
          <li
            key={p}
            className="rounded-lg border border-white/12 bg-white/5 px-2.5 py-1 text-xs text-white/75"
          >
            {commandPhaseLabel(p)}: {byPhase[p]}
          </li>
        ))}
        {unknown ? (
          <li className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1 text-xs text-amber-100">
            Tanınmayan durum: {unknown}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-white/45">{label}</dt>
      <dd className="text-white/80 sm:mt-0.5">{value}</dd>
    </div>
  );
}
