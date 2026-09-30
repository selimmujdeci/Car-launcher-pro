/**
 * ecoScoreVoiceBypass.test.ts — "eko puanım kaç" yerel bypass (1b1e).
 *
 * Puan yalnız yerel yolculuk kaydından hesaplanır; beynin bu veriye aracı yok.
 * Kilit: net eşleşme beyne GİTMEZ, voiceInfoService'e gider. Mock düzeni
 * readMessageBypass.test.ts ile aynıdır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  diag: vi.fn(),
  answerInformational: vi.fn(),
  askAI: vi.fn(async () => null),
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult, matchDeterministicWholeInput: () => null }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(), speakAssistant: vi.fn(), speakAlert: vi.fn(),
  ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: (...a: unknown[]) => M.askAI(...a), resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: (t: string) => t === 'trip_eco_score',
  answerInformational: (...a: unknown[]) => M.answerInformational(...a),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: (...a: unknown[]) => M.diag(...a) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import { processTextCommand, _resetVoiceServiceForTest } from '../platform/voiceService';
import { slaClassOfRoute } from '../platform/devtools/maviLatencyModel';

const ECO_CMD: ParsedCommand = {
  raw: 'eko puanım kaç', type: 'trip_eco_score', feedback: 'Eko puanın hesaplanıyor',
  confidence: 1, priority: 'normal',
} as unknown as ParsedCommand;

beforeEach(() => {
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.diag.mockClear();
  M.answerInformational.mockClear();
  M.askAI.mockClear();
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  _resetVoiceServiceForTest();
});

describe('voiceService — eko puanı yerel bypass (1b1e)', () => {
  it('"eko puanım kaç" → beyne gitmeden voiceInfoService cevaplar', async () => {
    M.parseResult = { command: ECO_CMD, suggestions: [], needsSemantic: false };
    expect(await processTextCommand('eko puanım kaç')).toBe(true);
    expect(M.diag).toHaveBeenCalledWith('voice_route', { route: 'eco_score_local_bypass' });
    expect(M.answerInformational).toHaveBeenCalledWith('trip_eco_score', expect.anything(), undefined);
    expect(M.askAI).not.toHaveBeenCalled();
  });

  it('düşük güvenli eşleşme bypass EDİLMEZ (belirsiz metin yerelde kesinleşmez)', async () => {
    M.parseResult = { command: { ...ECO_CMD, confidence: 0.5 }, suggestions: [], needsSemantic: false };
    await processTextCommand('eko bir şey');
    expect(M.diag).not.toHaveBeenCalledWith('voice_route', { route: 'eco_score_local_bypass' });
  });

  it('gecikme telemetrisi bu rotayı YEREL sınıfa yazar', () => {
    expect(slaClassOfRoute('eco_score_local_bypass')).toBe('LOCAL');
  });
});
