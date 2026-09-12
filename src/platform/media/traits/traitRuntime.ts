/**
 * traitRuntime.ts — MUSIC F10 · Karakter kanıtının TEK toplama dikişi.
 *
 * Zincir:
 *   `MusicIndex (F2, salt okuma) + ListeningSession (F3, salt okuma)
 *      + gömülü etiket (native, sınırlı toplu iş)
 *      → traitSources/traitHeuristics (SAF) → traitSelectionModel (SAF) → kimlik`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER/POLLING YOKTUR.** Yalnız çağrıldığında çalışır (F9 niyet yolu).
 *   · Çalma BAŞLATMAZ, kuyruğa dokunmaz, sağlayıcıya/native'e komut GÖNDERMEZ.
 *     Yalnız KİMLİK döndürür; yürütme kanonik F3/F9 yolundadır.
 *   · MusicIndex'e YAZMAZ; F8 tercih kanıtına YAZMAZ.
 *   · Önbellek SINIRLIDIR (LRU) ve yalnız sayısal kanıt tutar — ad/URI TUTMAZ.
 *   · Aday havuzu SINIRLIDIR: düşük-uç head unit'te binlerce parça her istekte
 *     yeniden taranmaz.
 */

import { getMusicLibrarySnapshot, type MusicTrack } from '../musicIndex';
import { getListeningSession } from '../session/listeningSession';
import {
  hasTraitEvidence, mergeTraitEvidence, NO_TRAIT_EVIDENCE, type MusicTraitEvidence,
} from './musicTraitEvidence';
import { deriveAvailableTraits } from './traitHeuristics';
import { fromEmbeddedBpm, fromLibraryGenre } from './traitSources';
import { descriptorToTraitEvidence } from '../sonic/sonicDescriptor';
import { peekSonicDescriptor, runSonicAnalysis } from '../sonic/sonicAnalysisRuntime';
import {
  allowsConfidentClaim, selectByTrait,
  type TraitCandidate, type TraitDirection, type TraitSelectionResult,
} from './traitSelectionModel';
import {
  noteTraitCache, noteTraitEvidenceProduced, noteTraitSelection,
} from './traitTelemetry';

/** Kanıt önbelleği üst sınırı — sınırsız büyüme YOK. */
export const MAX_TRAIT_CACHE = 512;
/** Bir istekte taranacak EN FAZLA aday — düşük-uç bütçesi. */
export const MAX_CANDIDATE_SCAN = 400;
/** Bir istekte gömülü etiketi okunacak EN FAZLA dosya (native sınırla aynı sınıf). */
export const MAX_EMBEDDED_PRIME = 24;
/**
 * Kanıt şeması sürümü — kural/eşik değiştiğinde ESKİ önbellek geçersizleşir.
 * Anahtarın parçasıdır: sürüm artınca eski satırlar bir daha okunmaz.
 *
 * 3 → MUSIC F17: `MEASURED_AUDIO` (ölçülmüş ses) zincire girdi; F17 öncesi
 * hesaplanmış satırlar artık EKSİK kanıttır ve okunmamalıdır.
 */
export const TRAIT_SCHEMA_VERSION = 3;

const cache = new Map<string, MusicTraitEvidence>();
/** Gömülü etiket okumasının sonucu: parça kimliği → BPM (etiket yoksa null). */
const embeddedBpm = new Map<string, number | null>();

/**
 * Önbellek anahtarı — F10.1 §11.
 *
 * Kimlik TEK BAŞINA yetmez: dosya değişirse (yeni generationModified) eski
 * kanıt BAYATTIR ve kullanılmamalıdır. Şema sürümü de anahtarın parçasıdır.
 */
function traitCacheKey(id: string, generation: number | null): string {
  return TRAIT_SCHEMA_VERSION + '|' + id + '|' + (generation === null ? '-' : String(generation));
}

function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/** LRU dokunuşu: en son kullanılan sona taşınır, taşma baştan atılır. */
function cacheGet(id: string): MusicTraitEvidence | null {
  const hit = cache.get(id);
  if (hit === undefined) { noteTraitCache(false); return null; }
  cache.delete(id); cache.set(id, hit);
  noteTraitCache(true);
  return hit;
}

function cacheSet(id: string, evidence: MusicTraitEvidence): void {
  cache.set(id, evidence);
  while (cache.size > MAX_TRAIT_CACHE) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Bir parçanın karakter kanıtı — GÜÇLÜDEN ZAYIFA birleştirilir.
 *
 * F10.1 sonrası zincir:
 *   `EMBEDDED_METADATA (gömülü BPM)` → `LIBRARY_METADATA (MediaStore GENRE)`
 *   → `DERIVED_DURATION` → `HEURISTIC_TEXT`.
 * Güçlü kaynak varsa zayıfı EZER; birleştirme güveni YÜKSELTMEZ.
 */
export function resolveTraitEvidence(input: {
  readonly id: string;
  readonly title: string | null;
  readonly artist: string | null;
  readonly durationMs: number | null;
  /** MediaStore turu (GERCEK kutuphane metadata'si) — yoksa null. */
  readonly genre?: string | null;
  /** Dosya degisim kusagi — bayat kanit kullanilmasin diye anahtara girer. */
  readonly generationModified?: number | null;
}): MusicTraitEvidence {
  const key = traitCacheKey(input.id, input.generationModified ?? null);
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const evidence = computeTraitEvidence(input);
  noteTraitEvidenceProduced(evidence.provenance);
  cacheSet(key, evidence);
  return evidence;
}

/**
 * Kanıtı HESAPLAR — önbelleğe yazmaz, sayaç DEĞİŞTİRMEZ.
 *
 * LAB okuması bunu kullanır: gözlemin gözleneni etkilemesi (LAB'ın üretim
 * sayaçlarını oynatması) yasaktır — bu, F3.2'de kilitlenmiş bir sözleşmedir.
 *
 * GÜÇLÜDEN ZAYIFA: gömülü etiket → kütüphane türü → süre/başlık türetimi.
 * Birleştirme kuralı güveni YÜKSELTMEZ; yalnız güçlü olan kazanır.
 */
function computeTraitEvidence(input: {
  readonly id: string;
  readonly title: string | null;
  readonly artist: string | null;
  readonly durationMs: number | null;
  readonly genre?: string | null;
  readonly generationModified?: number | null;
}): MusicTraitEvidence {
  /* MUSIC F17 — EN GÜÇLÜ kaynak: sesin KENDİSİNDEN ölçülmüş betimleyici.
     Okuma sayaç değiştirmez (aday taraması yüzlerce kez çağırır). */
  const sonic = descriptorToTraitEvidence(
    peekSonicDescriptor(input.id, input.generationModified ?? null),
  );
  const bpm = embeddedBpm.get(input.id);
  const embedded = bpm === undefined ? NO_TRAIT_EVIDENCE : fromEmbeddedBpm(bpm);
  const library = fromLibraryGenre(input.genre ?? null);
  const derived = deriveAvailableTraits({
    title: input.title, artist: input.artist, durationMs: input.durationMs,
  });
  return mergeTraitEvidence(
    mergeTraitEvidence(sonic, embedded),
    mergeTraitEvidence(library, derived),
  );
}

/**
 * MUSIC F10.1 · Gomulu BPM etiketlerini SINIRLI bir toplu isle okur.
 *
 * · Calma yolunda DEGILDIR: yalniz kullanici bir karakter istegi yaptiginda
 *   cagrilir (F9 yonlendiricisi bekler).
 * · Native taraf ayri bir arka plan havuzunda calisir ve dosya basina zaman
 *   asimi uygular; UI thread'e DOKUNULMAZ.
 * · Zaten okunmus parcalar tekrar OKUNMAZ (ayni dosya surekli analiz edilmez).
 * · Etiketi olmayan dosya null olarak ISARETLENIR — bir daha denenmez.
 */
export async function primeEmbeddedTraits(
  tracks: readonly { readonly id: string; readonly contentUri: string }[],
): Promise<number> {
  const pending = tracks
    .filter((t) => !embeddedBpm.has(t.id)
      && typeof t.contentUri === 'string' && t.contentUri.length > 0)
    .slice(0, MAX_EMBEDDED_PRIME);
  if (pending.length === 0) return 0;

  try {
    const { CarLauncher } = await import('../../nativePlugin');
    const result = await CarLauncher.readTrackTraits({ uris: pending.map((t) => t.contentUri) });
    const byUri = new Map(result.traits.map((r) => [r.uri, r.bpm]));
    for (const t of pending) {
      const bpm = byUri.get(t.contentUri);
      /* Okunamayan dosya da ISARETLENIR: sonsuz yeniden deneme YOK. */
      embeddedBpm.set(t.id, typeof bpm === 'number' ? bpm : null);
      invalidateTrait(t.id);
    }
    return pending.length;
  } catch {
    /* Native yoksa (tarayici) veya izin reddedildiyse: kanit YOK, uydurma YOK. */
    return 0;
  }
}

/**
 * MUSIC F17 — SESİN KENDİSİNİ ölçer (decode + DSP) ve kanıtı zincire sokar.
 *
 * · Çalma yolunda DEĞİLDİR: yalnız kullanıcı bir karakter/benzerlik isteği
 *   yaptığında çağrılır.
 * · Kabul kararı `admitSonicAnalysis`indir: termal/bellek/düşük-uç baskısında
 *   HİÇ ölçüm yapılmaz (kaba ölçüm kanıt sayılmaz).
 * · Yeni ölçüm gelen parçaların trait önbelleği DÜŞÜRÜLÜR — bir sonraki
 *   `resolveTraitEvidence` artık `MEASURED_AUDIO` görür.
 *
 * @returns bu turda GERÇEKTEN ölçülen dosya sayısı.
 */
export async function primeSonicTraits(
  tracks: readonly {
    readonly id: string;
    readonly contentUri: string;
    readonly generationModified?: number | null;
  }[],
): Promise<number> {
  const usable = tracks.filter(
    (t) => typeof t.contentUri === 'string' && t.contentUri.length > 0,
  );
  if (usable.length === 0) return 0;
  try {
    const measured = await runSonicAnalysis(usable);
    if (measured > 0) for (const t of usable) invalidateTrait(t.id);
    return measured;
  } catch {
    /* Native yoksa (tarayıcı) veya çağrı düştüyse: kanıt YOK, uydurma YOK. */
    return 0;
  }
}

/** Bir parcanin onbellek satirlarini dusurur (yeni kanit geldi / dosya degisti). */
function invalidateTrait(id: string): void {
  const marker = '|' + id + '|';
  for (const key of [...cache.keys()]) if (key.includes(marker)) cache.delete(key);
}

/**
 * ŞU AN çalan parçanın kanıtı — göreceli isteklerin referansı.
 *
 * Oturum yoksa veya geçerli öğe bilinmiyorsa `null` döner ve göreceli istek
 * dürüstçe reddedilir (sahte karşılaştırma YOK).
 */
export function referenceTraitEvidence(): {
  readonly evidence: MusicTraitEvidence | null; readonly id: string | null;
} {
  try {
    const session = getListeningSession();
    const item = session?.currentItem ?? null;
    if (item === null) return { evidence: null, id: null };
    const id = item.libraryId ?? item.providerId ?? null;
    if (id === null) return { evidence: null, id: null };
    /* Kutuphane parcasiysa GERCEK metadata (tur/kusak) da okunur — saglayici
       parcasinda bu alanlar yoktur ve UYDURULMAZ. */
    let genre: string | null = null;
    let generation: number | null = null;
    try {
      const track = getMusicLibrarySnapshot().tracks.find((t) => t.id === id) ?? null;
      genre = track?.genre ?? null;
      generation = track?.generationModified ?? null;
    } catch { /* kutuphane okunamadi → kanit zayiflar, uydurulmaz */ }

    return {
      evidence: resolveTraitEvidence({
        id, title: item.title, artist: item.artist, durationMs: item.durationMs,
        genre, generationModified: generation,
      }),
      id,
    };
  } catch {
    return { evidence: null, id: null };
  }
}

/**
 * Aday havuzu — KANONİK kütüphaneden (F2) salt okunur.
 *
 * Sağlayıcı sonuçları havuza girmez: onların karakter kanıtı yoktur ve arama
 * yapmadan bir sağlayıcı adayı ÜRETİLEMEZ (uydurma olurdu).
 */
function buildCandidates(excludeId: string | null): readonly TraitCandidate[] {
  let tracks: readonly MusicTrack[] = [];
  try { tracks = getMusicLibrarySnapshot().tracks; } catch { return []; }

  const out: TraitCandidate[] = [];
  let scanned = 0;
  for (const t of tracks) {
    if (scanned >= MAX_CANDIDATE_SCAN) break;
    if (t.availability !== 'AVAILABLE') continue;
    if (excludeId !== null && t.id === excludeId) continue;
    scanned += 1;
    const evidence = resolveTraitEvidence({
      id: t.id, title: t.title, artist: t.artist, durationMs: t.durationMs,
      genre: t.genre, generationModified: t.generationModified,
    });
    /* Kanıtsız aday havuza ALINIR ve seçim modelinde SAYILARAK elenir —
       "kaç aday kanıtsız kaldı" LAB'da görünür (sessiz düşürme yok). */
    out.push({ id: t.id, evidence });
  }
  return out;
}

export interface TraitSelectionOutcome {
  readonly result: TraitSelectionResult;
  /** Kanonik F3 yolunda kullanılacak kütüphane parça kimliği. */
  readonly trackId: string | null;
  /** Kullanıcıya KESİN dil kurulabilir mi (yalnız MEDIUM+ güven). */
  readonly confidentClaim: boolean;
  readonly referenceEvidence: MusicTraitEvidence | null;
}

/**
 * İstenen karakter yönü için aday seçer.
 *
 * ÇALMA BAŞLATMAZ. Çağıran (F9 yönlendiricisi) sonucu kanonik
 * `startLibraryListening` yoluna verir.
 */
export function selectTrackByTrait(
  direction: TraitDirection, nowMs = Date.now(),
): TraitSelectionOutcome {
  const startedAt = mono();
  const reference = referenceTraitEvidence();
  const candidates = buildCandidates(reference.id);

  const result = selectByTrait({
    direction,
    reference: reference.evidence,
    candidates,
    excludeId: reference.id,
  });
  const confidentClaim = allowsConfidentClaim(result);

  noteTraitSelection({
    direction,
    status: result.status,
    confidence: result.confidence,
    reasonCode: result.reasonCode,
    selectedProvenance: result.selectedProvenance,
    referenceProvenance: reference.evidence?.provenance ?? null,
    consideredCount: result.consideredCount,
    rejectedNoEvidence: result.rejectedNoEvidence,
    rejectedWrongDirection: result.rejectedWrongDirection,
    confidentClaim,
    elapsedMs: mono() - startedAt,
    atMs: nowMs,
  });

  return Object.freeze({
    result,
    trackId: result.selectedId,
    confidentClaim,
    referenceEvidence: reference.evidence,
  });
}

/**
 * LAB teşhisi — mevcut referans kanıtının özeti (ad/URI TAŞIMAZ).
 *
 * **Hiçbir üretim durumunu değiştirmez:** önbelleğe yazmaz, isabet/ıska ve
 * kanıt sayaçlarına DOKUNMAZ. LAB gözlem yüzeyidir, ikinci otorite değildir.
 */
export function peekReferenceEvidence(): MusicTraitEvidence {
  try {
    const session = getListeningSession();
    const item = session?.currentItem ?? null;
    if (item === null) return NO_TRAIT_EVIDENCE;
    const id = item.libraryId ?? item.providerId ?? null;
    if (id === null) return NO_TRAIT_EVIDENCE;

    let genre: string | null = null;
    let generationModified: number | null = null;
    try {
      const track = getMusicLibrarySnapshot().tracks.find((t) => t.id === id) ?? null;
      genre = track?.genre ?? null;
      generationModified = track?.generationModified ?? null;
    } catch { /* kütüphane okunamadı → kanıt zayıflar, uydurulmaz */ }

    const evidence = computeTraitEvidence({
      id, title: item.title, artist: item.artist, durationMs: item.durationMs,
      genre, generationModified,
    });
    return hasTraitEvidence(evidence) ? evidence : NO_TRAIT_EVIDENCE;
  } catch {
    return NO_TRAIT_EVIDENCE;
  }
}

export function getTraitCacheSize(): number { return cache.size; }

export function _resetTraitRuntimeForTest(): void {
  cache.clear();
  embeddedBpm.clear();
}

/** @internal test dikisi — gomulu etiket okumasini taklit eder. */
export function _setEmbeddedBpmForTest(id: string, bpm: number | null): void {
  embeddedBpm.set(id, bpm);
  invalidateTrait(id);
}
