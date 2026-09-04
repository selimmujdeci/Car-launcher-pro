/**
 * maviTurnRace.test.ts — MAVI-M5 · GEÇ DÖNEN SAĞLAYICI CEVABI YARIŞLARI (davranışsal).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 (#146, P1): `processTextCommand` içinde istek kimliği YOKTU. Kullanıcı A
 * komutunu söyleyip cevabı beklemeden B'yi söylediğinde, A'nın GEÇ dönen sağlayıcı
 * cevabı hâlâ `_aiHandlers`'ı çalıştırıp navigasyon/arama/medya başlatabiliyor,
 * TTS üretebiliyor ve yeni turu bozabiliyordu.
 *
 * KİLİTLENEN INVARIANT:
 *   Yeni bir kullanıcı komutu başladığında ÖNCEKİ komut artık eylem yetkisine
 *   sahip DEĞİLDİR — ne dispatch eder, ne konuşur, ne fallback'e düşer.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  brain: vi.fn(),
  offline: vi.fn(() => ({ handled: false, response: '' })),
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: (...a: unknown[]) => M.offline(...(a as [])),
}));
vi.mock('../platform/performanceMode', () => ({
  getConfig: () => ({ enableRecommendations: true }),
  // diagnosticTrail → obdService modül-seviyesi aboneliği için (yan etkisiz stub).
  onPerformanceModeChange: () => () => {},
}));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAssistant: (...a: unknown[]) => M.speak(...a),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
// Anahtar çözülsün → `chain` dolu → online beyin yolu AÇIK.
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => 'k-test' }));
vi.mock('../platform/aiHealth', () => ({ isAiNetHealthy: () => true, recordAiNetFailure: vi.fn(), recordAiNetSuccess: vi.fn() }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false,
  answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => 'k-test' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
// Beyin — testin kontrol ettiği sağlayıcı.
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionBrain: (...a: unknown[]) => M.brain(...(a as [])),
  // MAVI-F1: presence okuması (yalnız ÖLÇÜM alanı — akışı etkilemez).
  currentPresenceMode: () => 'assistant' as const,
}));

import {
  processTextCommand,
  registerAIResultHandler,
  _resetVoiceServiceForTest,
} from '../platform/voiceService';
import {
  getMaviTurnDiagnostics,
  _resetMaviTurnsForTest,
} from '../platform/assistant/maviTurn';
import { _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import { _resetMaviVehicleContextForTest } from '../platform/assistant/maviVehicleContext';

/** Beynin ACTION cevabı — gerçek yan etki hattını (navigasyon) tetikler. */
const NAV_ACTION = {
  kind: 'action' as const,
  semantic: {
    intent: 'NAVIGATE_ADDRESS', destination: 'Ankara',
    feedback: 'Ankara adresine gidiyoruz', confidence: 0.95, source: 'direct_ai',
  },
};
const CHAT_ANSWER = { kind: 'chat' as const, response: 'merhaba', route: 'companion_gemini' as const };

let _unsubs: Array<() => void> = [];
function onAiResult(fn: (...a: unknown[]) => void): void {
  _unsubs.push(registerAIResultHandler(fn as never));
}

/**
 * A turunu SAĞLAYICIDA ASILI bırakır, B'yi anında cevaplar.
 *
 * ⚠️ `reached` beklemek ŞART: A önce `_resolveAiKeys()`'i await eder. B'yi ondan
 * önce başlatırsak A daha KAPI A'da düşer, sağlayıcıya hiç ulaşmaz ve test asıl
 * yarışı (geç dönen sağlayıcı cevabı) HİÇ ölçmemiş olur.
 */
function stallProviderForA(): { pending: Deferred<unknown>; reached: Promise<void> } {
  const pending = defer<unknown>();
  const reached = defer<void>();
  M.brain
    .mockImplementationOnce(() => { reached.resolve(); return pending.promise; })
    .mockImplementationOnce(async () => CHAT_ANSWER);
  return { pending, reached: reached.promise };
}

beforeEach(() => {
  // Bu jsdom kurulumunda `navigator.onLine` TANIMSIZ gelir → `hasNet` false olur ve
  // beyin yolu HİÇ denenmez (testler sessizce boşa geçerdi). Açıkça çevrimiçi yapılır.
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  _resetVoiceServiceForTest();
  _resetMaviTurnsForTest();
  // MAVI-M6: tur sayacı sıfırlandığı için id'ler tekrar 1'den başlar → seslendirme
  // otoritesinin tur-başı defteri de sıfırlanmalı (aksi halde bir sonraki test
  // "bu turda zaten cevap verildi" sanıp sessiz kalır).
  _resetMaviSpeechForTest();
  _resetMaviVehicleContextForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  M.brain.mockReset();
  M.offline.mockClear();
  M.offline.mockReturnValue({ handled: false, response: '' });
  localStorage.setItem('car-launcher-storage', JSON.stringify({ state: { settings: { aiVoiceProvider: 'gemini' } } }));
});

afterEach(() => {
  for (const u of _unsubs) { try { u(); } catch { /* ignore */ } }
  _unsubs = [];
  vi.useRealTimers();
  _resetMaviSpeechForTest();
  _resetMaviTurnsForTest();
  _resetVoiceServiceForTest();
  localStorage.removeItem('car-launcher-storage');
});

/* ══════════════════════════════════════════════════════════════════════════
 * Sağlayıcı yarışları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M5 · sağlayıcı yarışları', () => {
  it('6/11. A beklerken B başlar; A GEÇ döner → A handler ÇAĞRILMAZ (abort desteklemese de)', async () => {
    const { pending, reached } = stallProviderForA();
    const seen: string[] = [];
    onAiResult((r: { payload?: Record<string, unknown> }) => {
      seen.push(String(r.payload?.destination ?? '?'));
    });

    const pA = processTextCommand('eve git');
    await reached;                               // A GERÇEKTEN sağlayıcıya ulaştı
    await processTextCommand('merhaba');         // B → turu devralır
    expect(M.brain).toHaveBeenCalledTimes(2);    // ön koşul: iki tur da beyne gitti
    pending.resolve(NAV_ACTION);                 // A'nın GEÇ cevabı
    await expect(pA).resolves.toBe(false);       // A sessizce düştü

    expect(seen).toEqual([]);                    // hiçbir navigasyon yan etkisi BAŞLAMADI
    expect(getMaviTurnDiagnostics().staleProviderResultsDropped).toBeGreaterThanOrEqual(1);
  });

  it('7. A ACTION cevabı geç dönerse dispatch EDİLMEZ ve TTS ÜRETMEZ', async () => {
    const { pending, reached } = stallProviderForA();
    let aiCalls = 0;
    onAiResult(() => { aiCalls++; });

    const pA = processTextCommand('eve git');
    await reached;
    await processTextCommand('merhaba');
    expect(M.brain).toHaveBeenCalledTimes(2);    // ön koşul: beyin yolu denendi
    M.speak.mockClear();                         // B'nin cevabını sayma
    pending.resolve(NAV_ACTION);
    await pA;

    expect(aiCalls).toBe(0);
    expect(M.speak).not.toHaveBeenCalled();      // A'dan TEK bir söz bile çıkmadı
  });

  it('8. A sağlayıcısı HATA verir ve tur devralınmışsa offline fallback ÇALIŞMAZ', async () => {
    const { pending, reached } = stallProviderForA();
    M.offline.mockReturnValue({ handled: true, response: 'offline cevabı' });

    const pA = processTextCommand('bir şey söyle');
    await reached;
    await processTextCommand('merhaba');
    expect(M.brain).toHaveBeenCalledTimes(2);    // ön koşul: beyin yolu denendi
    M.speak.mockClear();
    M.offline.mockClear();
    // Reddi ÖNCE yakala — jsdom "unhandled rejection" uyarmasın (zincir zaten yakalıyor).
    pending.promise.catch(() => { /* yok say */ });
    pending.reject(new Error('provider down'));
    await expect(pA).resolves.toBe(false);

    expect(M.offline).not.toHaveBeenCalled();    // eski tur fallback'e DÜŞMEDİ
    expect(M.speak).not.toHaveBeenCalled();
  });

  it('12. AYNI tur: sağlayıcı null döner → offline fallback ÇALIŞIR (meşru davranış korunur)', async () => {
    M.brain.mockImplementationOnce(async () => null);
    M.offline.mockReturnValue({ handled: true, response: 'offline cevabı' });

    await expect(processTextCommand('bir şey söyle')).resolves.toBe(true);
    expect(M.offline).toHaveBeenCalledTimes(1);
    expect(M.speak.mock.calls.map((c) => String(c[0]))).toContain('offline cevabı');
  });

  it('13. AYNI tur: sağlayıcı THROW eder → mevcut fallback korunur', async () => {
    M.brain.mockImplementationOnce(async () => { throw new Error('timeout'); });
    M.offline.mockReturnValue({ handled: true, response: 'offline cevabı' });

    await expect(processTextCommand('bir şey söyle')).resolves.toBe(true);
    expect(M.offline).toHaveBeenCalledTimes(1);
  });

  it('10. A askıdayken B normal tamamlanır (yeni tur bozulmaz)', async () => {
    const { pending, reached } = stallProviderForA();

    const pA = processTextCommand('eve git');
    await reached;
    await expect(processTextCommand('merhaba')).resolves.toBe(true);
    expect(M.speak.mock.calls.map((c) => String(c[0]))).toContain('merhaba');
    pending.resolve(NAV_ACTION);
    await pA;
  });

  it('9. MAVI-F2: YAVAS beyin hicbir zaman ara soz uretmez (yeni komut gelse de gelmese de)', async () => {
    /* Eskiden 1500 ms'de bir filler timer'i atesliyordu; bu kilit yalniz
       "yeni komuttan SONRA susmasini" koruyordu. F2 ile filler KAYNAKTAN kalkti:
       artik A askida kalirken 5 sn boyunca HICBIR ara soz duyulmaz — ne A'nin
       turunda ne B'nin turunda. Kilit her iki turu da kapsayacak sekilde
       GUCLENDIRILDI (zayiflatilmadi). */
    vi.useFakeTimers();
    const { pending, reached } = stallProviderForA();
    const FILLER_RE = /Bir saniye|Bakıyorum|Kontrol ediyorum|Düşünüyorum|Anlıyorum/i;

    const pA = processTextCommand('uzun bir soru');
    await reached;                               // A saglayicida asili
    await vi.advanceTimersByTimeAsync(5_000);    // eski esik (1500 ms) fazlasiyla asildi
    expect(M.speak.mock.calls.map((c) => String(c[0])).some((t) => FILLER_RE.test(t))).toBe(false);

    await processTextCommand('merhaba');         // B devraldi
    M.speak.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);    // A'nin filler'i ESKIDEN bu aralikta ateslerdi

    const spoken = M.speak.mock.calls.map((c) => String(c[0]));
    expect(spoken.some((s) => FILLER_RE.test(s))).toBe(false);

    pending.resolve(NAV_ACTION);
    await pA;
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yan etki sınırı + bağlam izolasyonu
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M5 · yan etki ve bağlam izolasyonu', () => {
  const SIDE_EFFECT_INTENTS = [
    ['NAVIGATE_ADDRESS', 'rota'],
    ['OPEN_PHONE', 'telefon araması'],
    ['PLAY_MEDIA', 'medya'],
    ['OPEN_SCREEN', 'ekran'],
    ['CHECK_VEHICLE_HEALTH', 'OBD taraması'],
  ] as const;

  for (const [intentType, label] of SIDE_EFFECT_INTENTS) {
    it(`14-18. stale ${intentType} → ${label} BAŞLATILMAZ`, async () => {
      const { pending, reached } = stallProviderForA();
      let handlerCalls = 0;
      onAiResult(() => { handlerCalls++; });

      const pA = processTextCommand('komut A');
      await reached;
      await processTextCommand('merhaba');
      pending.resolve({
        kind: 'action',
        semantic: { intent: intentType, feedback: 'yapılıyor', confidence: 0.95, source: 'direct_ai' },
      });
      await pA;

      expect(handlerCalls).toBe(0);   // yan etki hattına HİÇ girilmedi
    });
  }

  it('21-24. her tur KENDİ M2 bağlamını kullanır; A bağlamı B\'ye sızmaz', async () => {
    const seen: Array<number | null | undefined> = [];
    M.brain.mockImplementation(async (_t: string, opts: { speedKmh?: number }) => {
      seen.push(opts?.speedKmh ?? null);
      return CHAT_ANSWER;
    });

    await processTextCommand('a', { speedKmh: 90, drivingMode: 'driving', isDriving: true, motionState: 'moving' });
    await processTextCommand('b', { speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped' });

    expect(seen).toEqual([90, 0]);   // B, A'nın bağlamını devralmadı
  });

  it('23. A\'nın GEÇ sonucu B bağlamıyla DEĞERLENDİRİLMEZ (hiç değerlendirilmez)', async () => {
    const { pending, reached } = stallProviderForA();
    let handlerCalls = 0;
    onAiResult(() => { handlerCalls++; });

    const pA = processTextCommand('a', { speedKmh: 90, drivingMode: 'driving', isDriving: true, motionState: 'moving' });
    await reached;
    await processTextCommand('b', { speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped' });
    pending.resolve(NAV_ACTION);
    await pA;

    expect(handlerCalls).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Sayaçlar + geriye uyumluluk
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M5 · sayaçlar ve geriye uyumluluk', () => {
  it('1/2/3. turlar monotonik artar; ikinci komut birinciyi devralır', async () => {
    M.brain.mockImplementation(async () => CHAT_ANSWER);
    await processTextCommand('bir');
    const d1 = getMaviTurnDiagnostics();
    await processTextCommand('iki');
    const d2 = getMaviTurnDiagnostics();

    expect(d1.activeTurnId).toBe(1);
    expect(d2.activeTurnId).toBe(2);
    expect(d2.turnsStarted).toBe(2);
    expect(d2.turnsCompleted).toBeGreaterThanOrEqual(2);
  });

  it('5. boş/whitespace girdi tur BAŞLATMAZ', async () => {
    await processTextCommand('   ');
    expect(getMaviTurnDiagnostics().turnsStarted).toBe(0);
    expect(getMaviTurnDiagnostics().activeTurnId).toBe(0);
  });

  it('28/30. güncel tur mevcut TEK cevap davranışını korur', async () => {
    M.brain.mockImplementation(async () => CHAT_ANSWER);
    await processTextCommand('merhaba');
    expect(M.speak.mock.calls.map((c) => String(c[0]))).toEqual(['merhaba']);
  });

  it('34. offline düşük riskli yerel komut geriye uyumlu çalışır', async () => {
    M.brain.mockImplementation(async () => null);
    M.parseResult = {
      command: { raw: 'müziği aç', type: 'open_music', feedback: 'Müzik açılıyor', confidence: 0.95, priority: 'normal', extra: {} },
      suggestions: [], needsSemantic: false,
    };
    await expect(processTextCommand('müziği aç')).resolves.toBe(true);
    expect(M.speak.mock.calls.map((c) => String(c[0]))).toContain('Müzik açılıyor');
  });

  it('sayaçlar bounded ve tutarlı görünür', async () => {
    M.brain.mockImplementation(async () => CHAT_ANSWER);
    await processTextCommand('bir');
    const d = getMaviTurnDiagnostics();
    expect(d.countersSaturated).toBe(false);
    expect(d.turnsStarted).toBeGreaterThan(0);
    expect(d.turnsSuperseded).toBeGreaterThanOrEqual(0);
    // Ham metin/sağlayıcı cevabı ASLA tanı yüzeyine girmez.
    expect(JSON.stringify(d)).not.toMatch(/bir|merhaba|Ankara/);
  });
});

/** Tip yardımcıları — ParsedCommand şekli test içinde serbest kurulur. */
export type _Unused = ParsedCommand;
