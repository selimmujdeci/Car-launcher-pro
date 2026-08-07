/**
 * maviFakeAckVoiceChain.test.ts — MAVI-M3 · SAHTE ACK'in GERÇEK ÇIKIŞ NOKTASI kilidi.
 *
 * M1 (#146, P0) kök nedeni: `voiceService.dispatch` parser'ın hazır metnini
 * (`cmd.feedback` = "Kapılar kilitleniyor" / "Arıza kayıtları siliniyor" /
 * "Araç sistemleri taranıyor") komut handler'ları ÇALIŞMADAN ÖNCE ve yürütme
 * sonucundan BAĞIMSIZ seslendiriyordu. Burada kilitlenen davranış:
 *
 *  · Davranışsal/yıkıcı komutta dispatch AŞAMASINDA HİÇ TTS ÇIKMAZ.
 *  · Düşük riskli komutlarda eski davranış BİREBİR korunur (geriye uyumluluk).
 *  · Handler'a M2'nin komut başına çözülmüş bağlamı TAŞINIR (ikinci snapshot YOK).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
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
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false,
  answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import {
  processTextCommand,
  registerCommandHandler,
  isResultAckCommand,
  _resetVoiceServiceForTest,
} from '../platform/voiceService';
import {
  setMaviVehicleSnapshotSource,
  _resetMaviVehicleContextForTest,
  type MaviVehicleSnapshot,
} from '../platform/assistant/maviVehicleContext';
import type { VehicleContext } from '../platform/aiVoiceService';

function cmd(type: ParsedCommand['type'], feedback: string): ParsedCommand {
  return { raw: 'komut', type, feedback, confidence: 1.0, priority: 'high', extra: {} } as unknown as ParsedCommand;
}

function snap(over: Partial<MaviVehicleSnapshot> = {}): MaviVehicleSnapshot {
  return {
    obdSpeedFreshKmh: null, obdConnected: true, obdLastSeenMs: Date.now() - 200,
    obdFreshWindowMs: 3_000, gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null,
    reverseSignal: false, ignition: 'unknown', ...over,
  };
}

let _unsubs: Array<() => void> = [];
function track(fn: (c: ParsedCommand, ctx?: VehicleContext) => void): void {
  _unsubs.push(registerCommandHandler(fn));
}

beforeEach(() => {
  _resetVoiceServiceForTest();
  _resetMaviVehicleContextForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  for (const u of _unsubs) { try { u(); } catch { /* ignore */ } }
  _unsubs = [];
  _resetMaviVehicleContextForTest();
  _resetVoiceServiceForTest();
});

describe('MAVI-M3 · 24. yürütmeden ÖNCE sahte ACK seslendirilmez', () => {
  const FAKE_ACKS: Array<[ParsedCommand['type'], string]> = [
    ['hw_lock_doors',       'Kapılar kilitleniyor'],
    ['hw_unlock_doors',     'Kapılar açılıyor'],
    ['vehicle_clear_dtc',   'Arıza kayıtları siliniyor'],
    ['vehicle_health_check','Araç sistemleri taranıyor'],
    ['hw_honk_horn',        'Korna çalınıyor'],
    ['hw_rear_camera',      'Arka kamera açılıyor'],
  ];

  for (const [type, feedback] of FAKE_ACKS) {
    it(`${type}: "${feedback}" dispatch aşamasında SESLENDİRİLMEZ`, async () => {
      M.parseResult = { command: cmd(type, feedback), suggestions: [], needsSemantic: false };
      let handlerRan = false;
      track(() => { handlerRan = true; });

      await processTextCommand('komut');

      expect(handlerRan).toBe(true);                       // yürütme hattı çalıştı
      const spoken = M.speak.mock.calls.map((c) => String(c[0]));
      expect(spoken).not.toContain(feedback);              // sahte ACK ÇIKMADI
      expect(isResultAckCommand(type)).toBe(true);
    });
  }

  it('düşük riskli komutta eski davranış BİREBİR korunur (parser metni konuşulur)', async () => {
    M.parseResult = { command: cmd('open_music', 'Müzik açılıyor'), suggestions: [], needsSemantic: false };
    track(() => {});
    await processTextCommand('müziği aç');
    expect(M.speak.mock.calls.map((c) => String(c[0]))).toContain('Müzik açılıyor');
    expect(isResultAckCommand('open_music')).toBe(false);
  });
});

describe('MAVI-M3 · handler M2 bağlamını alır (ikinci snapshot YOK)', () => {
  it('komutun çözülmüş VehicleContext\'i handler\'a taşınır', async () => {
    const source = vi.fn(() => snap({ obdSpeedFreshKmh: 0 }));
    setMaviVehicleSnapshotSource(source);
    M.parseResult = { command: cmd('hw_unlock_doors', 'Kapılar açılıyor'), suggestions: [], needsSemantic: false };

    let seen: VehicleContext | undefined;
    track((_c, ctx) => { seen = ctx; });
    await processTextCommand('kapıları aç');

    expect(seen?.motionState).toBe('stopped');
    expect(source).toHaveBeenCalledTimes(1);      // komut başına TEK okuma (M2 invaryantı)
  });

  it('hareket halinde bağlam handler\'a "moving" olarak taşınır', async () => {
    setMaviVehicleSnapshotSource(() => snap({ obdSpeedFreshKmh: 60 }));
    M.parseResult = { command: cmd('hw_unlock_doors', 'Kapılar açılıyor'), suggestions: [], needsSemantic: false };
    let seen: VehicleContext | undefined;
    track((_c, ctx) => { seen = ctx; });
    await processTextCommand('kapıları aç');
    expect(seen?.motionState).toBe('moving');
  });

  it('eski imzalı handler (`(cmd) => …`) hiç değişmeden çalışır', async () => {
    M.parseResult = { command: cmd('open_music', 'Müzik açılıyor'), suggestions: [], needsSemantic: false };
    const legacy = vi.fn((_c: ParsedCommand) => {});
    _unsubs.push(registerCommandHandler(legacy));
    await processTextCommand('müziği aç');
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
