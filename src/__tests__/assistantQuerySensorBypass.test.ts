/**
 * assistantQuerySensorBypass.test.ts — V1: QUERY_SENSOR yerel bypass
 * (voiceService, hava durumu bypass'ıyla [1b] AYNI desen)
 *
 * commandParser ve sensorQueryService MOCK'lanır — bu yüzden pür parser
 * testlerinden (assistantQuerySensor.test.ts) AYRI dosyada tutulur (vi.mock
 * modül-kapsamlı hoisting yapar; aynı dosyada gerçek implementasyonla çakışır).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';
import type { SensorAnswer } from '../platform/obd/sensorQueryService';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  diag: vi.fn(),
  querySensorImpl: vi.fn(),
  toast: vi.fn(),
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
  speakAssistant: vi.fn(),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
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
  _getVoiceStateForTest,
} from '../platform/voiceService';

const QUERY_CMD: ParsedCommand = {
  raw: 'yağ sıcaklığı kaç', type: 'query_sensor', feedback: 'Sensör verisine bakılıyor',
  confidence: 0.82, priority: 'normal', extra: { sensorQuery: 'yağ sıcaklığı kaç' },
} as unknown as ParsedCommand;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  M.diag.mockClear();
  M.querySensorImpl.mockReset();
  M.toast.mockClear();
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  _resetVoiceServiceForTest();
});

describe('voiceService — QUERY_SENSOR yerel bypass (1b2)', () => {
  it('değer var → beyne gitmeden "Bakıyorum..." ack + gerçek cevap seslendirilir', async () => {
    M.parseResult = { command: QUERY_CMD, suggestions: [], needsSemantic: false };
    const answer: SensorAnswer = {
      name: 'Motor yağı sıcaklığı', value: 92, unit: '°C',
      text: 'Motor yağı sıcaklığı 92 derece.', source: 'extended', pid: '5C',
    };
    M.querySensorImpl.mockResolvedValueOnce(answer);

    const ok = await processTextCommand('yağ sıcaklığı kaç');
    expect(ok).toBe(true);
    // route 'sensor_local_bypass' — beyne HİÇ gidilmedi
    expect(M.diag).toHaveBeenCalledWith('voice_route', { route: 'sensor_local_bypass' });

    await flush();
    expect(M.querySensorImpl).toHaveBeenCalledWith('yağ sıcaklığı kaç');
    expect(M.speak).toHaveBeenCalledWith('Bakıyorum...');
    expect(M.speak).toHaveBeenCalledWith(answer.text);
    expect(_getVoiceStateForTest().status).toBe('success');
  });

  it('null (okunamıyor) → dürüst cevap, sahte değer YOK', async () => {
    M.parseResult = { command: QUERY_CMD, suggestions: [], needsSemantic: false };
    M.querySensorImpl.mockResolvedValueOnce(null);

    await processTextCommand('yağ sıcaklığı kaç');
    await flush();

    expect(M.speak).toHaveBeenCalledWith('Bu sensörü tanımıyorum.');
    expect(_getVoiceStateForTest().status).toBe('error');
  });

  it('uzun metin (VIN gibi >20 karakter) → TTS\'te OKUNMAZ, ekrana (toast) yönlendirilir', async () => {
    M.parseResult = { command: QUERY_CMD, suggestions: [], needsSemantic: false };
    const vin = 'WVWZZZ1JZXW0000012345';
    const answer: SensorAnswer = {
      name: 'Şasi numarası', value: vin, unit: '',
      text: `Şasi numarası: ${vin}.`, source: 'manufacturer', pid: 'F190',
    };
    M.querySensorImpl.mockResolvedValueOnce(answer);

    await processTextCommand('şasi numarası nedir');
    await flush();

    // Uzun VIN metni TTS ile OKUNMADI — yalnız kısa yönlendirme cümlesi söylendi.
    expect(M.speak).not.toHaveBeenCalledWith(answer.text);
    expect(M.speak).toHaveBeenCalledWith('Şasi numarası ekranda gösteriliyor.');
    expect(M.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Şasi numarası', message: vin }),
    );
  });

  it('confidence < 0.7 → bypass ALINMAZ (route sensor_local_bypass tetiklenmez)', async () => {
    M.parseResult = {
      command: { ...QUERY_CMD, confidence: 0.5 },
      suggestions: [], needsSemantic: false,
    };
    await processTextCommand('yağ sıcaklığı kaç');
    const calledRoutes = M.diag.mock.calls
      .filter((c) => c[0] === 'voice_route')
      .map((c) => (c[1] as { route?: string })?.route);
    expect(calledRoutes).not.toContain('sensor_local_bypass');
    expect(M.querySensorImpl).not.toHaveBeenCalled();
  });
});
