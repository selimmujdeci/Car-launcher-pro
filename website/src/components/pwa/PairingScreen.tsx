'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  authorizePairingContinuation,
} from '@/security/accountCleanup/accountCleanupRuntime';
import { pairVehicle } from '@/lib/pairingService';
import { pairFailureNotice, type PairFailureReason } from '@/lib/pairing/pairFailureModel';
import {
  pairingNamespace,
  createPendingPairing,
  submitPendingPairings,
  expirePendingPairings,
  listPendingPairings,
  type PairingSubmitOutcome,
} from '@/lib/offline/pendingPairingService';
import { statusLabel, type PendingPairing } from '@/lib/offline/offlinePairing';
import { isFleetErrorCode } from '@/lib/fleet/errors';
import { Icon } from '@/components/pwa/ui/Icon';
import { StatusPill, type Tone } from '@/components/pwa/ui/primitives';

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

const PIN_LEN = 6;
type Mode = 'pin' | 'qr';

/** Oturum açılmadan da eşleştirilebilir (kod yetkinin kendisidir) → cihaz kapsamı. */
const NS = pairingNamespace(null);

/** `pairVehicle` sonucunu çevrimdışı servisin taşıyıcı sözleşmesine çevirir. */
async function submitViaApi(code: string): Promise<PairingSubmitOutcome> {
  const res = await pairVehicle(code);
  return {
    ok:        res.success,
    offline:   res.offline === true,
    code:      isFleetErrorCode(res.code) ? res.code : null,
    vehicleId: res.vehicleId ?? null,
  };
}

function isBrowserOffline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

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
const CONFETTI_COLORS = ['var(--md-success)', 'var(--md-primary)', 'var(--md-warning)', 'var(--md-tertiary)', '#f472b6', '#fb923c'];

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
  const c = found ? 'var(--md-success)' : 'var(--md-primary)';
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
        <path d="M80 110 l24 24 36-36" stroke="var(--md-success)" strokeWidth="4"
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
  const [notice, setNotice]       = useState('');
  const [success, setSuccess]     = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [qrFound, setQrFound]     = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  /** Sunucu doğrulaması bekleyen çevrimdışı talepler — "eşleşti" DEĞİLDİR. */
  const [claims, setClaims]       = useState<PendingPairing[]>([]);

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

  /* ── Çevrimdışı talepler ────────────────────────────────── */

  /** Bekleyen talepleri diskten tazeler. Kod ekranda GÖSTERİLMEZ. */
  const refreshClaims = useCallback(async () => {
    try {
      await expirePendingPairings(NS, Date.now());
      const list = await listPendingPairings(NS);
      if (mountedRef.current) setClaims(list);
    } catch {
      /* fail-soft: depo okunamadı — ekran çalışmaya devam eder */
    }
  }, []);

  /**
   * Çevrimdışı eşleştirme talebi kaydeder.
   * DİKKAT: burada araç EŞLEŞMEZ — yalnız doğrulanmayı bekleyen claim üretilir.
   */
  const queueOffline = useCallback(
    async (pairCode: string, cause: PairFailureReason = 'DEVICE_OFFLINE', httpStatus?: number) => {
      if (!(await authorizePairingContinuation()).allowed) {
        if (mountedRef.current) {
          setError('Güvenli oturum temizliği sırasında eşleştirme kullanılamaz.');
        }
        return;
      }
      try {
        await createPendingPairing({
          namespace: NS, userId: null, code: pairCode, now: Date.now(),
        });
        await refreshClaims();
        if (mountedRef.current) {
          setError('');
          /* #643 — CÜMLE SEBEBE GÖRE KURULUR. Saha (2026-08-19): kullanıcı 5G ile
             tam sinyaldeyken "Çevrimdışısınız" okuyordu; sunucu 5xx/429 dönmüştü.
             Kuyruk davranışı AYNI (talep saklanır, bağlantı gelince denenir) —
             değişen tek şey, kullanıcıya DOĞRUYU söylemek. */
          setNotice(pairFailureNotice(cause, httpStatus));
        }
      } catch {
        if (mountedRef.current) {
          setError('Talep cihaza kaydedilemedi. Bağlantı gelince tekrar deneyin.');
        }
      }
    },
    [refreshClaims],
  );

  /* ── Shared pair logic ──────────────────────────────────── */
  const doPair = useCallback(
    async (pairCode: string) => {
      if (!mountedRef.current) return;
      setLoading(true);
      setError('');
      setNotice('');

      // Çevrimdışıysak sunucuya HİÇ gitmeyiz; sahte "başarısız" da göstermeyiz.
      if (isBrowserOffline()) {
        setLoading(false);
        await queueOffline(pairCode, 'DEVICE_OFFLINE');
        if (mode === 'qr') setMode('pin');
        return;
      }

      const res = await pairVehicle(pairCode);
      if (!mountedRef.current) return;
      setLoading(false);

      if (res.success) {
        setSuccess(true);
        try { navigator.vibrate?.([50, 30, 50]); } catch { /* non-critical */ }
        setTimeout(() => onPaired(), 2200);
        return;
      }

      // Ağ hatası RED DEĞİLDİR → talebi kaydet, bekleyen olarak göster.
      if (res.offline) {
        await queueOffline(pairCode, res.reason ?? 'NETWORK_FAILED', res.httpStatus);
        if (mode === 'qr') setMode('pin');
        return;
      }

      setError(res.message);
      try { navigator.vibrate?.([100, 50, 100]); } catch { /* non-critical */ }
      if (mode === 'qr') setMode('pin');
    },
    [onPaired, mode, queueOffline],
  );

  /**
   * Bekleyenleri sunucuya gönderir — idempotent, TTL'i geçeni GÖNDERMEZ.
   * Açılışta bir kez, sonra yalnız `online` olayında çalışır (timer YOK).
   */
  const flushClaims = useCallback(async () => {
    if (!(await authorizePairingContinuation()).allowed) return;
    if (isBrowserOffline()) {
      await refreshClaims();
      return;
    }
    try {
      const summary = await submitPendingPairings({
        namespace: NS, submit: submitViaApi, now: Date.now(),
      });
      await refreshClaims();
      if (summary.verified > 0 && mountedRef.current) {
        setNotice('');
        setSuccess(true);
        setTimeout(() => onPaired(), 1600);
      }
    } catch {
      await refreshClaims();
    }
  }, [refreshClaims, onPaired]);

  useEffect(() => {
    void flushClaims();
    const handleOnline = () => { void flushClaims(); };
    window.addEventListener('online', handleOnline);
    return () => { window.removeEventListener('online', handleOnline); };
  }, [flushClaims]);

  /* ── QR Scanner ─────────────────────────────────────────── */
  const startQR = useCallback(async () => {
    if (!(await authorizePairingContinuation()).allowed) {
      setCameraErr('Güvenli oturum temizliği sırasında kamera eşleştirmesi kullanılamaz.');
      return;
    }
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
    // `stopCamera` burada ÇAĞRILMIYOR (kamera açılıyor, kapanmıyor) — bağımlılık
    // listesinde durması gereksiz yeniden üretim doğuruyordu.
  }, []);

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
    <div className="relative flex flex-col items-center gap-5 py-4 text-center overflow-hidden">
      {success && <Confetti />}

      {/* Hero ikon — başarıda onay */}
      <span aria-hidden="true" className="flex items-center justify-center"
        style={{
          width: 88, height: 88, borderRadius: 'var(--md-shape-xl)',
          background: success ? 'var(--md-success-container)' : 'var(--md-primary-container)',
          color: success ? 'var(--md-on-success-container)' : 'var(--md-on-primary-container)',
          animation: success ? 'successPulse 0.5s ease-out' : 'none',
        }}>
        <Icon name={success ? 'check_circle' : 'add_link'} size={44} />
      </span>

      {/* Title */}
      <div>
        <h2 className="md-headline-s md-on-surface">
          {success ? 'Araç Eşleştirildi!' : 'Aracınızı Eşleştirin'}
        </h2>
        <p className="md-body-m md-on-surface-variant mt-1">
          {success
            ? 'Başarıyla bağlandı. Yönlendiriliyorsunuz…'
            : 'Araç ekranında görünen 6 haneli kodu buraya girin'}
        </p>
      </div>

      {/**
       * #631 — EŞLEŞTİRME ARTIK BU EKRANDAN YAPILIR.
       * Eski `/api/pwa/pair` yolu kapalı kalmaya devam ediyor (oturumsuzdu ve
       * yanıtta ham `api_key` döndürüyordu); bu ekran artık KANONİK rotayı
       * (`/api/vehicle/link` → `pair_vehicle_to_user`) kullanır. O RPC bireysel
       * eşleştirmeyi zaten destekler — filo üyeliği ŞART DEĞİLDİR.
       */}
      {!success && (
        <ol className="md-card-filled w-full max-w-sm text-left px-4 py-3 flex flex-col gap-3" aria-label="Eşleştirme adımları">
          {[
            <>Araç ekranında <b>Ayarlar → Telefonumu Bağla</b>&apos;yı açın.</>,
            <>Orada görünen <b>6 haneli kodu</b> aşağıya girin.</>,
            <>Araç doğrudan <b>hesabınıza</b> bağlanır — filo üyeliği gerekmez.</>,
          ].map((t, i) => (
            <li key={i} className="flex items-start gap-3 md-body-m md-on-surface">
              <span aria-hidden="true" className="md-label-l flex items-center justify-center flex-shrink-0"
                style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}>
                {i + 1}
              </span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Mod sekmeleri yalnız 'pin' içerir (QR desteklenmez). Tek seçenekli
          sekme bir karar sunmaz → yalnız GERÇEK bir seçim varken çizilir. */}
      {!success && (['pin'] as Mode[]).length > 1 && (
        <div role="tablist" className="flex gap-2">
          {(['pin'] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className="md-btn-tonal md-state">{m === 'qr' ? 'QR Tara' : 'Kod Gir'}</button>
          ))}
        </div>
      )}
      {/* ── QR Mode ─────────────────────────────────────────── */}
      {/* QR modu KAPATILDI: /api/pwa/pair fail-closed olduğu için kod tarama
          desteklenen bir akış DEĞİL. Blok silinmedi ki kanonik akışa bağlanınca
          yeniden açılabilsin. */}
      {false && mode === 'qr' && (
        <div className="w-full max-w-[280px] flex flex-col items-center gap-3">
          {!scanning && !loading && (
            <button
              onClick={() => void startQR()}
              className="w-full py-4 rounded-2xl font-bold  text-sm tracking-wide transition-all duration-150 active:scale-95 flex items-center justify-center gap-2"
              style={{ background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}
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
              style={{ background: '#000', border: '1.5px solid color-mix(in srgb, var(--md-primary) 30%, transparent)' }}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <QRFrame found={qrFound} />
              <div className="absolute bottom-2 inset-x-0 flex justify-center">
                <span className="text-xs font-semibold md-on-surface-variant bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">
                  QR kodu kareye getirin
                </span>
              </div>
              <button
                onClick={stopCamera}
                className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm md-on-surface-variant">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="28" strokeDashoffset="10" opacity="0.4"/>
                <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Eşleştiriliyor…
            </div>
          )}

          {cameraErr && (
            <p className="text-[color:var(--md-error)] text-xs text-center">{cameraErr}</p>
          )}
        </div>
      )}

      {/* ── PIN Mode ─────────────────────────────────────────── */}
      {!success && mode === 'pin' && (
        <div className="w-full max-w-sm flex flex-col items-center gap-4">
          <div className="flex gap-2 justify-center" onPaste={handlePaste}>
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
                aria-label={`Kodun ${i + 1}. hanesi`}
                className="md-pin text-center disabled:opacity-50"
                data-filled={digits[i] ? 'true' : 'false'}
                data-error={error ? 'true' : 'false'}
              />
            ))}
          </div>

          {error && (
            <p className="md-body-s inline-flex items-center gap-1 -mt-1" style={{ color: 'var(--md-error)' }} role="alert">
              <Icon name="error" size={16} />{error}
            </p>
          )}

          <button
            onClick={() => void doPair(code)}
            disabled={loading || code.trim().length < 4}
            className="md-btn-filled md-state w-full disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ minHeight: 56 }}
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

      {/* ── Çevrimdışı bildirimi (dürüst: "eşleşti" DEMEZ) ──────────── */}
      {!success && notice && (
        <div className="w-full max-w-sm px-4 py-3 text-left flex items-start gap-2"
          style={{ background: 'var(--md-warning-container)', color: 'var(--md-on-warning-container)', borderRadius: 'var(--md-shape-md)' }}>
          <Icon name="cloud_off" size={18} className="flex-shrink-0" />
          <p className="md-body-s">{notice}</p>
        </div>
      )}

      {/* ── Sunucu doğrulaması bekleyen talepler ─────────────────────── */}
      {!success && claims.length > 0 && (
        <div className="w-full max-w-sm text-left">
          <p className="mb-2 md-title-s md-on-surface px-1">Bekleyen eşleştirme talepleri</p>
          <div className="md-card-elevated overflow-hidden">
            {claims.map((claim, i) => {
              const tone: Tone = claim.status === 'VERIFIED' ? 'success'
                : claim.status === 'REJECTED' ? 'error'
                : claim.status === 'EXPIRED' ? 'neutral' : 'warning';
              return (
                <div key={claim.id} className="flex items-center justify-between gap-2 px-4 py-3"
                  style={i > 0 ? { borderTop: '1px solid var(--md-outline-variant)' } : undefined}>
                  <span className="md-body-m md-on-surface tabular-nums">
                    {new Date(claim.requestedAt).toLocaleString('tr-TR')}
                  </span>
                  <StatusPill tone={tone}>{statusLabel(claim.status)}</StatusPill>
                </div>
              );
            })}
          </div>
          <p className="mt-2 md-body-s md-on-surface-variant px-1">
            Bu talepler sunucu onaylamadan sahiplik oluşturmaz.
          </p>
        </div>
      )}

    </div>
  );
}
