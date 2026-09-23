/**
 * readMessageBypass.test.ts — "Mavi, oku" (read_message) yerel bypass (1b1).
 *
 * Saha 2026-09-23 (telefon): komut beyne gidiyor, Gemini "okumaya yetkim yok"
 * diyordu — okunmamış mesajlar yalnız yerel bildirim deposunda. Kilit: net
 * eşleşme beyne GİTMEZ, voiceInfoService'e gider. Mock düzeni
 * assistantQuerySensorBypass.test.ts ile aynıdır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  diag: vi.fn(),
  querySensorImpl: vi.fn(),
  toast: vi.fn(),
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
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAssistant: vi.fn(),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
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
  isInformationalCommand: (t: string) => t === 'read_message' || t === 'reply_message',
  answerInformational: (...a: unknown[]) => M.answerInformational(...a),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: (...a: unknown[]) => M.diag(...a) }));
vi.mock('../platform/errorBus', () => ({ showToast: (...a: unknown[]) => M.toast(...a) }));
vi.mock('../platform/obd/sensorQueryService', () => ({
  querySensor: (...a: unknown[]) => M.querySensorImpl(...a),
}));

import {
  processTextCommand,
  _resetVoiceServiceForTest,
} from '../platform/voiceService';

const READ_CMD: ParsedCommand = {
  raw: 'mesajı oku', type: 'read_message', feedback: 'Mesaj okunuyor',
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

describe('voiceService — read_message yerel bypass (1b1)', () => {
  it('"mesajı oku" → beyne gitmeden voiceInfoService okur', async () => {
    M.parseResult = { command: READ_CMD, suggestions: [], needsSemantic: false };
    expect(await processTextCommand('mesajı oku')).toBe(true);
    expect(M.diag).toHaveBeenCalledWith('voice_route', { route: 'message_local_bypass' });
    expect(M.answerInformational).toHaveBeenCalledWith('read_message', expect.anything(), undefined);
    expect(M.askAI).not.toHaveBeenCalled();
  });

  it('"X diye cevap yaz" → beyne gitmeden cevap metniyle voiceInfoService', async () => {
    M.parseResult = {
      command: { ...READ_CMD, type: 'reply_message', extra: { text: 'nasılsın' } },
      suggestions: [], needsSemantic: false,
    };
    expect(await processTextCommand('mesaja nasılsın diye cevap yaz')).toBe(true);
    expect(M.answerInformational).toHaveBeenCalledWith('reply_message', expect.anything(), { text: 'nasılsın' });
    expect(M.askAI).not.toHaveBeenCalled();
  });

  it('confidence < 0.7 → bypass ALINMAZ', async () => {
    M.parseResult = { command: { ...READ_CMD, confidence: 0.5 }, suggestions: [], needsSemantic: false };
    await processTextCommand('mesajı oku');
    expect(M.diag).not.toHaveBeenCalledWith('voice_route', { route: 'message_local_bypass' });
  });
});
