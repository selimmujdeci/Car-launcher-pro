/**
 * voiceCogPause.test.ts — sessiz processing dead-end düzeltmesi
 *
 * Kapsam:
 *  - _voiceCogPaused=true → processTextCommand 'processing'de TAKILMAZ,
 *    görünür terminal durum basar (error → 2.5s sonra idle)
 *  - _voiceCogPaused=false → mevcut dispatch akışı bozulmaz
 *  - bozuk localStorage JSON'u (car-launcher-storage) akışı öldürmez
 *  - processing failsafe: 20s sonra zorla idle
 *
 * Ağır bağımlılıklar mock (otaUpdateService.test.ts deseni) — burada yalnız
 * voiceService durum makinesi test edilir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAlert: vi.fn(),
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
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: async () => '' },
}));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));

import {
  processTextCommand,
  setVoicePaused,
  registerCommandHandler,
  _resetVoiceServiceForTest,
  _setVoiceStatusForTest,
  _getVoiceStateForTest,
} from '../platform/voiceService';

const CMD: ParsedCommand = {
  raw: 'müziği aç', type: 'play_music', feedback: 'Müzik açılıyor',
  confidence: 1.0, priority: 'normal',
} as unknown as ParsedCommand;

beforeEach(() => {
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  vi.useRealTimers();
  _resetVoiceServiceForTest();
});

describe('bilişsel pause kapısı — sessiz dead-end yok', () => {
  it('paused iken terminal durum basar: error + açıklayıcı mesaj, sonra idle', async () => {
    vi.useFakeTimers();
    setVoicePaused(true);

    // Native akış simülasyonu: STT bitti, processing basıldı, sonra işleme
    _setVoiceStatusForTest('processing');
    const ok = await processTextCommand('ışıkları aç');

    expect(ok).toBe(false);
    const s = _getVoiceStateForTest();
    expect(s.status).toBe('error');                       // 'processing'de TAKILMADI
    expect(s.error).toContain('Sürüş güvenliği');
    expect(s.transcript).toBe('ışıkları aç');

    vi.advanceTimersByTime(2600);                          // 2.5s sonra kendiliğinden idle
    expect(_getVoiceStateForTest().status).toBe('idle');
  });

  it('paused iken TTS çağrılmaz (pause modunda TTS de atlanır)', async () => {
    setVoicePaused(true);
    await processTextCommand('müziği aç');
    expect(M.speak).not.toHaveBeenCalled();
  });

  it('paused=false iken mevcut dispatch akışı aynen çalışır', async () => {
    setVoicePaused(false);
    M.parseResult = { command: CMD, suggestions: [], needsSemantic: false };
    const handled: ParsedCommand[] = [];
    const unsub = registerCommandHandler((c) => handled.push(c));

    const ok = await processTextCommand('müziği aç');

    expect(ok).toBe(true);
    expect(handled).toHaveLength(1);                       // aksiyon Intent katmanına ulaştı
    expect(handled[0].type).toBe('play_music');
    expect(_getVoiceStateForTest().status).toBe('success');
    expect(M.speak).toHaveBeenCalledWith('Müzik açılıyor');
    unsub();
  });
});

describe('bozuk localStorage JSON — fail-soft', () => {
  it('JSON.parse hatası akışı öldürmez; yerel parser sonucu işlenir', async () => {
    localStorage.setItem('car-launcher-storage', '{bozuk json%%');
    M.parseResult = { command: CMD, suggestions: [], needsSemantic: false };

    const ok = await processTextCommand('müziği aç');     // throw ETMEMELİ

    expect(ok).toBe(true);
    expect(_getVoiceStateForTest().status).toBe('success');
  });

  it('JSON.parse hatası + eşleşme yok → görünür "anlaşılamadı" hatası', async () => {
    localStorage.setItem('car-launcher-storage', '{bozuk json%%');

    const ok = await processTextCommand('asdf qwerty zxcv');

    expect(ok).toBe(false);
    const s = _getVoiceStateForTest();
    expect(s.status).toBe('error');                        // sessiz takılma yok
    expect(s.error).toContain('anlaşılamadı');
  });
});

describe('processing failsafe', () => {
  it("hiçbir geçiş olmazsa 20s sonra zorla idle'a döner", () => {
    vi.useFakeTimers();
    _setVoiceStatusForTest('processing');

    vi.advanceTimersByTime(19_000);
    expect(_getVoiceStateForTest().status).toBe('processing'); // erken tetiklenmez

    vi.advanceTimersByTime(1_100);
    expect(_getVoiceStateForTest().status).toBe('idle');       // failsafe çalıştı
  });

  it('processing terminal duruma geçtiyse failsafe ateşlenmez', () => {
    vi.useFakeTimers();
    _setVoiceStatusForTest('processing');
    _setVoiceStatusForTest('success');                     // normal akış tamamlandı

    vi.advanceTimersByTime(25_000);
    expect(_getVoiceStateForTest().status).toBe('success'); // idle'a ZORLANMADI
  });
});
