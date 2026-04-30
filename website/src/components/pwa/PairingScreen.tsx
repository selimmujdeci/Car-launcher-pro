'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { pairVehicle } from '@/lib/pairingService';

const PIN_LEN = 6;
type Mode = 'pin' | 'qr';

/* ── BarcodeDetector type shim ──────────────────────────────── */
declare class BarcodeDetector {
  constructor(opts: { formats: string[] });
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
  static getSupportedFormats(): Promise<string[]>;
}

/* ── QR payload parser ──────────────────────────────────────── */
function parseQRValue(raw: string): string | null {
  // carlauncher://link/482931
  const m1 = raw.match(/carlauncher:\/\/link\/([A-Z0-9]{4,8})/i);
  if (m1) return m1[1].toUpperCase();
  // URL param: ?pair=482931
  const m2 = raw.match(/[?&]pair=([A-Z0-9]{4,8})/i);
  if (m2) return m2[1].toUpperCase();
  // Pure 4-8 char alphanumeric code
  if (/^[A-Z0-9]{4,8}$/i.test(raw.trim())) return raw.trim().toUpperCase();
  return null;
}

/* ── Confetti ───────────────────────────────────────────────── */
const CONFETTI_COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#a78bfa', '#f472b6', '#fb923c'];

function Confetti() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * 360;
        const r = 70 + (i % 4) * 25;
        const tx = Math.round(Math.cos((angle * Math.PI) / 180) * r);
        const ty = Math.round(Math.sin((angle * Math.PI) / 180) * r);
        const size = 4 + (i % 3) * 3;
        return (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                top: '40%',
                left: '50%',
                width: size,
                height: size,
                borderRadius: i % 2 === 0 ? '50%' : '2px',
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animation: `confettiPop 0.75s cubic-bezier(0.16,1,0.3,1) ${i * 12}ms forwards`,
                '--tx': `${tx}px`,
                '--ty': `${ty}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/* ── QR Viewfinder overlay ──────────────────────────────────── */
function QRFrame({ found }: { found: boolean }) {
  const c = found ? '#34d399' : '#3b82f6';
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 220 220"
      fill="none"
    >
      {/* corner brackets */}
      {[
        ['M20,48 L20,20 L48,20', 'M172,20 L200,20 L200,48'],
        ['M20,172 L20,200 L48,200', 'M172,200 L200,200 L200,172'],
      ].flat().map((d, i) => (
        <path key={i} d={d} stroke={c} strokeWidth="4" strokeLinecap="round"
          style={{ transition: 'stroke 0.3s' }} />
      ))}
      {/* scan line */}
      {!found && (
        <line
          x1="28" y1="110" x2="192" y2="110"
          stroke={c} strokeWidth="1.5" opacity="0.6"
          style={{ animation: 'scanLine 1.8s ease-in-out infinite' }}
        />
      )}
      {found && (
        <path d="M80 110 l24 24 36-36" stroke="#34d399" strokeWidth="4"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ animation: 'drawCheck 0.4s ease-out both' }}
        />
      )}
    </svg>
  );
}

interface Props { onPaired: () => void }

export default function PairingScreen({ onPaired }: Props) {
  const [mode, setMode]           = useState<Mode>('pin');
  const [digits, setDigits]       = useState<string[]>(Array(PIN_LEN).fill(''));
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [qrFound, setQrFound]     = useState(false);
  const [cameraErr, setCameraErr] = useState('');

  const inputRefs  = useRef<Array<HTMLInputElement | null>>(Array(PIN_LEN).fill(null));
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const rafRef     = useRef<number>(0);
  const mountedRef = useRef(true);

  const code = digits.join('');

  /* ── Camera cleanup ─────────────────────────────────────── */
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mountedRef.current) setScanning(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (mode !== 'qr') stopCamera();
  }, [mode, stopCamera]);

  /* ── Shared pair logic ──────────────────────────────────── */
  const doPair = useCallback(
    async (pairCode: string) => {
      if (!mountedRef.current) return;
      setLoading(true);
      setError('');
      const res = await pairVehicle(pairCode);
      if (!mountedRef.current) return;
      setLoading(false);
      if (res.success) {
        setSuccess(true);
        try { navigator.vibrate?.([50, 30, 50]); } catch { /* non-critical */ }
        setTimeout(() => onPaired(), 2200);
      } else {
        setError(res.message);
        try { navigator.vibrate?.([100, 50, 100]); } catch { /* non-critical */ }
        if (mode === 'qr') setMode('pin');
      }
    },
    [onPaired, mode],
  );

  /* ── QR Scanner ─────────────────────────────────────────── */
  const startQR = useCallback(async () => {
    setCameraErr('');
    setQrFound(false);

    if (!('BarcodeDetector' in window)) {
      setCameraErr('Tarayıcınız QR okumayı desteklemiyor. Kodu manuel girin.');
      setMode('pin');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;

      // scanning=true ile video elementi DOM'a girer, sonra srcObject atanır
      setScanning(true);
    } catch {
      setCameraErr('Kamera izni verilmedi veya kullanılamıyor.');
      setMode('pin');
    }
  }, [stopCamera]);

  // stream hazır + video elementi DOM'da → srcObject ata ve QR döngüsü başlat
  useEffect(() => {
    if (!scanning || !streamRef.current || !videoRef.current) return;

    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {});

    if (!('BarcodeDetector' in window)) return;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const loop = async () => {
      if (!videoRef.current || !streamRef.current || !mountedRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          const parsed = parseQRValue(codes[0].rawValue);
          if (parsed) {
            setQrFound(true);
            stopCamera();
            await doPair(parsed);
            return;
          }
        }
      } catch { /* frame not ready */ }
      rafRef.current = requestAnimationFrame(() => void loop());
    };
    rafRef.current = requestAnimationFrame(() => void loop());

    return () => { cancelAnimationFrame(rafRef.current); };
  }, [scanning, doPair, stopCamera]);

  /* ── PIN input handlers ─────────────────────────────────── */
  const focusAt = useCallback((idx: number) => {
    inputRefs.current[Math.max(0, Math.min(PIN_LEN - 1, idx))]?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
      const val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-1);
      if (!val) return;
      const next = [...digits];
      next[idx] = val;
      setDigits(next);
      setError('');
      if (idx < PIN_LEN - 1) focusAt(idx + 1);
    },
    [digits, focusAt],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
      if (e.key === 'Backspace') {
        if (digits[idx]) {
          const next = [...digits]; next[idx] = ''; setDigits(next);
        } else { focusAt(idx - 1); }
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusAt(idx - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); focusAt(idx + 1); }
        else if (e.key === 'Enter' && code.length >= 4) void doPair(code);
    },
    [digits, focusAt, code, doPair],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text')
        .replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, PIN_LEN);
      if (!text) return;
      const next = Array(PIN_LEN).fill('') as string[];
      for (let i = 0; i < text.length; i++) next[i] = text[i];
      setDigits(next);
      setError('');
      focusAt(Math.min(text.length, PIN_LEN - 1));
    },
    [focusAt],
  );

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="relative flex flex-col items-center gap-5 py-6 px-4 text-center overflow-hidden">
      {success && <Confetti />}

      {/* Vehicle / success icon */}
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500"
        style={{
          background: success ? 'rgba(52,211,153,0.1)' : 'rgba(59,130,246,0.08)',
          border: `1px solid ${success ? 'rgba(52,211,153,0.35)' : 'rgba(59,130,246,0.2)'}`,
          boxShadow: success ? '0 0 40px rgba(52,211,153,0.2)' : '0 0 32px rgba(59,130,246,0.12)',
          animation: success ? 'successPulse 0.5s ease-out' : 'none',
        }}
      >
        {success ? (
          <svg width="30" height="30" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="#34d399" strokeWidth="2" opacity="0.25"/>
            <path d="M11 18l5 5 9-9" stroke="#34d399" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: 'drawCheck 0.4s ease-out 0.15s both' }}/>
          </svg>
        ) : (
          <svg width="30" height="30" viewBox="0 0 38 38" fill="none">
            <path d="M5 23V18L9 11Q10.5 8 13 8H25Q27.5 8 29 11L33 18V23"
              stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 23h30v4.5A1.5 1.5 0 0132.5 29h-27A1.5 1.5 0 014 27.5V23z" stroke="#3b82f6" strokeWidth="2"/>
            <circle cx="10" cy="23" r="2.5" stroke="#3b82f6" strokeWidth="2"/>
            <circle cx="28" cy="23" r="2.5" stroke="#3b82f6" strokeWidth="2"/>
            <circle cx="29" cy="10" r="7" fill="#0c1a2e" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
            <rect x="26" y="7.5" width="6" height="5" rx="1" stroke="#60a5fa" strokeWidth="1.2"/>
            <path d="M28 12.5v1.5M29 12.5v1.5M30 12.5v1.5" stroke="#60a5fa" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        )}
      </div>

      {/* Title */}
      <div>
        <h2 className="text-white font-bold text-base leading-tight">
          {success ? 'Araç Eşleştirildi!' : 'Aracınızı Eşleştirin'}
        </h2>
        <p className="text-white/40 text-xs mt-1 leading-relaxed">
          {success
            ? 'Başarıyla bağlandı. Yönlendiriliyorsunuz…'
            : 'Araç ekranındaki QR kodu tarayın veya 6 haneli kodu girin'}
        </p>
      </div>

      {/* Mode tabs — only show before success */}
      {!success && (
        <div
          className="flex w-full max-w-[280px] p-1 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {(['qr', 'pin'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
              style={{
                background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: mode === m ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                border: mode === m ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
              }}
            >
              {m === 'qr' ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                    <rect x="10" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                    <rect x="1" y="10" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                    <rect x="2.5" y="2.5" width="2" height="2" fill="currentColor"/>
                    <rect x="11.5" y="2.5" width="2" height="2" fill="currentColor"/>
                    <rect x="2.5" y="11.5" width="2" height="2" fill="currentColor"/>
                    <path d="M10 10h2v2h-2zM12 12h2v2h-2zM10 14h2M14 10v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  QR Tara
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M5 8h6M8 6v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Kod Gir
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── QR Mode ─────────────────────────────────────────── */}
      {!success && mode === 'qr' && (
        <div className="w-full max-w-[280px] flex flex-col items-center gap-3">
          {!scanning && !loading && (
            <button
              onClick={() => void startQR()}
              className="w-full py-4 rounded-2xl font-bold text-white text-sm tracking-wide transition-all duration-150 active:scale-95 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 8px 24px rgba(59,130,246,0.25)' }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5" stroke="white" strokeWidth="1.5"/>
                <circle cx="8" cy="8" r="2" fill="white"/>
              </svg>
              Kamerayı Aç
            </button>
          )}

          {scanning && (
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden"
              style={{ background: '#000', border: '1.5px solid rgba(59,130,246,0.3)' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <QRFrame found={qrFound} />
              <div className="absolute bottom-2 inset-x-0 flex justify-center">
                <span className="text-[10px] font-semibold text-white/60 bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">
                  QR kodu kareye getirin
                </span>
              </div>
              <button
                onClick={stopCamera}
                className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-white/50">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="28" strokeDashoffset="10" opacity="0.4"/>
                <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Eşleştiriliyor…
            </div>
          )}

          {cameraErr && (
            <p className="text-red-400/90 text-xs text-center">{cameraErr}</p>
          )}
        </div>
      )}

      {/* ── PIN Mode ─────────────────────────────────────────── */}
      {!success && mode === 'pin' && (
        <div className="w-full max-w-[280px] flex flex-col items-center gap-4">
          <div className="flex gap-2" onPaste={handlePaste}>
            {Array.from({ length: PIN_LEN }, (_, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                maxLength={2}
                value={digits[i]}
                onChange={(e) => handleChange(e, i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onFocus={(e) => e.target.select()}
                disabled={loading}
                className="w-10 h-13 text-center text-lg font-mono font-bold rounded-xl transition-all focus:outline-none disabled:opacity-50"
                style={{
                  height: '52px',
                  background: digits[i] ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)',
                  border: error
                    ? '1.5px solid rgba(239,68,68,0.5)'
                    : digits[i]
                    ? '1.5px solid rgba(59,130,246,0.5)'
                    : '1.5px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  boxShadow: digits[i] ? '0 0 10px rgba(59,130,246,0.18)' : 'none',
                }}
              />
            ))}
          </div>

          {error && <p className="text-red-400/90 text-xs -mt-1">{error}</p>}

          <button
            onClick={() => void doPair(code)}
            disabled={loading || code.trim().length < 4}
            className="w-full py-4 rounded-2xl font-bold text-white text-sm tracking-wide transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow: '0 8px 24px rgba(59,130,246,0.25)',
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
                    strokeDasharray="28" strokeDashoffset="10" opacity="0.4"/>
                  <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Eşleştiriliyor…
              </span>
            ) : 'Eşleştir'}
          </button>
        </div>
      )}

      {!success && (
        <p className="text-white/20 text-[10px] max-w-[240px] leading-relaxed">
          Araç ekranında{' '}
          <span className="text-white/35">Ayarlar → Telefonumu Bağla</span>{' '}
          seçeneğini açın.
        </p>
      )}
    </div>
  );
}
