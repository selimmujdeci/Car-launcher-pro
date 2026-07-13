/**
 * SupportSnapshotCard — Ayarlar "Hakkında" panelinde "Tanı raporu gönder" kartı.
 *
 * PR-4: kart artık DOĞRUDAN göndermez; ortak DiagnosticReportModal'ı açar —
 * kullanıcı açıklama yazar, kategori seçer, önizler, AÇIK RIZA verir, rapor
 * numarasını alır. Gönderim triggerSupportSnapshotEx (support_snapshot) ile;
 * teslimat gerçeği (PR-3) ve sanitize (remoteLogService) aynen korunur.
 */
import { useState } from 'react';
import { triggerSupportSnapshotEx } from '../../platform/remoteLogService';
import { DiagnosticReportModal } from '../common/DiagnosticReportModal';

export function SupportSnapshotCard() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
          Tanı Raporu
        </div>
        <div className="text-[11px] font-bold mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
          Problemi yazın, gönderilecek veriyi görün, onaylayın — rapor numarası alın
        </div>
        <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Konum, kimlik ve cihaz bilgisi içermez
        </div>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-xl text-[11px] font-black flex-shrink-0"
        style={{
          background: 'rgba(52,211,153,0.12)',
          border: '1px solid rgba(52,211,153,0.25)',
          color: '#6ee7b7',
        }}>
        Tanı Gönder
      </button>

      <DiagnosticReportModal
        open={open}
        onClose={() => setOpen(false)}
        title="Tanı Raporu Gönder"
        send={(meta) => triggerSupportSnapshotEx(meta)}
      />
    </div>
  );
}
