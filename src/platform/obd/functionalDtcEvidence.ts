/**
 * functionalDtcEvidence — P0-VDK-F2C1 · KANONİK PARSER KANIT DEFTERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Gözlemlenemeyen özellik tamamlanmış değildir." Yeni çözümleyici sessiz
 * kalırsa şu üç soru CAROS LAB'da yanıtlanamaz:
 *
 *   · bu turda kodları KİM çözdü — kanonik TS mi, legacy native mi?
 *   · kanonik ve native ÇELİŞTİ mi?
 *   · ham gövde neden otorite olamadı (yok mu, kırpık mı)?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ KANIT DEPOSU DEĞİLDİR.** `dtcScanEvidence` · `dtcPipelineAccounting`
 *     · `canonicalTrace` yerine geçmez; onların yanıtlayamadığı TEK soruyu
 *     (çözümü kim yaptı) yanıtlar ve mod başına SON turu tutar.
 * (2) **HAM GÖVDE TAŞIMAZ.** Yalnız ÖLÇÜMLER (bayt sayısı · kayıt adedi ·
 *     dolgu · artık) tutulur — LAB'a ham hex sızdırmaz.
 * (3) **HÜKÜM VERMEZ.** Kapsam ve verdict `dtcAuthority`/`verdictEngine`indir.
 *
 * Sınırlı (mod başına TEK kayıt) · süreç ömürlü · timer yok · I/O yok.
 */

import type { FunctionalDtcMode } from './functionalDtc';
import type { ReplayGapSignal } from './virtualTransport';
import type {
  FunctionalDtcProvenance, FunctionalDtcSourceResult,
  FunctionalParityStatus, FunctionalSourceBlock,
} from './functionalDtcSource';

/** Bir modun SON çözüm turunun ölçümleri. */
export interface FunctionalDtcEvidenceEntry {
  readonly mode: FunctionalDtcMode;
  readonly provenance: FunctionalDtcProvenance;
  readonly parity: FunctionalParityStatus;
  readonly parityDetail: string | null;
  readonly block: FunctionalSourceBlock | null;
  /** MEVCUT `DtcReadSemanticOutcome` sözlüğünden; kanonik çözüm yoksa `null`. */
  readonly parserOutcome: string | null;
  readonly malformedReason: string | null;
  /** Ham gövdenin hane sayısı (ölçüm) — gövdenin KENDİSİ taşınmaz. */
  readonly inputBytes: number | null;
  readonly recordsDecoded: number | null;
  readonly paddingRecords: number | null;
  readonly leftoverBytes: number | null;
  readonly positiveSid: string | null;
  readonly ecuAttribution: string | null;
  readonly bodyCount: number | null;
  /** Ürünün kullandığı kod adedi (otorite hangisiyse onun). */
  readonly authorityCodeCount: number;
  /** Replay koşusunda mı ölçüldü — canlı ölçümle karışmasın. */
  readonly replay: boolean;
}

const _entries = new Map<FunctionalDtcMode, FunctionalDtcEvidenceEntry>();

/** Sonucu deftere yazar. ASLA fırlatmaz — kanıt kaydı taramayı düşürmez. */
export function recordFunctionalDtcEvidence(
  r: FunctionalDtcSourceResult, replay: boolean,
): void {
  try {
    const p = r.parse;
    _entries.set(r.mode, Object.freeze({
      mode: r.mode,
      provenance: r.provenance,
      parity: r.parity,
      parityDetail: r.parityDetail,
      block: r.block,
      parserOutcome: p?.outcome ?? null,
      malformedReason: p?.malformedReason ?? null,
      inputBytes: p?.normalizedRaw.length ?? null,
      recordsDecoded: p === null ? null : p.records.length,
      paddingRecords: p?.paddingRecords ?? null,
      leftoverBytes: p?.leftoverBytes ?? null,
      positiveSid: p?.positiveSid ?? null,
      ecuAttribution: p?.ecuAttribution ?? null,
      bodyCount: p?.bodyCount ?? null,
      authorityCodeCount: r.codes.length,
      replay,
    }));
  } catch { /* kanıt kaydı ASLA taramayı düşürmez */ }
}

/** LAB salt-okuma yüzeyi — hiçbir şey tetiklemez, ASLA fırlatmaz. */
export function getFunctionalDtcEvidence(): readonly FunctionalDtcEvidenceEntry[] {
  try {
    return (['03', '07', '0A'] as const)
      .map((m) => _entries.get(m))
      .filter((e): e is FunctionalDtcEvidenceEntry => e !== undefined);
  } catch { return []; }
}

export function getFunctionalDtcEvidenceFor(
  mode: FunctionalDtcMode,
): FunctionalDtcEvidenceEntry | null {
  return _entries.get(mode) ?? null;
}

/** @internal — testler arası izolasyon. */
export function _resetFunctionalDtcEvidenceForTest(): void { _entries.clear(); }

/* ══════════════════════════════════════════════════════════════════════════
   YAPISAL BOŞLUK SİNYALLERİ — bugün ÇÖZÜLMEZ, KAYBOLMAZ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıttan yapısal boşluk sinyallerini TÜRETİR.
 *
 * ⚠️ Bu fazda hiçbiri otomatik çözülmez. Amaç, ileride Diagnostic Gap
 * Resolver'ın okuyacağı ayrımların BUGÜN kaybolmamasıdır — bugün atılan bir
 * sinyal yarın öğrenilemez.
 *
 * PARALEL OTORİTE KURULMAZ: sözlük MEVCUT `ReplayGapSignal`dır; burada yeni
 * bir sinyal evreni tanımlanmaz, yalnız ölçümden türetilir.
 */
export function functionalDtcGapSignals(
  entries: readonly FunctionalDtcEvidenceEntry[] = getFunctionalDtcEvidence(),
): readonly ReplayGapSignal[] {
  const out: ReplayGapSignal[] = [];
  const add = (s: ReplayGapSignal): void => { if (!out.includes(s)) out.push(s); };
  for (const e of entries) {
    if (e.provenance === 'LEGACY_NATIVE') add('LEGACY_NATIVE_ONLY');
    if (e.provenance === 'NONE') add('PARSER_GAP');
    if (e.parity === 'MISMATCH') add('PARSER_PARITY_MISMATCH');
    if (e.malformedReason === 'MISSING_POSITIVE_SID') add('UNEXPECTED_SID');
    if (e.malformedReason === 'PARTIAL_COUNT' || e.malformedReason === 'LEFTOVER_BYTES'
      || e.malformedReason === 'ODD_BODY_LENGTH' || e.malformedReason === 'NON_HEX_BODY') {
      add('MALFORMED_DTC_BODY');
    }
    if (e.malformedReason === 'TRUNCATED_INPUT') add('TRANSPORT_LIMITATION');
    if (e.ecuAttribution === 'UNKNOWN') add('UNKNOWN_ECU_ATTRIBUTION');
  }
  return out;
}
