/**
 * traitSources.ts — MUSIC F10.1 · GERÇEK kanıt kaynaklarının adaptörleri (SAF).
 *
 * F10 yalnız zayıf türetimlerle (süre + başlık ipucu) çalışıyordu. F10.1 iki
 * GERÇEK kaynağı bağlar:
 *
 *   1. `EMBEDDED_METADATA` — dosyaya gömülü ID3 `TBPM` / Vorbis `BPM`.
 *      Bu bir ETİKETTİR: üreticinin yazdığı gerçek bir değerdir, ses analizi
 *      DEĞİLDİR. Bu yüzden **tempo GERÇEKTİR**, ondan türetilen **enerji bir
 *      ÇIKARIMDIR** ve `MEDIUM` güvenle taşınır.
 *
 *   2. `LIBRARY_METADATA` — MediaStore `GENRE`.
 *      Tür TEK BAŞINA kesin bir ruh hâli DEĞİLDİR (F10.1 §6): "rock" enerjik
 *      olmak zorunda değildir. Bu yüzden tür yalnız **DESTEKLEYİCİ** kanıttır,
 *      `LOW` güven taşır ve **mood ÜRETMEZ** (yalnız enerji bandı önerir).
 *
 * BAĞLANMAYANLAR (uydurulmadı): sağlayıcı trait alanı yok · Spotify
 * `audio-features` sözleşmesi doğrulanamadı · ses analizi yapılmıyor.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import {
  makeTraitEvidence, NO_TRAIT_EVIDENCE, type MusicTraitEvidence,
} from './musicTraitEvidence';

/* ── 1 · Gömülü BPM etiketi ──────────────────────────────────────────────── */

/** Etiket bu aralığın dışındaysa ÖLÇÜM değil, bozuk veridir. */
export const MIN_VALID_BPM = 40;
export const MAX_VALID_BPM = 250;

/**
 * BPM → enerji ÇIKARIMI.
 *
 * Tempo gerçektir; "enerji" ondan türetilen bir yorumdur. Bant sınırları
 * bilinçli olarak KABADIR — ince ayrım yapmak, elimizdeki kanıttan fazlasını
 * iddia etmek olurdu.
 */
export function energyFromBpm(bpm: number): number {
  if (bpm < 80) return 0.25;
  if (bpm < 100) return 0.4;
  if (bpm < 125) return 0.55;
  if (bpm < 145) return 0.72;
  return 0.85;
}

/**
 * Gömülü BPM etiketinden kanıt.
 *
 * `tempoBpm` GERÇEK değerdir ve `EMBEDDED_METADATA` bunu taşıyabilir.
 * Güven `MEDIUM`dur: etiket doğrudur ama "enerji" yorumu ölçüm değildir.
 * **Mood ÜRETİLMEZ** — BPM bir ruh hâli değildir.
 */
export function fromEmbeddedBpm(
  bpm: number | null, o: { readonly sourceTag?: string; readonly observedAtMs?: number | null } = {},
): MusicTraitEvidence {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return NO_TRAIT_EVIDENCE;
  if (bpm < MIN_VALID_BPM || bpm > MAX_VALID_BPM) return NO_TRAIT_EVIDENCE;
  return makeTraitEvidence({
    provenance: 'EMBEDDED_METADATA',
    sourceId: 'embedded.bpm',
    tempoBpm: Math.round(bpm),
    energy: energyFromBpm(bpm),
    mood: null,
    confidence: 'MEDIUM',
    observedAtMs: o.observedAtMs ?? null,
    signals: [`bpm:${o.sourceTag ?? 'TAG'}`],
  });
}

/* ── 2 · Kütüphane türü (MediaStore GENRE) ───────────────────────────────── */

/**
 * Tür → enerji bandı (DESTEKLEYİCİ kanıt).
 *
 * Liste bilinçli olarak KISA ve YÜKSEK SEÇİCİLİKLİDİR. Tanınmayan tür kanıt
 * ÜRETMEZ — "bilinmeyen tür" diye bir kanıt yoktur.
 */
const GENRE_ENERGY: readonly (readonly [readonly string[], number])[] = Object.freeze([
  [['klasik', 'classical', 'ambient', 'new age', 'meditation', 'lullaby', 'ninni'], 0.2],
  [['akustik', 'acoustic', 'folk', 'blues', 'jazz', 'caz', 'sanat muzigi', 'arabesk'], 0.35],
  [['pop', 'rnb', 'r&b', 'soul', 'country', 'halk muzigi'], 0.55],
  [['rock', 'alternative', 'indie', 'hip hop', 'hip-hop', 'rap', 'reggae'], 0.65],
  [['metal', 'punk', 'techno', 'trance', 'house', 'edm', 'dance', 'hardstyle', 'drum and bass'], 0.85],
]);

function normalizeGenre(raw: string | null): string {
  return (raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * MediaStore türünden kanıt.
 *
 * `LOW` güven bilinçlidir (F10.1 §6): tür bir eğilimdir, kesinlik değil.
 * **Mood ÜRETİLMEZ** ve bu kanıt tek başına kesin dil KURDURAMAZ; gömülü BPM
 * varsa o kazanır (provenance sırası).
 */
export function fromLibraryGenre(
  genre: string | null, o: { readonly observedAtMs?: number | null } = {},
): MusicTraitEvidence {
  const g = normalizeGenre(genre);
  if (g.length === 0) return NO_TRAIT_EVIDENCE;

  for (const [tokens, energy] of GENRE_ENERGY) {
    if (tokens.some((t) => g.includes(t))) {
      return makeTraitEvidence({
        provenance: 'LIBRARY_METADATA',
        sourceId: 'library.genre',
        energy,
        /* Tür TEK BAŞINA ruh hâli iddiası KURAMAZ (§6). */
        mood: null,
        confidence: 'LOW',
        observedAtMs: o.observedAtMs ?? null,
        signals: ['genre:known'],
      });
    }
  }
  /* Tanınmayan tür bir kanıt DEĞİLDİR — sahte bir bant atanmaz. */
  return NO_TRAIT_EVIDENCE;
}

/* ── 3 · Sağlayıcı kaynakları (bugün BAĞLI DEĞİL) ────────────────────────── */

export type ProviderTraitAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'UNVERIFIED';

/**
 * Sağlayıcı trait yeteneğinin ÖLÇÜLEN durumu.
 *
 * Bu tablo bir NİYET değil, bir ÖLÇÜM kaydıdır: kod bugün bu kaynaklardan
 * kanıt OKUMAZ ve okuyormuş gibi davranmaz.
 */
export const PROVIDER_TRAIT_AVAILABILITY:
Readonly<Record<string, ProviderTraitAvailability>> = Object.freeze({
  /** MediaStore GENRE + gömülü BPM bağlandı. */
  local: 'AVAILABLE',
  /** Piped yanıtında trait alanı YOK (başlık · yükleyen · süre · kapak). */
  youtube: 'UNSUPPORTED',
  /** `audio-features` sözleşmesi bu turda doğrulanamadı → varmış gibi davranılmadı. */
  spotify: 'UNVERIFIED',
  /** Canlı yayında parça karakteri kavramı yoktur. */
  radio: 'UNSUPPORTED',
  audius: 'UNAVAILABLE',
  jamendo: 'UNAVAILABLE',
  archive: 'UNAVAILABLE',
  stream: 'UNAVAILABLE',
});

/**
 * Sağlayıcı kanıtı okunabilir mi.
 *
 * `AVAILABLE` dışındaki her durumda kanıt ÜRETİLMEZ — özellikle `UNVERIFIED`
 * "muhtemelen vardır" demek DEĞİLDİR.
 */
export function providerTraitReadable(providerId: string): boolean {
  return PROVIDER_TRAIT_AVAILABILITY[providerId] === 'AVAILABLE';
}
