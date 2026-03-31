/**
 * VoiceAssistant — mikrofon butonu + dinleme / geri bildirim overlay'i.
 *
 * Çalışma prensibi:
 *   - Butona basılınca voiceService.startListening() çağrılır.
 *   - Native modda Android STT (offline tercihli) devreye girer.
 *   - Web modunda text-input fallback gösterilir.
 *   - status değişimlerini useVoiceState() hook'u ile takip eder.
 */
import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { Mic, MicOff, X, Send } from 'lucide-react';
import {
  useVoiceState,
  startListening,
  stopListening,
  processTextCommand,
} from '../../platform/voiceService';
import { isNative } from '../../platform/bridge';

/* ── Animasyon ─────────────────────────────────────────────── */

const PulseRing = memo(function PulseRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
      <span className="absolute inset-[-6px] rounded-full border border-blue-400/30 animate-pulse" />
    </>
  );
});

/* ── Suggestion chip ────────────────────────────────────────── */

const SuggestionChip = memo(function SuggestionChip({
  label,
  example,
  onTap,
}: {
  label: string;
  example: string;
  onTap: (text: string) => void;
}) {
  return (
    <button
      onClick={() => onTap(example)}
      className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-slate-300 text-xs font-medium active:scale-95 transition-transform hover:bg-white/15"
    >
      {label}
    </button>
  );
});

/* ── VoiceAssistant — Main Entry Point ─────────────────────── */

export const VoiceAssistant = memo(function VoiceAssistant({ 
  onClose 
}: { 
  onClose: () => void 
}) {
  return <VoiceOverlay onClose={onClose} />;
});

/* ── Overlay (dinleme / geri bildirim) ─────────────────────── */

const VoiceOverlay = memo(function VoiceOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  const voice = useVoiceState();
  const [demoText, setDemoText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isListening  = voice.status === 'listening';
  const isSuccess    = voice.status === 'success';
  const isError      = voice.status === 'error';
  const isThrottled  = voice.status === 'throttled';

  // Overlay kapanma — success durumunda 2.5s sonra otomatik kapat
  useEffect(() => {
    if (isSuccess) {
      const id = setTimeout(onClose, 2500);
      return () => clearTimeout(id);
    }
  }, [isSuccess, onClose]);

  // Demo modunda focus
  useEffect(() => {
    if (!isNative && isListening && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isListening]);

  const handleDemoSubmit = useCallback(() => {
    const trimmed = demoText.trim();
    if (!trimmed) return;
    processTextCommand(trimmed);
    setDemoText('');
  }, [demoText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleDemoSubmit();
    if (e.key === 'Escape') { stopListening(); onClose(); }
  }, [handleDemoSubmit, onClose]);

  const handleSuggestion = useCallback((text: string) => {
    processTextCommand(text);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center pb-24 pointer-events-none"
      onClick={(e) => { if (e.target === e.currentTarget) { stopListening(); onClose(); } }}
    >
      {/* Backdrop — hafif blur, çok şeffaf */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px] pointer-events-auto"
        onClick={() => { stopListening(); onClose(); }}
      />

      {/* Panel — cam gibi şeffaf */}
      <div className="relative pointer-events-auto w-full max-w-lg mx-4 bg-black/40 backdrop-blur-2xl border border-white/[0.08] rounded-3xl shadow-2xl overflow-hidden">
        {/* Üst parlama */}
        <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />

        <div className="p-6 flex flex-col gap-4">
          {/* Başlık + kapat */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`relative w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                isListening  ? 'bg-blue-400 animate-pulse' :
                isSuccess    ? 'bg-emerald-400' :
                isError      ? 'bg-red-400' :
                isThrottled  ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
              }`} />
              <span className="text-white/70 text-xs font-bold uppercase tracking-[0.2em]">
                {isListening  ? 'Dinliyorum…' :
                 isSuccess    ? 'Anlaşıldı' :
                 isError      ? 'Anlaşılamadı' :
                 isThrottled  ? 'Çok hızlı…' : 'Sesli Asistan'}
              </span>
            </div>
            <button
              onClick={() => { stopListening(); onClose(); }}
              className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* İçerik alanı */}
          <div className="min-h-[56px] flex flex-col items-center justify-center gap-2">
            {isListening && (
              <>
                {/* Ses dalgası görseli */}
                <div className="flex items-end gap-1 h-8">
                  {[3, 6, 9, 5, 8, 4, 7, 3, 6].map((h, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-full bg-blue-400 animate-pulse"
                      style={{
                        height: `${h * 3}px`,
                        animationDelay: `${i * 80}ms`,
                        animationDuration: '600ms',
                      }}
                    />
                  ))}
                </div>
                {/* Demo modu text input */}
                {!isNative && (
                  <div className="flex w-full gap-2 mt-1">
                    <input
                      ref={inputRef}
                      value={demoText}
                      onChange={(e) => setDemoText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Komut yaz… (ör: müzik aç)"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder:text-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                    />
                    <button
                      onClick={handleDemoSubmit}
                      disabled={!demoText.trim()}
                      className="w-10 h-10 rounded-xl bg-blue-500 disabled:bg-white/5 disabled:text-slate-600 text-white flex items-center justify-center active:scale-90 transition-all"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}

            {isSuccess && (
              <div className="flex flex-col items-center gap-1.5 text-center">
                <div className="text-emerald-400 text-base font-bold">
                  {voice.lastCommand?.feedback ?? 'Komut çalıştırıldı'}
                </div>
                {voice.transcript && (
                  <div className="text-slate-500 text-xs">"{voice.transcript}"</div>
                )}
              </div>
            )}

            {isThrottled && (
              <div className="flex flex-col items-center gap-1.5 text-center">
                <div className="text-amber-400 text-sm font-medium">
                  {voice.error ?? 'Çok hızlı — biraz bekleyin'}
                </div>
                {voice.transcript && (
                  <div className="text-slate-500 text-xs">"{voice.transcript}"</div>
                )}
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-3 w-full">
                <div className="text-red-400 text-sm font-medium text-center">
                  {voice.error ?? 'Komut anlaşılamadı'}
                </div>
                {voice.suggestions.length > 0 && (
                  <div className="flex flex-col items-start w-full gap-2">
                    <span className="text-slate-600 text-[10px] uppercase tracking-wider">Şunu mu dediniz?</span>
                    <div className="flex flex-wrap gap-2">
                      {voice.suggestions.map((s) => (
                        <SuggestionChip
                          key={s.example}
                          label={s.label}
                          example={s.example}
                          onTap={handleSuggestion}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Örnek komutlar — idle/listening durumda */}
          {(isListening) && isNative && (
            <div className="flex flex-wrap gap-2 justify-center pt-1">
              {['Eve git', 'Müzik aç', 'Haritayı aç', 'Bakım ne zaman'].map((cmd) => (
                <SuggestionChip
                  key={cmd}
                  label={cmd}
                  example={cmd.toLowerCase()}
                  onTap={handleSuggestion}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ── Ses dalgası animasyonu (floating için) ─────────────────── */

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

/* ── Sabit (floating) mikrofon butonu ──────────────────────── */

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
    if (voice.status === 'idle' && overlayOpen) {
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
          transition-all duration-300 ease-out active:scale-90
          ${isDriving ? 'bottom-20' : 'bottom-24'}
          ${sizeClass}
          ${isListening
            ? 'scale-110 shadow-[0_0_20px_4px_rgba(59,130,246,0.45)]'
            : isThrottled
            ? 'scale-95 shadow-[0_0_14px_3px_rgba(245,158,11,0.35)]'
            : 'scale-95 shadow-[0_2px_10px_rgba(0,0,0,0.3)]'
          }
        `}
        style={{ willChange: 'transform' }}
      >
        {/* Arka plan — yalnızca dinleme durumuna göre değişir */}
        <div
          className={`
            absolute inset-0 rounded-full border transition-all duration-300 backdrop-blur-xl
            ${isListening
              ? 'bg-blue-500/25 border-blue-400/50 opacity-100'
              : isSuccess
              ? 'bg-emerald-500/15 border-emerald-400/30 opacity-100'
              : isError
              ? 'bg-red-500/15 border-red-400/30 opacity-100'
              : isThrottled
              ? 'bg-amber-500/20 border-amber-400/40 opacity-100'
              : 'bg-white/[0.05] border-white/[0.09] hover:bg-white/[0.1] hover:border-white/[0.16] opacity-50 hover:opacity-80'
            }
          `}
        />

        {/* Animasyon halkaları — SADECE aktif dinleme sırasında */}
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full bg-blue-500/15 animate-ping" />
            <span className="absolute inset-[-5px] rounded-full border border-blue-400/20 animate-pulse" />
          </>
        )}

        {/* İçerik */}
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

/* ── Draggable Floating Mic Button ─────────────────────────── */

export const VoiceMicButton = memo(function VoiceMicButton({ floating }: { floating?: boolean }) {
  const voice = useVoiceState();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const isListening  = voice.status === 'listening';
  const isSuccess    = voice.status === 'success';
  const isError      = voice.status === 'error';
  const isThrottled  = voice.status === 'throttled';

  // Sürükleme state'i
  const posRef      = useRef({ x: 12, y: Math.round(window.innerHeight / 2) - 28 });
  const [pos, setPos]       = useState(posRef.current);
  const dragRef     = useRef<{ startX: number; startY: number; btnX: number; btnY: number } | null>(null);
  const didDragRef  = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!floating) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      btnX: posRef.current.x,
      btnY: posRef.current.y,
    };
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

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handlePress = useCallback(() => {
    if (didDragRef.current) return; // sürüklediyse tıklamayı iptal et
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
    if (voice.status === 'idle' && overlayOpen) {
      const id = setTimeout(() => setOverlayOpen(false), 100);
      return () => clearTimeout(id);
    }
  }, [voice.status, overlayOpen]);

  /* ── Floating: sürüklenebilir yuvarlak buton ── */
  if (floating) {
    const btnColor = isListening
      ? 'bg-blue-500/35 border-blue-400/70 shadow-[0_0_18px_4px_rgba(59,130,246,0.35)]'
      : isSuccess
      ? 'bg-emerald-500/25 border-emerald-400/50'
      : isError
      ? 'bg-red-500/25 border-red-400/50'
      : isThrottled
      ? 'bg-amber-500/25 border-amber-400/50 shadow-[0_0_12px_3px_rgba(245,158,11,0.3)]'
      : 'bg-black/50 border-white/[0.13]';

    return (
      <>
        <div
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 46, touchAction: 'none', userSelect: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={handlePress}
        >
          <div
            className={`relative w-14 h-14 rounded-full flex items-center justify-center
              backdrop-blur-xl border-2 transition-all duration-200 cursor-grab active:cursor-grabbing
              ${btnColor}
            `}
          >
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
              <Mic className="w-6 h-6 text-white/50 relative z-10" />
            )}
          </div>
        </div>

        {overlayOpen && <VoiceOverlay onClose={handleClose} />}
      </>
    );
  }

  /* ── Dock mod: yatay bar içindeki kompakt buton ── */
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

        <span className={`
          text-[10px] font-black uppercase tracking-[0.2em] hidden 2xl:block relative z-10 transition-colors
          ${isListening ? 'text-blue-400' : isSuccess ? 'text-emerald-400' : isError ? 'text-red-400' : isThrottled ? 'text-amber-400' : 'text-white/25 group-hover:text-slate-300'}
        `}>
          Ses
        </span>
      </button>

      {overlayOpen && <VoiceOverlay onClose={handleClose} />}
    </>
  );
});
