/**
 * smartRadioRuntime.ts — MUSIC F18 · Kesintisiz akışın TEK dikişi.
 *
 * Zincir (kanonik — yeni otorite YOK):
 *   `MusicIndex (F2) + trait kanıtı (F10/F17) + Favoriler (F13)
 *      + son çalanlar (F5) + sürüş bağlamı (F8, yalnız YÖN)
 *      → smartRadioModel (SAF sıralama politikası)
 *      → PlayQueue/ListeningSession (F3) → Gateway (F0)`
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · **TIMER/POLLING YOKTUR.** Yalnız kullanıcı istediğinde çalışır.
 *   · **Kalıcı radyo durumu YOKTUR.** Her istek sınırlı bir liste üretir;
 *     "sonsuz akış" bir kayıt değil, tekrar istenebilen bir işlemdir.
 *   · Havuz yalnız YEREL kütüphanedir — karma-sağlayıcı kuyruk ÜRETİLMEZ
 *     (F7.6 same-provider kuralı ve F17 #1167 dürüst sınırı).
 *   · **Açık kullanıcı niyeti üstündür:** çalan müzik varken akış mevcut
 *     kuyruğa EKLENİR, çalan parça baştan ALINMAZ, ses KESİLMEZ.
 *   · Kanıt yoksa deterministik sıra üretilir ve iddia KURULMAZ.
 */

import { getMusicLibrarySnapshot, type MusicTrack } from '../musicIndex';
import { getListeningSession } from '../session/listeningSession';
import { getDesiredQueue } from '../session/playQueue';
import {
  appendLibraryTracksToQueue, sourceSupportsQueue, startLibraryListening,
} from '../session/listeningSessionRuntime';
import { getFavoritesSnapshot } from '../collection/musicCollectionAuthority';
import { getRecentlyPlayed } from '../search/recentlyPlayed';
import { peekSonicDescriptor } from '../sonic/sonicAnalysisRuntime';
import { referenceTraitEvidence, resolveTraitEvidence } from '../traits/traitRuntime';
import { readDrivingContext } from '../intelligence/musicIntelligenceRuntime';
import {
  buildRadioSequence, DEFAULT_RADIO_LENGTH,
  type RadioCandidate, type RadioDrivingBias, type RadioSeedKind, type RadioSequence,
} from './smartRadioModel';
import {
  noteRadioExecution, noteRadioExplicitDeferred, noteRadioPlan, noteRadioQueueUnsupported,
} from './smartRadioTelemetry';

/** Bir istekte taranacak EN FAZLA kütüphane parçası — düşük-uç bütçesi. */
export const MAX_RADIO_SCAN = 400;

/** Kullanıcının ne istediği. Hepsi AYNI kanonik yürütme hattını kullanır. */
export type SmartRadioRequest =
  /** "Bunun gibi devam et" — çekirdek ÇALAN parçadır, akış kuyruğa EKLENİR. */
  | 'CONTINUE_LIKE_THIS'
  /** "Bu şarkıdan radyo oluştur" — çekirdek çalan parça, YENİ akış kurulur. */
  | 'RADIO_FROM_CURRENT'
  /** "Favorilerimden karışık devam et" — havuz favorilerle SINIRLIDIR. */
  | 'FAVORITES_MIX'
  /** "Uzun yol için devam eden bir sıra" — sürüş bağlamı YÖN verir. */
  | 'LONG_DRIVE_MIX';

function mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

/** Sanatçı aralama anahtarı — GÖSTERİLMEZ, yalnız karşılaştırma içindir. */
function artistKeyOf(t: MusicTrack): string | null {
  const raw = t.artist;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return raw.trim().toLocaleLowerCase('tr-TR');
}

/**
 * Sürüş bağlamından YÖN türetir.
 *
 * Bu bir KARAR değildir (§8: F8 karar otoritesi kendi yerinde kalır); yalnız
 * sıralamaya küçük bir eğilim verir. Bağlam ölçülemiyorsa yön YOKTUR.
 */
function drivingBias(): RadioDrivingBias {
  return safe<RadioDrivingBias>(() => {
    const ctx = readDrivingContext();
    if (ctx.confidence === 'NONE' || ctx.confidence === 'LOW') return 'NONE';
    if (ctx.daypart === 'NIGHT') return 'CALM';
    if (ctx.motion === 'HIGHWAY') return 'ENERGETIC';
    return 'NONE';
  }, 'NONE');
}

/** Yerel favori kimlikleri — sağlayıcı favorileri havuza GİRMEZ. */
function localFavoriteIds(): ReadonlySet<string> {
  return safe(() => {
    const out = new Set<string>();
    for (const f of getFavoritesSnapshot()) {
      if (f.kind === 'LOCAL' && typeof f.libraryId === 'string' && f.libraryId.length > 0) {
        out.add(f.libraryId);
      }
    }
    return out as ReadonlySet<string>;
  }, new Set<string>());
}

/** Son çalanların SIRASI (0 = en son) — yalnız yerel kimlikler. */
function recentRanks(): ReadonlyMap<string, number> {
  return safe(() => {
    const out = new Map<string, number>();
    const rows = [...getRecentlyPlayed()].sort((a, b) => b.atMs - a.atMs);
    rows.forEach((r, i) => {
      if (typeof r.libraryTrackId === 'string' && r.libraryTrackId.length > 0
        && !out.has(r.libraryTrackId)) {
        out.set(r.libraryTrackId, i);
      }
    });
    return out as ReadonlyMap<string, number>;
  }, new Map<string, number>());
}

/** Çekirdek parça kimliği — çalan YEREL parça; yoksa `null`. */
function currentLibraryId(): string | null {
  return safe<string | null>(() => getListeningSession()?.currentItem?.libraryId ?? null, null);
}

/**
 * Aday havuzunu kurar — KANONİK kütüphaneden (F2) salt okunur.
 *
 * Sağlayıcı sonuçları havuza GİRMEZ: karakterleri ölçülemez (F17 #1167) ve
 * karma-sağlayıcı kuyruk üretmek F7.6'yı bozardı.
 */
function buildCandidates(
  favoritesOnly: boolean, excludeId: string | null,
): readonly RadioCandidate[] {
  let tracks: readonly MusicTrack[] = [];
  try { tracks = getMusicLibrarySnapshot().tracks; } catch { return []; }

  const favorites = localFavoriteIds();
  const recents = recentRanks();
  const out: RadioCandidate[] = [];
  let scanned = 0;

  for (const t of tracks) {
    if (scanned >= MAX_RADIO_SCAN) break;
    if (t.availability !== 'AVAILABLE') continue;
    if (excludeId !== null && t.id === excludeId) continue;
    const favorite = favorites.has(t.id);
    if (favoritesOnly && !favorite) continue;
    scanned += 1;

    out.push({
      id: t.id,
      artistKey: artistKeyOf(t),
      evidence: resolveTraitEvidence({
        id: t.id, title: t.title, artist: t.artist, durationMs: t.durationMs,
        genre: t.genre, generationModified: t.generationModified,
      }),
      descriptor: peekSonicDescriptor(t.id, t.generationModified ?? null),
      favorite,
      recentRank: recents.get(t.id) ?? null,
    });
  }
  return out;
}

/**
 * Akış SIRASINI planlar — **çalma BAŞLATMAZ, kuyruğa DOKUNMAZ.**
 *
 * LAB ve testler bunu güvenle çağırabilir: yan etkisi yalnız bounded
 * telemetridir.
 */
export function planSmartRadio(
  request: SmartRadioRequest,
  options: { readonly targetLength?: number; readonly nowMs?: number } = {},
): RadioSequence {
  const startedAt = mono();
  const favoritesOnly = request === 'FAVORITES_MIX';
  const seedId = favoritesOnly ? null : currentLibraryId();

  const seedKind: RadioSeedKind = favoritesOnly ? 'FAVORITES'
    : seedId !== null ? 'CURRENT_TRACK'
      : request === 'LONG_DRIVE_MIX' ? 'DRIVE_CONTEXT' : 'NONE';

  const reference = safe(() => referenceTraitEvidence(), { evidence: null, id: null });
  const seedDescriptor = seedId === null ? null : safe(
    () => peekSonicDescriptor(seedId, seedGeneration(seedId)), null,
  );

  const sequence = buildRadioSequence({
    seedKind,
    seedId,
    seedEvidence: favoritesOnly ? null : reference.evidence,
    seedDescriptor: favoritesOnly ? null : seedDescriptor,
    candidates: buildCandidates(favoritesOnly, seedId),
    favoritesOnly,
    targetLength: options.targetLength ?? DEFAULT_RADIO_LENGTH,
    drivingBias: request === 'LONG_DRIVE_MIX' ? drivingBias() : 'NONE',
  });

  noteRadioPlan({
    status: sequence.status,
    claimClass: sequence.claimClass,
    seedKind: sequence.seedKind,
    length: sequence.trackIds.length,
    measuredCount: sequence.measuredCount,
    excludedRecent: sequence.excludedRecent,
    recentReadmitted: sequence.recentReadmitted,
    artistSpacingApplied: sequence.artistSpacingApplied,
    reasonCode: sequence.reasonCode,
    elapsedMs: mono() - startedAt,
    atMs: options.nowMs ?? Date.now(),
  });
  return sequence;
}

/** Çekirdeğin dosya kuşağı — bayat ölçüm okunmasın diye anahtara girer. */
function seedGeneration(id: string): number | null {
  return safe<number | null>(
    () => getMusicLibrarySnapshot().tracks.find((t) => t.id === id)?.generationModified ?? null,
    null,
  );
}

export type SmartRadioExecution = 'APPENDED' | 'STARTED' | 'REJECTED';

export interface SmartRadioOutcome {
  readonly sequence: RadioSequence;
  readonly execution: SmartRadioExecution;
  /** Neden reddedildiği/eklenemediği — sahte başarı YOKTUR. */
  readonly reason: string;
  /** Gerçekten kuyruğa giren öğe adedi (reddedildiyse 0). */
  readonly appliedCount: number;
}

const outcome = (
  sequence: RadioSequence, execution: SmartRadioExecution,
  reason: string, appliedCount: number,
): SmartRadioOutcome => Object.freeze({ sequence, execution, reason, appliedCount });

/**
 * Akışı KANONİK zincirden yürütür.
 *
 * Karar tek cümlede: **ses varsa EKLE, yoksa BAŞLAT.** Çalan müziğe karışmak
 * (baştan almak, kesmek) F8'in #1119 saha kuralını da ihlal ederdi.
 *
 * Kuyruğu desteklemeyen kaynakta (YouTube iframe · Spotify Connect) ekleme
 * dürüstçe REDDEDİLİR — CarOS'un niyetinde tutulup "eklendi" diye
 * GÖSTERİLMEZ.
 */
export async function startSmartRadio(
  request: SmartRadioRequest,
  options: { readonly targetLength?: number; readonly nowMs?: number } = {},
): Promise<SmartRadioOutcome> {
  const sequence = planSmartRadio(request, options);
  if (sequence.status !== 'READY' || sequence.trackIds.length === 0) {
    noteRadioExecution('REJECTED');
    return outcome(sequence, 'REJECTED', 'Akış için uygun aday bulunamadı.', 0);
  }

  const queue = safe(() => getDesiredQueue(), null);
  const hasActiveQueue = queue !== null && queue.entries.length > 0 && queue.source !== null;

  /* "Bunun gibi devam et" ve "favorilerimden devam et" MEVCUT dinlemeye
     eklenir; "bu şarkıdan radyo oluştur" açıkça YENİ bir akış ister. */
  const wantsAppend = hasActiveQueue && request !== 'RADIO_FROM_CURRENT';

  if (wantsAppend) {
    if (!sourceSupportsQueue(queue.source)) {
      noteRadioQueueUnsupported();
      noteRadioExecution('REJECTED');
      return outcome(sequence, 'REJECTED',
        'Bu kaynak sıraya eklemeyi desteklemiyor; sıra uygulanmadı.', 0);
    }
    noteRadioExplicitDeferred();
    const result = await appendLibraryTracksToQueue(sequence.trackIds, options.nowMs);
    if (!result.applied) {
      noteRadioExecution('REJECTED');
      return outcome(sequence, 'REJECTED', result.reason, 0);
    }
    noteRadioExecution('APPENDED');
    return outcome(sequence, 'APPENDED', result.reason, sequence.trackIds.length);
  }

  const started = await startLibraryListening(
    { kind: 'TRACKS', trackIds: sequence.trackIds, startTrackId: sequence.startTrackId ?? undefined },
    { nowMs: options.nowMs },
  );
  if (!started.started) {
    noteRadioExecution('REJECTED');
    return outcome(sequence, 'REJECTED', started.reason, 0);
  }
  noteRadioExecution('STARTED');
  return outcome(sequence, 'STARTED', started.reason, sequence.trackIds.length);
}
