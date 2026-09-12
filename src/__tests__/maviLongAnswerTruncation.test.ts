/**
 * maviLongAnswerTruncation.test.ts — **UZUN CEVAP YARIDA KESİLMEZ.**
 *
 * ── SAHA BELİRTİSİ ──────────────────────────────────────────────────────────
 * *"Mavi uzun cevapları yarıda kesiyor"* — ör. "Türkiye'nin 7 bölgesini
 * detaylıca anlat": cevap başlıyor, birkaç bölge anlatılıyor, sonra konuşma ve
 * tur kesiliyor.
 *
 * ── ÖLÇÜLEN KÖK NEDEN (katman 3/4) ──────────────────────────────────────────
 * Metin TTS'e TAM gidiyordu; kesen şey JS tarafındaki emniyet zamanlayıcısıydı:
 * `Math.min(30_000, 3_000 + len*110)`. Formül doğru (TR TTS ~9 karakter/sn),
 * ama düz 30 sn tavanı onu ~245 karakterden sonrası için anlamsız kılıyordu:
 * motor HÂLÂ konuşurken 30. saniyede `settle('NO_ENGINE_REPORT')` çalışıp
 * `_notifyTtsEnd()` "cevap bitti" diyor, takip dinlemesi `startListening()` →
 * `ttsCancel()` ile sesi ortasından kesiyordu. `isTtsSpeaking()` tavanı da
 * sabit 120 sn olduğu için "konuşuyorsa pencereyi uzat" korumaları çöküyordu.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Bu kilitleri ZAYIFLATMA/SİLME. Watchdog KALDIRILMADI: mutlak tavan
 * (`TTS_ABSOLUTE_CEILING_MS`) bounded'dır ve gerçek stall yine kurtarılır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
const N = vi.hoisted(() => ({
  speakCalls: 0,
  segmentCalls: [] as Array<Array<{ text: string }>>,
  resolve: null as null | (() => void),
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    speak: () => { N.speakCalls++; return new Promise<void>((r) => { N.resolve = r; }); },
    speakSegments: (a: { segments: Array<{ text: string }> }) => {
      N.speakCalls++; N.segmentCalls.push(a.segments);
      return new Promise<void>((r) => { N.resolve = r; });
    },
    ttsStop: () => Promise.resolve(),
  },
}));
vi.mock('../platform/voiceClips', () => ({ tryPlayClip: () => false, cancelClip: vi.fn() }));
vi.mock('../platform/onlineTtsService', () => ({
  speakOnline: async () => false, isOnlineTtsAvailable: () => false, cancelOnline: vi.fn(),
}));
vi.mock('../platform/edgeTtsService', () => ({
  speakEdge: async () => false, isEdgeTtsAvailable: () => false, cancelEdge: vi.fn(),
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: () => {} }),
}));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/assistant/maviLatencyTrace', () => ({ markMaviLatency: vi.fn() }));

/* Kaynaktan okunan GERÇEK sayılar — testte sabit kopya tutulmaz. */
const TTS_SRC = readFileSync(join(process.cwd(), 'src', 'platform', 'ttsService.ts'), 'utf8');
const num = (name: string): number =>
  Number(new RegExp(name + '\\s*=\\s*([\\d_]+)').exec(TTS_SRC)?.[1].replace(/_/g, ''));
const CEILING_MS = num('TTS_ABSOLUTE_CEILING_MS');
const MS_PER_CHAR = num('TTS_MS_PER_CHAR');

/** ~3200 karakter: "7 bölgeyi detaylıca anlat" ölçeğinde gerçek bir cevap. */
const LONG = ('Türkiye yedi coğrafi bölgeye ayrılır ve her bölgenin iklimi, bitki örtüsü, '
  + 'tarımsal üretimi ile ekonomik yapısı birbirinden belirgin biçimde farklıdır. ').repeat(20);
const SHORT = 'Tamam.';

let tts: typeof import('../platform/ttsService');
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  N.speakCalls = 0; N.segmentCalls = []; N.resolve = null;
  tts = await import('../platform/ttsService');
  /* `performance.now()` sahte saatte 0'dan başlar; 0 aynı zamanda "konuşmuyor"
     sentinel'idir → saati bir tık ilerlet (test artefaktı, ürün kusuru değil). */
  await vi.advanceTimersByTimeAsync(1_000);
});
afterEach(() => { vi.useRealTimers(); });

function ends(): { n: () => number } {
  let n = 0;
  tts.registerTtsEndListener(() => { n++; });
  return { n: () => n };
}

describe('Uzun cevap — TTS bitişi', () => {
  it('çapa: metin gerçekten uzun ve sabit tavanlar YETMEZ', () => {
    expect(LONG.length).toBeGreaterThan(2500);
    expect(CEILING_MS).toBeGreaterThan(120_000);
    expect(LONG.length * MS_PER_CHAR).toBeGreaterThan(120_000);
  });

  it('A · kısa cevap: motor bitirince tam olarak BİR kez "bitti" der', async () => {
    const e = ends();
    tts.ttsSpeak(SHORT);
    expect(N.speakCalls).toBe(1);
    expect(e.n()).toBe(0);
    N.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.n()).toBe(1);
    expect(tts.isTtsSpeaking()).toBe(false);
  });

  it('B/E · uzun cevap: motor konuşurken 30+ ve 120+ sn KAPANMAZ', async () => {
    const e = ends();
    tts.ttsSpeak(LONG);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(e.n(), '30 sn emniyet tavanı cevabı erken kapattı').toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(e.n(), '120 sn tavanı cevabı erken kapattı').toBe(0);
    expect(tts.isTtsSpeaking(), 'konuşma sürerken bayrak yalan söyledi').toBe(true);
    N.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.n()).toBe(1);
  });

  it('B/D · metin TTS motoruna EKSİKSİZ ve SIRAYLA gider (kırpma yok)', async () => {
    tts.ttsSpeak(LONG);
    expect(N.segmentCalls.length, 'segment yolu kullanılmadı').toBe(1);
    const segs = N.segmentCalls[0];
    expect(segs.length, 'parça zinciri (1 → 2 → 3 ...) oluşmadı').toBeGreaterThan(2);
    const joined = segs.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(joined.length, 'metin kırpıldı').toBeGreaterThan(LONG.length * 0.9);
    expect(joined).toContain('yedi coğrafi bölgeye');
    expect(joined.endsWith('farklıdır.'), 'SON parça eksik').toBe(true);
  });

  it('C · akış oturumu açıkken parça bitişi cevabı KAPATMAZ', async () => {
    const e = ends();
    tts.beginTtsSpeechSession();
    tts.ttsSpeak('Birinci parça.');
    N.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.n(), 'ilk parça bitişi cevabı kapattı').toBe(0);
    tts.ttsSpeak('İkinci parça.');
    N.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.n()).toBe(0);
    tts.endTtsSpeechSession();
    await vi.advanceTimersByTimeAsync(10);
    expect(e.n(), 'oturum kapanınca bitiş TEK kez yayınlanmalı').toBe(1);
  });

  it('F · GERÇEK stall: watchdog bounded — sonsuza kadar açık kalmaz', async () => {
    const e = ends();
    tts.ttsSpeak(LONG);
    await vi.advanceTimersByTimeAsync(CEILING_MS + 5_000);
    expect(e.n(), 'mutlak tavan sonrası kurtarma yapılmadı').toBe(1);
    expect(tts.isTtsSpeaking()).toBe(false);
  });

  it('G · kullanıcı "dur" dedi: uzun cevap ANINDA iptal, durum temiz', async () => {
    tts.ttsSpeak(LONG);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tts.isTtsSpeaking()).toBe(true);
    tts.ttsCancel();
    expect(tts.isTtsSpeaking(), 'iptalden sonra hâlâ "konuşuyor"').toBe(false);
  });

  it('H · uzun cevap kapandıktan sonra yeni söz normal başlar', async () => {
    tts.ttsSpeak(LONG);
    N.resolve?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(tts.isTtsSpeaking()).toBe(false);
    N.speakCalls = 0;
    tts.ttsSpeak(SHORT, { force: true });
    expect(N.speakCalls, 'sonraki söz başlamadı').toBe(1);
  });
});
