/**
 * PhoneLinkNavProposalOverlay.tsx — PHONE LINK F8.1 · araç içi hedef onay kartı.
 *
 * ── UI KENDİ OTORİTESİNİ ÜRETMEZ (§10/CLAUDE.md §6) ─────────────────────────
 * Bu bileşen `useNavProposalUiStore`u SALT-OKUR — `phoneLinkNavProposal.ts`nin
 * READ-ONLY projeksiyonudur. Onay/red kararının GERÇEK yetkilendirmesi
 * `phoneLinkApplicationIngress.approvePendingNavDestination`/
 * `rejectPendingNavDestination` içindedir (onay anında YENİDEN doğrular,
 * §11); bu bileşen yalnız o fonksiyonları ÇAĞIRIR, kendi kararını ÜRETMEZ.
 *
 * ── `IncomingCallOverlay` İLE AYNI DESEN ─────────────────────────────────────
 * Her zaman mount edilir (`MainLayout`), store boşsa `null` döner. İkinci bir
 * modal/onay altyapısı KURULMADI.
 *
 * ── GÖRÜNÜR GERİ SAYIM = UI'IN KENDİ ÖMRÜNE BAĞLI setInterval ───────────────
 * Bu, "yeni bir arka plan zamanlayıcı/servis" DEĞİLDİR (CLAUDE.md §29 F7
 * yasağı bağlantı/ağ gözlemcisi timer'ları içindir) — repo genelinde UI
 * canlı-görüntü tazelemesi için KULLANILAN AYNI desendir (bkz.
 * `SettingsPage.tsx` `LiveStatsRow`, `CRMInspector.tsx`). Bileşen unmount
 * olunca / öneri kalkınca temizlenir.
 *
 * ── SÜRÜŞ GÜVENLİĞİ (§4) ──────────────────────────────────────────────────
 * Kart yalnız İKİ tek-dokunuş butonu taşır (Git/Reddet) — klavye, liste
 * kaydırma veya serbest metin girişi YOKTUR. Bu yüzden mevcut
 * `NAVIGATION_CONTROL` politikası (`parkedOnly:false`) gibi hareket halinde
 * de gösterilebilir; yeni bir sürüş-durumu kapısı İCAT EDİLMEDİ.
 *
 * ── GÜVENİLMEYEN METİN ────────────────────────────────────────────────────
 * `label` telefondan gelir; React düz metin olarak render eder (JSX ifade
 * içeriği otomatik escape edilir) — `dangerouslySetInnerHTML` YOKTUR.
 */

import { memo, useEffect, useState } from 'react';
import { useNavProposalUiStore } from '../../platform/phoneLink/phoneLinkNavProposal';
import {
  approvePendingNavDestination, rejectPendingNavDestination, expirePendingNavDestination,
} from '../../platform/phoneLink/phoneLinkApplicationIngress';
import { getNavigationState } from '../../platform/navigationService';

const TICK_MS = 1_000;

function coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export const PhoneLinkNavProposalOverlay = memo(function PhoneLinkNavProposalOverlay() {
  const proposal = useNavProposalUiStore((s) => s.proposal);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const proposalId = proposal?.proposalId ?? null;

  /* Görünür geri sayım — yalnız bir öneri EKRANDAYKEN çalışır. */
  useEffect(() => {
    if (proposalId === null) return;
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [proposalId]);

  /* Süre doldu → BU BİLEŞEN öneriyi expire eder (fail-closed: sonsuza dek
     ekranda asılı kalmaz) ve telefona dürüst bir EXPIRED sonucu gönderilir. */
  useEffect(() => {
    if (proposal === null || busy) return;
    if (nowMs >= proposal.expiresAtMs) {
      const id = proposal.proposalId;
      void expirePendingNavDestination(id).catch(() => { /* taşıma hatası — kart yine de kapanır */ });
    }
  }, [proposal, nowMs, busy]);

  if (proposal === null) return null;

  const remainingMs = Math.max(0, proposal.expiresAtMs - nowMs);
  const remainingS = Math.ceil(remainingMs / 1000);
  const label = proposal.label ?? coordLabel(proposal.latitude, proposal.longitude);
  const nav = getNavigationState();
  const willReplaceRoute = nav.isNavigating && nav.destination !== null;

  const handleApprove = () => {
    if (busy) return;
    setBusy(true);
    void approvePendingNavDestination(proposal.proposalId).finally(() => setBusy(false));
  };
  const handleReject = () => {
    if (busy) return;
    setBusy(true);
    void rejectPendingNavDestination(proposal.proposalId).finally(() => setBusy(false));
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 20px 28px',
        background: 'rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 480,
        borderRadius: 24,
        background: 'linear-gradient(160deg, #0d1620 0%, #0a121a 100%)',
        border: '1px solid rgba(96,165,250,0.28)',
        boxShadow: '0 0 48px rgba(59,130,246,0.14), 0 24px 64px rgba(0,0,0,0.55)',
        padding: '22px 22px 18px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'rgba(59,130,246,0.16)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            fontSize: 20,
          }} aria-hidden="true">
            🧭
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#E5EEF7', fontSize: 15, fontWeight: 700 }}>
              Telefondan hedef geldi
            </div>
            <div style={{ color: '#7A8A9A', fontSize: 12 }}>
              {remainingS}s içinde otomatik kapanır
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#9AB4CE', flexShrink: 0 }} aria-hidden="true">📍</span>
          <div style={{
            color: '#D7E4F0', fontSize: 15, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {label}
          </div>
        </div>

        {willReplaceRoute && (
          <div style={{
            color: '#F2C572', fontSize: 12.5, background: 'rgba(242,197,114,0.1)',
            borderRadius: 10, padding: '8px 10px',
          }}>
            Mevcut rotanız var — kabul ederseniz bu hedefle DEĞİŞTİRİLİR.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            disabled={busy}
            onClick={handleReject}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)', color: '#C9D4DE', fontSize: 15, fontWeight: 600,
              opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer',
            }}
          >
            Reddet
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleApprove}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 14, border: 'none',
              background: '#3B82F6', color: '#fff', fontSize: 15, fontWeight: 700,
              opacity: busy ? 0.75 : 1, cursor: busy ? 'default' : 'pointer',
            }}
          >
            Git
          </button>
        </div>
      </div>
    </div>
  );
});
