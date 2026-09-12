/**
 * musicF18SmartRadioEndlessMix.test.ts — MUSIC F18 · Kesintisiz akış.
 *
 * F18'in tek riski şudur: "radyo" adı altında İKİNCİ bir kuyruk otoritesi ve
 * kanıtsız bir kişiselleştirme iddiası doğurmak. Bu paket ikisini de KİLİTLER:
 *
 *   · Smart Radio yalnız ADAY SIRASI üretir; kuyruk/oturum truth'u F3'tedir
 *   · yürütme kanonik zincirdedir (append/start) — ikinci yol YOK
 *   · çalan müziğe karışılmaz: ses varken sıra EKLENİR, baştan alınmaz
 *   · kuyruğu desteklemeyen kaynakta dürüstçe REDDEDİLİR (F7.6 korunur)
 *   · karma-sağlayıcı kuyruk ÜRETİLMEZ (havuz yalnız yerel)
 *   · zayıf kanıtta "sana özel/benzer" iddiası KURULMAZ
 *   · kanıt yoksa sıra DETERMİNİSTİKtir (rastgelelik yok)
 *   · tekrar SINIRLI azaltılır; eleme havuzu bitirirse dürüstçe geri alınır
 *   · kalıcı "radyo state" YOKTUR (sonsuz büyüme yok)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  allowsSimilarityClaim, buildRadioSequence, DEFAULT_RADIO_LENGTH, MAX_RADIO_LENGTH,
  MEASURED_CLAIM_MIN_COUNT, similarityToSeed, stableHash,
  type RadioCandidate, type RadioPolicyInput,
} from '../platform/media/radio/smartRadioModel';
import {
  _resetSmartRadioTelemetryForTest, getSmartRadioTelemetry,
} from '../platform/media/radio/smartRadioTelemetry';
import {
  makeSonicDescriptor, type SonicAnalysisInput, type SonicDescriptor,
} from '../platform/media/sonic/sonicDescriptor';
import {
  makeTraitEvidence, NO_TRAIT_EVIDENCE, type MusicTraitEvidence,
} from '../platform/media/traits/musicTraitEvidence';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';
import { RADIO_KINDS, makeIntent, makeOutcome } from '../platform/media/intent/musicIntent';
import { speakMusicOutcome, claimIsHonest } from '../platform/media/intent/musicIntentSpeech';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function descriptor(over: Partial<SonicAnalysisInput> = {}): SonicDescriptor {
  const d = makeSonicDescriptor({
    analyzed: true, reason: 'OK', sampleRate: 11025, analyzedMs: 20000,
    peakDbfs: -1.2, rmsDbfs: -14.5, crestDb: 13.3, zeroCrossingRate: 0.08,
    spectralCentroidHz: 1800, spectralRolloffHz: 4200, spectralFlux: 0.42,
    onsetRate: 2.1, tempoBpm: 128, tempoConfidence: 0.7,
    bands: [0.2, 0.18, 0.16, 0.14, 0.12, 0.09, 0.06, 0.05],
    ...over,
  });
  if (d === null) throw new Error('fixture geçersiz');
  return d;
}

function energyEvidence(energy: number): MusicTraitEvidence {
  return makeTraitEvidence({
    provenance: 'LIBRARY_METADATA', sourceId: 'test', energy, confidence: 'LOW',
  });
}

function candidate(over: Partial<RadioCandidate> & { id: string }): RadioCandidate {
  return {
    artistKey: null,
    evidence: NO_TRAIT_EVIDENCE,
    descriptor: null,
    favorite: false,
    recentRank: null,
    ...over,
  };
}

function policy(over: Partial<RadioPolicyInput> = {}): RadioPolicyInput {
  return {
    seedKind: 'CURRENT_TRACK',
    seedId: 'seed',
    seedEvidence: null,
    seedDescriptor: null,
    candidates: [],
    favoritesOnly: false,
    targetLength: DEFAULT_RADIO_LENGTH,
    drivingBias: 'NONE',
    ...over,
  };
}

beforeEach(() => {
  _resetSmartRadioTelemetryForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SIRA POLİTİKASI — kanıt neyse iddia o
 * ════════════════════════════════════════════════════════════════════════ */

describe('F18 · iddia sınıfı kanıtı AŞMAZ', () => {
  it('1 · ölçülmüş benzerlik yeterince yaygınsa MEASURED iddiası doğar', () => {
    const seed = descriptor();
    const cands = Array.from({ length: 8 }, (_, i) => candidate({
      id: `t${i}`, descriptor: descriptor({ tempoBpm: 126 + i }),
    }));
    const seq = buildRadioSequence(policy({ seedDescriptor: seed, candidates: cands }));

    expect(seq.status).toBe('READY');
    expect(seq.claimClass).toBe('MEASURED');
    expect(seq.measuredCount).toBeGreaterThanOrEqual(MEASURED_CLAIM_MIN_COUNT);
    expect(allowsSimilarityClaim(seq)).toBe(true);
  });

  it('2 · tek bir ölçülmüş aday MEASURED iddiası KURDURMAZ', () => {
    const cands = [
      candidate({ id: 'measured', descriptor: descriptor() }),
      ...Array.from({ length: 9 }, (_, i) => candidate({ id: `x${i}` })),
    ];
    const seq = buildRadioSequence(policy({ seedDescriptor: descriptor(), candidates: cands }));
    expect(seq.measuredCount).toBe(1);
    expect(seq.claimClass, 'tek ölçümle "ölçülmüş radyo" iddiası kurulmuş').not.toBe('MEASURED');
    expect(allowsSimilarityClaim(seq)).toBe(false);
  });

  it('3 · yalnız etiket kanıtı varsa WEAK, hiç kanıt yoksa FALLBACK', () => {
    const weak = buildRadioSequence(policy({
      seedEvidence: energyEvidence(0.5),
      candidates: Array.from({ length: 6 }, (_, i) => candidate({
        id: `t${i}`, evidence: energyEvidence(0.5 + i * 0.05),
      })),
    }));
    expect(weak.claimClass).toBe('WEAK');
    expect(allowsSimilarityClaim(weak)).toBe(false);

    const fallback = buildRadioSequence(policy({
      candidates: Array.from({ length: 6 }, (_, i) => candidate({ id: `t${i}` })),
    }));
    expect(fallback.claimClass).toBe('FALLBACK');
    expect(fallback.reasonCode).toBe('deterministic_fallback');
    expect(fallback.trackIds.length, 'kanıt yokken akış tamamen durmuş').toBeGreaterThan(0);
  });

  it('4 · benzerlik yalnız kanıt varken hesaplanır', () => {
    const c = candidate({ id: 'a' });
    expect(similarityToSeed(null, null, c), 'kanıtsız benzerlik üretilmiş').toBeNull();
    expect(similarityToSeed(descriptor(), null, c)).toBeNull();

    const measured = similarityToSeed(descriptor(), null, candidate({ id: 'a', descriptor: descriptor() }));
    expect(measured?.measured).toBe(true);

    const weak = similarityToSeed(null, energyEvidence(0.5), candidate({
      id: 'a', evidence: energyEvidence(0.55),
    }));
    expect(weak?.measured, 'zayıf kanıt "ölçülmüş" sayılmış').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · DETERMİNİZM · SINIRLAR · TEKRAR AZALTMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('F18 · sıra deterministik, sınırlı ve tekrarı dürüstçe azaltır', () => {
  it('5 · kanıtsız sıra RASTGELE DEĞİLDİR (aynı girdi aynı sıra)', () => {
    const cands = Array.from({ length: 12 }, (_, i) => candidate({ id: `t${i}` }));
    const a = buildRadioSequence(policy({ candidates: cands }));
    const b = buildRadioSequence(policy({ candidates: cands }));
    expect(a.trackIds).toEqual(b.trackIds);
    /* Kararlı karma gerçekten ayırt ediyor mu (kilit kör kalmasın). */
    expect(stableHash('a')).not.toBe(stableHash('b'));
  });

  it('6 · uzunluk SINIRLIDIR ve tavanı aşamaz', () => {
    const cands = Array.from({ length: 200 }, (_, i) => candidate({ id: `t${i}` }));
    const seq = buildRadioSequence(policy({ candidates: cands, targetLength: 5000 }));
    expect(seq.trackIds.length).toBeLessThanOrEqual(MAX_RADIO_LENGTH);
    expect(seq.trackIds.length).toBeGreaterThan(0);
  });

  it('7 · çekirdek parça sıraya GİRMEZ', () => {
    const cands = [candidate({ id: 'seed' }), candidate({ id: 'other' })];
    const seq = buildRadioSequence(policy({ seedId: 'seed', candidates: cands }));
    expect(seq.trackIds).not.toContain('seed');
    expect(seq.trackIds).toContain('other');
  });

  it('8 · yakın geçmişte çalanlar elenir; havuz yetmezse dürüstçe geri alınır', () => {
    /* Havuz bol: yakın geçmiş TAMAMEN elenir. */
    const rich = buildRadioSequence(policy({
      targetLength: 3,
      candidates: [
        candidate({ id: 'r0', recentRank: 0 }),
        candidate({ id: 'r1', recentRank: 1 }),
        ...Array.from({ length: 10 }, (_, i) => candidate({ id: `f${i}` })),
      ],
    }));
    expect(rich.excludedRecent).toBe(2);
    expect(rich.recentReadmitted).toBe(0);
    expect(rich.trackIds).not.toContain('r0');

    /* Havuz dar: eleme akışı bitirirse EN ESKİ çalan geri alınır ve SAYILIR. */
    const poor = buildRadioSequence(policy({
      targetLength: 3,
      candidates: [
        candidate({ id: 'r0', recentRank: 0 }),
        candidate({ id: 'r5', recentRank: 5 }),
        candidate({ id: 'fresh' }),
      ],
    }));
    expect(poor.recentReadmitted).toBeGreaterThan(0);
    expect(poor.trackIds.length).toBeGreaterThan(1);
    /* Geri alma EN ESKİDEN başlar: r5 (daha eski) r0'dan önce gelir. */
    expect(poor.trackIds).toContain('r5');
  });

  it('9 · aynı sanatçı arka arkaya gelmez (alternatif varken)', () => {
    const cands = [
      candidate({ id: 'a1', artistKey: 'a' }),
      candidate({ id: 'a2', artistKey: 'a' }),
      candidate({ id: 'b1', artistKey: 'b' }),
      candidate({ id: 'a3', artistKey: 'a' }),
    ];
    const seq = buildRadioSequence(policy({ candidates: cands, targetLength: 4 }));
    let adjacent = 0;
    for (let i = 1; i < seq.trackIds.length; i += 1) {
      const prev = cands.find((c) => c.id === seq.trackIds[i - 1])?.artistKey;
      const cur = cands.find((c) => c.id === seq.trackIds[i])?.artistKey;
      if (prev !== null && prev === cur) adjacent += 1;
    }
    /* 3 "a" ve 1 "b" varken en fazla bir bitişiklik kaçınılmazdır. */
    expect(adjacent).toBeLessThanOrEqual(1);
    expect(seq.artistSpacingApplied).toBeGreaterThan(0);
  });

  it('10 · favori havuzu istendiğinde SADECE favoriler girer', () => {
    const seq = buildRadioSequence(policy({
      seedId: null, favoritesOnly: true, seedKind: 'FAVORITES',
      candidates: [
        candidate({ id: 'fav1', favorite: true }),
        candidate({ id: 'plain' }),
        candidate({ id: 'fav2', favorite: true }),
      ],
    }));
    expect(seq.trackIds).not.toContain('plain');
    expect([...seq.trackIds].sort()).toEqual(['fav1', 'fav2']);
  });

  it('11 · boş kütüphane ve aday yok DURUMLARI ayrışır (sahte sıra yok)', () => {
    expect(buildRadioSequence(policy({ candidates: [] })).status).toBe('EMPTY_LIBRARY');
    const only = buildRadioSequence(policy({ seedId: 'seed', candidates: [candidate({ id: 'seed' })] }));
    expect(only.status).toBe('NO_CANDIDATES');
    expect(only.trackIds).toHaveLength(0);
    expect(only.startTrackId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · YÜRÜTME — kanonik zincir, çalan müziğe karışmama
 * ════════════════════════════════════════════════════════════════════════ */

describe('F18 · yürütme kanonik F3 zincirindedir ve çalan müziğe karışmaz', () => {
  it('12 · ses çalarken sıra EKLENİR (yeni kuyruk kurulmaz)', async () => {
    vi.resetModules();
    const append = vi.fn(async () => ({ applied: true, reason: 'eklendi', queueResult: null, truth: null }));
    const start = vi.fn(async () => ({ started: true, reason: 'başladı' }));
    vi.doMock('../platform/media/session/listeningSessionRuntime', () => ({
      appendLibraryTracksToQueue: append,
      startLibraryListening: start,
      sourceSupportsQueue: () => true,
    }));
    vi.doMock('../platform/media/session/playQueue', () => ({
      getDesiredQueue: () => ({ entries: [{ entryId: 'e1' }], source: 'LOCAL', queueId: 'q', revision: 1, currentIndex: 0 }),
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({
        tracks: Array.from({ length: 6 }, (_, i) => ({
          id: `t${i}`, title: `T${i}`, artist: `A${i}`, durationMs: 200000,
          availability: 'AVAILABLE', contentUri: `content://${i}`,
          genre: null, generationModified: 1,
        })),
      }),
    }));
    const { startSmartRadio } = await import('../platform/media/radio/smartRadioRuntime');
    const out = await startSmartRadio('CONTINUE_LIKE_THIS');

    expect(out.execution).toBe('APPENDED');
    expect(append).toHaveBeenCalledTimes(1);
    expect(start, 'çalan müzik varken yeni kuyruk kurulmuş').not.toHaveBeenCalled();
    vi.doUnmock('../platform/media/session/listeningSessionRuntime');
    vi.doUnmock('../platform/media/session/playQueue');
    vi.doUnmock('../platform/media/musicIndex');
  });

  it('13 · kuyruğu desteklemeyen kaynakta ekleme DÜRÜSTÇE reddedilir', async () => {
    vi.resetModules();
    const append = vi.fn(async () => ({ applied: true, reason: 'x', queueResult: null, truth: null }));
    vi.doMock('../platform/media/session/listeningSessionRuntime', () => ({
      appendLibraryTracksToQueue: append,
      startLibraryListening: vi.fn(async () => ({ started: true, reason: '' })),
      sourceSupportsQueue: () => false,
    }));
    vi.doMock('../platform/media/session/playQueue', () => ({
      getDesiredQueue: () => ({ entries: [{ entryId: 'e1' }], source: 'STREAM', queueId: 'q', revision: 1, currentIndex: 0 }),
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({
        tracks: Array.from({ length: 6 }, (_, i) => ({
          id: `t${i}`, title: `T${i}`, artist: `A${i}`, durationMs: 200000,
          availability: 'AVAILABLE', contentUri: `content://${i}`,
          genre: null, generationModified: 1,
        })),
      }),
    }));
    const { startSmartRadio } = await import('../platform/media/radio/smartRadioRuntime');
    const out = await startSmartRadio('CONTINUE_LIKE_THIS');

    expect(out.execution).toBe('REJECTED');
    expect(out.appliedCount).toBe(0);
    expect(append, 'desteklenmeyen kaynakta yine de ekleme denenmiş').not.toHaveBeenCalled();
    vi.doUnmock('../platform/media/session/listeningSessionRuntime');
    vi.doUnmock('../platform/media/session/playQueue');
    vi.doUnmock('../platform/media/musicIndex');
  });

  it('14 · ses yokken YENİ akış kanonik startLibraryListening ile kurulur', async () => {
    vi.resetModules();
    const start = vi.fn(async () => ({ started: true, reason: 'başladı' }));
    vi.doMock('../platform/media/session/listeningSessionRuntime', () => ({
      appendLibraryTracksToQueue: vi.fn(),
      startLibraryListening: start,
      sourceSupportsQueue: () => true,
    }));
    vi.doMock('../platform/media/session/playQueue', () => ({
      getDesiredQueue: () => ({ entries: [], source: null, queueId: '', revision: 0, currentIndex: -1 }),
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({
        tracks: Array.from({ length: 6 }, (_, i) => ({
          id: `t${i}`, title: `T${i}`, artist: `A${i}`, durationMs: 200000,
          availability: 'AVAILABLE', contentUri: `content://${i}`,
          genre: null, generationModified: 1,
        })),
      }),
    }));
    const { startSmartRadio } = await import('../platform/media/radio/smartRadioRuntime');
    const out = await startSmartRadio('RADIO_FROM_CURRENT');

    expect(out.execution).toBe('STARTED');
    expect(start).toHaveBeenCalledTimes(1);
    const selection = start.mock.calls[0]?.[0] as { kind: string; trackIds: string[] };
    expect(selection.kind, 'kanonik TRACKS seçimi kullanılmamış').toBe('TRACKS');
    expect(selection.trackIds.length).toBeGreaterThan(0);
    vi.doUnmock('../platform/media/session/listeningSessionRuntime');
    vi.doUnmock('../platform/media/session/playQueue');
    vi.doUnmock('../platform/media/musicIndex');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · MAVİ HATTI — aynı kanonik MusicIntent yolu
 * ════════════════════════════════════════════════════════════════════════ */

describe('F18 · Mavi istekleri kanonik MusicIntent hattından geçer', () => {
  it('15 · dört akış ifadesi de kanonik niyete çözülür', () => {
    expect(resolveMusicIntent('bunun gibi devam et')?.kind).toBe('CONTINUE_LIKE_THIS');
    expect(resolveMusicIntent('bu şarkıdan radyo oluştur')?.kind).toBe('START_RADIO');
    expect(resolveMusicIntent('favorilerimden karışık çal')?.kind).toBe('PLAY_FAVORITES_MIX');
    expect(resolveMusicIntent('uzun yol için bir şeyler çal')?.kind).toBe('LONG_DRIVE_MIX');
    for (const k of ['CONTINUE_LIKE_THIS', 'START_RADIO', 'PLAY_FAVORITES_MIX', 'LONG_DRIVE_MIX']) {
      expect(RADIO_KINDS).toContain(k);
    }
  });

  it('16 · F13 "favorilerimden çal" F18 karışığına KAYMAZ', () => {
    /* İki kavram birbirine dönüşmez: adsız favori çalma HÂLÂ F13'tür. */
    expect(resolveMusicIntent('favorilerimden çal')?.kind).toBe('PLAY_FAVORITES');
    expect(resolveMusicIntent('favorilerimi aç')?.kind).toBe('PLAY_FAVORITES');
  });

  it('17 · konuşma cümlesi iddia sınıfını AŞMAZ', () => {
    const intent = makeIntent('CONTINUE_LIKE_THIS');
    const measured = makeOutcome(intent, 'F18_SMART_RADIO', 'ACCEPTED_UNVERIFIED',
      'radio_appended_measured');
    const fallback = makeOutcome(intent, 'F18_SMART_RADIO', 'ACCEPTED_UNVERIFIED',
      'radio_appended_fallback');

    const measuredSpeech = speakMusicOutcome(measured);
    const fallbackSpeech = speakMusicOutcome(fallback);

    expect(measuredSpeech).toMatch(/benze/i);
    /* Kanıt yokken "benzer / sana özel" İDDİA EDİLMEZ. */
    expect(fallbackSpeech, 'kanıtsızken benzerlik iddiası kurulmuş').not.toMatch(/benze/i);
    expect(fallbackSpeech).not.toMatch(/sana özel|seversin|senin için seçtim/i);
    /* Hiçbiri tamamlanmış eylem iddiası taşımaz (ATTEMPTED derecesi). */
    expect(claimIsHonest(measured, measuredSpeech)).toBe(true);
    expect(claimIsHonest(fallback, fallbackSpeech)).toBe(true);
  });

  it('18 · reddedilen akış dürüst neden söyler, sahte başarı kurmaz', () => {
    const out = makeOutcome(makeIntent('START_RADIO'), 'F18_SMART_RADIO',
      'UNAVAILABLE', 'radio_no_candidate');
    const speech = speakMusicOutcome(out);
    expect(speech).toContain('bulamadım');
    expect(claimIsHonest(out, speech)).toBe(true);
    /* Teknik kod kullanıcıya OKUNMAZ (§14). */
    expect(speech).not.toContain('radio_no_candidate');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · MİMARİ SINIRLAR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F18 · ikinci otorite açılmaz, kalıcı radyo state kurulmaz', () => {
  it('19 · saf politika katmanı I/O · timer · global durum TAŞIMAZ', () => {
    const raw = read('src/platform/media/radio/smartRadioModel.ts');
    expect(raw.length, 'model okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    const src = codeOnly(raw);
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src, 'saf modelde Date.now var').not.toMatch(/Date\.now/);
    expect(src, 'saf modelde rastgelelik var').not.toMatch(/Math\.random/);
    expect(src, 'saf model kalıcılığa yazmış').not.toMatch(/safeStorage|localStorage/);
  });

  it('20 · runtime kendi kuyruğunu KURMAZ — kanonik F3 seam\'lerini kullanır', () => {
    const raw = read('src/platform/media/radio/smartRadioRuntime.ts');
    expect(raw.length).toBeGreaterThan(2000);
    const src = codeOnly(raw);
    expect(src, 'runtime kuyruğa DOĞRUDAN yazmış')
      .not.toMatch(/\b(createQueue|addToQueue|setCurrentIndex|clearQueue|reorder)\s*\(/);
    expect(src, 'runtime native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(src, 'runtime gateway\'e doğrudan komut vermiş').not.toContain('mediaCommandGateway');
    expect(src, 'kanonik ekleme seam\'i kullanılmamış').toContain('appendLibraryTracksToQueue');
    expect(src, 'kanonik başlatma seam\'i kullanılmamış').toContain('startLibraryListening');
    /* Kalıcı radyo state YOK. */
    expect(src, 'kalıcı radyo durumu yazılmış').not.toMatch(/safeStorage|localStorage/);
    expect(src, 'runtime timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('21 · havuz yalnız YEREL kütüphanedir (karma-sağlayıcı kuyruk yok)', () => {
    const src = codeOnly(read('src/platform/media/radio/smartRadioRuntime.ts'));
    expect(src, 'sağlayıcı arama sonucu havuza sokulmuş')
      .not.toMatch(/pipedProvider|spotifyService|searchAllSources|unifiedFromSearchResult/);
    expect(src).toContain('getMusicLibrarySnapshot');
    /* Sağlayıcı favorileri de dışlanır. */
    expect(src).toContain("f.kind === 'LOCAL'");
  });

  it('22 · ekleme seam\'i kanonik girdi kurucusunu ve kanonik mutasyonu kullanır', () => {
    const src = codeOnly(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(src, 'ekleme seam\'i yok').toContain('appendLibraryTracksToQueue');
    /* İkinci bir QueueEntry kurucusu İCAT EDİLMEMİŞ olmalı. */
    expect(src).toMatch(/appendLibraryTracksToQueue[\s\S]{0,400}buildLibraryQueueContext/);
    expect(src).toMatch(/appendLibraryTracksToQueue[\s\S]{0,400}addToQueue/);
    /* Ekleme çalma durumunu DEĞİŞTİRMEZ (forcePlay false). */
    expect(src).toMatch(/appendLibraryTracksToQueue[\s\S]{0,500}false, nowMs/);
  });

  it('23 · LAB kartı salt gözlemdir — plan ÜRETMEZ, parça adı TAŞIMAZ', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('25 · Kesintisiz Akış / Smart Radio (F18)');
    const sources = codeOnly(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources, 'LAB plan üretmiş').not.toMatch(/\b(planSmartRadio|startSmartRadio)\s*\(/);
    expect(sources, 'LAB parça kimliği taşımış').not.toMatch(/f18(Track|Title|Artist)/);
  });

  it('24 · telemetri metin/ad TAŞIMAZ (gizlilik sınırı)', () => {
    const src = read('src/platform/media/radio/smartRadioTelemetry.ts');
    for (const f of ['title', 'artist', 'uri', 'query', 'utterance', 'transcript', 'location']) {
      expect(src.toLowerCase(), `yasaklı alan telemetriye sızmış: ${f}`)
        .not.toContain(`${f}:`);
    }
    /* Sayaç gerçekten var (kilit kör kalmasın). */
    expect(src).toContain('claimMeasured');
    expect(getSmartRadioTelemetry().counters.requests).toBe(0);
  });
});
