/**
 * maviSingleVoice.test.ts — **MAVİ'NİN TEK SESİ VAR: EMEL.**
 *
 * ── ÜRÜN KARARI (2026-10-02, kullanıcı) ─────────────────────────────────────
 * "Sadece tek kadın sesi olacak asistan." Ölçülen ihlaller:
 *   · navigasyon · tehlike · güvenlik · donanım · durum sözleri (`ttsSpeak`)
 *     DOĞRUDAN cihaz motoruna gidiyordu → telefonda Mavi'den FARKLI ses,
 *     motorsuz head unit'te HİÇ ses (`TTS_NOT_READY`);
 *   · `speakAssistant` Edge düşünce Gemini TTS'e (Sulafat — İKİNCİ ses) iniyordu.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Klipte olmayan her söz önce Edge Emel'den çalar; cihaz motoru yalnız Emel
 * konuşamadığında SON ÇAREDİR; Gemini TTS zincirde YOKTUR.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
const N = vi.hoisted(() => ({
  nativeSpeak: 0,
  edgeAvailable: true,
  edgeCalls: [] as string[],
  edgeResult: null as null | ((ok: boolean) => void),
  edgeOnEnd: null as null | (() => void),
  onlineCalls: 0,
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    speak: () => { N.nativeSpeak++; return new Promise<void>(() => { /* motor konuşuyor */ }); },
    speakSegments: () => { N.nativeSpeak++; return new Promise<void>(() => { /* motor konuşuyor */ }); },
    ttsStop: () => Promise.resolve(),
  },
}));
vi.mock('../platform/voiceClips', () => ({ tryPlayClip: () => false, cancelClip: vi.fn() }));
vi.mock('../platform/onlineTtsService', () => ({
  speakOnline: async () => { N.onlineCalls++; return true; },
  isOnlineTtsAvailable: async () => true,
  cancelOnline: vi.fn(),
}));
vi.mock('../platform/edgeTtsService', () => ({
  isEdgeTtsAvailable: () => N.edgeAvailable,
  speakEdge: (text: string, onEnd?: () => void) => {
    N.edgeCalls.push(text);
    N.edgeOnEnd = onEnd ?? null;
    return new Promise<boolean>((r) => { N.edgeResult = r; });
  },
  cancelEdge: vi.fn(),
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: () => {} }),
}));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/assistant/maviLatencyTrace', () => ({ markMaviLatency: vi.fn() }));

let tts: typeof import('../platform/ttsService');
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  N.nativeSpeak = 0; N.edgeAvailable = true; N.edgeCalls = [];
  N.edgeResult = null; N.edgeOnEnd = null; N.onlineCalls = 0;
  tts = await import('../platform/ttsService');
  await vi.advanceTimersByTimeAsync(1_000);   // performance.now() 0 = "konuşmuyor" sentinel'i
});
afterEach(() => { vi.useRealTimers(); });

const NAV = '400 metre sonra sağa dönün.';

describe('🔒 Tek ses — ttsSpeak yolları (navigasyon · tehlike · güvenlik · durum)', () => {
  it('navigasyon sözü Emel\'den çalar; cihaz motoru ÇAĞRILMAZ', async () => {
    tts.speakNavigation(NAV);
    expect(N.edgeCalls).toHaveLength(1);
    expect(N.edgeCalls[0]).toMatch(/sağa dönün/);      // söz Emel'e gitti (konuşma normalizasyonu sonrası)
    N.edgeResult?.(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(N.nativeSpeak).toBe(0);
  });

  it('Emel söz bitince takip/idle bildirimi TEK kez yayınlanır', async () => {
    let ends = 0;
    tts.registerTtsEndListener(() => { ends++; });
    tts.speakNavigation(NAV);
    N.edgeResult?.(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(tts.isTtsSpeaking()).toBe(true);           // Emel hâlâ konuşuyor
    N.edgeOnEnd?.();
    expect(ends).toBe(1);
    expect(tts.isTtsSpeaking()).toBe(false);
  });

  it('Emel konuşamazsa (çevrimdışı/hata) cihaz motoru SON ÇARE — sürüş sesi sessiz kalmaz', async () => {
    tts.speakNavigation(NAV);
    N.edgeResult?.(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(N.nativeSpeak).toBe(1);
  });

  it('Emel erişilemezken (çevrimdışı) bulut hiç denenmez, doğrudan cihaz motoru', () => {
    N.edgeAvailable = false;
    tts.speakNavigation(NAV);
    expect(N.edgeCalls).toHaveLength(0);
    expect(N.nativeSpeak).toBe(1);
  });

  it('yeni söz devraldıysa ESKİ sözün yedeği çalmaz (iki ses üst üste binmez)', async () => {
    tts.speakNavigation(NAV);
    const oldResult = N.edgeResult;
    tts.ttsCancel();                                   // ör. kullanıcı dinlemeyi açtı
    oldResult?.(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(N.nativeSpeak).toBe(0);
  });
});

describe('🔒 Tek ses — speakAssistant', () => {
  it('Emel düşerse Gemini TTS (Sulafat — ikinci ses) DENENMEZ; Emel ikinci kez denenmez', async () => {
    tts.speakAssistant('Bugün hava güneşli.');
    await vi.advanceTimersByTimeAsync(0);
    expect(N.edgeCalls).toHaveLength(1);
    N.edgeResult?.(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(N.onlineCalls).toBe(0);                    // Gemini TTS zincirde YOK
    expect(N.edgeCalls).toHaveLength(1);              // yedek Emel'i tekrar denemez
    expect(N.nativeSpeak).toBe(1);                    // son çare cihaz motoru
  });
});
