/**
 * smartRadioModel.ts — MUSIC F18 · Kesintisiz akış ADAY POLİTİKASI (SAF).
 *
 * ── NE OLDUĞU / NE OLMADIĞI ──────────────────────────────────────────────
 * Smart Radio **kuyruk otoritesi DEĞİLDİR** (Cross-Domain §1). Burada üretilen
 * şey yalnız bir SIRALAMA ÖNERİSİDİR — kimlik listesi. Gerçek zincir:
 *
 *   `SmartRadio aday politikası → PlayQueue (F3) → ListeningSession (F3)
 *      → mediaCommandGateway (F0) → playbackTruth`
 *
 * Bu dosya kuyruğa yazmaz, oturum kurmaz, komut göndermez, kalıcı durum
 * TUTMAZ ("sonsuz radyo state" YOKTUR — her istek sınırlı bir liste üretir).
 *
 * ── DÜRÜSTLÜK SINIRLARI ──────────────────────────────────────────────────
 *   · **Zayıf kanıtla "sana özel" iddiası KURULMAZ.** Sonuç bir `claimClass`
 *     taşır: `MEASURED` (ses ölçümüne dayalı) · `WEAK` (yalnız etiket/sezgisel)
 *     · `FALLBACK` (kanıt YOK — deterministik sıra). Konuşma dili bunu izler.
 *   · **Rastgelelik YOKTUR.** Kanıt yoksa bile sıra DETERMİNİSTİKtir (kararlı
 *     karma) — aynı girdi aynı sırayı verir, "her seferinde farklı" diye
 *     gizlenen bir keyfîlik OLUŞMAZ.
 *   · **Karma-sağlayıcı kuyruk ÜRETİLMEZ:** havuz yalnız YEREL kütüphanedir.
 *     Sağlayıcı içeriğinin ölçülebilir karakteri yoktur (F17 #1167) ve
 *     same-provider kuralı (F7.6) bozulamaz.
 *   · **Tekrar SINIRLI biçimde azaltılır**, sıfırlanmaz: yakın geçmişte
 *     çalanlar elenir; eleme havuzu bitirirse dürüstçe geri alınır ve SAYILIR.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import {
  hasTraitEvidence, type MusicTraitEvidence,
} from '../traits/musicTraitEvidence';
import { sonicSimilarity, type SonicDescriptor } from '../sonic/sonicDescriptor';

/** Bir turda üretilecek EN FAZLA öğe — "sonsuz" liste ÜRETİLMEZ. */
export const MAX_RADIO_LENGTH = 40;
/** Varsayılan hedef uzunluk. */
export const DEFAULT_RADIO_LENGTH = 20;
/**
 * `MEASURED` iddiası için gereken EN AZ ölçülmüş aday oranı.
 * Tek bir ölçülmüş parça "ölçüme dayalı radyo" demek DEĞİLDİR.
 */
export const MEASURED_CLAIM_MIN_RATIO = 0.5;
/** `MEASURED` iddiası için gereken EN AZ ölçülmüş aday adedi. */
export const MEASURED_CLAIM_MIN_COUNT = 4;

export type RadioSeedKind = 'CURRENT_TRACK' | 'FAVORITES' | 'DRIVE_CONTEXT' | 'NONE';

/** Kullanıcıya kurulabilecek iddianın SINIFI — kanıt neyse o. */
export type RadioClaimClass =
  /** Ses ölçümüne (F17) dayalı gerçek benzerlik. */
  | 'MEASURED'
  /** Yalnız etiket/tür/sezgisel kanıt — "benziyor" denemez, "devam" denir. */
  | 'WEAK'
  /** Kanıt YOK — deterministik sıra; kişiselleştirme İDDİA EDİLMEZ. */
  | 'FALLBACK';

export type RadioStatus = 'READY' | 'NO_CANDIDATES' | 'EMPTY_LIBRARY';

/** Sürüş bağlamının verdiği YÖN — karar otoritesi DEĞİL, yalnız eğilim. */
export type RadioDrivingBias = 'CALM' | 'ENERGETIC' | 'NONE';

export interface RadioCandidate {
  readonly id: string;
  /** Sanatçı aralama anahtarı (normalize edilmiş); bilinmiyorsa `null`. */
  readonly artistKey: string | null;
  readonly evidence: MusicTraitEvidence;
  /** F17 ölçümü — yoksa `null` (uydurulmaz). */
  readonly descriptor: SonicDescriptor | null;
  readonly favorite: boolean;
  /** 0 = en son çalan. Yakın geçmişte değilse `null`. */
  readonly recentRank: number | null;
}

export interface RadioPolicyInput {
  readonly seedKind: RadioSeedKind;
  /** Çekirdek parça (varsa) — sonuçtan DIŞLANIR. */
  readonly seedId: string | null;
  readonly seedEvidence: MusicTraitEvidence | null;
  readonly seedDescriptor: SonicDescriptor | null;
  readonly candidates: readonly RadioCandidate[];
  /** Yalnız favorilerden akış istendi mi. */
  readonly favoritesOnly: boolean;
  readonly targetLength: number;
  readonly drivingBias: RadioDrivingBias;
}

export interface RadioSequence {
  readonly status: RadioStatus;
  readonly reasonCode: string;
  readonly claimClass: RadioClaimClass;
  readonly trackIds: readonly string[];
  /** Sıranın ilk öğesi — çağıran bunu `startTrackId` olarak kullanır. */
  readonly startTrackId: string | null;
  readonly seedKind: RadioSeedKind;
  /** Seçilenler içinde GERÇEK ses ölçümü olan adet. */
  readonly measuredCount: number;
  readonly consideredCount: number;
  /** Yakın geçmişte çaldığı için elenen adet. */
  readonly excludedRecent: number;
  /** Havuz yetmediği için geri ALINAN (tekrar izni verilen) adet. */
  readonly recentReadmitted: number;
  /** Aynı sanatçının arka arkaya gelmemesi için kaydırılan adet. */
  readonly artistSpacingApplied: number;
}

const empty = (status: RadioStatus, reasonCode: string, seedKind: RadioSeedKind): RadioSequence =>
  Object.freeze({
    status, reasonCode, claimClass: 'FALLBACK' as const,
    trackIds: Object.freeze([] as readonly string[]), startTrackId: null,
    seedKind, measuredCount: 0, consideredCount: 0,
    excludedRecent: 0, recentReadmitted: 0, artistSpacingApplied: 0,
  });

/** Kararlı karma (djb2) — `Math.random` YOKTUR, sıra tekrarlanabilirdir. */
export function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Bir adayın çekirdeğe benzerliği — **kanıt yoksa `null`.**
 *
 * Sıra ANLAMLIDIR: ses ölçümü (F17) > enerji kanıtı (F10) > kanıt yok.
 * Zayıf kanıt güçlü kanıt gibi PUANLANMAZ; ikinci dal ayrıca işaretlenir.
 */
export function similarityToSeed(
  seedDescriptor: SonicDescriptor | null,
  seedEvidence: MusicTraitEvidence | null,
  candidate: RadioCandidate,
): { readonly score: number; readonly measured: boolean } | null {
  const sonic = sonicSimilarity(seedDescriptor, candidate.descriptor);
  if (sonic !== null) return { score: sonic, measured: true };

  const se = seedEvidence;
  if (se !== null && hasTraitEvidence(se) && se.energy !== null
    && hasTraitEvidence(candidate.evidence) && candidate.evidence.energy !== null) {
    return { score: 1 - Math.abs(se.energy - candidate.evidence.energy), measured: false };
  }
  return null;
}

/** Sürüş bağlamı eğilimi — küçük ve AÇIK bir ayar, karar değil. */
function biasBonus(bias: RadioDrivingBias, energy: number | null): number {
  if (bias === 'NONE' || energy === null) return 0;
  return bias === 'ENERGETIC' ? energy * 0.12 : (1 - energy) * 0.12;
}

/**
 * Aday sırasını üretir.
 *
 * Kanıtı olan adaylar benzerliğe göre sıralanır; kanıtı OLMAYAN adaylar
 * ATILMAZ — deterministik karmayla ARKAYA alınır ve sayılır (sessiz düşürme
 * yoktur). Bu, "kanıt yoksa müzik de yok" gibi bir kullanıcı deneyimi
 * üretmemek içindir: akış sürer, ama İDDİA sürmez.
 */
export function buildRadioSequence(input: RadioPolicyInput): RadioSequence {
  const target = Math.max(1, Math.min(MAX_RADIO_LENGTH, Math.floor(input.targetLength)));
  const pool = input.candidates.filter(
    (c) => typeof c.id === 'string' && c.id.length > 0 && c.id !== input.seedId
      && (!input.favoritesOnly || c.favorite),
  );
  if (input.candidates.length === 0) return empty('EMPTY_LIBRARY', 'library_empty', input.seedKind);
  if (pool.length === 0) return empty('NO_CANDIDATES', 'no_candidate_after_filter', input.seedKind);

  /* ── 1 · Tekrar azaltma (SINIRLI) ─────────────────────────────────────── */
  const fresh = pool.filter((c) => c.recentRank === null);
  const recent = pool.filter((c) => c.recentRank !== null);
  let excludedRecent = recent.length;
  let recentReadmitted = 0;
  let working = fresh;
  if (working.length < target) {
    /* Havuz yetmiyor: EN ESKİ çalanlardan başlayarak dürüstçe geri alınır. */
    const readmit = [...recent].sort((a, b) => (b.recentRank ?? 0) - (a.recentRank ?? 0));
    const need = target - working.length;
    const taken = readmit.slice(0, need);
    recentReadmitted = taken.length;
    excludedRecent -= taken.length;
    working = [...working, ...taken];
  }

  /* ── 2 · Puanlama ─────────────────────────────────────────────────────── */
  interface Scored {
    readonly c: RadioCandidate;
    readonly score: number;
    readonly measured: boolean;
    readonly hasEvidence: boolean;
  }
  const scored: Scored[] = working.map((c) => {
    const sim = similarityToSeed(input.seedDescriptor, input.seedEvidence, c);
    const base = sim === null ? 0 : sim.score;
    const bonus = sim === null ? 0 : biasBonus(input.drivingBias, c.evidence.energy);
    const favoriteBonus = c.favorite ? 0.05 : 0;
    return {
      c,
      score: base + bonus + favoriteBonus,
      measured: sim?.measured === true,
      hasEvidence: sim !== null,
    };
  });

  const withEvidence = scored.filter((s) => s.hasEvidence);
  const withoutEvidence = scored.filter((s) => !s.hasEvidence);

  withEvidence.sort((a, b) => (b.score - a.score) || (stableHash(a.c.id) - stableHash(b.c.id)));
  /* Kanıtsızlar deterministik karmayla sıralanır — rastgelelik YOK. */
  withoutEvidence.sort((a, b) => stableHash(a.c.id) - stableHash(b.c.id));

  const ordered = [...withEvidence, ...withoutEvidence].slice(0, target);

  /* ── 3 · Sanatçı aralama (bounded) ────────────────────────────────────── */
  let artistSpacingApplied = 0;
  const out: Scored[] = [];
  const remaining = [...ordered];
  while (remaining.length > 0) {
    const lastArtist = out.length > 0 ? out[out.length - 1]!.c.artistKey : null;
    let pick = 0;
    if (lastArtist !== null) {
      /* İleriye SINIRLI bakış: aynı sanatçı arka arkaya gelmesin, ama
         sıralamayı alt üst edecek kadar uzağa gidilmez. */
      for (let i = 0; i < Math.min(remaining.length, 4); i += 1) {
        if (remaining[i]!.c.artistKey !== lastArtist) { pick = i; break; }
      }
      if (pick !== 0) artistSpacingApplied += 1;
    }
    out.push(remaining.splice(pick, 1)[0]!);
  }

  const measuredCount = out.reduce((n, s) => n + (s.measured ? 1 : 0), 0);
  const evidenceCount = out.reduce((n, s) => n + (s.hasEvidence ? 1 : 0), 0);

  /* ── 4 · İDDİA SINIFI — kanıt neyse o söylenir ────────────────────────── */
  let claimClass: RadioClaimClass = 'FALLBACK';
  if (measuredCount >= MEASURED_CLAIM_MIN_COUNT
    && measuredCount >= out.length * MEASURED_CLAIM_MIN_RATIO
    && input.seedDescriptor !== null) {
    claimClass = 'MEASURED';
  } else if (evidenceCount > 0) {
    claimClass = 'WEAK';
  }

  const trackIds = out.map((s) => s.c.id);
  return Object.freeze({
    status: 'READY' as const,
    reasonCode: claimClass === 'MEASURED' ? 'measured_similarity'
      : claimClass === 'WEAK' ? 'weak_evidence' : 'deterministic_fallback',
    claimClass,
    trackIds: Object.freeze(trackIds),
    startTrackId: trackIds[0] ?? null,
    seedKind: input.seedKind,
    measuredCount,
    consideredCount: pool.length,
    excludedRecent,
    recentReadmitted,
    artistSpacingApplied,
  });
}

/**
 * Kullanıcıya "sana özel / buna benzer" denebilir mi.
 *
 * YALNIZ `MEASURED`. `WEAK`te dürüst dil "devam ediyorum"dur; `FALLBACK`ta
 * kişiselleştirme İDDİA EDİLMEZ (F10 kesin-dil kapısıyla aynı ilke).
 */
export function allowsSimilarityClaim(seq: RadioSequence): boolean {
  return seq.status === 'READY' && seq.claimClass === 'MEASURED';
}
