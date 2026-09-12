/**
 * coverageLearning — P0-VDK-F6E · TANI KAPSAMI → MEVCUT F4-C ÖĞRENMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KÖK NEDEN ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F4-C öğrenmesinin ÜRETİMDEKİ TEK yazıcısı `discovery/serviceDiscoveryRuntime`ti
 * (`recordCapabilityObservation`, tek çağrı). Yani ürünün **ANA tanı yolu**
 * (Mode 03/07/0A · UDS 0x19-xx · KWP 0x18/0x13) her taramada onlarca güvenilir
 * ölçüm üretiyor ve **hiçbiri öğrenilmiyordu**. Aynı araca ikinci kez bağlanan
 * CarOS, dün kanıtlanmış "bu ECU bu servisi bilmiyor" gerçeğini yeniden ölçmek
 * zorunda kalıyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE DEĞİLDİR (pazarlıksız) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Öğrenme motoru DEĞİL · sicil DEĞİL · veritabanı DEĞİL · ikinci truth source
 * DEĞİL · healing DEĞİL. **Yeni parmak izi sistemi İCAT ETMEZ.**
 *
 * Yaptığı tek şey ÇEVİRİDİR:
 *   kapsam satırı → MEVCUT `CapabilityObservationInput` → MEVCUT
 *   `recordCapabilityObservation` (F4-C `mergeCapabilityObservation` politikası)
 *
 * ve TERS YÖNDE:
 *   MEVCUT `CapabilityEdge` + MEVCUT `decideReuse` → plan girdisi
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖĞRENME ASLA HÜKÜM YAZMAZ ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu dosyadan `COMPLETE` · `clean` · "DTC yok" · destructive aday ·
 * oturum/taşıma override **ÇIKAMAZ**. Öğrenme yalnız **bir sonraki taramanın
 * neyi ölçmesi gerektiğini** iyileştirir; kesin hüküm hâlâ o turun GERÇEK
 * ölçüm kanıtından doğar (`dtcCoverageEvidence` → `ecuCompleteness` →
 * `dtcAuthority`).
 */

import {
  decideReuse, isProductTrusted,
  type CapabilityEdge, type CapabilityObservationInput, type CapabilityProvenance,
  type ReuseContext, type TransportConstraint,
} from './capabilityGraph';
import { NRC_SERVICE_NOT_SUPPORTED, type ServicePresence } from '../ecuCapabilityModel';
import type { RootCauseClass } from '../healing/gapModel';
import type { DtcCoverageOutcome } from '../dtcCoveragePlan';

/* ══════════════════════════════════════════════════════════════════════════
   1) GİRDİ — kapsam defterinin SAF görünümü (servis importu YOK)
   ══════════════════════════════════════════════════════════════════════════ */

export interface CoverageLearningRow {
  readonly service: string;
  readonly subFunction: string | null;
  readonly outcome: DtcCoverageOutcome;
  /** `advancedDtcEvidence` sözlüğündeki ölçüm sonucu; sorgu gitmediyse `null`. */
  readonly measuredOutcome: string | null;
  /**
   * ÖLÇÜLEN negatif yanıt kodu. **`ABSENT` öğrenmenin TEK anahtarıdır.**
   * Ölçülmediyse `null` — sahte 0 YASAK.
   */
  readonly nrc: number | null;
  readonly gapRoot: RootCauseClass | null;
  readonly requestCount: number;
}

export interface CoverageLearningEndpoint {
  /** `ecuCoverageKey` biçimi (`<addressBits>:<rxHeader>`). */
  readonly ecuKey: string;
  readonly protocol: string | null;
  readonly provenance: CapabilityProvenance;
  readonly atMs: number;
  readonly evidenceRef: string | null;
  readonly rows: readonly CoverageLearningRow[];
}

export interface CoverageLearningContext {
  /** Aktif araç referansı; `null` → hiçbir şey öğrenilmez (kimliksiz yazım YASAK). */
  readonly vehicleRef: string | null;
  readonly transport: TransportConstraint;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) NEDEN ÖĞRENİLEMEDİ — kapalı sözlük
   ══════════════════════════════════════════════════════════════════════════ */

export type CoverageLearningRejection =
  /** Hatta tek bayt çıkmadı ya da sonuç ölçülmedi. */
  | 'NOT_MEASURED'
  /** Sonuç terminal değil (UNKNOWN · PARTIAL · DEFERRED). */
  | 'NOT_TERMINAL'
  /** replay/synthetic/imported — masa başı kanıt saha gerçeği SAYILMAZ. */
  | 'NOT_PRODUCT_TRUSTED'
  /** Çözücü borcu — ARAÇ hakkında hiçbir şey öğretmez. */
  | 'PARSER_BOUND'
  /** Köprü/kapı sınırı — **"araç desteklemiyor" DEĞİLDİR.** */
  | 'TRANSPORT_BOUND'
  /** Oturum/koşul reddi — tek başına kesin yetenek bilgisi DEĞİLDİR. */
  | 'SESSION_CONDITIONED'
  /** Ürün sınırı (19-04 gibi) — araç ölçümü değil. */
  | 'PRODUCT_LIMIT'
  /** Plan dışı (protokol ailesi uymuyor) — eksiklik de bilgi de değil. */
  | 'OUT_OF_PLAN'
  /** "Servis yok" demek için ÖLÇÜLMÜŞ NRC 0x11 ŞARTTIR. */
  | 'ABSENT_WITHOUT_NRC11'
  /** Araç kimliği yok — kimliksiz öğrenme başka araca sızabilirdi. */
  | 'NO_VEHICLE_IDENTITY';

export const COVERAGE_LEARNING_REJECTION_LABEL:
Readonly<Record<CoverageLearningRejection, string>> = {
  NOT_MEASURED:         'ölçüm yok',
  NOT_TERMINAL:         'terminal sonuç değil',
  NOT_PRODUCT_TRUSTED:  'kanıt CANLI değil (replay/sentetik/içe aktarılmış)',
  PARSER_BOUND:         'ÇÖZÜCÜ sınırı — araç hakkında bilgi DEĞİL',
  TRANSPORT_BOUND:      'TAŞIMA sınırı — "araç desteklemiyor" DEĞİL',
  SESSION_CONDITIONED:  'oturuma bağlı — kesin yetenek DEĞİL',
  PRODUCT_LIMIT:        'ürün/kapı sınırı — araç ölçümü değil',
  OUT_OF_PLAN:          'plan dışı (protokol ailesi)',
  ABSENT_WITHOUT_NRC11: 'yokluk iddiası için NRC 0x11 ŞART',
  NO_VEHICLE_IDENTITY:  'araç kimliği yok — kimliksiz öğrenme YASAK',
} as const;

export type CoverageLearningVerdict =
  | { readonly learn: true; readonly presence: ServicePresence }
  | { readonly learn: false; readonly rejection: CoverageLearningRejection };

/* ══════════════════════════════════════════════════════════════════════════
   3) ÖĞRENİLEBİLİRLİK — FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir kapsam satırı öğrenilebilir mi — SAF ve FAIL-CLOSED karar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İKİ ÖĞRENİLEBİLİR SONUÇ (ve BAŞKA HİÇBİRİ) ────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ① **`PRESENT`** — ECU pozitif yanıt verdi (`ok`) ve kapsam TERMİNAL kapandı.
 *    Bu, "servis bu ECU'da VAR" demektir; ölçülmüş ve tekrarlanabilir.
 * ② **`ABSENT`** — ECU `7F <svc> 11` dedi. **YALNIZ NRC 0x11.**
 *    `0x12` (alt fonksiyon yok) ve `0x31` (aralık dışı) yokluk KANITI DEĞİLDİR;
 *    `normalizeAdvancedOutcome` üçünü de `unsupported`a indirger, bu yüzden
 *    ham NRC olmadan `ABSENT` ÖĞRENİLEMEZ. Bu, F4-B'nin pazarlıksız
 *    "NRC 0x11 görmeden hiçbir servise yok DENMEZ" kuralının öğrenme
 *    tarafındaki karşılığıdır.
 *
 * Geri kalan HER ŞEY reddedilir — özellikle taşıma ve çözücü sınırları:
 * ikisi de **bizim** sınırımızdır ve araç yeteneği hakkında hiçbir şey söylemez.
 */
export function learnableCoveragePresence(
  row: CoverageLearningRow, provenance: CapabilityProvenance,
): CoverageLearningVerdict {
  /* KÖKEN KAPISI ÖNCE: replay bir ölçümü ne kadar "terminal" görünürse
     görünsün ürün öğrenmesi ÜRETEMEZ (F4-C `isProductTrusted`). */
  if (!isProductTrusted(provenance)) {
    return { learn: false, rejection: 'NOT_PRODUCT_TRUSTED' };
  }
  if (row.outcome === 'NOT_APPLICABLE') {
    return { learn: false, rejection: 'OUT_OF_PLAN' };
  }
  /* Kapı/tanım sınırı: hattan tek bayt çıkmadı → ARAÇ hakkında ölçüm YOK. */
  if (row.outcome === 'BLOCKED') {
    return { learn: false, rejection: 'PRODUCT_LIMIT' };
  }
  if (row.gapRoot === 'PARSER_BOUND') {
    return { learn: false, rejection: 'PARSER_BOUND' };
  }
  if (row.gapRoot === 'TRANSPORT_BOUND') {
    return { learn: false, rejection: 'TRANSPORT_BOUND' };
  }
  if (row.gapRoot === 'SESSION_CONDITIONED') {
    return { learn: false, rejection: 'SESSION_CONDITIONED' };
  }
  /* Hatta çıkmamış ya da sonucu ölçülmemiş satır öğretmez. */
  if (row.requestCount <= 0 || row.measuredOutcome === null) {
    return { learn: false, rejection: 'NOT_MEASURED' };
  }

  if (row.outcome === 'COMPLETE' && row.measuredOutcome === 'ok') {
    return { learn: true, presence: 'PRESENT' };
  }
  if (row.outcome === 'UNSUPPORTED_MEASURED' && row.measuredOutcome === 'unsupported') {
    /* YOKLUK İDDİASI PAHALIDIR: yalnız 0x11 kanıttır. */
    return row.nrc === NRC_SERVICE_NOT_SUPPORTED
      ? { learn: true, presence: 'ABSENT' }
      : { learn: false, rejection: 'ABSENT_WITHOUT_NRC11' };
  }
  /* PARTIAL · UNKNOWN · DEFERRED · her şey → terminal değil. */
  return { learn: false, rejection: 'NOT_TERMINAL' };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) YAZIM PLANI — MEVCUT otoritenin girdisi üretilir
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * F4-C öğrenme kimliğindeki ECU alanı.
 *
 * ⚠️ **YENİ PARMAK İZİ İCAT EDİLMEDİ.** Üretimde F4-B keşfi kenarları
 * `ecuId: endpoint.<endpointKey>` ile yazıyor
 * (`productionDiscovery` → `endpointTargetFromEcu`). `endpointKey` ile
 * `ecuCoverageKey` AYNI biçimi üretir (`<addressBits>:<RXHEADER>`), bu yüzden
 * kapsam öğrenmesi keşif öğrenmesiyle **AYNI kenara** yazar — aksi hâlde aynı
 * fiziksel ECU iki ayrı kimlik altında öğrenilir ve ikisi de yarım kalırdı.
 */
export function learningEcuId(ecuKey: string): string {
  return `endpoint.${ecuKey}`;
}

/**
 * Kapsam defterini MEVCUT öğrenme gözlemlerine çevirir (SAF).
 *
 * Hiçbir şey YAZMAZ — çağıran `recordCapabilityObservation(o)` ile mevcut
 * depoya yazar ve F4-C politikası (UNKNOWN ezmez · ABSENT kotası · çelişki ·
 * köken) orada AYNEN uygulanır. Burada ikinci bir birleştirme kuralı YOK.
 *
 * Araç kimliği yoksa **hiçbir şey** üretilmez: kimliksiz bir öğrenme başka
 * araca sızabilirdi (F5-F/G izolasyonu).
 */
export function planCoverageLearningWrites(
  endpoints: readonly CoverageLearningEndpoint[],
  ctx: CoverageLearningContext,
): readonly CapabilityObservationInput[] {
  const vehicleId = ctx.vehicleRef;
  if (vehicleId === null || vehicleId.length === 0) return [];

  const out: CapabilityObservationInput[] = [];
  for (const ep of endpoints) {
    for (const row of ep.rows) {
      const v = learnableCoveragePresence(row, ep.provenance);
      if (!v.learn) continue;
      out.push({
        vehicleId,
        ecuId: learningEcuId(ep.ecuKey),
        service: row.service,
        subFunction: row.subFunction,
        presence: v.presence,
        provenance: ep.provenance,
        protocol: ep.protocol,
        transport: ctx.transport,
        evidenceRef: ep.evidenceRef,
        nrc: row.nrc,
        atMs: ep.atMs,
      });
    }
  }
  /* Deterministik sıra — iki tur karşılaştırılabilir olsun. */
  return out.sort((a, b) =>
    a.ecuId.localeCompare(b.ecuId)
    || a.service.localeCompare(b.service)
    || (a.subFunction ?? '').localeCompare(b.subFunction ?? ''));
}

/* ══════════════════════════════════════════════════════════════════════════
   5) OKUMA — öğrenilmiş bilgi PLANI etkiler, HÜKMÜ ETKİLEMEZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Öğrenilmiş kenarlardan **plan girdisi** üretir (SAF).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN YALNIZ `ABSENT` ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `planEcuDtcCoverage` yalnız `ABSENT` görünce sorguyu atlar
 * (`SERVICE_ABSENT_MEASURED`). Öğrenilmiş `PRESENT` hiçbir sorguyu KALDIRMAZ —
 * kaldırsaydı öğrenme, ölçmesi gereken bir kanalı ölçmeden "biliyorum" derdi.
 * Yani bu fonksiyon **yalnız israfı** azaltır, kapsamı DEĞİL.
 *
 * ── TAZELİK MEVCUT OTORİTEDEN ─────────────────────────────────────────────
 * Karar `decideReuse`tedir: bayat (`CAPABILITY_FRESH_MS` = 30 gün) · çelişkili ·
 * canlı olmayan · taşıma koşulu değişmiş · parmak izi zayıf kenar **REUSE
 * ÜRETMEZ** → gerçek sorgu geri gelir. Öğrenilmiş "unsupported" bilgisi bu
 * yüzden gerçek probu **sonsuza kadar kaldıramaz**. İkinci tazelik kuralı
 * YAZILMADI.
 */
export function learnedCoverageSkips(
  edges: readonly CapabilityEdge[],
  ecuKey: string,
  ctx: ReuseContext,
): ReadonlyMap<string, ServicePresence> {
  const out = new Map<string, ServicePresence>();
  const wantEcuId = learningEcuId(ecuKey);
  for (const edge of edges) {
    if (edge.ecuId !== wantEcuId) continue;          // ECU A → ECU B sızıntısı YOK
    if (edge.presence !== 'ABSENT') continue;        // yalnız yokluk atlatır
    if (decideReuse(edge, ctx) !== 'REUSE') continue; // bayat/çelişkili/güvensiz → ÖLÇ
    out.set(`${edge.service}|${edge.subFunction ?? ''}`, 'ABSENT');
  }
  return out;
}

/**
 * Bu turda ÖLÇÜLMÜŞ varlık ile ÖĞRENİLMİŞ varlığı birleştirir (SAF).
 *
 * **ÖLÇÜM HER ZAMAN KAZANIR:** aynı anahtar hem ölçüldüyse hem öğrenildiyse
 * bu turun ölçümü geçerlidir. Öğrenme bir hız optimizasyonudur; taze bir
 * ölçümün yerine ASLA geçmez.
 */
export function mergeMeasuredAndLearned(
  measured: ReadonlyMap<string, ServicePresence>,
  learned: ReadonlyMap<string, ServicePresence>,
): ReadonlyMap<string, ServicePresence> {
  if (learned.size === 0) return measured;
  const out = new Map<string, ServicePresence>(learned);
  for (const [k, v] of measured) out.set(k, v);   // ölçüm öğrenmeyi EZER
  return out;
}
