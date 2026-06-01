/**
 * VoiceAssistant — Premium sesli asistan overlay.
 *
 * Google-free: Native modda Android on-device STT (preferOffline).
 *              Web modunda metin girişi birincil arayüz.
 *
 * Özellikler:
 *   - Komut geçmişi paneli
 *   - Kategorize hızlı komut ızgarası
 *   - Animated waveform (CSS)
 *   - Güven skoru göstergesi
 *   - TTS geri bildirimi
 */
import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import {
  useVoiceState,
  startListening,
  stopListening,
  processTextCommand,
} from '../../platform/voiceService';
import { isNative } from '../../platform/bridge';

/* ── Waveform animation ─────────────────────────────────────── */

const Waveform = memo(function Waveform({ active }: { active: boolean }) {
  const bars = [3, 7, 11, 6, 9, 13, 5, 10, 7, 4, 8, 12, 6, 9, 5];
  return (
    <div className="flex items-center justify-center gap-[3px] h-12">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-300 ${
            active ? 'bg-blue-400' : 'bg-slate-700'
          }`}
          style={{
            height: active ? `${h * 3}px` : '4px',
            animation: active ? `car-pulse-subtle ${400 + i * 40}ms ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))}
    </div>
  );
});

/* ── Confidence bar ─────────────────────────────────────────── */

const ConfidenceBar = memo(function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 font-mono w-7 text-right">{pct}%</span>
    </div>
  );
});

/* ── Pulse ring ─────────────────────────────────────────────── */

const PulseRing = memo(function PulseRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
      <span className="absolute inset-[-6px] rounded-full border border-blue-400/30 animate-pulse" />
    </>
  );
});

/* ── Main overlay ───────────────────────────────────────────── */

const VoiceOverlay = memo(function VoiceOverlay({ onClose, autoStart }: { onClose: () => void; autoStart?: boolean }) {
  const voice       = useVoiceState();

  const isListening   = voice.status === 'listening';
  const isProcessing  = voice.status === 'processing';
  const isSuccess     = voice.status === 'success';
  const isError       = voice.status === 'error';
  const isThrottled   = voice.status === 'throttled';

  // Auto-start listening on mount
  useEffect(() => {
    if (autoStart) startListening();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close on success
  useEffect(() => {
    if (isSuccess) {
      const id = setTimeout(onClose, 2200);
      return () => clearTimeout(id);
    }
  }, [isSuccess, onClose]);

  const handleQuickCmd = useCallback((cmd: string) => {
    processTextCommand(cmd);
  }, []);

  /* ── Status label ── */
  const statusLabel =
    isListening   ? 'Dinliyorum…' :
    isProcessing  ? 'AI düşünüyor…' :
    isSuccess     ? 'Anlaşıldı' :
    isError       ? 'Anlaşılamadı' :
    isThrottled   ? 'Bekleyin' : 'Sesli Asistan';

  const statusColor =
    isListening   ? 'text-blue-400' :
    isProcessing  ? 'text-purple-400' :
    isSuccess     ? 'text-emerald-400' :
    isError       ? 'text-red-400' :
    isThrottled   ? 'text-amber-400' : 'text-slate-400';

  const dotColor =
    isListening   ? 'bg-blue-400 animate-pulse' :
    isProcessing  ? 'bg-purple-400 animate-pulse' :
    isSuccess     ? 'bg-emerald-400' :
    isError       ? 'bg-red-400' :
    isThrottled   ? 'bg-amber-400 animate-pulse' : 'bg-slate-700';

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget) { stopListening(); onClose(); } }}
    >
      {/* Backdrop — çok şeffaf, sadece hafif karartma */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={() => { stopListening(); onClose(); }}
      />

      {/* Panel — ortada, küçük */}
      <div className="relative w-full max-w-xs flex flex-col gap-3 pointer-events-auto">

        {/* ── Main card — çok şeffaf cam kart ── */}
        <div className="bg-[#0d1628]/35 backdrop-blur-2xl border border-white/[0.12] rounded-3xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Top shimmer */}
          <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />

          <div className="p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <span className={`text-xs font-bold uppercase tracking-[0.2em] ${statusColor}`}>
                  {statusLabel}
                </span>
                {!isNative && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 font-mono tracking-wide">
                    GOOGLE-FREE
                  </span>
                )}
              </div>
              <button
                onClick={() => { stopListening(); onClose(); }}
                className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-all active:scale-90"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Waveform / Processing spinner */}
            <div className="py-1">
              {isProcessing ? (
                <div className="flex items-center justify-center gap-3 h-12">
                  <div className="flex items-center gap-1.5">
                    {[0,1,2].map((i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </div>
                  <span className="text-purple-300 text-xs font-medium">
                    {voice.transcript ? `"${voice.transcript}"` : 'AI işliyor…'}
                  </span>
                </div>
              ) : (
                <Waveform active={isListening} />
              )}
            </div>

            {/* Status content */}
            {isSuccess && voice.lastCommand && (
              <div className="flex flex-col items-center gap-2 py-1">
                <p className="text-emerald-400 text-base font-bold text-center">
                  {voice.lastCommand.feedback}
                </p>
                {voice.transcript && (
                  <p className="text-slate-500 text-xs">"{voice.transcript}"</p>
                )}
                <ConfidenceBar value={voice.lastCommand.confidence} />
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-3 w-full">
                <p className="text-red-400 text-sm font-medium text-center">
                  {voice.error ?? 'Komut anlaşılamadı'}
                </p>
                {voice.suggestions.length > 0 && (
                  <div className="flex flex-col w-full gap-1.5">
                    <span className="text-slate-600 text-[9px] uppercase tracking-widest">Bunu mu dediniz?</span>
                    <div className="flex flex-wrap gap-2">
                      {voice.suggestions.map((s) => (
                        <button
                          key={s.example}
                          onClick={() => handleQuickCmd(s.example)}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.1] text-slate-300 text-xs font-medium active:scale-95 transition-transform hover:bg-white/10"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isThrottled && (
              <p className="text-amber-400 text-sm font-medium text-center py-1">
                {voice.error ?? 'Çok hızlı — biraz bekleyin'}
              </p>
            )}

          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Drive Mode — minimal floating pill (no big card) ────────── */

const VoiceDrivePill = memo(function VoiceDrivePill({ onClose }: { onClose: () => void }) {
  const voice = useVoiceState();
  const isListening  = voice.status === 'listening';
  const isProcessing = voice.status === 'processing';
  const isSuccess    = voice.status === 'success';
  const isError      = voice.status === 'error';

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Buton tıklamasında startListening() önceden çağrılmış olmalı.
  // Eğer henüz başlamadıysa (durum hâlâ idle) başlat.
  useEffect(() => {
    if (voice.status !== 'listening') startListening();
    // Max 10s güvenlik — hiçbir koşulda ekranda asılı kalmaz
    const safety = setTimeout(() => { stopListening(); onCloseRef.current(); }, 10_000);
    return () => clearTimeout(safety);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // idle → hemen kapat (görünmeden önce kapansın)
  useEffect(() => {
    if (voice.status === 'idle') {
      const id = setTimeout(() => { onCloseRef.current(); }, 80);
      return () => clearTimeout(id);
    }
    if (isSuccess || isError) {
      const id = setTimeout(() => { stopListening(); onCloseRef.current(); }, 1800);
      return () => clearTimeout(id);
    }
  }, [isSuccess, isError, voice.status]);

  // idle iken hiçbir şey render etme — "Hazır" görüntüsü yok
  if (voice.status === 'idle') return null;

  const label =
    isListening  ? 'Dinliyorum…' :
    isProcessing ? 'İşleniyor…' :
    isSuccess    ? (voice.lastCommand?.feedback ?? 'Anlaşıldı') :
    isError      ? 'Anlaşılamadı' : '';

  const accent =
    isListening  ? 'rgba(96,165,250,1)'   :
    isProcessing ? 'rgba(167,139,250,1)'  :
    isSuccess    ? 'rgba(52,211,153,1)'   :
    isError      ? 'rgba(248,113,113,1)'  : 'rgba(148,163,184,1)';

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9500] flex items-center gap-2.5 py-2.5 pr-5 pl-3.5 rounded-full bg-[rgba(6,10,24,0.92)] backdrop-blur-xl"
      style={{
        border: `1px solid ${accent}44`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.55), 0 0 0 1px ${accent}22`,
      }}
      onClick={() => { stopListening(); onClose(); }}
    >
      {/* Animated mic dot */}
      <div className="relative w-8 h-8 flex-shrink-0">
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full opacity-[0.15] animate-ping" style={{ background: accent }} />
            <span className="absolute inset-1 rounded-full border opacity-40 animate-pulse" style={{ borderColor: accent }} />
          </>
        )}
        <div
          className="absolute inset-1 rounded-full flex items-center justify-center"
          style={{ background: `${accent}22`, border: `1px solid ${accent}66` }}
        >
          <Mic className="w-3.5 h-3.5" style={{ color: accent }} />
        </div>
      </div>
      <span className="text-[13px] font-semibold text-slate-200 tracking-[-0.2px] max-w-[240px] whitespace-nowrap overflow-hidden text-ellipsis">
        {label}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); stopListening(); onClose(); }}
        className="ml-1 bg-white/[0.06] border border-white/10 rounded-full w-[22px] h-[22px] flex items-center justify-center cursor-pointer text-slate-400"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
});

/* ── Public exports ─────────────────────────────────────────── */

export const VoiceAssistant = memo(function VoiceAssistant({ onClose, autoStart, minimal }: { onClose: () => void; autoStart?: boolean; minimal?: boolean }) {
  if (minimal) return <VoiceDrivePill onClose={onClose} />;
  return <VoiceOverlay onClose={onClose} autoStart={autoStart} />;
});

/* ── Ses dalgası (floating için) ────────────────────────────── */

const SoundWave = memo(function SoundWave() {
  const bars = [4, 7, 10, 6, 9, 5, 8, 4, 7];
  return (
    <div className="flex items-end gap-[2px] h-5">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[2px] rounded-full bg-blue-400"
          style={{
            height: `${h * 2}px`,
            animation: `car-pulse-subtle 600ms ease-in-out infinite`,
            animationDelay: `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
});

/* ── Floating mic button ────────────────────────────────────── */

export const FloatingMicButton = memo(function FloatingMicButton({
  isDriving = false,
}: {
  isDriving?: boolean;
}) {
  const voice   = useVoiceState();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const isListening  = voice.status === 'listening';
  const isSuccess    = voice.status === 'success';
  const isError      = voice.status === 'error';
  const isThrottled  = voice.status === 'throttled';

  const handlePress = useCallback(() => {
    if (isListening) {
      stopListening();
      setOverlayOpen(false);
      return;
    }
    setOverlayOpen(true);
    startListening();
  }, [isListening]);

  const handleClose = useCallback(() => {
    setOverlayOpen(false);
    stopListening();
  }, []);

  useEffect(() => {
    if (voice.status === 'idle' && overlayOpen && !isNative) {
      // In web mode keep overlay open until user closes it
    } else if (voice.status === 'idle' && overlayOpen && isNative) {
      const id = setTimeout(() => setOverlayOpen(false), 100);
      return () => clearTimeout(id);
    }
  }, [voice.status, overlayOpen]);

  const sizeClass = isDriving ? 'w-10 h-10' : 'w-12 h-12';
  const iconSize  = isDriving ? 'w-4 h-4'   : 'w-5 h-5';

  return (
    <>
      <button
        onClick={handlePress}
        aria-label="Sesli asistan"
        className={`
          fixed right-5 z-[62] flex items-center justify-center rounded-full
          will-change-transform transition-all duration-300 ease-out active:scale-90
          ${isDriving ? 'bottom-20' : 'bottom-24'}
          ${sizeClass}
          ${isListening
            ? 'scale-110 shadow-[0_0_20px_4px_rgba(59,130,246,0.45)]'
            : isThrottled
            ? 'scale-95 shadow-[0_0_14px_3px_rgba(245,158,11,0.35)]'
            : 'scale-95 shadow-[0_2px_10px_rgba(0,0,0,0.3)]'
          }
        `}
      >
        <div
          className={`
            absolute inset-0 rounded-full border transition-all duration-300 backdrop-blur-xl
            ${isListening
              ? 'bg-blue-500/25 border-blue-400/50'
              : isSuccess
              ? 'bg-emerald-500/15 border-emerald-400/30'
              : isError
              ? 'bg-red-500/15 border-red-400/30'
              : isThrottled
              ? 'bg-amber-500/20 border-amber-400/40'
              : 'bg-white/[0.05] border-white/[0.09] hover:bg-white/[0.1] hover:border-white/[0.16] opacity-50 hover:opacity-80'
            }
          `}
        />
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full bg-blue-500/15 animate-ping" />
            <span className="absolute inset-[-5px] rounded-full border border-blue-400/20 animate-pulse" />
          </>
        )}
        <div className="relative z-10 flex items-center justify-center">
          {isListening && !isDriving ? (
            <SoundWave />
          ) : isListening ? (
            <MicOff className={`${iconSize} text-blue-300`} />
          ) : isSuccess ? (
            <Mic className={`${iconSize} text-emerald-400`} />
          ) : isError ? (
            <MicOff className={`${iconSize} text-red-400`} />
          ) : isThrottled ? (
            <Mic className={`${iconSize} text-amber-400`} />
          ) : (
            <Mic className={`${iconSize} text-slate-500`} />
          )}
        </div>
      </button>

      {overlayOpen && <VoiceOverlay onClose={handleClose} />}
    </>
  );
});

/* ── Draggable VoiceMicButton ───────────────────────────────── */

export const VoiceMicButton = memo(function VoiceMicButton({ floating }: { floating?: boolean }) {
  const voice = useVoiceState();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const isListening  = voice.status === 'listening';
  const isSuccess    = voice.status === 'success';
  const isError      = voice.status === 'error';
  const isThrottled  = voice.status === 'throttled';

  const posRef     = useRef({ x: 12, y: Math.round(window.innerHeight / 2) - 28 });
  const [pos, setPos]      = useState(posRef.current);
  const dragRef    = useRef<{ startX: number; startY: number; btnX: number; btnY: number } | null>(null);
  const didDragRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!floating) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    dragRef.current = { startX: e.clientX, startY: e.clientY, btnX: posRef.current.x, btnY: posRef.current.y };
  }, [floating]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDragRef.current = true;
    const newX = Math.max(4, Math.min(window.innerWidth  - 60, dragRef.current.btnX + dx));
    const newY = Math.max(4, Math.min(window.innerHeight - 60, dragRef.current.btnY + dy));
    posRef.current = { x: newX, y: newY };
    setPos({ x: newX, y: newY });
  }, []);

  const handlePointerUp = useCallback(() => { dragRef.current = null; }, []);

  const handlePress = useCallback(() => {
    if (didDragRef.current) return;
    if (isListening) { stopListening(); setOverlayOpen(false); return; }
    setOverlayOpen(true);
    startListening();
  }, [isListening]);

  const handleClose = useCallback(() => { setOverlayOpen(false); stopListening(); }, []);

  useEffect(() => {
    if (voice.status === 'idle' && overlayOpen && isNative) {
      const id = setTimeout(() => setOverlayOpen(false), 100);
      return () => clearTimeout(id);
    }
  }, [voice.status, overlayOpen]);

  const btnColor = isListening
    ? 'bg-blue-500/35 border-blue-400/70 shadow-[0_0_18px_4px_rgba(59,130,246,0.35)]'
    : isSuccess
    ? 'bg-emerald-500/25 border-emerald-400/50'
    : isError
    ? 'bg-red-500/25 border-red-400/50'
    : isThrottled
    ? 'bg-amber-500/25 border-amber-400/50 shadow-[0_0_12px_3px_rgba(245,158,11,0.3)]'
    : 'bg-[#0d1628]/80 backdrop-blur-md border-white/[0.13]';

  if (floating) {
    return (
      <>
        <div
          className="fixed z-[46] touch-none select-none"
          style={{ left: pos.x, top: pos.y }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={handlePress}
        >
          <div className={`relative w-14 h-14 rounded-full flex items-center justify-center backdrop-blur-xl border-2 transition-all duration-200 cursor-grab active:cursor-grabbing ${btnColor}`}>
            <PulseRing active={isListening} />
            {isListening ? (
              <MicOff className="w-6 h-6 text-blue-300 relative z-10" />
            ) : isSuccess ? (
              <Mic className="w-6 h-6 text-emerald-300 relative z-10" />
            ) : isError ? (
              <MicOff className="w-6 h-6 text-red-300 relative z-10" />
            ) : isThrottled ? (
              <Mic className="w-6 h-6 text-amber-300 relative z-10" />
            ) : (
              <Mic className="w-6 h-6 text-slate-400 relative z-10" />
            )}
          </div>
        </div>
        {overlayOpen && <VoiceOverlay onClose={handleClose} />}
      </>
    );
  }

  return (
    <>
      <button
        onClick={handlePress}
        aria-label="Sesli asistan"
        className={`
          flex-1 h-11 flex items-center justify-center gap-2 rounded-xl
          active:scale-[0.95] transition-all duration-200 group relative border
          ${isListening
            ? 'bg-blue-500/20 border-blue-400/30'
            : isSuccess
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : isError
            ? 'bg-red-500/10 border-red-500/20'
            : isThrottled
            ? 'bg-amber-500/10 border-amber-400/25'
            : 'bg-transparent border-transparent hover:bg-white/[0.06] hover:border-white/[0.08]'
          }
        `}
      >
        <PulseRing active={isListening} />
        {isListening ? (
          <MicOff className="w-5 h-5 text-blue-400 relative z-10" />
        ) : isSuccess ? (
          <Mic className="w-5 h-5 text-emerald-400 relative z-10" />
        ) : isError ? (
          <MicOff className="w-5 h-5 text-red-400 relative z-10" />
        ) : isThrottled ? (
          <Mic className="w-5 h-5 text-amber-400 relative z-10" />
        ) : (
          <Mic className="w-5 h-5 text-slate-600 group-hover:text-slate-300 transition-colors relative z-10" />
        )}
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] hidden 2xl:block relative z-10 transition-colors ${
          isListening ? 'text-blue-400' : isSuccess ? 'text-emerald-400' : isError ? 'text-red-400' : isThrottled ? 'text-amber-400' : 'text-slate-600 group-hover:text-slate-300'
        }`}>
          Ses
        </span>
      </button>
      {overlayOpen && <VoiceOverlay onClose={handleClose} />}
    </>
  );
});
