/**
 * SupportSnapshotCard — Remote Log v1 / Commit 4: "Tanı raporu gönder"
 *
 * SettingsPage "Hakkında" paneli içinde yaşar (OtaUpdateCard deseni).
 * Tek aksiyon: triggerSupportSnapshot() — cooldown/offline/hata sonucu
 * kart içinde net gösterilir. Snapshot içeriği remoteLogService'te
 * sanitize edilir; konum/VIN/plaka/MAC/cihaz adı asla gönderilmez.
 */
import { useState } from 'react';
import {
  triggerSupportSnapshot,
  type SnapshotTriggerResult,
} from '../../platform/remoteLogService';

const RESULT_MSG: Record<SnapshotTriggerResult, string> = {
  sent:           'Tanı raporu gönderildi',
  queued_offline: 'Çevrimdışı — internet gelince gönderilecek',
  cooldown:       'Az önce gönderildi — lütfen biraz bekleyin',
  error:          'Gönderilemedi — tekrar deneyin',
};

const RESULT_COLOR: Record<SnapshotTriggerResult, string> = {
  sent:           '#34d399',
  queued_offline: '#fbbf24',
  cooldown:       '#fbbf24',
  error:          '#f87171',
};

type CardStatus = 'idle' | 'sending' | SnapshotTriggerResult;

export function SupportSnapshotCard() {
  const [status, setStatus] = useState<CardStatus>('idle');

  const handleSend = async () => {
    if (status === 'sending') return;
    setStatus('sending');
    const result = await triggerSupportSnapshot();
    setStatus(result);
  };

  const detail =
    status === 'idle'    ? 'Sürüm, sistem sağlığı ve hata özetini destek ekibine iletir' :
    status === 'sending' ? 'Gönderiliyor…' :
    RESULT_MSG[status];

  const detailColor =
    status === 'idle' || status === 'sending'
      ? 'var(--text-muted)'
      : RESULT_COLOR[status];

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
        <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Konum, kimlik ve cihaz bilgisi içermez
        </div>
      </div>
      <button
        onClick={() => { void handleSend(); }}
        disabled={status === 'sending'}
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
