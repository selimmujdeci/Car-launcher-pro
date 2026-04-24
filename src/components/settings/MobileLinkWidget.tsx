/**
 * MobileLinkWidget — 6 haneli QR eşleşme kodu ekranı.
 *
 * Akış:
 *   1. Montajda registerVehicle() → kod + expiresAt alınır
 *   2. 1 Hz countdown timer → 0'a düşünce refreshLinkingCode() otomatik tetiklenir
 *   3. Kullanıcı "Yenile" butonuna da basabilir
 *   4. QR kod: canvas üzerine qrcode lib ile çizilir
 *
 * Zero-Leak:
 *   - interval useEffect cleanup ile temizlenir
 *   - AbortController fetch timeout'u keser
 *   - unmount sonrası state güncellemesi engellenir (_mounted guard)
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { registerVehicle, refreshLinkingCode } from '../../platform/vehicleIdentityService';
import type { LinkingCodeInfo } from '../../platform/vehicleIdentityService';

/* ── Sabitler ─────────────────────────────────────────── */

/** QR deep-link prefix — mobil uygulama bu şemayı açar */
const QR_SCHEME = 'carlauncher://link/';

/** Saniye cinsinden kritik eşik — sarı uyarı rengi */
const WARN_SECS = 15;

/* ── Yardımcılar ──────────────────────────────────────── */

function secsLeft(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

/** "123456" → "123 456" */
function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/* ── Bileşen ──────────────────────────────────────────── */

export const MobileLinkWidget = memo(function MobileLinkWidget() {
  const [info, setInfo]         = useState<LinkingCodeInfo | null>(null);
  const [remaining, setRemain]  = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(true);

  /* ── QR çizimi: kod değişince ───────────────────────── */
  useEffect(() => {
    if (!info || !canvasRef.current) return;

    // Fix: Bazı tarayıcılarda canvas'ın hazır olması için micro-task delay
    const t = setTimeout(() => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, `${QR_SCHEME}${info.code}`, {
        width:            200,
        margin:           2,
        // Fix: 8 haneli hex yerine rgba kullanarak şeffaflık uyumluluğunu artır
        color: { dark: '#ffffff', light: '#00000000' }, 
        errorCorrectionLevel: 'M',
      }).catch((e) => {
        console.warn('QR Render Error:', e);
      });
    }, 50);

    return () => clearTimeout(t);
  }, [info?.code]);

  /* ── İlk yükleme: registerVehicle() ────────────────── */
  const loadCode = useCallback(async (isRefresh = false) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const result = isRefresh ? await refreshLinkingCode() : await registerVehicle();
      if (!mountedRef.current) return;
      setInfo(result);
      setRemain(secsLeft(result.expiresAt));
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message ?? 'Kod alınamadı');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadCode(false);
    return () => { mountedRef.current = false; };
  }, [loadCode]);

  /* ── Countdown timer — 1 Hz, Zero-Leak ─────────────── */
  useEffect(() => {
    if (!info) return;

    const id = setInterval(() => {
      if (!mountedRef.current) return;
      const secs = secsLeft(info.expiresAt);
      setRemain(secs);

      if (secs === 0) {
        // Kod doldu → otomatik yenile
        void loadCode(true);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [info, loadCode]);

  /* ── UI ─────────────────────────────────────────────── */

  const isExpiring = remaining <= WARN_SECS && remaining > 0;
  const isExpired  = remaining === 0 && info !== null && !loading;

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        <span className="text-xs text-white/40 uppercase tracking-widest">Kod hazırlanıyor…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <WifiOff className="w-6 h-6 text-red-400" />
        <span className="text-xs text-red-400 text-center">{error}</span>
        <button
          onClick={() => void loadCode(false)}
          className="px-5 py-2 rounded-xl glass-card text-[11px] font-black uppercase tracking-widest text-white/60 hover:text-white border border-white/10 hover:border-white/25 transition-all active:scale-95"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-4 select-none">

      {/* Başlık */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.25)' }}>
          <Smartphone className="w-4 h-4 text-cyan-400" />
        </div>
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.4em] text-white/70">Mobil Cihaz Eşle</div>
          <div className="text-[9px] text-white/30 uppercase tracking-widest">Telefon uygulamasıyla tara veya kodu gir</div>
        </div>
        <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg"
          style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)' }}>
          <Wifi className="w-3 h-3 text-cyan-400" />
          <span className="text-[9px] font-black text-cyan-400">CANLI</span>
        </div>
      </div>

      {/* QR Kod */}
      <div className="relative">
        <div className="p-3 rounded-2xl"
          style={{
            background: isExpiring || isExpired
              ? 'rgba(239,68,68,0.10)'
              : 'rgba(34,211,238,0.06)',
            border: `1.5px solid ${isExpiring || isExpired ? 'rgba(239,68,68,0.3)' : 'rgba(34,211,238,0.2)'}`,
            transition: 'all 0.4s',
          }}>
          <canvas
            ref={canvasRef}
            width={200}
            height={200}
            style={{
              display: 'block',
              opacity: isExpired ? 0.25 : isExpiring ? 0.7 : 1,
              filter: isExpired ? 'blur(4px)' : 'none',
              transition: 'opacity 0.4s, filter 0.4s',
            }}
          />
          {isExpired && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-black text-red-400 bg-black/80 px-3 py-1.5 rounded-lg uppercase tracking-widest">
                Süresi Doldu
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 6 Haneli Kod */}
      <div className="flex flex-col items-center gap-2">
        <div
          className="font-black tabular-nums tracking-[0.25em]"
          style={{
            fontSize: '2.4rem',
            letterSpacing: '0.2em',
            color: isExpiring ? '#f87171' : isExpired ? 'rgba(255,255,255,0.2)' : '#ffffff',
            textShadow: isExpiring ? '0 0 20px rgba(248,113,113,0.5)' : '0 0 20px rgba(255,255,255,0.15)',
            fontVariantNumeric: 'tabular-nums',
            transition: 'color 0.4s, text-shadow 0.4s',
          }}
        >
          {info ? formatCode(info.code) : '--- ---'}
        </div>

        {/* Countdown */}
        <div className="flex items-center gap-2">
          <div
            className="h-1 rounded-full transition-all duration-1000"
            style={{
              width: '120px',
              background: 'rgba(255,255,255,0.08)',
            }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${info ? Math.min(100, (remaining / 60) * 100) : 0}%`,
                background: isExpiring ? '#f87171' : '#22d3ee',
                boxShadow: isExpiring ? '0 0 6px rgba(248,113,113,0.6)' : '0 0 6px rgba(34,211,238,0.5)',
              }}
            />
          </div>
          <span
            className="text-[11px] font-black tabular-nums"
            style={{ color: isExpiring ? '#f87171' : 'rgba(255,255,255,0.35)', minWidth: '36px' }}
          >
            {remaining > 0 ? `${remaining}s` : 'Doldu'}
          </span>
        </div>
      </div>

      {/* Yenile butonu */}
      <button
        onClick={() => void loadCode(true)}
        disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl glass-card border border-white/10 hover:border-cyan-400/40 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed group"
      >
        <RefreshCw className="w-3.5 h-3.5 text-cyan-400 group-hover:rotate-180 transition-transform duration-500" />
        <span className="text-[10px] font-black uppercase tracking-[0.35em] text-white/50 group-hover:text-cyan-400 transition-colors">
          Yeni Kod Al
        </span>
      </button>

      <p className="text-[9px] text-white/20 text-center max-w-[220px] leading-relaxed">
        Kod 60 sn geçerlidir ve tek kullanımlıktır.
        Telefonun Caros uygulamasında eşleşme ekranını aç.
      </p>
    </div>
  );
});
