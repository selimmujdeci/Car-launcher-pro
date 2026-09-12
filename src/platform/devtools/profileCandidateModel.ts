/**
 * profileCandidateModel — Üretici Profil Adayları ekranının SAF karar katmanı.
 *
 * SÖZLEŞME: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ⚠️ AUTO-ONAY YOKTUR: bu katman hiçbir adayı "kabul edildi" saymaz, çakışma ÇÖZMEZ,
 * güven YENİDEN HESAPLAMAZ. Builder ne ürettiyse o taşınır; tek kattığı şey
 * gruplama ve sayım. Çakışmaların otomatik çözülmemesi builder'ın anayasasıdır:
 * insan karar verir.
 */
import type { ProfileCandidate } from '../manufacturerProfileBuilder';
import type { ProfileCandidateSnapshot } from './profileCandidateSources';
import type { Observability } from './sessionInspectorModel';

/** Aday durumunun Türkçe karşılığı (enum değeri `data-status`'ta AYNEN kalır). */
export const CANDIDATE_STATUS_LABEL: Readonly<Record<string, string>> = {
  strong:    'GÜÇLÜ',
  candidate: 'ADAY',
  weak:      'ZAYIF',
} as const;

export interface CandidateGroupView {
  readonly key:          string;
  readonly manufacturer: string;
  readonly pidOrDid:     string;
  readonly mode:         string;
  /** Aynı sinyalin farklı ECU varyantları. */
  readonly variants:     readonly ProfileCandidate[];
  /** Grubun herhangi bir varyantı manuel inceleme istiyor mu. */
  readonly needsReview:  boolean;
  /** Tüm varyantlardan toplanan benzersiz çakışma nedenleri. */
  readonly conflicts:    readonly string[];
  readonly klass:        Observability;
}

/**
 * Adayları `mergeGroup` anahtarına göre gruplar.
 *
 * NEDEN GRUPLAMA: aynı PID farklı ECU'larda görülmüş olabilir; bunları ayrı satır
 * olarak listelemek "6 ayrı keşif" yanılsaması üretir. Grup, insana tek bir karar
 * noktası verir — ama varyantlar GİZLENMEZ, altında ham olarak durur.
 */
export function buildCandidateGroups(
  snap: ProfileCandidateSnapshot,
): readonly CandidateGroupView[] {
  const map = new Map<string, ProfileCandidate[]>();
  for (const row of snap.rows) {
    const key = row.mergeGroup || `${row.manufacturer}|${row.pidOrDid}`;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }

  const out: CandidateGroupView[] = [];
  for (const [key, variants] of map) {
    const head = variants[0];
    const conflicts = [...new Set(variants.flatMap((v) => v.conflictReasons ?? []))];
    out.push({
      key,
      manufacturer: head.manufacturer,
      pidOrDid: head.pidOrDid,
      mode: head.mode,
      variants,
      needsReview: variants.some((v) => v.requiresManualReview === true),
      conflicts,
      /* Adaylar gerçek gözlemlerden TÜRETİLİR (araçtan doğrudan okunan bir alan
         değildir) — bu yüzden ÖLÇÜLDÜ değil TÜRETİLDİ. */
      klass: 'DERIVED' as Observability,
    });
  }
  return out;
}

export interface CandidateCounts {
  readonly groups:      number;
  readonly variants:    number;
  readonly needsReview: number;
  readonly clean:       number;
}

export function countCandidates(groups: readonly CandidateGroupView[]): CandidateCounts {
  const needsReview = groups.filter((g) => g.needsReview).length;
  return {
    groups: groups.length,
    variants: groups.reduce((n, g) => n + g.variants.length, 0),
    needsReview,
    clean: groups.length - needsReview,
  };
}

export type CandidateVerdict =
  /** Aday üretimi patladı. */
  | 'READ_FAILED'
  /** Marka zekâsında hiç kayıt yok — öğrenme hiç başlamamış. */
  | 'NO_KNOWLEDGE'
  /** Kayıt var ama GÜÇLÜ aday yok — henüz yeterli tekrar/araç yok. */
  | 'NO_CANDIDATES'
  /** İnceleme bekleyen çakışmalı aday var. */
  | 'REVIEW_REQUIRED'
  /** Adaylar var ve hiçbiri çakışmıyor. */
  | 'READY_FOR_REVIEW';

export const CANDIDATE_VERDICT_LABEL: Readonly<Record<CandidateVerdict, string>> = {
  READ_FAILED:      'ÜRETİM DÜŞTÜ',
  NO_KNOWLEDGE:     'BİLGİ TABANI BOŞ',
  NO_CANDIDATES:    'GÜÇLÜ ADAY YOK',
  REVIEW_REQUIRED:  'ÇAKIŞMA — İNSAN KARARI GEREKLİ',
  READY_FOR_REVIEW: 'ADAYLAR İNCELEMEYE HAZIR',
} as const;

export interface CandidateVerdictResult {
  readonly status:  CandidateVerdict;
  readonly reasons: readonly string[];
}

/**
 * Hüküm sırası: hata → bilgi yok → aday yok → çakışma → hazır.
 * Çakışma "hazır"dan ÖNCE gelir: çakışmalı adayı hazır saymak, builder'ın
 * tek kuralını (insan karar verir) sessizce çiğnemek olurdu.
 */
export function deriveCandidateVerdict(
  snap: ProfileCandidateSnapshot,
  counts: CandidateCounts,
): CandidateVerdictResult {
  const reasons: string[] = [];

  if (snap.error !== null) {
    reasons.push(`Aday üretimi düştü: ${snap.error}`);
    return { status: 'READ_FAILED', reasons };
  }

  reasons.push(
    `${snap.manufacturerCount} marka kaydı · ${snap.totalCandidates} aday · `
    + `${counts.groups} sinyal grubu (${counts.variants} ECU varyantı)`,
  );
  if (snap.trimmed > 0) {
    reasons.push(`${snap.trimmed} aday ekrana sığmadı (kırpıldı) — sayı gizlenmedi.`);
  }

  if (snap.manufacturerCount === 0) {
    reasons.push('Marka bilgi tabanı boş: hiç araç kaydı işlenmemiş.');
    return { status: 'NO_KNOWLEDGE', reasons };
  }
  if (counts.groups === 0) {
    reasons.push('Kayıt var ama GÜÇLÜ aday yok — aynı sinyal yeterli araçta tekrar etmemiş.');
    return { status: 'NO_CANDIDATES', reasons };
  }
  if (counts.needsReview > 0) {
    reasons.push(`${counts.needsReview} grup çakışma taşıyor — otomatik ÇÖZÜLMEZ.`);
    return { status: 'REVIEW_REQUIRED', reasons };
  }
  return { status: 'READY_FOR_REVIEW', reasons };
}
