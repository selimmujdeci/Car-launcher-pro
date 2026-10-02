import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipIdFor, hasClip, LISTEN_EARCON_MS, playListenEarcon } from '../platform/voiceClips';
import { VOICE_TUNING } from '../platform/voiceTuning';

/**
 * REGRESYON KİLİDİ — premium ses bankası ↔ konuşulan sabit ifade kontratı.
 *
 * K24 gibi TTS-motorsuz ünitelerde bu ifadeler ANCAK bundle'lı klipten sesli
 * çıkar. Bir SafetyRuleEngine mesajı / ttsService sabiti değişir de karşılık
 * gelen klip güncellenmezse → motorsuz ünitede O uyarı SESSİZ kalır (saha riski).
 * Bu test o sessiz kopmayı yakalar: her ifade ↔ klip id birebir kilitli.
 */
const REQUIRED: Record<string, string> = {
  // Güvenlik (SafetyRuleEngine mesajları — birebir)
  'Kapı açık, lütfen kapıyı hemen kapatın.':                'safety-door-moving',
  'El freni çekili, lütfen el frenini indirin.':            'safety-parking-brake',
  'Motor sıcaklığı yüksek, lütfen güvenli yerde durun.':    'safety-overheat',
  'Emniyet kemeri takılı değil.':                           'safety-seatbelt',
  'Kaput veya bagaj açık, lütfen durup kontrol edin.':      'safety-hood-trunk',
  'Farlar kapalı görünüyor.':                               'safety-headlights',
  'Yakıt seviyesi düşük.':                                  'safety-low-fuel',
  'Araçta bir arıza göstergesi var, kontrol önerilir.':     'safety-battery-oil',
  'Kapı açık.':                                             'safety-door-park',
  // Tehlike (mesafesiz varyant — ttsService.speakHazardAlert)
  'Dikkat! yol çalışması.':                                 'hazard-construction',
  'Dikkat! kaza.':                                          'hazard-accident',
  'Dikkat! zor hava koşulları.':                            'hazard-weather',
  'Dikkat! hız kamerası.':                                  'hazard-speedcam',
  'Dikkat! yol hasarı.':                                    'hazard-road-damage',
  'Dikkat! tünel.':                                         'hazard-tunnel',
  // Donanım / OBD (ttsService + commandExecutor canonical string)
  'Bağlantı kurulamadı. Tekrar deneyin.':                   'hw-error',
  'Araç verisi alınamıyor. OBD bağlantısını kontrol edin.': 'obd-nodata',
};

describe('voiceClips — premium ses bankası eşleştirme kilidi', () => {
  it('her sabit/kritik ifadenin klibi VAR ve id birebir doğru', () => {
    for (const [text, id] of Object.entries(REQUIRED)) {
      expect(hasClip(text), `klip eksik: "${text}"`).toBe(true);
      expect(clipIdFor(text), `yanlış klip id: "${text}"`).toBe(id);
    }
  });

  it('boşluk normalizasyonu eşleşmeyi BOZMAZ (fazla boşluk/trim)', () => {
    expect(clipIdFor('  El freni çekili,   lütfen el frenini indirin.  '))
      .toBe('safety-parking-brake');
  });

  it('bilinmeyen/serbest metin eşleşmez → null/false (TTS yedeğine düşer)', () => {
    expect(hasClip('bugün hava nasıl olacak')).toBe(false);
    expect(clipIdFor('bugün hava nasıl olacak')).toBeNull();
    // Mesafeli tehlike varyantı sabit klip DEĞİL (dinamik mesafe) → yedeğe düşmeli
    expect(hasClip('Dikkat! kaza, 300 metre ileride.')).toBe(false);
  });
});

/* ── WAV okuma + temel frekans (F0) — yalnız test yardımcısı ─────────────── */
function readWav(id: string): { sr: number; ch: number; bits: number; pcm: Int16Array } {
  const buf = readFileSync(join(process.cwd(), 'public', 'voice', `${id}.wav`));
  let off = 12; let sr = 0; let ch = 0; let bits = 0; let pcm = new Int16Array(0);
  while (off + 8 <= buf.length) {
    const tag = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (tag === 'fmt ') { ch = buf.readUInt16LE(off + 10); sr = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (tag === 'data') {
      const d = buf.subarray(off + 8, off + 8 + size);
      pcm = new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length - (d.length % 2)));
    }
    off += 8 + size + (size % 2);
  }
  return { sr, ch, bits, pcm };
}

/** Sesli çerçevelerin ortanca temel frekansı (Hz) — basit otokorelasyon (÷2 örnekleme). */
function medianF0(srIn: number, pcm: Int16Array): number {
  const sr = srIn / 2;
  const x = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < x.length; i++) x[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 65536;
  const win = Math.round(sr * 0.04); const hop = Math.round(sr * 0.02);
  const lo = Math.floor(sr / 400); const hi = Math.ceil(sr / 70);
  const f0s: number[] = [];
  for (let s = 0; s + win + hi < x.length; s += hop) {
    let c0 = 0;
    for (let i = 0; i < win; i++) c0 += x[s + i] * x[s + i];
    if (Math.sqrt(c0 / win) < 0.02) continue;           // sessizlik/nefes
    let best = 0; let bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0;
      for (let i = 0; i < win; i++) c += x[s + i] * x[s + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag && best > 0.45 * c0) f0s.push(sr / bestLag);
  }
  f0s.sort((a, b) => a - b);
  return f0s.length ? f0s[Math.floor(f0s.length / 2)] : Number.NaN;
}

describe('🔒 TEK KADIN SES — klip bankası (ürün kararı 2026-10-02)', () => {
  /* ÖLÇÜLEN İHLAL: 17 klibin 9'u eski Piper dfki ERKEK sesiydi (F0 ≈ 100 Hz,
     22 kHz); kemer uyarısı kadın, hız kamerası uyarısı erkek sesle çıkıyordu.
     Hepsi Emel ile yeniden üretildi. Erkek konuşma F0'ı ~85-155 Hz, kadın
     ~165-255 Hz → 165 Hz eşiği iki grubu net ayırır (Emel klipleri 200-270 Hz). */
  it.each(Object.values(REQUIRED))('%s — kadın sesi (F0 > 165 Hz), 24 kHz mono 16-bit (Emel)', (id) => {
    const w = readWav(id);
    expect(w.sr).toBe(24_000);
    expect(w.ch).toBe(1);
    expect(w.bits).toBe(16);
    expect(medianF0(w.sr, w.pcm)).toBeGreaterThan(165);
  });
});

describe('🔒 "Şimdi konuş" tonu (earcon)', () => {
  it('ton dosyası APK içinde: 24 kHz mono, süresi LISTEN_EARCON_MS ile aynı', () => {
    const w = readWav('earcon-listen');
    expect(w.sr).toBe(24_000);
    expect(w.ch).toBe(1);
    expect(Math.abs((w.pcm.length / w.sr) * 1000 - LISTEN_EARCON_MS)).toBeLessThan(5);
  });

  it('ton + boşluk normal warmup içinde kalır → dinleme açılışı GECİKMEZ', () => {
    expect(LISTEN_EARCON_MS + VOICE_TUNING.earconCaptureGapMs).toBeLessThanOrEqual(VOICE_TUNING.warmupMs);
    expect(VOICE_TUNING.earconCaptureGapMs).toBeGreaterThan(0);   // mikrofon tonun kuyruğunu duymasın
  });

  it('WAV çalamayan platformda 0 döner — dinleme tonu BEKLEMEZ (fail-soft)', () => {
    // jsdom HTMLMediaElement.canPlayType → '' (çalamaz).
    expect(playListenEarcon()).toBe(0);
  });

  it('çalabilen platformda tonu başlatır ve nominal süresini döner; öğe tekrar kullanılır', async () => {
    vi.resetModules();
    let created = 0; let plays = 0;
    class FakeAudio {
      preload = ''; currentTime = 5;
      constructor(public src: string) { created++; }
      canPlayType(): string { return 'maybe'; }
      play(): Promise<void> { plays++; return Promise.resolve(); }
    }
    vi.stubGlobal('Audio', FakeAudio);
    try {
      const m = await import('../platform/voiceClips');
      expect(m.playListenEarcon()).toBe(m.LISTEN_EARCON_MS);
      expect(m.playListenEarcon()).toBe(m.LISTEN_EARCON_MS);
      expect(plays).toBe(2);
      expect(created).toBe(1);                            // önceden yüklenen tek öğe
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
