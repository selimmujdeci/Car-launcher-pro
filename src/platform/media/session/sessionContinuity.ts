/**
 * sessionContinuity.ts — F3 · Dinleme sürekliliği kararı (SAF).
 *
 * ÜRÜN KARARI: `ListeningSession` kullanıcının **niyetidir**; source/provider o
 * niyeti taşıyan araçtır. Araç değişince (USB çıktı, ağ gitti) niyet ölmek
 * zorunda DEĞİLDİR — ama yalnız **kanıt varsa** taşınır.
 *
 * PAZARLIKSIZ: WEAK/UNKNOWN eşleşmeyle otomatik taşıma YOKTUR. Yanlış şarkıyı
 * sürdürmek, sürekliliği kaybetmekten daha kötüdür. CarOS "benzer" bir şarkı
 * BAŞLATMAZ.
 *
 * SAFLIK: I/O · timer · Date.now · global durum · React importu YOKTUR.
 */

import {
  bestIdentityMatch, isCarryGrade,
  type CanonicalMediaIdentity, type IdentityMatch,
} from './mediaIdentityMatching';

export type ContinuityState =
  /** Aynı araçta, aynı niyet — hiçbir şey taşınmadı çünkü gerek olmadı. */
  | 'INTACT'
  /** Araç değişti, niyet TAM olarak taşındı. */
  | 'CARRIED'
  /** Araç değişti, niyet KISMEN taşındı (bazı parçalar karşılanamadı). */
  | 'DEGRADED'
  /** Güvenilir eşleşme yok — niyet taşınamadı. Rastgele bir şey ÇALINMAZ. */
  | 'BROKEN'
  /** Değerlendirilecek kanıt yok. */
  | 'UNKNOWN';

export const CONTINUITY_LABEL: Readonly<Record<ContinuityState, string>> = {
  INTACT: 'BOZULMADI',
  CARRIED: 'TAŞINDI',
  DEGRADED: 'KISMEN TAŞINDI',
  BROKEN: 'KOPTU',
  UNKNOWN: 'BİLİNMİYOR',
} as const;

export interface CarriedItem {
  readonly sourceIndex: number;
  readonly candidateIndex: number;
  readonly match: IdentityMatch;
}

export interface ContinuityDecision {
  readonly state: ContinuityState;
  readonly carried: readonly CarriedItem[];
  /** Karşılanamayan öğelerin eski kuyruktaki indeksleri. */
  readonly droppedIndexes: readonly number[];
  /** Taşınabilen geçerli öğe (yoksa null → otomatik çalma YOK). */
  readonly resumeCandidateIndex: number | null;
  readonly reason: string;
}

export interface ContinuityInput {
  /** Taşınmak istenen (eski) kuyruk kimlikleri. */
  readonly previous: readonly CanonicalMediaIdentity[];
  /** Yeni kaynağın sunabildiği adaylar. */
  readonly candidates: readonly CanonicalMediaIdentity[];
  /** Eski kuyrukta çalan öğenin indeksi (yoksa -1). */
  readonly currentIndex: number;
  /** Kaynak/araç değişti mi. */
  readonly sourceChanged: boolean;
}

const decision = (
  state: ContinuityState, carried: CarriedItem[], droppedIndexes: number[],
  resumeCandidateIndex: number | null, reason: string,
): ContinuityDecision => Object.freeze({
  state,
  carried: Object.freeze(carried),
  droppedIndexes: Object.freeze(droppedIndexes),
  resumeCandidateIndex,
  reason,
});

/**
 * Sürekliliği kanıtla değerlendirir.
 *
 * Bir aday YALNIZ BİR KEZ taşınabilir: aynı albümün iki farklı parçası tek bir
 * adaya eşlenirse bu bir taşıma değil, sahte bir eşleşmedir.
 */
export function evaluateContinuity(input: ContinuityInput): ContinuityDecision {
  const { previous, candidates, currentIndex, sourceChanged } = input;

  if (previous.length === 0) {
    return decision('UNKNOWN', [], [], null, 'Taşınacak eski kuyruk yok.');
  }
  if (!sourceChanged) {
    return decision('INTACT', [], [], currentIndex >= 0 ? currentIndex : null,
      'Kaynak değişmedi — dinleme bağlamı olduğu gibi duruyor.');
  }
  if (candidates.length === 0) {
    return decision('BROKEN', [], previous.map((_, i) => i), null,
      'Yeni kaynak hiçbir aday sunamadı — bağlam taşınamadı.');
  }

  const used = new Set<number>();
  const carried: CarriedItem[] = [];
  const dropped: number[] = [];

  for (let i = 0; i < previous.length; i += 1) {
    const pool = candidates.map((c, index) => ({ c, index })).filter((x) => !used.has(x.index));
    if (pool.length === 0) { dropped.push(i); continue; }
    const { index, match } = bestIdentityMatch(previous[i]!, pool.map((x) => x.c));
    if (index < 0 || !isCarryGrade(match.grade)) { dropped.push(i); continue; }
    const candidateIndex = pool[index]!.index;
    used.add(candidateIndex);
    carried.push(Object.freeze({ sourceIndex: i, candidateIndex, match }));
  }

  if (carried.length === 0) {
    return decision('BROKEN', [], dropped, null,
      'Hiçbir öğe güvenilir kanıtla eşleşmedi — CarOS benzer parça BAŞLATMAZ.');
  }

  /* Devam noktası: yalnız ÇALAN parçanın karşılığı varsa üretilir. Çalan parça
     taşınamadıysa kuyruk kısmen taşınmış olsa bile "kaldığın yerden" DENMEZ. */
  const resume = carried.find((c) => c.sourceIndex === currentIndex);
  const resumeCandidateIndex = resume ? resume.candidateIndex : null;

  if (carried.length === previous.length) {
    return decision('CARRIED', carried, dropped, resumeCandidateIndex,
      resume
        ? 'Tüm öğeler güçlü kanıtla taşındı; çalan parçanın karşılığı bulundu.'
        : 'Tüm öğeler taşındı ama çalan parçanın karşılığı yok — kaldığı yerden devam EDİLMEZ.');
  }

  return decision('DEGRADED', carried, dropped, resumeCandidateIndex,
    `${carried.length}/${previous.length} öğe taşındı; ${dropped.length} öğe karşılanamadı.`);
}

/** Otomatik devam (kullanıcıya sormadan çalmaya devam) meşru mu. */
export function mayAutoResume(d: ContinuityDecision): boolean {
  return (d.state === 'CARRIED' || d.state === 'DEGRADED') && d.resumeCandidateIndex !== null;
}
