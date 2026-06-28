import { describe, it, expect } from 'vitest';
import { pcmBase64ToWavBytes, rateFromMime } from '../platform/onlineTtsService';

/**
 * REGRESYON KİLİDİ — online TTS (Gemini) yanıtının PCM→WAV sarmalaması.
 * Gemini TTS base64 PCM döner; HTMLAudioElement'in çalabilmesi için 44-byte WAV
 * header'ı BYTE-DOĞRU olmalı. Header offset'i kayarsa asistan sesi sessiz/cızırtı
 * olur (motorsuz ünitede asistanın TEK sesi bu) → bu test o kaymayı yakalar.
 */
describe('onlineTtsService — WAV header + mime parse', () => {
  it('rateFromMime: örnekleme hızını çıkarır, yoksa 24000 varsayar', () => {
    expect(rateFromMime('audio/L16;codec=pcm;rate=24000')).toBe(24000);
    expect(rateFromMime('audio/L16;rate=16000')).toBe(16000);
    expect(rateFromMime(undefined)).toBe(24000);
    expect(rateFromMime('audio/L16')).toBe(24000);
  });

  it('pcmBase64ToWavBytes: geçerli 44-byte WAV header + PCM verisi korunur', () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04]); // 2 sample, 16-bit mono
    const b64 = btoa(String.fromCharCode(...pcm));
    const wav = pcmBase64ToWavBytes(b64, 24000);
    const dv  = new DataView(wav.buffer);
    const str = (o: number, n: number) => String.fromCharCode(...Array.from(wav.slice(o, o + n)));

    expect(wav.length).toBe(44 + 4);
    expect(str(0, 4)).toBe('RIFF');
    expect(dv.getUint32(4, true)).toBe(36 + 4);
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(dv.getUint16(20, true)).toBe(1);      // format = PCM
    expect(dv.getUint16(22, true)).toBe(1);      // mono
    expect(dv.getUint32(24, true)).toBe(24000);  // sample rate
    expect(dv.getUint32(28, true)).toBe(48000);  // byte rate = rate * 2 (mono 16-bit)
    expect(dv.getUint16(32, true)).toBe(2);      // block align
    expect(dv.getUint16(34, true)).toBe(16);     // bits/sample
    expect(str(36, 4)).toBe('data');
    expect(dv.getUint32(40, true)).toBe(4);      // data chunk length
    expect(Array.from(wav.slice(44))).toEqual([1, 2, 3, 4]); // PCM payload aynen
  });
});
