/**
 * ecuCompleteness — KAPSAM OTORİTESİ (P0-OBD-FINAL-02 · P0-VDK-F6C).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── P0-VDK-F6C: İKİ GERÇEK, TEK OTORİTE ────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════
 * **“ECU'ları buldum” ile “ECU'ların arıza hafızalarını yeterince taradım”
 * AYNI ŞEY DEĞİLDİR.** F6-B'ye kadar bu iki gerçek YAN YANA duruyordu ve
 * üst seviye kapsam hükmü ikincisini HİÇ BİLMİYORDU: `canonicalCoverage`
 * yalnız (a) 4 standart FONKSİYONEL modun kaçı okundu ve (b) ECU'ların kaçı
 * tarandı çarpımıydı. UDS 0x19 ve KWP 0x18/0x13 kapsamı üst seviye sayıya
 * HİÇ GİRMİYORDU.
 *
 * F6-C bu dosyayı **ADDITIVE** genişletir; **paralel otorite KURULMADI**
 * (`diagnosticCompletenessEngine` / `vehicleCoverageAuthority` / `coverageTruthStore`
 * gibi bir şey YOKTUR). Kapsam artık İKİ EKSENLİDİR:
 *
 *   A) **UÇ NOKTA KAPSAMI**   — kaç uç nokta bulundu / adreslenebildi / tarandı
 *   B) **TANI KAPSAMI**       — her uç noktada planlanan salt-okunur DTC
 *                                kanallarının kaçı TERMİNAL kanıt aldı
 *
 * ── İKİ FARKLI BİLİNEBİLİRLİK (bu turun ana içgörüsü) ───────────────
 *  · “Bu araçta KAÇ ECU var?” → **BİLİNEMEZ.** Fonksiyonel `0100` yalnız
 *    cevap verenleri bilir. Bu yüzden `completenessPercent` (ARAÇ geneli
 *    iddiası) fail-closed olarak `null` KALIR — değişmedi.
 *  · “Planladığım kaç tanı kanalını gerçekten sorabildim?” → **TAM OLARAK
 *    BİLİNİR.** Payda bizim KENDİ planımızdır (`dtcCoveragePlan`).
 *
 * Bu yüzden F6-C iki AYRI oran üretir ve ikisini KARIŞTIRMAZ:
 * `measuredEndpointRatio` (ölçülen uç nokta kümesine GÖRE, kapsamlı iddia) ve
 * `diagnosticCoverageRatio` (plan birimlerine göre). “Araç tam taranmıştır”
 * iddiası hâlâ `denominatorKnown` olmadan ÜRETİLEMEZ.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 * Tanı kapsamı girdisi ÇAĞIRANDAN gelir (servis importı YOK).
 */

import type { DiscoveredEcu } from './ecuDiscovery';
import type { EcuAddressBits } from './ecuRoleModel';
import type {
  DtcCoverageAxis, DtcCoverageOutcome, EcuDtcCoverageVerdict,
} from './dtcCoveragePlan';
/* P0-VDK-F6C — kayıp kök nedeni MEVCUT F5-A sözlüğünden; kopya YOK. */
import type { RootCauseClass } from './healing/gapModel';

export type EcuCoverageStatus =
  | 'discovered' | 'probed' | 'scanned' | 'skipped' | 'failed' | 'not_addressable';
export type EcuDiscoverySource = 'functional_0100' | 'physical_probe' | 'gateway_inventory' | 'profile';
export type EcuProbeOutcome = 'responded' | 'no_response' | 'failed' | 'not_attempted';

export interface EcuCoverageCandidate extends DiscoveredEcu {
  discoverySource?: EcuDiscoverySource;
  probeOutcome?: EcuProbeOutcome;
}

export interface EcuCoverageEvidence {
  readonly ecuKey: string;
  readonly status: EcuCoverageStatus;
  readonly protocol: string | null;
  readonly rxHeader: string | null;
  readonly txHeader: string | null;
  readonly addressBits: EcuAddressBits | null;
  readonly discoverySources: readonly EcuDiscoverySource[];
  readonly probeOutcome: EcuProbeOutcome;
  readonly role: DiscoveredEcu['role'];
  readonly roleEvidence: DiscoveredEcu['roleEvidence'];
  readonly sessionEpoch: number;
}

export interface EcuCompletenessEvidence {
  readonly sessionEpoch: number;
  readonly staleSession: boolean;
  readonly discovered: number;
  readonly probed: number;
  readonly scanned: number;
  readonly skipped: number;
  readonly failed: number;
  readonly notAddressable: number;
  /**
   * ARAÇ GENELİ iddiası. Payda bilinmiyorsa `null`; fonksiyonel 0100 tek
   * başına payda sağlayamaz. **F6-C bu davranışı DEĞİŞTİRMEDİ** — “araç tam
   * tarandı” demek için araçtaki gerçek ECU sayısı BİLİNMELİDİR.
   */
  readonly completenessPercent: number | null;
  readonly completenessLabel: string;
  readonly denominatorKnown: boolean;
  /**
   * P0-VDK-F6C — **ÖLÇÜLEN uç nokta kümesine GÖRE** taranma oranı
   * (`scanned / (scanned+failed+skipped+notAddressable)`).
   *
   * `completenessPercent`ten FARKI kapsamın GENİŞLİĞİDİR, kesinliği değil:
   * bu oran “bulduğum uç noktaların ne kadarını taradım” der; “araçta başka
   * ECU var mı” sorusuna CEVAP VERMEZ. İkisi karıştırılamaz.
   * Hiç uç nokta ölçülmediyse `null` (sahte 0/1 YASAK).
   */
  readonly measuredEndpointRatio: number | null;
  /** P0-VDK-F6C — tanı kapsamı; çağıran kanıt vermediyse `null`. */
  readonly diagnostic: DiagnosticCompletenessEvidence | null;
  readonly evidence: readonly EcuCoverageEvidence[];
}

export interface BuildEcuCompletenessInput {
  candidates: readonly EcuCoverageCandidate[];
  scannedKeys?: ReadonlySet<string>;
  failedKeys?: ReadonlySet<string>;
  skippedKeys?: ReadonlySet<string>;
  notAddressableKeys?: ReadonlySet<string>;
  protocol: string | null;
  sessionEpoch: number;
  currentSessionEpoch: number;
  /** Yalnız gateway/üretici envanteri gerçek toplamı bildirmişse verilir. */
  expectedEcuCount?: number | null;
  /**
   * P0-VDK-F6C — F6-B'nin ÖLÇTÜĞÜ tanı kapsamı (`dtcCoverageEvidence`).
   * VERİLMEZSE bu dosya eskisi gibi davranır (`diagnostic: null`) — tek-ECU
   * akışı ve kimlik çözümü yolunda davranış regresyonu YOKTUR.
   *
   * SERVİS İMPORTU YOK: çağıran saf veri geçirir, bu dosya saf kalır.
   */
  diagnostic?: readonly DiagnosticEndpointInput[] | null;
}

export function ecuCoverageKey(e: Pick<DiscoveredEcu, 'rxHeader' | 'addressBits'>): string {
  return `${e.addressBits}:${e.rxHeader.replace(/\s+/g, '').toUpperCase()}`;
}

/** Aynı fiziksel adres farklı keşif yollarından gelirse tek kanıtta birleşir. */
export function buildEcuCompleteness(i: BuildEcuCompletenessInput): EcuCompletenessEvidence {
  const merged = new Map<string, { ecu: EcuCoverageCandidate; sources: Set<EcuDiscoverySource>; outcome: EcuProbeOutcome }>();
  for (const raw of i.candidates) {
    const key = ecuCoverageKey(raw);
    const source = raw.discoverySource ?? 'functional_0100';
    const outcome = raw.probeOutcome ?? 'responded';
    const old = merged.get(key);
    if (old) {
      old.sources.add(source);
      if (old.outcome !== 'responded' && outcome === 'responded') old.outcome = outcome;
    } else merged.set(key, { ecu: raw, sources: new Set([source]), outcome });
  }

  const staleSession = i.sessionEpoch !== i.currentSessionEpoch;
  const evidence: EcuCoverageEvidence[] = [];
  for (const [key, m] of merged) {
    let status: EcuCoverageStatus;
    if (staleSession || i.skippedKeys?.has(key)) status = 'skipped';
    else if (i.notAddressableKeys?.has(key)) status = 'not_addressable';
    else if (i.failedKeys?.has(key) || m.outcome === 'failed') status = 'failed';
    else if (i.scannedKeys?.has(key)) status = 'scanned';
    else if (m.outcome === 'responded' || m.outcome === 'no_response') status = 'probed';
    else status = 'discovered';
    evidence.push({
      ecuKey: key, status, protocol: i.protocol,
      rxHeader: m.ecu.rxHeader || null, txHeader: m.ecu.txHeader || null,
      addressBits: m.ecu.addressBits, discoverySources: [...m.sources].sort(),
      probeOutcome: m.outcome, role: m.ecu.role, roleEvidence: m.ecu.roleEvidence,
      sessionEpoch: i.sessionEpoch,
    });
  }
  evidence.sort((a, b) => a.ecuKey.localeCompare(b.ecuKey));

  const count = (s: EcuCoverageStatus) => evidence.filter((e) => e.status === s).length;
  const expected = i.expectedEcuCount;
  const denominatorKnown = typeof expected === 'number' && expected > 0 && expected >= evidence.length;
  const scanned = count('scanned');
  const skipped = count('skipped');
  const failed = count('failed');
  const notAddressable = count('not_addressable');

  /* ── P0-VDK-F6C · ÖLÇÜLEN UÇ NOKTA ORANI ──────────────────────
     `completenessPercent`ten AYRI bir sorudur ve AYRI bilinebilirliği vardır:
     "bulduğum uç noktaların ne kadarını taradım". Bu payda BİLİNİR (kendi
     ölçtüğüm küme). "Araçta başka ECU var mı" sorusuna CEVAP VERMEZ — o
     iddia hâlâ `denominatorKnown`a bağlıdır ve fail-closed kalır. */
  const measuredDenom = scanned + failed + skipped + notAddressable;
  const measuredEndpointRatio = measuredDenom === 0 ? null : scanned / measuredDenom;

  return {
    sessionEpoch: i.sessionEpoch, staleSession,
    discovered: evidence.length,
    probed: evidence.filter((e) => e.probeOutcome !== 'not_attempted').length,
    scanned, skipped, failed,
    notAddressable,
    completenessPercent: denominatorKnown ? Math.round((scanned / expected!) * 10_000) / 100 : null,
    completenessLabel: denominatorKnown ? `${Math.round((scanned / expected!) * 10_000) / 100}%` : 'UNKNOWN',
    denominatorKnown,
    /* Bayat oturumda oran ÜRETİLMEZ: başka bir oturumun sayısını bu tura
       yazmak, başka aracın kapsamını bu araca yazmak olurdu. */
    measuredEndpointRatio: staleSession ? null : measuredEndpointRatio,
    diagnostic: i.diagnostic === undefined || i.diagnostic === null
      ? null : buildDiagnosticCompleteness(i.diagnostic),
    evidence,
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   P0-VDK-F6C — TANI KAPSAMI (ikinci eksen · AYNI OTORİTE)
   ═══════════════════════════════════════════════════════════════════════ */

/** Bir uç noktanın tanı kapsamı — SAF VERİ (servis importı YOK). */
export interface DiagnosticEndpointInput {
  /** `ecuCoverageKey` ile AYNI anahtar — iki eksen ancak böyle birleşir. */
  readonly ecuKey: string;
  readonly coreVerdict: EcuDtcCoverageVerdict;
  readonly deepVerdict: EcuDtcCoverageVerdict;
  readonly corePlannedUnits: number;
  readonly coreTerminalUnits: number;
  readonly deepPlannedUnits: number;
  readonly deepTerminalUnits: number;
  /** Rolü çözülememiş uç nokta mu (F6-A sözleşmesi ölçümü). */
  readonly roleUnknown: boolean;
  /**
   * Ölçüm CANLI araçtan mı geldi (F4-C `isProductTrusted`)?
   * `false` → bu uç nokta ürün hükmünü TAM yapamaz.
   */
  readonly productTrusted: boolean;
  /** Hatta ÇIKAN istek sayısı. */
  readonly requestCount: number;
  /** Sınıf satırlarının sonuçları ve kök nedenleri (sayım için). */
  readonly rows: readonly {
    readonly axis: DtcCoverageAxis;
    readonly outcome: DtcCoverageOutcome;
    readonly gapRoot: RootCauseClass | null;
  }[];
}

/**
 * Tanı kapsamının ÜST HÜKMÜ.
 *
 * `COMPLETE` YALNIZ **ölçülen uç nokta kümesi için** verilir; “araç tam
 * tarandı” demek DEĞİLDİR (o iddia `denominatorKnown`a bağlıdır).
 */
export type DiagnosticCompletenessVerdict =
  /** Ölçülen her uç noktanın TEMEL ekseni terminal kanıta sahip. */
  | 'CORE_COMPLETE'
  /** En az bir uç noktada temel eksen okundu ama en az biri eksik. */
  | 'PARTIAL'
  /** Sorgu gitti, hiçbir uç noktada temel eksen okunamadı. */
  | 'UNKNOWN'
  /** Hiç sorgu gönderilmedi (bütçe · oturum · adres). */
  | 'DEFERRED'
  /** Hiç tanı kapsamı ölçülmedi — "0" DEĞİL, KAYNAK YOK. */
  | 'NOT_MEASURED';

export const DIAGNOSTIC_COMPLETENESS_LABEL:
Readonly<Record<DiagnosticCompletenessVerdict, string>> = {
  CORE_COMPLETE: 'ÖLÇÜLEN UÇ NOKTALARDA TEMEL KAPSAM TAM',
  PARTIAL:       'KISMİ TANI KAPSAMI',
  UNKNOWN:       'TANI KAPSAMI BİLİNMİYOR',
  DEFERRED:      'TANI SORGUSU GÖNDERİLMEDİ',
  NOT_MEASURED:  'TANI KAPSAMI HİÇ ÖLÇÜLMEDİ',
} as const;

export interface DiagnosticCompletenessEvidence {
  readonly verdict: DiagnosticCompletenessVerdict;
  /**
   * P0-VDK-F6C — kapsam hükmünün CANLI ölçümden gelip gelmediği.
   * `false` iken `verdict` ASLA `CORE_COMPLETE` olamaz.
   */
  readonly productTrusted: boolean;
  /** Kapsam kanıtı olan uç nokta sayısı. */
  readonly endpoints: number;
  /** En az bir istek GİDEN uç nokta. */
  readonly queriedEndpoints: number;
  readonly coreComplete: number;
  readonly deepComplete: number;
  /**
   * ── BİRİM SAYIMI (yüzdenin TEK temeli) ────────────────────────
   * PAZARLIKSIZ: **her planlanan sınıf 1 BİRİMDİR.** Bir servisin 50 DTC
   * döndürmesi 50 puan KAZANDIRMAZ; 20 DTC'li ECU ile 0 DTC'li ECU AYNI
   * ağırlıktadır. **DTC SAYISI yüzdeye GİRMEZ.**
   * Plan dışı (`NOT_APPLICABLE`) ve engelli (`BLOCKED`) sınıflar PAYDAYA
   * GİRMEZ — “PLAN DIŞI ≠ SORULAMADI”.
   */
  readonly corePlannedUnits: number;
  readonly coreTerminalUnits: number;
  readonly deepPlannedUnits: number;
  readonly deepTerminalUnits: number;
  /** `coreTerminalUnits / corePlannedUnits`; payda 0 ise `null`. */
  readonly coreCoverageRatio: number | null;
  /** `deepTerminalUnits / deepPlannedUnits`; payda 0 ise `null`. */
  readonly deepCoverageRatio: number | null;
  /** Yüzde metni ya da `UNKNOWN` (sahte 0 YASAK). */
  readonly coreCoverageLabel: string;
  /** İnsan-okur formül — LAB bunu ELLE yazmaz. */
  readonly formula: string;
  /**
   * ARAÇ KUSURU OLMAYAN kayıplar AYRI sayılır (§10/§11):
   * `TRANSPORT_BOUND` bizim köprü/kapı sınırımız, `PARSER_BOUND` bizim
   * çözücü borcumuzdur. İkisi de aracin kusuru DEĞİLDİR.
   */
  readonly transportLimitedUnits: number;
  readonly parserGapUnits: number;
  readonly sessionGapUnits: number;
  /** Ölçümle KAPANABİLECEK kayıp birimi (F6-D için temiz girdi). */
  readonly measurableGapUnits: number;
  /** Plan dışı (protokol uyuşmazlığı) — eksiklik DEĞİLDİR. */
  readonly outOfPlanUnits: number;
  /** Rolü BİLİNMEYEN ama yine de sorgulanan uç nokta (F6-A sözleşmesi). */
  readonly unknownRoleQueried: number;
  /** Kök neden sayımı — yalnız GERÇEKTEN oluşan sınıflar anahtar alır. */
  readonly gapRoots: Readonly<Partial<Record<RootCauseClass, number>>>;
}

const _EMPTY_DIAGNOSTIC: DiagnosticCompletenessEvidence = Object.freeze({
  verdict: 'NOT_MEASURED' as const,
  productTrusted: false,
  endpoints: 0, queriedEndpoints: 0, coreComplete: 0, deepComplete: 0,
  corePlannedUnits: 0, coreTerminalUnits: 0, deepPlannedUnits: 0, deepTerminalUnits: 0,
  coreCoverageRatio: null, deepCoverageRatio: null, coreCoverageLabel: 'UNKNOWN',
  formula: 'kanıt yok — tanı kapsamı HİÇ ölçülmedi',
  transportLimitedUnits: 0, parserGapUnits: 0, sessionGapUnits: 0,
  measurableGapUnits: 0, outOfPlanUnits: 0, unknownRoleQueried: 0,
  gapRoots: Object.freeze({}),
});

/**
 * P0-VDK-F6C — tanı kapsamını tek hükme indirir (SAF · DETERMİNİSTİK).
 *
 * FAIL-CLOSED: `CORE_COMPLETE` ancak **ölçülen HER uç nokta** temel eksende
 * terminal kanıta sahipse. Tek bir `UNKNOWN`/`DEFERRED`/`PARTIAL` uç nokta
 * bile hükmü düşürür. `NOT_ADDRESSABLE` bir uç nokta kapsam KAYBIDIR.
 *
 * `deep` ekseni hükmü **DÜŞÜRMEZ**: `19-04` yapısal olarak kapalı olduğu
 * için temel kapsamı sonsuza dek kısmi göstermek, ölçülmemiş bir eksikliği
 * ölçülmüş gibi sunmak olurdu.
 */
export function buildDiagnosticCompleteness(
  endpoints: readonly DiagnosticEndpointInput[] | null | undefined,
): DiagnosticCompletenessEvidence {
  if (endpoints === null || endpoints === undefined || endpoints.length === 0) {
    return _EMPTY_DIAGNOSTIC;
  }

  let corePlanned = 0, coreTerminal = 0, deepPlanned = 0, deepTerminal = 0;
  let transportLimited = 0, parserGap = 0, sessionGap = 0, measurable = 0, outOfPlan = 0;
  const gapRoots: Partial<Record<RootCauseClass, number>> = {};

  for (const e of endpoints) {
    corePlanned  += e.corePlannedUnits;
    coreTerminal += e.coreTerminalUnits;
    deepPlanned  += e.deepPlannedUnits;
    deepTerminal += e.deepTerminalUnits;
    for (const r of e.rows) {
      if (r.outcome === 'NOT_APPLICABLE') { outOfPlan++; continue; }
      if (r.outcome === 'BLOCKED')        { transportLimited++; }
      if (r.gapRoot === null) continue;
      gapRoots[r.gapRoot] = (gapRoots[r.gapRoot] ?? 0) + 1;
      if (r.gapRoot === 'PARSER_BOUND')        parserGap++;
      else if (r.gapRoot === 'SESSION_CONDITIONED') { sessionGap++; measurable++; }
      /* `TRANSPORT_BOUND` ölçümle kapanmaz (köprü/kapı sınırı), `PARSER_BOUND`
         de kapanmaz (yazılım borcu — `isMeasurementResolvable === false`). */
      else if (r.gapRoot === 'CAPABILITY_UNMEASURED' || r.gapRoot === 'CAPABILITY_STALE'
               || r.gapRoot === 'CAPABILITY_CONTESTED') measurable++;
    }
  }

  const coreComplete = endpoints.filter((e) => e.coreVerdict === 'COMPLETE').length;
  const deepComplete = endpoints.filter((e) => e.deepVerdict === 'COMPLETE').length;
  const queried = endpoints.filter((e) => e.requestCount > 0).length;

  const coreRatio = corePlanned === 0 ? null : coreTerminal / corePlanned;
  const deepRatio = deepPlanned === 0 ? null : deepTerminal / deepPlanned;

  /* ── HÜKÜM (FAIL-CLOSED) ─────────────────────────────────── */
  /* ── KÖKEN KAPISI ────────────────────────────────────────
     Tek bir replay/sentetik uç nokta bile TAM hükmünü engeller: masa
     başında oynatılan bir iz, sahada tam taranmış bir araç SAYILAMAZ.
     Kural F4-C `isProductTrusted` ile aynı ilkedir. */
  const productTrusted = endpoints.every((e) => e.productTrusted);

  let verdict: DiagnosticCompletenessVerdict;
  if (queried === 0) {
    verdict = 'DEFERRED';
  } else if (coreComplete === endpoints.length && productTrusted) {
    verdict = 'CORE_COMPLETE';
  } else if (coreComplete > 0) {
    verdict = 'PARTIAL';
  } else {
    verdict = 'UNKNOWN';
  }

  return {
    verdict, productTrusted,
    endpoints: endpoints.length,
    queriedEndpoints: queried,
    coreComplete, deepComplete,
    corePlannedUnits: corePlanned, coreTerminalUnits: coreTerminal,
    deepPlannedUnits: deepPlanned, deepTerminalUnits: deepTerminal,
    coreCoverageRatio: coreRatio, deepCoverageRatio: deepRatio,
    coreCoverageLabel: coreRatio === null
      ? 'UNKNOWN' : `${Math.round(coreRatio * 10_000) / 100}%`,
    /* Formül AÇIKTIR: kullanıcı/geliştirici sayının nereden geldiğini
       görebilmeli. DTC SAYISI formülde YOKTUR. */
    formula: `TEMEL = terminal birim / planlanan birim = ${coreTerminal}/${corePlanned}`
      + ` (plan dışı ${outOfPlan} · köprü/kapı sınırı ${transportLimited} paydaya GİRMEZ)`,
    transportLimitedUnits: transportLimited,
    parserGapUnits: parserGap,
    sessionGapUnits: sessionGap,
    measurableGapUnits: measurable,
    outOfPlanUnits: outOfPlan,
    unknownRoleQueried: endpoints.filter((e) => e.roleUnknown && e.requestCount > 0).length,
    gapRoots,
  };
}
