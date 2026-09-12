/**
 * cddlPduRead — P0-VDK-F4A · ZİNCİRİN KAPANDIĞI YER.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA F4A'NIN KABUL KANITIDIR ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Görevin PASS ölçütü şu zincirin GERÇEK ürün yolunda çalışmasıdır:
 *
 *   CDDL `ServiceDef`
 *     → `buildPduFromServiceDef()`            (F3-B, saf)
 *     → `DiagnosticPdu`                       (F3-A sözleşmesi)
 *     → `vdkPduTransport()`                   (Real/Virtual TEK anahtar)
 *     → GENEL native salt-okunur köprü        (F4A · `sendDiagnosticPdu`)
 *     → HAM ECU yanıtı
 *     → MEVCUT ayrıştırıcı                    (`udsDtc` · `kwpDtc`)
 *     → `dtcAuthority`                        (kanonik defter)
 *
 * Bu dosya o zinciri kurar ve **yeni bir okuma otoritesi KURMAZ**: ayrıştırma
 * mevcut çözücülerdedir, kanıt mevcut defterlere yazılır, oturum/iptal kapısı
 * mevcut `diagnosticTransaction` otoritesindedir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **`multiEcuScan`'in YERİNE GEÇMEZ.** Tam araç taraması kanıtlanmış legacy
 *     yoldan gitmeye DEVAM EDER (F4A §6: generic kanıtlanmadan legacy kaldırılmaz).
 *     Burası, CDDL ile TANIMLANMIŞ salt-okunur servislerin yoludur.
 * (2) **İKİNCİ TARAMA ORKESTRASYONU DEĞİLDİR.** ECU keşfi · sıra · yeniden
 *     deneme · kapsam hesabı BURADA YOK; tek bir tanımın tek bir okumasıdır.
 * (3) **KARAR VERMEZ.** "Araç arızalı" hükmü `dtcVerdict`/`verdictEngine`indir.
 * (4) **YENİ SERVİS İÇİN DEĞİŞMEZ.** Yeni bir salt-okunur servis eklemek
 *     `legacyAdapter`a bir SATIR eklemektir; bu dosya ve native köprü AYNEN kalır.
 */

import { logError } from '../crashLogger';
import { buildPduFromServiceDef, type PduBuildRejection } from './cddl/serviceDef';
import type { EcuVariant, ProtocolClassName, ServiceDef } from './cddl/schema';
import { vdkPduTransport } from './vdkTransport';
import {
  advancedOutcomeFromPdu, encodePduRequest, isPduCoverageLoss,
  type DiagnosticPdu, type PduOutcome, type PduResponse,
} from './pdu';
import { parseUdsDtcResponse } from './udsDtc';
import { parseKwpDtcResponse } from './kwpDtc';
import {
  recordDtcObservation, recordDtcServiceScan,
  type DtcScanOutcome, type DtcSourceService,
} from './dtcAuthority';
import { normalizeAdvancedOutcome, recordAdvancedDtcEvidence } from './advancedDtcEvidence';
import {
  isTransactionLive, consumeRequest, acceptResponse,
  type DiagnosticTransaction,
} from './diagnosticTransaction';

/* ══════════════════════════════════════════════════════════════════════════
   1) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type CddlReadRejection =
  | PduBuildRejection
  /** Oturum mührü/iptal kapısı isteği ENGELLEDİ — istek GÖNDERİLMEDİ. */
  | 'TRANSACTION_NOT_LIVE'
  /** İstek bütçesi doldu. */
  | 'BUDGET_EXHAUSTED';

export interface CddlReadResult {
  /** İstek GERÇEKTEN gönderildi mi. */
  readonly sent: boolean;
  /** Kurulmuş PDU; kurulamadıysa `null`. */
  readonly pdu: DiagnosticPdu | null;
  /** Ham istek künyesi (`1902FF` · `190A`); kurulamadıysa `null`. */
  readonly request: string | null;
  /** Taşıma yanıtı; istek gitmediyse `null`. */
  readonly response: PduResponse | null;
  /** Gönderilmediyse gerekçe. */
  readonly rejection: CddlReadRejection | null;
  readonly detail: string | null;
  /** Ayrıştırılan kod adedi; ayrıştırma yapılmadıysa `null` (sahte 0 YASAK). */
  readonly parsedCodeCount: number | null;
}

function _reject(r: CddlReadRejection, detail: string): CddlReadResult {
  return {
    sent: false, pdu: null, request: null, response: null,
    rejection: r, detail, parsedCodeCount: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SÖZLÜK ÇEVİRİSİ — TEK YER, İKİNCİ SÖZLÜK YOK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `PduOutcome` → `DtcScanOutcome`.
 *
 * ⚠️ EN KRİTİK SATIR `unsupported` OLANIDIR: yalnız **AÇIK NEGATİF YANIT**
 * (`7F`) "araç bu servisi bilmiyor" demektir. Köprünün taşıyamaması
 * (`NOT_SUPPORTED_BY_TRANSPORT`) ve güvenlik kapısının reddi
 * (`DENIED_BY_SAFETY_GATE`) araç hakkında HİÇBİR ŞEY söylemez ve `unsupported`a
 * DÜŞÜRÜLEMEZ — düşürülürse ürün, sormadığı bir soruyu "araç desteklemiyor"
 * diye raporlar. İkisi kapsam kaybıdır (`failed`) ve gerekçe
 * `diagnosticOutcome` alanında AYNEN taşınır.
 */
export function dtcScanOutcomeFromPdu(o: PduOutcome): DtcScanOutcome {
  switch (o) {
    case 'POSITIVE':    return 'ok';
    case 'NEGATIVE':    return 'unsupported';
    case 'NO_RESPONSE': return 'no_data';
    case 'TIMEOUT':     return 'timeout';
    default:            return 'failed';
  }
}

/** DTC üreten servisler — bunlar için ayrıştırma + defter yazımı yapılır. */
const DTC_SERVICES: ReadonlySet<string> = new Set(['03', '07', '0A', '19', '18', '13']);

/* ══════════════════════════════════════════════════════════════════════════
   3) ÜRÜN YOLU
   ══════════════════════════════════════════════════════════════════════════ */

export interface CddlReadInput {
  readonly service: ServiceDef;
  readonly ecu: EcuVariant;
  readonly argument?: string | null;
  readonly protocol?: string | null;
  readonly protocolClass?: ProtocolClassName | 'unknown' | null;
  /** Oturum/iptal kapısı. Verilmezse kapı UYGULANMAZ ve bu AÇIKÇA belirtilir. */
  readonly txn?: DiagnosticTransaction | null;
  /** ECU adresi KANITLANMIŞ mı (KWP fiziksel hedef için ZORUNLU). */
  readonly targetVerified?: boolean;
  /** F1-C ISO-TP ayarı talebi; KWP'de native REDDEDER. */
  readonly isoTpTuning?: boolean;
  /** Kanonik ECU anahtarı (defter için); yoksa `null`. */
  readonly ecuKey?: string | null;
  readonly sessionEpoch?: number;
}

/**
 * Bir CDDL `ServiceDef`i gerçek araca sorar ve kanıtı MEVCUT deftere yazar.
 *
 * FAIL-CLOSED: PDU kurulamazsa, işlem canlı değilse ya da bütçe bittiyse
 * **istek GÖNDERİLMEZ** ve gerekçe döner. ASLA throw etmez — kanıt kaydı
 * ürünü düşüremez.
 */
export async function readByServiceDef(input: CddlReadInput): Promise<CddlReadResult> {
  const built = buildPduFromServiceDef({
    service: input.service,
    ecu: input.ecu,
    argument: input.argument ?? null,
    protocol: input.protocol ?? null,
    protocolClass: input.protocolClass ?? null,
  });
  if (!built.ok) return _reject(built.rejection, built.detail);

  const pdu = built.pdu;
  const request = encodePduRequest(pdu);

  /* ── OTURUM / İPTAL KAPISI ────────────────────────────────────────────
     Yeni bir kapı KURULMAZ: F1-A otoritesi aynen sorulur. Bayat oturum ya da
     iptal edilmiş işlem sonrası hatta TEK BAYT ÇIKMAZ. */
  const txn = input.txn ?? null;
  if (txn !== null) {
    if (!isTransactionLive(txn)) {
      return _reject('TRANSACTION_NOT_LIVE',
        `işlem canlı değil (${txn.lastDenial ?? txn.state}) — istek GÖNDERİLMEDİ`);
    }
    if (!consumeRequest(txn)) {
      return _reject('BUDGET_EXHAUSTED', 'istek bütçesi doldu — GÖNDERİLMEDİ');
    }
  }

  const response = await vdkPduTransport().send(pdu, {
    ...(input.targetVerified === true ? { targetVerified: true } : {}),
    ...(input.isoTpTuning === true ? { isoTpTuning: true } : {}),
  });

  /* Geç yanıt kapısı da F1-A'nındır: işlem bu arada öldüyse yanıt KABUL EDİLMEZ. */
  if (txn !== null && !acceptResponse(txn)) {
    return {
      sent: true, pdu, request, response,
      rejection: 'TRANSACTION_NOT_LIVE',
      detail: `yanıt geldi ama işlem artık canlı değil (${txn.lastDenial ?? txn.state}) — KABUL EDİLMEDİ`,
      parsedCodeCount: null,
    };
  }

  const parsedCodeCount = _recordEvidence(input, pdu, request, response);
  return {
    sent: true, pdu, request, response,
    rejection: null, detail: response.detail, parsedCodeCount,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KANIT YAZIMI — MEVCUT DEFTERLERE
   ══════════════════════════════════════════════════════════════════════════ */

function _recordEvidence(
  input: CddlReadInput, pdu: DiagnosticPdu, request: string, r: PduResponse,
): number | null {
  const epoch = input.sessionEpoch ?? -1;
  const svc = pdu.service;
  const isDtc = DTC_SERVICES.has(svc);

  try {
    /* (a) Gelişmiş DTC kanıt defteri — DTC servisleri için (mevcut defter). */
    if (isDtc) {
      recordAdvancedDtcEvidence({
        atMs: Date.now(), sessionEpoch: epoch,
        service: svc as '19' | '18' | '13',
        subFunction: pdu.subFunction ?? svc,
        tx: pdu.target.txHeader ?? '', rx: pdu.target.rxHeader ?? '',
        protocol: r.protocol,
        /* ÜÇÜNCÜ SÖZLÜK KURULMAZ: PDU → native sözlük çevirisi `pdu.ts`te,
           NRC ayrıştırması (`unsupported` / `security_required` /
           `condition_required`) `advancedDtcEvidence`tedir. İkisi de MEVCUT. */
        outcome: normalizeAdvancedOutcome(advancedOutcomeFromPdu(r.outcome), r.nrc),
        nrc: r.nrc, raw: r.raw,
        dtcs: [], statusBytes: [], statusAvailabilityMask: null,
        snapshotReferences: [], extendedDataReferences: [],
        error: r.detail,
      });
    }
  } catch (e) { logError('OBD:CddlPduEvidence', e); }

  if (!isDtc) return null;

  /* (b) AYRIŞTIRMA — MEVCUT çözücüler. Yeni çözücü YAZILMADI. */
  /* ── ALT KOD (failureType) TAŞINMAK ZORUNDA ────────────────────────────
     ÖLÇÜLEN KUSUR (bu tur, test tarafından yakalandı): UDS kaydında alt kod
     taşınmayınca `P0011(11)` ve `P0011(2F)` kayıtları `observationKey`de AYNI
     anahtara düşüyor ve biri diğerini EZİYOR. `dtcAuthority` bu ayrımı zaten
     anahtarına almış; burada alanı düşürmek o korumayı boşa çıkarırdı. */
  let codes: readonly {
    code: string; rawDtc?: string; status?: string; failureType?: string;
  }[] = [];
  let parsed: number | null = null;
  if (r.outcome === 'POSITIVE' && r.raw !== null && r.raw.length > 0) {
    try {
      if (svc === '19') {
        const uds = parseUdsDtcResponse(r.raw);
        codes = uds.map((d) => ({
          code: d.code, rawDtc: d.rawDtc, status: d.rawStatus, failureType: d.failureType,
        }));
      } else if (svc === '18' || svc === '13') {
        /* KWP DTC 2 BAYTTIR — alt kod YOKTUR ve UYDURULMAZ. */
        const kwp = parseKwpDtcResponse(r.raw);
        codes = kwp.map((d) => ({ code: d.code, rawDtc: d.rawDtc, status: d.rawStatus }));
      }
      parsed = codes.length;
    } catch (e) {
      logError('OBD:CddlPduParse', e);
      parsed = null;
    }
  }

  /* (c) KANONİK DEFTER. `recordDtcServiceScan` HER TURDA çağrılır — gözlem
     olmasa bile: "0 kod" hükmü ancak buradan doğar (mevcut sözleşme). */
  try {
    const outcome = dtcScanOutcomeFromPdu(r.outcome);
    const functional = pdu.target.addressing === 'functional';
    for (const c of codes) {
      recordDtcObservation({
        dtcCode: c.code,
        dtcClass: svc === '19' ? 'UDS' : svc === '18' || svc === '13' ? 'KWP'
          : svc === '07' ? 'PENDING' : svc === '0A' ? 'PERMANENT' : 'CONFIRMED',
        ecuKey: functional ? null : (input.ecuKey ?? null),
        ecuRole: null,
        rxHeader: pdu.target.rxHeader, txHeader: pdu.target.txHeader,
        protocol: r.protocol, sessionEpoch: epoch,
        sourceService: svc as DtcSourceService,
        provenance: functional ? 'functional_7DF' : 'physical_ecu',
        ...(c.status !== undefined ? { rawStatusByte: c.status } : {}),
        ...(c.rawDtc !== undefined ? { rawDtc: c.rawDtc } : {}),
        ...(c.failureType !== undefined && c.failureType.length > 0
          ? { failureType: c.failureType } : {}),
        ...(pdu.subFunction !== null ? { sourceSubFunction: pdu.subFunction } : {}),
      });
    }
    recordDtcServiceScan({
      service: svc as DtcSourceService,
      ecuKey: functional ? null : (input.ecuKey ?? null),
      ecuRole: null,
      txHeader: pdu.target.txHeader,
      outcome, sessionEpoch: epoch,
      codeCount: outcome === 'ok' ? (parsed ?? 0) : 0,
      protocol: r.protocol,
      /* Kapsam kaybının GERÇEK gerekçesi burada kaybolmaz: "köprü taşıyamadı"
         ile "güvenlik reddetti" ile "hat düştü" ayrı ayrı görünür. */
      diagnosticOutcome: isPduCoverageLoss(r.outcome)
        ? `${r.outcome}${r.detail === null ? '' : ` · ${r.detail}`}`
        : r.outcome,
    });
  } catch (e) { logError('OBD:CddlPduAuthority', e); }

  void request;
  return parsed;
}
