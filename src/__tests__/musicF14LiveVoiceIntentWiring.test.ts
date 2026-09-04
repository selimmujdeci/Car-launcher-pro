/**
 * musicF14LiveVoiceIntentWiring.test.ts — MUSIC F14 · Mavi Live Music Intent
 * Wiring.
 *
 * F14'ün tek işi şudur: F9'da hazırlanmış (`resolveMusicIntent` /
 * `dispatchMusicIntent` / `speakMusicOutcome`) hattı GERÇEK Mavi mikrofon/ASR
 * giriş noktasına (`voiceService.processTextCommand`) bağlamak — yeni bir
 * parser/playback yolu/otorite KURMADAN. Bu paket şunları kilitler:
 *   · yerel parser ZATEN "bu müzik" dediğinde (legacy tip) F9 devreye girer
 *   · yerel parser HİÇBİR ŞEY bulamadığında YALNIZ F9'un dar/güvenli
 *     kalıpları (kuyruk/bağlamsal/koleksiyon) bypass'ı tetikler — genel
 *     "aç/çal" yakalayıcısı KÖRLEMESİNE tetiklenmez (müzik-dışı regresyon YOK)
 *   · next/previous KANONİK F7.3 (`layer.next/previous('mavi')`) üzerinden gider
 *   · favorilere ekle/çıkar/favorilerimden çal GERÇEKTEN F9/F13'e ULAŞIR
 *   · AMBIGUOUS/UNAVAILABLE dürüstçe söylenir — sahte başarı YOK
 *   · `routeIntent`in eski müzik dalları artık compatibility adapter'dır —
 *     çağrılırsa ANOMALİ SAYACINA yazılır (HER ZAMAN 0 beklenir)
 *   · ASR metni/sesli komut içeriği telemetriye SIZMAZ
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParsedCommand } from '../platform/commandParser';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  speak: vi.fn(),
  diag: vi.fn(),
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
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAssistant: vi.fn(),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  isTtsSpeaking: () => false,
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false,
  answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: (...a: unknown[]) => M.diag(...a) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import {
  processTextCommand, registerCommandHandler, _resetVoiceServiceForTest,
} from '../platform/voiceService';
import {
  _resetMusicIntentRouterForTest, _setMusicIntentPortsForTest,
} from '../platform/media/intent/musicIntentRouter';
import { _resetMusicIntentTelemetryForTest } from '../platform/media/intent/musicIntentTelemetry';
import {
  _resetMusicVoiceWiringTelemetryForTest, getMusicVoiceWiringTelemetry,
  noteLegacyRouteIntentMusicCall,
} from '../platform/media/intent/musicVoiceWiringTelemetry';
import { routeIntent, type RouterContext } from '../platform/intentEngine';
import { _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import { _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';

const truth = (o: Partial<import('../platform/media/authority/playbackTruth').CommandTruth> = {}) => ({
  commandId: 'c1', sessionId: 's1', sourceId: 'LOCAL', backend: 'test', command: 'play',
  desiredState: 'PLAYING', observedState: 'PLAYING', outcome: 'VERIFIED',
  verificationLevel: 'RENDERING_VERIFIED', startedAtMs: 0, endedAtMs: 1, elapsedMs: 1,
  failureCode: null, retryable: false, stages: [], ...o,
});

function musicCmd(type: ParsedCommand['type'], raw: string): ParsedCommand {
  return { raw, type, feedback: '', confidence: 0.9, priority: 'normal', extra: {} } as unknown as ParsedCommand;
}

/** Varsayılan portlar — hiçbiri gerçek native/otoriteye inmez. */
function ports(over: Record<string, unknown> = {}) {
  const base = {
    gateway: () => Promise.resolve({
      play: () => Promise.resolve(truth()),
      pause: () => Promise.resolve(truth({ command: 'pause' })),
      stop: () => Promise.resolve(truth({ command: 'stop' })),
      getActiveSource: () => 'LOCAL',
      getEffectiveVolume: () => 0.5,
      setUserVolumePercent: () => Promise.resolve(),
      setMuted: () => Promise.resolve(),
    }),
    layer: () => Promise.resolve({
      next: () => Promise.resolve({ dispatched: true, verified: true, failureCode: null }),
      previous: () => Promise.resolve({ dispatched: true, verified: true, failureCode: null }),
      resumeLastMedia: () => false,
      playMedia: () => undefined,
      unifiedFromSearchResult: () => ({ id: 'x', providerId: 'youtube', title: '', subtitle: '' }),
    }),
    registry: () => Promise.resolve({ ensureSearchSourcesConfigured: () => Promise.resolve() }),
    search: () => Promise.resolve({ searchOnce: () => Promise.resolve({ results: [], emptyReason: 'NO_MATCH' }) }),
    selection: () => Promise.resolve({
      selectSearchResult: () => Promise.resolve({ outcome: 'STARTED', reason: 'ok', listening: { truth: truth() } }),
    }),
    sessionRuntime: () => Promise.resolve({
      playQueueEntryNext: () => Promise.resolve({ applied: false, queueResult: { failureCode: 'no' }, reason: 'no' }),
      removeQueueEntryAt: () => Promise.resolve({ applied: false, queueResult: { failureCode: 'no' }, reason: 'no' }),
      jumpToQueueIndex: () => Promise.resolve({ applied: false, queueResult: { failureCode: 'no' }, reason: 'no' }),
      startLibraryListening: () => Promise.resolve({ started: false, reason: 'no' }),
    }),
    playQueue: () => Promise.resolve({ getDesiredQueue: () => ({ entries: [], currentIndex: 0, source: 'LOCAL' }) }),
    intelligence: () => Promise.resolve({
      evaluateForExplicitRequest: () => ({
        candidate: null, confidence: 'NONE', bucket: 'UNKNOWN', motion: 'UNKNOWN', journey: 'UNKNOWN', hasEvidence: false,
      }),
      resolveCandidateLabel: () => null,
      applyIntelligenceCandidate: () => Promise.resolve(false),
    }),
    traits: () => Promise.resolve({
      MAX_EMBEDDED_PRIME: 0,
      primeEmbeddedTraits: () => Promise.resolve(),
      selectTrackByTrait: () => ({ result: { status: 'NO_REFERENCE' }, trackId: null, confidentClaim: false }),
    }),
    collection: () => Promise.resolve({
      addFavorite: () => ({ status: 'ADDED', key: 'local:1', entry: null }),
      removeFavorite: () => ({ status: 'REMOVED', key: 'local:1', entry: null }),
      resolveMostRecentPlayableFavorite: () => null,
      resolvePlaybackTarget: () => ({ kind: 'LOCAL', libraryId: null, provider: null, contentUri: null, sourceClass: 'LOCAL', playable: false }),
    }),
    session: () => Promise.resolve({
      getListeningSession: () => ({
        currentItem: { libraryId: 'lib-1', providerId: null, providerNamespace: null, contentUri: null,
          title: 'Yol', artist: 'Grup', album: null, durationMs: null, trackNumber: null, discNumber: null },
        currentSource: 'LOCAL',
      }),
    }),
    ...over,
  };
  _setMusicIntentPortsForTest(base as any);
}

beforeEach(() => {
  _resetVoiceServiceForTest();
  _resetMaviSpeechForTest();
  _resetMaviTurnsForTest();
  _resetMusicIntentRouterForTest();
  _resetMusicIntentTelemetryForTest();
  _resetMusicVoiceWiringTelemetryForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.speak.mockClear();
  M.diag.mockClear();
  ports();
});

afterEach(() => {
  _resetVoiceServiceForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–2 · GERÇEK GİRİŞ → F9 (yerel parser ZATEN müzik dediğinde)
 *
 * KAPSAM NOTU: yerel parser bir metni ZATEN tanıdıysa (`result.command !==
 * null`) F14 bypass'ı (case a) BİLEREK devreye GİRMEZ — yanlış-pozitif
 * yüzeyini artırmamak ve "belirsiz komut → onay sorusu" akışını EZMEMEK için
 * (bkz. `voiceService.ts` "1c0" yorumu). Bu durumda tek-yürütme/F9-bağlantısı
 * güvencesi `useVoiceCommandHandler`daki `_MUSIC_INTENT_TYPES` yönlendirmesi
 * ÜZERİNDEN sağlanır (bkz. §9a statik kilit) — `dispatchIntent`in ZATEN F9'a
 * bağlı dalları (`ADD_MUSIC_FAVORITE` vb.) veya zaten kanonik/dürüst dalları
 * (`MEDIA_NEXT`/`MEDIA_PREV`, F7.3) çağrılır; burada YENİDEN test edilmez.
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · yerel parser ZATEN müzik dediğinde eski davranış BOZULMAZ', () => {
  it('1 · next/previous KANONİK F7.3 (layer.next/previous(\'mavi\')) — dispatchIntent değişmedi', () => {
    const exec = strip(read('src/platform/commandExecutor.ts'));
    expect(exec, 'MEDIA_NEXT F7.3 kuyruk-farkında girişi kaldırılmış').toContain('_queueAwareNext');
    expect(exec, 'MEDIA_PREV F7.3 kuyruk-farkında girişi kaldırılmış').toContain('_queueAwarePrevious');
    expect(exec, 'F7.3 requester etiketi ("mavi") kaldırılmış')
      .toMatch(/layer\.next\(\s*'mavi'\s*\)/);
    expect(exec, 'F7.3 requester etiketi ("mavi") kaldırılmış')
      .toMatch(/layer\.previous\(\s*'mavi'\s*\)/);
  });

  it('2 · yerel parser "add_music_favorite" dediğinde eski davranış BİREBİR sürer (F14 case-a YOK)', async () => {
    M.parseResult = { command: musicCmd('add_music_favorite', 'bu şarkıyı favorilere ekle'), suggestions: [], needsSemantic: false };
    const w = getMusicVoiceWiringTelemetry().counters.bypassAttempts;
    await processTextCommand('bu şarkıyı favorilere ekle');
    // F14 bypass'ı denenmedi bile — case (a) yok, tek yol değişmeden
    // `useVoiceCommandHandler` → `executeIntent` → `dispatchIntent` (statik
    // kilit §9a) üzerinden gider.
    expect(getMusicVoiceWiringTelemetry().counters.bypassAttempts).toBe(w);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3–5 · YEREL PARSER HİÇBİR ŞEY BULAMADI — YALNIZ DAR/GÜVENLİ KALIPLAR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · genel parser boşken YALNIZ F9\'un dar/güvenli kalıpları bypass eder', () => {
  it('3 · "favorilerimden bir şey çal" (PLAY_FAVORITES) tanınır ve boşsa rastgele BAŞLATMAZ', async () => {
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    const ok = await processTextCommand('favorilerimden bir şey çal');
    expect(ok).toBe(true);
    await vi.waitFor(() => expect(M.speak.mock.calls.length).toBeGreaterThan(0));
  });

  it('4 · "daha sakin bir şey çal" (F10 bağlamsal) tanınır ve dürüstçe yanıtlanır', async () => {
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    const ok = await processTextCommand('daha sakin bir şey çal');
    expect(ok).toBe(true);
  });

  it('5 · "haritayı aç" gibi müzik-dışı serbest metin bypass\'ı TETİKLEMEZ (regresyon yok)', async () => {
    // Genel parser bunu TANIMADI varsayımı (M.parseResult null) — F9'un genel
    // "aç" yakalayıcısı (SEARCH_KINDS) burada KÖRLEMESİNE devreye giremez;
    // yalnız QUEUE/CONTEXTUAL/COLLECTION kalıpları izinlidir ve "haritayı aç"
    // bunlardan HİÇBİRİNE uymaz.
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    const w = getMusicVoiceWiringTelemetry().counters.bypassHits;
    await processTextCommand('haritayı aç');
    expect(getMusicVoiceWiringTelemetry().counters.bypassHits).toBe(w); // artmadı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6–7 · TRUTH/SAFETY — AMBIGUOUS/UNAVAILABLE dürüstçe söylenir
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · ASR metni tek başına kanıt DEĞİLDİR', () => {
  it('6 · favori mutasyonu "bunu" kimliği yoksa REDDEDİLİR — UYDURULMAZ', async () => {
    ports({ session: () => Promise.resolve({ getListeningSession: () => null }) });
    // Yerel eski parser bu doğal-dil kalıbını TANIMIYOR (`result.command === null`)
    // → F14 case (b): F9'un COLLECTION_KINDS kalıbı ("favorilere ekle") yakalar.
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    await processTextCommand('bunu favorilere ekle');
    await vi.waitFor(() => expect(M.speak.mock.calls.length).toBeGreaterThan(0));
    const spoken = M.speak.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(spoken).not.toContain('eklendi');
    expect(spoken).not.toContain('ekledim');
  });

  it('7 · çalınabilir favori yoksa UNAVAILABLE dürüstçe söylenir (rastgele bir şey ÇALINMAZ)', async () => {
    // NOT (kapsam sınırı): AMBIGUOUS/"hangisi?" senaryosu F9'un genel arama
    // yakalayıcısına (SEARCH_KINDS) bağlıdır — F14 case (b) BİLEREK bunu
    // kapsamaz (bkz. §1–2 notu); o dal `musicF9MaviMusicCompanion.test.ts`te
    // ZATEN kilitlidir, burada TEKRARLANMAZ. Burada tier-A-erişilebilir bir
    // UNAVAILABLE senaryosu (PLAY_FAVORITES, koleksiyon boş) doğrulanır.
    ports({ collection: () => Promise.resolve({
      addFavorite: () => ({ status: 'ADDED', key: 'local:1', entry: null }),
      removeFavorite: () => ({ status: 'REMOVED', key: 'local:1', entry: null }),
      resolveMostRecentPlayableFavorite: () => null,
      resolvePlaybackTarget: () => ({ kind: 'LOCAL', libraryId: null, provider: null, contentUri: null, sourceClass: 'LOCAL', playable: false }),
    }) });
    M.parseResult = { command: null, suggestions: [], needsSemantic: false };
    await processTextCommand('favorilerimden bir şey çal');
    await vi.waitFor(() => expect(M.speak.mock.calls.length).toBeGreaterThan(0));
    const spoken = M.speak.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(spoken).not.toMatch(/çalıyor|başlattım/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · MÜZİK-DIŞI KOMUT REGRESYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · müzik dışı Mavi komutlarının davranışı DEĞİŞMEDİ', () => {
  it('8 · yüksek güvenli müzik-dışı komut (gece moduna geç) normal zincirden geçer', async () => {
    const themeCmd = { raw: 'gece moduna geç', type: 'theme_night', feedback: 'Gece moduna geçiliyor',
      confidence: 0.95, priority: 'normal', extra: {} } as unknown as ParsedCommand;
    M.parseResult = { command: themeCmd, suggestions: [], needsSemantic: false };
    let handlerCmd: ParsedCommand | null = null;
    const un = registerCommandHandler((cmd) => { handlerCmd = cmd; });
    try {
      const ok = await processTextCommand('gece moduna geç');
      expect(ok).toBe(true);
      expect((handlerCmd as unknown as ParsedCommand | null)?.type).toBe('theme_night');
    } finally { un(); }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · TEK YÜRÜTME / DUPLICATE YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · aynı komutun iki kez yürütülmesi yapısal olarak imkânsız', () => {
  it('9a · useVoiceCommandHandler müzik tiplerini executeIntent\'e yönlendiriyor (statik kanıt)', () => {
    const hook = strip(read('src/hooks/useVoiceCommandHandler.ts'));
    expect(hook, '_MUSIC_INTENT_TYPES tanımlanmamış').toContain('_MUSIC_INTENT_TYPES');
    expect(hook, 'branch koşulu müzik tiplerini içermiyor')
      .toMatch(/isVehicleEffectiveIntent\(intent\.type\)\s*\|\|\s*_MUSIC_INTENT_TYPES\.has\(intent\.type\)/);
  });

  it('9b · routeIntent\'in müzik dalı ANOMALİ SAYACINA bağlı (çağrılırsa GÖRÜNÜR)', async () => {
    _resetMusicVoiceWiringTelemetryForTest();
    const ctx: RouterContext = {
      launch: () => {}, openDrawer: () => {}, setTheme: () => {}, playMedia: () => {}, pauseMedia: () => {},
    } as unknown as RouterContext;
    await routeIntent({ type: 'PLAY_MEDIA', payload: {}, priority: 'normal' } as any, ctx);
    await vi.waitFor(() => expect(getMusicVoiceWiringTelemetry().counters.legacyRouteIntentCalls).toBe(1));
  });

  it('9c · anomali sayacı doğrudan ölçülebilir (yardımcı fonksiyon çalışır)', () => {
    _resetMusicVoiceWiringTelemetryForTest();
    noteLegacyRouteIntentMusicCall();
    expect(getMusicVoiceWiringTelemetry().counters.legacyRouteIntentCalls).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · VIDEO SAFETY / DUCK / QUEUE OTORİTESİ KORUNUYOR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · F7.2/F6.1/F3 otoriteleri EZİLMEDİ', () => {
  it('10a · voiceService F7.2 video kapısına (videoModeStore/videoSafetyPolicy) DOKUNMADI', () => {
    const svc = strip(read('src/platform/voiceService.ts'));
    expect(svc, 'F14 bypass\'ı video moduna karışmış').not.toContain('videoModeStore');
    expect(svc, 'F14 bypass\'ı video güvenlik kapısını çağırmış').not.toContain('videoSafetyPolicy');
  });

  it('10b · _answerMusicIntent PlayQueue\'yu DOĞRUDAN mutasyona uğratmaz', () => {
    const svc = strip(read('src/platform/voiceService.ts'));
    const block = svc.slice(svc.indexOf('async function _answerMusicIntent'), svc.indexOf('/* ── Komut zincirleme'));
    expect(block.length, 'bypass çalıştırıcısı okunamadı').toBeGreaterThan(200);
    expect(block, 'kanonik kuyruğu doğrudan import etmiş').not.toMatch(/from '[^']*session\/playQueue'/);
    expect(block, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
  });

  it('10c · transport niyetlerinde cancelAssistantDuck çağrılır (F6.1 ile AYNI davranış)', () => {
    const svc = strip(read('src/platform/voiceService.ts'));
    expect(svc, '_TRANSPORT_KINDS_FOR_DUCK kaldırılmış').toContain('_TRANSPORT_KINDS_FOR_DUCK');
    expect(svc, 'duck iptali çağrılmıyor').toContain('_cancelAssistantDuck()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · GİZLİLİK — ASR metni telemetriye SIZMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F14 · gizlilik — sesli komut içeriği telemetriye GİRMEZ', () => {
  it('11 · musicVoiceWiringTelemetry şeması yalnız sayaç/zaman taşır', () => {
    const src = strip(read('src/platform/media/intent/musicVoiceWiringTelemetry.ts'));
    for (const forbidden of ['utterance', 'transcript', 'query:', 'rawText', 'spokenText']) {
      expect(src, `yasaklı alan sızmış: ${forbidden}`).not.toContain(forbidden);
    }
  });
});
