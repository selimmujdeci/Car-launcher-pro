/**
 * conformanceRun — P0-VDK-F2C2 · UYGUNLUK KOŞUSU (canlı ↔ FAST ↔ TIMED).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F2-B replay'i, F2-C1 kanonik çözümleyiciyi getirdi. Ama üçü ayrı ayrı
 * yeşildi ve **hiçbir yerde TEK bir koşuda uçtan uca doğrulanmıyordu**:
 *
 *   gerçek tur → export → import → FAST replay → TIMED replay
 *
 * Bu zincir tek koşuda çalışmadığı sürece "aynı ham baytlar aynı ürün
 * sonucunu veriyor" cümlesi bir İDDİAdır, ölçüm değil. Bir saha izinin
 * masada güvenilir biçimde yeniden oynatılabildiğini ancak bu koşu kanıtlar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ TANI/OTURUM/RECOVERY OTORİTESİ DEĞİLDİR.** Kendi başına hiçbir
 *     tarama başlatmaz; ürünün NORMAL yolunu ÇAĞIRAN taraf enjekte eder.
 * (2) **İKİNCİ PARİTE SÖZLÜĞÜ DEĞİLDİR.** Karşılaştırma MEVCUT
 *     `replayParity.compareParity` ile yapılır; katman sözlüğü de onundur.
 * (3) **SELF-HEALING DEĞİLDİR.** Eksik ölçüm yalnız `gapRegistry`ye
 *     YAPILANDIRILMIŞ sinyal olarak yazılır; hiçbir boşluk otomatik kapatılmaz.
 * (4) **DESTRUCTIVE İŞLEM YAPMAZ.** Silme · kodlama · adaptasyon YOKTUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: ÜÇ SONUÇ, UYDURMA YOK ────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Her denetim yalnız `MATCH` · `MISMATCH` · `UNMEASURED` olabilir.
 * "Muhtemelen aynı", "önemsiz fark", "büyük ihtimalle ölçülmüştür" YOKTUR.
 *
 * `PASS` **yalnız** sıfır `MISMATCH` **ve** sıfır `UNMEASURED` ile verilir.
 * Ölçülmemiş bir alan bir başarı değildir — koşu `INCOMPLETE` kalır.
 *
 * SAF DEĞİL (koşu yürütür) ama I/O YAPMAZ · timer YOKTUR ·
 * `Date.now`/`Math.random` YOKTUR — saat, kimlik ve ürün yolu ENJEKTE EDİLİR.
 */

import type { TraceEvent } from './canonicalTrace';
import { buildTracePackage, importTracePackage } from './traceExport';
import {
  compareParity, rootMismatchLayer,
  type ParityLayer, type ParityResult, type ParitySnapshot,
} from './replayParity';
import type { ReplayGapSignal } from './virtualTransport';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek bir denetimin sonucu — ÜÇ değer, dördüncüsü YOK. */
export type ConformanceOutcome =
  /** İki ölçüm karşılaştırıldı ve AYNI. */
  | 'MATCH'
  /** İki ölçüm karşılaştırıldı ve FARKLI. */
  | 'MISMATCH'
  /** Karşılaştırılacak ölçüm YOK — "aynı" DEMEK DEĞİL. */
  | 'UNMEASURED';

export const CONFORMANCE_OUTCOME_LABEL: Readonly<Record<ConformanceOutcome, string>> = {
  MATCH:      'ölçümler AYNI',
  MISMATCH:   'ölçümler FARKLI',
  UNMEASURED: 'ÖLÇÜM YOK — "aynı" sayılmaz',
} as const;

/** Koşunun hangi aşamada olduğunu söyler; `null` = aşama hiç çalışmadı. */
export type ConformanceStage =
  | 'LIVE'
  | 'EXPORT'
  | 'IMPORT'
  | 'REPLAY_FAST'
  | 'REPLAY_TIMED'
  | 'COMPARE';

/** Koşuyu yürütememe sebebi — sessiz başarısızlık YASAK. */
export type ConformanceAbort =
  | 'LIVE_NO_TRACE'
  | 'EXPORT_REJECTED'
  | 'IMPORT_REJECTED'
  | 'REPLAY_FAST_REJECTED'
  | 'REPLAY_TIMED_REJECTED';

export const CONFORMANCE_ABORT_LABEL: Readonly<Record<ConformanceAbort, string>> = {
  LIVE_NO_TRACE:        'canlı tur HİÇ iz üretmedi — karşılaştırılacak ölçüm yok',
  EXPORT_REJECTED:      'iz paketi üretilemedi (maskeleme/bütünlük kapısı)',
  IMPORT_REJECTED:      'iz paketi içe aktarılamadı (checksum/şema/sıra)',
  REPLAY_FAST_REJECTED: 'FAST replay koşusu açılamadı',
  REPLAY_TIMED_REJECTED: 'TIMED replay koşusu açılamadı',
} as const;

export interface ConformanceCheck {
  readonly id: string;
  readonly label: string;
  readonly outcome: ConformanceOutcome;
  readonly layer: ParityLayer;
  /** Fark ya da ölçüm yokluğunun ölçülmüş gerekçesi. */
  readonly detail: string | null;
}

export type ConformanceVerdict =
  /** Sıfır MISMATCH ve sıfır UNMEASURED. */
  | 'PASS'
  /** En az bir MISMATCH — açıklanamayan fark. */
  | 'FAIL'
  /** Fark yok ama en az bir alan ÖLÇÜLMEDİ. */
  | 'INCOMPLETE'
  /** Koşu yürütülemedi. */
  | 'ABORTED';

export const CONFORMANCE_VERDICT_LABEL: Readonly<Record<ConformanceVerdict, string>> = {
  PASS:       'UYGUN — sıfır açıklanamayan fark, her alan ölçüldü',
  FAIL:       'UYGUN DEĞİL — açıklanamayan fark var',
  INCOMPLETE: 'EKSİK — fark yok ama ölçülmeyen alan var (PASS DEĞİL)',
  ABORTED:    'KOŞU YÜRÜTÜLEMEDİ',
} as const;

/**
 * Koşunun KANIT KAYNAĞI — saha kanıtı ile masa başı simülasyonu ASLA karışmaz.
 *
 * Bu alan bir etiket değil, bir SÖZLEŞMEDİR: `FIELD` yalnız gerçek araçtan
 * alınmış bir iz paketiyle koşulduğunda kullanılabilir. Simülasyon koşusunun
 * `PASS` vermesi saha doğrulaması SAYILMAZ.
 */
export type ConformanceProvenance =
  /** Gerçek araçtan alınmış, içe aktarılmış iz paketi. */
  | 'FIELD'
  /** Masa başı/mock ürettiği iz — saha kanıtı DEĞİLDİR. */
  | 'SIMULATED';

export const CONFORMANCE_PROVENANCE_LABEL: Readonly<Record<ConformanceProvenance, string>> = {
  FIELD:     'GERÇEK ARAÇ izi (saha kanıtı)',
  SIMULATED: 'MASA BAŞI simülasyonu — SAHA KANITI DEĞİL',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) HARNESS — ürün yolu ENJEKTE EDİLİR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Koşunun ürünle temas ettiği TEK yüzey.
 *
 * ⚠️ Bu modül hiçbir tarama BAŞLATMAZ ve hiçbir otorite kurmaz — `runScan`
 * ürünün NORMAL yoludur ve çağıran tarafından verilir. Böylece aynı koşu hem
 * testte hem (gelecekte) cihazda AYNI kodla yürür.
 */
export interface ConformanceHarness {
  /** Ürünün normal tanı turunu koşar (canlı ya da replay altında). */
  readonly runScan: () => Promise<void>;
  /** Turdan sonra karşılaştırılabilir ölçümü toplar. */
  readonly captureSnapshot: () => ParitySnapshot;
  /** Bu süreçteki kanonik iz olayları. */
  readonly captureTrace: () => readonly TraceEvent[];
  /** Düşürülen olay sayısı (kırpma muhasebesi). */
  readonly droppedCount: () => number;
  /** Ürünün tur-içi defterlerini sıfırlar (iz HARİÇ). */
  readonly resetProductState: () => void;
  /** Kanonik iz defterini sıfırlar ve yeni iz kimliği verir. */
  readonly resetTrace: (traceId: string) => void;
  /** Replay koşusunu açar; `false` = açılamadı. */
  readonly startReplay: (events: readonly TraceEvent[], mode: 'FAST' | 'TIMED', runId: string) => boolean;
  /** Replay koşusunu kapatır ve boşluk sinyallerini döner. */
  readonly stopReplay: () => readonly ReplayGapSignal[];
}

export interface ConformanceInput {
  readonly harness: ConformanceHarness;
  /** Koşu kimliği — ENJEKTE edilir (`Math.random` YOK). */
  readonly runId: string;
  /** Duvar saati damgası; ölçülemiyorsa `null` (sahte tarih YASAK). */
  readonly generatedAtWallMs: number | null;
  /**
   * Kanıt kaynağı. `FIELD` demek bir İDDİAdır: çağıran, izin gerçek araçtan
   * geldiğini garanti eder. Varsayılan `SIMULATED` — fail-closed.
   */
  readonly provenance?: ConformanceProvenance;
}

export interface ConformanceRunResult {
  readonly runId: string;
  readonly provenance: ConformanceProvenance;
  readonly verdict: ConformanceVerdict;
  readonly checks: readonly ConformanceCheck[];
  /** Koşunun ulaştığı son aşama. */
  readonly stage: ConformanceStage;
  readonly abort: ConformanceAbort | null;
  readonly abortDetail: string | null;
  /** Kaynak izin kimliği ve olay sayısı. */
  readonly sourceTraceId: string | null;
  readonly sourceEventCount: number;
  /** Paketin checksum'ı — aynı koşu aynı paketi ürettiğinin kanıtı. */
  readonly packageChecksum: string | null;
  /** Fark bulunan katmanlar, kök nedene en yakın ÖNCE. */
  readonly mismatchLayers: readonly ParityLayer[];
  /** Replay koşularının ürettiği yapısal boşluk sinyalleri. */
  readonly gapSignals: readonly ReplayGapSignal[];
  readonly counts: {
    readonly match: number;
    readonly mismatch: number;
    readonly unmeasured: number;
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DENETİM ÜRETİMİ
   ══════════════════════════════════════════════════════════════════════════ */

/** Denetim kimliği → insan okunur etiket. Sıra RAPORDA da korunur. */
const CHECK_LABEL: Readonly<Record<string, string>> = {
  'transport.requests':          'ham istek sırası',
  'transport.responses':         'ham yanıt sırası',
  'transport.transportOutcomes': 'taşıma sonuçları',
  'transport.nrcs':              'NRC dizisi',
  'session.sessionOutcomes':     'oturum açılış sonuçları',
  'session.testerPresentOutcomes': 'TesterPresent sonuçları',
  'transport.tuningOutcomes':    'ISO-TP tuning sonuçları',
  'transport.tuningRestoreOutcomes': 'ISO-TP restore sonuçları',
  'parser.functionalProvenance': 'fonksiyonel çözüm kaynağı',
  'parser.functionalOutcomes':   'fonksiyonel çözüm sonuçları',
  'parser.functionalCodeIdentities': 'fonksiyonel DTC künyeleri',
  'parser.parserDtcCount':       'çözülen DTC adedi',
  'parser.parserDtcIdentities':  'DTC + alt kod künyeleri',
  'authority.authorityDtcCount': 'otorite kayıt adedi',
  'authority.authorityDtcIdentities': 'otorite DTC künyeleri',
  'verdict.coverage':            'kapsam',
  'verdict.verdict':             'hüküm',
};

/** Bir alanın hangi katmana ait olduğu — `replayParity` ile AYNI eşleme. */
function layerOf(id: string): ParityLayer {
  const p = id.split('.')[0];
  return p === 'transport' ? 'TRANSPORT'
    : p === 'session' ? 'SESSION'
      : p === 'parser' ? 'PARSER'
        : p === 'authority' ? 'AUTHORITY'
          : p === 'verdict' ? 'VERDICT' : 'UNKNOWN';
}

/**
 * Bir alanın ÖLÇÜLÜP ölçülmediğini söyler.
 *
 * ⚠️ Boş dizi ile ölçülmemişlik AYRI ŞEYLERDİR: bir taramada hiç
 * TesterPresent gönderilmemiş olabilir (boş dizi = GERÇEK ölçüm: "hiç
 * gönderilmedi"), ama alan `undefined` ise ölçüm HİÇ YAPILMAMIŞTIR.
 * İkisini karıştırmak, ölçülmemiş bir alanı "aynı" saymak demektir.
 */
function measured(a: unknown, b: unknown): boolean {
  return a !== undefined && b !== undefined && a !== null && b !== null;
}

function _fieldsOf(s: ParitySnapshot): Record<string, unknown> {
  return {
    'transport.requests': s.requests,
    'transport.responses': s.responses,
    'transport.transportOutcomes': s.transportOutcomes,
    'transport.nrcs': s.nrcs,
    'session.sessionOutcomes': s.sessionOutcomes,
    'session.testerPresentOutcomes': s.testerPresentOutcomes,
    'transport.tuningOutcomes': s.tuningOutcomes,
    'transport.tuningRestoreOutcomes': s.tuningRestoreOutcomes,
    'parser.functionalProvenance': s.functionalProvenance,
    'parser.functionalOutcomes': s.functionalOutcomes,
    'parser.functionalCodeIdentities': s.functionalCodeIdentities,
    'parser.parserDtcCount': s.parserDtcCount,
    'parser.parserDtcIdentities': s.parserDtcIdentities,
    'authority.authorityDtcCount': s.authorityDtcCount,
    'authority.authorityDtcIdentities': s.authorityDtcIdentities,
    'verdict.coverage': s.coverage,
    'verdict.verdict': s.verdict,
  };
}

/**
 * İki ölçümü alan alan denetler.
 *
 * Fark ayrıntısı MEVCUT `compareParity` sonucundan alınır — ikinci bir fark
 * tarifi ÜRETİLMEZ (iki yerde tutulan bir açıklama, birinin eskimesi demektir).
 */
function buildChecks(
  real: ParitySnapshot, replay: ParitySnapshot, parity: ParityResult,
  prefix: string,
): ConformanceCheck[] {
  const rf = _fieldsOf(real);
  const pf = _fieldsOf(replay);
  const out: ConformanceCheck[] = [];

  for (const id of Object.keys(CHECK_LABEL)) {
    const label = `${prefix}${CHECK_LABEL[id]!}`;
    const layer = layerOf(id);

    if (!measured(rf[id], pf[id])) {
      out.push({
        id: `${prefix}${id}`, label, outcome: 'UNMEASURED', layer,
        detail: rf[id] === undefined && pf[id] === undefined
          ? 'iki tarafta da ölçülmedi'
          : rf[id] === undefined ? 'canlı turda ölçülmedi' : 'replay turunda ölçülmedi',
      });
      continue;
    }

    /* `compareParity` alan adını `field` olarak taşır; dizi farkları
       `alan[i]` biçiminde gelir → önek eşlemesiyle eşleştirilir. */
    const short = id.split('.')[1]!;
    const hits = parity.mismatches.filter(
      (m) => m.field === short || m.field.startsWith(`${short}[`),
    );
    out.push(hits.length === 0
      ? { id: `${prefix}${id}`, label, outcome: 'MATCH', layer, detail: null }
      : {
        id: `${prefix}${id}`, label, outcome: 'MISMATCH', layer,
        detail: hits.slice(0, 4).map((m) => m.detail).join(' · '),
      });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KOŞU
   ══════════════════════════════════════════════════════════════════════════ */

function _abort(
  input: ConformanceInput, stage: ConformanceStage,
  abort: ConformanceAbort, detail: string,
  sourceTraceId: string | null, sourceEventCount: number,
): ConformanceRunResult {
  return {
    runId: input.runId,
    provenance: input.provenance ?? 'SIMULATED',
    verdict: 'ABORTED', checks: [], stage, abort, abortDetail: detail,
    sourceTraceId, sourceEventCount, packageChecksum: null,
    mismatchLayers: [], gapSignals: [],
    counts: { match: 0, mismatch: 0, unmeasured: 0 },
  };
}

/**
 * Uygunluk koşusunu yürütür:
 *
 *   1. CANLI tur (ürünün normal yolu) → kanonik iz
 *   2. EXPORT  → `caros.vdk.tracepkg.v1` (checksum'lı)
 *   3. IMPORT  → fail-closed doğrulama (`provenance: 'imported'`)
 *   4. FAST replay  → aynı ürün yolu, bekleme yok
 *   5. TIMED replay → aynı ürün yolu, izdeki gecikme yeniden üretilir
 *   6. KARŞILAŞTIR → canlı↔FAST ve FAST↔TIMED
 *
 * `FAST` ile `TIMED` ayrıca karşılaştırılır: zamanlama modunun ürün sonucunu
 * DEĞİŞTİRMEDİĞİ ancak bu şekilde kanıtlanır. Aksi hâlde "iki mod da geçti"
 * demek, ikisinin AYNI şeyi ürettiğini göstermez.
 */
export async function runConformance(input: ConformanceInput): Promise<ConformanceRunResult> {
  const { harness: h, runId } = input;
  const provenance = input.provenance ?? 'SIMULATED';

  /* ── 1) CANLI TUR ──────────────────────────────────────────────────────── */
  h.resetProductState();
  h.resetTrace(`${runId}-live`);
  await h.runScan();
  const liveSnapshot = h.captureSnapshot();
  const liveEvents = h.captureTrace();
  const dropped = h.droppedCount();

  if (liveEvents.length === 0) {
    return _abort(input, 'LIVE', 'LIVE_NO_TRACE',
      CONFORMANCE_ABORT_LABEL.LIVE_NO_TRACE, null, 0);
  }
  const sourceTraceId = liveEvents[0]!.traceId;

  /* ── 2) EXPORT ─────────────────────────────────────────────────────────── */
  const pkg = buildTracePackage(liveEvents, dropped, sourceTraceId, input.generatedAtWallMs);
  if (!pkg.ok) {
    return _abort(input, 'EXPORT', 'EXPORT_REJECTED',
      `${pkg.rejection}: ${pkg.detail}`, sourceTraceId, liveEvents.length);
  }

  /* ── 3) IMPORT ─────────────────────────────────────────────────────────── */
  const imported = importTracePackage(pkg.body);
  if (!imported.ok) {
    return _abort(input, 'IMPORT', 'IMPORT_REJECTED',
      `${imported.rejection}: ${imported.detail}`, sourceTraceId, liveEvents.length);
  }

  const gaps: ReplayGapSignal[] = [];
  const addGaps = (list: readonly ReplayGapSignal[]): void => {
    for (const g of list) if (!gaps.includes(g)) gaps.push(g);
  };

  /* ── 4) FAST REPLAY ────────────────────────────────────────────────────── */
  h.resetProductState();
  h.resetTrace(`${runId}-fast`);
  if (!h.startReplay(imported.events, 'FAST', `${runId}-fast`)) {
    return _abort(input, 'REPLAY_FAST', 'REPLAY_FAST_REJECTED',
      CONFORMANCE_ABORT_LABEL.REPLAY_FAST_REJECTED, sourceTraceId, liveEvents.length);
  }
  await h.runScan();
  const fastSnapshot = h.captureSnapshot();
  addGaps(h.stopReplay());

  /* ── 5) TIMED REPLAY ───────────────────────────────────────────────────── */
  h.resetProductState();
  h.resetTrace(`${runId}-timed`);
  if (!h.startReplay(imported.events, 'TIMED', `${runId}-timed`)) {
    return _abort(input, 'REPLAY_TIMED', 'REPLAY_TIMED_REJECTED',
      CONFORMANCE_ABORT_LABEL.REPLAY_TIMED_REJECTED, sourceTraceId, liveEvents.length);
  }
  await h.runScan();
  const timedSnapshot = h.captureSnapshot();
  addGaps(h.stopReplay());

  /* ── 6) KARŞILAŞTIR ────────────────────────────────────────────────────── */
  const liveVsFast = compareParity(liveSnapshot, fastSnapshot);
  const fastVsTimed = compareParity(fastSnapshot, timedSnapshot);
  const checks = [
    ...buildChecks(liveSnapshot, fastSnapshot, liveVsFast, 'canlı↔FAST · '),
    ...buildChecks(fastSnapshot, timedSnapshot, fastVsTimed, 'FAST↔TIMED · '),
  ];

  const match = checks.filter((c) => c.outcome === 'MATCH').length;
  const mismatch = checks.filter((c) => c.outcome === 'MISMATCH').length;
  const unmeasured = checks.filter((c) => c.outcome === 'UNMEASURED').length;

  /* PASS YALNIZ sıfır fark VE sıfır ölçülmemiş alanla verilir. Ölçülmemiş bir
     alanı "sorun yok" saymak, tam da bu koşunun engellemek için var olduğu
     yalandır. */
  const verdict: ConformanceVerdict =
    mismatch > 0 ? 'FAIL' : unmeasured > 0 ? 'INCOMPLETE' : 'PASS';

  const layers: ParityLayer[] = [];
  for (const r of [liveVsFast, fastVsTimed]) {
    const root = rootMismatchLayer(r);
    if (root !== null && !layers.includes(root)) layers.push(root);
  }

  return {
    runId, provenance, verdict, checks,
    stage: 'COMPARE', abort: null, abortDetail: null,
    sourceTraceId, sourceEventCount: liveEvents.length,
    packageChecksum: pkg.pkg.manifest.checksum,
    mismatchLayers: layers,
    gapSignals: gaps,
    counts: { match, mismatch, unmeasured },
  };
}
