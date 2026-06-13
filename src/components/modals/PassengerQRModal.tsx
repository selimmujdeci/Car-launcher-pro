/**
 * PassengerQRModal — yolcu müzik kontrolü QR paneli.
 *
 * Açılınca HTTP sunucuyu başlatır, QR kodu üretir.
 * Yolcu QR'ı okur → tarayıcıda müzik kontrol paneli açılır.
 */
import { memo, useState, useEffect, useCallback } from 'react';
import { X, Wifi, Music2, Loader2, WifiOff } from 'lucide-react';
import QRCode from 'qrcode';
import { startPassenger, stopPassenger, usePassengerSession } from '../../platform/passengerService';
import { useMediaState } from '../../platform/mediaService';

/* ── QR generator ─────────────────────────────────────────── */

function useQRDataUrl(url: string | null): string {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    if (!url) { setDataUrl(''); return; }
    QRCode.toDataURL(url, {
      width:  280,
      margin: 3,
      color:  { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setDataUrl).catch(() => setDataUrl(''));
  }, [url]);
  return dataUrl;
}

/* ── Modal ────────────────────────────────────────────────── */

export const PassengerQRModal = memo(function PassengerQRModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const session = usePassengerSession();
  const media   = useMediaState();
  const qrUrl   = useQRDataUrl(session?.url ?? null);

  // Sunucuyu başlat
  useEffect(() => {
    setLoading(true);
    setError(null);
    startPassenger()
      .then(() => setLoading(false))
      .catch((e: Error) => {
        setLoading(false);
        setError(e.message ?? 'Sunucu başlatılamadı');
      });
    return () => { stopPassenger(); };
  }, []);

  const handleClose = useCallback(() => {
    stopPassenger();
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-sm bg-[var(--oem-surface-0)] border border-[var(--oem-line)] rounded-3xl shadow-2xl overflow-hidden flex flex-col">

        {/* Başlık */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--oem-line)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--oem-info-soft)] flex items-center justify-center">
              <Music2 className="w-5 h-5 text-[color:var(--oem-info)]" />
            </div>
            <div>
              <div className="text-[color:var(--oem-ink)] font-bold text-sm">Yolcu Kontrolü</div>
              <div className="text-[color:var(--oem-ink-3)] text-[10px]">QR kodu okut · Müziği kontrol et</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-[var(--oem-surface-2)] flex items-center justify-center text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] transition-colors active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* İçerik */}
        <div className="flex flex-col items-center p-6 gap-5">

          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 text-[color:var(--oem-info)] animate-spin" />
              <span className="text-[color:var(--oem-ink-3)] text-sm">Sunucu başlatılıyor…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 py-6">
              <WifiOff className="w-8 h-8 text-[color:var(--oem-danger)]" />
              <div className="text-[color:var(--oem-danger)] text-sm text-center font-medium">{error}</div>
              <div className="text-[color:var(--oem-ink-3)] text-xs text-center">WiFi bağlantısını kontrol et</div>
            </div>
          )}

          {!loading && !error && session && (
            <>
              {/* QR kodu — beyaz zemin zorunlu, kamera bu şekilde okur */}
              <div className="bg-white rounded-2xl p-4 shadow-lg">
                {qrUrl
                  ? <img src={qrUrl} alt="QR Kod" width={240} height={240} className="block" />
                  : <div className="w-[240px] h-[240px] bg-slate-100 rounded-xl animate-pulse" />
                }
              </div>

              {/* Talimat */}
              <div className="flex items-center gap-2 bg-[var(--oem-info-soft)] border border-[var(--oem-info)] rounded-xl px-4 py-3 w-full">
                <Wifi className="w-4 h-4 text-[color:var(--oem-info)] flex-shrink-0" />
                <span className="text-[color:var(--oem-info)] text-xs leading-tight">
                  Aynı WiFi ağında arka koltuktan tarat
                </span>
              </div>

              {/* Aktif parça önizlemesi */}
              {media.track.title && (
                <div className="w-full bg-[var(--oem-surface-2)] rounded-xl px-4 py-3 flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      media.playing ? 'bg-[var(--oem-good)] animate-pulse' : 'bg-[var(--oem-surface-3)]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[color:var(--oem-ink)] text-xs font-bold truncate">{media.track.title}</div>
                    <div className="text-[color:var(--oem-ink-3)] text-[10px] truncate">{media.track.artist}</div>
                  </div>
                  <div className="text-[color:var(--oem-ink-3)] text-[10px] flex-shrink-0">
                    {media.playing ? 'Çalıyor' : 'Durdu'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Alt bilgi */}
        {!loading && !error && (
          <div className="px-5 pb-5">
            <button
              onClick={handleClose}
              className="w-full py-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[color:var(--oem-ink-2)] text-sm font-bold hover:bg-[var(--oem-surface-3)] transition-all active:scale-95"
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
});


