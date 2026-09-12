/**
 * gapModel — P0-VDK-F5A · SELF-HEALING GAP RESOLVER · SAF SÖZLEŞME KATMANI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F2-C'de kurulan `gapRegistry` "neyi ölçemedik" sorusunu KAYDEDİYORDU ama
 * hiçbir şey yapmıyordu. Bu katman o kayıtları **çözülebilir bir boşluk**
 * biçimine normalize eder ve boşluğun yaşam döngüsünü tanımlar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ BOŞLUK SÖZLÜĞÜ DEĞİLDİR.** Sözlük MEVCUT `ReplayGapSignal`
 *     (F2-B) ve MEVCUT `CapabilityConflictKind` / `ReuseDecision` (F4-C)
 *     birleşimidir. Burada YENİ sinyal adı TANIMLANMAZ.
 * (2) **İKİNCİ KATMAN SÖZLÜĞÜ DEĞİLDİR.** Kök katman MEVCUT `GapScope`tur.
 * (3) **ÖLÇÜM YAPMAZ.** PDU üretmez, oturum açmaz, taşımaya dokunmaz.
 * (4) **KARAR VERMEZ.** Hangi ölçümün seçileceği `resolutionPolicy`nin işidir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { ReplayGapSignal } from '../virtualTransport';
import type { GapScope } from '../gapRegistry';
import type { GapEvidence, GapEvidenceState } from '../gapEvidence';
import type { CapabilityConflictKind } from '../capability/capabilityGraph';

/* ══════════════════════════════════════════════════════════════════════════
   1) YAŞAM DÖNGÜSÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir boşluğun kanonik durumu.
 *
 * ⚠️ `RESOLVED` YALNIZCA yeni bir KANIT boşluğu gerçekten kapattığında
 * verilir. "Komut gönderdim" · "yeniden denedim" · "hata almadım"
 * `RESOLVED` DEĞİLDİR — bunlar yalnızca bir ölçümün yapıldığını söyler.
 *
 * `UNKNOWN` FAIL-CLOSED'dır: emin olunmayan her durum burada durur ve
 * asla iyimser bir duruma yükseltilmez.
 */
export type GapLifecycle =
  /** Ölçülmeyi bekliyor. */
  | 'OPEN'
  /** Bu turda bir ölçüm adayı seçildi ve hatta çıktı. */
  | 'IN_PROGRESS'
  /** YENİ KANIT boşluğu gerçekten kapattı. */
  | 'RESOLVED'
  /** Güvenli bir ölçüm var ama ÖN KOŞULU sağlanmıyor (bu fazda çalıştırılamaz). */
  | 'BLOCKED'
  /** Aynı yol aynı sonuçla tavana kadar denendi — yeni canlı kanıt olmadan tekrar YOK. */
  | 'EXHAUSTED'
  /** Sınıflandırılamadı ya da ölçüm sonucu bir şey öğretmedi. FAIL-CLOSED. */
  | 'UNKNOWN';

export const GAP_LIFECYCLE_LABEL: Readonly<Record<GapLifecycle, string>> = {
  OPEN:        'AÇIK — ölçüm bekliyor',
  IN_PROGRESS: 'ÖLÇÜLÜYOR',
  RESOLVED:    'KAPANDI — yeni kanıt boşluğu doldurdu',
  BLOCKED:     'ENGELLİ — güvenli ölçümün ön koşulu yok',
  EXHAUSTED:   'TÜKENDİ — aynı yol aynı sonucu verdi',
  UNKNOWN:     'BİLİNMİYOR — ölçüm bir şey öğretmedi',
} as const;

/** Terminal durumlar — bu turda yeniden ölçüm adayı ÜRETİLMEZ. */
const LIFECYCLE_TERMINAL: ReadonlySet<GapLifecycle> =
  new Set<GapLifecycle>(['RESOLVED', 'EXHAUSTED']);

export function isLifecycleTerminal(s: GapLifecycle): boolean {
  return LIFECYCLE_TERMINAL.has(s);
}

/**
 * Yaşam döngüsü geçiş matrisi — sessiz/keyfî sıçrama YOK.
 *
 * En önemli kilit: `EXHAUSTED` durumundan çıkış YOKTUR. Tükenmiş bir boşluk
 * ancak YENİ CANLI KANIT geldiğinde (`reopenGapOnLiveEvidence`) yeniden
 * açılır — bu kasıtlıdır ve sonsuz döngüyü kökten keser.
 */
const LIFECYCLE_TRANSITIONS: Readonly<Record<GapLifecycle, readonly GapLifecycle[]>> = {
  OPEN:        ['IN_PROGRESS', 'BLOCKED', 'EXHAUSTED', 'UNKNOWN'],
  IN_PROGRESS: ['RESOLVED', 'OPEN', 'BLOCKED', 'EXHAUSTED', 'UNKNOWN'],
  BLOCKED:     ['OPEN', 'IN_PROGRESS', 'EXHAUSTED', 'UNKNOWN'],
  UNKNOWN:     ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'EXHAUSTED'],
  RESOLVED:    ['OPEN'],
  EXHAUSTED:   [],
} as const;

export function isLifecycleTransitionAllowed(
  from: GapLifecycle, to: GapLifecycle,
): boolean {
  if (from === to) return true;
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

/* ══════════════════════════════════════════════════════════════════════════
   2) BOŞLUĞUN KİMLİĞİ — mevcut sözlükler BİRLEŞTİRİLİR, yenisi yazılmaz
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Boşluğun nereden geldiği.
 *
 * Üç kaynak da MEVCUTTUR; bu faz yalnızca onları tek bir okuma yüzeyinde
 * birleştirir. Yeni bir üretici KURULMAZ.
 */
export type GapOrigin =
  /** `gapRegistry` (F2-C) — uygunluk koşusu ve keşif sinyalleri. */
  | 'REGISTRY'
  /** `capabilityGraph` (F4-C) — çözülmemiş çelişki. */
  | 'CAPABILITY_CONFLICT'
  /** `capabilityGraph` (F4-C) — bayat kayıt (`ReuseDecision.STALE`). */
  | 'CAPABILITY_STALE';

export const GAP_ORIGIN_LABEL: Readonly<Record<GapOrigin, string>> = {
  REGISTRY:            'boşluk sicili',
  CAPABILITY_CONFLICT: 'yetenek çelişkisi',
  CAPABILITY_STALE:    'bayat yetenek',
} as const;

/**
 * Boşluğun sınıfı — okunabilir tek etiket.
 *
 * `REGISTRY` kaynaklı boşlukta bu etiket AYNEN `ReplayGapSignal`dır.
 * Diğer ikisinde F4-C sözlüğünden gelir. Hiçbir yeni ad ÜRETİLMEZ.
 */
export type GapClass =
  | ReplayGapSignal
  | CapabilityConflictKind
  | 'STALE_CAPABILITY';

/**
 * Ölçülebilir hedef — ölçüm bu künyeye yapılır.
 *
 * Hedefsiz bir boşluk ÖLÇÜLEMEZ (kör tarama YASAK): `service` yoksa hiçbir
 * yoklama adayı üretilmez ve boşluk `BLOCKED` kalır.
 */
export interface GapTarget {
  /** ECU kanonik anahtarı; fonksiyonel/bilinmiyorsa `null`. */
  readonly ecuKey: string | null;
  /** Servis kimliği (`19`, `22`…); bilinmiyorsa `null` → ölçülemez. */
  readonly service: string | null;
  /** Alt fonksiyon; yoksa `null`. */
  readonly subFunction: string | null;
}

export const EMPTY_TARGET: GapTarget = Object.freeze({
  ecuKey: null, service: null, subFunction: null,
});

/** Normalize edilmiş, çözülebilir boşluk. */
export interface ResolvableGap {
  /** Deterministik kimlik — aynı boşluk her turda AYNI anahtarı üretir. */
  readonly key: string;
  readonly origin: GapOrigin;
  readonly gapClass: GapClass;
  /** Kök katman — MEVCUT `GapScope` sözlüğü. */
  readonly scope: GapScope;
  /** Ölçümün yapılacağı künye. */
  readonly target: GapTarget;
  /** Serbest bağlam metni (sicildeki `context`). */
  readonly context: string;
  /** Kaç kez ölçüldü/görüldü — tekrar bir kanıttır. */
  readonly observations: number;
  /** Son görülme damgası; ölçülmediyse `null` (sahte tarih YASAK). */
  readonly lastSeenMs: number | null;
  /** En son ölçülen NRC (varsa) — kanıtlı ABSENT ayrımı için kritik. */
  readonly lastNrc: number | null;
  /** Taşıma sınırı ölçüldü mü (araç sınırı DEĞİL). */
  readonly transportLimited: boolean;
  /** Oturuma bağlı koşullu kanıt var mı (`PRESENT_BUT_CONDITIONED`). */
  readonly sessionConditioned: boolean;

  /* ── P0-VDK-F5D · KANIT BAĞI (isteğe bağlı — eski üretici bozulmaz) ──── */
  /**
   * Boşluğu doğuran KANONİK kanıt zarfı (`gapRegistry` kaydından).
   *
   * Bu alan varsa çözücü hedefi/NRC'yi/oturum gerekçesini **tavanlı yoklama
   * defterine geri dönmeden** bilir. Yoksa `null`dur ve eski (kırılgan)
   * defter yolu yalnız PARİTE TANIĞI olarak kullanılır.
   */
  readonly evidence?: GapEvidence | null;
  /** Zarfın dürüst durumu — zarf yoksa `UNAVAILABLE`. */
  readonly evidenceState?: GapEvidenceState;
  /** Kapanış kanıtının yazılacağı sicil satırı; sicil dışı boşlukta `null`. */
  readonly registryKey?: string | null;
}

/**
 * Deterministik boşluk anahtarı.
 *
 * Anahtar HEDEFİ de içerir: aynı sinyal farklı ECU/serviste FARKLI boşluktur
 * ve tek satırda birleştirilirse hedefli yeniden ölçüm imkânsızlaşır.
 *
 * P0-VDK-F5D — `discriminator` (isteğe bağlı) ÖLÇÜLMÜŞ sonucu ayırır
 * (sınıflandırma + NRC). Aynı hedefte farklı NRC ölçüldüyse bu iki boşluk
 * tek duruma EZİLMEZ. Ayırıcı verilmezse anahtar eskisiyle BİREBİR AYNIDIR —
 * yetenek kökenli boşlukların kimliği değişmez.
 */
export function gapKey(
  origin: GapOrigin, gapClass: GapClass, target: GapTarget, context: string,
  discriminator: string | null = null,
): string {
  const e = target.ecuKey ?? '-';
  const s = target.service ?? '-';
  const f = target.subFunction ?? '-';
  const base = `${origin}|${gapClass}|${e}|${s}|${f}|${context}`;
  return discriminator === null || discriminator === '' ? base : `${base}|${discriminator}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KÖK NEDEN SINIFI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kök neden — "hangi katmanı düzeltmek boşluğu kapatır".
 *
 * `GapScope` boşluğun NEREDE ÖLÇÜLDÜĞÜNÜ söyler; bu tip NEYİN EKSİK
 * olduğunu söyler. İkisi farklı sorulardır: bir parser boşluğu
 * `CONFORMANCE` kapsamında ölçülmüş olabilir.
 */
export type RootCauseClass =
  /** ECU'nun yeteneği bilinmiyor — yeniden yoklama öğretebilir. */
  | 'CAPABILITY_UNMEASURED'
  /** Kanıt var ama çelişkili — hedefli yeniden ölçüm gerekir. */
  | 'CAPABILITY_CONTESTED'
  /** Kanıt eskimiş — tazeleme yoklaması gerekir. */
  | 'CAPABILITY_STALE'
  /** Erişim oturuma bağlı — oturum/TesterPresent ölçümü gerekir. */
  | 'SESSION_CONDITIONED'
  /** Taşıma taşıyamadı — ARAÇ SINIRI DEĞİL, bizim sınırımız. */
  | 'TRANSPORT_BOUND'
  /** Yanıt geldi ama çözülemedi — düzeltilecek yer BİZİM çözücümüz. */
  | 'PARSER_BOUND'
  /** Yanıtın sahibi ölçülemedi — ECU atfı doğrulanmalı. */
  | 'ATTRIBUTION_UNRESOLVED'
  /** Sınıflandırılamadı. FAIL-CLOSED. */
  | 'UNKNOWN';

export const ROOT_CAUSE_LABEL: Readonly<Record<RootCauseClass, string>> = {
  CAPABILITY_UNMEASURED:  'yetenek ÖLÇÜLMEDİ',
  CAPABILITY_CONTESTED:   'yetenek ÇELİŞKİLİ',
  CAPABILITY_STALE:       'yetenek BAYAT',
  SESSION_CONDITIONED:    'erişim OTURUMA BAĞLI',
  TRANSPORT_BOUND:        'TAŞIMA sınırı (araç sınırı DEĞİL)',
  PARSER_BOUND:           'ÇÖZÜCÜ sınırı (bizim kusurumuz)',
  ATTRIBUTION_UNRESOLVED: 'ECU ATFI belirsiz',
  UNKNOWN:                'SINIFLANDIRILAMADI',
} as const;

/**
 * Kök neden sınıfının kendi başına ÖLÇÜMLE kapanabilir olup olmadığı.
 *
 * `PARSER_BOUND` kapanamaz: ECU zaten doğru yanıt veriyor, eksik olan bizim
 * çözücümüzdür. Aynı isteği tekrar göndermek AYNI çözülemeyen baytı getirir —
 * bu yüzden bir yoklama adayı üretmek israftır ve boşluk `BLOCKED` kalır.
 */
export function isMeasurementResolvable(r: RootCauseClass): boolean {
  return r !== 'PARSER_BOUND' && r !== 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
   4) BOŞLUK DURUM KAYDI
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir boşluğun çözüm turundaki durumu — LAB bunu okur. */
export interface GapState {
  readonly gap: ResolvableGap;
  readonly rootCause: RootCauseClass;
  readonly lifecycle: GapLifecycle;
  /** Seçilen ölçüm adayının adı; seçilmediyse `null`. */
  readonly selected: string | null;
  /** Neden bu aday seçildi (ya da neden hiçbiri) — sessiz karar YASAK. */
  readonly selectionReason: string;
  /** Bu boşluk için toplam deneme sayısı. */
  readonly attempts: number;
  /** Son ölçümün gözlenen sonucu; ölçüm yapılmadıysa `null`. */
  readonly lastOutcome: string | null;
  /** Durumun gerekçesi (kanıt cümlesi). */
  readonly outcomeDetail: string;
  /** Ölçümün harcadığı istek adedi — bütçe muhasebesi. */
  readonly requestsSpent: number;
  /** Öğrenme sayesinde ATLANAN istek adedi (ölçüm, iddia değil). */
  readonly requestsSaved: number;
}

/** Hiç ölçüm yapılmamış boşluk için başlangıç durumu. */
export function initialGapState(
  gap: ResolvableGap, rootCause: RootCauseClass,
): GapState {
  return Object.freeze({
    gap,
    rootCause,
    lifecycle: 'OPEN' as GapLifecycle,
    selected: null,
    selectionReason: 'henüz değerlendirilmedi',
    attempts: 0,
    lastOutcome: null,
    outcomeDetail: '',
    requestsSpent: 0,
    requestsSaved: 0,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ÖZET
   ══════════════════════════════════════════════════════════════════════════ */

export interface GapResolutionSummary {
  readonly total: number;
  readonly open: number;
  readonly inProgress: number;
  readonly resolved: number;
  readonly blocked: number;
  readonly exhausted: number;
  readonly unknown: number;
  readonly requestsSpent: number;
  readonly requestsSaved: number;
  /**
   * Çözücü HİÇ koşmadı mı.
   *
   * ⚠️ Bu bayrak "açık boşluk 0" ile KARIŞTIRILAMAZ: birincisi ÖLÇÜM YOKLUĞU,
   * ikincisi bir ÖLÇÜM SONUCUDUR. LAB bu ayrımı gösterir.
   */
  readonly neverRan: boolean;
}

export function summarizeGapStates(
  states: readonly GapState[], ranAtLeastOnce: boolean,
): GapResolutionSummary {
  let open = 0, inProgress = 0, resolved = 0, blocked = 0, exhausted = 0, unknown = 0;
  let spent = 0, saved = 0;
  for (const s of states) {
    switch (s.lifecycle) {
      case 'OPEN':        open++; break;
      case 'IN_PROGRESS': inProgress++; break;
      case 'RESOLVED':    resolved++; break;
      case 'BLOCKED':     blocked++; break;
      case 'EXHAUSTED':   exhausted++; break;
      default:            unknown++; break;
    }
    spent += s.requestsSpent;
    saved += s.requestsSaved;
  }
  return Object.freeze({
    total: states.length,
    open, inProgress, resolved, blocked, exhausted, unknown,
    requestsSpent: spent, requestsSaved: saved,
    neverRan: !ranAtLeastOnce,
  });
}
