/**
 * musicIntelligenceModel.ts — MUSIC F8 · Sürüş-farkında müzik KARARI (SAF).
 *
 * Tek soru: "şu anda kullanıcı adına bir şey ÖNERMEK veya BAŞLATMAK meşru mu,
 * ve meşruysa hangi kanonik seçim?"
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Çalma BAŞLATMAZ, kuyruğa dokunmaz, arama yapmaz. Yalnız KARAR üretir;
 *     yürütme kanonik F3/F7 yollarındadır.
 *   · **Açık kullanıcı niyeti her zaman kazanır** — kullanıcı bir şey seçtiyse
 *     F8 o pencerede ne önerir ne de değiştirir.
 *   · **Çalan müziğe DOKUNULMAZ.** Ses varsa karar daima `HOLD`tur; F8 asla
 *     "daha uygunu var" diye çalanı kesmez.
 *   · Kanıt yoksa öneri UYDURULMAZ (`no_evidence` → HOLD).
 *   · Bağlam kanıtlanmadıysa (hız ölçülemiyor) otomatik eylem YASAK.
 *   · "Ruh hâlini biliyorum / sana özel" gibi bir iddia YOKTUR: karar yalnız
 *     sayılabilir kanıta (kova + korunmuş dinleme adedi) dayanır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { ListeningIntent } from '../session/listeningSession';
import type { SourceClass } from '../authority/sourceCapabilities';
import type {
  ContextConfidence, DrivingContext, JourneyPhase, MotionClass,
} from './drivingContextModel';
import { bestPreferenceFor, type PreferenceEntry, type PreferenceSnapshot } from './preferenceEvidence';

/** Açık kullanıcı seçiminden sonra F8'in sustuğu pencere. */
export const EXPLICIT_INTENT_TTL_MS = 20 * 60 * 1000;
/** Otomatik devam için gereken en az KORUNMUŞ dinleme adedi. */
export const AUTO_RESUME_MIN_KEPT = 3;
/** Öneri için gereken en az korunmuş dinleme adedi. */
export const SUGGEST_MIN_KEPT = 1;

export type IntelligenceAction = 'HOLD' | 'SUGGEST' | 'AUTO_RESUME';

export type IntelligenceReason =
  | 'already_playing'
  | 'explicit_user_intent'
  | 'context_unproven'
  | 'no_evidence'
  | 'weak_evidence'
  | 'session_active'
  | 'journey_not_start'
  | 'suggestable'
  | 'auto_resume_eligible';

/** Kanonik seçim — YÜRÜTME bu tipin sahibinde (F3/F7) yapılır. */
export type IntelligenceSelection =
  | { readonly kind: 'ALBUM'; readonly albumId: string }
  | { readonly kind: 'ARTIST'; readonly artistId: string }
  | { readonly kind: 'FOLDER'; readonly folderId: string }
  | { readonly kind: 'TRACKS'; readonly trackId: string }
  /** Sağlayıcı kökenli niyet: kanonik "kaldığın yerden devam" yolu kullanılır. */
  | { readonly kind: 'RESUME'; readonly sourceClass: SourceClass };

export interface IntelligenceCandidate {
  readonly selection: IntelligenceSelection;
  readonly intent: ListeningIntent;
  readonly sourceClass: SourceClass;
  /** Kanıt gücü — KULLANICIYA GÖSTERİLMEZ, yalnız LAB ve politika içindir. */
  readonly keptCount: number;
  readonly abandonedCount: number;
}

export interface IntelligenceDecisionInput {
  readonly context: DrivingContext;
  readonly preference: PreferenceSnapshot;
  /** F0 kanıtı: ses gerçekten çıkıyor mu. Bilinmiyorsa `false` DEĞİL, `null` verin. */
  readonly playbackActive: boolean | null;
  /** Açık bir dinleme bağlamı sürüyor mu (F3). */
  readonly sessionActive: boolean;
  /** Kullanıcının son açık seçiminin anı — hiç yoksa `null`. */
  readonly explicitIntentAtMs: number | null;
  readonly nowMs: number;
}

export interface IntelligenceDecision {
  readonly action: IntelligenceAction;
  readonly candidate: IntelligenceCandidate | null;
  readonly reason: IntelligenceReason;
  /** Kararın dayandığı bağlam güveni (kullanıcıya gösterilmez). */
  readonly confidence: ContextConfidence;
  /** Eylemi engelleyen tüm gerekçeler — sessiz bastırma YOKTUR. */
  readonly suppressedBy: readonly IntelligenceReason[];
  readonly bucket: string;
  /** Sunum için taşınır (teknik ad KULLANICIYA gösterilmez, metne çevrilir). */
  readonly motion: MotionClass;
  readonly journey: JourneyPhase;
}

const decisionFor = (
  context: DrivingContext, action: IntelligenceAction, reason: IntelligenceReason,
  candidate: IntelligenceCandidate | null, suppressedBy: readonly IntelligenceReason[],
): IntelligenceDecision => Object.freeze({
  action,
  candidate,
  reason,
  confidence: context.confidence,
  bucket: context.bucket,
  motion: context.motion,
  journey: context.journey,
  suppressedBy: Object.freeze([...suppressedBy]),
});

/** Kanıt satırı → kanonik seçim. Çözülemeyen niyet aday ÜRETMEZ. */
export function candidateFromPreference(entry: PreferenceEntry): IntelligenceCandidate | null {
  const base = {
    intent: entry.intent,
    sourceClass: entry.sourceClass,
    keptCount: entry.kept,
    abandonedCount: entry.abandoned,
  };
  if (entry.libraryRef !== null && entry.libraryRef.length > 0) {
    switch (entry.intent) {
      case 'ALBUM':
        return Object.freeze({ ...base, selection: { kind: 'ALBUM', albumId: entry.libraryRef } as const });
      case 'ARTIST':
        return Object.freeze({ ...base, selection: { kind: 'ARTIST', artistId: entry.libraryRef } as const });
      case 'FOLDER':
        return Object.freeze({ ...base, selection: { kind: 'FOLDER', folderId: entry.libraryRef } as const });
      case 'TRACKS':
        return Object.freeze({ ...base, selection: { kind: 'TRACKS', trackId: entry.libraryRef } as const });
      default:
        break;   // kütüphane referansı taşıyan başka niyet YOK
    }
  }
  /* Sağlayıcı kökenli niyet: içerik kimliği SAKLANMADIĞI için tek dürüst
     eylem kanonik "kaldığın yerden devam"dır — yeni bir içerik uydurulmaz. */
  return Object.freeze({ ...base, selection: { kind: 'RESUME', sourceClass: entry.sourceClass } as const });
}

/**
 * Kararı verir.
 *
 * SIRALAMA ÖNEMLİDİR — en güçlü bastırma önce gelir:
 *   1. Ses çıkıyor          → HOLD (mevcut müziğe DOKUNULMAZ)
 *   2. Açık kullanıcı niyeti → HOLD (kullanıcı otomasyondan üstündür)
 *   3. Bağlam kanıtsız       → HOLD (uydurma bağlamda öneri yok)
 *   4. Kanıt yok/zayıf       → HOLD
 *   5. Otomatik devam koşulları TAM ise → AUTO_RESUME, değilse SUGGEST
 */
export function decideMusicIntelligence(input: IntelligenceDecisionInput): IntelligenceDecision {
  const { context, nowMs } = input;
  const suppressed: IntelligenceReason[] = [];

  /* 1 · Ses çıkıyorsa hiçbir koşulda karışılmaz. `null` = kanıt yok →
     fail-closed DEĞİL: kanıtsızlık "çalıyor" demek değildir; ama otomatik
     eylem için ayrıca oturum kapısı (5) vardır. */
  if (input.playbackActive === true) {
    return decisionFor(context, 'HOLD', 'already_playing', null, ['already_playing']);
  }

  /* 2 · Kullanıcı yakın zamanda kendi seçimini yaptı → F8 SUSAR. */
  if (input.explicitIntentAtMs !== null
    && Number.isFinite(input.explicitIntentAtMs)
    && nowMs - input.explicitIntentAtMs <= EXPLICIT_INTENT_TTL_MS) {
    return decisionFor(context, 'HOLD', 'explicit_user_intent', null, ['explicit_user_intent']);
  }

  /* 3 · Bağlam kanıtlanmadıysa öneri de otomatik eylem de meşru değildir. */
  if (context.confidence === 'NONE' || context.bucket === 'UNKNOWN') {
    return decisionFor(context, 'HOLD', 'context_unproven', null, ['context_unproven']);
  }

  /* 4 · Bu kovada korunmuş bir dinleme kanıtı var mı. */
  const entry = bestPreferenceFor(context.bucket, input.preference);
  if (entry === null) {
    return decisionFor(context, 'HOLD', 'no_evidence', null, ['no_evidence']);
  }
  if (entry.kept < SUGGEST_MIN_KEPT) {
    return decisionFor(context, 'HOLD', 'weak_evidence', null, ['weak_evidence']);
  }

  const candidate = candidateFromPreference(entry);
  if (candidate === null) {
    return decisionFor(context, 'HOLD', 'no_evidence', null, ['no_evidence']);
  }

  /* 5 · Otomatik devam KAPISI — hepsi birden gerekir. */
  if (input.sessionActive) suppressed.push('session_active');
  if (context.journey !== 'START') suppressed.push('journey_not_start');
  if (context.confidence !== 'HIGH') suppressed.push('context_unproven');
  if (entry.kept < AUTO_RESUME_MIN_KEPT) suppressed.push('weak_evidence');

  if (suppressed.length === 0) {
    return decisionFor(context, 'AUTO_RESUME', 'auto_resume_eligible', candidate, []);
  }
  /* Otomatik eylem meşru değil ama ÖNERİ meşru: kullanıcı görür, kendisi seçer. */
  return decisionFor(context, 'SUGGEST', 'suggestable', candidate, suppressed);
}
