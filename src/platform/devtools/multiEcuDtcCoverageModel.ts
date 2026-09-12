/**
 * multiEcuDtcCoverageModel — CAROS LAB · Çoklu-ECU DTC Kapsamı SAF modeli.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR
 * (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem KURULMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EKRANIN TEK İDDİASI ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   "ÖLÇÜLMÜŞ her uç nokta için: neyi sordum, ne cevap verdi, neyi
 *    okuyamadım ve NEDEN?"
 *
 * HÜKÜM ÜRETMEZ: "araç temiz" kararı `dtcAuthority.evaluateVehicleDtcVerdict`
 * tekelindedir ve bu ekran ona DOKUNMAZ.
 *
 * `KAYNAK YOK` (hiç ölçülmedi) ile `0` (ölçtük, sıfır çıktı) ASLA aynı
 * hücreye yazılmaz.
 */

import {
  derived, observed, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { MultiEcuDtcCoverageSnapshot } from './multiEcuDtcCoverageSources';
import type { DtcCoverageEcuEntry } from '../obd/dtcCoverageEvidence';
import {
  DECLARED_COUNT_VERDICT_LABEL, DTC_COVERAGE_OUTCOME_LABEL,
  DTC_COVERAGE_SKIP_LABEL, ECU_DTC_COVERAGE_VERDICT_LABEL,
  dtcCoverageSpec,
} from '../obd/dtcCoveragePlan';
import { MAX_EXTENDED_DATA_READS_PER_ECU, MAX_SCAN_ECUS } from '../obd/multiEcuScan';
import { DTC_PIPELINE_LOSS_LABEL } from '../obd/dtcPipelineAccounting';
import { DIAGNOSTIC_COMPLETENESS_LABEL } from '../obd/ecuCompleteness';
import { GAP_LIFECYCLE_LABEL, ROOT_CAUSE_LABEL } from '../obd/healing/gapModel';
import { parseCoverageContext } from '../obd/healing/dtcCoverageGapBridge';
import type { RootCauseClass } from '../obd/healing/gapModel';
import { ECU_ROLE_LABEL, ECU_EVIDENCE_LABEL } from '../obd/ecuRoleModel';
import { ECU_ADDRESSABILITY_LABEL } from '../obd/ecuAddressability';
import { GAP_LEDGER_SCOPE_LABEL } from '../obd/gapLedgerScope';

const SRC = 'obd/dtcCoverageEvidence';
const SRC_PLAN = 'obd/dtcCoveragePlan';

/* ══════════════════════════════════════════════════════════════════════════
   1) TUR HÜKMÜ (kapsam gerçeği — arıza hükmü DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

export type CoverageRunVerdict =
  /** Bu oturumda hiç çoklu-ECU DTC kapsamı ölçülmedi. */
  | 'NEVER_MEASURED'
  /** Uç nokta var ama hiçbirine tek bayt gitmedi. */
  | 'NO_REQUEST_SENT'
  /** En az bir uç nokta eksik/bilinmeyen kapsamda. */
  | 'PARTIAL'
  /** Ölçülen HER uç nokta tam kapsamda. */
  | 'COMPLETE';

export const COVERAGE_RUN_VERDICT_LABEL:
Readonly<Record<CoverageRunVerdict, string>> = {
  NEVER_MEASURED: 'HİÇ ÖLÇÜLMEDİ — bu "araç temiz" DEĞİL, ölçüm YOK',
  NO_REQUEST_SENT: 'HATTA TEK BAYT ÇIKMADI — uç noktalar var, sorgu gitmedi',
  PARTIAL:         'KISMİ KAPSAM — en az bir uç noktada okunamayan kanal var',
  COMPLETE:        'TAM KAPSAM — planlanan her sınıf terminal kanıta sahip',
} as const;

export interface CoverageRunVerdictResult {
  readonly status: CoverageRunVerdict;
  readonly reasons: readonly string[];
}

export function deriveCoverageRunVerdict(
  s: MultiEcuDtcCoverageSnapshot,
): CoverageRunVerdictResult {
  const reasons: string[] = [];
  if (s.entries.length === 0 || s.summary === null) {
    reasons.push('Bu oturumda çoklu-ECU DTC kapsamı hiç ölçülmedi.');
    reasons.push('Bu bir BAŞARISIZLIK DEĞİLDİR — ölçüm yokluğudur ve "arıza yok" DEMEK DEĞİLDİR.');
    return { status: 'NEVER_MEASURED', reasons };
  }
  if (s.summary.totalRequests === 0) {
    reasons.push('Uç nokta ölçüldü ama hiçbirine tanı isteği GÖNDERİLMEDİ.');
    reasons.push('Gerekçeler uç nokta satırlarında (bütçe · adres · kapı · protokol).');
    return { status: 'NO_REQUEST_SENT', reasons };
  }
  const bad = s.summary.partial + s.summary.unknown
    + s.summary.deferred + s.summary.blocked + s.summary.notAddressable;
  if (bad > 0) {
    reasons.push(`${bad} uç noktada kapsam TAM DEĞİL (kısmi · bilinmiyor · ertelendi · engelli · adreslenemedi).`);
    reasons.push('Okunmayan bir kanalda arıza OLABİLİR — kısmi tarama "temiz" DEMEZ.');
    return { status: 'PARTIAL', reasons };
  }
  reasons.push(`${s.summary.complete} uç noktanın tamamında planlanan sınıflar terminal kanıta sahip.`);
  reasons.push('Bu KAPSAM hükmüdür; "arıza var/yok" kararı DTC otoritesinindir.');
  return { status: 'COMPLETE', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KARTLAR
   ══════════════════════════════════════════════════════════════════════════ */

export type CoverageCardId =
  'canonical' | 'summary' | 'healing' | 'safety' | 'endpoints' | 'accounting';

export const COVERAGE_CARD_ORDER: readonly CoverageCardId[] =
  ['canonical', 'summary', 'healing', 'safety', 'endpoints', 'accounting'] as const;

export const COVERAGE_CARD_TITLE: Readonly<Record<CoverageCardId, string>> = {
  canonical:  '1 · Kanonik Bütünlük (uç nokta + tanı kapsamı)',
  summary:    '2 · Tur Özeti',
  healing:    '3 · Kapsam Boşluğu ve Hedefli Yeniden Ölçüm',
  safety:     '4 · Güvenlik ve Kapsam Sınırları',
  endpoints:  '5 · Uç Nokta Başına Kapsam',
  accounting: '6 · Sayım Zinciri (RAW → PARSER → AUTHORITY → UI)',
} as const;

export interface CoverageCard {
  readonly id: CoverageCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/** Uç nokta künyesi — DTC KODU TAŞIMAZ, yalnız adres + sayı. */
function _endpointLabel(e: DtcCoverageEcuEntry): string {
  return `${e.rxHeader}${e.txHeader === null ? '' : ` (tx ${e.txHeader})`}`;
}

/** Sınıf satırı: `19-02 TAM · 3 kayıt` — kapalı sözlükten, serbest metin YOK. */
function _rowLine(r: DtcCoverageEcuEntry['rows'][number]): string {
  const id = r.subFunction === null ? r.service : `${r.service}-${r.subFunction}`;
  const n = r.recordCount === null ? '?' : String(r.recordCount);
  const why = r.skipReason === null ? '' : ` (${DTC_COVERAGE_SKIP_LABEL[r.skipReason]})`;
  return `${id} ${DTC_COVERAGE_OUTCOME_LABEL[r.outcome]} · kayıt ${n}${why}`;
}

export function buildCoverageCards(
  s: MultiEcuDtcCoverageSnapshot,
): readonly CoverageCard[] {
  return COVERAGE_CARD_ORDER.map((id) => ({
    id, title: COVERAGE_CARD_TITLE[id], fields: _fieldsFor(id, s),
  }));
}

function _fieldsFor(
  id: CoverageCardId, s: MultiEcuDtcCoverageSnapshot,
): readonly InspectorField[] {
  switch (id) {
    case 'canonical':  return _canonicalFields(s);
    case 'summary':    return _summaryFields(s);
    case 'healing':    return _healingFields(s);
    case 'safety':     return _safetyFields(s);
    case 'endpoints':  return _endpointFields(s);
    case 'accounting': return _accountingFields(s);
    default:           return [];
  }
}

/**
 * P0-VDK-F6C — İKİ GERÇEĞİN TEK YERDE BİRLEŞTİĞİ KART.
 *
 * "ECU'ları buldum" ile "arıza hafızalarını yeterince taradım" AYNI ŞEY
 * DEĞİLDİR. Bu kart ikisini YAN YANA ve AYRI AYRI gösterir; yüzdenin
 * FORMÜLÜ de görünür — denetlenemeyen bir sayı üretmeyiz.
 */
function _canonicalFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  /* ── OTURUM MÜHRÜ KAPISI (P0-VDK-F6C) ─────────────────────────
     `getLastEcuCompleteness()` SÜREÇ ÖMLÜRLÜDÜR: araç değişse bile son
     turun kapsamını döndürür. Onu ŞU ANKİ aracın gerçeği gibi göstermek,
     başka bir aracın kapsamını bu araca yazmak olurdu (F5-F/G izolasyonu).
     Mühür tutmuyorsa kanıt KULLANILMAZ — "0" da yazılmaz, KAYNAK YOK denir. */
  const sealed = s.completeness !== null && s.sessionEpoch !== null
    && s.completeness.sessionEpoch === s.sessionEpoch;
  const c = sealed ? s.completeness : null;
  const d = c?.diagnostic ?? null;
  const at = s.entries.length > 0 ? s.entries[0]!.atMs : null;
  const out: InspectorField[] = [];

  /* ── A) UÇ NOKTA KAPSAMI ───────────────────────────────── */
  if (c === null) {
    out.push(unavailable({ id: 'ep-cov', label: 'A · Uç nokta kapsamı',
      source: 'obd/ecuCompleteness',
      note: 'Bu OTURUMDA ECU kapsamı ölçülmedi. Başka bir oturumun (başka aracın) '
        + 'kapsamı bu ekrana TAŞINMAZ.' },
      'KAYNAK YOK — tarama koşmadı. Bu "ECU yok" DEMEK DEĞİLDİR.'));
  } else {
    out.push(observed({ id: 'ep-cov', label: 'A · Uç nokta kapsamı',
      source: 'obd/ecuCompleteness',
      note: 'ÖLÇÜLEN uç nokta kümesine GÖRE. "Araçta başka ECU var mı" sorusuna '
        + 'CEVAP VERMEZ — o iddia ayrı bir satırdır.', updatedAt: at },
      `bulunan ${c.discovered} · taranan ${c.scanned} · okunamayan ${c.failed}`
      + ` · ulaşılamayan ${c.notAddressable} · taranmayan ${c.skipped}`));
    out.push(c.measuredEndpointRatio === null
      ? unavailable({ id: 'ep-ratio', label: 'A · ölçülen uç nokta oranı',
          source: 'obd/ecuCompleteness',
          note: 'Hiç uç nokta ölçülmedi ya da kanıt BAYAT.' },
          'ORAN ÜRETİLEMEZ — sahte 0/1 YAZILMAZ')
      : derived({ id: 'ep-ratio', label: 'A · ölçülen uç nokta oranı',
          source: 'obd/ecuCompleteness',
          note: 'taranan / (taranan + okunamayan + taranmayan + ulaşılamayan)',
          updatedAt: at },
        `${Math.round(c.measuredEndpointRatio * 10_000) / 100}%`));
    out.push(derived({ id: 'vehicle-denom', label: 'A · ARAÇ geneli iddiası',
      source: 'obd/ecuCompleteness',
      note: 'Fonksiyonel 0100 yalnız CEVAP VERENLERİ bilir; araçtaki gerçek ECU '
        + 'sayısı ölçülemez. Bu yüzden "araç tam taranmıştır" iddiası fail-closed '
        + 'olarak ÜRETİLMEZ — bu bir kusur değil, dürüstlük kapısıdır.',
      updatedAt: at },
      c.denominatorKnown ? c.completenessLabel : 'PAYDA BİLİNMİYOR — iddia ÜRETİLMEZ'));
  }

  /* ── B) TANI KAPSAMI ─────────────────────────────────── */
  if (d === null) {
    out.push(unavailable({ id: 'diag-cov', label: 'B · Tanı kapsamı',
      source: 'obd/ecuCompleteness', note: 'Tanı kapsamı kanıtı verilmedi.' },
      'KAYNAK YOK — "0 kanal okundu" DEMEK DEĞİLDİR'));
    return out;
  }

  out.push(observed({ id: 'diag-verdict', label: 'B · Tanı kapsamı hükmü',
    source: 'obd/ecuCompleteness',
    note: 'FAIL-CLOSED: ölçülen HER uç noktanın TEMEL ekseni terminal kanıt '
      + 'almadıkça TAM denmez. Bu bir KAPSAM hükmüdür — "arıza var/yok" kararı '
      + 'yalnız DTC otoritesinindir.', updatedAt: at },
    DIAGNOSTIC_COMPLETENESS_LABEL[d.verdict]));

  out.push(observed({ id: 'diag-core', label: 'B · TEMEL eksen (arıza hafızası)',
    source: 'obd/ecuCompleteness',
    note: 'Mode 03/07/0A · UDS 19-01/02/0A · KWP 18/13. '
      + 'Bu eksen "ECU’nun arıza hafızasını okuyabildim mi" sorusudur.',
    updatedAt: at },
    `${d.coreTerminalUnits}/${d.corePlannedUnits} birim · ${d.coreCoverageLabel}`
    + ` · tam uç nokta ${d.coreComplete}/${d.endpoints}`));

  out.push(observed({ id: 'diag-deep', label: 'B · DERİN eksen (kayıt başına kanıt)',
    source: 'obd/ecuCompleteness',
    note: 'UDS 19-03 · 19-04 · 19-06. **TEMEL ekseni DÜŞÜRMEZ**: 19-04 native '
      + 'kapıda olmadığı için yapısal olarak kapalıdır ve onun yüzünden temel '
      + 'kapsamı sonsuza dek kısmi göstermek, ölçülmemiş bir eksikliği ölçülmüş '
      + 'gibi sunmak olurdu.', updatedAt: at },
    `${d.deepTerminalUnits}/${d.deepPlannedUnits} birim`
    + ` · tam uç nokta ${d.deepComplete}/${d.endpoints}`));

  out.push(derived({ id: 'diag-formula', label: 'B · FORMÜL',
    source: 'obd/ecuCompleteness',
    note: 'PAZARLIKSIZ: her planlanan sınıf 1 BİRİMDİR. Bir servisin 50 DTC '
      + 'döndürmesi 50 puan KAZANDIRMAZ — 20 DTC’li ECU ile 0 DTC’li ECU AYNI '
      + 'ağırlıktadır. DTC SAYISI yüzdeye GİRMEZ.', updatedAt: at },
    d.formula));

  /* ── C) KAYIP KÖKÜ ──────────────────────────────────── */
  const roots = Object.entries(d.gapRoots) as [RootCauseClass, number][];
  out.push(roots.length === 0
    ? derived({ id: 'gap-roots', label: 'C · Kayıp kökü',
        source: 'obd/healing/gapModel',
        note: 'Kapsam kaybı ölçülmedi. Bu "araç temiz" DEMEK DEĞİLDİR.',
        updatedAt: at }, 'KAYIP ÖLÇÜLMEDİ')
    : observed({ id: 'gap-roots', label: 'C · Kayıp kökü',
        source: 'obd/healing/gapModel',
        note: 'MEVCUT F5-A sözlüğü (yeni gap sözlüğü YAZILMADI). '
          + 'TAŞIMA ve ÇÖZÜCÜ sınırları **ARAÇ KUSURU DEĞİLDİR**.',
        updatedAt: at },
      roots.map(([k, n]) => `${ROOT_CAUSE_LABEL[k]}: ${n}`).join(' · ')));

  out.push(derived({ id: 'gap-split', label: 'C · Araç kusuru OLMAYAN kayıp',
    source: 'obd/ecuCompleteness',
    note: 'TAŞIMA sınırı (köprü/kapı) ve ÇÖZÜCÜ borcu ARACIN kusuru DEĞİLDİR '
      + 've paydaya GİRMEZ. Çözücü borcu ÖLÇÜMLE KAPANMAZ — Self-Healing işi '
      + 'gibi gösterilmez, yazılım borcu olarak ayrı durur.', updatedAt: at },
    `taşıma ${d.transportLimitedUnits} · çözücü ${d.parserGapUnits}`
    + ` · oturum ${d.sessionGapUnits} · plan dışı ${d.outOfPlanUnits}`
    + ` · ÖLÇÜMLE KAPANABİLİR ${d.measurableGapUnits}`));

  out.push(derived({ id: 'diag-trust', label: 'C · Ölçüm kökeni',
    source: 'obd/capability/capabilityGraph',
    note: 'Yalnız CANLI ölçüm ürün hükmü üretir; replay/sentetik bir koşu '
      + '"tam tarandı" SAYILMAZ (F4-C ilkesi).', updatedAt: at },
    d.productTrusted ? 'CANLI — ürün hükmü üretebilir'
      : 'CANLI DEĞİL — TAM hüküm ÜRETİLEMEZ'));

  return out;
}

function _summaryFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  const m = s.summary;
  const at = s.entries.length > 0 ? s.entries[0]!.atMs : null;
  const f = (idv: string, label: string, note: string, v: unknown) =>
    (m === null
      ? unavailable({ id: idv, label, source: SRC, note },
          'Hiç kapsam ölçülmedi — KAYNAK YOK ile 0 aynı şey DEĞİLDİR.')
      : observed({ id: idv, label, source: SRC, note, updatedAt: at }, v));

  return [
    f('endpoints', 'Ölçülen uç nokta', 'Kapsam defterine yazılan uç nokta sayısı.', m?.endpoints),
    f('queried', 'DTC sorgulanan uç nokta',
      'En az bir DTC isteği HATTA ÇIKAN uç nokta. 0 ise ölçüm yoktur.', m?.queriedEndpoints),
    f('complete', 'TAM kapsam', 'Planlanan her sınıf terminal kanıta sahip.', m?.complete),
    f('partial', 'KISMİ kapsam', 'Bir kanal okundu, en az biri eksik.', m?.partial),
    f('unknown', 'BİLİNMEYEN kapsam', 'Sorgu gitti, ölçüm alınamadı.', m?.unknown),
    f('deferred', 'ERTELENEN', 'Sorgu HİÇ gönderilmedi (bütçe · oturum · adres).', m?.deferred),
    f('blocked', 'ENGELLİ', 'Kapı/köprü/protokol sınırı — ARAÇ kararı DEĞİL.', m?.blocked),
    f('notAddressable', 'ADRESLENEMEDİ', 'Fiziksel istek gitti, ECU sustu.', m?.notAddressable),
    f('unknownRole', 'Rolü BİLİNMEYEN ama sorgulanan uç nokta',
      'F6-A sözleşmesi: rolü çözülemeyen uç nokta envanterden ATILMAZ ve '
      + 'salt-okunur DTC kapsamına GİRER. Bu sayı o sözleşmenin ÖLÇÜMÜDÜR.',
      m?.unknownRoleQueried),
    f('requests', 'Toplam DTC isteği',
      'Bu turda uç noktalara giden istek. Hepsi F1-A bütçesinden düşer.', m?.totalRequests),
    f('dtcs', 'Ürüne ulaşan DTC satırı',
      'Bu ekran DTC KODU göstermez — sayım, kod listesi DTC otoritesindedir.', m?.totalDtcs),
    f('reused', 'Öğrenilmiş yetenekle atlanan sınıf',
      'Bu oturumda ECU 7F-11 ile YOKLUĞUNU beyan ettiği için yeniden sorulmayan sınıf.',
      m?.capabilityReused),
    s.protocol === null
      ? unavailable({ id: 'protocol', label: 'Aktif protokol', source: 'obd/activeProtocol',
          note: 'ATDPN okunamadı.' }, 'Protokol ÖLÇÜLMEDİ — plan fail-closed daraldı.')
      : observed({ id: 'protocol', label: 'Aktif protokol', source: 'obd/activeProtocol',
          note: 'ATDPN ile GERÇEKTEN okunan protokol (denenen değil).' },
        `${s.protocol}${s.protocolClass === null ? '' : ` · ${s.protocolClass}`}`),
    s.scope === null
      ? unavailable({ id: 'scope', label: 'Araç bölümü', source: 'obd/capability/capabilityStore',
          note: 'Kapsam bölümü okunamadı.' })
      : derived({ id: 'scope', label: 'Araç bölümü',
          source: 'obd/capability/capabilityStore',
          note: 'Bir aracın kapsamı BAŞKA araca taşınamaz; kapsam defteri ayrıca '
            + 'OTURUM MÜHÜRLÜDÜR (yeni oturum → eski kapsam düşer).' },
        GAP_LEDGER_SCOPE_LABEL[s.scope.state]),
  ];
}

/**
 * P0-VDK-F6D — KAPSAM BOŞLUĞU → HEDEFLİ YENİDEN ÖLÇÜM.
 *
 * Bu kart YALNIZ mevcut F5 defterlerini okur — ikinci bir healing defteri
 * KURULMADI. Tek PDU/timer/oturum/iyileştirme TETİKLEMEZ.
 */
function _healingFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  const covStates = s.gapStates.filter((g) => g.gap.context.startsWith('dtc_coverage:'));
  const covEntries = s.gapEntries.filter((e) => e.context.startsWith('dtc_coverage:'));
  const at = s.entries.length > 0 ? s.entries[0]!.atMs : null;
  const out: InspectorField[] = [];

  out.push(covEntries.length === 0
    ? unavailable({ id: 'heal-gaps', label: 'Sicile yazılan kapsam boşluğu',
        source: 'obd/gapRegistry',
        note: 'Bu oturumda tanı kapsamı boşluğu yazılmadı. Bu "kapsam tam" '
          + 'DEMEK DEĞİLDİR — tarama hiç koşmamış da olabilir.' },
        'KAYNAK YOK')
    : observed({ id: 'heal-gaps', label: 'Sicile yazılan kapsam boşluğu',
        source: 'obd/gapRegistry',
        note: 'F6-C’nin ölçtüğü eksik kanal artık KANONİK sicile düşer; F5 çözücü '
          + 'onu GÖREBİLİR. Önceki turlarda bu köprü YOKTU.',
        updatedAt: at }, covEntries.length));

  out.push(covStates.length === 0
    ? unavailable({ id: 'heal-eval', label: 'Çözücünün değerlendirdiği boşluk',
        source: 'obd/healing/gapResolverRuntime',
        note: 'Çözücü bu boşlukları henüz değerlendirmedi.' }, 'KAYNAK YOK')
    : observed({ id: 'heal-eval', label: 'Çözücünün değerlendirdiği boşluk',
        source: 'obd/healing/gapResolverRuntime',
        note: 'Karar ve gerekçe her boşluk için AYRI satırda — sessiz karar YASAK.',
        updatedAt: at }, covStates.length));

  for (const st of covStates) {
    const parsed = parseCoverageContext(st.gap.context);
    const t = st.gap.target;
    const svc = t.subFunction === null ? (t.service ?? '?') : `${t.service}-${t.subFunction}`;
    /* KÖK NEDENE GÖRE AÇIK METIN — görev §29'un istediği ayırımlar. */
    const explain =
        st.rootCause === 'PARSER_BOUND'
          ? 'TEKRAR SORULMADI — yazılım çözümleyici sınırı (ECU yanıtı MEVCUT)'
      : st.rootCause === 'TRANSPORT_BOUND'
          ? (st.selected === 'APPLY_ISOTP_TUNING'
              ? 'TAŞIMA — ISO-TP tuning ile yeniden ölçüldü (F1-C)'
              : 'TAŞIMA SINIRI — güvenli alternatif yok, tekrar gönderilmedi')
      : st.rootCause === 'SESSION_CONDITIONED'
          ? 'OTURUM KANITIYLA HEDEFLİ YENİDEN ÖLÇÜM (F5-C)'
      : st.rootCause === 'ATTRIBUTION_UNRESOLVED'
          ? 'ECU ATFI DOĞRULAMASI (F6-A yolu)'
      : 'HEDEFLİ REPROBE';
    out.push(observed({
      id: `heal-${st.gap.key}`,
      label: `${parsed?.axis === 'deep' ? 'DERİN' : 'TEMEL'} · ${t.ecuKey ?? '?'} · ${svc}`,
      source: 'obd/healing/gapResolverRuntime',
      note: `${explain} · ${st.selectionReason}`
        + (st.outcomeDetail === '' ? '' : ` · ${st.outcomeDetail}`),
      updatedAt: at,
    }, `${ROOT_CAUSE_LABEL[st.rootCause]} · ${GAP_LIFECYCLE_LABEL[st.lifecycle]}`
      + ` · seçilen ${st.selected ?? 'YOK'} · deneme ${st.attempts}`
      + ` · istek ${st.requestsSpent}`
      + ` · son ölçüm ${st.lastOutcome ?? 'ÖLÇÜM YOK'}`));
  }

  out.push(derived({ id: 'heal-truth', label: 'KAPSAM GERÇEĞİ ≠ ÇÖZÜCÜ DURUMU',
    source: 'obd/ecuCompleteness',
    note: '`RESOLVED` yalnız "çözücü hedeflediği boşluk için YENİ KANIT ALDI" '
      + 'demektir. Kapsam TAM olur mu sorusunun cevabı yalnız yeni '
      + 'dtcCoverageEvidence + ecuCompleteness + dtcAuthority zincirindedir; '
      + 'çözücü durumu tek başına TAM/temiz ÜRETEMEZ.' },
    'gap RESOLVED → COMPLETE kısayolu YOK'));

  return out;
}

function _safetyFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  const at = s.entries.length > 0 ? s.entries[0]!.atMs : null;
  const blockedRows = s.entries.flatMap((e) =>
    e.rows.filter((r) => r.outcome === 'BLOCKED'));
  const blockedIds = [...new Set(blockedRows.map((r) =>
    r.subFunction === null ? r.service : `${r.service}-${r.subFunction}`))].sort();
  const sessionRows = s.entries.flatMap((e) =>
    e.rows.filter((r) => r.measuredOutcome === 'security_required'
      || r.measuredOutcome === 'condition_required'));

  return [
    derived({ id: 'readonly', label: 'Bu tur SALT-OKUNUR mu',
      source: SRC_PLAN,
      note: 'Kapsam planı YALNIZ salt-okunur sınıflar üretir. 04 clear · 14 · 10 · '
        + '27 SecurityAccess · 2E · 2F · 31 · 3E · 11 · 34/35/36/37 · 85 bu yoldan '
        + 'ÜRETİLEMEZ; native DiagnosticServiceGate ayrıca ve BAĞIMSIZ son kapıdır.' },
      'EVET — plan yalnız 03/07/0A · 19-01/02/03/06/0A · 18 · 13 üretir'),
    blockedIds.length === 0
      ? unavailable({ id: 'blocked-subs', label: 'Kapı/köprü ENGELLİ sınıflar', source: SRC,
          note: 'Bu turda engelli sınıf ölçülmedi.' })
      : observed({ id: 'blocked-subs', label: 'Kapı/köprü ENGELLİ sınıflar', source: SRC,
          note: 'Bunlar ARAÇ hakkında bir şey SÖYLEMEZ — hattan tek bayt çıkmadı. '
            + '0x19-04 (snapshot kayıt gövdesi) native salt-okunur alt fonksiyon '
            + 'kümesinde YOKTUR; kapı ZORLANMAZ, durum dürüstçe ENGELLİ yazılır.',
          updatedAt: at }, blockedIds.join(' · ')),
    sessionRows.length === 0
      ? unavailable({ id: 'session-cond', label: 'Oturum/koşul isteyen okuma', source: SRC,
          note: 'Bu turda oturum/koşul reddi ölçülmedi.' })
      : observed({ id: 'session-cond', label: 'Oturum/koşul isteyen okuma', source: SRC,
          note: 'ECU okuma için oturum/koşul istedi. Kapı ZORLANMAZ: durum kanıtlanır, '
            + 'SecurityAccess GÖNDERİLMEZ. Bu bir KAPSAM KAYBIDIR, "temiz" DEĞİL.',
          updatedAt: at }, `${sessionRows.length} okuma`),
    observed({ id: 'ext-cap', label: 'ECU başına genişletilmiş veri tavanı',
      source: 'obd/multiEcuScan', note:
        '0x19-06 DTC BAŞINA bir istektir; tavan olmadan 20 kodlu bir ECU tek '
        + 'başına 20 istek üretirdi. Tavan üstü kalanlar SESSİZCE atılmaz, ERTELENMİŞ sayılır.' },
      MAX_EXTENDED_DATA_READS_PER_ECU),
    observed({ id: 'ecu-cap', label: 'Tur başına ECU tavanı',
      source: 'obd/multiEcuScan',
      note: 'Tavan aşılırsa sessiz kırpma YOK — atlanan uç nokta kapsam raporuna girer.' },
      MAX_SCAN_ECUS),
    s.bridgeAvailable === null
      ? unavailable({ id: 'bridge', label: 'Genel PDU köprüsü', source: 'obd/genericPduTransport',
          note: 'Köprü durumu okunamadı.' })
      : observed({ id: 'bridge', label: 'Genel PDU köprüsü',
          source: 'obd/genericPduTransport',
          note: 'Köprü yoksa istek TAŞINAMAZ — bu BİZİM sınırımızdır, aracın kararı DEĞİL.' },
        s.bridgeAvailable ? 'VAR' : 'YOK'),
  ];
}

function _endpointFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  if (s.entries.length === 0) {
    return [unavailable({ id: 'no-endpoint', label: 'Uç nokta', source: SRC,
      note: 'Bu oturumda hiç kapsam ölçülmedi.' },
      'KAYNAK YOK — uç nokta bulunamaması "araçta o ECU yok" DEMEK DEĞİLDİR.')];
  }
  const out: InspectorField[] = [];
  for (const e of s.entries) {
    const head = `${ECU_DTC_COVERAGE_VERDICT_LABEL[e.verdict]}`
      + ` · rol ${e.role === null ? 'BİLİNMİYOR' : ECU_ROLE_LABEL[e.role]}`
      + ` (${e.roleEvidence === null ? 'kanıt yok' : ECU_EVIDENCE_LABEL[e.roleEvidence]})`
      + ` · ${ECU_ADDRESSABILITY_LABEL[e.addressability]}`
      + ` · istek ${e.requestCount} · DTC ${e.dtcCount}`;
    out.push(observed({
      id: `ep-${e.rxHeader}`, label: _endpointLabel(e), source: SRC,
      note: e.reasons.join(' · '), updatedAt: e.atMs,
    }, head));

    const mask = e.statusMask === null
      ? 'status maskesi ÖLÇÜLMEDİ'
      : `19-02 maskesi ${e.statusMask} (${e.statusMaskProvenance === 'MEASURED'
        ? 'ÖLÇÜLDÜ — 19-01' : 'VARSAYILDI — ölçülemedi'})`;
    const snap = e.snapshotReferenceCount === null
      ? 'snapshot referansı ÖLÇÜLMEDİ'
      : `snapshot referansı ${e.snapshotReferenceCount}`;
    const ext = e.extendedDataAvailable === null
      ? 'genişletilmiş veri ÖLÇÜLMEDİ'
      : e.extendedDataAvailable
        ? 'HAM genişletilmiş veri MEVCUT (anlamı OEM’e özgü — YORUMLANMAZ)'
        : 'genişletilmiş veri okunamadı';
    out.push(derived({
      id: `ep-${e.rxHeader}-meta`, label: `${e.rxHeader} · derinlik kanıtı`, source: SRC,
      note: 'Ham OEM gövdesi bu ekrana TAŞINMAZ; bilinmeyen bayta anlam UYDURULMAZ.',
      updatedAt: e.atMs,
    }, `${mask} · ${snap} · ${ext}`));

    out.push(derived({
      id: `ep-${e.rxHeader}-fields`, label: `${e.rxHeader} · alan korunumu`, source: SRC,
      note: 'Alt kod (failureType/subCode) ve status baytı taşıyan kayıt sayısı. '
        + 'P0380(11) ile P0380(96) AYRI kayıtlardır ve tek satıra İNMEZ.',
      updatedAt: e.atMs,
    }, `alt kod ${e.failureTypeCount} · status baytı ${e.statusByteCount}`
      + ` · öğrenmeyle atlanan ${e.capabilityReused}`));

    for (const r of e.rows) {
      out.push(observed({
        id: `ep-${e.rxHeader}-${r.cls}`,
        label: `${e.rxHeader} · ${dtcCoverageSpec(r.cls).label}`,
        source: SRC,
        note: `${r.detail}`
          + (r.declaredVerdict === 'UNKNOWN' ? ''
            : ` · beyan/ölçüm: ${DECLARED_COUNT_VERDICT_LABEL[r.declaredVerdict]}`
              + (r.declaredCount === null ? '' : ` (beyan ${r.declaredCount})`)),
        updatedAt: e.atMs,
      }, _rowLine(r)));
    }
  }
  return out;
}

function _accountingFields(s: MultiEcuDtcCoverageSnapshot): readonly InspectorField[] {
  const p = s.pipeline;
  const n = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
  const at = s.entries.length > 0 ? s.entries[0]!.atMs : null;
  return [
    p === null
      ? unavailable({ id: 'pipe', label: 'Sayım zinciri', source: 'obd/dtcPipelineAccounting',
          note: 'Bu oturumda okuma künyesi yazılmadı.' })
      : observed({ id: 'pipe', label: 'Sayım zinciri',
          source: 'obd/dtcPipelineAccounting',
          note: 'İKİNCİ MUHASEBE MOTORU KURULMADI — bu satır mevcut F2 zincirinden '
            + 'okunur. Ölçülemeyen sayı `?` basılır; sahte 0 YASAK. '
            + 'Meta okumalar (19-01/03/06) bu künyeye GİRMEZ: DTC kaydı üretmezler, '
            + 'girselerdi parite ölçümü bozulurdu.',
          updatedAt: at },
        `RAW ${n(p.raw) ?? '?'} · PARSED ${n(p.parsed) ?? '?'}`
        + ` · AUTHORITY ${n(p.authority) ?? '?'} · UI ${n(p.ui) ?? '?'}`),
    p === null
      ? unavailable({ id: 'loss', label: 'Kayıp aşaması', source: 'obd/dtcPipelineAccounting',
          note: 'Künye yok.' })
      : p.lossStages.length === 0
        ? derived({ id: 'loss', label: 'Kayıp aşaması', source: 'obd/dtcPipelineAccounting',
            note: 'Katmanlar arası kayıp ölçülmedi. Bu "araç temiz" DEMEK DEĞİLDİR.',
            updatedAt: at }, 'KAYIP YOK')
        : observed({ id: 'loss', label: 'Kayıp aşaması',
            source: 'obd/dtcPipelineAccounting',
            note: 'Aynı turda birden çok aşama kayıp verebilir; biri diğerine indirgenmez.',
            updatedAt: at },
          p.lossStages.map((x) => DTC_PIPELINE_LOSS_LABEL[x]).join(' · ')),
    s.completeness === null
      ? unavailable({ id: 'ecu-cov', label: 'ECU keşif kapsamı', source: 'obd/ecuCompleteness',
          note: 'Kapsam kanıtı okunamadı.' })
      : derived({ id: 'ecu-cov', label: 'ECU keşif kapsamı',
          source: 'obd/ecuCompleteness',
          note: 'AYRI OTORİTE: bu ekran onu KOPYALAMAZ, referans verir. Payda '
            + 'bilinmiyorsa yüzde ÜRETİLMEZ (UNKNOWN).' },
        `${s.completeness.completenessLabel}`
        + ` · keşfedilen ${s.completeness.discovered}`
        + ` · taranan ${s.completeness.scanned}`
        + ` · ulaşılamayan ${s.completeness.notAddressable}`),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SAYIM (ekran başlığı)
   ══════════════════════════════════════════════════════════════════════════ */

export function countByCoverageClass(
  cards: readonly CoverageCard[],
): Readonly<Record<InspectorField['klass'], number>> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
