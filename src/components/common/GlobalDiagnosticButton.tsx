/**
 * GlobalDiagnosticButton — her ekrandan erişilebilen tek "Tanı Gönder" tetiği.
 *
 * AMAÇ (geliştirme/saha veri toplama fazı): bir sorun UYGULAMANIN NERESİNDE
 * olursa olsun, kullanıcı tek dokunuşla tanı raporu gönderebilsin.
 *
 * PR-4: buton artık DOĞRUDAN göndermez; ortak DiagnosticReportModal'ı açar
 * (açıklama + kategori + önizleme + AÇIK RIZA + rapor numarası). Gönderim
 * triggerSelfTestSnapshotEx (aktif self-test taraması) ile; sanitize +
 * teslimat gerçeği (PR-3) aynen korunur.
 *
 * Tasarım: diskret — köşede yarı saydam küçük daire. Geri vites aktifken
 * App.tsx render'lamaz (kamera temiz kalır).
 *
 * NOT (ticari): saha fazı için bilinçli olarak HER ZAMAN görünür geliştirici/
 * pilot aracı. Satış build'inde gizlemek için tek mount satırı (App.tsx) yeter.
 */
import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { triggerSelfTestSnapshotEx } from '../../platform/remoteLogService';
import { DiagnosticReportModal } from './DiagnosticReportModal';

export function GlobalDiagnosticButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        data-selftest-ignore="1"                     // zamansız-modal avcısı bu butonu saymasın
        style={{
          position: 'fixed',
          left: 8,
          bottom: 8,
          zIndex: 9000,                              // reverse(100000)/portrait(99999) altında
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Tanı Gönder"
          style={{
            width: 34, height: 34,
            borderRadius: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            background: 'rgba(8,14,26,0.62)',
            border: '1px solid rgba(147,197,253,0.35)',
            color: 'rgba(147,197,253,0.75)',
            opacity: 0.5,
            transition: 'opacity 0.25s, border-color 0.25s, color 0.25s',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <Stethoscope size={16} />
        </button>
      </div>

      <DiagnosticReportModal
        open={open}
        onClose={() => setOpen(false)}
        title="Tanı Gönder"
        send={(meta) => triggerSelfTestSnapshotEx(meta)}
      />
    </>
  );
}
