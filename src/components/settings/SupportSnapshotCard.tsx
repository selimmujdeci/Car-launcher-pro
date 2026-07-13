/**
 * SupportSnapshotCard — Remote Log v1 / Commit 4: "Tanı raporu gönder"
 *
 * SettingsPage "Hakkında" paneli içinde yaşar (OtaUpdateCard deseni).
 * Tek aksiyon: triggerSupportSnapshotEx() — cooldown/offline/hata sonucu
 * kart içinde net gösterilir. Snapshot içeriği remoteLogService'te
 * sanitize edilir; konum/VIN/plaka/MAC/cihaz adı asla gönderilmez.
 *
 * ── Teslimat gerçeği (Delivery Truth) ──────────────────────────────────────
 * Kart artık "kuyruğa kabul" ile "sunucuya teslim"i AYIRIR: kabul → "Kuyrukta",
 * sunucu UUID kanıtı gelince → "Gönderildi". Yalancı "Gönderildi" YOK. reportId
 * kullanıcıya kısaltılmış gösterilir (destek ekibiyle eşleştirme için).
 */
import { useState } from 'react';
import { triggerSupportSnapshotEx, awaitDelivery } from '../../platform/remoteLogService';
import { deliveryLabel, type DeliveryState } from '../../platform/diagnosticDelivery';

/** Kabul-anı (senkron) durumlarının kullanıcı metni. */
const ACCEPT_MSG: Record<string, string> = {
  queued:         'Kuyrukta — gönderiliyor…',
  queued_offline: 'Çevrimdışı — internet gelince gönderilecek',
  cooldown:       'Az önce alındı — lütfen biraz bekleyin',
  error:          'Alınamadı — tekrar deneyin',
  not_paired:     "Cihaz eşlenmemiş — loglar gönderilemez. Ayarlar → Mobil Bağlantı'dan eşleştirin",
};

/** Durum → renk. delivered yeşil, retry/rate sarı, rejected/failed kırmızı. */
function colorFor(key: string): string {
  if (key === 'delivered') return '#34d399';
  if (key === 'queued' || key === 'sending') return '#60a5fa';
  if (key === 'queued_offline' || key === 'cooldown' || key === 'retry_scheduled' ||
      key === 'rate_limited' || key === 'truncated') return '#fbbf24';
  if (key === 'error' || key === 'rejected' || key === 'failed' || key === 'not_paired') return '#f87171';
  return 'var(--text-muted)';
}

type Phase = 'idle' | 'sending' | 'accepted' | 'settled';

export function SupportSnapshotCard() {
  const [phase, setPhase]       = useState<Phase>('idle');
  const [statusKey, setStatusKey] = useState<string>('queued');
  const [detailMsg, setDetailMsg] = useState<string>('');
  const [reportId, setReportId]   = useState<string | null>(null);

  const handleSend = async () => {
    if (phase === 'sending') return;
    setPhase('sending');
    setReportId(null);

    const { status, reportId: rid } = await triggerSupportSnapshotEx();
    setStatusKey(status);
    setReportId(rid);
    setDetailMsg(ACCEPT_MSG[status] ?? status);

    // Kabul edilmedi (cooldown/error/not_paired) → burada dur (teslim beklenmez).
    if (status !== 'queued' && status !== 'queued_offline') {
      setPhase('settled');
      return;
    }

    // Kabul edildi → GERÇEK teslimi bekle (sunucu UUID'si). Yalancı "Gönderildi" yok.
    setPhase('accepted');
    if (!rid) { setPhase('settled'); return; }
    const finalState: DeliveryState = await awaitDelivery(rid);
    setStatusKey(finalState);
    setDetailMsg(deliveryLabel(finalState));
    setPhase('settled');
  };

  const detail =
    phase === 'idle'    ? 'Sürüm, sistem sağlığı ve hata özetini destek ekibine iletir' :
    phase === 'sending' ? 'Hazırlanıyor…' :
    detailMsg;

  const detailColor =
    phase === 'idle' || phase === 'sending' ? 'var(--text-muted)' : colorFor(statusKey);

  return (
    <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
          Tanı Raporu
        </div>
        <div className="text-[11px] font-bold mt-0.5 truncate" style={{ color: detailColor }}>
          {detail}
        </div>
        {reportId && (phase === 'accepted' || phase === 'settled') && (
          <div className="text-[10px] font-bold mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            Rapor No: {reportId}
          </div>
        )}
        <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Konum, kimlik ve cihaz bilgisi içermez
        </div>
      </div>
      <button
        onClick={() => { void handleSend(); }}
        disabled={phase === 'sending' || phase === 'accepted'}
        className="px-3 py-1.5 rounded-xl text-[11px] font-black flex-shrink-0 disabled:opacity-40"
        style={{
          background: 'rgba(52,211,153,0.12)',
          border: '1px solid rgba(52,211,153,0.25)',
          color: '#6ee7b7',
        }}>
        Tanı Gönder
      </button>
    </div>
  );
}
