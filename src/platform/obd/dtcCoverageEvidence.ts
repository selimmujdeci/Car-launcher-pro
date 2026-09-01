/**
 * dtcCoverageEvidence — P0-VDK-F6B · ÇOKLU-ECU DTC KAPSAM KANIT DEFTERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE CEVAPLAR ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLMÜŞ her uç nokta için TEK soru:
 *   **"Neyi sordum, ne cevap verdi, neyi okuyamadım ve NEDEN?"**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE DEĞİLDİR ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ DTC OTORİTESİ DEĞİLDİR.** DTC kodu TAŞIMAZ — yalnız SAYAR.
 *     Kod listesi ve hüküm `dtcAuthority` tekelindedir.
 * (2) **İKİNCİ MUHASEBE MOTORU DEĞİLDİR.** RAW→PARSED→AUTHORITY→UI zinciri
 *     `dtcPipelineAccounting`tedir; burada KOPYALANMAZ, yalnız referans
 *     verilir (`pipelineLoss`).
 * (3) **YENİ ÖLÇÜM ÜRETMEZ.** Tarama zaten hesapladığını buraya yazar; bu
 *     modül hattan tek bayt istemez, timer kurmaz, I/O yapmaz.
 *
 * ── OTURUM MÜHRÜ ──────────────────────────────────────────────────────────
 * Yeni bir OBD oturumu (araç değişimi) eski kapsamı DÜŞÜRÜR — başka bir
 * aracın kapsamı bu araca taşınamaz.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Ham OEM gövdesi, ham DTC baytı, VIN, MAC ve token bu deftere GİRMEZ.
 * Yalnız sayılar, sınıflar ve kapalı sözlükten gerekçeler taşınır.
 */

import type {
  DtcCoverageAxis, DtcCoverageClass, DtcCoverageOutcome, DtcCoverageSkipReason,
  EcuDtcCoverageVerdict, StatusMaskProvenance, DeclaredCountVerdict,
} from './dtcCoveragePlan';
/* P0-VDK-F6C — kayıp sınıfı MEVCUT F5-A sözlüğünden gelir; kopya YOK. */
import type { RootCauseClass } from './healing/gapModel';
import type { CapabilityProvenance } from './capability/capabilityGraph';
import type { EcuAddressability } from './ecuAddressability';
import type { EcuRole, EcuRoleEvidence } from './ecuRoleModel';

/** Bir (uç nokta × kapsam sınıfı) satırı. */
export interface DtcCoverageRow {
  readonly cls: DtcCoverageClass;
  /** P0-VDK-F6C — `core` (arıza hafızası) / `deep` (kayıt başına ek kanıt). */
  readonly axis: DtcCoverageAxis;
  readonly service: string;
  readonly subFunction: string | null;
  readonly outcome: DtcCoverageOutcome;
  /**
   * P0-VDK-F6C — kayıp KAYNAĞI (MEVCUT `RootCauseClass` sözlüğü).
   * Terminal satırda `null`. `PARSER_BOUND` **araç kusuru DEĞİL**, yazılım
   * borcudur ve ölçümle kapanmaz (`isMeasurementResolvable === false`).
   */
  readonly gapRoot: RootCauseClass | null;
  /** Sorgu gönderilmediyse kapalı sözlükten gerekçe; gönderildiyse `null`. */
  readonly skipReason: DtcCoverageSkipReason | null;
  /** Bu sınıf için hatta ÇIKAN istek sayısı. 0 = tek bayt çıkmadı. */
  readonly requestCount: number;
  /** Çözümlenen kayıt sayısı; ölçülemediyse `null` (sahte 0 YASAK). */
  readonly recordCount: number | null;
  /** ECU'nun BEYAN ettiği kayıt sayısı (yalnız 19-01); yoksa `null`. */
  readonly declaredCount: number | null;
  readonly declaredVerdict: DeclaredCountVerdict;
  /** Ölçülen taşıma/servis sonucu — `advancedDtcEvidence` sözlüğüyle AYNI dil. */
  readonly measuredOutcome: string | null;
  /**
   * P0-VDK-F6E — ÖLÇÜLEN NEGATİF YANIT KODU.
   *
   * ÖĞRENME İÇİN ZORUNLUDUR: `normalizeAdvancedOutcome` NRC `0x11` (servis yok),
   * `0x12` (alt fonksiyon yok) ve `0x31` (aralık dışı) üçünü de tek bir
   * `unsupported`a indirger. Ham NRC olmadan **"bu ECU bu servisi bilmiyor"
   * öğrenilemez** — F4-B'nin pazarlıksız "0x11 görmeden yok DENMEZ" kuralı
   * öğrenme tarafında ancak bu alanla korunur.
   *
   * Standart modlarda (03/07/0A) native NRC TAŞIMAZ → `null` kalır ve o
   * satırlardan yokluk ÖĞRENİLMEZ (dürüst sonuç).
   */
  readonly nrc: number | null;
  readonly detail: string;
}

/** Bir uç noktanın tur kapsamı. */
export interface DtcCoverageEcuEntry {
  readonly atMs: number;
  readonly sessionEpoch: number;
  readonly txHeader: string | null;
  readonly rxHeader: string;
  /**
   * P0-VDK-F6C — `ecuCompleteness.ecuCoverageKey` ile AYNI anahtar.
   *
   * İki kapsam ekseni (uç nokta keşfi · tanı kapsamı) ancak AYNI anahtarla
   * birleşebilir. Kapsam defteri `rxHeader` ile, keşif `${addressBits}:${rx}`
   * ile anahtarlıyordu; eşleştirmeyi çağırana bırakmak, iki farklı ucın
   * sessizce yanlış eşleşmesi demekti.
   */
  readonly ecuKey: string;
  readonly ecuLabel: string;
  /** Rol KANITTAN gelir; yoksa `null` — adresten rol UYDURULMAZ. */
  readonly role: EcuRole | null;
  readonly roleEvidence: EcuRoleEvidence | null;
  readonly protocol: string | null;
  /**
   * ── P0-VDK-F6D · F5-D KANIT REFERANSLARI ───────────────────────
   *
   * Kapsam boşluğu kanonik `GapEvidence` zarfına çevrilirken bu üç bağ
   * ZORUNLUDUR: hangi işlemde, hangi korelasyonla ve HANGİ ARAÇta ölçüldüğü
   * bilinmeyen bir boşluk, başka bir aracın sicilinde çözülmeye çalışılabilirdi
   * (F5-F/G araç izolasyonu). Ölçülmediyse `null` — sahte değer YASAK.
   *
   * `vehicleRef` tarama ANıNDA henüz çözülmemiş olabilir (araç bölümü tam
   * tarama SONRASINDA aktive edilir) — o durumda `null` kalır ve köprü
   * keşifin çözdüğü TAZE referansı kullanır.
   */
  readonly transactionId: string | null;
  readonly evidenceCorrelationId: string | null;
  readonly vehicleRef: string | null;
  /**
   * P0-VDK-F6C — ÖLÇÜMÜN KÖKENİ (MEVCUT F4-C sözlüğü).
   *
   * `live` dışındaki hiçbir köken ÜRÜN-GÜVENİLİR kapsam hükmü üretemez:
   * masa başında oynatılan bir iz, sahada tam taranmış bir araç SAYILAMAZ.
   * Kural F4-C `isProductTrusted` ile BİREBİR AYNIDIR; kopyalanmadı.
   */
  readonly provenance: CapabilityProvenance;
  readonly addressability: EcuAddressability;
  /** **TEMEL (core) hüküm** — arıza hafızasını okuyabildik mi. */
  readonly verdict: EcuDtcCoverageVerdict;
  readonly reasons: readonly string[];
  /**
   * P0-VDK-F6C — **DERİN kanıt hükmü** (19-03 · 19-04 · 19-06).
   * `verdict`i DÜŞÜRMEZ: 19-04 yapısal olarak kapalı olduğu için temel
   * kapsamı sonsuza dek kısmi göstermek ölçülmemiş bir eksikliği ölçülmüş
   * gibi sunmak olurdu.
   */
  readonly deepVerdict: EcuDtcCoverageVerdict;
  readonly deepReasons: readonly string[];
  /** Eksen başına PLANLANMIŞ ve TERMİNAL birim (yüzdenin tek temeli). */
  readonly corePlannedUnits: number;
  readonly coreTerminalUnits: number;
  readonly deepPlannedUnits: number;
  readonly deepTerminalUnits: number;
  readonly rows: readonly DtcCoverageRow[];
  /** Bu uç nokta için hatta çıkan TOPLAM istek. */
  readonly requestCount: number;
  /** Bu uç noktadan ürüne ulaşan DTC satırı. */
  readonly dtcCount: number;
  /** Alt kodu (failureType/subCode) KORUNMUŞ kayıt sayısı. */
  readonly failureTypeCount: number;
  /** Status baytı KORUNMUŞ kayıt sayısı. */
  readonly statusByteCount: number;
  /** 19-02 isteğine konan maske ve künyesi. */
  readonly statusMask: string | null;
  readonly statusMaskProvenance: StatusMaskProvenance | null;
  /** 19-03'ün ÖLÇTÜĞÜ snapshot referans sayısı; ölçülmediyse `null`. */
  readonly snapshotReferenceCount: number | null;
  /**
   * 19-06 KANITI VAR MI. `true` yalnız "ham genişletilmiş veri MEVCUT"
   * demektir — baytların ANLAMI OEM'e özgüdür ve UYDURULMAZ.
   */
  readonly extendedDataAvailable: boolean | null;
  /** Öğrenilmiş yetenek sayesinde SORULMAYAN sınıf adedi. */
  readonly capabilityReused: number;
}

export const DTC_COVERAGE_EVIDENCE_MAX = 24;

let _entries: DtcCoverageEcuEntry[] = [];

/** Kapsam satırı yazar. ASLA throw etmez — kanıt ürünü düşüremez. */
export function recordDtcCoverage(e: DtcCoverageEcuEntry): void {
  try {
    /* Oturum mührü: yeni oturum → eski araç kapsamı DÜŞER. */
    if (_entries.length > 0 && _entries[_entries.length - 1]!.sessionEpoch !== e.sessionEpoch) {
      _entries = [];
    }
    /* Aynı turda aynı uç nokta iki kez yazılırsa SON ölçüm geçerlidir. */
    const key = `${e.sessionEpoch}|${e.rxHeader}`;
    _entries = _entries.filter((x) => `${x.sessionEpoch}|${x.rxHeader}` !== key);
    _entries.push(Object.freeze({ ...e, rows: e.rows.map((r) => Object.freeze({ ...r })),
      reasons: [...e.reasons] }));
    if (_entries.length > DTC_COVERAGE_EVIDENCE_MAX) {
      _entries.splice(0, _entries.length - DTC_COVERAGE_EVIDENCE_MAX);
    }
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
}

/**
 * Defterin salt-okunur kopyası — KARARLI sıralamada (uç nokta rx başlığına
 * göre). Deterministik sıra olmadan iki tarama raporu karşılaştırılamaz.
 */
export function getDtcCoverageEvidence(): readonly DtcCoverageEcuEntry[] {
  return [..._entries].sort((a, b) => a.rxHeader.localeCompare(b.rxHeader));
}

export function _resetDtcCoverageEvidenceForTest(): void { _entries = []; }

/* ══════════════════════════════════════════════════════════════════════════
   ÖZET — SAF (girdi çağırandan gelir; modül durumu okunmaz)
   ══════════════════════════════════════════════════════════════════════════ */

export interface DtcCoverageSummary {
  readonly endpoints: number;
  /** En az bir DTC sorgusu GÖNDERİLEN uç nokta. */
  readonly queriedEndpoints: number;
  readonly complete: number;
  /** P0-VDK-F6C — DERİN kanıtı da tam olan uç nokta (ayrı eksen). */
  readonly deepComplete: number;
  /** Eksen başına toplam birim — yüzde BUNLARDAN türer, DTC sayısından DEĞİL. */
  readonly corePlannedUnits: number;
  readonly coreTerminalUnits: number;
  readonly deepPlannedUnits: number;
  readonly deepTerminalUnits: number;
  /**
   * Kayıp kök nedenlerinin sayımı (MEVCUT `RootCauseClass` sözlüğü).
   * `TRANSPORT_BOUND` ve `PARSER_BOUND` **ARAÇ kusuru DEĞİLDİR**.
   */
  readonly gapRoots: Readonly<Partial<Record<RootCauseClass, number>>>;
  readonly partial: number;
  readonly unknown: number;
  readonly deferred: number;
  readonly blocked: number;
  readonly notAddressable: number;
  /** Rolü BİLİNMEYEN ama yine de sorgulanan uç nokta sayısı (F6-A sözleşmesi). */
  readonly unknownRoleQueried: number;
  readonly totalRequests: number;
  readonly totalDtcs: number;
  readonly capabilityReused: number;
  readonly sessionEpoch: number | null;
}

const _EMPTY: DtcCoverageSummary = Object.freeze({
  endpoints: 0, queriedEndpoints: 0, complete: 0, deepComplete: 0,
  corePlannedUnits: 0, coreTerminalUnits: 0,
  deepPlannedUnits: 0, deepTerminalUnits: 0,
  gapRoots: Object.freeze({}),
  partial: 0, unknown: 0,
  deferred: 0, blocked: 0, notAddressable: 0, unknownRoleQueried: 0,
  totalRequests: 0, totalDtcs: 0, capabilityReused: 0, sessionEpoch: null,
});

export function summarizeDtcCoverage(
  entries: readonly DtcCoverageEcuEntry[],
): DtcCoverageSummary {
  if (entries.length === 0) return _EMPTY;
  const count = (v: EcuDtcCoverageVerdict) => entries.filter((e) => e.verdict === v).length;
  const sum = (pick: (e: DtcCoverageEcuEntry) => number) =>
    entries.reduce((n, e) => n + pick(e), 0);
  /* Kök neden sayımı — yalnız GERÇEKTEN olan sınıflar anahtar alır
     (sahte 0 YASAK: olmayan bir kök nedeni "0" diye listelemek, ölçülmüş gibi
     görünür). */
  const gapRoots: Partial<Record<RootCauseClass, number>> = {};
  for (const e of entries) {
    for (const r of e.rows) {
      if (r.gapRoot === null) continue;
      gapRoots[r.gapRoot] = (gapRoots[r.gapRoot] ?? 0) + 1;
    }
  }
  return {
    endpoints: entries.length,
    queriedEndpoints: entries.filter((e) => e.requestCount > 0).length,
    complete:       count('COMPLETE'),
    deepComplete:   entries.filter((e) => e.deepVerdict === 'COMPLETE').length,
    corePlannedUnits:  sum((e) => e.corePlannedUnits),
    coreTerminalUnits: sum((e) => e.coreTerminalUnits),
    deepPlannedUnits:  sum((e) => e.deepPlannedUnits),
    deepTerminalUnits: sum((e) => e.deepTerminalUnits),
    gapRoots,
    partial:        count('PARTIAL'),
    unknown:        count('UNKNOWN'),
    deferred:       count('DEFERRED'),
    blocked:        count('BLOCKED'),
    notAddressable: count('NOT_ADDRESSABLE'),
    /* Rolü çözülmemiş uç nokta ENVANTERDEN ATILMAZ ve kapsama GİRER — bu
       sayı o sözleşmenin ÖLÇÜMÜDÜR (F6-A §4). */
    unknownRoleQueried: entries.filter((e) =>
      (e.role === null || e.role === 'unknown') && e.requestCount > 0).length,
    totalRequests: entries.reduce((n, e) => n + e.requestCount, 0),
    totalDtcs:     entries.reduce((n, e) => n + e.dtcCount, 0),
    capabilityReused: entries.reduce((n, e) => n + e.capabilityReused, 0),
    sessionEpoch: entries[0]!.sessionEpoch,
  };
}
