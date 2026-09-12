/**
 * musicF17SonicAudioIntelligence.test.ts — MUSIC F17 · SESTEN ölçülen kanıt.
 *
 * F10.1 bir ETİKET okumasıydı (ID3 `TBPM`): üreticinin yazdığı sayı. F17 ilk
 * kez dosyayı DECODE eder ve dalga formunun kendisini ölçer. Bu paket F17'nin
 * dürüstlük ve bütçe sınırlarını KİLİTLER:
 *
 *   · ölçüm gerçekten yapıldıysa `MEASURED_AUDIO`, aksi hâlde HİÇBİR kanıt yok
 *   · zayıf otokorelasyon tepesi TEMPO SAYILMAZ (uydurma BPM yasağı)
 *   · dalga formundan MOOD ÜRETİLMEZ (uydurma ruh hâli yasağı)
 *   · bozuk/desteklenmeyen/sessiz dosya sahte ölçüm ÜRETMEZ
 *   · aynı dosya tekrar tekrar ÇÖZÜLMEZ; dosya değişince kanıt BAYATLAR
 *   · iptal edilen turun sonucu yeni gerçeğe YAZILAMAZ (§17)
 *   · termal/bellek/düşük-uç baskısında ölçüm HİÇ yapılmaz (§7)
 *   · F10 zinciri yeniden yazılmadan güçlenir (ölçüm etiketi EZER)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const analyzeMock = vi.fn();
const cancelMock = vi.fn(async () => ({ generation: 1 }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    analyzeTrackAudio: (o: { uris: string[]; maxItems?: number }) => analyzeMock(o),
    cancelTrackAudioAnalysis: () => cancelMock(),
    readTrackTraits: async () => ({ traits: [], scanned: 0, limited: false }),
  },
}));

const tierMock = vi.fn(() => 'high' as 'low' | 'mid' | 'high');
vi.mock('../platform/deviceCapabilities', () => ({
  getDeviceTier: () => tierMock(),
}));

const thermalMock = vi.fn(() => 0);
vi.mock('../platform/thermalWatchdog', () => ({
  getThermalLevel: () => thermalMock(),
}));

const memoryMock = vi.fn(() => 'NORMAL');
vi.mock('../platform/memoryWatchdog', () => ({
  getMemoryTrimEvidence: () => ({ currentLevel: memoryMock() }),
}));

const playingMock = vi.fn(() => false);
vi.mock('../platform/media/authority/musicCanonicalSnapshot', () => ({
  getMusicCanonicalSnapshot: () => ({ playing: playingMock() }),
}));

import {
  descriptorToTraitEvidence, makeSonicDescriptor, sonicEnergyProxy, sonicSimilarity,
  SONIC_BAND_COUNT, SONIC_SCHEMA_VERSION, STRONG_ANALYSIS_MS,
  TEMPO_CONFIDENCE_MIN, TEMPO_CONFIDENCE_STRONG,
  type SonicAnalysisInput,
} from '../platform/media/sonic/sonicDescriptor';
import {
  admitSonicAnalysis, batchSizeForTier,
} from '../platform/media/sonic/sonicAdmissionModel';
import {
  _resetSonicRuntimeForTest, _setSonicDescriptorForTest, cancelSonicAnalysis,
  getSonicCacheSize, MAX_SONIC_CACHE, MAX_TRANSIENT_RETRY, peekSonicDescriptor,
  pendingSonicTracks, runSonicAnalysis, sonicCacheKey,
} from '../platform/media/sonic/sonicAnalysisRuntime';
import {
  _resetSonicTelemetryForTest, getSonicTelemetry,
} from '../platform/media/sonic/sonicTelemetry';
import {
  _resetTraitRuntimeForTest, _setEmbeddedBpmForTest, resolveTraitEvidence,
  TRAIT_SCHEMA_VERSION,
} from '../platform/media/traits/traitRuntime';
import { _resetTraitTelemetryForTest, getTraitTelemetry } from '../platform/media/traits/traitTelemetry';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Yorumları söker — saflık kilidi KODU denetler, açıklamayı değil.
 * (Dosyaların saflık başlığı zaten `Date.now` sözcüğünü İÇERİR.)
 */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/** Geçerli bir ölçüm satırı (native'in döndürdüğü şekil). */
function row(over: Partial<SonicAnalysisInput> & { uri?: string } = {}): SonicAnalysisInput & { uri: string } {
  return {
    uri: 'content://audio/1',
    analyzed: true,
    reason: 'OK',
    sampleRate: 11025,
    analyzedMs: 20000,
    peakDbfs: -1.2,
    rmsDbfs: -14.5,
    crestDb: 13.3,
    zeroCrossingRate: 0.08,
    spectralCentroidHz: 1800,
    spectralRolloffHz: 4200,
    spectralFlux: 0.42,
    onsetRate: 2.1,
    tempoBpm: 128,
    tempoConfidence: 0.7,
    bands: [0.2, 0.18, 0.16, 0.14, 0.12, 0.09, 0.06, 0.05],
    ...over,
  } as SonicAnalysisInput & { uri: string };
}

beforeEach(() => {
  _resetSonicRuntimeForTest();
  _resetSonicTelemetryForTest();
  _resetTraitRuntimeForTest();
  _resetTraitTelemetryForTest();
  analyzeMock.mockReset();
  cancelMock.mockClear();
  tierMock.mockReturnValue('high');
  thermalMock.mockReturnValue(0);
  memoryMock.mockReturnValue('NORMAL');
  playingMock.mockReturnValue(false);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · ÖLÇÜLEN PROVENANCE — kanıt gerçekten ölçümden gelir
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · ölçüm gerçekse MEASURED_AUDIO, değilse HİÇBİR kanıt yok', () => {
  it('1 · geçerli ölçüm MEASURED_AUDIO kanıtı üretir', () => {
    const d = makeSonicDescriptor(row());
    expect(d).not.toBeNull();
    const e = descriptorToTraitEvidence(d);
    expect(e.provenance).toBe('MEASURED_AUDIO');
    expect(e.tempoBpm).toBe(128);
    expect(e.energy).not.toBeNull();
    expect(e.signals).toContain('audio:measured');
  });

  it('2 · analyzed=false ölçüm SAYILMAZ (fail-closed)', () => {
    expect(makeSonicDescriptor(row({ analyzed: false, reason: 'DECODE_FAILED' }))).toBeNull();
    expect(descriptorToTraitEvidence(null).provenance).toBe('NONE');
    expect(descriptorToTraitEvidence(null).confidence).toBe('NONE');
  });

  it('3 · güçlü ölçüm HIGH, kısa/zayıf ölçüm en fazla MEDIUM güven taşır', () => {
    const strong = descriptorToTraitEvidence(makeSonicDescriptor(
      row({ analyzedMs: STRONG_ANALYSIS_MS, tempoConfidence: TEMPO_CONFIDENCE_STRONG }),
    ));
    expect(strong.confidence).toBe('HIGH');

    /* Süre yeterli ama tepe zayıf → tempo düşer, güven HIGH OLAMAZ. */
    const weak = descriptorToTraitEvidence(makeSonicDescriptor(
      row({ tempoConfidence: TEMPO_CONFIDENCE_MIN - 0.01 }),
    ));
    expect(weak.tempoBpm).toBeNull();
    expect(weak.confidence).toBe('MEDIUM');

    /* Kısa ölçüm güçlü sayılmaz. */
    const short = descriptorToTraitEvidence(makeSonicDescriptor(
      row({ analyzedMs: STRONG_ANALYSIS_MS - 1 }),
    ));
    expect(short.confidence).toBe('MEDIUM');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · UYDURMA YASAKLARI — sahte BPM ve sahte mood
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · sahte tempo ve sahte ruh hâli ÜRETİLMEZ', () => {
  it('4 · eşiğin ALTINDAKİ otokorelasyon tepesi tempo SAYILMAZ', () => {
    const d = makeSonicDescriptor(row({ tempoBpm: 128, tempoConfidence: TEMPO_CONFIDENCE_MIN - 0.001 }));
    expect(d).not.toBeNull();
    expect(d?.tempoBpm, 'zayıf tepe tempo olarak kabul edilmiş').toBeNull();
    /* Ölçümün kendisi hâlâ gerçektir — yalnız TEMPO iddiası düşer. */
    expect(d?.tempoConfidence).toBeLessThan(TEMPO_CONFIDENCE_MIN);
  });

  it('5 · aralık dışı BPM ölçüm sayılmaz (bozuk değer)', () => {
    expect(makeSonicDescriptor(row({ tempoBpm: 12, tempoConfidence: 0.9 }))?.tempoBpm).toBeNull();
    expect(makeSonicDescriptor(row({ tempoBpm: 900, tempoConfidence: 0.9 }))?.tempoBpm).toBeNull();
  });

  it('6 · dalga formundan MOOD ASLA üretilmez', () => {
    for (const centroid of [300, 1800, 4800]) {
      for (const bpm of [60, 128, 190]) {
        const e = descriptorToTraitEvidence(makeSonicDescriptor(
          row({ spectralCentroidHz: centroid, tempoBpm: bpm }),
        ));
        expect(e.mood, 'ses ölçümünden ruh hâli üretilmiş').toBeNull();
      }
    }
  });

  it('7 · kaynak metni "mood" iddiasını yasaklar (kör guard değil)', () => {
    const src = read('src/platform/media/sonic/sonicDescriptor.ts');
    expect(src).toContain('MOOD ÜRETİLMEZ');
    /* Tek `mood` ataması AÇIKÇA null olmalı — başka bir atama YOK. */
    const assignments = src.match(/mood:\s*[^,\n]+/g) ?? [];
    expect(assignments.length, 'mood ataması bulunamadı — guard kör kalmış')
      .toBeGreaterThan(0);
    for (const a of assignments) expect(a).toMatch(/mood:\s*null/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · BOZUK / DESTEKLENMEYEN GİRDİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · bozuk ve desteklenmeyen dosya sahte ölçüm üretmez', () => {
  it('8 · eksik alan · bozuk bant vektörü · sıfır spektrum REDDEDİLİR', () => {
    expect(makeSonicDescriptor(row({ rmsDbfs: null })), 'RMS yokken ölçüm kabul edilmiş').toBeNull();
    expect(makeSonicDescriptor(row({ bands: [0.5, 0.5] })), 'eksik bant vektörü kabul edilmiş').toBeNull();
    expect(makeSonicDescriptor(row({ bands: new Array(SONIC_BAND_COUNT).fill(0) }))).toBeNull();
    expect(makeSonicDescriptor(row({ bands: [0.2, 0.2, 0.2, 0.2, 0.1, 0.05, 0.05, -0.1] }))).toBeNull();
    expect(makeSonicDescriptor(row({ analyzedMs: 400 })), 'anlamsız kısa ölçüm kabul edilmiş').toBeNull();
    expect(makeSonicDescriptor(row({ sampleRate: 0 }))).toBeNull();
  });

  it('9 · desteklenmeyen kodek KALICI işaretlenir, bir daha ÇÖZÜLMEZ', async () => {
    analyzeMock.mockResolvedValue({
      results: [{ ...row({ analyzed: false, reason: 'UNSUPPORTED_CODEC' }) }],
      scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    const track = { id: 't1', contentUri: 'content://audio/1', generationModified: 7 };

    expect(await runSonicAnalysis([track])).toBe(0);
    expect(getSonicTelemetry().counters.failedUnsupported).toBe(1);
    /* Kalıcı başarısızlık ÖNBELLEKLENİR: ikinci tur native'e HİÇ gitmez. */
    expect(pendingSonicTracks([track])).toHaveLength(0);
    analyzeMock.mockClear();
    expect(await runSonicAnalysis([track])).toBe(0);
    expect(analyzeMock, 'kalıcı başarısız dosya yeniden çözülmüş').not.toHaveBeenCalled();
  });

  it('10 · geçici başarısızlık SINIRLI kez yeniden denenir (sonsuz döngü yok)', async () => {
    analyzeMock.mockResolvedValue({
      results: [{ ...row({ analyzed: false, reason: 'TIMEOUT' }) }],
      scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    const track = { id: 't1', contentUri: 'content://audio/1', generationModified: 7 };

    for (let i = 0; i < MAX_TRANSIENT_RETRY; i += 1) {
      expect(pendingSonicTracks([track]), `deneme ${i} hakkı kalmamış`).toHaveLength(1);
      await runSonicAnalysis([track]);
    }
    expect(pendingSonicTracks([track]), 'sınırsız yeniden deneme yapılıyor').toHaveLength(0);
    expect(getSonicTelemetry().counters.failedTimeout).toBe(MAX_TRANSIENT_RETRY);
  });

  it('11 · native "ölçtüm" dese de alanlar geçersizse kanıt SAYILMAZ', async () => {
    analyzeMock.mockResolvedValue({
      results: [{ ...row({ bands: [] }) }],
      scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    expect(await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1' }])).toBe(0);
    expect(getSonicTelemetry().counters.rejectedMalformed).toBe(1);
    expect(peekSonicDescriptor('t1', null)).toBeNull();
  });

  it('12 · native yoksa/çağrı düşerse sessizce kanıt üretilmez (fail-soft)', async () => {
    analyzeMock.mockRejectedValue(new Error('boom'));
    expect(await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1' }])).toBe(0);
    expect(getSonicTelemetry().counters.nativeErrors).toBe(1);
    expect(peekSonicDescriptor('t1', null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ÖNBELLEK · GEÇERSİZLEŞTİRME · TEKRAR ANALİZ YASAĞI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · önbellek sınırlı, kuşak duyarlı ve tekrar analiz engelli', () => {
  it('13 · anahtar ŞEMA + KİMLİK + DOSYA KUŞAĞI taşır', () => {
    expect(sonicCacheKey('t1', 5)).toBe(`${SONIC_SCHEMA_VERSION}|t1|5`);
    expect(sonicCacheKey('t1', null)).toBe(`${SONIC_SCHEMA_VERSION}|t1|-`);
    expect(sonicCacheKey('t1', 5)).not.toBe(sonicCacheKey('t1', 6));
  });

  it('14 · dosya değişince ESKİ ölçüm okunmaz ve düşürülür', async () => {
    analyzeMock.mockResolvedValue({
      results: [row()], scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1', generationModified: 1 }]);
    expect(peekSonicDescriptor('t1', 1)).not.toBeNull();

    /* Yeni kuşak = BAYAT kanıt: eski satır okunamaz. */
    expect(peekSonicDescriptor('t1', 2), 'bayat ölçüm yeni kuşakta okunuyor').toBeNull();
    await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1', generationModified: 2 }]);
    expect(peekSonicDescriptor('t1', 2)).not.toBeNull();
    expect(peekSonicDescriptor('t1', 1), 'eski kuşak satırı düşürülmemiş').toBeNull();
    expect(getSonicTelemetry().counters.cacheStaleDropped).toBeGreaterThan(0);
  });

  it('15 · ölçülmüş dosya yeniden analiz KUYRUĞUNA girmez', async () => {
    analyzeMock.mockResolvedValue({
      results: [row()], scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    const track = { id: 't1', contentUri: 'content://audio/1', generationModified: 1 };
    await runSonicAnalysis([track]);

    expect(pendingSonicTracks([track])).toHaveLength(0);
    expect(getSonicTelemetry().counters.reanalysisPrevented).toBeGreaterThan(0);
  });

  it('16 · önbellek SINIRLIDIR (LRU taşması)', () => {
    const d = makeSonicDescriptor(row());
    for (let i = 0; i < MAX_SONIC_CACHE + 40; i += 1) {
      _setSonicDescriptorForTest(`t${i}`, d, 1);
    }
    expect(getSonicCacheSize()).toBeLessThanOrEqual(MAX_SONIC_CACHE);
  });

  it('17 · kuyruk üst sınırı vardır ve kimliksiz/URI-siz kayıt alınmaz', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`, contentUri: `content://audio/${i}`,
    }));
    expect(pendingSonicTracks(many).length).toBeLessThanOrEqual(32);
    expect(pendingSonicTracks([{ id: '', contentUri: 'x' }])).toHaveLength(0);
    expect(pendingSonicTracks([{ id: 't', contentUri: '' }])).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · İPTAL VE KUŞAK GÜVENLİĞİ (§17)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · iptal edilen turun sonucu yeni gerçeğe yazılamaz', () => {
  it('18 · tur sırasında iptal → sonuç DÜŞÜRÜLÜR', async () => {
    analyzeMock.mockImplementation(async () => {
      /* Native cevap dönerken kullanıcı iptal etti. */
      await cancelSonicAnalysis();
      return { results: [row()], scanned: 1, limited: false, cancelled: false, generation: 0 };
    });

    expect(await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1' }])).toBe(0);
    expect(peekSonicDescriptor('t1', null), 'iptal edilen turun ölçümü yazılmış').toBeNull();
    expect(getSonicTelemetry().counters.staleResultDropped).toBe(1);
  });

  it('19 · iptal native tarafa da iletilir', async () => {
    await cancelSonicAnalysis();
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · DÜŞÜK KAYNAK / BASKI — performans gerçeği değiştirmez (§7)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · baskı altında ölçüm HİÇ yapılmaz (kaba ölçüm üretilmez)', () => {
  const base = {
    nativeAvailable: true, thermalLevel: 0 as 0 | 1 | 2 | 3 | null, memoryLevel: 'NORMAL',
    deviceTier: 'high' as const, playbackActive: false, inFlight: false, pendingCount: 4,
  };

  it('20 · termal ve bellek baskısı ANALİZİ TAMAMEN kapatır', () => {
    expect(admitSonicAnalysis({ ...base, thermalLevel: 2 }).decision).toBe('BYPASS');
    expect(admitSonicAnalysis({ ...base, thermalLevel: 3 }).reason).toBe('THERMAL_PRESSURE');
    expect(admitSonicAnalysis({ ...base, memoryLevel: 'PAUSE_BACKGROUND' }).decision).toBe('BYPASS');
    expect(admitSonicAnalysis({ ...base, memoryLevel: 'CRITICAL_PROTECT' }).reason)
      .toBe('MEMORY_PRESSURE');
    /* BYPASS gerçekten HİÇ ölçmemektir — küçültülmüş tur DEĞİL. */
    expect(admitSonicAnalysis({ ...base, thermalLevel: 3 }).batchSize).toBe(0);
  });

  it('21 · düşük-uçta ses çalarken ertelenir, native yoksa atlanır', () => {
    const low = admitSonicAnalysis({ ...base, deviceTier: 'low', playbackActive: true });
    expect(low.decision).toBe('DEFER');
    expect(low.reason).toBe('LOW_TIER_WHILE_PLAYING');

    expect(admitSonicAnalysis({ ...base, nativeAvailable: false }).reason).toBe('NATIVE_UNAVAILABLE');
    expect(admitSonicAnalysis({ ...base, inFlight: true }).decision).toBe('DEFER');
    expect(admitSonicAnalysis({ ...base, pendingCount: 0 }).decision).toBe('BYPASS');
  });

  it('22 · tur boyu cihaz sınıfına bağlıdır; bilinmeyen cihaz DÜŞÜK sayılır', () => {
    expect(batchSizeForTier('high')).toBe(4);
    expect(batchSizeForTier('mid')).toBe(2);
    expect(batchSizeForTier('low')).toBe(1);
    expect(batchSizeForTier(null), 'bilinmeyen cihaz cömert bütçe almış').toBe(1);
    /* Isınma başlangıcı turu küçültür ama durdurmaz. */
    expect(admitSonicAnalysis({ ...base, thermalLevel: 1 }).batchSize).toBeLessThan(4);
    expect(admitSonicAnalysis({ ...base, thermalLevel: 1 }).decision).toBe('ADMIT');
  });

  it('23 · çalışma zamanı gerçekten baskıyı okur ve native çağrısını yapmaz', async () => {
    thermalMock.mockReturnValue(3);
    analyzeMock.mockResolvedValue({
      results: [row()], scanned: 1, limited: false, cancelled: false, generation: 0,
    });
    expect(await runSonicAnalysis([{ id: 't1', contentUri: 'content://audio/1' }])).toBe(0);
    expect(analyzeMock, 'termal baskıya rağmen decode başlatılmış').not.toHaveBeenCalled();
    expect(getSonicTelemetry().counters.bypassed).toBe(1);
  });

  it('24 · tur boyu istenen dosya sayısını AŞMAZ', async () => {
    tierMock.mockReturnValue('mid');
    analyzeMock.mockResolvedValue({
      results: [], scanned: 0, limited: false, cancelled: false, generation: 0,
    });
    await runSonicAnalysis(Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`, contentUri: `content://audio/${i}`,
    })));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(analyzeMock.mock.calls[0]?.[0]?.uris).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · F10 ENTEGRASYONU — model yeniden yazılmadan güçlenir
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · ölçüm F10 zincirine bağlanır ve etiketi EZER', () => {
  it('25 · ölçüm varken kanıt MEASURED_AUDIO olur (gömülü etiketi ezer)', () => {
    _setEmbeddedBpmForTest('t1', 90);
    _setSonicDescriptorForTest('t1', makeSonicDescriptor(row({ tempoBpm: 140 })), 3);

    const e = resolveTraitEvidence({
      id: 't1', title: null, artist: null, durationMs: 200000, genre: 'rock',
      generationModified: 3,
    });
    expect(e.provenance, 'ölçüm gömülü etiketi ezmiyor').toBe('MEASURED_AUDIO');
    expect(e.tempoBpm).toBe(140);
    expect(e.mood).toBeNull();
    expect(getTraitTelemetry().counters.evidenceMeasured).toBe(1);
  });

  it('26 · ölçüm YOKKEN F10.1 davranışı BOZULMAZ (regresyon)', () => {
    _setEmbeddedBpmForTest('t2', 90);
    const e = resolveTraitEvidence({
      id: 't2', title: null, artist: null, durationMs: 200000, generationModified: 3,
    });
    expect(e.provenance).toBe('EMBEDDED_METADATA');
    expect(e.tempoBpm).toBe(90);
    /* F17 denetiminde bulunan GERÇEK kusur: gömülü etiket "kanıt yok"
       sayılıyordu; artık kendi sütununda sayılır. */
    expect(getTraitTelemetry().counters.evidenceEmbedded).toBe(1);
    expect(getTraitTelemetry().counters.evidenceNone).toBe(0);
  });

  it('27 · trait şeması F17 ile ARTTI (eski satırlar okunamaz)', () => {
    expect(TRAIT_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · BENZERLİK VE ENERJİ PROXY'Sİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · benzerlik kanıtsız kurulmaz, enerji proxy monoton davranır', () => {
  it('28 · tek taraf ölçülmemişse benzerlik NULL döner', () => {
    const d = makeSonicDescriptor(row());
    expect(sonicSimilarity(d, null)).toBeNull();
    expect(sonicSimilarity(null, d)).toBeNull();
    expect(sonicSimilarity(null, null)).toBeNull();
  });

  it('29 · aynı ölçüm kendine en yakındır; uzak ölçüm daha düşük skor alır', () => {
    const a = makeSonicDescriptor(row());
    const same = makeSonicDescriptor(row());
    const far = makeSonicDescriptor(row({
      tempoBpm: 62, tempoConfidence: 0.8, rmsDbfs: -28, crestDb: 20,
      spectralCentroidHz: 500, onsetRate: 0.5,
      bands: [0.6, 0.2, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01],
    }));
    const self = sonicSimilarity(a, same);
    const other = sonicSimilarity(a, far);
    expect(self).not.toBeNull();
    expect(other).not.toBeNull();
    expect(self as number).toBeGreaterThan(other as number);
    expect(self as number).toBeLessThanOrEqual(1);
    expect(other as number).toBeGreaterThanOrEqual(0);
  });

  it('30 · enerji proxy 0..1 aralığında ve yönü doğrudur', () => {
    const calm = makeSonicDescriptor(row({
      tempoBpm: 60, tempoConfidence: 0.8, rmsDbfs: -30, crestDb: 20,
      spectralCentroidHz: 600, onsetRate: 0.5,
    }));
    const hot = makeSonicDescriptor(row({
      tempoBpm: 175, tempoConfidence: 0.8, rmsDbfs: -8, crestDb: 6,
      spectralCentroidHz: 3400, onsetRate: 4,
    }));
    const lo = sonicEnergyProxy(calm as NonNullable<typeof calm>);
    const hi = sonicEnergyProxy(hot as NonNullable<typeof hot>);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · MİMARİ SINIRLAR — kaynak metni kilidi
 * ════════════════════════════════════════════════════════════════════════ */

describe('F17 · mimari sınırlar korunur', () => {
  it('31 · saf katmanlarda I/O · timer · global durum YOKTUR', () => {
    for (const p of [
      'src/platform/media/sonic/sonicDescriptor.ts',
      'src/platform/media/sonic/sonicAdmissionModel.ts',
    ]) {
      const raw = read(p);
      /* Guard körleşmesin: dosya gerçekten okundu ve gövdesi var. */
      expect(raw.length, `${p} okunamadı`).toBeGreaterThan(500);
      const src = codeOnly(raw);
      expect(src, `${p} timer kuruyor`).not.toMatch(/setInterval|setTimeout/);
      expect(src, `${p} Date.now kullanıyor`).not.toMatch(/Date\.now/);
      expect(src, `${p} React importu var`).not.toMatch(/from 'react'/);
    }
  });

  it('32 · analiz katmanı timer/polling KURMAZ ve oynatma komutu göndermez', () => {
    const src = codeOnly(read('src/platform/media/sonic/sonicAnalysisRuntime.ts'));
    expect(src, 'analiz katmanı timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    expect(src, 'analiz katmanı oynatma başlatıyor').not.toMatch(/startLibraryListening|playByQuery/);
    /* Native yüzeyi YALNIZ analiz + iptal olmalı; başka native çağrı YOK. */
    const nativeCalls = src.match(/CarLauncher\.[A-Za-z]+/g) ?? [];
    expect(nativeCalls.length).toBeGreaterThan(0);
    for (const c of nativeCalls) {
      expect(c).toMatch(/analyzeTrackAudio|cancelTrackAudioAnalysis/);
    }
  });

  it('33 · native analizör UI thread kullanmaz ve sınırlı toplu iş uygular', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/media/SonicAudioAnalyzer.java');
    expect(src).toContain('MAX_BATCH');
    expect(src).toContain('PER_ITEM_BUDGET_MS');
    expect(src).toContain('MAX_ANALYZE_MS');
    expect(src, 'iptal kuşağı yok').toContain('AtomicInteger');
    expect(src, 'native mood üretiyor').not.toMatch(/"mood"/);

    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'analiz ayrı havuzda koşmuyor').toContain('sonicAnalysisExecutor');
    expect(plugin).toContain('analyzeTrackAudio');
    expect(plugin).toContain('cancelTrackAudioAnalysis');
  });

  it('34.1 · ses ölçümü sesli isteği BLOKLAMAZ (fire-and-forget)', () => {
    const router = codeOnly(read('src/platform/media/intent/musicIntentRouter.ts'));
    expect(router, 'F17 ölçümü niyet yolundan hiç çağrılmıyor').toContain('primeSonicTraits');
    /* Beklenirse sesli istek decode arkasında kalır — kilit budur. */
    expect(router, 'ses ölçümü await ile bekletilmiş')
      .not.toMatch(/await\s+traits\.primeSonicTraits/);
    expect(router).toMatch(/void\s+traits\.primeSonicTraits/);
    /* Gömülü etiket okuması UCUZDUR ve beklenmeye devam eder (regresyon). */
    expect(router).toMatch(/await\s+traits\.primeEmbeddedTraits/);
  });

  it('34 · LAB kartı yalnız SAYISAL ölçüm gösterir (ad/URI taşımaz)', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('24 · Ses Ölçümü / Sonic (F17)');
    const sources = read('src/platform/devtools/mediaAuthoritySources.ts');
    /* LAB okuması SAYAÇSIZ okuyucuyu kullanmalı (F3.2 salt-okunurluk). */
    expect(sources).toContain('peekSonicDescriptor');
    expect(sources, 'LAB analiz tetikliyor').not.toContain('runSonicAnalysis');
    expect(sources, 'LAB parça adı taşıyor').not.toMatch(/f17Reference(Title|Artist|Uri)/);
  });
});
