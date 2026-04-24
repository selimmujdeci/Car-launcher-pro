/**
 * HotspotPromptModal — Araç açılışında telefon hotspot bağlantısı sorar.
 *
 * hotspotMode === 'ask' iken ve cihaz internete bağlı değilken gösterilir.
 * Kullanıcı "Her zaman aç" seçerse mod 'auto'ya güncellenir.
 */

import { memo } from 'react';
import { Wifi, X } from 'lucide-react';
import { openHotspotSettings } from '../../platform/tetherService';

interface Props {
  onDismiss: () => void;
  onAutoEnable: () => void; // kullanıcı "Her zaman otomatik aç" seçti
}

export const HotspotPromptModal = memo(function HotspotPromptModal({
  onDismiss,
  onAutoEnable,
}: Props) {
  function handleOpen() {
    openHotspotSettings();
    onDismiss();
  }

  function handleAlwaysAuto() {
    openHotspotSettings();
    onAutoEnable();
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center pb-8 px-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, #0d1b2e 0%, #060d1a 100%)',
          border: '1px solid rgba(59,130,246,0.2)',
          boxShadow: '0 -4px 40px rgba(59,130,246,0.12), 0 32px 64px rgba(0,0,0,0.7)',
          animation: 'slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
            >
              <Wifi size={18} className="text-blue-400" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Bluetooth İnternet</p>
              <p className="text-white/40 text-[11px] mt-0.5">Cihaz internete bağlı değil</p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <X size={13} className="text-white/50" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-2">
          <p className="text-white/60 text-sm leading-relaxed">
            Telefonunuzdan Bluetooth üzerinden internet paylaşmak ister misiniz?
          </p>

          {/* Info pill */}
          <div
            className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl"
            style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#fbbf24" strokeWidth="1.3"/>
              <path d="M7 5v3M7 9.5v.5" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span className="text-[10px] text-yellow-300/70 font-medium leading-tight">
              Bluetooth Ayarları açılır → telefonunuza tıklayın → "İnternet erişimi" açın
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-4 pt-3">
          {/* Primary — open settings */}
          <button
            onClick={handleOpen}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm tracking-wide transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow: '0 6px 20px rgba(59,130,246,0.3)',
            }}
          >
            Evet, Bluetooth Ayarlarını Aç
          </button>

          {/* Secondary — always auto */}
          <button
            onClick={handleAlwaysAuto}
            className="w-full py-3 rounded-2xl font-semibold text-xs tracking-wide transition-all active:scale-95"
            style={{
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.2)',
              color: 'rgba(147,197,253,0.8)',
            }}
          >
            Her seferinde otomatik aç
          </button>

          {/* Dismiss */}
          <button
            onClick={onDismiss}
            className="w-full py-2.5 rounded-xl font-semibold text-xs transition-all active:scale-95"
            style={{ color: 'rgba(255,255,255,0.25)' }}
          >
            Hayır, gerek yok
          </button>
        </div>
      </div>
    </div>
  );
});
