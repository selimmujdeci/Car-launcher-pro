'use client';

/**
 * AYARLAR — konsol tercihleri · organizasyon · bildirim · tema gönderme (#662).
 *
 * ── TİYATRO AYAR YASAĞI ───────────────────────────────────────────────────
 * Bu ekranda hiçbir anahtar "kaydediliyormuş gibi" YAPMAZ. Bir tercih
 * sunucuda saklanmıyorsa bu AÇIKÇA yazılır ve düğme konmaz. (Mevcut
 * `/dashboard/settings` ekranı tam olarak bu hatayı yapıyor: sahte profil
 * alanları ve ölü bir "Kaydet" düğmesi. O ekran bu turda DEĞİŞTİRİLMEDİ,
 * ama konsol o deseni TEKRARLAMAZ.)
 *
 * Gerçek olan yollar: konsol teması (localStorage), organizasyon adı
 * (`update_company` RPC), push kaydı (`register_push_token` RPC), ekip
 * yönetimi (üyeler ekranı), tema gönderimi (araç kumanda ekranı).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import { PushNotificationWidget } from '@/components/dashboard/PushNotificationWidget';
import ConsoleThemeToggle from '@/components/console/ConsoleThemeToggle';
import {
  Panel,
  PanelHead,
  EmptyState,
  ErrorState,
  EvidenceBadge,
} from '@/components/console/primitives';

/** Rol etiketi — `roles.ts` yalnız yetki matrisini tutar, insan dilini DEĞİL. */
function roleLabel(role: unknown): string {
  switch (role) {
    case 'admin':      return 'Filo yöneticisi';
    case 'member':     return 'Üye';
    case 'observer':   return 'Salt okunur izleyici';
    case 'individual': return 'Bireysel kullanıcı';
    default:           return 'Rol bilinmiyor';
  }
}

export default function ConsoleSettingsPage() {
  const { userId, loading: userLoading } = useSessionUser();
  const fleet = useFleet(userId);

  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (fleet.company?.name) setCompanyName(fleet.company.name);
  }, [fleet.company?.name]);

  const canRename = fleet.can('company.update');

  const saveName = useCallback(async () => {
    const next = companyName.trim();
    if (!next || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const result = await fleet.updateCompany(next);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? 'Organizasyon adı kaydedilemedi.');
      return;
    }
    /* Kuyruğa alındıysa "kaydedildi" DENMEZ — sunucu onayı bekleniyor demektir. */
    setNotice(
      result.serverConfirmed
        ? 'Organizasyon adı sunucuda güncellendi.'
        : 'Değişiklik kuyruğa alındı; sunucu onayı bekleniyor.',
    );
  }, [companyName, busy, fleet]);

  if (userLoading) return <Panel><EmptyState title="OTURUM OKUNUYOR" /></Panel>;

  if (!userId) {
    return (
      <Panel>
        <EmptyState title="OTURUM YOK" detail="Ayarları görmek için giriş yapın." />
      </Panel>
    );
  }

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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 lg:gap-4 items-start">
        {/* ── Konsol görünümü ── */}
        <Panel>
          <PanelHead title="Konsol görünümü" meta="tercih bu cihazda saklanır" />
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] text-t1">Gece / Gündüz teması</div>
                <div className="text-[11px] text-t3 mt-1 leading-relaxed">
                  Konsolun kendi temasıdır; sitenin genel temasından ve araçtaki
                  tema seçiminden bağımsızdır.
                </div>
              </div>
              <ConsoleThemeToggle />
            </div>
            <p className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-3">
              Tercih tarayıcı deposunda tutulur. Hesaba bağlı DEĞİLDİR — başka
              cihazda tekrar seçilmesi gerekir.
            </p>
          </div>
        </Panel>

        {/* ── Organizasyon ── */}
        <Panel>
          <PanelHead
            title="Organizasyon"
            meta={fleet.company ? `rol: ${roleLabel(fleet.role)}` : undefined}
            action={<EvidenceBadge verdict={fleet.company ? 'VERIFIED' : 'NO_EVIDENCE'} compact />}
          />
          {!fleet.company ? (
            <EmptyState
              title="FİLO KURULMAMIŞ"
              detail="Bu hesap bireysel kullanımda. Filo kurmak için Yönetim → Şirket ekranını açın."
            />
          ) : (
            <div className="p-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="cn-eyebrow">Organizasyon adı</span>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={!canRename}
                  maxLength={80}
                  className="cn-num text-[13px] px-3 py-2 bg-bezel text-t1 border border-hair disabled:opacity-50"
                  style={{ borderRadius: 2 }}
                />
              </label>

              {canRename ? (
                <button
                  onClick={() => void saveName()}
                  disabled={busy || companyName.trim() === (fleet.company?.name ?? '')}
                  className="cn-num text-[11px] uppercase tracking-[0.16em] px-4 py-2.5 self-start disabled:opacity-40"
                  style={{ borderRadius: 2, background: 'var(--cn-copper)', color: '#0A0A0C' }}
                >
                  {busy ? 'KAYDEDİLİYOR…' : 'KAYDET'}
                </button>
              ) : (
                <p className="cn-num text-[10px] text-t3">
                  Bu rolde organizasyon adı değiştirilemez (salt okunur).
                </p>
              )}

              <dl className="grid grid-cols-2 gap-3 border-t border-hair-soft pt-3">
                <div>
                  <dt className="cn-eyebrow">Üye</dt>
                  <dd className="cn-num text-[15px] text-t1 mt-1">{fleet.members.length}</dd>
                </div>
                <div>
                  <dt className="cn-eyebrow">Şirket aracı</dt>
                  <dd className="cn-num text-[15px] text-t1 mt-1">{fleet.vehicles.length}</dd>
                </div>
              </dl>
            </div>
          )}
        </Panel>

        {/* ── Bildirimler ── */}
        <Panel>
          <PanelHead title="Bildirimler" meta="push kaydı · gerçek" />
          <div className="p-4 flex flex-col gap-4">
            <PushNotificationWidget />
            <p className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-3">
              AÇIK BORÇ: bildirim türü tercihleri (hız aşımı, yakıt, günlük özet)
              henüz sunucuda saklanmıyor. Saklanmadığı için burada anahtar
              GÖSTERİLMİYOR — kaydetmiyormuş gibi görünen bir anahtar koymak
              yanlış olur. Şu an gönderilen bildirimler{' '}
              <Link href="/dashboard/fleet/alerts" style={{ color: 'var(--cn-copper)' }}>
                Uyarılar
              </Link>{' '}
              ekranında görünür.
            </p>
          </div>
        </Panel>

        {/* ── Araç teması ── */}
        <Panel>
          <PanelHead title="Araç teması" meta="telefon → araç canlı gönderim" />
          <div className="p-4 flex flex-col gap-3">
            <p className="text-[12px] text-t2 leading-relaxed">
              Araç ekranının teması (renk, yerleşim, font) telefondan canlı olarak
              gönderilir. Tema Stüdyo, eşleştirilmiş aracın kumanda ekranındadır;
              gönderim eşleşme üzerinden yapılır ve araç tarafında anında uygulanır.
            </p>
            <Link
              href="/kumanda"
              className="cn-num text-[11px] uppercase tracking-[0.16em] px-4 py-2.5 self-start"
              style={{ borderRadius: 2, background: 'var(--cn-copper)', color: '#0A0A0C' }}
            >
              TEMA STÜDYO&apos;YU AÇ
            </Link>
            <p className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-3">
              Kumanda ekranı konsoldan ayrı bir yüzeydir; bu turda değiştirilmedi.
            </p>
          </div>
        </Panel>

        {/* ── Ekip ── */}
        <Panel className="xl:col-span-2">
          <PanelHead title="Kullanıcı ve ekip" meta={`${fleet.members.length} üye`} />
          {fleet.members.length === 0 ? (
            <EmptyState
              title="ÜYE KAYDI YOK"
              detail="Filo kurulduğunda ve üye eklendiğinde burada listelenir."
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
              {fleet.members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    {/* E-posta LİSTELENMEZ: üye listesi RPC'si onu taşımaz ve
                        gizlilik gereği taşımamalıdır. Ad yoksa kısa kimlik. */}
                    <div className="text-[13px] text-t1 truncate">
                      {m.full_name ?? `Kullanıcı #${m.user_id.slice(0, 8)}`}
                    </div>
                    <div className="cn-num text-[10px] text-t3">{roleLabel(m.role)}</div>
                  </div>
                  {m.user_id === userId && (
                    <span className="cn-num text-[9px] uppercase tracking-[0.14em] text-t3">SİZ</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-3 border-t border-hair">
            <Link href="/dashboard/fleet/members" className="cn-num text-[10px]" style={{ color: 'var(--cn-copper)' }}>
              Rol ve yetki yönetimi →
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
