'use client';

/**
 * FleetUi.tsx — filo ekranlarının paylaşılan yapı taşları.
 *
 * Hedef: telefon kullanmayı bilmeyen kullanıcı da anlasın. Teknik terim ve
 * hata yığını GÖSTERİLMEZ; her durum düz Türkçe bir cümleyle açıklanır.
 */

import React from 'react';

/* ── Onay kutusu — silme / rol düşürme / araç ayırma için ZORUNLU ─────── */

export function ConfirmDialog({
  open, title, description, confirmLabel, danger, onConfirm, onCancel,
}: {
  open:          boolean;
  title:         string;
  description:   string;
  confirmLabel:  string;
  danger?:       boolean;
  onConfirm:     () => void;
  onCancel:      () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1526] p-6">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{description}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80 hover:bg-white/5"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Durum kartları ───────────────────────────────────────────────────── */

export function StateCard({
  tone = 'neutral', title, children,
}: {
  tone?: 'neutral' | 'warn' | 'error' | 'info';
  title: string;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === 'error' ? 'border-red-500/25 bg-red-500/[0.07] text-red-200'
    : tone === 'warn' ? 'border-amber-500/25 bg-amber-500/[0.07] text-amber-100'
    : tone === 'info' ? 'border-sky-500/25 bg-sky-500/[0.07] text-sky-100'
    : 'border-white/10 bg-white/[0.03] text-white/70';
  return (
    <div className={`rounded-2xl border p-6 ${toneClass}`}>
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <div className="mt-2 text-sm leading-relaxed opacity-90">{children}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Yükleniyor…' }: { label?: string }) {
  return <StateCard title={label}>Bilgiler getiriliyor, lütfen bekleyin.</StateCard>;
}

export function ErrorState({ message }: { message: string }) {
  return <StateCard tone="error" title="Bir sorun oluştu">{message}</StateCard>;
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return <StateCard title={title}>{hint}</StateCard>;
}

export function PermissionDeniedState() {
  return (
    <StateCard tone="warn" title="Bu sayfayı görme yetkiniz yok">
      Filo yöneticiniz size bu bölüm için yetki vermemiş. Yetki gerekiyorsa filo
      yöneticinizle görüşün.
    </StateCard>
  );
}

export function OfflineBanner({ pendingCount }: { pendingCount: number }) {
  return (
    <StateCard tone="warn" title="İnternet bağlantısı yok">
      Şu anda çevrimdışısınız. Yaptığınız işlemler cihazınıza kaydediliyor ve
      bağlantı geri geldiğinde gönderilecek.
      {pendingCount > 0 ? ` Şu an ${pendingCount} işlem sırada bekliyor.` : ''}
      <br />
      <strong className="text-amber-200">
        Bu işlemler henüz tamamlanmadı — sunucu onaylayana kadar kesinleşmez.
      </strong>
    </StateCard>
  );
}

export function PendingSyncBanner({ count, onSync }: { count: number; onSync: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-sky-100">
        <strong>{count} işlem</strong> gönderilmeyi bekliyor. Henüz tamamlanmadılar.
      </p>
      <button
        type="button"
        onClick={onSync}
        className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        Şimdi gönder
      </button>
    </div>
  );
}

export function ConflictBanner({ count, href }: { count: number; href: string }) {
  if (count <= 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-red-100">
        <strong>{count} işlem</strong> sunucudaki durumla çakıştı ve uygulanamadı.
      </p>
      <a
        href={href}
        className="rounded-xl bg-red-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-red-500"
      >
        Çakışmaları çöz
      </a>
    </div>
  );
}

/* ── Rol rozeti ───────────────────────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = {
  individual: 'Bireysel kullanıcı',
  observer:   'Gözlemci (yalnız görüntüleme)',
  member:     'Filo üyesi',
  admin:      'Filo yöneticisi',
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70">
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

/* ── Araç erişim rolleri ──────────────────────────────────────────────── */

/**
 * Araçla ilgili yetkilerin DÜZ TÜRKÇE karşılığı.
 *
 * Yalnız `vehicle.*` yetkileri listelenir — bu kart "bu rol araçla ne yapabilir"
 * sorusunu yanıtlar; şirket/üyelik yetkileri buraya girmez.
 */
const VEHICLE_CAPABILITY_LABEL: Readonly<Record<string, string>> = {
  'vehicle.read':             'Araçları görebilir',
  'vehicle.location.read':    'Araçların konumunu görebilir',
  'vehicle.diagnostics.read': 'Arıza ve tanı bilgilerini görebilir',
  'vehicle.command':          'Araca komut gönderebilir (kilit, korna, rota…)',
  'vehicle.settings.update':  'Araç ayarlarını değiştirebilir',
  'vehicle.assign':           'Filoya araç ekleyebilir',
  'vehicle.remove':           'Filodan araç çıkarabilir',
};

/** Kart hangi sırayla okunsun (yetkiden yetkisize doğru DEĞİL, okunabilir sıra). */
const VEHICLE_CAPABILITY_ORDER: readonly string[] = [
  'vehicle.read',
  'vehicle.location.read',
  'vehicle.diagnostics.read',
  'vehicle.command',
  'vehicle.settings.update',
  'vehicle.assign',
  'vehicle.remove',
];

/**
 * ARAÇ ERİŞİM ROLLERİ — hangi rolün araçla ne yapabildiğini gösterir.
 *
 * ⚠️ Liste `roles.ts` matrisinden TÜRETİLİR, elle yazılmaz. Böylece matris
 * değişince bu kart sessizce yalan söylemeye başlayamaz.
 */
export function VehicleAccessRolesCard({
  roles, capabilitiesOf,
}: {
  roles: readonly string[];
  capabilitiesOf: (role: string) => readonly string[];
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h3 className="text-base font-semibold text-white">Araç erişim rolleri</h3>
      <p className="mt-1 text-sm text-white/60">
        Bir üyeye rol verirken bu listeye bakın: rol, kişinin araçlarla ne
        yapabileceğini belirler.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => {
          const granted = new Set(capabilitiesOf(role));
          return (
            <div key={role} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="font-medium text-white">{roleLabel(role)}</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {VEHICLE_CAPABILITY_ORDER.map((capability) => {
                  const has = granted.has(capability);
                  return (
                    <li
                      key={capability}
                      className={has ? 'text-white/80' : 'text-white/35 line-through'}
                    >
                      <span aria-hidden="true" className="mr-1.5">{has ? '✓' : '✕'}</span>
                      {VEHICLE_CAPABILITY_LABEL[capability]}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
