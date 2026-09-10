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
  /** MAVI-F12: uçuştaki sözün durumu — barge-in hakeminin girdisi. */
  ttsSpeaking: true,
  ttsProtected: false,
  companionImpl: null as
    | ((raw: string, opts: Record<string, unknown>) => Promise<Record<string, unknown> | null>)
    | null,
}));

/** Beyin chat sonucu kısayolu. */
const chatResult = (response: string) => ({ kind: 'chat', response, route: 'companion_gemini' });

/**
 * Beyin ACTION sonucu kısayolu (Single Brain: araç komutu kararı beynindir).
 * fromSemanticResult mock'u intent/query/confidence okur; voiceService ayrıca
 * semantic.feedback + confidence kullanır.
 */
const actionResult = (intent: string, feedback: string, confidence = 0.95) => ({
  kind: 'action',
  semantic: { intent, query: undefined, destination: undefined, category: undefined, feedback, confidence, source: 'direct_ai' },
});

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
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult, matchDeterministicWholeInput: () => null, buildCommandGrammar: () => ['[unk]'] }));
/* MUSIC F14 · "1c0" yerel müzik bypass'ı `result.command === null` iken F9'un
   resolver'ını dener — bu test sahte zamanlayıcı (`vi.useFakeTimers`)
   kullanır ve gerçek dinamik import zinciri o kurguyla GÜVENİLİR biçimde
   etkileşmez (müzikle ilgisiz sohbet turlarında da tetiklenir). Mock, F9
   modülünü BASİTLEŞTİRİR — davranış assersiyonu ZAYIFLATILMAZ, yalnız test
   ortamı belirlenir. */
vi.mock('../platform/media/intent/musicIntentResolver', () => ({ resolveMusicIntent: () => null }));
vi.mock('../platform/media/intent/musicIntent', () => ({
  QUEUE_KINDS: [], CONTEXTUAL_KINDS: [], COLLECTION_KINDS: [],
}));
vi.mock('../platform/media/intent/musicVoiceWiringTelemetry', () => ({
  noteMusicVoiceBypassAttempt: () => {}, noteMusicVoiceBypassHit: () => {}, noteMusicVoiceBypassMiss: () => {},
}));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAssistant: (...a: unknown[]) => M.speak(...a),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  registerTtsEndListener: (cb: () => void) => { M.ttsEnd = cb; return () => {}; },
  /* MAVI-F12: `interruptAndListen` artık uçuştaki sözün DURUMUNU ve KANALINI
     sorar (kesme hakemi). Taklit gerçek senaryoyu kurar: Mavi KONUŞUYOR ve
     bu KORUNAN bir kanal DEĞİL → kullanıcı kesebilir. */
  isTtsSpeaking: () => M.ttsSpeaking,
  isProtectedSpeechInFlight: () => M.ttsProtected,
  isMicCaptureOpenDuringSpeech: () => false,
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
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
// Gerçekçi stub: beyin ACTION'ları intent köprüsünden geçebilsin
// (gerçek intentEngine ağır bağımlılık zinciri çeker — payload sözleşmesi
// gerçek fromSemanticResult ile companionChat.test.ts'te ayrıca kilitli).
vi.mock('../platform/intentEngine', () => ({
  fromSemanticResult: (r: { intent: string; query?: string; confidence: number }) =>
    (r.intent === 'UNKNOWN' || r.confidence < 0.45)
      ? null
      : { type: r.intent, payload: { searchQuery: r.query ?? '', confidence: r.confidence }, priority: 'normal' },
}));
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
  tryCompanionBrain: (raw: string, opts: Record<string, unknown>) =>
    M.companionImpl ? M.companionImpl(raw, opts) : Promise.resolve(null),
  repairMusicQuery: async () => null,
  // MAVI-F1: presence okuması (yalnız ÖLÇÜM alanı — akışı etkilemez).
  currentPresenceMode: () => 'assistant' as const,
}));

import {
  startListening,
  interruptAndListen,
  setVoicePaused,
  registerAIResultHandler,
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
  M.companionImpl = async () => chatResult('İyiyim, sen nasılsın?');
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
      return chatResult('Cevap.');
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

/* ── 1c. Barge-in — asistan konuşurken kesip yeni tur ──────────── */

describe('barge-in (interruptAndListen)', () => {
  it('cevap KONUŞULURKEN (success) kesip yeni dinleme açar', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    expect(_getVoiceStateForTest().status).toBe('success');   // cevap seslendiriliyor
    const before = M.sttCalls.length;

    // Kuyruk boş → barge-in ile açılan yeni STT 'listening'de asılı kalır (transcript
    // gelmediği için döngü tamamlanmaz) → barge-in'in mikrofonu açtığını izole doğrular.
    interruptAndListen();                                     // asistanı kes + dinle
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);

    expect(M.sttCalls.length).toBe(before + 1);               // yeni STT açıldı (cevap kesildi)
    expect(_getVoiceStateForTest().status).toBe('listening'); // yeni tur dinlemede
  });

  it('🔒 MAVI-F12: KORUNAN ses (güvenlik/navigasyon) çalarken kesme MİKROFONU AÇMAZ', async () => {
    /* Kullanıcının Mavi'yi kesebilmesi, güvenlik/tehlike/navigasyon kanalını
       susturma yetkisi DEĞİLDİR (spec §20.2 · K1). Uyarı kısa sürer; kullanıcı
       hemen ardından yine kesebilir — aşağıdaki ikinci yarı bunu kanıtlar. */
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    const before = M.sttCalls.length;

    M.ttsProtected = true;                                    // güvenlik uyarısı uçuşta
    interruptAndListen();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);
    expect(M.sttCalls.length).toBe(before);                   // mikrofon AÇILMADI

    M.ttsProtected = false;                                   // uyarı bitti
    interruptAndListen();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);
    expect(M.sttCalls.length).toBe(before + 1);               // kullanıcı yine kesebilir
  });

  it('DİNLERKEN no-op (aktif dinlemeyi kesip kendini yeniden açmaz)', async () => {
    startListening();
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);
    expect(_getVoiceStateForTest().status).toBe('listening');
    const before = M.sttCalls.length;
    interruptAndListen();                                     // listening → no-op
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.warmupMs + 100);
    expect(M.sttCalls.length).toBe(before);
  });
});

/* ── 2. Araç komutu → döngü YOK ─────────────────────────────── */

describe('araç komutu sonrası takip dinlemesi BAŞLAMAZ', () => {
  it('beyin ACTION kararı verince followUp kurulmaz, TTS bitince mikrofon kapalı kalır', async () => {
    // Single Brain: kritik olmayan "müziği aç" Gemini'ye gider; beyin ACTION
    // döndürür → araç komutu olarak çalışır, sohbet döngüsü AÇILMAZ.
    M.companionImpl = async () => actionResult('PLAY_MUSIC_SEARCH', 'Müzik açılıyor');
    M.sttQueue = ['müziği aç'];
    await speakTurn();

    expect(M.speak).toHaveBeenCalledWith('Müzik açılıyor');
    expect(_getVoiceStateForTest().followUp).toBe(false);

    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.sttCalls).toHaveLength(1);                              // yeniden açılma YOK
  });

  it('sohbet ortasında araç komutu (beyin ACTION) gelirse komut çalışır ve döngü BİTER', async () => {
    M.sttQueue = ['nasılsın', 'müziği aç'];
    await speakTurn();                                               // tur 1: sohbet (chat)
    expect(_getVoiceStateForTest().followUp).toBe(true);

    M.companionImpl = async () => actionResult('PLAY_MUSIC_SEARCH', 'Müzik açılıyor');
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

  it('"müziği kapat" gibi NESNELİ kritik komut kapatma sözü SAYILMAZ — kritik bypass yerelde çalışır', async () => {
    // stop_music kritik refleks tipidir (CRITICAL_VOICE_TYPES): 1.0 güvende
    // Gemini beklenmeden yerelde çalışır. 'müziği kapat' içinde 'kapat' geçse de
    // TAM söylem değil → sohbet kapatma sözü SAYILMAZ, komut olarak işlenir.
    M.parseResult = {
      command: { ...CMD, raw: 'müziği kapat', type: 'stop_music', feedback: 'Müzik duraklatıldı' },
      suggestions: [], needsSemantic: false,
    };
    M.sttQueue = ['nasılsın', 'müziği kapat'];
    await speakTurn();
    M.ttsEnd!();
    await vi.advanceTimersByTimeAsync(RELISTEN_SETTLE_MS);
    expect(M.speak).toHaveBeenCalledWith('Müzik duraklatıldı');      // kritik bypass ÇALIŞTI
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

/* ── 5b. Birleşik beyin (Siri mantığı) — komut/sohbet kararı ── */

describe('birleşik beyin: müzik isteği ACTION olur, sohbet gasp edemez', () => {
  it('beynin ACTION kararı intent köprüsünden geçer (PLAY_MUSIC_SEARCH + düzeltilmiş isim), sohbet döngüsü kurulmaz', async () => {
    M.companionImpl = async () => ({
      kind: 'action',
      semantic: {
        intent: 'PLAY_MUSIC_SEARCH', query: 'İbrahim Tatlıses',
        feedback: 'İbrahim Tatlıses açılıyor', confidence: 0.95, source: 'direct_ai',
      },
    });
    const actions: { intent: string; payload: Record<string, unknown> }[] = [];
    const unsub = registerAIResultHandler((r) => actions.push({ intent: r.intent, payload: r.payload as Record<string, unknown> }));

    M.sttQueue = ['ibrahim tatlısesten bir müzik açıver şöyle'];
    await speakTurn();

    expect(actions).toHaveLength(1);
    expect(actions[0].intent).toBe('PLAY_MUSIC_SEARCH');
    expect(actions[0].payload['searchQuery']).toBe('İbrahim Tatlıses'); // ASR onarımı + payload köprüsü
    expect(M.speak).toHaveBeenCalledWith('İbrahim Tatlıses açılıyor');  // biyografi DEĞİL
    expect(_getVoiceStateForTest().followUp).toBe(false);               // aksiyon → döngü yok
    unsub();
  });

  it('OFFLINE müzik isteği companion\'a hiç girmez (beyin offline\'da yalnız sohbet üretir)', async () => {
    NAV.onLine = false;                                  // geminiUsable=false → kapı devrede
    const companionCalls: string[] = [];
    M.companionImpl = async (raw) => { companionCalls.push(raw); return chatResult('Biyografi...'); };
    M.sttQueue = ['ibrahim tatlısesten bir müzik açıver şöyle'];
    await speakTurn();
    expect(companionCalls).toHaveLength(0);              // sohbet gaspı yok
  });

  it('müzik içermeyen serbest cümle beyne gitmeye devam eder', async () => {
    const companionCalls: string[] = [];
    M.companionImpl = async (raw) => {
      companionCalls.push(raw);
      return chatResult('Cevap.');
    };
    M.sttQueue = ['bugün biraz yorgunum'];
    await speakTurn();
    expect(companionCalls).toEqual(['bugün biraz yorgunum']);
  });
});

/* ── 6. MAVI-F2 · YAVAŞ BEYİN DE FILLER ÜRETMEZ (I11) ───────────
 *
 * Bu grup ESKİDEN tam TERSİNİ kilitliyordu: "Gemini 1500 ms'yi aşarsa kısa ara
 * feedback seslendirilir". O davranış bir kusurdu — cümle hiçbir bilgi taşımıyor,
 * yalnız gecikmeyi örtüyordu ve tipik tur eşiği aştığı için neredeyse HER TURDA
 * duyuluyordu. F2 mekanizmayı kaynaktan kaldırdı; kilit YENİ DOĞRU davranışa
 * GÜNCELLENDİ (silinmedi): sohbet ne kadar yavaş olursa olsun kullanıcı yalnız
 * GERÇEK cevabı duyar. */

describe('MAVI-F2 · normal sohbette yapay ara söz YOKTUR', () => {
  it('beyin 3 sn sürse bile ara söz YOK — yalnız gerçek cevap duyulur', async () => {
    M.companionImpl = () => new Promise((resolve) => {
      setTimeout(() => resolve(chatResult('Geç ama geldim.')), 3_000);
    });
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(false);

    await vi.advanceTimersByTimeAsync(1_600);                        // eski 1500 ms eşiği aşıldı
    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);                        // cevap geldi
    expect(M.speak).toHaveBeenCalledWith('Geç ama geldim.');
    // Yavaş turda bile TEK bir gerçek cevap konuşulur — öncesinde hiçbir ara söz yok.
    expect(M.speak.mock.calls.map(([t]) => String(t))).toEqual(['Geç ama geldim.']);
    expect(_getVoiceStateForTest().followUp).toBe(true);             // döngü yine kurulu
  });

  it('hızlı cevapta da ara söz YOK — doğrudan cevap', async () => {
    M.sttQueue = ['nasılsın'];
    await speakTurn();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(M.speak.mock.calls.some(([t]) => THINKING_RE.test(String(t)))).toBe(false);
    expect(M.speak).toHaveBeenCalledWith('İyiyim, sen nasılsın?');
  });
});
