/**
 * sessionHealing — P0-VDK-F5C · OTURUM-KOŞULLU BOŞLUKLARIN YENİDEN ÖLÇÜMÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── REPO GERÇEĞİ (bu tasarımı belirleyen ölçüm) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Kodda **bağımsız bir "oturum aç" native metodu YOKTUR.** `ElmProtocol`,
 * bir UDS isteği `SESSION_REQUIRED` ailesinden NRC alırsa (`7E · 7F · 22 · 24`)
 * `openExtendedSession()`i **aynı atomik kuyruk görevi içinde** çağırır, AYNI
 * isteği yeni oturumda TEK KEZ tekrarlar ve sonucu `sessionOpened` /
 * `sessionCommand` kanıtıyla döner. Native yorumu bu atomikliğin neden şart
 * olduğunu da yazıyor: *"oturum + istek AYNI atomik kuyruk görevinde ardışık
 * çalışır → ECU'nun S3 penceresine girilmez"*.
 *
 * ⇒ TS'ten ayrı bir `10 xx` göndermek **yeni bir oturum otoritesi kurmak**
 *   (görev kuralı 9 ve 13 ile yasak) ve o atomikliği bozmak olurdu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU YÜZDEN "REOPEN" NE DEMEK ───────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Oturum-koşullu bir boşluğu iyileştirmek = **asıl salt-okunur yoklamayı
 * NORMAL F4-B/F4-A yolundan yeniden ölçmek**. Oturum, gerekiyorsa o yolun
 * İÇİNDE açılır ve kanıtı geri döner; kanıt F1-B kirasına işlenir.
 *
 * **Oturumun açılması TEK BAŞINA BAŞARI DEĞİLDİR.** Boşluk yalnız asıl
 * ölçüm YENİ ve CANLI bir kanıt üretirse kapanır — bu karar F5-A
 * `judgeEvidence`in işidir ve burada TEKRARLANMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) İkinci oturum/kurtarma otoritesi DEĞİL — F1-B tek sahiptir.
 * (2) İkinci keepalive zamanlayıcısı DEĞİL — tek atış sahibin API'sinden.
 * (3) İkinci PDU motoru DEĞİL — ölçüm F4-B `runServiceDiscovery`den.
 * (4) Magic session byte ÜRETMEZ — komut yalnız ÖLÇÜLMÜŞ kanıttan bilinir.
 * (5) Timer · session cache · lease registry · epoch KURMAZ.
 */

import { logError } from '../../crashLogger';
import type { DiagnosticTransaction } from '../diagnosticTransaction';
import type { DiagnosticSessionLease } from '../diagnosticSessionLease';
import {
  applySessionEvidence, canReadUnderLease,
} from '../diagnosticSessionLease';
import {
  openSessionLease, verifyTesterPresentOnce,
} from '../diagnosticSessionScheduler';
import type { ServiceDef, ProtocolClassName, EcuVariant } from '../cddl/schema';
import type { CapabilityProvenance, TransportConstraint } from '../capability/capabilityGraph';
import { runServiceDiscovery } from '../discovery/serviceDiscoveryRuntime';
import type { ProbeRecord } from '../discovery/serviceProbeModel';
import type { ServicePresence } from '../ecuCapabilityModel';
import type { GapEvidence } from '../gapEvidence';

/* ══════════════════════════════════════════════════════════════════════════
   1) OTURUM İHTİYACININ KANITI — SAF
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `SESSION_REQUIRED` ailesi — **native `ElmProtocol.classifyNrc` ile BİREBİR**.
 *
 * `7E` subFunctionNotSupportedInActiveSession · `7F` serviceNotSupportedInActiveSession ·
 * `22` conditionsNotCorrect · `24` requestSequenceError.
 *
 * ⚠️ `33` (securityAccessDenied) BİLEREK DIŞARIDA: güvenlik erişimi kapsam
 * DIŞIDIR ve oturum açmakla çözülmez. `11`/`12`/`31` de dışarıda — onlar
 * "kimlik/servis yok" ailesidir.
 */
export const SESSION_FAMILY_NRCS: ReadonlySet<number> =
  Object.freeze(new Set([0x7E, 0x7F, 0x22, 0x24]));

export function isSessionFamilyNrc(nrc: number | null): boolean {
  return nrc !== null && SESSION_FAMILY_NRCS.has(nrc);
}

/** Oturum ihtiyacının HANGİ kanıttan bilindiği — uydurma kaynak YOK. */
export type SessionEvidenceSource =
  /** ECU'da daha önce GERÇEKTEN bir oturum açıldı ve komutu ÖLÇÜLDÜ. */
  | 'MEASURED_SESSION_COMMAND'
  /** ECU oturum ailesinden bir NRC döndürdü (7E · 7F · 22 · 24). */
  | 'SESSION_FAMILY_NRC'
  /** Kanıt YOK — iyileştirme yapılamaz. */
  | 'NONE';

export const SESSION_EVIDENCE_LABEL: Readonly<Record<SessionEvidenceSource, string>> = {
  MEASURED_SESSION_COMMAND: 'ölçülmüş oturum komutu',
  SESSION_FAMILY_NRC:       'oturum ailesi NRC (7E·7F·22·24)',
  NONE:                     'KANIT YOK — oturum baytı uydurulmaz',
} as const;

export interface SessionRequirement {
  readonly required: boolean;
  readonly source: SessionEvidenceSource;
  /** ÖLÇÜLMÜŞ oturum komutu (`1003`/`1081`/`10C0`); ölçülmediyse `null`. */
  readonly command: string | null;
  /** Kanıtı üreten NRC; yoksa `null`. */
  readonly nrc: number | null;
  readonly reason: string;
}

const NO_REQUIREMENT: SessionRequirement = Object.freeze({
  required: false, source: 'NONE', command: null, nrc: null,
  reason: 'oturum kanıtı yok',
});

/**
 * Oturum ihtiyacının okunduğu ÖLÇÜM — `ProbeRecord` bu biçime yapısal olarak
 * uyar; F5-D kanıt zarfı da aynı dört ekseni taşır.
 *
 * ⚠️ Bu YENİ bir kanıt tipi DEĞİLDİR: tek oturum otoritesinin (`deriveSessionRequirement`)
 * girdisini, kaynağı ne olursa olsun TEK biçimde ifade eder. İkinci bir
 * oturum semantiği kurulmasın diye genişletme burada yapıldı, kopyayla değil.
 */
export interface SessionEvidenceObservation {
  readonly sessionOpened: boolean | null;
  readonly sessionCommand: string | null;
  readonly classification: ServicePresence | null;
  readonly nrc: number | null;
}

/**
 * Bir ölçüm kaydından oturum ihtiyacını ÇIKARIR — SAF, uydurmasız.
 *
 * FAIL-CLOSED: kanıt yoksa `required:false` döner ve çağıran `BLOCKED` yazar.
 * Hiçbir dal "muhtemelen extended lazımdır" varsaymaz.
 */
export function deriveSessionRequirement(
  rec: SessionEvidenceObservation | null,
): SessionRequirement {
  if (rec === null) return NO_REQUIREMENT;

  /* ① EN GÜÇLÜ KANIT: bu ECU'da oturum GERÇEKTEN açıldı ve komutu ölçüldü. */
  if (rec.sessionOpened === true
      && typeof rec.sessionCommand === 'string' && rec.sessionCommand.length > 0) {
    return {
      required: true, source: 'MEASURED_SESSION_COMMAND',
      command: rec.sessionCommand, nrc: rec.nrc,
      reason: `oturum daha önce ${rec.sessionCommand} ile açıldı (ölçüldü)`,
    };
  }

  /* ② ECU oturum ailesinden NRC döndürdü → servis VAR, erişim oturuma bağlı.
        Hangi komutun açacağını BİLMİYORUZ; native kendi sırasını dener. */
  if (rec.classification === 'PRESENT_BUT_CONDITIONED' && isSessionFamilyNrc(rec.nrc)) {
    return {
      required: true, source: 'SESSION_FAMILY_NRC',
      command: null, nrc: rec.nrc,
      reason: `ECU 0x${(rec.nrc ?? 0).toString(16).toUpperCase()} döndürdü — `
        + 'servis VAR, erişim oturuma bağlı',
    };
  }

  return NO_REQUIREMENT;
}

/**
 * P0-VDK-F5D — KANONİK BOŞLUK ZARFINDAN oturum kanıtı.
 *
 * ⚠️ Oturum semantiği burada YENİDEN HESAPLANMAZ: zarf yalnız dört ölçülmüş
 * ekseni tek otoriteye (`deriveSessionRequirement`) taşır. Böylece
 * `SESSION_CONDITIONED` bağlamı, F4-B'nin tavanlı yoklama defteri kırpılmış
 * olsa bile boşluğun KENDİ kanıtından türetilebilir.
 *
 * Sınıflandırma ölçülmemişse `null` döner — uydurma oturum ihtiyacı YOK.
 */
export function sessionEvidenceFromGapEvidence(
  ev: GapEvidence | null,
): SessionEvidenceObservation | null {
  if (ev === null || ev.observedClassification === null) return null;
  return {
    sessionOpened: ev.sessionOpened,
    sessionCommand: ev.sessionCommand,
    classification: ev.observedClassification,
    nrc: ev.observedNrc,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇALIŞTIRILABİLİRLİK — SAF
   ══════════════════════════════════════════════════════════════════════════ */

export type SessionHealingAdmission = 'RUN' | 'BLOCKED' | 'DEFERRED';

export interface SessionHealingInput {
  readonly requirement: SessionRequirement;
  readonly transactionLive: boolean;
  readonly cancelled: boolean;
  readonly staleEpoch: boolean;
  readonly admissionReady: boolean;
  readonly ecuTargetProven: boolean;
  readonly safeDefsAvailable: boolean;
  /** Bu zincir için ayrılan istek payı (F5-B payının İÇİNDEN). */
  readonly allocatedRequests: number;
  /** Zincirin atomik maliyeti — yarım zincir başlatılmaz. */
  readonly chainCost: number;
}

export interface SessionHealingDecision {
  readonly admission: SessionHealingAdmission;
  readonly reason: string;
}

/**
 * ZİNCİRİN ATOMİK MALİYETİ.
 *
 * `1` asıl yeniden yoklama (oturum açılışı native'de bunun İÇİNDEDİR ve ayrı
 * istek olarak sayılmaz — ölçüm bunu böyle yapıyor) + `1` isteğe bağlı
 * TesterPresent doğrulaması. Yarım zincir başlatmak hem isteği çöpe atar hem
 * de yarım kanıt üretir.
 */
export const SESSION_CHAIN_COST = 2;

export function evaluateSessionHealing(
  i: SessionHealingInput,
): SessionHealingDecision {
  if (!i.requirement.required) {
    return { admission: 'BLOCKED',
      reason: `oturum kanıtı YOK (${SESSION_EVIDENCE_LABEL[i.requirement.source]}) `
        + '— kör 10 xx GÖNDERİLMEZ' };
  }
  if (!i.admissionReady) {
    return { admission: 'BLOCKED', reason: 'tanı admisyonu READY değil' };
  }
  if (i.cancelled) return { admission: 'BLOCKED', reason: 'işlem iptal edildi' };
  if (i.staleEpoch) {
    return { admission: 'BLOCKED', reason: 'OBD oturum mührü bayat/ölçülemedi' };
  }
  if (!i.transactionLive) {
    return { admission: 'BLOCKED', reason: 'işlem canlı değil' };
  }
  if (!i.ecuTargetProven) {
    return { admission: 'BLOCKED', reason: 'hedef ECU adresi kanıtlı değil' };
  }
  if (!i.safeDefsAvailable) {
    return { admission: 'BLOCKED', reason: 'hedefe uyan güvenli CDDL tanımı yok' };
  }
  if (i.allocatedRequests < i.chainCost) {
    return { admission: 'DEFERRED',
      reason: `pay (${i.allocatedRequests}) atomik zincir maliyetini `
        + `(${i.chainCost}) karşılamıyor — yarım zincir başlatılmaz` };
  }
  return { admission: 'RUN',
    reason: `${SESSION_EVIDENCE_LABEL[i.requirement.source]}: ${i.requirement.reason}` };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KANIT DEFTERİ — LAB salt-okuma yüzeyi
   ══════════════════════════════════════════════════════════════════════════ */

/** Oturum açılışının ÖLÇÜLEN sonucu — altı sınıf AYRI kalır. */
export type SessionOpenOutcome =
  | 'POSITIVE' | 'NEGATIVE' | 'NO_RESPONSE' | 'TIMEOUT'
  | 'TRANSPORT_ERROR' | 'UNKNOWN';

export const SESSION_OPEN_LABEL: Readonly<Record<SessionOpenOutcome, string>> = {
  POSITIVE:        'oturum AÇILDI (kanıtlı)',
  NEGATIVE:        'ECU negatif yanıt verdi',
  NO_RESPONSE:     'ECU sustu — ölçüm YOK',
  TIMEOUT:         'zaman aşımı',
  TRANSPORT_ERROR: 'hat/taşıma hatası',
  UNKNOWN:         'ÖLÇÜLEMEDİ',
} as const;

/**
 * Yoklama sonucundan oturum açılış sonucunu türetir — SAF.
 *
 * ⚠️ Hiçbir dal "ECU desteklemiyor" ya da "araç temiz" ÜRETMEZ. Oturum
 * açılamaması ARAÇ hakkında bir hüküm DEĞİLDİR.
 */
export function sessionOpenOutcomeFrom(rec: ProbeRecord | null): SessionOpenOutcome {
  if (rec === null) return 'UNKNOWN';
  if (rec.sessionOpened === true) return 'POSITIVE';
  switch (rec.outcome) {
    case 'NEGATIVE':        return 'NEGATIVE';
    case 'NO_RESPONSE':     return 'NO_RESPONSE';
    case 'TIMEOUT':         return 'TIMEOUT';
    case 'TRANSPORT_ERROR': return 'TRANSPORT_ERROR';
    default:                return 'UNKNOWN';
  }
}

export interface SessionHealingEvidence {
  readonly gapKey: string;
  readonly decision: SessionHealingAdmission;
  readonly reason: string;
  readonly evidenceSource: SessionEvidenceSource;
  /** ÖLÇÜLMÜŞ oturum komutu; bilinmiyorsa `null` (uydurulmaz). */
  readonly sessionCommand: string | null;
  readonly sessionOpen: SessionOpenOutcome | null;
  /** F1-B kira durumu ölçümden sonra; ölçüm yapılmadıysa `null`. */
  readonly leaseState: string | null;
  readonly testerPresentRequired: boolean;
  /** `null` = gönderilmedi (gönderilmedi ≠ başarısız). */
  readonly testerPresent: string | null;
  /** Asıl yoklamanın sınıflandırması; ölçülmediyse `null`. */
  readonly probeClassification: string | null;
  readonly requestsUsed: number | null;
  readonly atMs: number | null;
}

export const MAX_SESSION_HEALING_EVIDENCE = 20;

let _evidence: SessionHealingEvidence[] = [];

export function getSessionHealingEvidence(): readonly SessionHealingEvidence[] {
  try { return [..._evidence]; } catch { return []; }
}
export function getLastSessionHealing(): SessionHealingEvidence | null {
  return _evidence.length === 0 ? null : _evidence[_evidence.length - 1];
}
export function sessionHealingEverEvaluated(): boolean { return _evidence.length > 0; }
/** @internal — testler arası izolasyon. */
export function _resetSessionHealingForTest(): void { _evidence = []; }

function _record(e: SessionHealingEvidence): void {
  try {
    _evidence.push(e);
    if (_evidence.length > MAX_SESSION_HEALING_EVIDENCE) _evidence.shift();
  } catch { /* kanıt kaydı ASLA turu düşürmez */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KABUK — F5-A çözücüsünden çağrılır
   ══════════════════════════════════════════════════════════════════════════ */

export interface SessionReprobeContext {
  readonly gapKey: string;
  readonly ecu: EcuVariant;
  readonly defs: readonly ServiceDef[];
  readonly protocolClass: ProtocolClassName | 'unknown' | null;
  readonly protocol: string | null;
  readonly ecuKey: string | null;
  readonly targetVerified: boolean;
  readonly provenance: CapabilityProvenance;
  readonly transport: TransportConstraint;
  readonly vehicleId: string | null;
  readonly ecuId: string | null;
  readonly fingerprintReusable: boolean;
  readonly nowMs: number | null;
  /** Alt fonksiyon yoklaması mı (boşluğun künyesi belirler). */
  readonly probeSubFunctions: boolean;
  /** TesterPresent doğrulaması istensin mi. */
  readonly verifyTesterPresent: boolean;
}

export interface SessionReprobeResult {
  readonly records: readonly ProbeRecord[];
  readonly evidence: SessionHealingEvidence;
  readonly requestsSpent: number;
}

/**
 * Oturum-koşullu boşluğu NORMAL yoldan yeniden ölçer.
 *
 * Adımlar (hepsi mevcut otoriteler):
 *   ① F1-B kirası aç/al        → `openSessionLease`
 *   ② asıl yoklamayı tekrarla  → `runServiceDiscovery` (oturum native'de İÇERİDE açılır)
 *   ③ oturum kanıtını kiraya işle → `applySessionEvidence`
 *   ④ istenirse TesterPresent doğrula → `verifyTesterPresentOnce` (sahibin API'si)
 *
 * ASLA throw etmez. Boşluğun kapanıp kapanmayacağına BURADA karar verilmez —
 * o F5-A `judgeEvidence`in işidir.
 */
export async function runSessionConditionedReprobe(
  txn: DiagnosticTransaction,
  requirement: SessionRequirement,
  ctx: SessionReprobeContext,
): Promise<SessionReprobeResult> {
  const before = txn.requestsUsed;

  /* ① F1-B kirası — YENİ kira kaydı/registry KURULMAZ, sahibin API'si. */
  let lease: DiagnosticSessionLease | null = null;
  try {
    lease = openSessionLease(txn, {
      txHeader: ctx.ecu.txHeader.length === 0 ? null : ctx.ecu.txHeader,
      rxHeader: ctx.ecu.rxHeader.length === 0 ? null : ctx.ecu.rxHeader,
      addressBits: null,
      label: ctx.ecu.name,
    }, ctx.protocol);
  } catch (e) { logError('OBD:SessionHealingLease', e); }

  /* ② Asıl yoklama — oturum gerekiyorsa native BU ÇAĞRININ İÇİNDE açar. */
  let records: readonly ProbeRecord[] = [];
  try {
    const res = await runServiceDiscovery({
      defs: ctx.defs,
      ecu: ctx.ecu,
      protocolClass: ctx.protocolClass ?? null,
      protocol: ctx.protocol,
      txn,
      /* Kira kapısı F4-B içinde AYNEN uygulanır (ikinci kapı kurulmaz). */
      lease: lease !== null && canReadUnderLease(lease) ? lease : null,
      ecuKey: ctx.ecuKey,
      targetVerified: ctx.targetVerified,
      nowMs: ctx.nowMs,
      probeSubFunctions: ctx.probeSubFunctions,
      vehicleId: ctx.vehicleId,
      ecuId: ctx.ecuId,
      fingerprintReusable: ctx.fingerprintReusable,
      provenance: ctx.provenance,
      transport: ctx.transport,
      /* Amaç ÖLÇMEK — öğrenilmiş kayıtla atlanırsa oturum kanıtı hiç doğmaz. */
      reuseLearning: false,
    });
    records = res.records;
  } catch (e) { logError('OBD:SessionHealingProbe', e); }

  const last = records.length === 0 ? null : records[records.length - 1];
  const openOutcome = sessionOpenOutcomeFrom(last);

  /* ③ Oturum kanıtını F1-B kirasına işle — kanıt YOKSA kira ACTIVE OLMAZ. */
  if (lease !== null && last !== null) {
    try {
      applySessionEvidence(lease, {
        sessionOpened: last.sessionOpened === true,
        sessionCommand: last.sessionCommand ?? null,
      }, ctx.nowMs ?? 0);
    } catch (e) { logError('OBD:SessionHealingEvidence', e); }
  }

  /* ④ TesterPresent — YALNIZ kanıtlı ve ACTIVE kirada; kör 3E imkânsız. */
  let tp: string | null = null;
  if (ctx.verifyTesterPresent && lease !== null) {
    try { tp = (await verifyTesterPresentOnce(lease)) ?? null; }
    catch (e) { logError('OBD:SessionHealingTesterPresent', e); }
  }

  const evidence: SessionHealingEvidence = {
    gapKey: ctx.gapKey,
    decision: 'RUN',
    reason: requirement.reason,
    evidenceSource: requirement.source,
    /* Komut YALNIZ ölçüldüyse taşınır (bu turda ölçülen öncelikli). */
    sessionCommand: last?.sessionCommand ?? requirement.command,
    sessionOpen: openOutcome,
    leaseState: lease?.state ?? null,
    testerPresentRequired: ctx.verifyTesterPresent,
    testerPresent: tp,
    probeClassification: last?.classification ?? null,
    requestsUsed: txn.requestsUsed - before,
    atMs: ctx.nowMs,
  };
  _record(evidence);

  return { records, evidence, requestsSpent: txn.requestsUsed - before };
}

/** Reddedilen kararı da deftere yazar — sessiz "denenmedi" YOKTUR. */
export function recordSessionHealingDenial(
  gapKey: string, decision: SessionHealingDecision,
  requirement: SessionRequirement, atMs: number | null,
): void {
  _record({
    gapKey, decision: decision.admission, reason: decision.reason,
    evidenceSource: requirement.source,
    sessionCommand: requirement.command,
    sessionOpen: null, leaseState: null,
    testerPresentRequired: false, testerPresent: null,
    probeClassification: null, requestsUsed: null, atMs,
  });
}
