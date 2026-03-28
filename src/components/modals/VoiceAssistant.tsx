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

/* ── Overlay (dinleme / geri bildirim) ─────────────────────── */

const VoiceOverlay = memo(function VoiceOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  const voice = useVoiceState();
  const [demoText, setDemoText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isListening = voice.status === 'listening';
  const isSuccess   = voice.status === 'success';
  const isError     = voice.status === 'error';

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
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={() => { stopListening(); onClose(); }}
      />

      {/* Panel */}
      <div className="relative pointer-events-auto w-full max-w-lg mx-4 bg-[#0d1628]/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
        {/* Üst parlama */}
        <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />

        <div className="p-6 flex flex-col gap-4">
          {/* Başlık + kapat */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`relative w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                isListening ? 'bg-blue-400 animate-pulse' :
                isSuccess   ? 'bg-emerald-400' :
                isError     ? 'bg-red-400' : 'bg-slate-600'
              }`} />
              <span className="text-white/70 text-xs font-bold uppercase tracking-[0.2em]">
                {isListening ? 'Dinliyorum…' :
                 isSuccess   ? 'Anlaşıldı' :
                 isError     ? 'Anlaşılamadı' : 'Sesli Asistan'}
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

/* ── Mikrofon butonu ────────────────────────────────────────── */

export const VoiceMicButton = memo(function VoiceMicButton() {
  const voice = useVoiceState();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const isListening = voice.status === 'listening';
  const isActive    = isListening || voice.status === 'success' || voice.status === 'error';

  const handlePress = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }
    setOverlayOpen(true);
    startListening();
  }, [isListening]);

  const handleClose = useCallback(() => {
    setOverlayOpen(false);
    stopListening();
  }, []);

  // Overlay'i status'a göre senkronize et
  useEffect(() => {
    if (voice.status === 'idle' && overlayOpen) {
      // success/error kapandıktan sonra overlay'i kapat
      const id = setTimeout(() => setOverlayOpen(false), 100);
      return () => clearTimeout(id);
    }
  }, [voice.status, overlayOpen]);

  return (
    <>
      <button
        onClick={handlePress}
        aria-label="Sesli asistan"
        className={`
          flex-1 h-11 flex items-center justify-center gap-2 rounded-xl
          active:scale-[0.95] transition-all duration-300 group relative
          ${isActive
            ? 'bg-blue-500/20 border border-blue-400/30'
            : 'bg-white/[0.02] hover:bg-white/[0.08]'
          }
        `}
      >
        <PulseRing active={isListening} />
        {isListening
          ? <MicOff className="w-5 h-5 text-blue-400 relative z-10" />
          : <Mic className={`w-5 h-5 transition-colors relative z-10 ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'}`} />
        }
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] hidden 2xl:block relative z-10 transition-colors ${isActive ? 'text-blue-400' : 'text-white/30 group-hover:text-blue-400'}`}>
          Ses
        </span>
      </button>

      {overlayOpen && <VoiceOverlay onClose={handleClose} />}
    </>
  );
});
