/**
 * maviWakeReArmAfterTurn.test.ts — **HER TUR SONUNDA WAKE YENİDEN KURULUR.**
 *
 * ── SAHA BELİRTİSİ ──────────────────────────────────────────────────────────
 * *"Mavi 'Hey Mavi' ile uyanıyor; ama bir komut/işlem tamamlandıktan sonra çoğu
 * zaman bir daha uyanmıyor — bazen çalışıyor, bazen çalışmıyor."*
 *
 * ── ÖLÇÜLEN KÖK NEDEN ───────────────────────────────────────────────────────
 * Wake kapısı (`wakeWordService.onWakeWordDetected`) YALNIZ `status === 'idle'`
 * ve takip döngüsü kapalıyken oturum açar. `push()` funnel'ında 'processing' ve
 * 'listening' için bekçi VARDI; terminal gösterim durumları ('success'/'error')
 * idle'a yalnız çağrı yerlerindeki tek tek `setTimeout`larla dönüyordu.
 * `dispatch()` içinde o zamanlayıcı, handler döngüsünün `catch → throw`undan
 * SONRA kuruluyordu → kayıtlı komut handler'larından biri fırlattığında HİÇ
 * kurulmuyor ve durum KALICI olarak 'success' kalıyordu. O andan sonra her
 * "Hey Mavi" tetiği `SUPPRESSED_VOICE_ACTIVE` ile düşüyor: asistan sağır.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Bu kilitleri ZAYIFLATMA/SİLME. "Wake-ready" = `status === 'idle'` VE takip
 * döngüsü kapalı — wake kapısının OKUDUĞU iki gerçek (CLAUDE.md §6 tek otorite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedCommand } from '../platform/commandParser';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  ttsSpeaking: false,
  /** Kökün TEK TTS-bitiş aboneliği — gerçek zincirle E/F senaryosu sürülür. */
  ttsEnd: null as null | (() => void),
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
  speakAssistant: vi.fn(), speakAlert: vi.fn(), ttsCancel: vi.fn(),
  registerTtsEndListener: (fn: () => void) => { M.ttsEnd = fn; return () => {}; },
  isTtsSpeaking: () => M.ttsSpeaking,
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false, answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import {
  beginConversationSession, armFollowUp, isFollowUpEngaged, armConvIdleOnTtsEnd,
} from '../platform/voice/voiceConversationRuntime';
import {
  processTextCommand, registerCommandHandler,
  _resetVoiceServiceForTest, _getVoiceStateForTest, _setVoiceStatusForTest,
  isVoiceFollowUpEngaged,
} from '../platform/voiceService';

/* Kaynaktan okunan GERÇEK süre — testte sabit kopya tutulmaz. */
const TERMINAL_FAILSAFE_MS = Number(
  /TERMINAL_FAILSAFE_MS\s*=\s*([\d_]+)/
    .exec(readFileSync(join(process.cwd(), 'src', 'platform', 'voiceService.ts'), 'utf8'))?.[1]
    .replace(/_/g, ''),
);

function cmd(type: string, feedback: string): ParsedCommand {
  return { raw: 'komut', type, feedback, confidence: 1.0, priority: 'high', extra: {} } as unknown as ParsedCommand;
}

let _unsubs: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  _resetVoiceServiceForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.ttsSpeaking = false;
  M.speak.mockClear();
});
afterEach(() => {
  for (const u of _unsubs) { try { u(); } catch { /* ignore */ } }
  _unsubs = [];
  _resetVoiceServiceForTest();
  vi.useRealTimers();
});

/** Wake kapısının okuduğu iki gerçek — üçüncü bir kopya TUTULMAZ. */
function wakeReady(): boolean {
  return _getVoiceStateForTest().status === 'idle' && !isVoiceFollowUpEngaged();
}

describe('Wake yeniden kurulumu — voiceService turu', () => {
  it('A · başarılı komut turundan sonra idle döner', async () => {
    M.parseResult = { command: cmd('nav_home', 'Eve gidiliyor'), suggestions: [], needsSemantic: false };
    _unsubs.push(registerCommandHandler(() => { /* ok */ }));
    await processTextCommand('eve git');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(_getVoiceStateForTest().status).toBe('idle');
    expect(isVoiceFollowUpEngaged()).toBe(false);
  });

  it('C · intent success sonrası wake-ready', async () => {
    M.parseResult = { command: cmd('nav_home', 'Eve gidiliyor'), suggestions: [], needsSemantic: false };
    let ran = false;
    _unsubs.push(registerCommandHandler(() => { ran = true; }));
    await processTextCommand('eve git');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ran).toBe(true);
    expect(wakeReady()).toBe(true);
  });

  it('D · handler FIRLATSA BİLE (intent error) tur wake-ready biter', async () => {
    /* SAHA KÖK NEDENİ: reset zamanlayıcısı `throw`dan sonra kuruluyordu →
       hiç kurulmuyordu. Bu kilit düşerse "komuttan sonra uyanmıyor" GERİ GELİR. */
    M.parseResult = { command: cmd('nav_home', 'Eve gidiliyor'), suggestions: [], needsSemantic: false };
    _unsubs.push(registerCommandHandler(() => { throw new Error('handler patladı'); }));
    try { await processTextCommand('eve git'); } catch { /* üretimde de fırlar */ }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(wakeReady()).toBe(true);
  });

  it('B · arka arkaya 5 tur — her turdan sonra yeniden wake-ready', async () => {
    /* 3. tur bilerek FIRLATIR: tek bozuk tur zinciri sağırlaştırmamalı. */
    for (let i = 1; i <= 5; i++) {
      M.parseResult = { command: cmd('nav_home', `tur ${i}`), suggestions: [], needsSemantic: false };
      const off = registerCommandHandler(() => { if (i === 3) throw new Error('tur 3 patladı'); });
      try { await processTextCommand(`komut ${i}`); } catch { /* tur 3 */ }
      off();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(wakeReady(), `tur ${i} sonrası wake-ready DEĞİL`).toBe(true);
    }
  });

  it('G · terminal durumda takılan tur bekçiyle idle döner (timeout yolu)', async () => {
    /* Zamanlayıcısı HİÇ kurulmayan bir terminal push (ör. çok-komut onay reddi)
       simülasyonu: bekçi olmasaydı durum SONSUZA KADAR terminal kalırdı. */
    _setVoiceStatusForTest('error');
    await vi.advanceTimersByTimeAsync(TERMINAL_FAILSAFE_MS + 1_000);
    expect(wakeReady()).toBe(true);
  });

  it('bekçi GERÇEK cevabı yarıda kesmez — konuşma sürerken pencere uzar', async () => {
    M.ttsSpeaking = true;
    _setVoiceStatusForTest('success');
    await vi.advanceTimersByTimeAsync(TERMINAL_FAILSAFE_MS + 10_000);
    expect(_getVoiceStateForTest().status).toBe('success');   // konuşma sürüyor → kesilmedi
    M.ttsSpeaking = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wakeReady()).toBe(true);                            // konuşma bitti → wake geri geldi
  });
});


/* ══════════════════════════════════════════════════════════════════════════
 * E/F · TTS BİTİŞİ VE TAKİP DÖNGÜSÜ — kökün GERÇEK port bağlaması kullanılır
 *        (portlar override EDİLMEZ; abonelik `registerTtsEndListener` mock'undan
 *        yakalanır → tek TTS-bitiş yolu sınanır).
 * ════════════════════════════════════════════════════════════════════════ */

describe('Wake yeniden kurulumu — TTS bitişi ve takip döngüsü', () => {
  it('E · takipsiz cevap: TTS bitince idle → wake-ready', async () => {
    _setVoiceStatusForTest('success');
    beginConversationSession();
    armConvIdleOnTtsEnd();          // takip YOK → bitişte idle (kökün sözleşmesi)
    expect(M.ttsEnd).toBeTypeOf('function');
    M.ttsEnd?.();                   // TTS bitti
    await vi.advanceTimersByTimeAsync(1_000);
    expect(wakeReady()).toBe(true);
  });

  it('F · takip KULLANILAN akış: döngü tüketilince wake yeniden mümkün', async () => {
    _setVoiceStatusForTest('success');
    beginConversationSession();
    armFollowUp();
    expect(isFollowUpEngaged()).toBe(true);   // döngü canlıyken wake BİLİNÇLİ bastırılır
    M.ttsEnd?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isFollowUpEngaged()).toBe(false);  // döngü tüketildi → kapı yeniden açık
  });

  it('F · takip KULLANILMAYAN akış: döngü hiç kurulmaz, kapı hep açık', async () => {
    _setVoiceStatusForTest('success');
    beginConversationSession();
    M.ttsEnd?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isFollowUpEngaged()).toBe(false);
    expect(wakeReady()).toBe(true);
  });
});
