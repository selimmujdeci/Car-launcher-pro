/**
 * voiceCommandExecutionPhases.test.ts — MAVI-INSTRUMENTATION-1: Mavi komut hattı görünürlük
 * enstrümantasyonu.
 *
 * KİLİTLENEN SÖZLEŞME (ADDITIVE — mevcut komut davranışı DEĞİŞMEZ):
 *  1. planning: processTextCommand transcript kabul edince (her yönlendirme dalından ÖNCE).
 *  2. executing: seçilen action (dispatch/dispatchDriving/dispatchChain/_answerSensorQuery/
 *     AI-ACTION) gerçekten dispatch edilmeden HEMEN önce.
 *  3. execution_result: action tamamlanınca → success | failed | unsupported | cancelled
 *     (no_target sensör bypass'ına özgü — ayrı dosyada, assistantQuerySensorBypass.test.ts'te
 *     zaten dolaylı doğrulanıyor; burada yalnız enstrümantasyon katmanı hedeflenir).
 *  4. speech_end: ttsService'in TÜM yolları (native/web/klip · başarı/hata/iptal) tek noktada
 *     (registerTtsEndListener) toplanır → speech_end HER durumda kapanır.
 *  5. Çift-yürütme koruması: tek transcript → tek 'executing' / tek 'execution_result' (handler
 *     sayısından BAĞIMSIZ — emit dispatch() düzeyinde, handler döngüsü İÇİNDE DEĞİL).
 *
 * NOT (dürüstlük — kapsam sınırı): "(e) hiçbir şey eşleşmedi" (unsupported) dalı GERÇEKTE hiçbir
 * TTS çağrısı yapmaz (yalnız görsel hata + öneriler) — bu MEVCUT davranıştır, bu PR'da
 * DEĞİŞTİRİLMEDİ (kapsam: yalnız enstrümantasyon, TTS/fallback davranışı SABİT). Bu yüzden
 * 'unsupported' senaryosunda speech_start/speech_end BEKLENMEZ — gerçek koddaki sessiz-hata
 * davranışının dürüst yansımasıdır (bkz. final rapor "kalan riskler").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  diag: vi.fn(),
  ttsEndCb: null as (() => void) | null,
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
  // Gerçek ttsService'in TEK bitiş noktasını taklit eder — testte manuel tetiklenir
  // (M.ttsEndCb()) böylece speech_end'in HER durumda (başarı/hata/iptal) çalıştığı
  // yapısal olarak doğrulanır (ttsService kendisi başarı/hata ayrımı YAPMADAN aynı
  // callback'i çağırır — bkz. ttsService.ts satır 149/171/199/241/391/401/408).
  registerTtsEndListener: (cb: () => void) => { M.ttsEndCb = cb; return () => { M.ttsEndCb = null; }; },
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
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: (...a: unknown[]) => M.diag(...a) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import {
  processTextCommand,
  subscribeVoiceState,
  registerCommandHandler,
  _resetVoiceServiceForTest,
  _getVoiceStateForTest,
  type VoiceLifecycleEvent,
  type VoiceLifecyclePhase,
} from '../platform/voiceService';

const HIGH_CONF_CMD: ParsedCommand = {
  raw: 'gece moduna geç', type: 'theme_night', feedback: 'Gece moduna geçiliyor',
  confidence: 0.95, priority: 'normal', extra: {},
} as unknown as ParsedCommand;

const MID_CONF_CMD: ParsedCommand = {
  raw: 'müziği aç', type: 'open_music', feedback: 'Müzik açılıyor',
  confidence: 0.6, priority: 'normal', extra: {},
} as unknown as ParsedCommand;

function collect(): { events: VoiceLifecycleEvent[]; phases: () => VoiceLifecyclePhase[]; off: () => void } {
  const events: VoiceLifecycleEvent[] = [];
  const off = subscribeVoiceState((e) => events.push(e));
  return { events, phases: () => events.map((e) => e.phase), off };
}

/** Test başına kaydedilen commandHandler'ları İZLER — test assertion'ı FAIL olsa bile
 * afterEach'te KOŞULSUZ söker (bir sonraki teste sızan "throw eden handler" riskini keser). */
let _unregisterFns: Array<() => void> = [];
function trackedRegisterCommandHandler(fn: (cmd: ParsedCommand) => void): () => void {
  const un = registerCommandHandler(fn as never);
  _unregisterFns.push(un);
  return un;
}

beforeEach(() => {
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  M.diag.mockClear();
  // NOT: M.ttsEndCb SIFIRLANMAZ — registerTtsEndListener voiceService modülünde YALNIZ
  // BİR KEZ (import anında, modül seviyesinde) çağrılır; testler arası aynı referans
  // geçerli kalmalı (gerçek ttsService tekil-callback sözleşmesiyle birebir).
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  for (const un of _unregisterFns) { try { un(); } catch { /* ignore */ } }
  _unregisterFns = [];
  _resetVoiceServiceForTest();
});

describe('MAVI-INSTRUMENTATION-1 — 1) başarılı komut', () => {
  it('planning → executing → execution_result(success) → (TTS bitince) speech_end', async () => {
    M.parseResult = { command: HIGH_CONF_CMD, suggestions: [], needsSemantic: false };
    const unregister = trackedRegisterCommandHandler(() => { /* gerçek eylem — başarı */ });
    const c = collect();

    const ok = await processTextCommand('gece moduna geç');
    expect(ok).toBe(true);

    const phases = c.phases();
    expect(phases).toContain('planning');
    expect(phases).toContain('executing');
    expect(phases.indexOf('planning')).toBeLessThan(phases.indexOf('executing'));

    const execResult = c.events.find((e) => e.phase === 'execution_result');
    expect(execResult).toBeDefined();
    expect(execResult?.result).toBe('success');
    expect(phases.indexOf('executing')).toBeLessThan(phases.indexOf('execution_result'));

    // Gerçek TTS bitişini simüle et (ttsService'in tek noktası) — speech_end kapanmalı.
    expect(M.speak).toHaveBeenCalledWith(HIGH_CONF_CMD.feedback);
    expect(typeof M.ttsEndCb).toBe('function');
    M.ttsEndCb?.();
    expect(c.phases()).toContain('speech_end');

    unregister();
    c.off();
  });
});

describe('MAVI-INSTRUMENTATION-1 — 2) desteklenmeyen komut', () => {
  it('planning → execution_result(unsupported), executing YOK (hiçbir action dispatch edilmedi)', async () => {
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    const c = collect();

    const ok = await processTextCommand('bunu asla anlamayacaksın xyzzy');
    expect(ok).toBe(false);
    expect(_getVoiceStateForTest().status).toBe('error');

    const phases = c.phases();
    expect(phases).toContain('planning');
    expect(phases).not.toContain('executing');

    const execResult = c.events.find((e) => e.phase === 'execution_result');
    expect(execResult?.result).toBe('unsupported');

    c.off();
  });
});

describe('MAVI-INSTRUMENTATION-1 — 3) action başarısız', () => {
  it('executing → execution_result(failed) — orijinal hata YUTULMAZ (throw korunur)', async () => {
    M.parseResult = { command: HIGH_CONF_CMD, suggestions: [], needsSemantic: false };
    const unregister = trackedRegisterCommandHandler(() => { throw new Error('handler boom'); });
    const c = collect();

    await expect(processTextCommand('gece moduna geç')).rejects.toThrow('handler boom');

    const phases = c.phases();
    expect(phases).toContain('executing');
    const execResult = c.events.find((e) => e.phase === 'execution_result');
    expect(execResult?.result).toBe('failed');

    // Fail-soft kapanış: TTS bitişi yine de speech_end üretir (test 5 ile aynı garanti).
    M.ttsEndCb?.();
    expect(c.phases()).toContain('speech_end');

    unregister();
    c.off();
  });
});

describe('MAVI-INSTRUMENTATION-1 — 4) kullanıcı iptali (bekleyen komut reddi)', () => {
  it('execution_result(cancelled) — açık faz kalmaz, sonraki turlar etkilenmez', async () => {
    M.parseResult = { command: MID_CONF_CMD, suggestions: [], needsSemantic: false };
    const c = collect();

    // Orta güven (0.6) + PARK → onay sorusu, _pendingCmd kurulur.
    const asked = await processTextCommand('müziği aç');
    expect(asked).toBe(true);
    expect(_getVoiceStateForTest().status).toBe('error'); // onay sorusu ekranda

    // Kullanıcı reddeder.
    const negated = await processTextCommand('hayır');
    expect(negated).toBe(true);

    const execResult = c.events.filter((e) => e.phase === 'execution_result');
    expect(execResult.some((e) => e.result === 'cancelled')).toBe(true);
    expect(_getVoiceStateForTest().status).toBe('idle');

    c.off();
  });
});

describe('MAVI-INSTRUMENTATION-1 — 5) TTS hatası/iptali de speech_end üretir', () => {
  it('ttsService başarı/hata ayrımı yapmadan TEK noktadan bildirir — speech_end koşulsuz emit edilir', async () => {
    M.parseResult = { command: HIGH_CONF_CMD, suggestions: [], needsSemantic: false };
    const unregister = trackedRegisterCommandHandler(() => {});
    const c = collect();

    await processTextCommand('gece moduna geç');
    expect(c.phases()).not.toContain('speech_end'); // TTS henüz "bitmedi"

    // ttsService'in native/web/klip — başarı VEYA hata — hepsi AYNI callback'i çağırır.
    M.ttsEndCb?.();
    expect(c.phases()).toContain('speech_end');

    unregister();
    c.off();
  });
});

describe('MAVI-INSTRUMENTATION-1 — 6) çift yürütme koruması', () => {
  it('birden fazla commandHandler kayıtlıyken tek transcript → tek executing / tek execution_result', async () => {
    M.parseResult = { command: HIGH_CONF_CMD, suggestions: [], needsSemantic: false };
    const calls: string[] = [];
    const un1 = trackedRegisterCommandHandler(() => { calls.push('h1'); });
    const un2 = trackedRegisterCommandHandler(() => { calls.push('h2'); });
    const c = collect();

    await processTextCommand('gece moduna geç');

    expect(calls).toEqual(['h1', 'h2']); // her iki handler da çalıştı (davranış DEĞİŞMEDİ)
    const executingCount = c.phases().filter((p) => p === 'executing').length;
    const resultCount = c.phases().filter((p) => p === 'execution_result').length;
    expect(executingCount).toBe(1);
    expect(resultCount).toBe(1);

    un1(); un2();
    c.off();
  });
});
