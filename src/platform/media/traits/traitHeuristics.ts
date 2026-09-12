/**
 * traitHeuristics.ts — MUSIC F10 · Bugün elde EDİLEBİLEN zayıf kanıtlar (SAF).
 *
 * Burada üretilen hiçbir şey ÖLÇÜM değildir. İki kaynak vardır ve ikisi de
 * açıkça etiketlenir:
 *   1. `DERIVED_DURATION` — süre gerçek bir ölçümdür, ama enerjiyle ilişkisi
 *      ZAYIFTIR (uzun parça çoğunlukla daha sakindir; kural değil eğilim).
 *   2. `HEURISTIC_TEXT` — başlıkta/sanatçıda geçen sözcük ipuçları. Yanılır:
 *      "Slow Motion" adlı bir metal parçası olabilir. Bu yüzden güven tavanı
 *      `LOW`dur ve kullanıcıya kesin dil KURDURMAZ.
 *
 * GİZLİLİK: başlık/sanatçı metni bu modülün DIŞINA çıkmaz — dönen kanıt yalnız
 * ETİKET taşır (`text:calm` gibi), içerik taşımaz.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import {
  makeTraitEvidence, mergeTraitEvidence, NO_TRAIT_EVIDENCE,
  type MusicTraitEvidence,
} from './musicTraitEvidence';

/** Türkçe/İngilizce normalleştirme — arama katmanıyla aynı ilke. */
function normalize(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Sözcük listeleri bilinçli olarak KISA ve YÜKSEK SEÇİCİLİKLİDİR: geniş liste
   daha çok yanlış pozitif üretir ve zayıf kanıt daha da güvenilmez olur. */
const CALM_TOKENS: readonly string[] = Object.freeze([
  'akustik', 'acoustic', 'unplugged', 'sakin', 'yavas', 'slow', 'ballad', 'balad',
  'piyano', 'piano', 'enstrumantal', 'instrumental', 'lofi', 'lo-fi', 'chill',
  'ninni', 'lullaby', 'nocturne', 'ambient', 'meditation', 'meditasyon', 'sleep',
]);
const ENERGETIC_TOKENS: readonly string[] = Object.freeze([
  'remix', 'dance', 'club', 'party', 'workout', 'energy', 'hardstyle', 'techno',
  'metal', 'punk', 'rock n roll', 'rock and roll', 'halay', 'oyun havasi',
  'hizli', 'turbo', 'bass boosted', 'trap', 'drill', 'rave',
]);

/** Süre eşikleri (ms) — eğilim sınırları, kesin kural DEĞİL. */
export const LONG_TRACK_MS = 6 * 60_000;
export const SHORT_TRACK_MS = 100_000;

const hasToken = (text: string, tokens: readonly string[]): boolean =>
  tokens.some((t) => text.includes(t));

/**
 * Başlık/sanatçıdan sözcük ipucu.
 *
 * Her iki yön de tuttuysa kanıt YOKTUR: çelişen ipucu bir kanıt değildir
 * (ör. "Acoustic Remix"). Sessizce bir tarafı seçmek uydurma olurdu.
 */
export function deriveFromText(
  title: string | null, artist: string | null,
): MusicTraitEvidence {
  const text = `${normalize(title)} ${normalize(artist)}`.trim();
  if (text.length === 0) return NO_TRAIT_EVIDENCE;

  const calm = hasToken(text, CALM_TOKENS);
  const energetic = hasToken(text, ENERGETIC_TOKENS);
  if (calm === energetic) return NO_TRAIT_EVIDENCE;   // ikisi de / hiçbiri → kanıt yok

  return makeTraitEvidence({
    provenance: 'HEURISTIC_TEXT',
    sourceId: 'heuristic.text',
    energy: calm ? 0.25 : 0.75,
    mood: calm ? 'CALM' : 'ENERGETIC',
    confidence: 'LOW',
    signals: [calm ? 'text:calm' : 'text:energetic'],
  });
}

/**
 * Süreden türetilen zayıf sinyal.
 *
 * BPM ÜRETMEZ (model bunu zaten reddeder). Orta uzunlukta bir parça hiçbir şey
 * söylemez → kanıt YOK.
 */
export function deriveFromDuration(durationMs: number | null): MusicTraitEvidence {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return NO_TRAIT_EVIDENCE;
  }
  if (durationMs >= LONG_TRACK_MS) {
    return makeTraitEvidence({
      provenance: 'DERIVED_DURATION',
      sourceId: 'derived.duration',
      energy: 0.35,
      mood: 'CALM',
      confidence: 'LOW',
      signals: ['duration:long'],
    });
  }
  if (durationMs <= SHORT_TRACK_MS) {
    return makeTraitEvidence({
      provenance: 'DERIVED_DURATION',
      sourceId: 'derived.duration',
      energy: 0.6,
      mood: null,
      confidence: 'LOW',
      signals: ['duration:short'],
    });
  }
  return NO_TRAIT_EVIDENCE;   // tipik uzunluk bir şey SÖYLEMEZ
}

export interface TraitInput {
  readonly title: string | null;
  readonly artist: string | null;
  readonly durationMs: number | null;
}

/**
 * Bugün elde edilebilen tüm zayıf kanıtları birleştirir.
 *
 * Sonuç en fazla `LOW` güven taşır — bu bilinçlidir: gerçek ölçüm gelene kadar
 * F10 kullanıcıya KESİN dil kurduramaz.
 */
export function deriveAvailableTraits(input: TraitInput): MusicTraitEvidence {
  return mergeTraitEvidence(
    deriveFromText(input.title, input.artist),
    deriveFromDuration(input.durationMs),
  );
}
