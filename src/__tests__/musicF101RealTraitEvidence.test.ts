/**
 * musicF101RealTraitEvidence.test.ts — MUSIC F10.1 · GERÇEK kanıt kapanışı.
 *
 * F10'da hiçbir kaynak gerçek trait vermiyordu (#1135). F10.1 ikisini bağladı:
 *   · `EMBEDDED_METADATA` — dosyaya gömülü ID3 `TBPM` / Vorbis `BPM` (media3).
 *   · `LIBRARY_METADATA`  — MediaStore `GENRE` (API 30+).
 * Bağlanmayanlar UYDURULMADI: Piped trait alanı yok (`UNSUPPORTED`), Spotify
 * `audio-features` sözleşmesi doğrulanmadı (`UNVERIFIED`), ses analizi yok.
 *
 * Bu paket şunları kilitler:
 *   · BPM yalnız gerçek etiketten — tür/süre/başlık BPM ÜRETEMEZ
 *   · tür TEK BAŞINA kesin ruh hâli iddiası kuramaz (destekleyici · LOW)
 *   · gerçek kanıt sezgiseli EZER; sezgisel gerçeğin üstüne çıkamaz
 *   · dosya değişince (generation) eski kanıt KULLANILMAZ
 *   · doğrulanmamış sağlayıcı kaynağından kanıt OKUNMAZ
 *   · kalıcı/önbellek kanıtı ad · URI · sorgu TAŞIMAZ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  hasTraitEvidence, makeTraitEvidence, mayCarryTempo, mergeTraitEvidence,
  provenanceRank,
} from '../platform/media/traits/musicTraitEvidence';
import {
  energyFromBpm, fromEmbeddedBpm, fromLibraryGenre, MAX_VALID_BPM, MIN_VALID_BPM,
  PROVIDER_TRAIT_AVAILABILITY, providerTraitReadable,
} from '../platform/media/traits/traitSources';
import {
  _resetTraitRuntimeForTest, _setEmbeddedBpmForTest, MAX_EMBEDDED_PRIME,
  resolveTraitEvidence, TRAIT_SCHEMA_VERSION,
} from '../platform/media/traits/traitRuntime';
import { selectByTrait } from '../platform/media/traits/traitSelectionModel';
import { allowsConfidentClaim } from '../platform/media/traits/traitSelectionModel';
import { _resetTraitTelemetryForTest } from '../platform/media/traits/traitTelemetry';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

beforeEach(() => {
  _resetTraitRuntimeForTest();
  _resetTraitTelemetryForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · GERÇEK KAYNAK ÖLÇÜMÜ VE BPM DÜRÜSTLÜĞÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10.1 · gerçek kaynaklar bağlandı, olmayanlar uydurulmadı', () => {
  it('1 · kaynak yetenek tablosu ÖLÇÜLEN gerçeği taşır', () => {
    expect(PROVIDER_TRAIT_AVAILABILITY.local).toBe('AVAILABLE');
    expect(PROVIDER_TRAIT_AVAILABILITY.youtube, 'Piped trait alanı yokken AVAILABLE denmiş')
      .toBe('UNSUPPORTED');
    expect(PROVIDER_TRAIT_AVAILABILITY.spotify, 'doğrulanmamış sözleşme AVAILABLE sayılmış')
      .toBe('UNVERIFIED');

    /* `UNVERIFIED` "muhtemelen vardır" DEMEK DEĞİLDİR: kanıt okunamaz. */
    expect(providerTraitReadable('spotify')).toBe(false);
    expect(providerTraitReadable('youtube')).toBe(false);
    expect(providerTraitReadable('local')).toBe(true);
  });

  it('2 · BPM YALNIZ gerçek etiket/ölçüm kaynağından gelir', () => {
    expect(mayCarryTempo('EMBEDDED_METADATA')).toBe(true);
    expect(mayCarryTempo('MEASURED_AUDIO')).toBe(true);
    expect(mayCarryTempo('PROVIDER_METADATA')).toBe(true);
    /* Tür/yıl BPM veremez — F10.1'de kapatılan gerçek boşluk. */
    expect(mayCarryTempo('LIBRARY_METADATA'), 'türden BPM üretilebiliyor').toBe(false);
    expect(mayCarryTempo('DERIVED_DURATION')).toBe(false);
    expect(mayCarryTempo('HEURISTIC_TEXT')).toBe(false);

    /* Kütüphane kaynağı ısrar etse bile model BPM'i DÜŞÜRÜR. */
    const genreFake = makeTraitEvidence({
      provenance: 'LIBRARY_METADATA', sourceId: 'x',
      energy: 0.6, tempoBpm: 128, confidence: 'LOW',
    });
    expect(genreFake.tempoBpm).toBeNull();
  });

  it('3 · gömülü BPM etiketi GERÇEK tempo taşır; bozuk etiket kanıt DEĞİLDİR', () => {
    const real = fromEmbeddedBpm(128);
    expect(real.provenance).toBe('EMBEDDED_METADATA');
    expect(real.tempoBpm, 'gerçek BPM taşınmadı').toBe(128);
    expect(real.confidence, 'etiketten HIGH güven üretilmiş').toBe('MEDIUM');
    /* BPM bir ruh hâli DEĞİLDİR. */
    expect(real.mood, 'BPM\'den ruh hâli uydurulmuş').toBeNull();

    /* Makul aralık dışı = bozuk etiket → kanıt YOK. */
    expect(hasTraitEvidence(fromEmbeddedBpm(MIN_VALID_BPM - 1))).toBe(false);
    expect(hasTraitEvidence(fromEmbeddedBpm(MAX_VALID_BPM + 1))).toBe(false);
    expect(hasTraitEvidence(fromEmbeddedBpm(null))).toBe(false);

    /* Enerji çıkarımı monoton olmalı — hızlı parça daha enerjik sayılır. */
    expect(energyFromBpm(70)).toBeLessThan(energyFromBpm(130));
    expect(energyFromBpm(130)).toBeLessThan(energyFromBpm(170));
  });

  it('4 · tür TEK BAŞINA kesin ruh hâli iddiası KURAMAZ', () => {
    const rock = fromLibraryGenre('Rock');
    expect(rock.provenance).toBe('LIBRARY_METADATA');
    expect(rock.confidence, 'tür tek başına güçlü kanıt sayılmış').toBe('LOW');
    expect(rock.mood, 'türden kesin ruh hâli üretilmiş').toBeNull();
    expect(rock.tempoBpm).toBeNull();

    /* Tanınmayan/boş tür kanıt ÜRETMEZ — "Bilinmeyen Tür" diye kanıt yoktur. */
    expect(hasTraitEvidence(fromLibraryGenre('Zzzz Bilinmeyen'))).toBe(false);
    expect(hasTraitEvidence(fromLibraryGenre(''))).toBe(false);
    expect(hasTraitEvidence(fromLibraryGenre(null))).toBe(false);

    /* Türkçe/aksanlı yazım da tanınır. */
    expect(hasTraitEvidence(fromLibraryGenre('Klasik'))).toBe(true);
    expect(fromLibraryGenre('Klasik').energy!).toBeLessThan(fromLibraryGenre('Metal').energy!);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–8 · ÖNCELİK · BİRLEŞTİRME · GEÇERSİZLEŞTİRME
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10.1 · gerçek kanıt sezgiseli EZER', () => {
  it('5 · kanonik güç sırası korunur', () => {
    expect(provenanceRank('MEASURED_AUDIO')).toBeGreaterThan(provenanceRank('PROVIDER_METADATA'));
    expect(provenanceRank('PROVIDER_METADATA')).toBeGreaterThan(provenanceRank('EMBEDDED_METADATA'));
    expect(provenanceRank('EMBEDDED_METADATA')).toBeGreaterThan(provenanceRank('LIBRARY_METADATA'));
    expect(provenanceRank('LIBRARY_METADATA')).toBeGreaterThan(provenanceRank('DERIVED_DURATION'));
    expect(provenanceRank('DERIVED_DURATION')).toBeGreaterThan(provenanceRank('HEURISTIC_TEXT'));
    expect(provenanceRank('HEURISTIC_TEXT')).toBeGreaterThan(provenanceRank('NONE'));
  });

  it('6 · gömülü BPM varken sezgisel başlık ipucu KAZANMAZ', () => {
    /* Başlıkta "akustik" var (sezgisel: sakin) ama etiket 170 BPM diyor. */
    _setEmbeddedBpmForTest('t1', 170);
    const evidence = resolveTraitEvidence({
      id: 't1', title: 'Akustik Gece', artist: 'X', durationMs: 200_000,
      genre: 'Rock', generationModified: 7,
    });
    expect(evidence.provenance, 'sezgisel kanıt gerçeği ezdi').toBe('EMBEDDED_METADATA');
    expect(evidence.tempoBpm).toBe(170);
    expect(evidence.confidence).toBe('MEDIUM');
    expect(evidence.energy!).toBeGreaterThan(0.7);

    /* Gömülü etiket YOKSA kütüphane türü devreye girer (sezgiselin üstünde). */
    const genreOnly = resolveTraitEvidence({
      id: 't2', title: 'Akustik Gece', artist: 'X', durationMs: 200_000,
      genre: 'Metal', generationModified: 1,
    });
    expect(genreOnly.provenance).toBe('LIBRARY_METADATA');
    expect(genreOnly.confidence).toBe('LOW');
  });

  it('7 · iki zayıf kanıt GÜÇLÜ olamaz; gerçek kanıt güveni düşmez', () => {
    const merged = mergeTraitEvidence(fromLibraryGenre('Pop'),
      makeTraitEvidence({
        provenance: 'HEURISTIC_TEXT', sourceId: 'h', energy: 0.3, confidence: 'LOW',
      }));
    expect(merged.confidence).toBe('LOW');

    const withReal = mergeTraitEvidence(fromEmbeddedBpm(90), fromLibraryGenre('Metal'));
    expect(withReal.provenance).toBe('EMBEDDED_METADATA');
    expect(withReal.confidence).toBe('MEDIUM');
    expect(withReal.tempoBpm).toBe(90);
    /* Zayıf kanıt güçlü kanıdın BPM'ini bozamaz. */
    expect(withReal.energy).toBe(energyFromBpm(90));
  });

  it('8 · dosya DEĞİŞİRSE eski kanıt kullanılmaz (generation + şema anahtarda)', () => {
    _setEmbeddedBpmForTest('t9', 150);
    const before = resolveTraitEvidence({
      id: 't9', title: null, artist: null, durationMs: null,
      genre: 'Metal', generationModified: 1,
    });
    expect(before.tempoBpm).toBe(150);

    /* Aynı kimlik, YENİ kuşak → önbellek satırı BAŞKADIR; tür değişmişse
       kanıt da değişir (bayat kanıt sunulmaz). */
    const after = resolveTraitEvidence({
      id: 't9', title: null, artist: null, durationMs: null,
      genre: 'Klasik', generationModified: 2,
    });
    expect(after.tempoBpm).toBe(150);          // etiket hâlâ geçerli
    expect(TRAIT_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);

    /* Etiket okuması güncellenirse önbellek DÜŞER. */
    _setEmbeddedBpmForTest('t9', null);
    const cleared = resolveTraitEvidence({
      id: 't9', title: null, artist: null, durationMs: null,
      genre: 'Klasik', generationModified: 2,
    });
    expect(cleared.tempoBpm, 'bayat BPM kanıtı sunuldu').toBeNull();
    expect(cleared.provenance).toBe('LIBRARY_METADATA');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–10 · SEÇİM: gerçek kanıtla KESİN dil mümkün olur
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10.1 · gerçek kanıt seçimi güçlendirir', () => {
  it('9 · iki tarafta da gerçek BPM varsa KESİN dil meşrudur', () => {
    _setEmbeddedBpmForTest('ref', 160);
    _setEmbeddedBpmForTest('calm', 70);
    const reference = resolveTraitEvidence({
      id: 'ref', title: null, artist: null, durationMs: null, generationModified: 1,
    });
    const candidate = resolveTraitEvidence({
      id: 'calm', title: null, artist: null, durationMs: null, generationModified: 1,
    });

    const r = selectByTrait({
      direction: 'CALMER', reference,
      candidates: [{ id: 'calm', evidence: candidate }],
    });
    expect(r.status).toBe('SELECTED');
    expect(r.selectedId).toBe('calm');
    expect(r.confidence, 'gerçek kanıttan MEDIUM güven doğmadı').toBe('MEDIUM');
    expect(allowsConfidentClaim(r), 'gerçek kanıtla kesin dil hâlâ yasak').toBe(true);
  });

  it('10 · yalnız sezgisel kanıt varken KESİN dil hâlâ YASAK', () => {
    const reference = resolveTraitEvidence({
      id: 'r2', title: 'Hardstyle Remix', artist: null, durationMs: 200_000,
      generationModified: 1,
    });
    const candidate = resolveTraitEvidence({
      id: 'c2', title: 'Akustik Sabah', artist: null, durationMs: 200_000,
      generationModified: 1,
    });
    expect(reference.provenance).toBe('HEURISTIC_TEXT');

    const r = selectByTrait({
      direction: 'CALMER', reference,
      candidates: [{ id: 'c2', evidence: candidate }],
    });
    expect(r.status).toBe('SELECTED');
    expect(r.confidence).toBe('LOW');
    expect(allowsConfidentClaim(r), 'sezgiselden kesin dil doğdu').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–13 · SINIRLAR · GİZLİLİK · NATIVE SÖZLEŞME
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10.1 · sınırlar, gizlilik ve native sözleşme', () => {
  it('11 · gömülü okuma SINIRLIDIR ve çalma yolunda değildir', () => {
    expect(MAX_EMBEDDED_PRIME).toBeLessThanOrEqual(32);

    const runtime = read('src/platform/media/traits/traitRuntime.ts');
    expect(runtime, 'gömülü okuma sınırı kaldırılmış').toContain('MAX_EMBEDDED_PRIME');
    expect(runtime, 'okunmuş dosya tekrar taranıyor').toContain('embeddedBpm.has');
    expect(runtime, 'F10 timer kurmuş').not.toMatch(/setInterval\s*\(/);
    expect(runtime, 'F10 yoklama kurmuş').not.toMatch(/setTimeout\s*\(/);

    /* Native taraf: arka plan havuzu + dosya başına zaman aşımı + toplu sınır. */
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/TrackTraitExtractor.java');
    expect(java, 'toplu iş sınırı kaldırılmış').toContain('MAX_BATCH');
    expect(java, 'dosya başına zaman aşımı kaldırılmış').toContain('PER_ITEM_TIMEOUT_MS');
    expect(java, 'BPM makul aralık kontrolü kaldırılmış').toContain('bpm >= 40 && bpm <= 250');
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'gömülü okuma UI thread\'e alınmış').toMatch(
      /readTrackTraits[\s\S]{0,400}mediaLibraryExecutor\.submit/,
    );
  });

  it('12 · kanıt ve önbellek ad · URI · sorgu TAŞIMAZ', () => {
    _setEmbeddedBpmForTest('p1', 120);
    const evidence = resolveTraitEvidence({
      id: 'p1', title: 'Gizli Şarkı Adı', artist: 'Gizli Sanatçı',
      durationMs: 200_000, genre: 'Pop', generationModified: 3,
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('Gizli Şarkı Adı');
    expect(serialized).not.toContain('Gizli Sanatçı');
    expect(serialized).not.toContain('content://');
    /* Sinyaller ETİKETTİR. */
    expect(evidence.signals.every((sig) => /^[a-z]+:[a-zA-Z0-9_]+$/.test(sig))).toBe(true);
  });

  it('13 · MediaStore GENRE/YEAR gerçekten sorgulanıyor ve uydurulmuyor', () => {
    const scanner = read(
      'android/app/src/main/java/com/cockpitos/pro/media/MediaStoreLibraryScanner.java',
    );
    expect(scanner, 'GENRE projeksiyona eklenmemiş').toContain('MediaStore.Audio.Media.GENRE');
    expect(scanner, 'YEAR projeksiyona eklenmemiş').toContain('MediaStore.Audio.Media.YEAR');
    /* API 30 altında GENRE sorgulanamaz — kapı kaldırılamaz. */
    expect(scanner, 'GENRE sürüm kapısı kaldırılmış').toContain('supportsGenreColumn');
    /* Boş değer `null` gider — sahte "Bilinmeyen Tür"/0 yıl YOK. */
    expect(scanner, 'boş tür uydurulmuş').toContain('JSONObject.NULL');

    const index = read('src/platform/media/musicIndex.ts');
    expect(index, 'kütüphane sözleşmesi tür/yıl taşımıyor').toMatch(/readonly genre: string \| null/);
    expect(index, 'yıl alanı eklenmemiş').toMatch(/readonly year: number \| null/);
  });
});
