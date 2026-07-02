/**
 * KeyBeamPanel — "QR Key Beam": telefondan araca API anahtarı aktarma.
 *
 * Akış:
 *   1. Açılışta createBeamSession() → kod + tek kullanımlık AES-256-GCM
 *      anahtarı (yalnızca RAM'de) üretilir, QR çizilir.
 *   2. Kullanıcı telefonuyla QR'ı okutur → köprü sayfasında key'i yapıştırır
 *      → "Araca Gönder".
 *   3. Bu bileşen consume_key_beam RPC'sini poll eder (2.5 s). Bulununca
 *      RAM'deki anahtarla çözülür, format doğrulanır, onKeySaved çağrılır.
 *   4. Süre dolarsa "Yenile" ile yeni kod/anahtar/QR üretilir.
 *
 * Zero-Leak: interval + timeout cleanup, mounted guard (MobileLinkWidget deseni).
 * Araçta hiçbir yazı yazılmaz — yalnızca QR + durum metni gösterilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, RefreshCw, CheckCircle2, X, WifiOff } from 'lucide-react';
import { createBeamSession, pollBeamOnce, type BeamSession } from '../../platform/keyBeamService';
import { KEY_BEAM_TTL_MS } from '../../platform/keyBeamCrypto';
import { HEAVY_INERTIA_EASE, HEAVY_INERTIA_MS } from '../common/DiagnosticPulse';

const POLL_INTERVAL_MS = 2500;
const TTL_SECS = KEY_BEAM_TTL_MS / 1000;

const HEAVY_TRANSITION = `opacity ${HEAVY_INERTIA_MS}ms ${HEAVY_INERTIA_EASE}, transform ${HEAVY_INERTIA_MS}ms ${HEAVY_INERTIA_EASE}`;

type Status = 'loading' | 'active' | 'success' | 'error';

interface Props {
  /** Deşifrelenmiş + format doğrulanmış API key alındığında çağrılır (setGeminiKey vb). */
  onKeySaved: (key: string) => void | Promise<void>;
  /** Panel kapatılmak istendiğinde (başarı sonrası otomatik veya kullanıcı X'e basınca). */
  onClose: () => void;
}

function secsLeft(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

export const KeyBeamPanel = memo(function KeyBeamPanel({ onKeySaved, onClose }: Props) {
  const [session, setSession]   = useState<BeamSession | null>(null);
  const [remaining, setRemain]  = useState(0);
  const [status, setStatus]     = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const mountedRef       = useRef(true);
  const pollTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);
  const clearTick = useCallback(() => {
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
  }, []);

  /* Zero-Leak: unmount'ta tüm zamanlayıcılar temizlenir. */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPoll();
      clearTick();
      if (successTimerRef.current) { clearTimeout(successTimerRef.current); successTimerRef.current = null; }
    };
  }, [clearPoll, clearTick]);

  const startSession = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    clearPoll();
    clearTick();
    try {
      const s = await createBeamSession();
      if (!mountedRef.current) return;
      setSession(s);
      setRemain(secsLeft(s.expiresAt));
      setStatus('active');
    } catch {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg('QR oluşturulamadı');
    }
  }, [clearPoll, clearTick]);

  useEffect(() => { void startSession(); }, [startSession]);

  /* ── QR çizimi ──────────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'active' || !session) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

    void QRCode.toCanvas(canvas, session.qrUrl, {
      width:                200,
      margin:               2,
      color:                { dark: '#0b1220', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => { /* non-critical: render hatası kullanıcıya kod göstermeyle telafi edilir */ });
  }, [status, session]);

  /* ── Countdown ──────────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'active' || !session) return;

    tickTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const secs = secsLeft(session.expiresAt);
      setRemain(secs);
      if (secs === 0) {
        clearTick();
        clearPoll();
        setStatus('error');
        setErrorMsg('Süresi doldu — yeniden deneyin');
      }
    }, 1000);

    return clearTick;
  }, [status, session, clearTick, clearPoll]);

  /* ── Polling ────────────────────────────────────────────── */
  useEffect(() => {
    if (status !== 'active' || !session) return;

    let inFlight = false;
    pollTimerRef.current = setInterval(() => {
      if (inFlight || !mountedRef.current) return;
      inFlight = true;
      void pollBeamOnce(session).then((res) => {
        inFlight = false;
        if (!mountedRef.current) return;

        if (res.status === 'found') {
          clearPoll();
          clearTick();
          setStatus('success');
          void onKeySaved(res.apiKey);
          successTimerRef.current = setTimeout(() => {
            if (mountedRef.current) onClose();
          }, 1500);
          return;
        }

        if (res.status === 'invalid') {
          clearPoll();
          clearTick();
          setStatus('error');
          setErrorMsg('Geçersiz anahtar formatı alındı — tekrar deneyin');
        }
        // 'pending' / 'error' → sessizce devam (geçici ağ hatası olabilir)
      });
    }, POLL_INTERVAL_MS);

    return clearPoll;
  }, [status, session, clearPoll, clearTick, onKeySaved, onClose]);

  const isExpiring = status === 'active' && remaining <= 30 && remaining > 0;

  return (
    <div
      className="relative flex flex-col items-center gap-4 rounded-2xl p-4"
      style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Kapat"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg text-[color:var(--oem-ink-3)] transition-colors hover:text-[color:var(--oem-ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <RefreshCw className="h-6 w-6 animate-spin text-blue-400" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--oem-ink-4)]">Güvenli kod üretiliyor…</span>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30"
            style={{ background: 'rgba(16,185,129,0.12)' }}
          >
            <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden />
          </div>
          <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">Key algılandı ✓</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <WifiOff className="h-6 w-6 text-red-400" aria-hidden />
          <span className="text-center text-xs text-red-400">{errorMsg ?? 'Bir hata oluştu'}</span>
          <button
            type="button"
            onClick={() => void startSession()}
            className="rounded-xl border border-blue-500/35 bg-blue-500/10 px-5 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-blue-300 transition-all hover:border-blue-400/50 hover:bg-blue-500/15 active:scale-[0.98]"
          >
            Yenile
          </button>
        </div>
      )}

      {status === 'active' && session && (
        <div
          className="flex w-full flex-col items-center gap-4"
          style={{ opacity: 1, transform: 'scale(1)', transition: HEAVY_TRANSITION }}
        >
          <div className="flex items-center gap-2 self-stretch">
            <Smartphone className="h-4 w-4 text-blue-400" aria-hidden />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[color:var(--oem-ink-2)]">Telefonla QR Tara</span>
          </div>

          <div
            className="rounded-2xl p-3"
            style={{
              background:  isExpiring ? 'rgba(239,68,68,0.10)' : 'rgba(59,130,246,0.06)',
              border:      `1.5px solid ${isExpiring ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.2)'}`,
              transition:  'all 0.4s',
            }}
          >
            <canvas ref={canvasRef} width={200} height={200} style={{ display: 'block' }} />
          </div>

          <div className="flex items-center gap-2">
            <div className="h-1 w-[100px] rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width:      `${Math.min(100, (remaining / TTL_SECS) * 100)}%`,
                  background: isExpiring ? '#f87171' : '#60a5fa',
                }}
              />
            </div>
            <span
              className="min-w-[36px] text-[11px] font-black tabular-nums"
              style={{ color: isExpiring ? '#f87171' : 'var(--oem-ink-3)' }}
            >
              {remaining > 0 ? `${remaining}s` : 'Doldu'}
            </span>
          </div>

          <p className="max-w-[240px] text-center text-[9px] leading-relaxed text-[color:var(--oem-ink-4)]">
            Telefonunuzla QR&apos;ı tarayın, açılan sayfada anahtarınızı yapıştırıp &quot;Araca Gönder&quot;e basın.
          </p>
        </div>
      )}
    </div>
  );
});
