/**
 * MobileLinkWidget — 6 haneli QR eşleşme kodu ekranı.
 *
 * Akış:
 *   1. Sunucuda bekleyen kod yoksa (mobil eşleşme tamamlanmış) → "Bağlı Cihaz"
 *   2. Aksi halde kullanıcı "Güvenli Eşleşme Kodu Oluştur" ile kod üretir (otomatik üretim yok)
 *   3. 1 Hz countdown → 0'da refreshLinkingCode otomatik
 *   4. QR: qrcode lib + canvas
 *
 * Zero-Leak: interval + timeout cleanup, mounted guard
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, RefreshCw, Wifi, WifiOff, CheckCircle2 } from 'lucide-react';
import {
  registerVehicle,
  refreshLinkingCode,
  getVehicleIdentity,
} from '../../platform/vehicleIdentityService';
import type { LinkingCodeInfo } from '../../platform/vehicleIdentityService';
import { HEAVY_INERTIA_EASE, HEAVY_INERTIA_MS } from '../common/DiagnosticPulse';

/* ── Sabitler ─────────────────────────────────────────── */

const QR_SCHEME = 'carlauncher://link/';

const WARN_SECS = 15;

const HEAVY_TRANSITION = `opacity ${HEAVY_INERTIA_MS}ms ${HEAVY_INERTIA_EASE}, transform ${HEAVY_INERTIA_MS}ms ${HEAVY_INERTIA_EASE}`;

/* ── Yardımcılar ──────────────────────────────────────── */

function secsLeft(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function isValidSixDigit(info: LinkingCodeInfo | null): boolean {
  return Boolean(info?.code && info.code.length === 6);
}

/* ── Bileşen ──────────────────────────────────────────── */

export const MobileLinkWidget = memo(function MobileLinkWidget() {
  const [info, setInfo]         = useState<LinkingCodeInfo | null>(null);
  const [remaining, setRemain]  = useState(0);
  const [error, setError]       = useState<string | null>(null);

  const [probeDone, setProbeDone]     = useState(false);
  const [serverLinked, setServerLinked] = useState(false);

  const [isGenerated, setIsGenerated] = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [qrReveal, setQrReveal]       = useState(false);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(true);
  const genTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* mountedRef yalnızca gerçek unmount'ta false — probe cleanup ile karışmasın (Strict Mode / QR boş) */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (genTimerRef.current) {
        clearTimeout(genTimerRef.current);
        genTimerRef.current = null;
      }
    };
  }, []);

  /* ── QR çizimi — kod + canvas DOM'da ve görünür olduktan sonra ── */
  useEffect(() => {
    if (!qrReveal || !isValidSixDigit(info)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const t = window.setTimeout(() => {
      if (!canvasRef.current || !mountedRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      void QRCode.toCanvas(canvasRef.current, `${QR_SCHEME}${info!.code}`, {
        width:                200,
        margin:               2,
        // Tema-bağımsız: koyu modül / beyaz tile → hem gündüz (açık zemin) hem gece
        // taranabilir. Kameralar koyu-açık QR'ı en iyi okur; eski beyaz-modül/koyu-zemin
        // gündüz modunda kontrastı bozuyordu.
        color:                { dark: '#0b1220', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).catch((e) => {
        console.warn('QR Render Error:', e);
      });
    }, 80);

    return () => clearTimeout(t);
  }, [info?.code, qrReveal]);

  /* ── Montaj: mobil eşleşme tamamlanmış mı? (bekleyen kod yok) ── */
  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const identity = await getVehicleIdentity();
        if (!alive || !mountedRef.current) return;
        if (!identity) {
          setServerLinked(false);
          return;
        }
        const snap = await registerVehicle();
        if (!alive || !mountedRef.current) return;
        setServerLinked(!snap.code || snap.code.length !== 6);
      } catch {
        if (alive && mountedRef.current) setServerLinked(false);
      } finally {
        if (alive && mountedRef.current) setProbeDone(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const loadCode = useCallback(async (isRefresh: boolean): Promise<'ok' | 'paired' | 'fail'> => {
    if (!mountedRef.current) return 'fail';
    setError(null);

    try {
      const result = isRefresh ? await refreshLinkingCode() : await registerVehicle();
      if (!mountedRef.current) return 'fail';

      if (!result.code || result.code.length !== 6) {
        setInfo(null);
        setRemain(0);
        setServerLinked(true);
        setQrReveal(false);
        return 'paired';
      }

      setServerLinked(false);
      setInfo(result);
      setRemain(secsLeft(result.expiresAt));
      return 'ok';
    } catch (e) {
      if (!mountedRef.current) return 'fail';
      setError((e as Error).message ?? 'Kod alınamadı');
      return 'fail';
    }
  }, []);

  /* ── Countdown — yalnızca üretilmiş geçerli kod varken ── */
  useEffect(() => {
    if (!isGenerated || !isValidSixDigit(info)) return;

    const id = setInterval(() => {
      if (!mountedRef.current) return;
      const secs = secsLeft(info!.expiresAt);
      setRemain(secs);

      if (secs === 0) {
        void (async () => {
          const o = await loadCode(true);
          if (!mountedRef.current) return;
          if (o === 'paired') {
            setIsGenerated(false);
            setQrReveal(false);
            setInfo(null);
          }
        })();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [info, loadCode, isGenerated]);

  const runRevealSequence = useCallback(async (isRefresh: boolean, restoreLinkedOnFail = false) => {
    setGenerating(true);
    setQrReveal(false);
    const t0 = Date.now();
    const outcome = await loadCode(isRefresh);
    if (!mountedRef.current) return;

    if (outcome === 'paired') {
      setIsGenerated(false);
      setGenerating(false);
      return;
    }
    if (outcome === 'fail') {
      setIsGenerated(false);
      setGenerating(false);
      if (restoreLinkedOnFail) setServerLinked(true);
      return;
    }

    const elapsed = Date.now() - t0;
    const wait    = Math.max(0, 300 - elapsed);
    if (wait > 0) {
      await new Promise<void>((r) => {
        genTimerRef.current = setTimeout(() => {
          genTimerRef.current = null;
          r();
        }, wait);
      });
    }
    if (!mountedRef.current) return;
    setGenerating(false);
    setQrReveal(true);
  }, [loadCode]);

  const onPrimaryGenerate = useCallback(() => {
    setIsGenerated(true);
    void runRevealSequence(false);
  }, [runRevealSequence]);

  const onRequestNewFromLinked = useCallback(() => {
    setServerLinked(false);
    setIsGenerated(true);
    void runRevealSequence(true, true);
  }, [runRevealSequence]);

  const isExpiring = isValidSixDigit(info) && remaining <= WARN_SECS && remaining > 0;
  const isExpired =
    isValidSixDigit(info) &&
    !generating &&
    info!.expiresAt > 0 &&
    Date.now() > info!.expiresAt;

  /* ── Probe yükleniyor ─────────────────────────────────── */
  if (!probeDone) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--oem-ink-4)]">Durum kontrol ediliyor…</span>
      </div>
    );
  }

  /* ── Sunucu: bekleyen kod yok (mobil eşleşme tamamlanmış) ── */
  if (serverLinked && !isGenerated) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 select-none">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30"
          style={{ background: 'rgba(16,185,129,0.12)' }}
        >
          <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden />
        </div>
        <div className="text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-[color:var(--oem-ink)]">Bağlı Cihaz</p>
          <p className="mt-2 max-w-[260px] text-[11px] font-medium leading-relaxed text-[color:var(--oem-ink-3)]">
            Bu araç ünitesi mobil uygulama ile eşleştirildi. Yeni bir güvenli kod üretmek için aşağıdaki düğmeyi
            kullanın.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRequestNewFromLinked()}
          className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/15 active:scale-[0.98]"
        >
          Yeni güvenli kod üret
        </button>
      </div>
    );
  }

  /* ── Henüz kod üretilmedi ─────────────────────────────── */
  if (!isGenerated) {
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center select-none">
        <Smartphone className="h-14 w-14 text-cyan-400/90" strokeWidth={1.25} aria-hidden />
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[color:var(--oem-ink)]">Mobil Cihaz Eşleştir</h3>
          <p className="mx-auto mt-3 max-w-[280px] text-[11px] font-medium leading-relaxed text-[color:var(--oem-ink-3)]">
            Bu kod sadece bu oturum için geçerlidir. Telefonunuzdaki CarOS Pro Mobile uygulamasını açın ve kodu
            taratın.
          </p>
        </div>
        <button
          type="button"
          onClick={onPrimaryGenerate}
          className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-6 py-3 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.15)] transition-all hover:border-cyan-400/55 hover:bg-cyan-500/25 active:scale-[0.98]"
        >
          Güvenli Eşleşme Kodu Oluştur
        </button>
      </div>
    );
  }

  /* ── Üretim / yenileme sırasında (QR görünmeden önce) ──── */
  if (generating || !qrReveal) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 select-none">
        <RefreshCw className="h-7 w-7 animate-spin text-cyan-400" aria-hidden />
        <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-[color:var(--oem-ink-3)]">Güvenlik anahtarı üretiliyor…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <WifiOff className="h-6 w-6 text-red-400" aria-hidden />
        <span className="text-center text-xs text-red-400">{error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setIsGenerated(false);
            setQrReveal(false);
          }}
          className="rounded-xl border border-[color:var(--oem-ink-4)] px-5 py-2 text-[11px] font-black uppercase tracking-widest text-[color:var(--oem-ink-2)] transition-all hover:border-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] active:scale-95"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-4 select-none">
      <div
        className="flex w-full flex-col items-center gap-5"
        style={{
          opacity:    qrReveal ? 1 : 0,
          transform:  qrReveal ? 'scale(1)' : 'scale(0.95)',
          transition: HEAVY_TRANSITION,
        }}
      >
        <div className="flex items-center gap-3 self-stretch px-1">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.25)' }}
          >
            <Smartphone className="h-4 w-4 text-cyan-400" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-[0.35em] text-[color:var(--oem-ink-2)]">Mobil Cihaz Eşle</div>
            <div className="text-[9px] uppercase tracking-widest text-[color:var(--oem-ink-4)]">Telefon uygulamasıyla tara veya kodu gir</div>
          </div>
          <div
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1"
            style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)' }}
          >
            <Wifi className="h-3 w-3 text-cyan-400" aria-hidden />
            <span className="text-[9px] font-black text-cyan-400">CANLI</span>
          </div>
        </div>

        <div className="relative">
          <div
            className="rounded-2xl p-3"
            style={{
              background: isExpiring || isExpired ? 'rgba(239,68,68,0.10)' : 'rgba(34,211,238,0.06)',
              border:       `1.5px solid ${isExpiring || isExpired ? 'rgba(239,68,68,0.3)' : 'rgba(34,211,238,0.2)'}`,
              transition:   'all 0.4s',
            }}
          >
            <canvas
              ref={canvasRef}
              width={200}
              height={200}
              style={{
                display:    'block',
                opacity:    isExpired ? 0.25 : isExpiring ? 0.7 : 1,
                filter:     isExpired ? 'blur(4px)' : 'none',
                transition: 'opacity 0.4s, filter 0.4s',
              }}
            />
            {isExpired && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-lg bg-black/80 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-red-400">
                  Süresi Doldu
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div
            className="font-black tabular-nums tracking-[0.25em]"
            style={{
              fontSize:             '2.4rem',
              letterSpacing:        '0.2em',
              color:                isExpiring ? '#f87171' : isExpired ? 'var(--oem-ink-4)' : 'var(--oem-ink)',
              textShadow:           isExpiring ? '0 0 20px rgba(248,113,113,0.5)' : 'none',
              fontVariantNumeric:   'tabular-nums',
              transition:           'color 0.4s, text-shadow 0.4s',
            }}
          >
            {info ? formatCode(info.code) : '--- ---'}
          </div>

          <div className="flex items-center gap-2">
            <div className="h-1 w-[120px] rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width:     `${info ? Math.min(100, (remaining / 60) * 100) : 0}%`,
                  background: isExpiring ? '#f87171' : '#22d3ee',
                  boxShadow: isExpiring ? '0 0 6px rgba(248,113,113,0.6)' : '0 0 6px rgba(34,211,238,0.5)',
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
        </div>

        <button
          type="button"
          onClick={() => void runRevealSequence(true)}
          disabled={generating}
          className="group flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 transition-all hover:border-cyan-400/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5 text-cyan-400 transition-transform duration-500 group-hover:rotate-180" />
          <span className="text-[10px] font-black uppercase tracking-[0.35em] text-[color:var(--oem-ink-3)] transition-colors group-hover:text-cyan-400">
            Yeni Kod Al
          </span>
        </button>

        <p className="max-w-[240px] text-center text-[9px] leading-relaxed text-[color:var(--oem-ink-4)]">
          Kod 60 sn geçerlidir ve tek kullanımlıktır. Telefonun Caros uygulamasında eşleşme ekranını aç.
        </p>
      </div>
    </div>
  );
});
