/**
 * musicF8DrivingIntelligence.test.ts — MUSIC F8 · Sürüş-farkında müzik zekâsı.
 *
 * F8 bir "AI DJ" DEĞİLDİR: kanıta dayalı, sınırlı ve fail-closed bir karar
 * katmanıdır. Bu paket şunları kilitler:
 *   · bağlam yalnız ÖLÇÜLEN sinyalden doğar (hız yoksa bağlam YOK)
 *   · histerezis: dur-kalk trafiğinde kanıt kovası titremez
 *   · "başlatıldı" tercih kanıtı DEĞİLDİR — yalnız KORUNAN dinleme sayılır
 *   · gizlilik: ad · URI · konum · sağlayıcı içerik kimliği SAKLANMAZ
 *   · çalan müziğe DOKUNULMAZ; açık kullanıcı niyeti otomasyondan ÜSTÜNDÜR
 *   · otomatik devam yalnız TÜM kapılar açıkken; belirsizlikte HOLD
 *   · F8 ikinci playback/kuyruk/arama otoritesi KURMAZ
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyDaypart, classifyDrivingContext, classifyJourney, classifyMotion,
  type DrivingContext, type DrivingContextInput,
} from '../platform/media/intelligence/drivingContextModel';
import {
  _resetPreferenceEvidenceForTest, bestPreferenceFor, getPreferenceEvidence,
  MAX_PREFERENCE_ENTRIES, notePreferenceOutcome, PREFERENCE_STORAGE_KEY, PREFERENCE_TTL_MS,
} from '../platform/media/intelligence/preferenceEvidence';
import {
  AUTO_RESUME_MIN_KEPT, decideMusicIntelligence, EXPLICIT_INTENT_TTL_MS,
} from '../platform/media/intelligence/musicIntelligenceModel';
import { isNightHour } from '../platform/mapSourceManager';
import { safeStorage } from '../utils/safeStorage';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const NOW = 1_700_000_000_000;

const ctxInput = (o: Partial<DrivingContextInput> = {}): DrivingContextInput => ({
  speedKmh: 80,
  tripActive: true,
  tripDurationMin: 2,
  tripDistanceKm: 3,
  guidanceActive: false,
  remainingMeters: null,
  remainingIsRouteMeasured: false,
  localHour: 21,
  previousMotion: 'UNKNOWN',
  ...o,
});

beforeEach(() => {
  _resetPreferenceEvidenceForTest();
  try { safeStorage.removeItem(PREFERENCE_STORAGE_KEY); } catch { /* ignore */ }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · BAĞLAM: yalnız ölçülen sinyalden doğar
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8 · sürüş bağlamı ölçümden doğar', () => {
  it('1 · hız ölçülemiyorsa bağlam YOKTUR — varsayım üretilmez', () => {
    const ctx = classifyDrivingContext(ctxInput({ speedKmh: null }));
    expect(ctx.motion, 'ölçümsüz hızdan sınıf uydurulmuş').toBe('UNKNOWN');
    expect(ctx.confidence).toBe('NONE');
    expect(ctx.bucket, 'kanıtsız kovaya tercih yazılabilirdi').toBe('UNKNOWN');
    expect(ctx.missing).toContain('vehicle.speed');
    expect(ctx.evidence.find((e) => e.signal === 'vehicle.speed')?.state).toBe('UNAVAILABLE');
  });

  it('2 · hareket sınıfı histerezislidir — dur-kalk trafiğinde titremez', () => {
    expect(classifyMotion(0.4)).toBe('PARKED');
    expect(classifyMotion(25)).toBe('HIGHWAY');
    /* Otoyoldan çıkış bandı: 18 km/h'de HÂLÂ HIGHWAY (kova bölünmez). */
    expect(classifyMotion(18, 'HIGHWAY')).toBe('HIGHWAY');
    expect(classifyMotion(16, 'HIGHWAY')).toBe('CITY');
    /* Duruştan çıkış bandı: 1.5 km/h'de hâlâ PARKED. */
    expect(classifyMotion(1.5, 'PARKED')).toBe('PARKED');
    expect(classifyMotion(5, 'PARKED')).toBe('CITY');
  });

  it('3 · gündüz/gece bandı TEK kuraldır (harita ile aynı 07–19)', () => {
    for (const hour of [0, 3, 6, 7, 12, 18, 19, 22, 23]) {
      const night = classifyDaypart(hour) === 'NIGHT';
      expect(night, `saat ${hour}: F8 ile harita gece kuralı ayrışmış`).toBe(isNightHour(hour));
    }
    expect(classifyDaypart(null), 'saat okunamazken gece varsayılmış').toBe('UNKNOWN');
  });

  it('4 · uzun yol KANITLA belirlenir; kuş uçuşu tahmin KANIT SAYILMAZ', () => {
    expect(classifyJourney(ctxInput({ tripActive: false }))).toBe('UNKNOWN');
    expect(classifyJourney(ctxInput({ tripDurationMin: 1, tripDistanceKm: 0.5 }))).toBe('START');
    expect(classifyJourney(ctxInput({ tripDurationMin: 20, tripDistanceKm: 12 }))).toBe('MID');
    expect(classifyJourney(ctxInput({ tripDurationMin: 20, tripDistanceKm: 55 }))).toBe('LONG_HAUL');

    /* Kalan mesafe KUŞ UÇUŞU ise (kütük #404) uzun yol iddiası ÜRETİLMEZ. */
    const straight = classifyJourney(ctxInput({
      tripDurationMin: 10, tripDistanceKm: 4,
      guidanceActive: true, remainingMeters: 90_000, remainingIsRouteMeasured: false,
    }));
    expect(straight, 'tahmin ölçüm gibi kullanılmış').toBe('MID');

    const measured = classifyJourney(ctxInput({
      tripDurationMin: 10, tripDistanceKm: 4,
      guidanceActive: true, remainingMeters: 90_000, remainingIsRouteMeasured: true,
    }));
    expect(measured).toBe('LONG_HAUL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–7 · TERCİH KANITI: sınırlı, yerel, gizlilik-öncelikli
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8 · tercih kanıtı sınırlı ve dürüsttür', () => {
  const obs = (o: Partial<Parameters<typeof notePreferenceOutcome>[0]> = {}) =>
    notePreferenceOutcome({
      bucket: 'HIGHWAY_NIGHT', intent: 'ALBUM', libraryRef: 'album:gece',
      sourceClass: 'LOCAL', outcome: 'STARTED', nowMs: NOW, ...o,
    });

  it('5 · "başlatıldı" TEK BAŞINA tercih kanıtı değildir', () => {
    obs({ outcome: 'STARTED' });
    expect(bestPreferenceFor('HIGHWAY_NIGHT', getPreferenceEvidence(NOW)),
      'yalnız başlatma öneriye dönüşmüş').toBeNull();

    obs({ outcome: 'KEPT' });
    const best = bestPreferenceFor('HIGHWAY_NIGHT', getPreferenceEvidence(NOW));
    expect(best?.libraryRef).toBe('album:gece');
    expect(best?.kept).toBe(1);
  });

  it('6 · bağlamı bilinmeyen dinleme YAZILMAZ · sınır ve TTL uygulanır', () => {
    obs({ bucket: 'UNKNOWN', outcome: 'KEPT' });
    expect(getPreferenceEvidence(NOW).entries.some((e) => e.bucket === 'UNKNOWN'),
      'kanıtsız kovaya tercih yazılmış').toBe(false);

    for (let i = 0; i < MAX_PREFERENCE_ENTRIES + 12; i += 1) {
      obs({ libraryRef: `album:${i}`, outcome: 'KEPT', nowMs: NOW + i });
    }
    expect(getPreferenceEvidence(NOW + 1000).entries.length,
      'sınırsız profil büyümüş').toBeLessThanOrEqual(MAX_PREFERENCE_ENTRIES);

    /* TTL geçmiş kanıt CANLI sayılmaz — eski alışkanlık bugünü yönetmez. */
    expect(getPreferenceEvidence(NOW + PREFERENCE_TTL_MS + 60_000).entries).toHaveLength(0);
  });

  it('7 · GİZLİLİK — ad · URI · konum · sağlayıcı içerik kimliği SAKLANMAZ', () => {
    obs({ outcome: 'KEPT' });
    obs({
      bucket: 'CITY_DAY', intent: 'TRACKS', libraryRef: null,
      sourceClass: 'YOUTUBE', outcome: 'KEPT',
    });
    const raw = String(safeStorage.getItem(PREFERENCE_STORAGE_KEY) ?? '');
    expect(raw.length, 'kanıt hiç yazılmamış — kilit boş kümeye düştü').toBeGreaterThan(10);

    /* ŞEMA KİLİDİ: kalıcı satır YALNIZ bu alanları taşıyabilir. Yeni bir alan
       eklenirse (başlık · sanatçı · konum · sağlayıcı içerik kimliği) bu kilit
       DÜŞER — gizlilik sınırı sessizce genişletilemez. */
    const ALLOWED = ['key', 'bucket', 'intent', 'libraryRef', 'sourceClass',
      'starts', 'kept', 'abandoned', 'lastAtMs'];
    const rows = JSON.parse(raw) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort(), 'kalıcı kanıt şeması genişlemiş')
        .toEqual([...ALLOWED].sort());
    }

    /* İçerik/konum işaretçilerinin HİÇBİRİ kalıcı kanıta giremez. */
    for (const marker of ['http', 'content://', 'piped:', 'spotify:', 'file:',
      'lat', 'lon', 'destination', 'transcript', 'query']) {
      expect(raw.toLowerCase(), `yasak içerik işaretçisi kanıta sızmış: ${marker}`)
        .not.toContain(marker);
    }
    /* Sağlayıcı satırında yalnız KAYNAK SINIFI tutulur, içerik kimliği DEĞİL. */
    const provider = getPreferenceEvidence(NOW).entries.find((e) => e.sourceClass === 'YOUTUBE');
    expect(provider?.libraryRef, 'sağlayıcı içerik kimliği saklanmış').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8–13 · KARAR: fail-closed politika
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8 · karar fail-closed', () => {
  const context = (o: Partial<DrivingContextInput> = {}): DrivingContext =>
    classifyDrivingContext(ctxInput(o));

  const withEvidence = (kept: number, o: {
    bucket?: string; intent?: 'ALBUM' | 'TRACKS'; libraryRef?: string | null;
    sourceClass?: 'LOCAL' | 'YOUTUBE';
  } = {}) => {
    /* Her kurulum TEMİZ başlar: kanıt adedi testin söylediği kadar olmalı. */
    _resetPreferenceEvidenceForTest();
    try { safeStorage.removeItem(PREFERENCE_STORAGE_KEY); } catch { /* ignore */ }
    for (let i = 0; i < kept; i += 1) {
      notePreferenceOutcome({
        bucket: o.bucket ?? 'HIGHWAY_NIGHT',
        intent: o.intent ?? 'ALBUM',
        libraryRef: o.libraryRef === undefined ? 'album:gece' : o.libraryRef,
        sourceClass: o.sourceClass ?? 'LOCAL',
        outcome: 'KEPT',
        nowMs: NOW,
      });
    }
    return getPreferenceEvidence(NOW);
  };

  const decide = (o: {
    kept?: number; playbackActive?: boolean | null; sessionActive?: boolean;
    explicitIntentAtMs?: number | null; ctx?: Partial<DrivingContextInput>;
  } = {}) => decideMusicIntelligence({
    context: context(o.ctx),
    preference: withEvidence(o.kept ?? AUTO_RESUME_MIN_KEPT),
    playbackActive: o.playbackActive ?? false,
    sessionActive: o.sessionActive ?? false,
    explicitIntentAtMs: o.explicitIntentAtMs ?? null,
    nowMs: NOW,
  });

  it('8 · ses çıkıyorsa çalan müziğe DOKUNULMAZ', () => {
    const d = decide({ playbackActive: true });
    expect(d.action).toBe('HOLD');
    expect(d.reason).toBe('already_playing');
    expect(d.candidate, 'çalarken aday üretilmiş').toBeNull();
  });

  it('9 · açık kullanıcı niyeti otomasyondan ÜSTÜNDÜR', () => {
    const fresh = decide({ explicitIntentAtMs: NOW - 60_000 });
    expect(fresh.action).toBe('HOLD');
    expect(fresh.reason).toBe('explicit_user_intent');

    /* Pencere dolunca F8 yeniden konuşabilir. */
    const expired = decide({ explicitIntentAtMs: NOW - EXPLICIT_INTENT_TTL_MS - 1000 });
    expect(expired.action).not.toBe('HOLD');
  });

  it('10 · bağlam kanıtsızsa ne öneri ne otomatik eylem vardır', () => {
    const d = decide({ ctx: { speedKmh: null } });
    expect(d.action).toBe('HOLD');
    expect(d.reason).toBe('context_unproven');
    expect(d.bucket).toBe('UNKNOWN');
  });

  it('11 · kanıt yoksa öneri UYDURULMAZ', () => {
    const d = decideMusicIntelligence({
      context: context(),
      preference: getPreferenceEvidence(NOW),   // boş
      playbackActive: false,
      sessionActive: false,
      explicitIntentAtMs: null,
      nowMs: NOW,
    });
    expect(d.action).toBe('HOLD');
    expect(d.reason).toBe('no_evidence');
    expect(d.candidate).toBeNull();
  });

  it('12 · otomatik devam TÜM kapılar açıkken; aksi hâlde yalnız ÖNERİ', () => {
    const auto = decide({ kept: AUTO_RESUME_MIN_KEPT });
    expect(auto.action, 'kapılar açıkken otomatik devam üretilmedi').toBe('AUTO_RESUME');
    expect(auto.suppressedBy).toHaveLength(0);
    expect(auto.candidate?.selection).toEqual({ kind: 'ALBUM', albumId: 'album:gece' });

    /* Oturum sürüyorsa otomatik eylem YOK — yalnız öneri. */
    const busy = decide({ kept: AUTO_RESUME_MIN_KEPT, sessionActive: true });
    expect(busy.action).toBe('SUGGEST');
    expect(busy.suppressedBy).toContain('session_active');

    /* Yolculuk başlangıcı değilse otomatik eylem YOK. */
    const mid = decide({ kept: AUTO_RESUME_MIN_KEPT, ctx: { tripDurationMin: 30, tripDistanceKm: 12 } });
    expect(mid.action).toBe('SUGGEST');
    expect(mid.suppressedBy).toContain('journey_not_start');

    /* Alışkanlık henüz tekrarlanmadıysa otomatik eylem YOK. */
    const weak = decide({ kept: 1 });
    expect(weak.action).toBe('SUGGEST');
    expect(weak.suppressedBy).toContain('weak_evidence');
  });

  it('13 · sağlayıcı kanıtı içerik UYDURMAZ — kanonik devam önerilir', () => {
    const d = decideMusicIntelligence({
      context: context(),
      preference: withEvidence(AUTO_RESUME_MIN_KEPT, {
        intent: 'TRACKS', libraryRef: null, sourceClass: 'YOUTUBE',
      }),
      playbackActive: false, sessionActive: false, explicitIntentAtMs: null, nowMs: NOW,
    });
    expect(d.candidate?.selection).toEqual({ kind: 'RESUME', sourceClass: 'YOUTUBE' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–16 · RUNTIME: kanıt yazımı · zero-leak · LAB gözlemi
 * ════════════════════════════════════════════════════════════════════════ */

vi.mock('../platform/media/intelligence/drivingContextSources', () => ({
  readDrivingContextInput: () => ({
    speedKmh: 80, tripActive: true, tripDurationMin: 2, tripDistanceKm: 3,
    guidanceActive: false, remainingMeters: null, remainingIsRouteMeasured: false,
    localHour: 21, previousMotion: 'UNKNOWN' as const,
  }),
  readVehicleSpeedKmh: () => 80,
  readTrip: () => ({ active: true, durationMin: 2, distanceKm: 3 }),
  readGuidance: () => ({ active: false, remainingMeters: null, routeMeasured: false }),
  readLocalHour: () => 21,
}));

describe('F8 · runtime kanıtı oturumdan türetir', () => {
  it('14 · kullanıcı oturumu kanıt yazar ve F8\'i SUSTURUR; geri yükleme YAZMAZ', async () => {
    const rt = await import('../platform/media/intelligence/musicIntelligenceRuntime');
    const session = await import('../platform/media/session/listeningSession');
    const telemetry = await import('../platform/media/intelligence/intelligenceTelemetry');

    session._resetListeningSessionForTest();
    telemetry._resetIntelligenceTelemetryForTest();
    rt._resetMusicIntelligenceForTest();
    _resetPreferenceEvidenceForTest();
    rt.startMusicIntelligence();

    session.startListeningSession({
      intent: 'ALBUM', intentRef: 'album:gece', source: 'LOCAL',
      queueId: 'q1', queueRevision: 1, nowMs: Date.now(),
      currentItem: {
        libraryId: 'media:a', providerId: 'media:a', providerNamespace: 'MEDIASTORE',
        contentUri: 'content:///a', title: 'x', artist: 'y', album: 'z',
        durationMs: 1, trackNumber: 1, discNumber: 1,
      },
    });

    expect(telemetry.getIntelligenceTelemetry().counters.notedStarted,
      'kullanıcı oturumu kanıt yazmadı').toBeGreaterThan(0);
    expect(rt.getExplicitUserIntentAtMs(), 'açık niyet penceresi açılmadı').not.toBeNull();

    /* Geri yüklenen oturum bir SEÇİM değildir. */
    const before = telemetry.getIntelligenceTelemetry().counters.notedStarted;
    session._resetListeningSessionForTest();
    session.startListeningSession({
      intent: 'ALBUM', intentRef: 'album:baska', source: 'LOCAL',
      queueId: 'q2', queueRevision: 1, nowMs: Date.now(), restored: true,
    });
    expect(telemetry.getIntelligenceTelemetry().counters.notedStarted,
      'geri yükleme kullanıcı seçimi sayılmış').toBe(before);

    rt.stopMusicIntelligence();
  });

  it('15 · kısa kalış BIRAKILDI, uzun kalış KORUNDU olarak yazılır', async () => {
    const rt = await import('../platform/media/intelligence/musicIntelligenceRuntime');
    const session = await import('../platform/media/session/listeningSession');
    const telemetry = await import('../platform/media/intelligence/intelligenceTelemetry');

    session._resetListeningSessionForTest();
    telemetry._resetIntelligenceTelemetryForTest();
    rt._resetMusicIntelligenceForTest();
    _resetPreferenceEvidenceForTest();
    rt.startMusicIntelligence();

    // Az önce başlamış bir oturum → hemen değişirse BIRAKILDI.
    session.startListeningSession({
      intent: 'ALBUM', intentRef: 'album:a', source: 'LOCAL',
      queueId: 'q1', queueRevision: 1, nowMs: Date.now(),
    });
    session.startListeningSession({
      intent: 'ALBUM', intentRef: 'album:b', source: 'LOCAL',
      queueId: 'q2', queueRevision: 1, nowMs: Date.now(),
    });
    expect(telemetry.getIntelligenceTelemetry().counters.notedAbandoned,
      'kısa kalış korundu sayılmış').toBeGreaterThan(0);

    /* Uzun süredir açık bir oturum → kapanınca KORUNDU.
       `endListeningSession` KULLANILIR: test reset'i aboneleri de düşürür ve
       kilidi sessizce boş kümeye çevirirdi. */
    session.startListeningSession({
      intent: 'FOLDER', intentRef: 'folder:yol', source: 'LOCAL',
      queueId: 'q3', queueRevision: 1, nowMs: Date.now() - 10 * 60_000,
    });
    session.endListeningSession();   // oturum düştü → flush
    expect(telemetry.getIntelligenceTelemetry().counters.notedKept,
      'uzun kalış korundu sayılmadı').toBeGreaterThan(0);

    rt.stopMusicIntelligence();
  });

  it('16 · LAB okuması karar ÜRETMEZ ve üretim durumunu DEĞİŞTİRMEZ · zero-leak', async () => {
    const rt = await import('../platform/media/intelligence/musicIntelligenceRuntime');
    const session = await import('../platform/media/session/listeningSession');
    const telemetry = await import('../platform/media/intelligence/intelligenceTelemetry');

    session._resetListeningSessionForTest();
    telemetry._resetIntelligenceTelemetryForTest();
    rt._resetMusicIntelligenceForTest();
    rt.startMusicIntelligence();

    const before = telemetry.getIntelligenceTelemetry().counters.evaluations;
    rt.peekDrivingContext();
    rt.peekDrivingContext();
    expect(telemetry.getIntelligenceTelemetry().counters.evaluations,
      'LAB okuması karar üretmiş (ikinci otorite)').toBe(before);

    /* Değerlendirme ölçülür — latency LAB'da görünür. */
    rt.evaluateMusicIntelligence();
    const t = telemetry.getIntelligenceTelemetry();
    expect(t.counters.evaluations).toBe(before + 1);
    expect(t.lastAction).not.toBeNull();
    expect(t.decideP50Ms, 'karar süresi ölçülmemiş').not.toBeNull();

    /* Zero-Leak: durdurunca abonelik bırakılır ve yeni oturum kanıt yazmaz. */
    rt.stopMusicIntelligence();
    expect(rt.isMusicIntelligenceStarted()).toBe(false);
    const noted = telemetry.getIntelligenceTelemetry().counters.notedStarted;
    session.startListeningSession({
      intent: 'ALBUM', intentRef: 'album:sonra', source: 'LOCAL',
      queueId: 'q9', queueRevision: 1, nowMs: Date.now(),
    });
    expect(telemetry.getIntelligenceTelemetry().counters.notedStarted,
      'durdurulan katman hâlâ yazıyor (sızıntı)').toBe(noted);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 17 · AUTHORITY SINIRI (statik kilit)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8 · ikinci otorite KURMAZ', () => {
  it('17 · F8 playback · kuyruk · arama otoritesi değildir; saf modeller SAF kalır', () => {
    const model = strip(read('src/platform/media/intelligence/musicIntelligenceModel.ts'));
    const context = strip(read('src/platform/media/intelligence/drivingContextModel.ts'));
    expect(model.length, 'karar modeli okunamadı — kilit boş kümeye düştü').toBeGreaterThan(1500);
    expect(context.length, 'bağlam modeli okunamadı — kilit boş kümeye düştü').toBeGreaterThan(1500);

    for (const [name, src] of [['karar modeli', model], ['bağlam modeli', context]] as const) {
      expect(src, `${name} kapıya inmiş`).not.toContain('mediaCommandGateway');
      expect(src, `${name} native köprüye inmiş`).not.toContain('nativeAuthorityBridge');
      expect(src, `${name} kanonik kuyruğa yazmış`).not.toContain('session/playQueue');
      expect(src, `${name} zamana bağımlı (saf değil)`).not.toContain('Date.now');
      expect(src, `${name} timer kurmuş`).not.toMatch(/setInterval|setTimeout/);
      expect(src, `${name} React'e bağlanmış`).not.toContain("from 'react'");
    }

    const runtime = strip(read('src/platform/media/intelligence/musicIntelligenceRuntime.ts'));
    /* Timer/polling YOK — yalnız kanonik oturum aboneliği. */
    expect(runtime, 'F8 kendi zamanlayıcısını kurmuş').not.toMatch(/setInterval\s*\(/);
    expect(runtime, 'F8 kendi yoklama döngüsünü kurmuş').not.toMatch(/setTimeout\s*\(/);
    expect(runtime, 'kanonik oturum aboneliği kaldırılmış').toContain('subscribeListeningSession');
    /* Yürütme KANONİK yollardır; sağlayıcıya/native'e doğrudan komut YOK. */
    expect(runtime, 'F8 kanonik F3 yolunu atlamış').toContain('startLibraryListening');
    expect(runtime, 'F8 doğrudan sağlayıcı komutu vermiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(runtime, 'F8 doğrudan kapıya inmiş').not.toContain('mediaCommandGateway');
    expect(runtime, 'F8 kanonik kuyruğu kendisi yazmış').not.toContain('session/playQueue');
  });
});
