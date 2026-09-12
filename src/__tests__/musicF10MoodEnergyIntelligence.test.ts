/**
 * musicF10MoodEnergyIntelligence.test.ts — MUSIC F10 · Karakter/enerji zekâsı.
 *
 * ÖLÇÜLEN GERÇEK: CarOS'ta bugün hiçbir kaynak gerçek enerji/tempo ölçümü
 * vermiyor (MediaStore projeksiyonunda GENRE/YEAR yok · Piped'da trait yok ·
 * Spotify `audio-features` çağrılmıyor). F10 bunu GİZLEMEZ.
 *
 * Bu paket şunları kilitler:
 *   · BPM yalnız GERÇEK ölçümden gelir — süre/başlıktan ASLA
 *   · sezgisel kanıt `LOW` tavanını aşamaz; birleştirme güveni YÜKSELTMEZ
 *   · "daha sakin/enerjik" GÖRECELİDİR: referans kanıtı yoksa sahte kıyas YOK
 *   · kanıtsız aday sessizce düşmez, sayılarak elenir
 *   · zayıf kanıttan KESİN dil doğmaz ("deneyeyim" ↔ "açıyorum")
 *   · F10 çalma başlatmaz · kuyruk/indeks/tercih kanıtı YAZMAZ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  hasTraitEvidence, makeTraitEvidence, mergeTraitEvidence, MAX_HEURISTIC_CONFIDENCE,
  NO_TRAIT_EVIDENCE, mayCarryTempo, weakerConfidence,
} from '../platform/media/traits/musicTraitEvidence';
import {
  deriveAvailableTraits, deriveFromDuration, deriveFromText, LONG_TRACK_MS,
} from '../platform/media/traits/traitHeuristics';
import {
  allowsConfidentClaim, isRelativeDirection, RELATIVE_ENERGY_MARGIN, selectByTrait,
  type TraitCandidate,
} from '../platform/media/traits/traitSelectionModel';
import {
  _resetTraitTelemetryForTest, getTraitTelemetry,
} from '../platform/media/traits/traitTelemetry';
import { makeIntent, makeOutcome } from '../platform/media/intent/musicIntent';
import { claimIsHonest, speakMusicOutcome } from '../platform/media/intent/musicIntentSpeech';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const candidate = (id: string, energy: number | null, o: {
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  provenance?: 'PROVIDER_METADATA' | 'HEURISTIC_TEXT' | 'DERIVED_DURATION';
} = {}): TraitCandidate => ({
  id,
  evidence: makeTraitEvidence({
    provenance: o.provenance ?? 'PROVIDER_METADATA',
    sourceId: 'test',
    energy,
    confidence: o.confidence ?? 'HIGH',
  }),
});

beforeEach(() => { _resetTraitTelemetryForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · KANIT MODELİ: uydurma yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10 · kanıt modeli uydurmayı ENGELLER', () => {
  it('1 · BPM yalnız GERÇEK ölçüm kaynağından gelir', () => {
    expect(mayCarryTempo('PROVIDER_METADATA')).toBe(true);
    /* F10.1'de SIKILAŞTIRILDI (gevşetilmedi): kütüphane metadata'sı tür/yıldır
       ve BPM taşıyamaz. Gerçek etiket kaynağı `EMBEDDED_METADATA`dır. */
    expect(mayCarryTempo('EMBEDDED_METADATA')).toBe(true);
    expect(mayCarryTempo('LIBRARY_METADATA'), 'türden BPM üretilebiliyor').toBe(false);
    expect(mayCarryTempo('DERIVED_DURATION'), 'süreden BPM üretilebiliyor').toBe(false);
    expect(mayCarryTempo('HEURISTIC_TEXT'), 'başlıktan BPM üretilebiliyor').toBe(false);

    /* Model, çağıran ısrar etse bile BPM'i DÜŞÜRÜR. */
    const faked = makeTraitEvidence({
      provenance: 'HEURISTIC_TEXT', sourceId: 'x',
      energy: 0.8, tempoBpm: 128, confidence: 'LOW',
    });
    expect(faked.tempoBpm, 'sezgisel kaynak BPM yazabildi').toBeNull();
  });

  it('2 · sezgisel/türetilmiş kanıt LOW tavanını AŞAMAZ', () => {
    const overreach = makeTraitEvidence({
      provenance: 'HEURISTIC_TEXT', sourceId: 'x', energy: 0.9, confidence: 'HIGH',
    });
    expect(overreach.confidence).toBe(MAX_HEURISTIC_CONFIDENCE);

    const duration = makeTraitEvidence({
      provenance: 'DERIVED_DURATION', sourceId: 'x', energy: 0.3, confidence: 'MEDIUM',
    });
    expect(duration.confidence).toBe('LOW');

    /* Gerçek ölçüm kaynağı tavan uygulamaz. */
    const real = makeTraitEvidence({
      provenance: 'PROVIDER_METADATA', sourceId: 'x', energy: 0.9,
      tempoBpm: 128, confidence: 'HIGH',
    });
    expect(real.confidence).toBe('HIGH');
    expect(real.tempoBpm).toBe(128);
  });

  it('3 · birleştirme güveni YÜKSELTMEZ; boş kanıt kanıt DEĞİLDİR', () => {
    const a = makeTraitEvidence({
      provenance: 'HEURISTIC_TEXT', sourceId: 'a', energy: 0.25, confidence: 'LOW',
      signals: ['text:calm'],
    });
    const b = makeTraitEvidence({
      provenance: 'DERIVED_DURATION', sourceId: 'b', energy: 0.35, confidence: 'LOW',
      signals: ['duration:long'],
    });
    const merged = mergeTraitEvidence(a, b);
    expect(merged.confidence, 'iki zayıf kanıt güçlü kanıt oldu').toBe('LOW');
    /* Güçlü provenance kazanır (süre > metin). */
    expect(merged.provenance).toBe('DERIVED_DURATION');
    /* Sinyal ETİKETLERİ birleşir (içerik değil, etiket). */
    expect([...merged.signals].sort()).toEqual(['duration:long', 'text:calm']);

    expect(mergeTraitEvidence(NO_TRAIT_EVIDENCE, NO_TRAIT_EVIDENCE)).toEqual(NO_TRAIT_EVIDENCE);
    expect(hasTraitEvidence(NO_TRAIT_EVIDENCE)).toBe(false);
    /* Değersiz kanıt `NONE`a düşer — sahte "var" iddiası yok. */
    const empty = makeTraitEvidence({ provenance: 'PROVIDER_METADATA', sourceId: 'x', confidence: 'HIGH' });
    expect(empty.confidence).toBe('NONE');
    expect(hasTraitEvidence(empty)).toBe(false);
  });

  it('4 · çelişen/eksik metin ipucu kanıt ÜRETMEZ', () => {
    expect(hasTraitEvidence(deriveFromText('Akustik Remix', null)),
      'çelişen ipuçlarından kanıt üretilmiş').toBe(false);
    expect(hasTraitEvidence(deriveFromText('Bilinmeyen Parça', 'Sanatçı'))).toBe(false);
    expect(deriveFromText('Akustik Gece', null).mood).toBe('CALM');
    expect(deriveFromText('Hardstyle Remix', null).mood).toBe('ENERGETIC');
    expect(deriveFromText('Akustik Gece', null).signals).toContain('text:calm');
    /* Başlık metni kanıta SIZMAZ — yalnız etiket taşınır. */
    expect(JSON.stringify(deriveFromText('Akustik Gece', 'Sezen'))).not.toContain('Sezen');

    /* Tipik uzunluk hiçbir şey söylemez. */
    expect(hasTraitEvidence(deriveFromDuration(3 * 60_000))).toBe(false);
    expect(deriveFromDuration(LONG_TRACK_MS + 1000).mood).toBe('CALM');
    expect(hasTraitEvidence(deriveFromDuration(null))).toBe(false);
    expect(deriveAvailableTraits({ title: null, artist: null, durationMs: null })
      .confidence).toBe('NONE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–8 · SEÇİM: göreceli · fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10 · seçim fail-closed', () => {
  it('5 · göreceli istek REFERANS ister — sahte kıyas yok', () => {
    expect(isRelativeDirection('CALMER')).toBe(true);
    expect(isRelativeDirection('FOR_DRIVE')).toBe(false);

    const noRef = selectByTrait({
      direction: 'CALMER', reference: null, candidates: [candidate('a', 0.1)],
    });
    expect(noRef.status).toBe('NO_REFERENCE');
    expect(noRef.selectedId).toBeNull();
    expect(noRef.reasonCode).toBe('reference_trait_unavailable');

    /* Referans VAR ama kanıtsız → yine kıyas YOK. */
    const blindRef = selectByTrait({
      direction: 'CALMER', reference: NO_TRAIT_EVIDENCE, candidates: [candidate('a', 0.1)],
    });
    expect(blindRef.status).toBe('NO_REFERENCE');
  });

  it('6 · kanıtsız adaylar SAYILARAK elenir; yön dışı adaylar seçilmez', () => {
    const reference = makeTraitEvidence({
      provenance: 'PROVIDER_METADATA', sourceId: 'r', energy: 0.6, confidence: 'HIGH',
    });
    const r = selectByTrait({
      direction: 'CALMER',
      reference,
      candidates: [
        { id: 'blind', evidence: NO_TRAIT_EVIDENCE },
        candidate('louder', 0.9),
        candidate('slightly', 0.5),      // fark marjın ALTINDA
        candidate('calm', 0.2),
      ],
    });
    expect(r.status).toBe('SELECTED');
    expect(r.selectedId, 'en uç aday seçilmedi').toBe('calm');
    expect(r.rejectedNoEvidence).toBe(1);
    expect(r.rejectedWrongDirection).toBe(2);
    expect(r.consideredCount).toBe(3);

    /* Marjın altındaki fark "daha sakin" SAYILMAZ. */
    const tooClose = selectByTrait({
      direction: 'CALMER', reference,
      candidates: [candidate('x', 0.6 - RELATIVE_ENERGY_MARGIN + 0.01)],
    });
    expect(tooClose.status).toBe('NO_CANDIDATE');
  });

  it('7 · hiç kanıtlı aday yoksa NO_EVIDENCE — rastgele parça seçilmez', () => {
    const reference = makeTraitEvidence({
      provenance: 'PROVIDER_METADATA', sourceId: 'r', energy: 0.6, confidence: 'HIGH',
    });
    const r = selectByTrait({
      direction: 'MORE_ENERGETIC', reference,
      candidates: [
        { id: 'a', evidence: NO_TRAIT_EVIDENCE },
        { id: 'b', evidence: NO_TRAIT_EVIDENCE },
      ],
    });
    expect(r.status).toBe('NO_EVIDENCE');
    expect(r.selectedId).toBeNull();
    expect(r.rejectedNoEvidence).toBe(2);
  });

  it('8 · seçim güveni EN ZAYIF halkadır; sezgiselden KESİN dil doğmaz', () => {
    expect(weakerConfidence('HIGH', 'LOW')).toBe('LOW');

    const weakRef = makeTraitEvidence({
      provenance: 'HEURISTIC_TEXT', sourceId: 'r', energy: 0.8, confidence: 'LOW',
    });
    const strongCandidate = candidate('calm', 0.2, { confidence: 'HIGH' });
    const r = selectByTrait({
      direction: 'CALMER', reference: weakRef, candidates: [strongCandidate],
    });
    expect(r.status).toBe('SELECTED');
    expect(r.confidence, 'zayıf referanstan güçlü karar doğdu').toBe('LOW');
    expect(allowsConfidentClaim(r), 'sezgisel kanıttan KESİN iddia doğdu').toBe(false);

    /* İki taraf da güçlüyse kesin dil meşrudur. */
    const strongRef = makeTraitEvidence({
      provenance: 'PROVIDER_METADATA', sourceId: 'r', energy: 0.8, confidence: 'HIGH',
    });
    const strong = selectByTrait({
      direction: 'CALMER', reference: strongRef, candidates: [strongCandidate],
    });
    expect(allowsConfidentClaim(strong)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–11 · BAĞLAM HEDEFLİ · KONUŞMA · TELEMETRİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10 · bağlam hedefli seçim ve dürüst dil', () => {
  it('9 · FOR_DRIVE / NIGHT_CALM referans GEREKTİRMEZ ama kanıt ister', () => {
    const drive = selectByTrait({
      direction: 'FOR_DRIVE', reference: null,
      candidates: [candidate('calm', 0.15), candidate('mid', 0.62), candidate('wild', 0.99)],
    });
    expect(drive.status).toBe('SELECTED');
    expect(drive.selectedId, 'yol hedefine en yakın aday seçilmedi').toBe('mid');

    const night = selectByTrait({
      direction: 'NIGHT_CALM', reference: null,
      candidates: [candidate('calm', 0.28), candidate('wild', 0.95)],
    });
    expect(night.selectedId).toBe('calm');

    /* Hedeften çok uzak adaylar "uygun" SAYILMAZ. */
    const far = selectByTrait({
      direction: 'NIGHT_CALM', reference: null, candidates: [candidate('wild', 0.95)],
    });
    expect(far.status).toBe('NO_CANDIDATE');
  });

  it('10 · zayıf kanıtta TEMKİNLİ, güçlü kanıtta kesin dil kurulur', () => {
    const tentative = makeOutcome(
      makeIntent('PLAY_SOMETHING_CALMER'), 'F10_TRAIT_EVIDENCE',
      'ACCEPTED_UNVERIFIED', 'trait_selected_tentative',
    );
    const spokenTentative = speakMusicOutcome(tentative);
    expect(spokenTentative).toContain('olabilecek');
    expect(spokenTentative).toContain('deneyeyim');
    expect(claimIsHonest(tentative, spokenTentative)).toBe(true);

    const confident = makeOutcome(
      makeIntent('PLAY_SOMETHING_MORE_ENERGETIC'), 'F10_TRAIT_EVIDENCE',
      'ACCEPTED_UNVERIFIED', 'trait_selected_confident',
    );
    const spokenConfident = speakMusicOutcome(confident);
    expect(spokenConfident).toContain('Daha hareketli');
    expect(spokenConfident).toContain('açıyorum');
    expect(claimIsHonest(confident, spokenConfident),
      'tamamlanmış eylem iddiası kuruldu').toBe(true);

    /* Kanıt yoksa dürüst red — teknik kod OKUNMAZ. */
    for (const code of ['trait_reference_unavailable', 'trait_evidence_unavailable',
      'trait_no_candidate']) {
      const declined = makeOutcome(
        makeIntent('PLAY_SOMETHING_CALMER'), 'F10_TRAIT_EVIDENCE', 'UNAVAILABLE', code,
      );
      const spoken = speakMusicOutcome(declined);
      expect(spoken, `teknik kod okundu: ${code}`).not.toContain(code);
      expect(claimIsHonest(declined, spoken)).toBe(true);
      expect(spoken.length).toBeGreaterThan(10);
    }
  });

  it('11 · telemetri kanıt kökenini sayar ve METİN yazmaz', () => {
    const before = getTraitTelemetry();
    expect(before.counters.requests).toBe(0);
    expect(before.counters.claimMismatch).toBe(0);

    const telemetrySrc = read('src/platform/media/traits/traitTelemetry.ts');
    const body = strip(telemetrySrc);
    for (const forbidden of ['title', 'artist', 'query', 'utterance', 'uri']) {
      expect(body, `metin alanı telemetriye sızmış: ${forbidden}`)
        .not.toMatch(new RegExp(`readonly ${forbidden}`));
    }
    /* Gerçek ölçüm sayacı BUGÜN 0 olmalıdır — kaynak bağlı değil. */
    expect(before.counters.evidenceProvider).toBe(0);
    expect(before.counters.evidenceLibrary).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12–13 · AUTHORITY SINIRI (statik kilit)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F10 · ikinci otorite KURMAZ', () => {
  const model = strip(read('src/platform/media/traits/musicTraitEvidence.ts'));
  const heuristics = strip(read('src/platform/media/traits/traitHeuristics.ts'));
  const selection = strip(read('src/platform/media/traits/traitSelectionModel.ts'));
  const runtime = strip(read('src/platform/media/traits/traitRuntime.ts'));

  it('12 · saf katmanlar SAF kalır', () => {
    for (const [name, src] of [['kanıt modeli', model], ['sezgisel', heuristics],
      ['seçim modeli', selection]] as const) {
      expect(src.length, `${name} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(800);
      expect(src, `${name} zamana bağlanmış`).not.toContain('Date.now');
      expect(src, `${name} timer kurmuş`).not.toMatch(/setInterval|setTimeout/);
      expect(src, `${name} React'e bağlanmış`).not.toContain("from 'react'");
      expect(src, `${name} otoriteye inmiş`).not.toContain('mediaCommandGateway');
      expect(src, `${name} native köprüye inmiş`).not.toContain('nativeAuthorityBridge');
    }
  });

  it('13 · runtime çalma başlatmaz, kuyruk/kütüphane/tercih YAZMAZ, timer kurmaz', () => {
    expect(runtime.length, 'runtime okunamadı — kilit boş kümeye düştü').toBeGreaterThan(1500);
    expect(runtime, 'F10 kendi zamanlayıcısını kurmuş').not.toMatch(/setInterval\s*\(/);
    expect(runtime, 'F10 yoklama döngüsü kurmuş').not.toMatch(/setTimeout\s*\(/);
    expect(runtime, 'F10 komut kapısına inmiş').not.toContain('mediaCommandGateway');
    expect(runtime, 'F10 doğrudan çalma başlatmış').not.toContain('startLibraryListening');
    expect(runtime, 'F10 kanonik kuyruğa yazmış').not.toContain('session/playQueue');
    expect(runtime, 'F10 kütüphaneye yazmış').not.toContain('reconcileMusicIndex');
    expect(runtime, 'F10 tercih kanıtına yazmış').not.toContain('notePreferenceOutcome');
    expect(runtime, 'F10 sağlayıcıya inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    /* Sınırlı kaynak kullanımı kaldırılamaz. */
    expect(runtime, 'önbellek sınırı kaldırılmış').toContain('MAX_TRAIT_CACHE');
    expect(runtime, 'aday tarama sınırı kaldırılmış').toContain('MAX_CANDIDATE_SCAN');
  });
});
