'use client';

/**
 * /dashboard/fleet — FİLO ANA EKRANI.
 *
 * Durumlar: bireysel · şirketi yok · admin · üye · gözlemci ·
 *           yükleniyor · boş · hata · çevrimdışı · bekleyen senkron · çakışma.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import {
  StateCard, LoadingState, ErrorState, OfflineBanner,
  PendingSyncBanner, ConflictBanner, RoleBadge,
} from '@/components/fleet/FleetUi';

export default function FleetPage() {
  const { userId, loading: userLoading } = useSessionUser();
  const fleet = useFleet(userId);
  const [name, setName]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [notice, setNotice]   = useState<string | null>(null);

  if (userLoading || (fleet.phase === 'loading' && !fleet.company)) {
    return <LoadingState label="Filo bilgileri yükleniyor…" />;
  }

  if (!userId) {
    return <StateCard tone="warn" title="Oturum açmanız gerekiyor">
      Filo özelliklerini kullanmak için giriş yapın.
    </StateCard>;
  }

  if (fleet.phase === 'error' && fleet.errorMessage) {
    return <ErrorState message={fleet.errorMessage} />;
  }

  const offline = fleet.phase === 'offline';

  async function handleCreate() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await fleet.createCompany(name.trim());
    setBusy(false);
    if (result.ok) {
      setName('');
      setNotice(result.queued ? result.message : 'Filo oluşturuldu.');
    } else {
      setNotice(result.message);
    }
  }

  return (
    <div className="space-y-5">
      {offline ? <OfflineBanner pendingCount={fleet.pending.length} /> : null}
      <PendingSyncBanner count={fleet.pending.length} onSync={() => void fleet.sync()} />
      <ConflictBanner count={fleet.conflicts.length} href="/dashboard/fleet/conflicts" />

      {/* ── Şirketi olmayan / bireysel kullanıcı ───────────────────────── */}
      {!fleet.company ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Henüz bir filonuz yok</h2>
            <RoleBadge role={fleet.role} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            Şu anda bireysel kullanıcısınız ve en fazla <strong>3 araç</strong> bağlayabilirsiniz.
            Daha fazla araç yönetmek, ekip arkadaşlarınızı eklemek ve araçları paylaşmak
            için bir filo oluşturun.
          </p>

          <div className="mt-5 max-w-md">
            <label htmlFor="company-name" className="block text-sm text-white/70">
              Filo adı
            </label>
            <input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örnek: Yılmaz Nakliyat"
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-sky-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-white/40">En az 2, en fazla 120 karakter.</p>
            <button
              type="button"
              disabled={busy || name.trim().length < 2}
              onClick={() => void handleCreate()}
              className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {busy ? 'Oluşturuluyor…' : 'Filoyu oluştur'}
            </button>
            {notice ? <p className="mt-3 text-sm text-white/70">{notice}</p> : null}
          </div>
        </div>
      ) : (
        /* ── Şirketi olan kullanıcı ──────────────────────────────────── */
        <>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-white">{fleet.company.name}</h2>
              <RoleBadge role={fleet.role} />
            </div>
            <p className="mt-2 text-sm text-white/60">
              {fleet.members.length} üye · {fleet.vehicles.length} araç
            </p>
            {fleet.role === 'observer' ? (
              <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-sm text-amber-100">
                Gözlemci olarak yalnızca görüntüleme yapabilirsiniz. Değişiklik yapamazsınız.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FleetLink href="/dashboard/fleet/members"   title="Üyeler"   value={`${fleet.members.length}`} />
            <FleetLink href="/dashboard/fleet/vehicles"  title="Araçlar"  value={`${fleet.vehicles.length}`} />
            <FleetLink href="/dashboard/fleet/pending"   title="Bekleyen işlemler" value={`${fleet.pending.length}`} />
            <FleetLink href="/dashboard/fleet/conflicts" title="Çakışmalar" value={`${fleet.conflicts.length}`} />
          </div>

          {fleet.can('company.update') ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-base font-semibold text-white">Filo bilgileri</h3>
              <div className="mt-3 flex max-w-md flex-col gap-3 sm:flex-row">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={fleet.company.name}
                  className="flex-1 rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy || name.trim().length < 2}
                  onClick={async () => {
                    setBusy(true);
                    const r = await fleet.updateCompany(name.trim());
                    setBusy(false);
                    setNotice(r.ok ? (r.queued ? r.message : 'Filo adı güncellendi.') : r.message);
                  }}
                  className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  Kaydet
                </button>
              </div>
              {notice ? <p className="mt-3 text-sm text-white/70">{notice}</p> : null}
            </div>
          ) : null}

          <Link
            href="/dashboard/fleet/lab"
            className="block rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50 hover:bg-white/[0.05]"
          >
            CAROS LAB · Filo & Çevrimdışı gözlem paneli (salt-okunur) →
          </Link>
        </>
      )}
    </div>
  );
}

function FleetLink({ href, title, value }: { href: string; title: string; value: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:bg-white/[0.06]"
    >
      <p className="text-sm text-white/60">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </Link>
  );
}
