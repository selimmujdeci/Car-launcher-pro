/**
 * gapRetentionPolicy — P0-VDK-F5E · BOŞLUK SİCİLİNİN SAKLAMA POLİTİKASI (SAF).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-D raporunda açık borç olarak yazıldı: kimlik artık NRC/sınıflandırma
 * eksenlerini de içerdiği için **tek bir "flapping" ECU** (her turda farklı NRC
 * döndüren bir kontrol ünitesi) `MAX_GAP_ENTRIES = 120` tavanını tek başına
 * doldurabilirdi. Tavanı kör büyütmek bunu çözmez, yalnız borcu erteler:
 * 120 yerine 500 slot da dolar ve bu kez cihazda disk/bellek borcu doğar.
 *
 * Çözüm bir SAYI değil bir POLİTİKADIR: hangi kaydın hangi kaydın önüne
 * geçtiği AÇIK, DETERMİNİSTİK ve TEST EDİLEBİLİR olmalıdır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **DEFTER DEĞİLDİR.** Tek satır saklamaz; `gapRegistry` tek sahiptir.
 * (2) **İKİNCİ TAZELİK OTORİTESİ DEĞİLDİR.** Bayatlık eşiği MEVCUT
 *     `CAPABILITY_FRESH_MS`tir (F4-C); burada yeni bir eşik TANIMLANMAZ.
 * (3) **HÜKÜM VERMEZ.** Bir boşluğun çözülüp çözülmediğine karar vermez;
 *     yalnız "yer darsa hangisi gider" sorusunu yanıtlar.
 * (4) **GİZLİLİK KAPISI BURADADIR ama kripto DEĞİLDİR:** kalıcı yazımda alanlar
 *     BEYAZ LİSTEYLE kopyalanır; bilinmeyen alan diske GEÇEMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import { CAPABILITY_FRESH_MS } from './capability/capabilityGraph';
import type { GapEntry } from './gapRegistry';
import type { GapEvidence } from './gapEvidence';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAVANLAR VE KOTALAR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Genel sicil tavanı — **bilinçli olarak BÜYÜTÜLMEDİ**.
 *
 * F5-D'de bulunan baskı bir kapasite sorunu değil bir DAĞILIM sorunuydu;
 * çözümü kota + deterministik eviction'dır (aşağıda), sayıyı şişirmek değil.
 */
export const MAX_GAP_ENTRIES = 120;

/**
 * Tek bir boşluk AİLESİ (sinyal × ECU × servis) için tavan.
 *
 * Flapping tam olarak burada durdurulur: aynı ECU'nun aynı servisi her turda
 * farklı NRC döndürse bile o aile en çok bu kadar satır tutabilir; yeni ölçüm
 * ailenin EN DEĞERSİZ satırının yerine geçer (ya da hiç girmez).
 */
export const MAX_ENTRIES_PER_FAMILY = 8;

/**
 * Tek bir ECU'nun toplam payı — sicilin üçte biri.
 *
 * Bir ECU birçok serviste birden flapping yaparsa aile kotası tek başına
 * yetmez; bu ikinci kota, tek bir ünitenin sicili işgal etmesini keser.
 */
export const MAX_ENTRIES_PER_ECU = 40;

/* ══════════════════════════════════════════════════════════════════════════
   2) BAYATLIK — MEVCUT eşik, yeni otorite YOK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kayıt bayatladı mı — eşik MEVCUT `CAPABILITY_FRESH_MS`tir (30 gün).
 *
 * ⚠️ Bayat bir boşluk SİLİNMEZ ve "çözüldü" SAYILMAZ: yalnız (a) yer darlığında
 * daha kolay feda edilir, (b) kapanmış olsa bile yeniden ölçülebilir hâle
 * gelir. Doğum kanıtı her iki durumda da AYNEN korunur.
 *
 * Damgası olmayan kayıt bayat SAYILMAZ: ölçülmemiş bir zamanı "eski" ilan
 * etmek uydurma olurdu.
 */
export function isGapEntryStale(e: GapEntry, nowMs: number | null): boolean {
  if (nowMs === null || e.lastSeenMs === null) return false;
  return (nowMs - e.lastSeenMs) > CAPABILITY_FRESH_MS;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) AİLE KİMLİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kanonik boşluk ailesi — `sinyal × ECU × servis`.
 *
 * NRC ve sınıflandırma BİLEREK dışarıdadır: aile tam olarak "aynı hedefte
 * değişken sonuç" kümesidir ve kota bu kümeye uygulanır.
 */
export function gapFamilyKey(e: GapEntry): string {
  const ecu = e.evidence?.ecuKey ?? '-';
  const svc = e.evidence?.service ?? '-';
  return `${e.signal}|${ecu}|${svc}`;
}

export function gapEcuKey(e: GapEntry): string | null {
  return e.evidence?.ecuKey ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) DEĞER SIRALAMASI — açık, tam sayı, kanıtlanabilir
   ══════════════════════════════════════════════════════════════════════════ */

/** Ağırlıklar AÇIKTIR; gizli katsayı ya da olasılıksal skor YOKTUR. */
export const RANK_UNRESOLVED = 200;
export const RANK_EVIDENCE_MEASURED = 60;
export const RANK_EVIDENCE_PARTIAL = 30;
export const RANK_FRESH = 40;
export const RANK_PER_OBSERVATION = 2;
export const RANK_MAX_OBSERVATIONS = 10;

/**
 * Kaydın SAKLANMA değeri — yüksek olan kalır.
 *
 * ⚠️ PAZARLIKSIZ KİLİT: `RANK_UNRESOLVED` (200), diğer tüm bileşenlerin
 * toplamından (60 + 40 + 20 = 120) BÜYÜKTÜR. Bu bir tesadüf değil bir
 * garantidir: **çözülmemiş bir boşluk, çözülmüş bir boşluktan ÖNCE ASLA
 * düşmez.** Açık bir tanı eksiğini atıp kapanmış bir kaydı tutmak, sicilin
 * varlık sebebini tersine çevirirdi.
 */
export function gapRetentionRank(e: GapEntry, nowMs: number | null): number {
  let r = 0;
  if (e.resolutionState !== 'RESOLVED') r += RANK_UNRESOLVED;
  if (e.evidenceState === 'MEASURED') r += RANK_EVIDENCE_MEASURED;
  else if (e.evidenceState === 'LEGACY_INCOMPLETE') r += RANK_EVIDENCE_PARTIAL;
  if (!isGapEntryStale(e, nowMs)) r += RANK_FRESH;
  r += Math.min(e.count, RANK_MAX_OBSERVATIONS) * RANK_PER_OBSERVATION;
  return r;
}

/**
 * Eviction sırası — ÖNCE atılacak olan başa gelir.
 *
 * Sıra tamamen deterministiktir: değer → son görülme (eski önce) → anahtar.
 * Aynı girdi her cihazda AYNI kurbanı seçer.
 */
export function compareEvictionOrder(
  a: GapEntry, b: GapEntry, nowMs: number | null,
): number {
  const ra = gapRetentionRank(a, nowMs);
  const rb = gapRetentionRank(b, nowMs);
  if (ra !== rb) return ra - rb;
  const la = a.lastSeenMs ?? -1;
  const lb = b.lastSeenMs ?? -1;
  if (la !== lb) return la - lb;
  return a.key.localeCompare(b.key);
}

/** Bir kümenin EN DEĞERSİZ üyesi (eviction kurbanı); küme boşsa `null`. */
export function weakestEntry(
  entries: readonly GapEntry[], nowMs: number | null,
): GapEntry | null {
  let worst: GapEntry | null = null;
  for (const e of entries) {
    if (worst === null || compareEvictionOrder(e, worst, nowMs) < 0) worst = e;
  }
  return worst;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) EKLEME PLANI
   ══════════════════════════════════════════════════════════════════════════ */

/** Kayıt neden düştü/atıldı — sessiz kırpma YASAK. */
export type GapEvictionReason =
  /** Genel sicil tavanı doldu. */
  | 'CAPACITY'
  /** Aynı sinyal × ECU × servis ailesi kotasını doldurdu (flapping kalkanı). */
  | 'FAMILY_QUOTA'
  /** Tek ECU kotasını doldurdu. */
  | 'ECU_QUOTA';

export const GAP_EVICTION_REASON_LABEL: Readonly<Record<GapEvictionReason, string>> = {
  CAPACITY:     'genel sicil tavanı',
  FAMILY_QUOTA: 'sinyal × ECU × servis aile kotası',
  ECU_QUOTA:    'tek ECU kotası',
} as const;

export interface GapInsertPlan {
  /** Yeni kayıt sicile girecek mi. */
  readonly accept: boolean;
  /** Yer açmak için düşürülecek satırın anahtarı; düşürme yoksa `null`. */
  readonly evictKey: string | null;
  /** Kota/tavan devreye girdiyse gerekçesi; girmediyse `null`. */
  readonly reason: GapEvictionReason | null;
}

const PLAN_ACCEPT: GapInsertPlan =
  Object.freeze({ accept: true, evictKey: null, reason: null });

function _decide(
  scope: readonly GapEntry[], candidate: GapEntry, nowMs: number | null,
  reason: GapEvictionReason,
): GapInsertPlan {
  const victim = weakestEntry(scope, nowMs);
  if (victim === null) return PLAN_ACCEPT;
  /* Gelen kayıt mevcut en değersiz satırdan DAHA DEĞERLİ değilse içeri
     alınmaz. Aksi hâlde flapping, kotayı bir turnike gibi kullanıp değerli
     satırları sırayla dışarı iterdi. */
  if (compareEvictionOrder(victim, candidate, nowMs) >= 0) {
    return { accept: false, evictKey: null, reason };
  }
  return { accept: true, evictKey: victim.key, reason };
}

/**
 * YENİ bir satırın sicile nasıl gireceğini planlar — SAF.
 *
 * Sıra bilinçlidir: önce AİLE kotası (flapping kalkanı), sonra ECU kotası,
 * en sonda genel tavan. Böylece tek bir ünitenin gürültüsü, başka ECU'ların
 * kanıtını asla dışarı itemez.
 *
 * ⚠️ Bu fonksiyon YALNIZ yeni anahtar için çağrılır: mevcut bir satırın
 * sayacını artırmak kota tüketmez (tekrar bir kanıttır, yeni bir işgal değil).
 */
export function planGapInsert(
  entries: readonly GapEntry[], candidate: GapEntry, nowMs: number | null,
): GapInsertPlan {
  const fam = gapFamilyKey(candidate);
  const family = entries.filter((e) => gapFamilyKey(e) === fam);
  if (family.length >= MAX_ENTRIES_PER_FAMILY) {
    return _decide(family, candidate, nowMs, 'FAMILY_QUOTA');
  }
  const ecu = gapEcuKey(candidate);
  if (ecu !== null) {
    const perEcu = entries.filter((e) => gapEcuKey(e) === ecu);
    if (perEcu.length >= MAX_ENTRIES_PER_ECU) {
      return _decide(perEcu, candidate, nowMs, 'ECU_QUOTA');
    }
  }
  if (entries.length >= MAX_GAP_ENTRIES) {
    return _decide(entries, candidate, nowMs, 'CAPACITY');
  }
  return PLAN_ACCEPT;
}

/* ══════════════════════════════════════════════════════════════════════════
   6) KALICI YAZIM İÇİN BEYAZ LİSTE İZDÜŞÜMÜ — gizlilik kapısı
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kalıcı depoya YAZILABİLİR kayıt mı.
 *
 * ⚠️ KARAR (kod kanıtıyla, §REPLAY): ÜRÜN kalıcılığı YALNIZ `live` kanıt
 * içindir. Gerekçe repoda zaten yazılıdır:
 *   · `capabilityGraph.isProductTrusted(p)` yalnız `live` için `true`,
 *   · `gapResolverRuntime.judgeEvidence` `live` olmayan kanıtla ASLA `RESOLVED`
 *     vermez,
 *   · `canonicalTrace` replay/imported kökenini AYRI bir mod olarak taşır.
 * Replay/sentetik/imported bir boşluk süreç ömürlü sicilde yaşayabilir ve LAB'da
 * görünür — ama diske yazılıp bir sonraki açılışta ÜRÜN GERÇEĞİ gibi geri
 * gelemez. Kökeni ÖLÇÜLMEMİŞ kayıt da (zarfsız/legacy) fail-closed olarak
 * yazılmaz: canlılığını kanıtlayamayan kayıt kalıcı olamaz.
 */
export function isGapEntryPersistable(e: GapEntry): boolean {
  return e.evidence !== null && e.evidence.provenance === 'live';
}

/** Zarfın diske giden alanları — BEYAZ LİSTE; bilinmeyen alan GEÇEMEZ. */
function _projectEvidence(ev: GapEvidence): GapEvidence {
  return {
    ecuKey: ev.ecuKey,
    ecuTxHeader: ev.ecuTxHeader,
    ecuRxHeader: ev.ecuRxHeader,
    service: ev.service,
    subFunction: ev.subFunction,
    requestIdentity: ev.requestIdentity,
    observedOutcome: ev.observedOutcome,
    observedNrc: ev.observedNrc,
    observedClassification: ev.observedClassification,
    sessionOpened: ev.sessionOpened,
    sessionCommand: ev.sessionCommand,
    transportKind: ev.transportKind,
    protocol: ev.protocol,
    transactionId: ev.transactionId,
    evidenceCorrelationId: ev.evidenceCorrelationId,
    traceEventRef: ev.traceEventRef,
    sessionEpoch: ev.sessionEpoch,
    vehicleFingerprintRef: ev.vehicleFingerprintRef,
    ecuFingerprintRef: ev.ecuFingerprintRef,
    capabilityEdgeRef: ev.capabilityEdgeRef,
    provenance: ev.provenance,
    observedAt: ev.observedAt,
    state: ev.state,
  };
}

/**
 * Kaydın diske giden izdüşümü — BEYAZ LİSTE.
 *
 * Bilinmeyen/eklenmiş bir alan (ham gövde, VIN, MAC, token…) bu izdüşümden
 * GEÇEMEZ: yalnız burada tek tek sayılan alanlar kopyalanır. Gizlilik bir
 * denetim listesiyle değil, YAPISAL olarak garanti edilir.
 */
export function projectGapEntryForPersist(e: GapEntry): GapEntry {
  return {
    key: e.key,
    signal: e.signal,
    scope: e.scope,
    context: e.context,
    count: e.count,
    firstSeenMs: e.firstSeenMs,
    lastSeenMs: e.lastSeenMs,
    runId: e.runId,
    evidence: e.evidence === null ? null : _projectEvidence(e.evidence),
    evidenceState: e.evidenceState,
    resolutionState: e.resolutionState,
    resolution: e.resolution === null ? null : {
      evidenceRef: e.resolution.evidenceRef,
      classification: e.resolution.classification,
      provenance: e.resolution.provenance,
      resolvedAtMs: e.resolution.resolvedAtMs,
      detail: e.resolution.detail,
    },
  };
}
