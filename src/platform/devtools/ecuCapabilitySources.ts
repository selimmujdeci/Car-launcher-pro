/**
 * ecuCapabilitySources — CAROS LAB · ECU YETENEK KÜNYESİ TEK OKUMA KATMANI.
 *
 * Desen (A3–A8 turlarıyla AYNI): senkron getter, her biri KENDİ try/catch'i
 * içinde. HİÇBİR tarama başlatmaz, komut göndermez, timer kurmaz, defter YAZMAZ.
 *
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * Ürünün BEŞ ayrı defterini (`ecuAddressability` · `dtcAuthority` scans ·
 * `advancedDtcEvidence` · `kwpSessionProbe` · `dtcPipelineAccounting`) okuyup
 * `ecuCapabilityModel`in SAF projeksiyonuna verir. Yeni ölçüm ÜRETMEZ.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Taşınan tek şey OBD protokol verisidir (ECU adresi/rolü · servis numarası ·
 * NRC · ham hex yanıt · kod adedi). **VIN · konum · kullanıcı verisi · API
 * anahtarı BU KATMANDAN GEÇMEZ** (CLAUDE.md gözlemlenebilirlik kuralı 6).
 */

import {
  buildEcuCapability, summarizeEcuCapabilities, evaluateEcuClearReadiness,
  type EcuCapability, type EcuCapabilityInput, type EcuCapabilitySummary,
  type EcuAddressingState, type EcuSessionState, type EcuClearReadiness,
} from '../obd/ecuCapabilityModel';
import { getEcuObservations, type EcuDiscoveryObservation } from '../obd/ecuAddressability';
import { getDtcAuthoritySnapshot, type DtcServiceScan } from '../obd/dtcAuthority';
import { getAdvancedDtcEvidence, type AdvancedDtcEvidenceEntry } from '../obd/advancedDtcEvidence';
import { getKwpSessionProbes, summarizeKwpSession } from '../obd/kwpSessionProbe';
import { getObdSessionEpoch } from '../obdService';

export interface EcuCapabilityRow {
  readonly capability: EcuCapability;
  /** ⚠️ İZİN DEĞİL — silme için gereken KANIT ZİNCİRİNİN tamlığı. */
  readonly clearReadiness: EcuClearReadiness;
}

export interface EcuCapabilitySnapshot {
  readonly readAt: number;
  /** ŞU ANKİ OBD oturumu; okunamazsa `null` (sahte `0` YASAK). */
  readonly sessionEpoch: number | null;
  readonly rows: readonly EcuCapabilityRow[];
  readonly summary: EcuCapabilitySummary;
  /**
   * Hiç ECU gözlemi YOK. Bu "araçta ECU yok" DEĞİL, "tam araç taraması bu
   * oturumda hiç koşmadı" demektir — ekran bu cümleyi AÇIKÇA yazar.
   */
  readonly empty: boolean;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** `EcuAddressability` → künye adres durumu. Bilinmeyen `UNKNOWN` KALIR. */
function _addressingOf(o: EcuDiscoveryObservation): EcuAddressingState {
  return o.addressability === 'PROVEN' ? 'PROVEN'
    : o.addressability === 'NOT_ADDRESSABLE' ? 'NOT_ADDRESSABLE' : 'UNKNOWN';
}

/**
 * Oturum durumu — YALNIZ ÖLÇÜLDÜYSE yazılır.
 *
 * CAN hattında KWP oturum probu hiç koşmaz; orada `NOT_REQUIRED` doğru
 * cevaptır (varsayılan oturum yeter ve bu ISO 15765-4 garantisidir).
 * K-line'da prob koştuysa sonucu taşınır, koşmadıysa `UNKNOWN`.
 */
function _sessionOf(o: EcuDiscoveryObservation, epoch: number): EcuSessionState {
  if (o.txHeader === null) return 'UNKNOWN';
  if (o.addressBits !== 8) return 'NOT_REQUIRED';   // CAN — KWP oturumu kavramı yok
  const v = _safe(() => summarizeKwpSession(getKwpSessionProbes(), o.txHeader!, epoch), null);
  if (v === null) return 'UNKNOWN';
  if (v.proven) return 'OPENED';
  return v.result === 'NEGATIVE' ? 'REFUSED' : 'UNKNOWN';
}

/** `${service}|${subFunction}` anahtarı — kanonik satırlarla AYNI dil. */
function _rowKey(service: string, subFunction: string): string {
  return `${service}|${subFunction}`;
}

/**
 * Bir ECU için ölçülen servis sonuçlarını toplar.
 *
 * İKİ KAYNAK BİRLEŞTİRİLİR ve biri diğerini EZMEZ:
 *  · `dtcAuthority` scans → kanonik sonuç + kod adedi (servis bazında)
 *  · `advancedDtcEvidence` → alt fonksiyon ayrımı + ham yanıt + NRC
 *
 * UDS'te alt fonksiyon ayrımı (0x02 vs 0x0A) YALNIZ ikinci kaynakta vardır;
 * birincisi ikisini tek '19' satırında toplar. Bu yüzden 0x19 satırları
 * ÖNCE kanonik sonuçla doldurulur, SONRA ham kanıtla İNCELTİLİR.
 */
function _measuredFor(
  o: EcuDiscoveryObservation,
  scans: readonly DtcServiceScan[],
  advanced: readonly AdvancedDtcEvidenceEntry[],
  epoch: number,
): Map<string, {
  outcome: DtcServiceScan['outcome'] | null;
  codeCount: number | null;
  diagnosticOutcome?: string | null;
  raw?: string | null;
  nrc?: number | null;
}> {
  const out = new Map<string, {
    outcome: DtcServiceScan['outcome'] | null;
    codeCount: number | null;
    diagnosticOutcome?: string | null;
    raw?: string | null;
    nrc?: number | null;
  }>();

  /* 1) Standart modlar (03/07/0A) — yalnız kanonik defterde yaşar. */
  for (const s of scans) {
    if (s.sessionEpoch !== epoch) continue;
    if (s.txHeader !== o.txHeader) continue;
    const sub = s.service === '19' ? '02' : s.service;
    out.set(_rowKey(s.service, sub), {
      outcome: s.outcome,
      codeCount: s.outcome === 'ok' ? s.codeCount : null,
      diagnosticOutcome: s.diagnosticOutcome ?? null,
    });
  }

  /* 2) Gelişmiş servisler — alt fonksiyon ayrımı + ham yanıt + NRC.
        Aynı (servis, alt fonksiyon) için EN SON kayıt kazanır (tur içinde
        kanıt büyür); eski satır yeni ölçümü ezmemeli. */
  for (const e of advanced) {
    if (e.sessionEpoch !== epoch) continue;
    if (e.tx !== o.txHeader) continue;
    /* 0x19-01/03/06 yardımcı sorgulardır, DTC listesi üretmezler → künyede
       ayrı satır AÇILMAZ (gürültü). Yalnız 02 ve 0A kayıt taşır. */
    if (e.service === '19' && e.subFunction !== '02' && e.subFunction !== '0A') continue;
    const sub = e.service === '19' ? e.subFunction : e.service;
    const outcome: DtcServiceScan['outcome'] | null =
      e.outcome === 'ok' ? 'ok'
        : e.outcome === 'unsupported' ? 'unsupported'
          : e.outcome === 'no_response' ? 'no_data'
            : e.outcome === 'timeout' ? 'timeout'
              : e.outcome === 'not_addressable' ? null
                : 'failed';
    out.set(_rowKey(e.service, sub), {
      outcome,
      codeCount: e.outcome === 'ok' ? e.dtcs.length : null,
      diagnosticOutcome: e.outcome,
      raw: e.raw,
      nrc: e.nrc,
    });
  }

  return out;
}

/** Tek senkron okuma. ASLA throw etmez. */
export function readEcuCapabilitySnapshot(): EcuCapabilitySnapshot {
  const epoch = _safe<number | null>(() => getObdSessionEpoch(), null);
  const observations = _safe(() => getEcuObservations(), [] as readonly EcuDiscoveryObservation[]);
  const snap = _safe(() => getDtcAuthoritySnapshot(), null);
  const advanced = _safe(() => getAdvancedDtcEvidence(), [] as readonly AdvancedDtcEvidenceEntry[]);

  /* Oturum mühürü: BAŞKA bir OBD oturumunun gözlemi bu künyeye GİRMEZ.
     Epoch okunamadıysa hiçbir kayıt gösterilmez — bayat kanıtı taze gibi
     sunmak, bu ürünün defalarca düzelttiği sessiz yalan sınıfıdır. */
  const scoped = epoch === null ? [] : observations.filter((o) => o.sessionEpoch === epoch);

  const rows: EcuCapabilityRow[] = scoped.map((o) => {
    const input: EcuCapabilityInput = {
      rxHeader: o.rxHeader,
      txHeader: o.txHeader,
      label: o.label,
      /* 'unknown' bir rol DEĞİL, kanıt yokluğudur → null. */
      role: o.role === 'unknown' ? null : o.role,
      addressBits: o.addressBits,
      protocol: o.protocol,
      addressing: _addressingOf(o),
      addressingReason: o.addressabilityReason,
      session: _sessionOf(o, epoch ?? -1),
      sessionEpoch: o.sessionEpoch,
      lastValidatedAtMs: o.atMs,
      measured: _measuredFor(o, snap?.scans ?? [], advanced, epoch ?? -1),
    };
    const capability = _safe(() => buildEcuCapability(input), {
      ...input, services: [], totalCodes: null, confidence: null, coverageGaps: [],
    } as unknown as EcuCapability);
    return { capability, clearReadiness: _safe(() => evaluateEcuClearReadiness(capability), 'BLOCKED') };
  });

  return {
    readAt: Date.now(),
    sessionEpoch: epoch,
    rows,
    summary: _safe(() => summarizeEcuCapabilities(rows.map((r) => r.capability)),
      { ecuCount: 0, provenCount: 0, notAddressableCount: 0, totalCodes: null, fullCoverageProven: false, gapCount: 0 }),
    empty: rows.length === 0,
  };
}
