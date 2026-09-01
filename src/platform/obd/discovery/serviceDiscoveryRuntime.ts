/**
 * serviceDiscoveryRuntime — P0-VDK-F4B · SERVİS KEŞFİ KOŞUCUSU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ZİNCİR ────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   CDDL `ServiceDef` × `EcuVariant`
 *     → `buildPduFromServiceDef()`           (F3-B, saf)
 *     → `DiagnosticPdu`                      (F3-A)
 *     → `vdkPduTransport()`                  (Real/Virtual TEK anahtar)
 *     → F4-A GENEL salt-okunur köprü
 *     → GERÇEK ECU yanıtı
 *     → `deriveServicePresence()`            (mevcut yetenek otoritesi)
 *     → probe defteri + `gapRegistry`
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE KURMAZ ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **KENDİ OTURUM MOTORUNU KURMAZ.** Oturum kapısı F1-B `canReadUnderLease`
 *     ile SORULUR; TesterPresent/keepalive burada TETİKLENMEZ.
 * (2) **KENDİ BÜTÇESİNİ KURMAZ.** İstek ve süre bütçesi F1-A
 *     `DiagnosticTransaction`tan gelir. Bütçe bitince sonuç **`ABSENT` DEĞİL
 *     `DEFERRED`**tir — yarım kalan bir tarama, yokluk kanıtı değildir.
 * (3) **KENDİ TAŞIMASINI KURMAZ.** F4-A köprüsünü `vdkPduTransport()`
 *     üzerinden kullanır; replay aktifken sanal taşımaya kendiliğinden düşer.
 * (4) **ÖĞRENMEZ.** FleetMemory/Learning/Self-Healing/profil güveni yükseltme
 *     YOKTUR. Defter süreç ömürlüdür; diske ve buluta yazmaz.
 * (5) **KÖR TARAMA YAPMAZ.** Adaylar yalnız CDDL tanımlarından gelir.
 */

import { logError } from '../../crashLogger';
import { buildPduFromServiceDef } from '../cddl/serviceDef';
import type { EcuVariant, ProtocolClassName, ServiceDef } from '../cddl/schema';
import { vdkPduTransport } from '../vdkTransport';
import { encodePduRequest, type DiagnosticPdu, type PduResponse } from '../pdu';
import {
  deriveServicePresence, isServiceProbablyPresent,
  type ServicePresence,
} from '../ecuCapabilityModel';
import {
  buildProbeCorpus, expandSubFunctionProbes, gapSignalForPresence,
  mergeProbeRecord, presenceReason, probeKey, summarizeProbes,
  type DiscoverySummary, type ProbeCorpus, type ProbeExclusion,
  type ProbeRecord, type ProbeSpec,
} from './serviceProbeModel';
import { recordGap } from '../gapRegistry';
/* P0-VDK-F5D — boşluk kaydı KENDİ kanıt zarfını taşır (tek kanonik kurucu). */
import { buildGapEvidence, type GapEvidence } from '../gapEvidence';
import { traceFromTransaction } from '../traceRecorder';
import type { TraceOperation } from '../canonicalTrace';
import {
  isTransactionLive, consumeRequest, acceptResponse,
  type DiagnosticTransaction,
} from '../diagnosticTransaction';
import {
  canReadUnderLease, leaseDenialReason,
  type DiagnosticSessionLease,
} from '../diagnosticSessionLease';
/* P0-VDK-F4C — öğrenme belleği. Keşif YENİ bir yetenek otoritesi kurmaz;
   ölçtüğünü çizgeye yazar ve taze/kanıtlı kayıt varsa yoklamayı ATLAR. */
import {
  decideReuse, edgeKey, REUSE_DECISION_LABEL,
  type CapabilityProvenance, type ReuseDecision, type TransportConstraint,
} from '../capability/capabilityGraph';
import {
  getCapabilityEdge, noteProbeReused, recordCapabilityObservation,
} from '../capability/capabilityStore';

/* ══════════════════════════════════════════════════════════════════════════
   1) DEFTER — sınırlı, süreç ömürlü
   ══════════════════════════════════════════════════════════════════════════ */

/** Tavan — sınırsız defter cihazda bellek sorunudur. */
export const MAX_PROBE_RECORDS = 240;

const _records = new Map<string, ProbeRecord>();
const _exclusions: ProbeExclusion[] = [];
let _dropped = 0;
/** Hiç koşu YAPILMADI mı — ekranda `0` yerine "KAYNAK YOK" demek için. */
let _runCount = 0;

export function getProbeRecords(): readonly ProbeRecord[] {
  return [..._records.values()];
}

export function getProbeExclusions(): readonly ProbeExclusion[] {
  return [..._exclusions];
}

export function getDiscoveryRunCount(): number { return _runCount; }
export function getDiscoveryDropped(): number { return _dropped; }

export function getDiscoverySummary(): DiscoverySummary {
  return summarizeProbes(getProbeRecords());
}

/**
 * P0-VDK-F5F — ARAÇ TAKASINDA YOKLAMA DEFTERİNİ AYIR.
 *
 * Defter süreç ömürlüdür ve araç kimliği TAŞIMAZ: Araç A'da ölçülmüş bir
 * `7E0 · 19 · 0x22` kaydı, Araç B bağlandığında hâlâ bellektedir ve
 * (kanıtsız/eski bir boşluk için) yanlışlıkla B'nin kanıtı sanılabilirdi.
 * Araç değişince defter BOŞALIR — "bu ölçüm hangi araçtandı" sorusunu
 * yanıtlayamayan bir kayıt, yeni araçta kanıt SAYILAMAZ.
 *
 * ⚠️ Bu bir test kancası DEĞİLDİR: üretim yolu `productionDiscovery`
 * araç kapsamı değiştiğinde çağırır. Sayaçlar SIFIRLANMAZ — kaç koşu
 * yapıldığı aracı aşan bir gerçektir.
 */
export function detachProbeLedgerForVehicleSwitch(): void {
  _records.clear();
  _exclusions.length = 0;
}

export function _resetServiceDiscoveryForTest(): void {
  _records.clear();
  _exclusions.length = 0;
  _dropped = 0;
  _runCount = 0;
}

function _store(rec: ProbeRecord): void {
  const k = probeKey(rec);
  const prev = _records.get(k) ?? null;
  if (prev === null && _records.size >= MAX_PROBE_RECORDS) { _dropped++; return; }
  _records.set(k, mergeProbeRecord(prev, rec));
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KOŞU
   ══════════════════════════════════════════════════════════════════════════ */

/** Koşunun NEDEN bittiği — "bitti" ile "yarıda kaldı" ASLA aynı değildir. */
export type DiscoveryStopReason =
  /** Korpusun tamamı yoklandı. */
  | 'COMPLETED'
  /** F1-A istek/süre bütçesi doldu. */
  | 'BUDGET_EXHAUSTED'
  /** İşlem iptal edildi ya da oturum mührü bayatladı. */
  | 'TRANSACTION_NOT_LIVE'
  /** F1-B kirası okumaya izin vermiyor. */
  | 'SESSION_DENIED'
  /** Korpus boş (ECU hiçbir salt-okunur tanımı saymıyor). */
  | 'EMPTY_CORPUS';

export const DISCOVERY_STOP_LABEL: Readonly<Record<DiscoveryStopReason, string>> = {
  COMPLETED:            'korpus tamamlandı',
  BUDGET_EXHAUSTED:     'bütçe doldu — YARIM KALDI',
  TRANSACTION_NOT_LIVE: 'işlem canlı değil — YARIM KALDI',
  SESSION_DENIED:       'oturum izin vermedi — YARIM KALDI',
  EMPTY_CORPUS:         'yoklanacak tanım yok',
} as const;

export interface ServiceDiscoveryInput {
  readonly defs: readonly ServiceDef[];
  readonly ecu: EcuVariant;
  readonly protocolClass?: ProtocolClassName | 'unknown' | null;
  readonly protocol?: string | null;
  /** F1-A bütçe/oturum kapısı. `null` ise kapı UYGULANMAZ (yalnız test/replay). */
  readonly txn: DiagnosticTransaction | null;
  /** F1-B kirası. `null` = kira sorusu sorulmaz (varsayılan oturum). */
  readonly lease?: DiagnosticSessionLease | null;
  readonly ecuKey?: string | null;
  readonly targetVerified?: boolean;
  /**
   * P0-VDK-F5A — F1-C ISO-TP akış kontrolü UYGULANARAK ölç.
   *
   * Yeni bir yetenek DEĞİLDİR: `PduSendOptions.isoTpTuning` (F1-C) zaten
   * vardı ve native köprü geri yüklemeyi GARANTİ ediyor; keşif yolu bu
   * anahtarı yalnızca TAŞIMIYORDU. Self-Healing çözücüsü BUFFER_FULL /
   * TRUNCATED boşluğunu kapatmak için aynı salt-okunur yoklamayı akış
   * kontrolü açıkken tekrarlar. Varsayılan `false` — davranış DEĞİŞMEDİ.
   */
  readonly isoTpTuning?: boolean;
  readonly sessionEpoch?: number;
  /** Damga ENJEKTE edilir — `Date.now` bu modülde ÇAĞRILMAZ. */
  readonly nowMs?: number | null;
  /** Alt fonksiyon keşfi yapılsın mı (varsayılan: evet). */
  readonly probeSubFunctions?: boolean;

  /* ── P0-VDK-F4C · ÖĞRENME BAĞLAMI (hepsi isteğe bağlı) ──────────────── */
  /** Araç parmak izi kimliği; `null` = öğrenme YAZILMAZ ve OKUNMAZ. */
  readonly vehicleId?: string | null;
  /** ECU parmak izi kimliği; `null` = öğrenme YAZILMAZ ve OKUNMAZ. */
  readonly ecuId?: string | null;
  /** Parmak izi yeniden kullanıma yetiyor mu (`isFingerprintReusable`). */
  readonly fingerprintReusable?: boolean;
  /** Kanıt kaynağı — YALNIZ `live` ürün öğrenmesi üretir. */
  readonly provenance?: CapabilityProvenance;
  /** Ölçüm anındaki taşıma koşulu; araç yeteneğiyle KARIŞTIRILMAZ. */
  readonly transport?: TransportConstraint;
  /** Öğrenilmiş taze kayıtla yoklama atlansın mı (varsayılan: evet). */
  readonly reuseLearning?: boolean;
}

export interface ServiceDiscoveryResult {
  readonly stopReason: DiscoveryStopReason;
  readonly probesSent: number;
  readonly records: readonly ProbeRecord[];
  readonly excluded: readonly ProbeExclusion[];
  readonly summary: DiscoverySummary;
  /** Yoklanmadan bırakılan adaylar — `DEFERRED` olarak kaydedildi. */
  readonly deferred: number;
  /** P0-VDK-F4C — öğrenme sayesinde ATLANAN yoklama sayısı (ölçüm). */
  readonly reused: number;
}

function _operationOf(service: string): TraceOperation {
  switch (service) {
    case '19': return 'uds_19';
    case '18': return 'kwp_18';
    case '13': return 'kwp_13';
    case '03': return 'mode03';
    case '07': return 'mode07';
    case '0A': return 'mode0A';
    case '3E': return 'tester_present';
    case '10': return 'session_open';
    default:   return 'ecu_probe';
  }
}

/**
 * Bir ECU'nun salt-okunur servis haritasını ÖLÇEREK çıkarır.
 *
 * ASLA throw etmez: bir yoklamanın düşmesi koşuyu düşürmez, kanıt olarak
 * kaydedilir ve sıradakine geçilir.
 */
export async function runServiceDiscovery(
  input: ServiceDiscoveryInput,
): Promise<ServiceDiscoveryResult> {
  _runCount++;
  const now = input.nowMs ?? null;
  const corpus = buildProbeCorpus(
    input.defs, input.ecu, input.protocolClass ?? null);
  for (const e of corpus.excluded) _exclusions.push(e);

  /* Korpus dışı bırakılanlar da KAYDEDİLİR: "yoklanmadı" bir sonuçtur. */
  for (const e of corpus.excluded) {
    if (e.reason === 'DESTRUCTIVE_DEF' || e.reason === 'HARD_FORBIDDEN'
        || e.reason === 'SAFETY_GATE') {
      _store(_forbiddenRecord(input, e, now));
    }
  }

  if (corpus.specs.length === 0) {
    return _result('EMPTY_CORPUS', 0, corpus, 0);
  }

  let sent = 0;
  let deferred = 0;
  let reused = 0;
  const probedKeys = new Set<string>();
  const queue: ProbeSpec[] = [...corpus.specs];
  let stop: DiscoveryStopReason = 'COMPLETED';

  while (queue.length > 0) {
    const spec = queue.shift()!;

    /* ── P0-VDK-F4C · ÖĞRENME YENİDEN KULLANIMI ───────────────────────────
       Taze, kanıtlı ve ÜRÜN-GÜVENİLİR bir kayıt varsa istek GÖNDERİLMEZ.
       Karar `capabilityGraph.decideReuse`tedir; burada TEK KURAL kopyalanmaz.
       Atlama SESSİZ DEĞİLDİR: kayıt `reusedFromLearning` bayrağı ve gerekçesiyle
       yazılır — kullanıcıya "şimdi ölçtüm" izlenimi verilmez. */
    const learned = _learnedEdge(input, spec);
    if (learned !== null) {
      _store(_reuseRecord(input, spec, learned.edge, now));
      noteProbeReused(1);
      reused++;
      /* Öğrenilmiş servis MEVCUTSA alt fonksiyon keşfi yine açılır — ama o
         adaylar da tek tek yeniden kullanım kapısından geçer. */
      _maybeExpand(input, spec, learned.edge.presence, probedKeys, queue);
      probedKeys.add(`${spec.service}|${spec.subFunction ?? ''}`);
      continue;
    }

    /* ── KAPILAR (mevcut otoriteler; kopya kural YOK) ─────────────────── */
    const gate = _gate(input);
    if (gate !== null) {
      stop = gate;
      /* Kalan HER aday `DEFERRED` yazılır — sessizce yok sayılmaz ve
         hiçbiri "servis yok" sayılmaz. */
      _store(_deferredRecord(input, spec, now, gate));
      deferred++;
      for (const rest of queue) { _store(_deferredRecord(input, rest, now, gate)); deferred++; }
      break;
    }
    if (input.txn !== null && !consumeRequest(input.txn)) {
      stop = 'BUDGET_EXHAUSTED';
      _store(_deferredRecord(input, spec, now, stop));
      deferred++;
      for (const rest of queue) { _store(_deferredRecord(input, rest, now, stop)); deferred++; }
      break;
    }

    const rec = await _probe(input, spec, now);
    sent++;
    probedKeys.add(`${spec.service}|${spec.subFunction ?? ''}`);
    _store(rec);
    /* ÖĞRENME YAZIMI — ölçtüğümüzü çizgeye işleriz. Politika (UNKNOWN ezmez,
       kota, provenance) `capabilityGraph`tadır; burada yeniden yazılmaz. */
    _learn(input, spec, rec, now);

    /* Geç yanıt kapısı — işlem bu arada öldüyse yanıt KABUL EDİLMEZ. */
    if (input.txn !== null && !acceptResponse(input.txn)) {
      stop = 'TRANSACTION_NOT_LIVE';
      for (const rest of queue) { _store(_deferredRecord(input, rest, now, stop)); deferred++; }
      break;
    }

    /* ── ALT FONKSİYON KEŞFİ — yalnız servis MEVCUTSA ─────────────────── */
    _maybeExpand(input, spec, rec.classification, probedKeys, queue);
  }

  return _result(stop, sent, corpus, deferred, reused);
}

/** Alt fonksiyon genişletmesi — tek yer (yeniden kullanım dalı da bunu çağırır). */
function _maybeExpand(
  input: ServiceDiscoveryInput, spec: ProbeSpec, presence: ServicePresence,
  probedKeys: ReadonlySet<string>, queue: ProbeSpec[],
): void {
  if (input.probeSubFunctions === false || spec.isSubFunctionProbe) return;
  if (!isServiceProbablyPresent(presence)) return;
  const def = input.defs.find((d) => d.id === spec.serviceDefId);
  if (!def) return;
  const sub = expandSubFunctionProbes(def, input.ecu, presence, probedKeys);
  for (const e of sub.excluded) _exclusions.push(e);
  for (const sp of sub.specs) queue.push(sp);
}

/* ══════════════════════════════════════════════════════════════════════════
   2b) ÖĞRENME KÖPRÜSÜ — politika `capabilityGraph`ta, burada YALNIZ bağlama
   ══════════════════════════════════════════════════════════════════════════ */

function _transportOf(input: ServiceDiscoveryInput): TransportConstraint {
  return input.transport ?? { genericBridge: null, routePolicy: null, adapterHash: null };
}

/** Öğrenme bağlamı eksikse `null` — kimliksiz öğrenme YAZILMAZ/OKUNMAZ. */
function _ids(input: ServiceDiscoveryInput): { v: string; e: string } | null {
  const v = input.vehicleId ?? null;
  const e = input.ecuId ?? null;
  return v !== null && v.length > 0 && e !== null && e.length > 0 ? { v, e } : null;
}

/** Taze/kanıtlı kayıt varsa onu döner; yoksa `null` (ölçülecek). */
function _learnedEdge(
  input: ServiceDiscoveryInput, spec: ProbeSpec,
): { edge: import('../capability/capabilityGraph').CapabilityEdge } | null {
  if (input.reuseLearning === false) return null;
  const ids = _ids(input);
  if (ids === null) return null;
  try {
    const edge = getCapabilityEdge(ids.v, ids.e, spec.service, spec.subFunction);
    const decision: ReuseDecision = decideReuse(edge, {
      nowMs: input.nowMs ?? null,
      fingerprintReusable: input.fingerprintReusable === true,
      transport: _transportOf(input),
      /* ── P0-VDK-F6E-2 · PROTOKOL İZOLASYONU KEŞİF YOLUNDA DA GEÇERLİ ─────
         ÖLÇÜLEN KUSUR: F6E-1 `decideReuse`a protokol kapısını ekledi ama bu
         çağrı alanı BİLDİRMİYORDU → `ctx.protocol === undefined` → kapı
         UYGULANMIYORDU. Sonuç: CAN'de öğrenilmiş bir kenar KWP keşfinde
         `REUSE` üretip yoklamayı atlayabiliyordu (ve tersi). `edgeKey`
         protokol içermediği için iki hattın ölçümü zaten AYNI kenardadır;
         ayrım yalnız burada yapılabilir.

         `?? null` BİLİNÇLİDİR — `undefined` GEÇİLMEZ: `undefined` kapıyı
         bypass eder, `null` ise "protokol ÖLÇÜLEMEDİ" demektir ve
         fail-closed olarak yeniden ölçüm ürettirir. Protokol UYDURULMAZ.

         KAYNAK YENİ DEĞİL: `input.protocol` bu arayüzde ZATEN vardı ve
         `_learn` kenarı yazarken de kullanılıyordu (`rec.protocol` →
         `response?.protocol ?? input.protocol`). Yeni bir protokol
         algılayıcısı KURULMADI. */
      protocol: input.protocol ?? null,
    });
    return decision === 'REUSE' && edge !== null ? { edge } : null;
  } catch (e) {
    logError('OBD:CapabilityReuse', e);
    return null;   // FAIL-CLOSED: kararsızsak ÖLÇERİZ
  }
}

function _learn(
  input: ServiceDiscoveryInput, spec: ProbeSpec, rec: ProbeRecord, now: number | null,
): void {
  const ids = _ids(input);
  if (ids === null) return;
  try {
    recordCapabilityObservation({
      vehicleId: ids.v, ecuId: ids.e,
      service: spec.service, subFunction: spec.subFunction,
      presence: rec.classification,
      /* Kaynak BELİRTİLMEDİYSE `live` VARSAYILMAZ: kanıtlanmamış bir kaynak
         ürün öğrenmesi üretemez (F4-C §8). */
      provenance: input.provenance ?? 'synthetic',
      protocol: rec.protocol,
      transport: _transportOf(input),
      evidenceRef: rec.traceCorrelationId,
      nrc: rec.nrc,
      atMs: now,
    }, true);
  } catch (e) { logError('OBD:CapabilityLearn', e); }
}

function _result(
  stopReason: DiscoveryStopReason, probesSent: number,
  corpus: ProbeCorpus, deferred: number, reused = 0,
): ServiceDiscoveryResult {
  const records = getProbeRecords();
  return {
    stopReason, probesSent, records,
    excluded: corpus.excluded,
    summary: summarizeProbes(records),
    deferred, reused,
  };
}

/** Mevcut kapıları SORAR; hiçbirini kopyalamaz. */
function _gate(input: ServiceDiscoveryInput): DiscoveryStopReason | null {
  if (input.txn !== null && !isTransactionLive(input.txn)) return 'TRANSACTION_NOT_LIVE';
  if (input.lease != null && !canReadUnderLease(input.lease)) return 'SESSION_DENIED';
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) TEK YOKLAMA
   ══════════════════════════════════════════════════════════════════════════ */

async function _probe(
  input: ServiceDiscoveryInput, spec: ProbeSpec, now: number | null,
): Promise<ProbeRecord> {
  const def = input.defs.find((d) => d.id === spec.serviceDefId);
  /* Alt fonksiyon yoklamasında tanımın sabit alt fonksiyonu DEĞİL, spec'inki
     kullanılır — bu yüzden PDU doğrudan tanım+override ile kurulur. */
  const built = def
    ? buildPduFromServiceDef({
      service: spec.isSubFunctionProbe
        ? { ...def, subFunction: spec.subFunction, argKind: 'literal',
          literalPayload: spec.payload, responseEchoBytes: spec.responseEchoBytes }
        : def,
      ecu: input.ecu,
      protocol: input.protocol ?? null,
      protocolClass: input.protocolClass ?? null,
    })
    : null;

  if (built === null || !built.ok) {
    const reason = built === null ? 'CDDL tanımı bulunamadı'
      : `${built.rejection}: ${built.detail}`;
    return _record(input, spec, null, null, 'UNKNOWN_ADDRESSING', reason, now);
  }

  const pdu = built.pdu;
  let response: PduResponse;
  try {
    response = await vdkPduTransport().send(pdu, {
      ...(input.targetVerified === true ? { targetVerified: true } : {}),
      ...(input.isoTpTuning === true ? { isoTpTuning: true } : {}),
    });
  } catch (e) {
    logError('OBD:ServiceDiscoveryProbe', e);
    return _record(input, spec, pdu, null, 'UNKNOWN',
      e instanceof Error ? e.message : String(e), now);
  }

  const classification = deriveServicePresence(response.outcome, response.nrc);
  const reason = presenceReason(response.outcome, response.nrc, response.detail);

  /* Kanonik iz — replay künyesi `encodePduRequest` ile AYNI biçimdedir.
     Keşif yeni bir iz biçimi ÜRETMEZ, mevcut kaydediciyi kullanır. */
  let correlationId: string | null = null;
  try {
    const ev = traceFromTransaction(input.txn, {
      operation: _operationOf(pdu.service),
      subFunction: pdu.subFunction,
      rawRequest: encodePduRequest(pdu),
      rawResponse: response.raw,
      transportOutcome: response.outcome,
      nrc: response.nrc,
      latencyMs: response.latencyMs,
      byteCount: response.byteCount,
      frameCount: response.frameCount,
      ecuTxHeader: pdu.target.txHeader,
      ecuRxHeader: pdu.target.rxHeader,
      ecuLabel: pdu.target.label,
      protocol: response.protocol,
      sessionEpoch: input.sessionEpoch ?? null,
    });
    correlationId = ev?.evidenceCorrelationId ?? null;
  } catch (e) { logError('OBD:ServiceDiscoveryTrace', e); }

  const rec = _record(
    input, spec, pdu, response, classification, reason, now, correlationId);

  /* Boşluk sicili — MEVCUT sözlük, yeni sinyal tanımlanmadı.

     P0-VDK-F5D: kayıt artık KENDİ kanıt zarfını taşır. Zarf bu satırın
     ÖLÇTÜĞÜ künyeden (`ProbeRecord`) kurulur; ikinci bir ölçüm yapılmaz,
     ikinci bir sınıflandırma üretilmez. Böylece Self-Healing bağlamı bulmak
     için TAVANLI yoklama defterine geri dönmek zorunda kalmaz. */
  try {
    const signal = gapSignalForPresence(classification, spec.isSubFunctionProbe);
    if (signal !== null) {
      recordGap({
        signal,
        scope: classification === 'UNKNOWN_TRANSPORT_LIMIT' ? 'TRANSPORT' : 'AUTHORITY',
        context: `discovery:${pdu.service}${pdu.subFunction ?? ''}`,
        atMs: now,
        evidence: _gapEvidenceOf(input, rec),
      });
    }
  } catch (e) { logError('OBD:ServiceDiscoveryGap', e); }

  return rec;
}

/**
 * P0-VDK-F5D — yoklama kanıtından KANONİK boşluk zarfı.
 *
 * Yeni ölçüm YAPMAZ, yeni sınıflandırma ÜRETMEZ: yalnız bu satırın zaten
 * ölçtüğü künyeyi kanonik kurucuya (`buildGapEvidence`) verir ve öğrenme
 * kenarının anahtarını (varsa) referans olarak bağlar — kenarın KOPYASINI
 * DEĞİL.
 */
function _gapEvidenceOf(
  input: ServiceDiscoveryInput, rec: ProbeRecord,
): GapEvidence | null {
  const ids = _ids(input);
  return buildGapEvidence({
    observation: rec,
    transactionId: input.txn?.transactionId ?? null,
    evidenceCorrelationId: input.txn?.evidenceCorrelationId ?? null,
    sessionEpoch: input.sessionEpoch ?? input.txn?.sessionEpoch ?? null,
    provenance: input.provenance ?? null,
    vehicleFingerprintRef: ids?.v ?? null,
    ecuFingerprintRef: ids?.e ?? null,
    capabilityEdgeRef: ids === null ? null : edgeKey({
      vehicleId: ids.v, ecuId: ids.e,
      service: rec.service, subFunction: rec.subFunction,
    }),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KAYIT KURUCULARI
   ══════════════════════════════════════════════════════════════════════════ */

function _record(
  input: ServiceDiscoveryInput, spec: ProbeSpec,
  pdu: DiagnosticPdu | null, response: PduResponse | null,
  classification: ServicePresence, reason: string, now: number | null,
  correlationId: string | null = null,
): ProbeRecord {
  return {
    ecuKey: input.ecuKey ?? null,
    ecuLabel: input.ecu.name ?? null,
    txHeader: pdu?.target.txHeader ?? (input.ecu.txHeader || null),
    rxHeader: pdu?.target.rxHeader ?? (input.ecu.rxHeader || null),
    service: spec.service,
    subFunction: spec.subFunction,
    serviceDefId: spec.serviceDefId,
    requestIdentity: pdu === null
      ? `${spec.service}${spec.subFunction ?? ''}${spec.payload}`
      : encodePduRequest(pdu),
    outcome: response?.outcome ?? 'UNKNOWN',
    nrc: response?.nrc ?? null,
    latencyMs: response?.latencyMs ?? null,
    sessionOpened: response?.session?.opened ?? null,
    sessionCommand: response?.session?.command ?? null,
    transportKind: response?.transportKind ?? null,
    traceCorrelationId: correlationId,
    protocol: response?.protocol ?? input.protocol ?? null,
    classification, reason,
    atMs: now,
    count: 1,
    reusedFromLearning: false,
    reuseDecision: null,
  };
}

/**
 * ÖĞRENİLMİŞ kayıttan üretilen satır — **istek GÖNDERİLMEDİ**.
 *
 * Sınıflandırma önceki CANLI ölçümden gelir; `reusedFromLearning: true` ile
 * açıkça işaretlenir ve gerekçesi yazılır. Bunu gizlemek, taze ölçüm izlenimi
 * vermek olurdu.
 */
function _reuseRecord(
  input: ServiceDiscoveryInput, spec: ProbeSpec,
  edge: import('../capability/capabilityGraph').CapabilityEdge, now: number | null,
): ProbeRecord {
  const base = _record(input, spec, null, null, edge.presence,
    `${REUSE_DECISION_LABEL.REUSE} · önceki canlı ölçüm (${edge.observationCount}×)`, now);
  return {
    ...base,
    nrc: edge.lastNrc,
    protocol: edge.protocol ?? base.protocol,
    reusedFromLearning: true,
    reuseDecision: 'REUSE',
  };
}

function _deferredRecord(
  input: ServiceDiscoveryInput, spec: ProbeSpec, now: number | null,
  stop: DiscoveryStopReason,
): ProbeRecord {
  return _record(input, spec, null, null, 'DEFERRED',
    `yoklanmadı: ${DISCOVERY_STOP_LABEL[stop]}`, now);
}

function _forbiddenRecord(
  input: ServiceDiscoveryInput, e: ProbeExclusion, now: number | null,
): ProbeRecord {
  const spec: ProbeSpec = {
    serviceDefId: e.serviceDefId, service: e.service, subFunction: e.subFunction,
    payload: '', responseEchoBytes: 0, isSubFunctionProbe: false,
  };
  return _record(input, spec, null, null, 'PROBE_FORBIDDEN',
    `korpusa alınmadı: ${e.reason}`, now);
}

/** Kira reddi gerekçesi (LAB için) — kira yoksa `null`. */
export function describeLeaseDenial(lease: DiagnosticSessionLease | null): string | null {
  if (lease === null) return null;
  return canReadUnderLease(lease) ? null : leaseDenialReason(lease);
}
