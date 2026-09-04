/**
 * maviTtsSingleAnswer.test.ts — MAVI-M6 · UÇTAN UCA "TEK CEVAP" KİLİDİ.
 *
 * `maviTtsAuthority.test.ts` sözleşmeyi birim düzeyinde kilitler; bu dosya GERÇEK
 * zinciri koşturur: `processTextCommand → (beyin | yerel parser) → dispatch →
 * handler → routeIntent/dispatchIntent → TTS`. M1'de bu zincir tek komutta 2-3 ses
 * üretiyordu (#146 bulgu #3).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  spoken: [] as string[],
  brain: vi.fn(),
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({
  getConfig: () => ({ enableRecommendations: true }),
  onPerformanceModeChange: () => () => {},
}));
// TEK ölçüm noktası: ttsService'in gerçekten konuşan iki fonksiyonu.
vi.mock('../platform/ttsService', () => ({
  speakFeedback:  (t: string) => { M.spoken.push(t); },
  speakAssistant: (t: string) => { M.spoken.push(t); },
  speakAlert:     vi.fn(),
  ttsCancel:      vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => 'k-test' }));
vi.mock('../platform/aiHealth', () => ({ isAiNetHealthy: () => true, recordAiNetFailure: vi.fn(), recordAiNetSuccess: vi.fn() }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({}), enrichBackground: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({
  weatherQueryNamesCity: () => false,
  getWeatherNarrative: () => 'Hava açık, on sekiz derece',
  refreshWeather: async () => {},
  onWeatherState: () => () => {},
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => 'k-test' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionBrain: (...a: unknown[]) => M.brain(...(a as [])),
  // MAVI-F1: presence okuması (yalnız ÖLÇÜM alanı — akışı etkilemez).
  currentPresenceMode: () => 'assistant' as const,
}));

import {
  processTextCommand, registerAIResultHandler, registerCommandHandler,
  _resetVoiceServiceForTest,
} from '../platform/voiceService';
import { executeAIResult, type CommandContext } from '../platform/commandExecutor';
import { _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
import { _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import { _resetMaviVehicleContextForTest } from '../platform/assistant/maviVehicleContext';
import type { VehicleContext } from '../platform/aiVoiceService';

function cmd(type: ParsedCommand['type'], feedback: string): ParsedCommand {
  return { raw: 'komut', type, feedback, confidence: 0.95, priority: 'normal', extra: {} } as unknown as ParsedCommand;
}

const MOVING: VehicleContext = {
  speedKmh: 90, drivingMode: 'driving', isDriving: true, motionState: 'moving',
};
const STOPPED: VehicleContext = {
  speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped',
};

let _unsubs: Array<() => void> = [];

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  _resetVoiceServiceForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviVehicleContextForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.spoken = [];
  M.brain.mockReset();
  localStorage.setItem('car-launcher-storage', JSON.stringify({ state: { settings: { aiVoiceProvider: 'gemini' } } }));
});

afterEach(() => {
  for (const u of _unsubs) { try { u(); } catch { /* ignore */ } }
  _unsubs = [];
  _resetMaviSpeechForTest();
  _resetMaviTurnsForTest();
  _resetVoiceServiceForTest();
  localStorage.removeItem('car-launcher-storage');
});

/** Üretimdeki `useVoiceCommandHandler` AI köprüsünün aynısı: executeAIResult'a delege. */
function wireAiHandlerLikeProduction(vehicleCtx: VehicleContext): void {
  _unsubs.push(registerAIResultHandler((r, ctx) => {
    void executeAIResult(r as never, {
      vehicleCtx: (ctx ?? vehicleCtx) as VehicleContext,
      defaultNav: 'maps', defaultMusic: 'spotify',
      launch: vi.fn(), openDrawer: vi.fn(),
      navigateToPlace: vi.fn(),
    } as unknown as CommandContext);
  }));
}

describe('MAVI-M6 · AI eylem komutu TEK TTS üretir', () => {
  const ACTION = {
    kind: 'action' as const,
    semantic: {
      intent: 'NAVIGATE_ADDRESS', destination: 'Ankara',
      feedback: 'Ankara adresine gidiyoruz', confidence: 0.95, source: 'direct_ai',
    },
  };

  it('1. PARK halinde: dispatchIntent + beyin feedback\'i → tek ses', async () => {
    wireAiHandlerLikeProduction(STOPPED);
    M.brain.mockImplementation(async () => ACTION);
    await processTextCommand('Ankara\'ya git', STOPPED);
    expect(M.spoken).toHaveLength(1);
  });

  it('3. SÜRÜŞTE kısaltma ikinci TTS OLUŞTURMAZ (eski dedupe kaçağı kapalı)', async () => {
    wireAiHandlerLikeProduction(MOVING);
    M.brain.mockImplementation(async () => ({
      kind: 'action' as const,
      semantic: {
        intent: 'NAVIGATE_ADDRESS',
        destination: 'Atatürk Bulvarı numara yüz yirmi üç Çankaya Ankara',
        feedback: 'Atatürk Bulvarı numara yüz yirmi üç Çankaya Ankara adresine gidiyoruz',
        confidence: 0.95, source: 'direct_ai',
      },
    }));
    await processTextCommand('uzun adrese git', MOVING);
    expect(M.spoken).toHaveLength(1);
    expect(M.spoken[0].split(/\s+/).length).toBeLessThanOrEqual(8);   // ISO 15008
  });

  it('sohbet cevabı da tek ses üretir', async () => {
    M.brain.mockImplementation(async () => ({ kind: 'chat' as const, response: 'merhaba', route: 'companion_gemini' as const }));
    await processTextCommand('merhaba', STOPPED);
    expect(M.spoken).toEqual(['merhaba']);
  });
});

describe('MAVI-M6 · yerel (offline) komut TEK TTS üretir', () => {
  it('2. yerel action komutu tek ses', async () => {
    M.brain.mockImplementation(async () => null);
    M.parseResult = { command: cmd('open_music', 'Müzik açılıyor'), suggestions: [], needsSemantic: false };
    _unsubs.push(registerCommandHandler(() => { /* üretimdeki hook yerine no-op */ }));
    await processTextCommand('müziği aç', STOPPED);
    expect(M.spoken).toEqual(['Müzik açılıyor']);
  });

  it('4. M3 sonuç feedback\'i YALNIZ BİR KEZ konuşur (parser metni susturulmuş)', async () => {
    M.brain.mockImplementation(async () => null);
    M.parseResult = { command: cmd('hw_lock_doors', 'Kapılar kilitleniyor'), suggestions: [], needsSemantic: false };
    /* Üretimdeki hook gibi: sonuç zarfını otorite üzerinden söyler.
     * MAVI-M4: araç etkili intent ARTIK `routeIntent`e GİTMEZ — TEK otoriteye
     * (`executeIntent`) gider. Kilit AYNI kalır: port yokken sahte ACK YOK. */
    _unsubs.push(registerCommandHandler(async () => {
      const { executeIntent } = await import('../platform/commandExecutor');
      const { buildIntentExecutionFeedback } = await import('../platform/intentExecutionResult');
      const { speakMaviAnswer } = await import('../platform/assistant/maviSpeech');
      const r = await executeIntent({ type: 'HARDWARE_LOCK', payload: {}, priority: 'high' }, {
        vehicleCtx: STOPPED, actionConfirmed: true, defaultNav: 'maps', defaultMusic: 'spotify',
        launch: vi.fn(), openDrawer: vi.fn(),
      } as unknown as CommandContext);
      const fb = buildIntentExecutionFeedback(r);
      if (fb) speakMaviAnswer(fb.message);
    }));
    await processTextCommand('kapıları kilitle', STOPPED);
    await new Promise((r) => setTimeout(r, 0));   // handler'ın async kuyruğu

    expect(M.spoken).toHaveLength(1);
    expect(M.spoken[0]).toBe('Bu araçta kapı kilitleme bağlantısı henüz hazır değil.');
    expect(M.spoken[0]).not.toMatch(/kilitleniyor/);   // sahte ACK YOK (M3 korunur)
  });

  it('bilgi sorgusu (hava) ara bilgi + cevap ikilisini AŞMAZ', async () => {
    M.brain.mockImplementation(async () => null);
    M.parseResult = { command: cmd('show_weather', 'Hava durumu gösteriliyor'), suggestions: [], needsSemantic: false };
    _unsubs.push(registerCommandHandler(() => {}));
    await processTextCommand('hava nasıl', STOPPED);
    await new Promise((r) => setTimeout(r, 0));
    expect(M.spoken.length).toBeLessThanOrEqual(2);
    expect(M.spoken).toContain('Hava açık, on sekiz derece');
  });
});

describe('MAVI-M6 · stale tur SIFIR ses üretir', () => {
  it('5. devralınmış turun geç cevabı hiç konuşmaz', async () => {
    wireAiHandlerLikeProduction(STOPPED);
    let resolveA!: (v: unknown) => void;
    const aReached = new Promise<void>((res) => {
      M.brain
        .mockImplementationOnce(() => { res(); return new Promise((r) => { resolveA = r; }); })
        .mockImplementationOnce(async () => ({ kind: 'chat' as const, response: 'ikinci cevap', route: 'companion_gemini' as const }));
    });

    const pA = processTextCommand('Ankara\'ya git', STOPPED);
    await aReached;
    await processTextCommand('merhaba', STOPPED);
    M.spoken = [];                                   // B'nin cevabını sayma
    resolveA({
      kind: 'action',
      semantic: { intent: 'NAVIGATE_ADDRESS', destination: 'Ankara', feedback: 'gidiyoruz', confidence: 0.95, source: 'direct_ai' },
    });
    await pA;

    expect(M.spoken).toEqual([]);                    // stale tur SIFIR ses
  });
});
