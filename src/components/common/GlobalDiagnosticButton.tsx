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
import { useState, useEffect } from 'react';
import { Stethoscope } from 'lucide-react';
import { triggerSelfTestSnapshotEx } from '../../platform/remoteLogService';
import { DiagnosticReportModal } from './DiagnosticReportModal';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { canShowDistractingSurface } from '../layout/tripSummaryGate';

export function GlobalDiagnosticButton() {
  const [open, setOpen] = useState(false);
  /* SÜRÜŞ SIRASINDA İSTENDİ ama gösterilmedi → OLAY KAYBOLMAZ, park sonrasına
     ertelenir. (Gerçek sürüş bulgusu: 86 km/h'te tam ekran modal açılmıştı.) */
  const [deferred, setDeferred] = useState(false);
  const speedKmh = useUnifiedVehicleStore((s) => s.speed);
  const canShow  = canShowDistractingSurface(speedKmh);

  /* Araç güvenli şekilde durunca ertelenen istek gösterilir. Sürüş sırasında
     popup/TTS ÜRETİLMEZ — yalnız sessiz bekleme. */
  useEffect(() => {
    if (deferred && canShow) { setDeferred(false); setOpen(true); }
  }, [deferred, canShow]);

  /** Tek giriş noktası: kapı burada uygulanır (mount koşulunda DEĞİL) —
   *  böylece "istendi ama sürüşte" gerçeği kaydedilebilir. */
  const requestOpen = (): void => {
    if (canShow) setOpen(true);
    else setDeferred(true);
  };

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
          onClick={requestOpen}
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

      {/* Kapı MOUNT anında da uygulanır: sürüş başlarsa açık modal kapanır ve
          istek ertelenmiş olarak saklanır (bloklayan yüzey sürüşe taşınamaz). */}
      <DiagnosticReportModal
        open={open && canShow}
        onClose={() => { setOpen(false); setDeferred(false); }}
        title="Tanı Gönder"
        send={(meta) => triggerSelfTestSnapshotEx(meta)}
      />
    </>
  );
}
