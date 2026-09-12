/**
 * traitSelectionModel.ts — MUSIC F10 · Karakter-farkında SEÇİM kararı (SAF).
 *
 * Tek soru: "istenen karakter değişimi için, elimdeki KANITLA hangi aday
 * meşrudur?" Cevap yoksa dürüstçe `null` döner — yakın bir parça seçmek
 * kullanıcıya yalan söylemektir.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · `CALMER` / `MORE_ENERGETIC` **GÖRECELİDİR**: referans parçanın kanıtı
 *     yoksa karşılaştırma UYDURULMAZ (`NO_REFERENCE`).
 *   · Kanıtsız aday seçilemez; sayılır ve elenir.
 *   · Seçim güveni referans ile aday güveninin ZAYIF olanıdır — sezgisel
 *     kanıttan güçlü bir iddia doğamaz.
 *   · Çalma başlatmaz, kuyruğa dokunmaz: yalnız KİMLİK döndürür.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import {
  confidenceRank, hasTraitEvidence, weakerConfidence,
  type MusicTraitEvidence, type TraitConfidence,
} from './musicTraitEvidence';

export type TraitDirection =
  /** Mevcut parçaya GÖRE daha sakin. */
  | 'CALMER'
  /** Mevcut parçaya GÖRE daha enerjik. */
  | 'MORE_ENERGETIC'
  /** Bağlam hedefli (mutlak): yol/sürüş için uygun enerji. */
  | 'FOR_DRIVE'
  /** Bağlam hedefli (mutlak): gece için daha sakin. */
  | 'NIGHT_CALM';

export const RELATIVE_DIRECTIONS: readonly TraitDirection[] =
  Object.freeze(['CALMER', 'MORE_ENERGETIC']);

export function isRelativeDirection(d: TraitDirection): boolean {
  return d === 'CALMER' || d === 'MORE_ENERGETIC';
}

/**
 * Göreceli seçimde aranan EN AZ enerji farkı.
 *
 * Küçük fark kullanıcı için algılanmaz; "daha sakin açtım" demek yalan olur.
 * Kanıt zaten zayıfken bandı dar tutmak yanlış iddiayı artırırdı.
 */
export const RELATIVE_ENERGY_MARGIN = 0.2;

/** Bağlam hedefli seçimde hedeflenen enerji bandı. */
export const DRIVE_TARGET_ENERGY = 0.65;
export const NIGHT_TARGET_ENERGY = 0.3;
/** Hedeften bu kadar uzak aday seçilmez — "uygun" iddiası boşa çıkmasın. */
export const ABSOLUTE_TARGET_TOLERANCE = 0.3;

export interface TraitCandidate {
  /** Kanonik kimlik (kütüphane parça kimliği) — ad/URI TAŞIMAZ. */
  readonly id: string;
  readonly evidence: MusicTraitEvidence;
}

export interface TraitSelectionInput {
  readonly direction: TraitDirection;
  /** Şu an çalan parçanın kanıtı — göreceli istekte ZORUNLU. */
  readonly reference: MusicTraitEvidence | null;
  readonly candidates: readonly TraitCandidate[];
  /** Aynı parçayı yeniden seçmemek için; yoksa `null`. */
  readonly excludeId?: string | null;
}

export type TraitSelectionStatus =
  | 'SELECTED'
  /** Göreceli istek ama referans parçanın kanıtı YOK. */
  | 'NO_REFERENCE'
  /** Hiçbir adayda kanıt YOK. */
  | 'NO_EVIDENCE'
  /** Kanıt var ama istenen yönde yeterli fark taşıyan aday YOK. */
  | 'NO_CANDIDATE';

export interface TraitSelectionResult {
  readonly status: TraitSelectionStatus;
  readonly selectedId: string | null;
  /** Seçimin güveni — referans ve aday güveninin ZAYIFI. */
  readonly confidence: TraitConfidence;
  readonly reasonCode: string;
  readonly consideredCount: number;
  readonly rejectedNoEvidence: number;
  readonly rejectedWrongDirection: number;
  /** Seçilen adayın kanıt kökeni (LAB teşhisi). */
  readonly selectedProvenance: string | null;
}

const result = (
  status: TraitSelectionStatus, reasonCode: string,
  o: Partial<Omit<TraitSelectionResult, 'status' | 'reasonCode'>> = {},
): TraitSelectionResult => Object.freeze({
  status,
  reasonCode,
  selectedId: o.selectedId ?? null,
  confidence: o.confidence ?? 'NONE',
  consideredCount: o.consideredCount ?? 0,
  rejectedNoEvidence: o.rejectedNoEvidence ?? 0,
  rejectedWrongDirection: o.rejectedWrongDirection ?? 0,
  selectedProvenance: o.selectedProvenance ?? null,
});

function targetEnergyFor(direction: TraitDirection): number {
  return direction === 'NIGHT_CALM' ? NIGHT_TARGET_ENERGY : DRIVE_TARGET_ENERGY;
}

/**
 * Seçimi yapar.
 *
 * Göreceli yön: referans enerjiden `RELATIVE_ENERGY_MARGIN` kadar UZAK ve
 * doğru yönde olan adaylar arasından EN uç olanı seçilir (kullanıcı farkı
 * hissetsin). Mutlak yön: hedef banda EN yakın aday seçilir.
 */
export function selectByTrait(input: TraitSelectionInput): TraitSelectionResult {
  const relative = isRelativeDirection(input.direction);

  if (relative) {
    /* Referans kanıtı yoksa "daha sakin" bir KARŞILAŞTIRMA kurulamaz.
       Sahte karşılaştırma yerine dürüst red. */
    if (input.reference === null
      || !hasTraitEvidence(input.reference)
      || input.reference.energy === null) {
      return result('NO_REFERENCE', 'reference_trait_unavailable');
    }
  }

  let rejectedNoEvidence = 0;
  let rejectedWrongDirection = 0;
  let considered = 0;
  let best: TraitCandidate | null = null;
  let bestScore = 0;

  const refEnergy = input.reference?.energy ?? null;
  const target = targetEnergyFor(input.direction);

  for (const c of input.candidates) {
    if (input.excludeId != null && c.id === input.excludeId) continue;
    if (!hasTraitEvidence(c.evidence) || c.evidence.energy === null) {
      rejectedNoEvidence += 1;
      continue;
    }
    considered += 1;
    const energy = c.evidence.energy;

    if (relative) {
      const delta = input.direction === 'CALMER'
        ? (refEnergy as number) - energy
        : energy - (refEnergy as number);
      if (delta < RELATIVE_ENERGY_MARGIN) { rejectedWrongDirection += 1; continue; }
      if (best === null || delta > bestScore) { best = c; bestScore = delta; }
      continue;
    }

    const distance = Math.abs(energy - target);
    if (distance > ABSOLUTE_TARGET_TOLERANCE) { rejectedWrongDirection += 1; continue; }
    /* Mutlak yönde skor "hedefe yakınlık"tır → küçük mesafe kazanır. */
    if (best === null || distance < bestScore) { best = c; bestScore = distance; }
  }

  if (considered === 0) {
    return result('NO_EVIDENCE', 'no_candidate_trait_evidence', { rejectedNoEvidence });
  }
  if (best === null) {
    return result('NO_CANDIDATE', 'no_candidate_in_direction', {
      consideredCount: considered, rejectedNoEvidence, rejectedWrongDirection,
    });
  }

  /* Karar en zayıf halkası kadar güçlüdür: sezgisel adaydan KESİN iddia doğmaz. */
  const confidence = relative && input.reference !== null
    ? weakerConfidence(input.reference.confidence, best.evidence.confidence)
    : best.evidence.confidence;

  return result('SELECTED', 'selected_by_trait', {
    selectedId: best.id,
    confidence,
    consideredCount: considered,
    rejectedNoEvidence,
    rejectedWrongDirection,
    selectedProvenance: best.evidence.provenance,
  });
}

/** Seçim KESİN dil kurdurabilir mi — yalnız güçlü kanıt izin verir. */
export function allowsConfidentClaim(r: TraitSelectionResult): boolean {
  return r.status === 'SELECTED' && confidenceRank(r.confidence) >= confidenceRank('MEDIUM');
}
