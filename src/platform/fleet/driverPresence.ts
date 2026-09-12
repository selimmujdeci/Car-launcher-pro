/**
 * driverPresence.ts — SÜRÜCÜ VARLIĞI (PRESENCE) SÖZLEŞMESİ VE RESOLVER.
 *
 * ── PRESENCE NEDİR, ASSIGNMENT'TAN FARKI NE ───────────────────────────
 *   · **Assignment** bir PLANDIR: "bu araca bu sürücü atandı."
 *   · **Presence** bir GÖZLEMDİR: "şu anda bu kişinin araçta olduğuna
 *     dair fiziksel bir işaret var."
 *
 * Bir yöneticinin ataması, sürücünün gerçekten direksiyonda olduğunu
 * KANITLAMAZ (P0 bu yüzden `VERY_HIGH` vermez). Presence tam da bu boşluğu
 * doldurmak için vardır: NFC kartın okutulması veya doğrulanmış bir telefon
 * eşleşmesi, plandan farklı olarak **fiziksel kanıttır**.
 *
 * ── BU PAKETTE GERÇEK KAYNAK YOK ──────────────────────────────────────
 * NFC ve Bluetooth **uygulanmadı**. Bu modül yalnız sözleşmeyi ve tek
 * otoriteyi kurar. Gerçek üretici bağlanana kadar presence **hiç
 * üretilmez** → attribution davranışı P0'daki gibi kalır.
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────
 * Presence bir kanıt üretemiyorsa cevap `UNKNOWN`'dır. Presence'ın VARLIĞI
 * asla bir sürücüyü "kanıtlanmış" yapmaz; kanıt olabilmesi için kaynağının
 * güvenilir, süresinin geçmemiş ve atamayla çelişmemiş olması gerekir.
 *
 * ── SAFLIK SINIRI (P2'de GÜNCELLENDİ) ─────────────────────────────────
 * Bu dosyanın KARAR katmanı (`resolveDriverPresence` ve yardımcıları) hâlâ
 * SAFTIR: I/O YOK · timer YOK · `Date.now()` YOK · abonelik YOK · React YOK.
 * Zaman DIŞARIDAN verilir.
 *
 * Dosyanın SONUNDAKİ **depo** (`DriverPresenceStore`) P2'de kalıcı hâle
 * geldi ve `safeStorage` okur/yazar. Bu I/O **yalnız depoya** aittir;
 * resolver onu ne çağırır ne de görür (kanıt: kilit testleri).
 */

import {
  recordPresenceHistory, closePresenceHistory, summarizePresenceHistory,
  EMPTY_PRESENCE_HISTORY, EMPTY_PRESENCE_HISTORY_SUMMARY,
  type PresenceHistoryState, type PresenceHistorySummary,
} from './driverPresenceHistory';
import {
  encodePresenceSnapshot, decodePresenceSnapshot,
  PRESENCE_SNAPSHOT_KEY,
  type PresenceSnapshotDecodeReason,
} from './driverPresencePersistence';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

/* ── Kaynak ────────────────────────────────────────────────────────────── */

export const PRESENCE_SOURCES = [
  'UNKNOWN',
  'HEAD_UNIT',
  'PHONE',
  'BLUETOOTH',
  'NFC',
] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

export function isPresenceSource(v: unknown): v is PresenceSource {
  return typeof v === 'string' && (PRESENCE_SOURCES as readonly string[]).includes(v);
}

/**
 * KİMLİK DOĞRULAYAN kaynaklar.
 *
 * ── `HEAD_UNIT` NEDEN BURADA DEĞİL ──────────────────────────────────────
 * Head unit `anon` rolünde çalışır ve **kullanıcı oturumu yoktur**; ekranda
 * kim olduğunu iddia eden herkes o kişi sayılırdı. P0'da head unit'te
 * serbest sürücü seçimi bilinçli olarak KAPATILDI — presence katmanı o
 * kararı **arkadan dolanmamalıdır**. `HEAD_UNIT` bir ipucu olarak taşınır
 * ama **tek başına sürücü kanıtı SAYILMAZ**.
 *
 * `PHONE` de burada değildir: telefon eşleşmesi bu pakette doğrulanmış
 * değildir (Phone Hub cihazda hiç çalışmadı). Gerçek doğrulama geldiğinde
 * bu listeye eklenir — sözleşme değişmez.
 */
export const IDENTITY_VERIFYING_SOURCES: readonly PresenceSource[] =
  Object.freeze(['NFC', 'BLUETOOTH']);

export function isIdentityVerifying(s: PresenceSource): boolean {
  return IDENTITY_VERIFYING_SOURCES.includes(s);
}

/* ── Güven ─────────────────────────────────────────────────────────────── */

export const PRESENCE_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type PresenceConfidence = (typeof PRESENCE_CONFIDENCES)[number];

const CONFIDENCE_ORDER: readonly PresenceConfidence[] =
  ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

export function isPresenceConfidence(v: unknown): v is PresenceConfidence {
  return typeof v === 'string' && (PRESENCE_CONFIDENCES as readonly string[]).includes(v);
}

/** İki güvenin DAHA ZAYIFINI verir (en zayıf kritik kanıt kuralı). */
export function weakestPresenceConfidence(
  a: PresenceConfidence,
  b: PresenceConfidence,
): PresenceConfidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

/**
 * Kaynağın verebileceği EN YÜKSEK güven.
 *
 * Bir kaynak, doğası gereği taşıyamayacağı bir güveni İDDİA EDEMEZ:
 * head unit'ten gelen "ben Ahmet'im" beyanı, NFC kartın fiziksel
 * okunmasıyla aynı ağırlıkta olamaz.
 */
export function sourceConfidenceCeiling(s: PresenceSource): PresenceConfidence {
  switch (s) {
    /* Fiziksel kart teması — en güçlü kanıt. */
    case 'NFC':       return 'VERY_HIGH';
    /* Eşleştirilmiş cihaz yakınlığı; kart kadar kesin değil (cihaz
       başkasında olabilir, menzil geniştir). */
    case 'BLUETOOTH': return 'HIGH';
    /* Telefon bağlantısı bu pakette DOĞRULANMIŞ değil. */
    case 'PHONE':     return 'MEDIUM';
    /* Kimlik doğrulaması YOK — ipucu olabilir, kanıt olamaz. */
    case 'HEAD_UNIT': return 'LOW';
    case 'UNKNOWN':   return 'UNKNOWN';
  }
}

/* ── Kanonik model ─────────────────────────────────────────────────────── */

/**
 * Bir sürücünün araçta olduğuna dair GÖZLEM.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, ehliyet, telefon, e-posta yoktur —
 * yalnız kimlik referansları ve zaman.
 */
export interface DriverPresence {
  readonly source: PresenceSource;
  readonly confidence: PresenceConfidence;
  /** Gözlem anı (epoch ms). */
  readonly detectedAt: number | null;
  /** Gözlemin geçerliliğini yitirdiği an (epoch ms). `null` = bilinmiyor. */
  readonly expiresAt: number | null;
  readonly driverId: string | null;
  /** Gözlemin dayandığı atama (varsa) — çelişki denetimi için. */
  readonly assignmentId: string | null;
}

export const UNKNOWN_PRESENCE: DriverPresence = Object.freeze({
  source: 'UNKNOWN',
  confidence: 'UNKNOWN',
  detectedAt: null,
  expiresAt: null,
  driverId: null,
  assignmentId: null,
});

/**
 * PRESENCE VARSAYILAN ÖMRÜ (ms).
 *
 * NEDEN GEREKLİ: bir NFC okuması "bu kişi şu an araçta" demektir, "bu kişi
 * sonsuza dek bu aracın sürücüsü" demek DEĞİLDİR. Süresiz presence, sabah
 * kart okutan sürücüyü akşamki yolculuğa da bağlardı.
 * 8 saat bir vardiyayı kapsar; üstü ayrı bir gözlem gerektirir.
 */
export const PRESENCE_DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** Ham girdiyi güvenle daraltır — tanınmayan alan UYDURULMAZ. */
export function normalizePresence(raw: unknown): DriverPresence {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const source: PresenceSource = isPresenceSource(o.source) ? o.source : 'UNKNOWN';
  const driverId = typeof o.driverId === 'string' && o.driverId.length > 0
    ? o.driverId : null;

  /* Sürücüsü olmayan gözlem bir presence DEĞİLDİR. */
  if (driverId === null || source === 'UNKNOWN') return UNKNOWN_PRESENCE;

  const detectedAt = typeof o.detectedAt === 'number' && Number.isFinite(o.detectedAt)
    ? o.detectedAt : null;
  const expiresAt = typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt)
    ? o.expiresAt : (detectedAt === null ? null : detectedAt + PRESENCE_DEFAULT_TTL_MS);

  /* Bildirilen güven, kaynağın tavanını AŞAMAZ — istemci kendi güvenini
     yükseltemez (P0'daki "güven sunucuda üretilir" ilkesinin devamı). */
  const claimed: PresenceConfidence = isPresenceConfidence(o.confidence)
    ? o.confidence : 'UNKNOWN';
  const confidence = weakestPresenceConfidence(claimed, sourceConfidenceCeiling(source));

  return {
    source,
    confidence,
    detectedAt,
    expiresAt,
    driverId,
    assignmentId: typeof o.assignmentId === 'string' && o.assignmentId.length > 0
      ? o.assignmentId : null,
  };
}

/* ── Geçerlilik ────────────────────────────────────────────────────────── */

export const PRESENCE_VALIDITIES = ['VALID', 'EXPIRED', 'FUTURE', 'UNKNOWN'] as const;
export type PresenceValidity = (typeof PRESENCE_VALIDITIES)[number];

/**
 * Gözlem şu an geçerli mi.
 *
 * `EXPIRED` bir presence **kanıt değildir** — attribution onu yok sayar ve
 * atama modeline düşer.
 */
export function presenceValidity(p: DriverPresence, nowMs: number): PresenceValidity {
  if (p.source === 'UNKNOWN' || p.driverId === null || p.detectedAt === null) {
    return 'UNKNOWN';
  }
  if (nowMs < p.detectedAt) return 'FUTURE';   // saat kayması / bozuk veri
  if (p.expiresAt !== null && nowMs >= p.expiresAt) return 'EXPIRED';
  return 'VALID';
}

/** Gözlemin yaşı (ms); bilinmiyorsa `null`. */
export function presenceAgeMs(p: DriverPresence, nowMs: number): number | null {
  if (p.detectedAt === null) return null;
  return Math.max(0, nowMs - p.detectedAt);
}

/* ── TEK OTORİTE: Presence Resolver ────────────────────────────────────── */

export const PRESENCE_DECISIONS = [
  'PRESENCE_CONFIRMED',   // presence kanıt sayıldı ve atamayla uyumlu
  'PRESENCE_ONLY',        // presence var, atama yok — kanıt yine de geçerli
  'PRESENCE_CONFLICT',    // presence ile atama FARKLI sürücü gösteriyor
  'PRESENCE_UNUSABLE',    // presence var ama kanıt sayılamaz (kaynak/süre)
  'NO_PRESENCE',          // gözlem yok → atama modeli çalışır
] as const;
export type PresenceDecision = (typeof PRESENCE_DECISIONS)[number];

export interface PresenceResolution {
  readonly decision: PresenceDecision;
  /** Presence'ın önerdiği sürücü — kanıt sayılmadıysa `null`. */
  readonly driverId: string | null;
  /** Bu kanıtın taşıyabileceği güven. */
  readonly confidence: PresenceConfidence;
  readonly validity: PresenceValidity;
  /** Kararın gerekçesi — sessiz düşüş YOK. */
  readonly reason: string;
  /** Attribution bu sonucu KULLANMALI mı; `false` ise atama modeli çalışır. */
  readonly usable: boolean;
}

export interface PresenceResolverInput {
  readonly presence: DriverPresence;
  /** Aynı araç/zaman için atama modelinin bulduğu sürücü (varsa). */
  readonly assignmentDriverId: string | null;
  /** Sürücü aynı şirkette ve AKTİF mi (tenant + durum kapısı). */
  readonly driverEligible: boolean;
  readonly nowMs: number;
}

/**
 * PRESENCE OTORİTESİ — başka hiçbir yerde presence kararı verilmez.
 *
 * ── KARAR SIRASI ────────────────────────────────────────────────────────
 *  1. Gözlem yok / sürücüsüz          → `NO_PRESENCE` (atama modeli çalışır)
 *  2. Kaynak kimlik doğrulamıyor      → `PRESENCE_UNUSABLE`
 *  3. Süresi geçmiş / gelecek tarihli → `PRESENCE_UNUSABLE`
 *  4. Sürücü uygun değil (tenant/pasif)→ `PRESENCE_UNUSABLE`
 *  5. Atama farklı sürücü gösteriyor  → `PRESENCE_CONFLICT` (kullanılmaz)
 *  6. Atama ile uyumlu                → `PRESENCE_CONFIRMED`
 *  7. Atama yok                       → `PRESENCE_ONLY`
 *
 * ── ÇELİŞKİ NEDEN KULLANILMIYOR ─────────────────────────────────────────
 * NFC kartı Ahmet okutmuş ama araca Mehmet atanmışsa, hangisinin doğru
 * olduğunu **bilemeyiz**: kart ödünç verilmiş de olabilir, atama güncellenmemiş
 * de. İkisinden birini seçmek uydurma olurdu → insan incelemesi gerekir.
 */
export function resolveDriverPresence(input: PresenceResolverInput): PresenceResolution {
  const { presence: p, assignmentDriverId, driverEligible, nowMs } = input;

  if (p.source === 'UNKNOWN' || p.driverId === null) {
    return {
      decision: 'NO_PRESENCE', driverId: null, confidence: 'UNKNOWN',
      validity: 'UNKNOWN', reason: 'NO_OBSERVATION', usable: false,
    };
  }

  const validity = presenceValidity(p, nowMs);

  /* Kimlik doğrulamayan kaynak (head unit beyanı, doğrulanmamış telefon)
     bir ipucudur; sürücü KANITI değildir. */
  if (!isIdentityVerifying(p.source)) {
    return {
      decision: 'PRESENCE_UNUSABLE', driverId: null,
      confidence: sourceConfidenceCeiling(p.source),
      validity, reason: 'SOURCE_NOT_IDENTITY_VERIFYING', usable: false,
    };
  }

  if (validity !== 'VALID') {
    return {
      decision: 'PRESENCE_UNUSABLE', driverId: null, confidence: 'UNKNOWN',
      validity,
      reason: validity === 'EXPIRED' ? 'PRESENCE_EXPIRED'
        : validity === 'FUTURE' ? 'PRESENCE_IN_FUTURE' : 'PRESENCE_INCOMPLETE',
      usable: false,
    };
  }

  /* Başka şirketin veya pasif bir sürücünün kartı kanıt olamaz. */
  if (!driverEligible) {
    return {
      decision: 'PRESENCE_UNUSABLE', driverId: null, confidence: 'UNKNOWN',
      validity, reason: 'DRIVER_NOT_ELIGIBLE', usable: false,
    };
  }

  if (assignmentDriverId !== null && assignmentDriverId !== p.driverId) {
    return {
      decision: 'PRESENCE_CONFLICT', driverId: null, confidence: 'UNKNOWN',
      validity, reason: 'PRESENCE_ASSIGNMENT_MISMATCH', usable: false,
    };
  }

  /* Atama ile DOĞRULANMIŞ presence en güçlü kanıttır: hem plan hem
     fiziksel gözlem aynı kişiyi gösteriyor. */
  if (assignmentDriverId !== null) {
    return {
      decision: 'PRESENCE_CONFIRMED', driverId: p.driverId,
      confidence: p.confidence, validity,
      reason: 'PRESENCE_MATCHES_ASSIGNMENT', usable: true,
    };
  }

  /* Atama yok ama fiziksel kanıt var. Kanıt geçerlidir; ancak plan
     desteği olmadığı için güven bir kademe DÜŞÜRÜLÜR. */
  return {
    decision: 'PRESENCE_ONLY', driverId: p.driverId,
    confidence: weakestPresenceConfidence(p.confidence, 'HIGH'),
    validity, reason: 'PRESENCE_WITHOUT_ASSIGNMENT', usable: true,
  };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function presenceSourceLabel(s: PresenceSource): string {
  switch (s) {
    case 'NFC':       return 'NFC kart';
    case 'BLUETOOTH': return 'Bluetooth';
    case 'PHONE':     return 'Telefon';
    case 'HEAD_UNIT': return 'Araç ekranı';
    case 'UNKNOWN':   return 'Bilinmiyor';
  }
}

export function presenceValidityLabel(v: PresenceValidity): string {
  switch (v) {
    case 'VALID':   return 'Geçerli';
    case 'EXPIRED': return 'Süresi doldu';
    case 'FUTURE':  return 'Geçersiz zaman';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}

export function presenceDecisionLabel(d: PresenceDecision): string {
  switch (d) {
    case 'PRESENCE_CONFIRMED': return 'Atama ile doğrulandı';
    case 'PRESENCE_ONLY':      return 'Yalnız fiziksel kanıt';
    case 'PRESENCE_CONFLICT':  return 'Atama ile çelişiyor';
    case 'PRESENCE_UNUSABLE':  return 'Kanıt sayılamaz';
    case 'NO_PRESENCE':        return 'Gözlem yok';
  }
}

/* ── Gözlem deposu (head unit tarafı) ──────────────────────────────────── */

/**
 * Son presence gözlemini tutar.
 *
 * ── ŞU AN HİÇBİR ŞEY YAZMIYOR ─────────────────────────────────────────
 * `record()` çağıran **hiçbir üretim yolu YOKTUR**: NFC ve Bluetooth
 * uygulanmadı, head unit'ten serbest seçim bilinçli olarak kapalı. Depo
 * boş kaldığı sürece attribution P0'daki gibi davranır — bu, katmanın
 * güvenlik tasarımının bir parçasıdır, eksiklik değil.
 *
 * Gerçek okuyucu bağlandığında tek yapılacak: sürücüyü doğrulayan kaynağın
 * `record()` çağırması. Karar mantığı DEĞİŞMEZ (resolver tek otorite).
 */

/**
 * Ham gözlemin İDDİA ETTİĞİ araç kimliği.
 *
 * ⚠️ P2: bu değer **KANIT DEĞİLDİR**, yalnız bir İDDİADIR. Defterin araç
 * bağı artık `bindPresenceVehicle()` ile verilen DOĞRULANMIŞ kimlikten
 * gelir; buradan okunan değer yalnız o kimlikle KARŞILAŞTIRILIR. Uyuşmazsa
 * gözlem reddedilir (bkz. `DriverPresenceStore.record`).
 */
function readClaimedVehicleId(raw: unknown): string | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return typeof o.vehicleId === 'string' && o.vehicleId.length > 0 ? o.vehicleId : null;
}

/** Gözlemin neden reddedildiği — bounded KOD (serbest metin/PII YOK). */
export const PRESENCE_REJECT_REASONS = [
  'MALFORMED_OBSERVATION',   // sürücüsüz / kaynağı tanınmayan
  'VEHICLE_NOT_BOUND',       // araç bağı doğrulanmamış → yazamayız
  'VEHICLE_BINDING_MISMATCH',// gözlem BAŞKA aracı iddia ediyor
] as const;
export type PresenceRejectReason = (typeof PRESENCE_REJECT_REASONS)[number];

/**
 * Son ARIZA kodu — bounded (serbest metin ve PII YOK).
 *
 * Depolama hataları ile sözleşme ihlalleri AYRI kodlardır: "disk okunamadı"
 * ile "defter bozuk" farklı sorunlardır ve farklı müdahale gerektirir.
 */
export type PresenceFailureCode =
  | PresenceSnapshotDecodeReason
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'DURABILITY_READ_FAILED';

/** Kalıcılık katmanının son durumu — LAB bunu okur. */
export const PRESENCE_PERSISTENCE_STATES = [
  'UNINITIALIZED',  // henüz hiç okunmadı
  'EMPTY',          // kayıt yok (ilk açılış) — hata DEĞİL
  'RESTORED',       // defter diskten geri yüklendi
  'REJECTED',       // kayıt vardı ama sözleşmeye uymadı → fail-closed
  'READ_FAILED',    // depolama okunamadı
  'WRITE_FAILED',   // depolama yazılamadı
] as const;
export type PresencePersistenceState = (typeof PRESENCE_PERSISTENCE_STATES)[number];

class DriverPresenceStore {
  private _current: DriverPresence = UNKNOWN_PRESENCE;
  private _lastUpdateAtMs: number | null = null;
  private _observationCount = 0;
  private _rejectedCount = 0;
  /** Araç bağı doğrulanamadığı için reddedilen gözlemler (ayrı sayılır). */
  private _bindingRejectedCount = 0;
  /**
   * DOĞRULANMIŞ araç kimliği — kaynağı sunucunun verdiği araç kaydıdır
   * (`getVehicleIdentity().vehicleId`), gözlem yükü DEĞİL.
   * `null` = bağ yok → hiçbir gözlem deftere yazılamaz (fail-closed).
   */
  private _boundVehicleId: string | null = null;
  private _hydrated = false;
  private _persistenceState: PresencePersistenceState = 'UNINITIALIZED';
  private _lastRestoreAtMs: number | null = null;
  private _restoredSegmentCount = 0;
  private _snapshotSavedAtMs: number | null = null;
  private _lastFailure: PresenceFailureCode | null = null;
  private _lastFailureAtMs: number | null = null;
  private _lastRejectReason: PresenceRejectReason | null = null;
  /**
   * GEÇMİŞ DEFTERİ — karar katmanı DEĞİL.
   *
   * Resolver'a hiçbir şey beslemez; `resolveDriverPresence` bu alanı
   * görmez bile. Yalnız "varlık zaman içinde nasıl değişti" sorusunu
   * cevaplayan salt-gözlem kaydıdır.
   */
  private _history: PresenceHistoryState = EMPTY_PRESENCE_HISTORY;

  /* ── Kalıcılık (P2) ─────────────────────────────────────────────────
   *
   * TEMBEL: ilk erişimde bir kez okunur. Açılışta koşan bir başlatıcı ya da
   * timer YOKTUR (zero-leak). Okuma başarısız olursa defter BOŞ başlar ve
   * gerekçe LAB'da görünür — sahte "geri yüklendi" ASLA gösterilmez. */

  private _hydrate(nowMs: number | null = null): void {
    if (this._hydrated) return;
    this._hydrated = true;   // tekrar denemez: her okumada I/O yapmak hot-path'i döver

    let raw: string | null;
    try {
      raw = safeGetRaw(PRESENCE_SNAPSHOT_KEY);
    } catch {
      this._persistenceState = 'READ_FAILED';
      this._lastFailure = 'STORAGE_READ_FAILED';
      return;
    }

    const res = decodePresenceSnapshot(raw, this._boundVehicleId);
    if (!res.ok) {
      this._persistenceState = res.reason === 'EMPTY' ? 'EMPTY' : 'REJECTED';
      if (res.reason !== 'EMPTY') this._lastFailure = res.reason;
      return;
    }

    /* Geri yükleme defteri OLDUĞU GİBİ alır: kayıp dönemi tahmin etmez,
       açık segmenti kapatmaz, süre uydurmaz. TTL uzlaştırması okuma
       anında (`summarizePresenceHistory`) zaten yapılır. */
    this._history = res.snapshot.history;
    this._observationCount = res.snapshot.observationCount;
    this._rejectedCount = res.snapshot.rejectedCount;
    this._bindingRejectedCount = res.snapshot.bindingRejectedCount;
    if (this._boundVehicleId === null) this._boundVehicleId = res.snapshot.boundVehicleId;
    this._persistenceState = 'RESTORED';
    this._restoredSegmentCount = res.snapshot.history.entries.length;
    this._snapshotSavedAtMs = res.snapshot.savedAtMs;
    /* Geri yükleme anı UYDURULMAZ: saat verilmediyse `null` kalır. */
    this._lastRestoreAtMs = nowMs;
  }

  private _persist(nowMs: number): void {
    try {
      safeSetRaw(PRESENCE_SNAPSHOT_KEY, encodePresenceSnapshot({
        version: 1,
        savedAtMs: nowMs,
        boundVehicleId: this._boundVehicleId,
        history: this._history,
        observationCount: this._observationCount,
        rejectedCount: this._rejectedCount,
        bindingRejectedCount: this._bindingRejectedCount,
      }));
      this._snapshotSavedAtMs = nowMs;
      if (this._persistenceState === 'UNINITIALIZED' || this._persistenceState === 'EMPTY') {
        this._persistenceState = 'RESTORED';
      }
    } catch {
      /* Yazma düşse bile GÖZLEM KAYBOLMAZ (bellekteki defter geçerli);
         yalnız kalıcılık borcu LAB'da GÖRÜNÜR olur. */
      this._persistenceState = 'WRITE_FAILED';
      this._lastFailure = 'STORAGE_WRITE_FAILED';
      this._lastFailureAtMs = nowMs;
    }
  }

  /**
   * DOĞRULANMIŞ araç bağını kurar.
   *
   * Kaynak, sunucunun verdiği araç kaydıdır (`getVehicleIdentity()`), gözlem
   * yükü DEĞİL. Bağ DEĞİŞİRSE (dongle/head unit başka araca taşındı) defter
   * SIFIRLANIR: başka aracın varlık geçmişini bu araca devretmek defteri
   * yalan yapardı. Açık segment `CLEARED` ile kapatılır (sessiz kayıp yok).
   */
  bindVehicle(vehicleId: string | null, nowMs: number): void {
    const next = typeof vehicleId === 'string' && vehicleId.length > 0 ? vehicleId : null;
    this._hydrate(nowMs);
    if (this._boundVehicleId === next) return;

    if (this._boundVehicleId !== null) {
      this._history = closePresenceHistory(this._history, nowMs);
      this._current = UNKNOWN_PRESENCE;
      this._history = EMPTY_PRESENCE_HISTORY;
      this._observationCount = 0;
      this._rejectedCount = 0;
      this._bindingRejectedCount = 0;
      try { safeRemoveRaw(PRESENCE_SNAPSHOT_KEY); } catch { /* fail-soft */ }
    }
    this._boundVehicleId = next;
    this._persist(nowMs);
  }

  /** Bağlı doğrulanmış araç kimliği (LAB salt-okur). */
  get boundVehicleId(): string | null {
    this._hydrate();
    return this._boundVehicleId;
  }

  /**
   * Yeni gözlem kaydeder.
   *
   * ── ÜÇ KAPI (hepsi fail-closed) ────────────────────────────────────
   *  1. Ham girdi daraltılır: sürücüsüz/kaynağı tanınmayan gözlem REDDEDİLİR.
   *  2. Araç bağı YOKSA gözlem yazılmaz — "şu anki araç" VARSAYILMAZ.
   *  3. Gözlem BAŞKA bir aracı iddia ediyorsa REDDEDİLİR (istemciye güven yok).
   *
   * Her ret ayrı sayılır ve gerekçesi LAB'da görünür (sessiz yutma YOK).
   */
  record(raw: unknown, nowMs: number): DriverPresence {
    this._hydrate(nowMs);
    const p = normalizePresence(raw);
    if (p.source === 'UNKNOWN' || p.driverId === null) {
      this._rejectedCount += 1;
      this._lastRejectReason = 'MALFORMED_OBSERVATION';
      return this._current;
    }

    /* (2) Bağ yoksa YAZMA. P1'de araç kimliği gözlemin kendisinden alınıyordu;
       bu, istemcinin defteri istediği araca yazabilmesi demekti. */
    if (this._boundVehicleId === null) {
      this._bindingRejectedCount += 1;
      this._lastRejectReason = 'VEHICLE_NOT_BOUND';
      return this._current;
    }

    /* (3) İddia edilen araç, doğrulanmış araçtan farklıysa gözlem BU cihaza
       ait değildir. Sessizce "düzeltmek" (bizim aracımıza yazmak) sahte
       kanıt üretmek olurdu. */
    const claimed = readClaimedVehicleId(raw);
    if (claimed !== null && claimed !== this._boundVehicleId) {
      this._bindingRejectedCount += 1;
      this._lastRejectReason = 'VEHICLE_BINDING_MISMATCH';
      return this._current;
    }

    this._current = p;
    this._lastUpdateAtMs = nowMs;
    this._observationCount += 1;
    /* Araç kimliği YALNIZ doğrulanmış bağdan gelir — iddiadan DEĞİL. */
    this._history = recordPresenceHistory(this._history, {
      presence: p, vehicleId: this._boundVehicleId, nowMs,
    });
    this._persist(nowMs);
    return p;
  }

  /**
   * Gözlemi temizler (araç değişimi / oturum sonu).
   *
   * `nowMs` verilirse açık segment `CLEARED` olarak KAPATILIR; verilmezse
   * kapanış anı uydurulmaz (gerekçe yazılır, süre `null` kalır).
   */
  clear(nowMs?: number): void {
    const at = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : null;
    this._hydrate(at);
    this._current = UNKNOWN_PRESENCE;
    this._history = closePresenceHistory(this._history, at);
    this._persist(at ?? this._snapshotSavedAtMs ?? 0);
  }

  /**
   * KALICILIK + BAĞ gözlem yüzeyi (LAB). Hiçbir şey tetiklemez, ASLA fırlatmaz.
   *
   * `expiryMode` bilinçli olarak `LAZY_ON_ACCESS`'tir: head unit'te presence'ı
   * kapatan bir TIMER YOKTUR (zero-leak) — kapanış, gözlem geldiğinde veya
   * defter okunduğunda uygulanır. Bu bir eksiklik değil, bilinçli tasarımdır
   * ve LAB'da olduğu gibi gösterilir (sahte "worker çalışıyor" YOK).
   */
  readDurability(nowMs: number): {
    readonly persistenceState: PresencePersistenceState;
    readonly lastRestoreAtMs: number | null;
    readonly restoredSegmentCount: number;
    readonly snapshotSavedAtMs: number | null;
    readonly expiryMode: 'LAZY_ON_ACCESS';
    readonly expiredSegmentCount: number;
    readonly openSegmentCount: number;
    readonly boundVehicleId: string | null;
    readonly vehicleBindingState: 'BOUND' | 'UNBOUND';
    readonly bindingRejectedCount: number;
    readonly lastRejectReason: PresenceRejectReason | null;
    readonly lastFailure: PresenceFailureCode | null;
    readonly lastFailureAtMs: number | null;
    readonly replayCount: number;
  } {
    try {
      this._hydrate(nowMs);
      const sum = summarizePresenceHistory(this._history, nowMs);
      return {
        persistenceState: this._persistenceState,
        lastRestoreAtMs: this._lastRestoreAtMs,
        restoredSegmentCount: this._restoredSegmentCount,
        snapshotSavedAtMs: this._snapshotSavedAtMs,
        expiryMode: 'LAZY_ON_ACCESS',
        expiredSegmentCount: sum.expiredSegmentCount,
        openSegmentCount: sum.current === null ? 0 : 1,
        boundVehicleId: this._boundVehicleId,
        vehicleBindingState: this._boundVehicleId === null ? 'UNBOUND' : 'BOUND',
        bindingRejectedCount: this._bindingRejectedCount,
        lastRejectReason: this._lastRejectReason,
        lastFailure: this._lastFailure,
        lastFailureAtMs: this._lastFailureAtMs,
        replayCount: sum.replayCount,
      };
    } catch {
      /* Gözlem yüzeyi ASLA çökmez ve ASLA "sağlıklı" varsaymaz. */
      return {
        persistenceState: 'READ_FAILED', lastRestoreAtMs: null,
        restoredSegmentCount: 0, snapshotSavedAtMs: null,
        expiryMode: 'LAZY_ON_ACCESS', expiredSegmentCount: 0, openSegmentCount: 0,
        boundVehicleId: null, vehicleBindingState: 'UNBOUND',
        bindingRejectedCount: 0, lastRejectReason: null,
        lastFailure: 'DURABILITY_READ_FAILED', lastFailureAtMs: null, replayCount: 0,
      };
    }
  }

  /** @internal — testler arası izolasyon (üretim yolu ÇAĞIRMAZ). */
  _resetForTest(): void {
    this._current = UNKNOWN_PRESENCE;
    this._lastUpdateAtMs = null;
    this._observationCount = 0;
    this._rejectedCount = 0;
    this._bindingRejectedCount = 0;
    this._boundVehicleId = null;
    this._hydrated = false;
    this._persistenceState = 'UNINITIALIZED';
    this._lastRestoreAtMs = null;
    this._restoredSegmentCount = 0;
    this._snapshotSavedAtMs = null;
    this._lastFailure = null;
    this._lastFailureAtMs = null;
    this._lastRejectReason = null;
    this._history = EMPTY_PRESENCE_HISTORY;
  }

  /** Geçmiş özeti — SALT-OKUNUR, defteri DEĞİŞTİRMEZ. */
  readHistory(nowMs: number): PresenceHistorySummary {
    try {
      this._hydrate(nowMs);   // kalıcı defter ilk okumada geri yüklenir
      return summarizePresenceHistory(this._history, nowMs);
    } catch {
      return EMPTY_PRESENCE_HISTORY_SUMMARY;
    }
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): {
    readonly presence: DriverPresence;
    readonly validity: PresenceValidity;
    readonly ageMs: number | null;
    readonly expired: boolean;
    readonly lastUpdateAtMs: number | null;
    readonly observationCount: number;
    readonly rejectedCount: number;
  } {
    try {
      this._hydrate(nowMs);
      const validity = presenceValidity(this._current, nowMs);
      return {
        presence: this._current,
        validity,
        ageMs: presenceAgeMs(this._current, nowMs),
        expired: validity === 'EXPIRED',
        lastUpdateAtMs: this._lastUpdateAtMs,
        observationCount: this._observationCount,
        rejectedCount: this._rejectedCount,
      };
    } catch {
      return {
        presence: UNKNOWN_PRESENCE, validity: 'UNKNOWN', ageMs: null,
        expired: false, lastUpdateAtMs: null,
        observationCount: 0, rejectedCount: 0,
      };
    }
  }
}

export const driverPresenceStore = new DriverPresenceStore();

/** LAB salt-okuma yüzeyi — hiçbir gözlem ÜRETMEZ. */
export function readDriverPresence(nowMs: number) {
  return driverPresenceStore.read(nowMs);
}

/**
 * LAB salt-okuma yüzeyi — VARLIK GEÇMİŞİ.
 *
 * Defteri okur, ASLA yazmaz ve resolver kararını ETKİLEMEZ.
 */
export function readDriverPresenceHistory(nowMs: number) {
  return driverPresenceStore.readHistory(nowMs);
}

/**
 * LAB salt-okuma yüzeyi — KALICILIK · SÜRE DOLUMU · ARAÇ BAĞI (P2).
 *
 * Hiçbir şey başlatmaz, hiçbir şey onarmaz, kararı etkilemez. Bilinmeyen
 * alanlar `null` döner — sahte "sağlıklı" ÜRETİLMEZ.
 */
export function readDriverPresenceDurability(nowMs: number) {
  return driverPresenceStore.readDurability(nowMs);
}

/**
 * DOĞRULANMIŞ araç bağını kurar (P2).
 *
 * ── KİM ÇAĞIRMALI ──────────────────────────────────────────────────────
 * Yalnız araç kimliğini SUNUCUDAN doğrulamış olan yol —
 * `presenceVehicleBinding.ts` → `getVehicleIdentity()`. Bir gözlem
 * üreticisi (NFC/BT okuyucu) BU FONKSİYONU ÇAĞIRMAZ: kendi taşıdığı araç
 * kimliğini "doğrulanmış" ilan edebilseydi, bağın hiçbir anlamı kalmazdı.
 */
export function bindPresenceVehicle(vehicleId: string | null, nowMs: number): void {
  driverPresenceStore.bindVehicle(vehicleId, nowMs);
}

/** @internal — testler arası izolasyon. */
export function _resetDriverPresenceStoreForTest(): void {
  driverPresenceStore._resetForTest();
}
