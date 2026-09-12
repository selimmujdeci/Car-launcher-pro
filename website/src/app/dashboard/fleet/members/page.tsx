'use client';

/**
 * /dashboard/fleet/members — ÜYELER · ÜYE EKLE · ROL DEĞİŞTİR · ÜYE KALDIR.
 *
 * Rol düşürme ve üye kaldırma AÇIK ONAY ister. Son yönetici korunur (sunucu
 * ayrıca zorlar; burada da uyarı gösterilir).
 */

import { useState } from 'react';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import {
  ConfirmDialog, StateCard, LoadingState, ErrorState, EmptyState,
  PermissionDeniedState, OfflineBanner, PendingSyncBanner, roleLabel,
  VehicleAccessRolesCard,
} from '@/components/fleet/FleetUi';
import { ASSIGNABLE_ROLES, capabilitiesOf } from '@/lib/fleet/roles';

type PendingAction =
  | { kind: 'remove'; userId: string; label: string }
  | { kind: 'role';   userId: string; label: string; role: string }
  | null;

export default function FleetMembersPage() {
  const { userId, loading } = useSessionUser();
  const fleet = useFleet(userId);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole]     = useState<string>('member');
  const [confirm, setConfirm]     = useState<PendingAction>(null);
  const [notice, setNotice]       = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  if (loading || fleet.phase === 'loading') return <LoadingState label="Üyeler yükleniyor…" />;
  if (fleet.phase === 'error' && fleet.errorMessage) return <ErrorState message={fleet.errorMessage} />;
  if (!fleet.company) {
    return <StateCard title="Filonuz yok">Önce bir filo oluşturmalısınız.</StateCard>;
  }
  if (!fleet.can('member.read')) return <PermissionDeniedState />;

  const adminCount = fleet.members.filter((m) => m.role === 'admin').length;
  const canManage  = fleet.can('member.role.update') && fleet.can('member.remove');

  async function run(action: () => Promise<{ ok: boolean; queued: boolean; message: string | null }>) {
    setBusy(true);
    const r = await action();
    setBusy(false);
    setNotice(r.ok ? (r.queued ? r.message : 'İşlem tamamlandı.') : r.message);
  }

  return (
    <div className="space-y-5">
      {fleet.phase === 'offline' ? <OfflineBanner pendingCount={fleet.pending.length} /> : null}
      <PendingSyncBanner count={fleet.pending.length} onSync={() => void fleet.sync()} />

      {/* ── Üye ekle ─────────────────────────────────────────────────── */}
      {fleet.can('member.invite') ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold text-white">Filoya üye ekle</h3>
          <p className="mt-1 text-sm text-white/60">
            Eklemek istediğiniz kişinin kullanıcı kimliğini girin. Kişi zaten başka bir
            filodaysa eklenemez.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder="Kullanıcı kimliği"
              className="flex-1 rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-sky-500 focus:outline-none"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-white focus:border-sky-500 focus:outline-none"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r} className="bg-[#0b1526]">{roleLabel(r)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !newUserId.trim()}
              onClick={() => void run(async () => {
                const r = await fleet.addMember(newUserId.trim(), newRole);
                if (r.ok) setNewUserId('');
                return r;
              })}
              className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              Ekle
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <StateCard tone="info" title="Bilgi">{notice}</StateCard> : null}

      {/* ── Üye listesi ──────────────────────────────────────────────── */}
      {fleet.members.length === 0 ? (
        <EmptyState title="Henüz üye yok" hint="Filonuza ilk üyeyi yukarıdaki bölümden ekleyebilirsiniz." />
      ) : (
        <div className="space-y-3">
          {fleet.members.map((m) => {
            const isSelf      = m.user_id === userId;
            const isLastAdmin = m.role === 'admin' && adminCount <= 1;
            return (
              <div key={m.user_id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {m.full_name ?? 'İsimsiz kullanıcı'}{isSelf ? ' (siz)' : ''}
                    </p>
                    <p className="truncate text-xs text-white/40">{m.user_id}</p>
                    <p className="mt-1 text-sm text-white/60">{roleLabel(m.role)}</p>
                  </div>

                  {canManage && !isSelf ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => setConfirm({
                          kind: 'role', userId: m.user_id,
                          label: m.full_name ?? m.user_id, role: e.target.value,
                        })}
                        className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r} className="bg-[#0b1526]">{roleLabel(r)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || isLastAdmin}
                        onClick={() => setConfirm({
                          kind: 'remove', userId: m.user_id, label: m.full_name ?? m.user_id,
                        })}
                        className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                      >
                        Kaldır
                      </button>
                    </div>
                  ) : null}
                </div>

                {isLastAdmin ? (
                  <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100">
                    Bu kişi filodaki son yöneticidir. Kaldırılamaz ve rolü düşürülemez —
                    önce başka birini yönetici yapın.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Araç erişim rolleri (matristen türetilir) ─────────────────── */}
      <VehicleAccessRolesCard
        roles={ASSIGNABLE_ROLES}
        capabilitiesOf={capabilitiesOf}
      />

      {/* ── Onay kutuları ────────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title="Üyeyi filodan kaldır"
        description={`${confirm?.kind === 'remove' ? confirm.label : ''} filodan çıkarılacak. Kişi bireysel kullanıcıya döner; filoya ait araçlar filoda kalır. Bu işlem geri alınmaz.`}
        confirmLabel="Evet, kaldır"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== 'remove') return;
          const target = confirm.userId;
          setConfirm(null);
          void run(() => fleet.removeMember(target));
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === 'role'}
        title="Rolü değiştir"
        description={
          confirm?.kind === 'role'
            ? `${confirm.label} kullanıcısının rolü "${roleLabel(confirm.role)}" olarak değiştirilecek. Bu, kişinin yetkilerini değiştirir.`
            : ''
        }
        confirmLabel="Evet, değiştir"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind !== 'role') return;
          const { userId: target, role } = confirm;
          setConfirm(null);
          void run(() => fleet.updateMemberRole(target, role));
        }}
      />
    </div>
  );
}
