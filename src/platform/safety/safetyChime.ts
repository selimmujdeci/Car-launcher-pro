/**
 * safetyChime — Safety Assistant FAZ 3B
 *
 * Web Audio API ile kısa bip sesi üretir.
 * AudioContext lazy singleton (ilk chime'da oluşturulur, yeniden kullanılır).
 * Hata durumunda sessiz no-op — crash üretmez.
 *
 * K24 uyumu: kalıcı timer/interval yok; scheduled stop kullanır.
 */

import type { SafetyLevel } from './types';
import { useStore } from '../../store/useStore';

/** Uyarı tonu tarzı — ayarlardan seçilir (Ses › Uyarı Tonları). */
export type AlertToneStyle = 'classic' | 'soft' | 'bright';

export interface ChimeNote {
  readonly freq: number;
  /** Başlangıç (s, ctx.currentTime'a göre). */
  readonly start: number;
  /** Süre (s). */
  readonly dur: number;
  readonly wave: OscillatorType;
  /** Tepe kazanç (0..1). */
  readonly gain: number;
}

/**
 * Seviye + tarz → çalınacak notalar (SAF, test edilir).
 *
 * · classic : eski davranış BİREBİR (critical 2×440 Hz · warning 1×880 Hz)
 * · soft    : daha alçak ve yumuşak (triangle), gece/konfor için
 * · bright  : daha tiz ve belirgin, gürültülü kabin için
 *
 * Güvenlik: hiçbir tarz critical'ı SESSİZ yapmaz; critical her tarzda warning'den
 * farklı (çift nota) kalır — sürücü ikisini ayırt edebilsin. `info` sessizdir.
 */
export function chimePattern(level: SafetyLevel, style: AlertToneStyle): readonly ChimeNote[] {
  if (level === 'info') return [];
  const S = style === 'soft' || style === 'bright' ? style : 'classic';
  if (S === 'soft') {
    return level === 'critical'
      ? [{ freq: 392, start: 0, dur: 0.22, wave: 'triangle', gain: 0.40 },
         { freq: 330, start: 0.26, dur: 0.26, wave: 'triangle', gain: 0.40 }]
      : [{ freq: 523, start: 0, dur: 0.20, wave: 'triangle', gain: 0.38 }];
  }
  if (S === 'bright') {
    return level === 'critical'
      ? [{ freq: 988, start: 0, dur: 0.12, wave: 'square', gain: 0.22 },
         { freq: 988, start: 0.16, dur: 0.12, wave: 'square', gain: 0.22 },
         { freq: 988, start: 0.32, dur: 0.12, wave: 'square', gain: 0.22 }]
      : [{ freq: 1319, start: 0, dur: 0.10, wave: 'square', gain: 0.20 }];
  }
  return level === 'critical'
    ? [{ freq: 440, start: 0, dur: 0.15, wave: 'sine', gain: 0.35 },
       { freq: 440, start: 0.18, dur: 0.15, wave: 'sine', gain: 0.35 }]
    : [{ freq: 880, start: 0, dur: 0.12, wave: 'sine', gain: 0.35 }];
}

function _currentStyle(): AlertToneStyle {
  try {
    return useStore.getState().settings.alertToneStyle ?? 'classic';
  } catch {
    return 'classic';
  }
}

// Modül seviyesi singleton — yeniden oluşturulmaz
let _audioCtx: AudioContext | null = null;
// Hata zaten loglandıysa tekrar loglama
let _audioErrLogged = false;

/** AudioContext'i lazy başlat; yoksa / oluşturulamazsa null döner. */
function getAudioContext(): AudioContext | null {
  if (_audioCtx && _audioCtx.state !== 'closed') return _audioCtx;
  try {
    _audioCtx = new AudioContext();
    return _audioCtx;
  } catch (e) {
    if (!_audioErrLogged) {
      console.debug('[SafetyChime] AudioContext oluşturulamadı, sessiz mod:', e);
      _audioErrLogged = true;
    }
    return null;
  }
}

/**
 * Tek bir kısa bip çalar.
 * @param ctx   - AudioContext
 * @param freq  - Frekans (Hz)
 * @param start - Başlangıç zamanı (ctx.currentTime offseti, saniye)
 * @param dur   - Süre (saniye)
 */
function playTone(ctx: AudioContext, n: ChimeNote): void {
  const { freq, start, dur } = n;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = n.wave;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

  // Yumuşak zarf: ani tık sesi önlemek için kısa fade-in/out
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(n.gain, ctx.currentTime + start + 0.01);
  gain.gain.setValueAtTime(n.gain, ctx.currentTime + start + dur - 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);

  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur);
}

/**
 * Güvenlik seviyesine göre kısa bip çalar.
 *
 * - critical : iki kısa alçak ton (~150ms, 440 Hz)
 * - warning  : tek yüksek ton (~120ms, 880 Hz)
 * - info     : ses yok
 */
export function playSafetyChime(level: SafetyLevel, style: AlertToneStyle = _currentStyle()): void {
  const notes = chimePattern(level, style);
  if (notes.length === 0) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // AudioContext kullanıcı etkileşimi olmadan askıya alınmış olabilir
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { /* sessiz */ });
    }

    for (const n of notes) playTone(ctx, n);
  } catch (e) {
    // AudioContext'e erişim/kullanım hatası — crash üretmez
    console.debug('[SafetyChime] Bip çalınamadı:', e);
  }
}
