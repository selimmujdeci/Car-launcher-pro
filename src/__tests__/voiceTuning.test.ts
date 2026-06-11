/**
 * voiceTuning.test.ts — araç içi ses hassasiyeti ayar sözleşmesi
 *
 * Üç katman kilitlenir:
 *  1. Config invariantları — zaman hiyerarşisi + güvenli bantlar (gürültü tavanı)
 *  2. JS akışı — opsiyonlar native'e aktarılıyor; failsafe aktif dinlemeyi
 *     KESMEDEN uzun sessizlikte kapatıyor; kısa komut transcript'i işleniyor
 *  3. Java kaynak sözleşmesi — clamp'ler ve AGC/NS/AEC varlığı
 *     (remoteLogGuards.test.ts'in SQL-dosyası deseni)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_TUNING } from '../platform/voiceTuning';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  sttOptions: null as Record<string, unknown> | null,
  sttImpl: null as (() => Promise<{ transcript: string }>) | null,
  lowEnd: false,
}));

vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => M.lowEnd }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    startSpeechRecognition: (opts: Record<string, unknown>) => {
      M.sttOptions = opts;
      return M.sttImpl ? M.sttImpl() : new Promise<never>(() => { /* asla dönmez */ });
    },
    addListener: () => Promise.resolve({ remove: async () => {} }),
  },
}));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(),
  speakAlert: vi.fn(),
  registerTtsEndListener: () => () => {},   // takip dinlemesi modül-init kaydı
}));
vi.mock('../platform/audioService', () => ({ duckMedia: vi.fn(), unduckMedia: vi.fn() }));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceContextBuilder', () => ({ buildEnrichedCtx: async (c?: unknown) => c ?? {} }));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false,
  answerInformational: vi.fn(),
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/remoteLogService', () => ({ reportCritical: vi.fn(async () => true) }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));

import {
  startListening,
  registerCommandHandler,
  _resetVoiceServiceForTest,
  _getVoiceStateForTest,
} from '../platform/voiceService';

const CMD: ParsedCommand = {
  raw: 'dur', type: 'pause_music', feedback: 'Müzik duraklatıldı',
  confidence: 1.0, priority: 'normal',
} as unknown as ParsedCommand;

beforeEach(() => {
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.sttOptions = null;
  M.sttImpl = null;
  M.lowEnd = false;
});

afterEach(() => {
  vi.useRealTimers();
  _resetVoiceServiceForTest();
});

/* ── 1. Config invariantları ─────────────────────────────────── */

describe('VOICE_TUNING invariantları', () => {
  it('kazanç güvenli bantta: eski 2.0 değerinden DÜŞÜK değil, gürültü tavanı 4.0 üstünde değil', () => {
    expect(VOICE_TUNING.nativeGainX).toBeGreaterThanOrEqual(2.0); // hassasiyet geri gitmedi
    expect(VOICE_TUNING.nativeGainX).toBeLessThanOrEqual(4.0);    // gürültü → yanlış tetikleme tavanı
  });

  it('dinleme penceresi eski 9s değerinden kısa değil, native clamp bandı (5-20s) içinde', () => {
    expect(VOICE_TUNING.maxListenMs).toBeGreaterThanOrEqual(9_000);
    expect(VOICE_TUNING.maxListenMs).toBeLessThanOrEqual(20_000);
  });

  it('zaman hiyerarşisi: warmup + pencere < JS failsafe < UI kapanışı', () => {
    // failsafe aktif dinlemeyi kesmemeli (eski bug: 10s failsafe vs 9.5s dinleme = 500ms pay)
    expect(VOICE_TUNING.listenFailsafeMs).toBeGreaterThan(
      VOICE_TUNING.warmupLowEndMs + VOICE_TUNING.maxListenMs,
    );
    // UI penceresi failsafe'den uzun yaşamalı — kullanıcı terminal durumu görebilsin
    expect(VOICE_TUNING.uiSafetyCloseMs).toBeGreaterThan(VOICE_TUNING.listenFailsafeMs);
  });

  it('takip dinleme penceresi 6-10s bandında ve zaman hiyerarşisini bozmaz', () => {
    expect(VOICE_TUNING.followUpListenMs).toBeGreaterThanOrEqual(6_000);  // çok kısa → kullanıcı yetişemez
    expect(VOICE_TUNING.followUpListenMs).toBeLessThanOrEqual(10_000);    // çok uzun → mikrofon asılı kalır
    expect(VOICE_TUNING.followUpListenMs).toBeGreaterThanOrEqual(5_000);  // native clamp alt sınırı
    expect(VOICE_TUNING.listenFailsafeMs).toBeGreaterThan(
      VOICE_TUNING.warmupLowEndMs + VOICE_TUNING.followUpListenMs,
    );
  });

  it('wake tuning: kazanç 2.0-4.0 bandında, pencere native clamp (5-20s) içinde', () => {
    expect(VOICE_TUNING.wakeGainX).toBeGreaterThanOrEqual(2.0);
    expect(VOICE_TUNING.wakeGainX).toBeLessThanOrEqual(4.0);   // gürültü tavanı
    expect(VOICE_TUNING.wakeListenMs).toBeGreaterThanOrEqual(5_000);
    expect(VOICE_TUNING.wakeListenMs).toBeLessThanOrEqual(20_000);
  });

  it('warmup değerleri makul: 0 < normal <= lowEnd <= 1000ms', () => {
    expect(VOICE_TUNING.warmupMs).toBeGreaterThan(0);
    expect(VOICE_TUNING.warmupLowEndMs).toBeGreaterThanOrEqual(VOICE_TUNING.warmupMs);
    expect(VOICE_TUNING.warmupLowEndMs).toBeLessThanOrEqual(1_000);
  });
});

/* ── 2. JS akışı ─────────────────────────────────────────────── */

describe('native opsiyon aktarımı', () => {
  it('startListening gain + maxListenMs değerlerini voiceTuning\'den native\'e geçirir', async () => {
    vi.useFakeTimers();
    startListening();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 50); // warmup bitti → doSTT

    expect(M.sttOptions).not.toBeNull();
    expect(M.sttOptions!['gain']).toBe(VOICE_TUNING.nativeGainX);
    expect(M.sttOptions!['maxListenMs']).toBe(VOICE_TUNING.maxListenMs);
    expect(M.sttOptions!['preferOffline']).toBe(true); // mevcut davranış korunur
  });

  it('takip dinlemesi (followUpWindow) KISA pencereyi native\'e geçirir', async () => {
    vi.useFakeTimers();
    startListening({ followUpWindow: true });
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 50);

    expect(M.sttOptions).not.toBeNull();
    expect(M.sttOptions!['maxListenMs']).toBe(VOICE_TUNING.followUpListenMs);
    expect(M.sttOptions!['gain']).toBe(VOICE_TUNING.nativeGainX); // kazanç aynı
  });
});

describe('uzun sessizlik — otomatik kapanış', () => {
  it('native hiç dönmezse listenFailsafeMs sonunda zorla idle (dinleme penceresi KESİLMEDEN)', async () => {
    vi.useFakeTimers();
    startListening();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 50);
    expect(_getVoiceStateForTest().status).toBe('listening');

    // Pencere içinde failsafe TETİKLENMEZ (aktif dinleme korunur)
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.maxListenMs);
    expect(_getVoiceStateForTest().status).toBe('listening');

    // Failsafe süresi dolunca zorla idle
    await vi.advanceTimersByTimeAsync(
      VOICE_TUNING.listenFailsafeMs - VOICE_TUNING.maxListenMs - VOICE_TUNING.warmupMs + 100,
    );
    expect(_getVoiceStateForTest().status).toBe('idle');
  });
});

describe('kısa komut — kesilmeden işlenir', () => {
  it('hızlı dönen kısa transcript ("dur") dispatch edilir', async () => {
    vi.useFakeTimers();
    M.sttImpl = () => Promise.resolve({ transcript: 'dur' });
    M.parseResult = { command: CMD, suggestions: [], needsSemantic: false };
    const handled: ParsedCommand[] = [];
    const unsub = registerCommandHandler((c) => handled.push(c));

    startListening();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);

    expect(handled).toHaveLength(1);
    expect(handled[0].type).toBe('pause_music');
    expect(_getVoiceStateForTest().status).toBe('success');
    unsub();
  });
});

/* ── 3. Java kaynak sözleşmesi (statik) ───────────────────────── */

describe('CarLauncherPlugin.java sözleşmesi', () => {
  const src = readFileSync(
    join(process.cwd(), 'android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'CarLauncherPlugin.java'),
    'utf-8',
  );

  it('gain clamp bandı mevcut (1.0–4.0) ve opsiyon okunuyor', () => {
    expect(src).toContain('VOSK_GAIN_MIN');
    expect(src).toContain('VOSK_GAIN_MAX');
    expect(src).toMatch(/VOSK_GAIN_MAX\s*=\s*4\.0f/);
    expect(src).toMatch(/call\.getDouble\("gain"\)/);
    expect(src).toMatch(/Math\.max\(VOSK_GAIN_MIN,\s*Math\.min\(VOSK_GAIN_MAX/);
  });

  it('maxListenMs clamp bandı mevcut (5000–20000) ve opsiyon okunuyor', () => {
    expect(src).toMatch(/VOSK_MAX_LISTEN_MIN_MS\s*=\s*5000/);
    expect(src).toMatch(/VOSK_MAX_LISTEN_MAX_MS\s*=\s*20000/);
    expect(src).toMatch(/call\.getInt\("maxListenMs"\)/);
    expect(src).toMatch(/Math\.max\(VOSK_MAX_LISTEN_MIN_MS,\s*Math\.min\(VOSK_MAX_LISTEN_MAX_MS/);
  });

  it('opsiyonsuz çağrı varsayılanları DEĞİŞMEDİ (wake word regresyonu yok)', () => {
    expect(src).toMatch(/VOSK_GAIN_DEFAULT\s*=\s*2\.0f/);
    expect(src).toMatch(/VOSK_MAX_LISTEN_MS_DEFAULT\s*=\s*9000/);
  });

  it('duckWhileListening opsiyonu okunuyor ve duck koşullu (wake pasif döngüsü müziği kısmaz)', () => {
    expect(src).toMatch(/call\.getBoolean\("duckWhileListening",\s*Boolean\.TRUE\)/);
    expect(src).toMatch(/if \(voskDuckEnabled\) duckMusicForListening\(\)/);
  });

  it('donanım efektleri (AGC + NoiseSuppressor + AEC) hâlâ etkin', () => {
    expect(src).toMatch(/AutomaticGainControl\.isAvailable\(\)/);
    expect(src).toMatch(/NoiseSuppressor\.isAvailable\(\)/);
    expect(src).toMatch(/AcousticEchoCanceler\.isAvailable\(\)/);
  });

  it('oturum değerleri thread-güvenli sabitleniyor (sessionGain/sessionMaxMs)', () => {
    expect(src).toContain('final float sessionGain  = voskGain;');
    expect(src).toContain('final long  sessionMaxMs = voskMaxListenMs;');
    expect(src).toMatch(/startedAt > sessionMaxMs/);
  });

  it('ADAPTİF kazanç: tepe-farkındalıklı limiter var (yakın mikrofon clipping fix)', () => {
    // Naif clamp dalga tepelerini kesiyordu → Vosk özel isimleri tanıyamıyordu.
    // Sözleşme: headroom sabiti + tepe ölçümü + kazancın pencere başına düşmesi.
    expect(src).toMatch(/VOSK_CLIP_HEADROOM\s*=\s*29000f/);
    expect(src).toMatch(/if \(peak > 0 && peak \* g > VOSK_CLIP_HEADROOM\)/);
    expect(src).toMatch(/Math\.max\(1\.0f,\s*VOSK_CLIP_HEADROOM \/ peak\)/);
    expect(src).toMatch(/buf\[i\] \* g\)/);                 // döngü adaptif kazancı kullanıyor
    expect(src).not.toMatch(/buf\[i\] \* sessionGain/);     // eski naif yol kalmadı
  });
});
