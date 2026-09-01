/**
 * maviConfirmationFlow.test.ts — MAVI-M4 · AÇIK ONAY AKIŞI (uçtan uca).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M4 envanteri KANITLADI: onay akışı ÖLÜ UÇTU. `needs_confirmation` sonucu
 * `setPendingAction` ile saklanıyor, `setConfirmedActionExecutor` kaydediliyordu —
 * ama "evet"i TÜKETEN kod HİÇ YOKTU (`consumePendingAction` ve
 * `getConfirmedActionExecutor` üretimde HİÇBİR YERDEN çağrılmıyordu). Sonuç:
 * onay gerektiren eylemler (telefon araması · DTC silme) yürütülmesi İMKÂNSIZDI.
 *
 * Bu dosya birim testlerinin göremediği ŞEYİ ölçer: gerçek zincirin BAĞLI olduğunu
 *   `processTextCommand("Selim'i ara")` → needs_confirmation → bekleyen onay
 *   `processTextCommand("evet")`       → TEK otorite → bridge.callNumber (BİR KEZ)
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
  callNumber: vi.fn(),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
  dtcState: {
    codes: [{ severity: 'warning', description: 'Lambda sensörü' }],
    isReading: false, isClearing: false, lastReadAt: 1, error: null as string | null, isStale: false,
  },
}));

vi.mock('../platform/bridge', () => ({
  isNative: false,
  bridge: {
    callNumber: (...a: unknown[]) => M.callNumber(...(a as [])),
    launchMusicSearch: vi.fn(), launchMusicQuery: vi.fn(),
    hwLockDoors: vi.fn(), hwUnlockDoors: vi.fn(),
    hwHonkHorn: vi.fn(), hwFlashLights: vi.fn(), hwAlarmOn: vi.fn(), hwAlarmOff: vi.fn(),
  },
}));
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
vi.mock('../platform/ttsService', () => ({
  speakFeedback:  (t: string) => { M.spoken.push(t); },
  speakAssistant: (t: string) => { M.spoken.push(t); },
  speakAlert:     vi.fn(),
  ttsCancel:      vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/audioService', () => ({ duckMedia: vi.fn(), unduckMedia: vi.fn() }));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/aiHealth', () => ({
  isAiNetHealthy: () => false, recordAiNetFailure: vi.fn(), recordAiNetSuccess: vi.fn(),
}));
vi.mock('../platform/ai/semanticAiService', () => ({ classifySemantic: async () => ({}), enrichBackground: vi.fn() }));
vi.mock('../platform/weatherService', () => ({
  weatherQueryNamesCity: () => false, getWeatherNarrative: () => 'Hava açık',
  refreshWeather: async () => {}, onWeatherState: () => () => {},
}));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionBrain: async () => null,
  // MAVI-F1: presence okuması (yalnız ÖLÇÜM alanı — akışı etkilemez).
  currentPresenceMode: () => 'assistant' as const,
}));
vi.mock('../platform/contactsService', () => ({
  searchContacts: () => [{ id: 'k1', name: 'Selim', phones: [{ label: 'mobile', number: '+905551112233' }] }],
  recordCall: vi.fn(),
}));
vi.mock('../platform/dtcService', () => ({
  // P0-OBD-10: silme envanteri (stored + pending). Testte kod VAR sayılır.
  getClearableDtcSnapshot: () => ({ codes: [], count: M.dtcState.codes.length, scanRan: true }),
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: (...a: unknown[]) => M.clearDTCCodes(...(a as [])),
  onDTCState: (cb: (s: unknown) => void) => { cb(M.dtcState); return () => {}; },
}));

import {
  processTextCommand, registerCommandHandler, _resetVoiceServiceForTest,
} from '../platform/voiceService';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import {
  setPendingAction, setConfirmedActionExecutor, peekPendingAction,
  _resetPendingActionForTest,
} from '../platform/action/pendingActionConfirmation';
import {
  isVehicleEffectiveIntent, getVehicleActionDef,
} from '../platform/action/maviActionAuthority';
import { buildIntentExecutionFeedback } from '../platform/intentExecutionResult';
import { _resetMaviTurnsForTest, getActiveMaviTurn } from '../platform/assistant/maviTurn';
import { _resetMaviSpeechForTest, speakMaviAnswer } from '../platform/assistant/maviSpeech';
import { _resetMaviVehicleContextForTest } from '../platform/assistant/maviVehicleContext';
import { toIntent } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';

const STOPPED: VehicleContext = {
  speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped',
} as unknown as VehicleContext;

function cmd(type: ParsedCommand['type'], feedback: string, extra: Record<string, unknown> = {}): ParsedCommand {
  return { raw: 'komut', type, feedback, confidence: 0.95, priority: 'normal', extra } as unknown as ParsedCommand;
}

let _unsubs: Array<() => void> = [];

/**
 * ÜRETİMDEKİ `useVoiceCommandHandler` akışının birebir aynısı (M4 dalları):
 * araç etkili intent → TEK otorite → `needs_confirmation` ise bekleyen onay kaydı;
 * ayrıca onaylı yürütücüyü kaydeder.
 */
function wireProductionHandlers(): void {
  const baseCtx = (confirmed: boolean): CommandContext => ({
    vehicleCtx: STOPPED, defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(), actionConfirmed: confirmed,
  } as unknown as CommandContext);

  _unsubs.push(registerCommandHandler((c) => {
    const intent = toIntent(c, { defaultNav: 'maps', defaultMusic: 'spotify' });
    if (!isVehicleEffectiveIntent(intent.type)) return;
    void executeIntent(intent, baseCtx(false)).then((result) => {
      if (result.status === 'needs_confirmation') {
        const def = getVehicleActionDef(intent.type);
        const t = getActiveMaviTurn();
        if (def && t) setPendingAction({ intent, actionId: def.actionId, turnId: t.id, atMs: Date.now() });
      }
      const fb = buildIntentExecutionFeedback(result);
      if (fb) speakMaviAnswer(fb.message);
    });
  }));

  setConfirmedActionExecutor((intent) => {
    void executeIntent(intent, baseCtx(true)).then((result) => {
      const fb = buildIntentExecutionFeedback(result);
      if (fb) speakMaviAnswer(fb.message);
    });
  });
}

/** Mikro görev kuyruğunu boşalt (handler'lar fire-and-forget async). */
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  _resetVoiceServiceForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviVehicleContextForTest();
  _resetPendingActionForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.spoken = [];
  M.callNumber.mockReset();
  M.clearDTCCodes.mockReset().mockImplementation(async () => ({ allowed: true, userMessage: '' }));
  wireProductionHandlers();
});

afterEach(() => {
  for (const u of _unsubs) { try { u(); } catch { /* ignore */ } }
  _unsubs = [];
  setConfirmedActionExecutor(null);
  _resetPendingActionForTest();
  _resetMaviSpeechForTest();
  _resetMaviTurnsForTest();
  _resetVoiceServiceForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — Telefon araması: onaysız BAŞLAMAZ, onaylı TAM BİR KEZ başlar
 * ════════════════════════════════════════════════════════════════════════ */

describe('Telefon araması — AÇIK KOMUT ONAY BEKLEMEZ (saha 2026-07-31)', () => {
  /* ── NEDEN DEĞİŞTİ ──────────────────────────────────────────────────────
   * Bu blok eskiden "onaysız BAŞLAMAZ" davranışını kilitliyordu. Sahada bunun
   * bedeli ölçüldü: kullanıcı "annemi ara" diyor, asistan "onayın gerekiyor"
   * deyip susuyor, arama HİÇ başlamıyordu. Onay kapısı modelin ÇIKARIMLA
   * başlattığı eylemler içindir; burada kişi adı kullanıcının ağzından çıkar
   * ve komutun kendisi zaten açık talimattır.
   *
   * ONAY MEKANİZMASI SİLİNMEDİ — hâlâ onay isteyen eylemlerde (donanım,
   * `CLEAR_DTC_CODES`) kilitli kalır:
   *   · maviActionAuthority.test.ts → "onay gerektiren HER defter girdisi
   *     onaysız `needs_confirmation` döner"  (genel kilit)
   *   · maviActionAuthority.test.ts → "onaysız → `clearDTCCodes` HİÇ çağrılmaz"
   * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası). */

  it('🔒 açık komut aramayı DOĞRUDAN başlatır (ikinci kez onay istenmez)', async () => {
    M.parseResult = { command: cmd('call_contact', 'Aranıyor', { contactName: 'Selim' }), suggestions: [], needsSemantic: false };
    await processTextCommand("Selim'i ara", STOPPED);
    await flush();

    expect(M.callNumber).toHaveBeenCalledTimes(1);
    expect(M.callNumber).toHaveBeenCalledWith('+905551112233');
    // Onay beklemez → bekleyen eylem slotu KURULMAZ.
    expect(peekPendingAction()).toBeNull();
  });

  it('🔒 arama TAM BİR KEZ başlar (tekrar tetikleme yok)', async () => {
    M.parseResult = { command: cmd('call_contact', 'Aranıyor', { contactName: 'Selim' }), suggestions: [], needsSemantic: false };
    await processTextCommand("Selim'i ara", STOPPED);
    await flush();
    expect(M.callNumber).toHaveBeenCalledTimes(1);

    // Ardından gelen "evet" ORTADA BEKLEYEN EYLEM OLMADIĞI için ikinci arama açamaz.
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    await processTextCommand('evet', STOPPED);
    await flush();

    expect(M.callNumber).toHaveBeenCalledTimes(1);
  });

  /* Kişi çözülemediğinde aramanın BAŞLAMAMASI — yani korumanın onayda değil
     ÇÖZÜMDE olması — bu dosyada tekrarlanmaz: `searchContacts` burada sabit
     mock'tur. O kilit yerinde duruyor:
       maviActionAuthority.test.ts → "numara bulunamazsa SAHTE ONAY YOK — arama BAŞLAMAZ" */
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — DTC silme: onay + WriteGate
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M4 · onay akışı uçtan uca — DTC silme', () => {
  it('ilk komut ECU\'ya YAZMAZ; onay bekler', async () => {
    M.parseResult = { command: cmd('vehicle_clear_dtc', 'Siliniyor'), suggestions: [], needsSemantic: false };
    await processTextCommand('arıza kayıtlarını sil', STOPPED);
    await flush();

    expect(M.clearDTCCodes).not.toHaveBeenCalled();
    expect(peekPendingAction()).not.toBeNull();
    expect(M.spoken.join(' ')).not.toMatch(/silindi/i);
  });

  it('"evet" → WriteGate\'ten geçerek TAM BİR KEZ yürür', async () => {
    M.parseResult = { command: cmd('vehicle_clear_dtc', 'Siliniyor'), suggestions: [], needsSemantic: false };
    await processTextCommand('arıza kayıtlarını sil', STOPPED);
    await flush();

    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    await processTextCommand('evet', STOPPED);
    await flush();

    expect(M.clearDTCCodes).toHaveBeenCalledTimes(1);
  });

  it('WriteGate reddederse "silindi" DENMEZ', async () => {
    M.clearDTCCodes.mockImplementation(async () => ({ allowed: false, userMessage: 'Seyir halinde yazılamaz' }));
    M.parseResult = { command: cmd('vehicle_clear_dtc', 'Siliniyor'), suggestions: [], needsSemantic: false };
    await processTextCommand('arıza kayıtlarını sil', STOPPED);
    await flush();

    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    await processTextCommand('evet', STOPPED);
    await flush();

    expect(M.spoken.join(' ')).not.toMatch(/silindi/i);
  });
});
