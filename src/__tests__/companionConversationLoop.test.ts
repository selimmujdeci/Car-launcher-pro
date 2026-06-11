/**
 * companionConversationLoop.test.ts — P0 Companion AI sürekli sohbet döngüsü.
 *
 * Saha şikayetleri (2026-06-11): cevap sonrası tekrar mikrofona basmak
 * gerekiyor · asistan çok geç cevap veriyor · robotik/kısa cevaplar.
 *
 * Kilitlenen davranışlar:
 *  1. Companion sohbet cevabı sonrası takip dinlemesi (followUp) kurulur;
 *     TTS bitince mikrofon KISA pencereyle (followUpListenMs) yeniden açılır.
 *  2. ARAÇ KOMUTU sonrası takip dinlemesi KURULMAZ (sohbet ≠ komut).
 *  3. Takip penceresinde boş transcript (sessizlik) → döngü biter, idle.
 *  4. "tamam / sus / kapat / sonra konuşuruz" → döngü SESSİZCE kapanır.
 *  5. PROTECTION/CRITICAL (setVoicePaused) → takip dinlemesi başlamaz.
 *  6. TTS bitmeden (ttsEnd gelmeden) mikrofon AÇILMAZ.
 *  7. Gemini 800ms'yi aşarsa "düşünüyorum" ara feedback'i; hızlıysa YOK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedCommand } from '../platform/commandParser';
import { VOICE_TUNING } from '../platform/voiceTuning';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  /** Sıralı STT transcript kuyruğu — her startSpeechRecognition bir eleman tüketir. */
  sttQueue: [] as string[],
  sttCalls: [] as Record<string, unknown>[],
  speak: vi.fn(),
  ttsEnd: null as (() => void) | null,
  companionImpl: null as
    | ((raw: string, opts: Record<string, unknown>) => Promise<{ response: string; route: string } | null>)
    | null,
}));

vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    startSpeechRecognition: (opts: Record<string, unknown>) => {
      M.sttCalls.push(opts);
      const next = M.sttQueue.shift();
      if (next === undefined) return new Promise<never>(() => { /* asla dönmez */ });
      return Promise.resolve({ transcript: next });
    },
    addListener: () => Promise.resolve({ remove: async () => {} }),
  },
}));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAlert: vi.fn(),
  registerTtsEndListener: (cb: () => void) => { M.ttsEnd = cb; return () => {}; },
}));
vi.mock('../platform/audioService', () => ({ duckMedia: vi.fn(), unduckMedia: vi.fn() }));
vi.mock('../platform/mediaService', () => ({
  getMediaState: () => ({ playing: false }),
  play: vi.fn(),
  pause: vi.fn(),
}));
vi.mock('../platform/aiVoiceService', () => ({
  askAI: async () => null,
  resolveApiKey: (_p: string, k?: string) => k ?? '',
}));
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
  sensitiveKeyStore: { get: async () => 'AIzaTestKey' },
}));
vi.mock('../platform/remoteLogService', () => ({ reportCritical: vi.fn(async () => true) }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionChat: (raw: string, opts: Record<string, unknown>) =>
    M.companionImpl ? M.companionImpl(raw, opts) : Promise.resolve(null),
}));

import {
  startListening,
  setVoicePaused,
  _resetVoiceServiceForTest,
  _getVoiceStateForTest,
} from '../platform/voiceService';

const STORAGE_KEY = 'car-launcher-storage';
const CMD: ParsedCommand = {
  raw: 'müziği aç', type: 'play_music', feedback: 'Müzik açılıyor',
  confidence: 1.0, priority: 'normal',
} as unknown as ParsedCommand;

const THINKING_RE = /Bakıyorum|Anlıyorum|Düşünüyorum|saniye|Kontrol|bakayım/;
const RELISTEN_SETTLE_MS = 350 + VOICE_TUNING.warmupMs + 100; // tampon + warmup + pay

/** Gemini provider'ı aktif et — companion hattının 'düşünüyorum' kapısı için. */
function setGeminiProvider(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    state: { settings: { aiVoiceProvider: 'gemini' } },
  }));
}

/** Sesli oturum başlat: STT kuyruğundaki ilk transcript işlenene dek ilerlet. */
async function speakTurn(): Promise<void> {
  startListening();
  await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);
}

// setup.ts navigator'ı düz objeyle değiştirir (onLine alanı YOK) → hasNet=false
// olur ve 'düşünüyorum' zamanlayıcı kapısı hiç kurulmaz. Çevrimiçi senaryo için
// alanı testte açıkça ekliyoruz (supportSnapshot.test.ts ile aynı desen).
const NAV = navigator as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  NAV.onLine = true;
  _resetVoiceServiceForTest();
  setVoicePaused(false);
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.sttQueue = [];
  M.sttCalls = [];
  M.speak.mockClear();
  M.companionImpl = async () => ({ response: 'İyiyim, sen nasılsın?', route: 'companion_gemini' });
  localStorage.removeItem(STORAGE_KEY);
  setGeminiProvider();
});

afterEach(() => {
  vi.useRealTimers();
  _resetVoiceServiceForTest();
  localStorage.removeItem(STORAGE_KEY);
  delete NAV.onLine;
});

/* ── 1. Companion cevabı → takip dinlemesi ──────────────────── */

describe('sürekli sohbet döngüsü — companion cevabı sonrası', () => {
  it('cevap sonrası followUp kurulur; TTS bitince mikrofon KISA pencereyle yeniden açılır', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();

    // Cevap verildi, takip dinlemesi kurulu (UI pencereyi kapatmaz)
    expect(M.speak).toHaveBeenCalledWith('İyiyim, sen nasılsın?');
    expect(_getVoiceStateForTest().followUp).toBe(true);
    expect(M.sttCalls).toHaveLength(1);

    // TTS bitti → tampon + warmup sonrası mikrofon OTOMATİK açılır
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);

    expect(M.sttCalls).toHaveLength(2);                              // wake word/buton GEREKMEDİ
    expect(M.sttCalls[1]['maxListenMs']).toBe(VOICE_TUNING.followUpListenMs); // 6-10s kısa pencere
    expect(_getVoiceStateForTest().status).toBe('listening');
  });

  it('takip penceresinde yeni transcript yine companion\'a gider (çok turlu sohbet)', async () => {
    const companionInputs: string[] = [];
    M.companionImpl = async (raw) => {
      companionInputs.push(raw);
      return { response: 'Cevap.', route: 'companion_gemini' };
    };
    M.sttQueue = ['nasılsın', 'ben de iyiyim biraz yorgunum'];

    await speakTurn();
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);

    expect(companionInputs).toEqual(['nasılsın', 'ben de iyiyim biraz yorgunum']);
    expect(_getVoiceStateForTest().followUp).toBe(true);             // döngü sürüyor
  });

  it('TTS bitmeden mikrofon AÇILMAZ (ttsEnd gelene dek 2. STT yok)', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    expect(M.sttCalls).toHaveLength(1);

    // TTS bitişi GELMEDEN uzun bekleme — mikrofon kapalı kalır
    await vi.advanceTimersByTimeAsync(5_000);
    expect(M.sttCalls).toHaveLength(1);
  });
});

/* ── 2. Araç komutu → döngü YOK ─────────────────────────────── */

describe('araç komutu sonrası takip dinlemesi BAŞLAMAZ', () => {
  it('net komut (≥0.7) dispatch edilir, followUp kurulmaz, TTS bitince mikrofon kapalı kalır', async () => {
    M.parseResult = { command: CMD, suggestions: [], needsSemantic: false };
    M.sttQueue = ['müziği aç'];
    await speakTurn();

    expect(M.speak).toHaveBeenCalledWith('Müzik açılıyor');
    expect(_getVoiceStateForTest().followUp).toBe(false);

    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.sttCalls).toHaveLength(1);                              // yeniden açılma YOK
  });

  it('sohbet ortasında araç komutu gelirse komut çalışır ve döngü BİTER', async () => {
    M.sttQueue = ['nasılsın', 'müziği aç'];
    await speakTurn();                                               // tur 1: sohbet
    expect(_getVoiceStateForTest().followUp).toBe(true);

    M.parseResult = { command: CMD, suggestions: [], needsSemantic: false };
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);           // tur 2: komut

    expect(M.speak).toHaveBeenCalledWith('Müzik açılıyor');
    expect(_getVoiceStateForTest().followUp).toBe(false);            // döngü kapandı

    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.sttCalls).toHaveLength(2);                              // 3. açılış YOK
  });
});

/* ── 3. Sessizlik → idle ────────────────────────────────────── */

describe('takip penceresi sessizlik (timeout)', () => {
  it('boş transcript → döngü biter, idle\'a döner, tekrar konuşma YOK', async () => {
    M.sttQueue = ['nasılsın', ''];
    await speakTurn();
    const speaksAfterAnswer = M.speak.mock.calls.length;

    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);

    expect(_getVoiceStateForTest().status).toBe('idle');             // sessizlik → idle
    expect(_getVoiceStateForTest().followUp).toBe(false);
    expect(M.speak.mock.calls.length).toBe(speaksAfterAnswer);       // "hâlâ buradayım" spam'i yok

    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.sttCalls).toHaveLength(2);                              // döngü gerçekten öldü
  });
});

/* ── 4. Kapatma sözleri ─────────────────────────────────────── */

describe('sohbet kapatma sözleri', () => {
  it.each(['tamam', 'sus', 'kapat', 'sonra konuşuruz'])(
    '"%s" → döngü SESSİZCE kapanır (TTS yok, idle)', async (word) => {
      M.sttQueue = ['nasılsın', word];
      await speakTurn();
      const speaksAfterAnswer = M.speak.mock.calls.length;

      M.ttsEnd!();
      await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);

      expect(_getVoiceStateForTest().status).toBe('idle');
      expect(_getVoiceStateForTest().followUp).toBe(false);
      expect(M.speak.mock.calls.length).toBe(speaksAfterAnswer);     // kapanış sessiz

      M.ttsEnd!();
      await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
      expect(M.sttCalls).toHaveLength(2);                            // mikrofon yeniden açılmadı
    });

  it('"müziği kapat" gibi NESNELİ komut kapatma sözü SAYILMAZ — parser yolunda kalır', async () => {
    M.parseResult = {
      command: { ...CMD, raw: 'müziği kapat', type: 'pause_music', feedback: 'Müzik duraklatıldı' },
      suggestions: [], needsSemantic: false,
    };
    M.sttQueue = ['nasılsın', 'müziği kapat'];
    await speakTurn();
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.speak).toHaveBeenCalledWith('Müzik duraklatıldı');      // komut ÇALIŞTI
  });
});

/* ── 5. PROTECTION/CRITICAL kilidi ──────────────────────────── */

describe('bilişsel koruma (PROTECTION/CRITICAL) — takip dinlemesi kapalı', () => {
  it('cevaptan sonra pause gelirse TTS bitişinde mikrofon AÇILMAZ', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    expect(_getVoiceStateForTest().followUp).toBe(true);

    setVoicePaused(true);                                            // CognitivePriorityEngine kapısı
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);

    expect(M.sttCalls).toHaveLength(1);                              // yeniden dinleme YOK
    expect(_getVoiceStateForTest().followUp).toBe(false);            // bayrak da temizlendi
  });

  it('pause aktifken sohbet cevabı takip dinlemesi KURMAZ', async () => {
    setVoicePaused(true);
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    expect(_getVoiceStateForTest().followUp).toBe(false);
  });
});

/* ── 5b. Müzik aksiyon kapısı — sohbet müzik isteğini GASP EDEMEZ ── */

describe('müzik aksiyon kapısı (saha: "İbrahim Tatlıses\'ten müzik aç" → biyografi)', () => {
  it('parser\'a takılmayan müzik İSTEĞİ companion sohbetine GİRMEZ', async () => {
    const companionCalls: string[] = [];
    M.companionImpl = async (raw) => {
      companionCalls.push(raw);
      return { response: 'İbrahim Tatlıses 1952 doğumlu...', route: 'companion_gemini' };
    };
    // Parser eşleşmedi senaryosu (mock parser null döner) ama cümle müzik aksiyonu
    M.sttQueue = ['ibrahim tatlısesten bir müzik açıver şöyle'];
    await speakTurn();

    expect(companionCalls).toHaveLength(0);              // Gemini biyografi ANLATMADI
  });

  it('müzik içermeyen serbest cümle companion\'a gitmeye devam eder', async () => {
    const companionCalls: string[] = [];
    M.companionImpl = async (raw) => {
      companionCalls.push(raw);
      return { response: 'Cevap.', route: 'companion_gemini' };
    };
    M.sttQueue = ['bugün biraz yorgunum'];
    await speakTurn();
    expect(companionCalls).toEqual(['bugün biraz yorgunum']);
  });
});

/* ── 6. Geç cevap → "düşünüyorum" ara feedback'i ───────────── */

describe('gecikme geri bildirimi (800ms eşiği)', () => {
  it('Gemini 800ms\'yi aşarsa kısa ara feedback seslendirilir, sonra asıl cevap', async () => {
    M.companionImpl = () => new Promise((resolve) => {
      setTimeout(() => resolve({ response: 'Geç ama geldim.', route: 'companion_gemini' }), 3_000);
    });
    M.sttQueue = ['nasılsın'];
    await speakTurn();                                               // 100ms pay — henüz feedback yok
    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(false);

    await vi.advanceTimersByTimeAsync(900);                          // 800ms eşiği geçildi
    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(true);

    await vi.advanceTimersByTimeAsync(2_500);                        // Gemini cevabı geldi
    expect(M.speak).toHaveBeenCalledWith('Geç ama geldim.');
    expect(_getVoiceStateForTest().followUp).toBe(true);             // döngü yine kurulu
  });

  it('Gemini hızlıysa (≤800ms) ara feedback YOK — doğrudan cevap', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    await vi.advanceTimersByTimeAsync(2_000);                        // eşik geçse bile timer iptal edildi

    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(false);
    expect(M.speak).toHaveBeenCalledWith('İyiyim, sen nasılsın?');
  });
});
