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
function playTone(ctx: AudioContext, freq: number, start: number, dur: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

  // Yumuşak zarf: ani tık sesi önlemek için kısa fade-in/out
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.01);
  gain.gain.setValueAtTime(0.35, ctx.currentTime + start + dur - 0.01);
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
export function playSafetyChime(level: SafetyLevel): void {
  if (level === 'info') return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // AudioContext kullanıcı etkileşimi olmadan askıya alınmış olabilir
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { /* sessiz */ });
    }

    if (level === 'critical') {
      // İki kısa alçak ton: 440 Hz × 150ms, 30ms boşluk, 440 Hz × 150ms
      playTone(ctx, 440, 0,     0.15);
      playTone(ctx, 440, 0.18,  0.15);
    } else {
      // warning: tek yüksek ton, 880 Hz × 120ms
      playTone(ctx, 880, 0, 0.12);
    }
  } catch (e) {
    // AudioContext'e erişim/kullanım hatası — crash üretmez
    console.debug('[SafetyChime] Bip çalınamadı:', e);
  }
}
