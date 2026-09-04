/**
 * musicF19LoudnessConsistency.test.ts — MUSIC F19 · Seviye tutarlılığı.
 *
 * ÖLÇÜLEN GERÇEK: `volumePolicy` formülünde `sourceNormalization` alanı
 * F0'dan beri VARDI ama HİÇ beslenmiyordu (daima 1) → parça değişince biri
 * patlıyor, öteki duyulmuyordu.
 *
 * Bu paket F19'un sınırlarını KİLİTLER:
 *   · ikinci ses otoritesi YOK — yalnız mevcut `sourceNormalization` beslenir
 *   · LUFS UYDURULMAZ (etiket ya da düz RMS; ikisi de LUFS değildir)
 *   · kanıt yoksa çarpan TAM 1.0
 *   · YALNIZ kısılır; yükseltme yapılmaz (headroom/clipping güvenliği)
 *   · kısma SINIRLIDIR; duyulmayan fark uygulanmaz (pumping yok)
 *   · kullanıcı sesi ve duck DEĞİŞMEZ
 *   · aynı parçada çarpan yeniden yazılmaz
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeNormalization, fromGainTag, fromMeasuredRms, MAX_ATTENUATION_DB,
  MIN_ADJUSTMENT_DB, MIN_NORMALIZATION, NEUTRAL_NORMALIZATION, NO_LOUDNESS_EVIDENCE,
  RMS_REFERENCE_DBFS, strongerLoudness,
} from '../platform/media/loudness/loudnessEvidence';
import {
  _resetLoudnessTelemetryForTest, getLoudnessTelemetry,
} from '../platform/media/loudness/loudnessTelemetry';
import {
  computeEffectiveVolume, DEFAULT_VOLUME_INPUTS, sanitizeVolumeInputs,
} from '../platform/media/authority/volumePolicy';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

beforeEach(() => {
  _resetLoudnessTelemetryForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · KANIT — etiket ve ölçüm, LUFS DEĞİL
 * ════════════════════════════════════════════════════════════════════════ */

describe('F19 · kanıt gerçektir, LUFS uydurulmaz', () => {
  it('1 · ReplayGain etiketi kanıt üretir; kaynağı doğru etiketlenir', () => {
    const e = fromGainTag({ gainDb: -7.5, gainPeak: 0.98, gainSource: 'REPLAYGAIN_TRACK' });
    expect(e.provenance).toBe('TAG_REPLAYGAIN');
    expect(e.gainDb).toBe(-7.5);
    expect(e.peak).toBe(0.98);
  });

  it('2 · R128 etiketi ayrı kaynak olarak taşınır', () => {
    const e = fromGainTag({ gainDb: -3.2, gainPeak: null, gainSource: 'R128_TRACK' });
    expect(e.provenance).toBe('TAG_R128');
    expect(e.gainDb).toBe(-3.2);
  });

  it('3 · bozuk/eksik etiket kanıt SAYILMAZ', () => {
    expect(fromGainTag({ gainDb: null, gainSource: 'REPLAYGAIN_TRACK' }).provenance).toBe('NONE');
    expect(fromGainTag({ gainDb: -7, gainSource: 'NONE' }).provenance).toBe('NONE');
    expect(fromGainTag({ gainDb: -900, gainSource: 'REPLAYGAIN_TRACK' }).provenance).toBe('NONE');
    /* Saçma tepe değeri taşınmaz (1.0 = tam ölçek). */
    expect(fromGainTag({ gainDb: -7, gainPeak: 9, gainSource: 'REPLAYGAIN_TRACK' }).peak).toBeNull();
  });

  it('4 · ölçülen RMS referansa göre kazanç önerir (LUFS DEĞİL)', () => {
    const e = fromMeasuredRms({ rmsDbfs: -8, peakDbfs: -1 });
    expect(e.provenance).toBe('MEASURED_RMS');
    expect(e.gainDb).toBeCloseTo(RMS_REFERENCE_DBFS + 8, 6);
    expect(e.gainDb as number).toBeLessThan(0);

    /* Referanstan sessiz parça POZİTİF kazanç ister (uygulanmayacak). */
    expect(fromMeasuredRms({ rmsDbfs: -22 }).gainDb as number).toBeGreaterThan(0);
    expect(fromMeasuredRms({ rmsDbfs: null }).provenance).toBe('NONE');
  });

  it('5 · ETİKET ölçümden GÜÇLÜDÜR', () => {
    const tag = fromGainTag({ gainDb: -6, gainSource: 'REPLAYGAIN_TRACK' });
    const measured = fromMeasuredRms({ rmsDbfs: -8 });
    expect(strongerLoudness(tag, measured).provenance).toBe('TAG_REPLAYGAIN');
    expect(strongerLoudness(measured, tag).provenance).toBe('TAG_REPLAYGAIN');
    expect(strongerLoudness(NO_LOUDNESS_EVIDENCE, measured).provenance).toBe('MEASURED_RMS');
  });

  it('6 · hiçbir yerde "LUFS" iddiası kurulmaz', () => {
    for (const p of [
      'src/platform/media/loudness/loudnessEvidence.ts',
      'src/platform/media/loudness/loudnessRuntime.ts',
      'src/platform/media/loudness/loudnessTelemetry.ts',
    ]) {
      const code = codeOnly(read(p));
      expect(code, `${p} kodunda LUFS alanı üretilmiş`).not.toMatch(/lufs/i);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · NORMALİZASYON — sınırlı, yalnız kısar, pumping yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('F19 · normalizasyon sınırlıdır ve yalnız kısar', () => {
  it('7 · kanıt yoksa çarpan TAM 1.0 (tahmin yok)', () => {
    const r = computeNormalization(NO_LOUDNESS_EVIDENCE);
    expect(r.factor).toBe(1);
    expect(r.appliedDb).toBe(0);
    expect(r.bypassReason).toBe('NO_EVIDENCE');
    expect(r).toEqual(NEUTRAL_NORMALIZATION);
  });

  it('8 · yüksek parça KISILIR (çarpan < 1)', () => {
    const r = computeNormalization(fromGainTag({ gainDb: -6, gainSource: 'REPLAYGAIN_TRACK' }));
    expect(r.bypassReason).toBeNull();
    expect(r.factor).toBeLessThan(1);
    expect(r.factor).toBeGreaterThan(MIN_NORMALIZATION);
    expect(r.appliedDb).toBe(-6);
  });

  it('9 · sessiz parça YÜKSELTİLMEZ (headroom/clipping güvenliği)', () => {
    const r = computeNormalization(fromGainTag({ gainDb: +6, gainSource: 'REPLAYGAIN_TRACK' }));
    expect(r.factor, 'ses yükseltilmiş — clipping riski').toBe(1);
    expect(r.bypassReason).toBe('BOOST_NOT_SUPPORTED');
    expect(r.requestedDb).toBe(6);
  });

  it('10 · duyulmayan fark uygulanmaz (gereksiz zıplama yok)', () => {
    const small = computeNormalization(
      fromGainTag({ gainDb: -(MIN_ADJUSTMENT_DB - 0.1), gainSource: 'REPLAYGAIN_TRACK' }),
    );
    expect(small.factor).toBe(1);
    expect(small.bypassReason).toBe('BELOW_THRESHOLD');
  });

  it('11 · aşırı kanıt TAVANDA kesilir (ses kaybolmaz)', () => {
    const r = computeNormalization(fromGainTag({ gainDb: -40, gainSource: 'REPLAYGAIN_TRACK' }));
    expect(r.clamped).toBe(true);
    expect(r.appliedDb).toBe(-MAX_ATTENUATION_DB);
    expect(r.factor).toBeGreaterThanOrEqual(MIN_NORMALIZATION);
    expect(r.factor).toBeLessThan(1);
  });

  it('12 · çarpan kuantalanır — küçük dalgalanma AYNI değeri verir', () => {
    const a = computeNormalization(fromGainTag({ gainDb: -6.00, gainSource: 'REPLAYGAIN_TRACK' }));
    const b = computeNormalization(fromGainTag({ gainDb: -6.05, gainSource: 'REPLAYGAIN_TRACK' }));
    expect(a.factor).toBe(b.factor);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · SES FORMÜLÜ — ikinci otorite yok, kullanıcı sesi değişmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('F19 · tek ses otoritesi korunur', () => {
  it('13 · normalizasyon KANONİK formülün ZATEN var olan alanıdır', () => {
    expect(DEFAULT_VOLUME_INPUTS.sourceNormalization).toBe(1);
    const withNorm = computeEffectiveVolume({ userVolume: 1, sourceNormalization: 0.5 });
    expect(withNorm).toBeCloseTo(0.5, 6);
    /* Duck ile ÇARPILIR (biri diğerinin yerine geçmez). */
    expect(computeEffectiveVolume({ userVolume: 1, duckLevel: 0.3, sourceNormalization: 0.5 }))
      .toBeCloseTo(0.15, 6);
    /* Mute her şeyi ezer. */
    expect(computeEffectiveVolume({ userVolume: 1, sourceNormalization: 0.5, muted: true })).toBe(0);
    /* Aralık dışı değer kanonik formülde kırpılır. */
    expect(sanitizeVolumeInputs({ sourceNormalization: 9 }).sourceNormalization).toBe(1);
    /* NaN kanonik formülde 0'a düşer (fail-closed) — bu yüzden bozuk değerin
       oraya HİÇ ULAŞMAMASI gerekir: kapı `setSourceNormalization`dadır. */
    expect(sanitizeVolumeInputs({ sourceNormalization: Number.NaN }).sourceNormalization).toBe(0);
    const gw = codeOnly(read('src/platform/media/authority/mediaCommandGateway.ts'));
    expect(gw, 'NaN koruması kaldırılmış')
      .toMatch(/setSourceNormalization[\s\S]{0,300}Number\.isFinite\(factor\)\s*\?\s*1/);
  });

  it('14 · gateway kullanıcı sesini DEĞİŞTİRMEZ, duck\'ı iki kez uygulamaz', () => {
    const src = codeOnly(read('src/platform/media/authority/mediaCommandGateway.ts'));
    /* Tek yazar: setSourceNormalization. */
    const writes = src.match(/_sourceNormalization\s*=/g) ?? [];
    expect(writes.length, '_sourceNormalization yazarı bulunamadı').toBeGreaterThan(0);
    /* Beklenen üç konum: bildirim · setter · test sıfırlaması. Dördüncü bir
       yazar ikinci ses otoritesi demektir. */
    expect(writes.length, 'birden fazla yazar var (ikinci otorite)').toBeLessThanOrEqual(3);
    /* Native'e yazılan değer duck İÇERMEZ (F6.1 çift-duck kilidi korunur). */
    expect(src).toMatch(/nativeUserVolume[\s\S]{0,400}duckLevel:\s*1/);
    expect(src).toMatch(/nativeUserVolume[\s\S]{0,400}sourceNormalization:\s*_sourceNormalization/);
  });

  it('15 · loudness katmanı kullanıcı sesine ve duck\'a DOKUNMAZ', () => {
    const src = codeOnly(read('src/platform/media/loudness/loudnessRuntime.ts'));
    expect(src, 'loudness kullanıcı sesini değiştirmiş').not.toMatch(/setUserVolumePercent|setMuted/);
    expect(src, 'loudness duck otoritesine dokunmuş').not.toMatch(/\bduck\s*\(|unduck\s*\(|duckRequest/);
    expect(src, 'loudness DSP zincirine yazmış').not.toMatch(/audioExperienceAuthority|setBandGainDb/);
    expect(src, 'loudness timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    /* TEK yazma yolu: kanonik gateway seam'i. */
    expect(src).toContain('setSourceNormalization');
  });

  it('16 · DSP güvenlik preamp\'i AYRI kalır (iki katsayı çakışmaz)', () => {
    const dsp = codeOnly(read('src/platform/media/audio/audioExperienceModel.ts'));
    expect(dsp, 'DSP volumePolicy alanına yazmış').not.toContain('sourceNormalization');
    const loud = codeOnly(read('src/platform/media/loudness/loudnessEvidence.ts'));
    expect(loud, 'loudness DSP preamp\'ini hesaplamış').not.toContain('computeSafetyPreampDb');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ÇALIŞMA ZAMANI — parça sınırı, tekrar yazma yok, fail-soft
 * ════════════════════════════════════════════════════════════════════════ */

describe('F19 · runtime parça sınırında çalışır ve gereksiz yazmaz', () => {
  it('17 · aynı parçada çarpan YENİDEN yazılmaz (pumping yok)', async () => {
    vi.resetModules();
    const setNorm = vi.fn(async () => true);
    vi.doMock('../platform/media/authority/mediaCommandGateway', () => ({
      setSourceNormalization: setNorm,
    }));
    vi.doMock('../platform/media/session/listeningSession', () => ({
      getListeningSession: () => ({ currentItem: { libraryId: 't1' } }),
      subscribeListeningSession: () => () => {},
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({
        tracks: [{ id: 't1', contentUri: 'content://1', generationModified: 1 }],
      }),
    }));
    const rt = await import('../platform/media/loudness/loudnessRuntime');
    rt._resetLoudnessRuntimeForTest();
    rt._setGainTagForTest('t1', { gainDb: -6, gainPeak: 0.9, gainSource: 'REPLAYGAIN_TRACK' });

    const first = await rt.applyLoudnessForCurrentItem();
    expect(first.factor).toBeLessThan(1);
    expect(setNorm).toHaveBeenCalledTimes(1);

    await rt.applyLoudnessForCurrentItem();
    expect(setNorm, 'aynı parçada çarpan yeniden yazılmış').toHaveBeenCalledTimes(1);

    vi.doUnmock('../platform/media/authority/mediaCommandGateway');
    vi.doUnmock('../platform/media/session/listeningSession');
    vi.doUnmock('../platform/media/musicIndex');
  });

  it('18 · sağlayıcı akışında (yerel kimlik yok) normalizasyon NÖTRDÜR', async () => {
    vi.resetModules();
    const setNorm = vi.fn(async () => true);
    vi.doMock('../platform/media/authority/mediaCommandGateway', () => ({
      setSourceNormalization: setNorm,
    }));
    vi.doMock('../platform/media/session/listeningSession', () => ({
      getListeningSession: () => ({ currentItem: { libraryId: null, providerId: 'yt:1' } }),
      subscribeListeningSession: () => () => {},
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({ tracks: [] }),
    }));
    const rt = await import('../platform/media/loudness/loudnessRuntime');
    rt._resetLoudnessRuntimeForTest();

    const r = await rt.applyLoudnessForCurrentItem();
    expect(r.factor, 'sağlayıcı akışında sahte normalizasyon uygulanmış').toBe(1);
    expect(r.provenance).toBe('NONE');
    /* İLK gözlem de bir gözlemdir: yerel parça olmadığı BİR KEZ nötre yazılır
       (aksi hâlde önceki parçanın kısması sızardı). */
    expect(setNorm).toHaveBeenCalledWith(1);

    vi.doUnmock('../platform/media/authority/mediaCommandGateway');
    vi.doUnmock('../platform/media/session/listeningSession');
    vi.doUnmock('../platform/media/musicIndex');
  });

  it('19 · ses yolu yazılamazsa oynatma ETKİLENMEZ (fail-soft)', async () => {
    vi.resetModules();
    vi.doMock('../platform/media/authority/mediaCommandGateway', () => ({
      setSourceNormalization: async () => { throw new Error('boom'); },
    }));
    vi.doMock('../platform/media/session/listeningSession', () => ({
      getListeningSession: () => ({ currentItem: { libraryId: 't9' } }),
      subscribeListeningSession: () => () => {},
    }));
    vi.doMock('../platform/media/musicIndex', () => ({
      getMusicLibrarySnapshot: () => ({ tracks: [{ id: 't9', contentUri: 'content://9' }] }),
    }));
    const rt = await import('../platform/media/loudness/loudnessRuntime');
    const tel = await import('../platform/media/loudness/loudnessTelemetry');
    rt._resetLoudnessRuntimeForTest();
    tel._resetLoudnessTelemetryForTest();
    rt._setGainTagForTest('t9', { gainDb: -8, gainPeak: null, gainSource: 'REPLAYGAIN_TRACK' });

    await expect(rt.applyLoudnessForCurrentItem()).resolves.toBeDefined();
    expect(tel.getLoudnessTelemetry().counters.applyFailures).toBe(1);

    vi.doUnmock('../platform/media/authority/mediaCommandGateway');
    vi.doUnmock('../platform/media/session/listeningSession');
    vi.doUnmock('../platform/media/musicIndex');
  });

  it('20 · telemetri kanıt kökenini ayrıştırır ve metin taşımaz', () => {
    const src = read('src/platform/media/loudness/loudnessTelemetry.ts');
    for (const f of ['title', 'artist', 'uri', 'query', 'utterance', 'transcript']) {
      expect(src.toLowerCase(), `yasaklı alan telemetriye sızmış: ${f}`).not.toContain(`${f}:`);
    }
    expect(src).toContain('evidenceReplayGain');
    expect(src).toContain('evidenceMeasured');
    expect(getLoudnessTelemetry().counters.evaluated).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · NATIVE + LAB
 * ════════════════════════════════════════════════════════════════════════ */

describe('F19 · native etiket okuması ve LAB kartı', () => {
  it('21 · native ReplayGain/R128 etiketlerini MEVCUT okumadan çıkarır', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/TrackTraitExtractor.java');
    expect(java).toContain('replaygain_track_gain');
    expect(java).toContain('r128_track_gain');
    expect(java, 'R128 Q7.8 dönüşümü yok').toContain('256.0');
    expect(java, 'MP4/iTunes iç çerçevesi okunmuyor').toContain('InternalFrame');
    /* Yeni bir native yüzey AÇILMADI — mevcut readTrackTraits genişletildi. */
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'F19 için gereksiz yeni native metot açılmış')
      .not.toContain('readReplayGain');
  });

  it('22 · LAB kartı salt-okunurdur ve normalizasyon UYGULAMAZ', () => {
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(model).toContain('26 · Seviye Tutarlılığı (F19)');
    const sources = codeOnly(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources, 'LAB normalizasyon uygulamış')
      .not.toMatch(/\b(applyLoudnessForCurrentItem|setSourceNormalization|primeGainTags)\s*\(/);
    expect(sources, 'LAB parça adı/URI taşımış').not.toMatch(/f19(Title|Artist|Uri|Track)/);
  });
});
